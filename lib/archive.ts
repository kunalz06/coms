import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decryptToken,
  encryptToken,
  fetchArchiveFromGoogleDrive,
  fetchBinaryFromGoogleDrive,
  refreshGoogleDriveAccessToken,
  uploadArchiveToGoogleDrive,
  uploadBinaryToGoogleDrive
} from "@/lib/google-drive";
import { safeFileName } from "@/lib/utils";
import type { ArchiveBatch, ArchivedAttachmentPayload, ArchivedMessagePayload, ArchiveFilePayload, Attachment, BackupPreference, Message } from "@/types";

type InternalBackupPreference = BackupPreference & {
  drive_access_token_enc: string | null;
  drive_refresh_token_enc: string | null;
  drive_token_expires_at: string | null;
};

type BackupRunResult = {
  archivedMessages: number;
  archiveBatches: number;
  skippedReason?: string;
};

type MessageWithAttachments = Message & {
  attachments?: Attachment[];
};

const ARCHIVE_VERSION = 2;
const MAX_ARCHIVE_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function archiveDateKey(createdAt: string) {
  return createdAt.slice(0, 10);
}

function archiveFileName(conversationId: string, batchKey: string) {
  return `comms-${conversationId}-${batchKey}.json`;
}

function attachmentBackupFileName(attachment: Attachment) {
  return `comms-attachment-${attachment.id}-${safeFileName(attachment.file_name)}`;
}

function isAllowedCloudinaryUrl(value: string) {
  try {
    const url = new URL(value);
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com" && (!cloudName || url.pathname.startsWith(`/${cloudName}/`));
  } catch {
    return false;
  }
}

async function fetchAttachmentBody(attachment: Attachment) {
  if (!isAllowedCloudinaryUrl(attachment.url)) throw new Error(`Attachment source is not allowed for ${attachment.file_name}.`);
  if (attachment.size_bytes > MAX_ARCHIVE_ATTACHMENT_BYTES) throw new Error(`Attachment is too large to archive: ${attachment.file_name}.`);
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Could not fetch attachment for backup: ${attachment.file_name}.`);
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_ARCHIVE_ATTACHMENT_BYTES) throw new Error(`Attachment is too large to archive: ${attachment.file_name}.`);
  return body;
}

async function archiveAttachmentBinary(accessToken: string, attachment: Attachment): Promise<ArchivedAttachmentPayload> {
  const body = await fetchAttachmentBody(attachment);
  const uploaded = await uploadBinaryToGoogleDrive(accessToken, {
    fileName: attachmentBackupFileName(attachment),
    mimeType: attachment.mime_type || "application/octet-stream",
    body
  });

  return {
    ...attachment,
    original_url: attachment.url,
    backup: {
      provider: "google_drive",
      file_id: uploaded.fileId,
      file_name: uploaded.fileName,
      mime_type: uploaded.mimeType,
      size_bytes: uploaded.sizeBytes,
      backed_up_at: new Date().toISOString()
    }
  };
}

async function archiveMessagePayload(accessToken: string, message: MessageWithAttachments): Promise<ArchivedMessagePayload> {
  const attachments = await Promise.all((message.attachments ?? []).map((attachment) => archiveAttachmentBinary(accessToken, attachment)));
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    sender_id: message.sender_id,
    kind: message.kind,
    content: message.content,
    status: message.status,
    deleted_for_everyone_at: message.deleted_for_everyone_at,
    deleted_by: message.deleted_by,
    edited_at: message.edited_at,
    created_at: message.created_at,
    updated_at: message.updated_at,
    attachments
  };
}

async function getInternalPreference(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("backup_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<InternalBackupPreference>();
  if (error) throw error;
  return data;
}

async function updatePreferenceTokens(
  supabase: SupabaseClient,
  userId: string,
  values: { accessToken: string; refreshToken?: string | null; expiresAt: string; email?: string | null; scope?: string | null }
) {
  const updates: Record<string, unknown> = {
    drive_access_token_enc: encryptToken(values.accessToken),
    drive_token_expires_at: values.expiresAt,
    reconnect_required: false
  };
  if (values.refreshToken) updates.drive_refresh_token_enc = encryptToken(values.refreshToken);
  if (values.email !== undefined) updates.google_drive_email = values.email;
  if (values.scope !== undefined) updates.drive_scope = values.scope;

  const { error } = await supabase.from("backup_preferences").update(updates).eq("user_id", userId);
  if (error) throw error;
}

async function getDriveAccessToken(supabase: SupabaseClient, preference: InternalBackupPreference) {
  const accessToken = decryptToken(preference.drive_access_token_enc);
  const refreshToken = decryptToken(preference.drive_refresh_token_enc);
  const expiresAt = preference.drive_token_expires_at ? new Date(preference.drive_token_expires_at).getTime() : 0;
  if (accessToken && expiresAt > Date.now() + 60_000) return accessToken;

  try {
    const refreshed = await refreshGoogleDriveAccessToken({ accessToken, refreshToken, expiresAt: preference.drive_token_expires_at });
    await updatePreferenceTokens(supabase, preference.user_id, refreshed);
    return refreshed.accessToken;
  } catch (error) {
    await supabase
      .from("backup_preferences")
      .update({
        status: "reconnect_required",
        reconnect_required: true,
        last_backup_error: error instanceof Error ? error.message : "Google Drive needs to be reconnected."
      })
      .eq("user_id", preference.user_id);
    throw error;
  }
}

async function getConversationIdsForUser(supabase: SupabaseClient, userId: string) {
  const { data: direct, error: directError } = await supabase
    .from("conversations")
    .select("id")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .returns<Array<{ id: string }>>();
  if (directError) throw directError;

  const { data: memberships, error: memberError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId)
    .returns<Array<{ conversation_id: string }>>();
  if (memberError) throw memberError;

  return Array.from(new Set([...(direct ?? []).map((item) => item.id), ...(memberships ?? []).map((item) => item.conversation_id)]));
}

async function getAlreadyArchivedMessageIds(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("message_archives")
    .select("message_id, archive_batch_id")
    .eq("user_id", userId)
    .returns<Array<{ message_id: string; archive_batch_id: string }>>();
  if (error) throw error;
  const batchIds = Array.from(new Set((data ?? []).map((item) => item.archive_batch_id)));
  if (!batchIds.length) return new Set<string>();
  const { data: batches, error: batchError } = await supabase
    .from("archive_batches")
    .select("id")
    .in("id", batchIds)
    .eq("status", "success")
    .gte("archive_version", ARCHIVE_VERSION)
    .returns<Array<{ id: string }>>();
  if (batchError) throw batchError;
  const currentArchiveBatchIds = new Set((batches ?? []).map((batch) => batch.id));
  return new Set((data ?? []).filter((item) => currentArchiveBatchIds.has(item.archive_batch_id)).map((item) => item.message_id));
}

async function getMessagesNeedingBackup(supabase: SupabaseClient, userId: string) {
  const conversationIds = await getConversationIdsForUser(supabase, userId);
  if (!conversationIds.length) return [];
  const archivedIds = await getAlreadyArchivedMessageIds(supabase, userId);

  const { data, error } = await supabase
    .from("messages")
    .select("*, attachments:message_attachments(*)")
    .in("conversation_id", conversationIds)
    .is("deleted_for_everyone_at", null)
    .is("content_redacted_at", null)
    .order("created_at", { ascending: true })
    .limit(1000)
    .returns<MessageWithAttachments[]>();
  if (error) throw error;

  return (data ?? []).filter((message) => !archivedIds.has(message.id));
}

function groupMessages(messages: MessageWithAttachments[]) {
  const groups = new Map<string, MessageWithAttachments[]>();
  for (const message of messages) {
    const key = `${message.conversation_id}:${archiveDateKey(message.created_at)}`;
    groups.set(key, [...(groups.get(key) ?? []), message]);
  }
  return Array.from(groups.entries()).map(([key, items]) => ({
    conversationId: items[0].conversation_id,
    batchKey: key.split(":").at(-1)!,
    messages: items
  }));
}

async function upsertArchiveBatch(supabase: SupabaseClient, values: { userId: string; conversationId: string; batchKey: string; messageCount: number }) {
  const { data, error } = await supabase
    .from("archive_batches")
    .upsert(
      {
        user_id: values.userId,
        conversation_id: values.conversationId,
        provider: "google_drive",
        batch_key: values.batchKey,
        archive_version: ARCHIVE_VERSION,
        status: "uploading",
        started_at: new Date().toISOString(),
        error_message: null,
        message_count: values.messageCount
      },
      { onConflict: "user_id,conversation_id,provider,batch_key" }
    )
    .select("*")
    .single<ArchiveBatch>();
  if (error) throw error;
  return data;
}

export async function getBackupStatus(supabase: SupabaseClient, userId: string): Promise<BackupPreference | null> {
  const preference = await getInternalPreference(supabase, userId);
  if (!preference) return null;
  const { drive_access_token_enc, drive_refresh_token_enc, drive_token_expires_at, ...safePreference } = preference;
  void drive_access_token_enc;
  void drive_refresh_token_enc;
  void drive_token_expires_at;
  return safePreference;
}

export async function saveGoogleDriveConnection(
  supabase: SupabaseClient,
  userId: string,
  values: { accessToken: string; refreshToken: string | null; expiresAt: string; scope: string; email: string | null }
) {
  const { error } = await supabase.from("backup_preferences").upsert(
    {
      user_id: userId,
      provider: "google_drive",
      enabled: true,
      status: "enabled",
      google_drive_email: values.email,
      drive_scope: values.scope,
      drive_access_token_enc: encryptToken(values.accessToken),
      drive_refresh_token_enc: encryptToken(values.refreshToken),
      drive_token_expires_at: values.expiresAt,
      last_backup_error: null,
      reconnect_required: false
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

export async function disableBackup(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase.from("backup_preferences").upsert(
    {
      user_id: userId,
      provider: "google_drive",
      enabled: false,
      status: "disabled"
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

export async function runBackupForUser(supabase: SupabaseClient, userId: string): Promise<BackupRunResult> {
  const preference = await getInternalPreference(supabase, userId);
  if (!preference?.enabled || preference.provider !== "google_drive") {
    return { archivedMessages: 0, archiveBatches: 0, skippedReason: "Google Drive backup is not enabled." };
  }

  await supabase.from("backup_preferences").update({ status: "syncing", last_backup_error: null }).eq("user_id", userId);

  try {
    const accessToken = await getDriveAccessToken(supabase, preference);
    const groups = groupMessages(await getMessagesNeedingBackup(supabase, userId));
    let archivedMessages = 0;

    for (const group of groups) {
      const batch = await upsertArchiveBatch(supabase, {
        userId,
        conversationId: group.conversationId,
        batchKey: group.batchKey,
        messageCount: group.messages.length
      });
      const archive: ArchiveFilePayload = {
        version: ARCHIVE_VERSION,
        provider: "google_drive",
        userId,
        conversationId: group.conversationId,
        batchId: batch.id,
        batchKey: group.batchKey,
        generatedAt: new Date().toISOString(),
        messages: await Promise.all(group.messages.map((message) => archiveMessagePayload(accessToken, message)))
      };
      const uploaded = await uploadArchiveToGoogleDrive(accessToken, archiveFileName(group.conversationId, group.batchKey), archive);
      const completedAt = new Date().toISOString();
      const messageIds = group.messages.map((message) => message.id);

      await supabase
        .from("archive_batches")
        .update({
          status: "success",
          provider_file_id: uploaded.fileId,
          provider_file_name: uploaded.fileName,
          completed_at: completedAt,
          error_message: null,
          message_count: group.messages.length
        })
        .eq("id", batch.id);

      await supabase.from("message_archives").upsert(
        messageIds.map((messageId) => ({ message_id: messageId, user_id: userId, archive_batch_id: batch.id, archived_at: completedAt })),
        { onConflict: "message_id,user_id" }
      );

      await supabase.from("messages").update({ archive_status: "archived" }).in("id", messageIds).is("content_redacted_at", null);
      archivedMessages += messageIds.length;
    }

    await supabase
      .from("backup_preferences")
      .update({
        status: "success",
        enabled: true,
        reconnect_required: false,
        last_successful_backup_at: new Date().toISOString(),
        last_backup_error: null
      })
      .eq("user_id", userId);

    return { archivedMessages, archiveBatches: groups.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backup failed.";
    await supabase.from("backup_preferences").update({ status: "failed", last_backup_error: message }).eq("user_id", userId);
    throw error;
  }
}

export async function restoreConversationArchive(supabase: SupabaseClient, userId: string, conversationId: string) {
  const preference = await getInternalPreference(supabase, userId);
  if (!preference?.enabled || preference.provider !== "google_drive") return [];
  const accessToken = await getDriveAccessToken(supabase, preference);

  const { data: batches, error } = await supabase
    .from("archive_batches")
    .select("*")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .eq("status", "success")
    .not("provider_file_id", "is", null)
    .order("batch_key", { ascending: true })
    .returns<ArchiveBatch[]>();
  if (error) throw error;

  const restored: ArchiveFilePayload["messages"] = [];
  for (const batch of batches ?? []) {
    try {
      const archive = await fetchArchiveFromGoogleDrive(accessToken, batch.provider_file_id!);
      restored.push(...archive.messages);
    } catch (error) {
      await supabase
        .from("archive_batches")
        .update({ status: "missing", error_message: error instanceof Error ? error.message : "Archive restore failed." })
        .eq("id", batch.id);
    }
  }

  return restored;
}

export async function restoreArchivedAttachment(
  supabase: SupabaseClient,
  userId: string,
  values: { conversationId: string; messageId: string; attachmentId: string }
) {
  const preference = await getInternalPreference(supabase, userId);
  if (!preference?.enabled || preference.provider !== "google_drive") throw new Error("Google Drive backup is not enabled.");
  const accessToken = await getDriveAccessToken(supabase, preference);

  const { data: batches, error } = await supabase
    .from("archive_batches")
    .select("*")
    .eq("user_id", userId)
    .eq("conversation_id", values.conversationId)
    .eq("status", "success")
    .not("provider_file_id", "is", null)
    .order("batch_key", { ascending: false })
    .returns<ArchiveBatch[]>();
  if (error) throw error;

  for (const batch of batches ?? []) {
    const archive = await fetchArchiveFromGoogleDrive(accessToken, batch.provider_file_id!);
    const message = archive.messages.find((item) => item.id === values.messageId);
    const attachment = message?.attachments?.find((item) => item.id === values.attachmentId);
    if (!attachment) continue;
    const backup = attachment.backup;
    if (!backup?.file_id) throw new Error("This archived attachment does not have a Drive backup.");
    const response = await fetchBinaryFromGoogleDrive(accessToken, backup.file_id);
    return {
      body: response.body,
      mimeType: backup.mime_type || attachment.mime_type || response.headers.get("content-type") || "application/octet-stream",
      fileName: safeFileName(attachment.file_name || backup.file_name),
      sizeBytes: backup.size_bytes
    };
  }

  throw new Error("Archived attachment was not found.");
}

async function getConversationParticipants(supabase: SupabaseClient, conversationId: string) {
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("type,user_one_id,user_two_id")
    .eq("id", conversationId)
    .single<{ type: "direct" | "group"; user_one_id: string | null; user_two_id: string | null }>();
  if (conversationError) throw conversationError;

  if (conversation.type === "direct") return [conversation.user_one_id, conversation.user_two_id].filter(Boolean) as string[];

  const { data, error } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .returns<Array<{ user_id: string }>>();
  if (error) throw error;
  return (data ?? []).map((item) => item.user_id);
}

export async function runRetentionCleanup(supabase: SupabaseClient) {
  const { data: candidates, error } = await supabase
    .from("messages")
    .select("*")
    .lt("retention_expires_at", new Date().toISOString())
    .is("content_redacted_at", null)
    .limit(200)
    .returns<Message[]>();
  if (error) throw error;

  let redacted = 0;
  let skipped = 0;

  for (const message of candidates ?? []) {
    const participants = await getConversationParticipants(supabase, message.conversation_id);
    const { data: enabledPrefs, error: prefsError } = await supabase
      .from("backup_preferences")
      .select("user_id")
      .in("user_id", participants)
      .eq("enabled", true)
      .in("status", ["enabled", "success", "syncing"])
      .returns<Array<{ user_id: string }>>();
    if (prefsError) throw prefsError;
    const enabledUserIds = (enabledPrefs ?? []).map((pref) => pref.user_id);
    if (!enabledUserIds.length) {
      skipped += 1;
      await supabase.from("messages").update({ archive_status: "skipped" }).eq("id", message.id);
      continue;
    }

    const { data: archives, error: archiveError } = await supabase
      .from("message_archives")
      .select("user_id")
      .eq("message_id", message.id)
      .in("user_id", enabledUserIds)
      .returns<Array<{ user_id: string }>>();
    if (archiveError) throw archiveError;
    const archivedUserIds = new Set((archives ?? []).map((archive) => archive.user_id));
    const allEnabledBackupsSucceeded = enabledUserIds.every((userId) => archivedUserIds.has(userId));

    if (!allEnabledBackupsSucceeded) {
      skipped += 1;
      await supabase.from("messages").update({ archive_status: "partial" }).eq("id", message.id);
      continue;
    }

    await supabase
      .from("messages")
      .update({
        content: null,
        content_redacted_at: new Date().toISOString(),
        archive_status: "redacted"
      })
      .eq("id", message.id);
    await supabase.from("message_attachments").delete().eq("message_id", message.id);
    redacted += 1;
  }

  return { scanned: candidates?.length ?? 0, redacted, skipped };
}
