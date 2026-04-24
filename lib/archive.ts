import crypto from "node:crypto";
import type {
  ArchivedAttachmentPayload,
  ArchivedMessagePayload,
  ArchiveFilePayload,
  BackupPreference,
  Message,
  MessageArchive
} from "@/types";
import { downloadGoogleDriveFile, refreshGoogleDriveAccessToken, type GoogleDriveConnection, uploadGoogleDriveJson } from "@/lib/google-drive";

type BackupPreferenceRow = BackupPreference & {
  drive_access_token_enc: string | null;
  drive_refresh_token_enc: string | null;
  drive_token_expires_at: string | null;
};

type MessageAttachmentRow = {
  id: string;
  message_id: string;
  url: string;
  public_id: string | null;
  resource_type: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

type RestoreAttachmentQuery = {
  conversationId: string;
  messageId: string;
  attachmentId: string;
};

type BackedUpAttachmentPayload = ArchivedAttachmentPayload & {
  inline_data_base64?: string | null;
};

type BackedUpMessagePayload = ArchivedMessagePayload & {
  attachments?: BackedUpAttachmentPayload[];
};

type InternalArchivePayload = Omit<ArchiveFilePayload, "messages"> & {
  messages: BackedUpMessagePayload[];
};

function inlineAttachmentData(attachment: ArchivedAttachmentPayload | BackedUpAttachmentPayload) {
  const value = (attachment as { inline_data_base64?: unknown }).inline_data_base64;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function encryptionKey() {
  const secret = process.env.BACKUP_TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new Error("BACKUP_TOKEN_ENCRYPTION_KEY is not configured.");
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptToken(value: string | null) {
  if (!value) return null;
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

function decryptToken(value: string | null) {
  if (!value) return null;
  const raw = Buffer.from(value, "base64url");
  if (raw.length < 28) return null;
  const key = encryptionKey();
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plain.toString("utf8");
}

async function ensureParticipant(supabase: any, userId: string, conversationId: string) {
  const { data: direct } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .maybeSingle();

  if (direct) return;

  const { data: member } = await supabase
    .from("conversation_members")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!member) throw new Error("You do not have access to this conversation.");
}

async function getPreference(supabase: any, userId: string): Promise<BackupPreferenceRow | null> {
  const { data, error } = await supabase.from("backup_preferences").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return ((data as BackupPreferenceRow | null) ?? null);
}

async function patchPreference(supabase: any, userId: string, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from("backup_preferences")
    .upsert(
      {
        user_id: userId,
        ...patch
      },
      { onConflict: "user_id" }
    );
  if (error) throw new Error(error.message);
}

async function userConversationIds(supabase: any, userId: string) {
  const ids = new Set<string>();

  const { data: memberRows, error: memberError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId);
  if (memberError) throw new Error(memberError.message);
  for (const row of memberRows ?? []) {
    const id = row.conversation_id as string | null;
    if (id) ids.add(id);
  }

  const { data: directRows, error: directError } = await supabase
    .from("conversations")
    .select("id")
    .eq("type", "direct")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`);
  if (directError) throw new Error(directError.message);
  for (const row of directRows ?? []) {
    const id = row.id as string | null;
    if (id) ids.add(id);
  }

  return [...ids];
}

async function validAccessToken(supabase: any, userId: string) {
  const preference = await getPreference(supabase, userId);
  if (!preference || !preference.enabled || !preference.provider) {
    throw new Error("Backup is not enabled for this user.");
  }

  const currentToken = decryptToken(preference.drive_access_token_enc ?? null);
  const refreshToken = decryptToken(preference.drive_refresh_token_enc ?? null);
  const expiresAt = preference.drive_token_expires_at ? new Date(preference.drive_token_expires_at).getTime() : null;
  const safety = Date.now() + 30_000;

  if (currentToken && (!expiresAt || expiresAt > safety)) {
    return { accessToken: currentToken, preference };
  }

  if (!refreshToken) {
    await patchPreference(supabase, userId, {
      status: "reconnect_required",
      reconnect_required: true,
      last_backup_error: "Google Drive token expired. Please reconnect."
    });
    throw new Error("Google Drive reconnect is required.");
  }

  const refreshed = await refreshGoogleDriveAccessToken(refreshToken, {
    origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  });
  await patchPreference(supabase, userId, {
    drive_access_token_enc: encryptToken(refreshed.accessToken),
    drive_refresh_token_enc: encryptToken(refreshed.refreshToken),
    drive_token_expires_at: refreshed.expiresAt,
    drive_scope: refreshed.scope ?? preference.drive_scope,
    status: "enabled",
    reconnect_required: false
  });
  return { accessToken: refreshed.accessToken, preference: { ...preference, ...refreshed } };
}

function batchKey(conversationId: string) {
  const dateKey = new Date().toISOString().slice(0, 10);
  return `${conversationId}-${dateKey}`;
}

async function readAttachmentInline(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) return null;
    return Buffer.from(bytes).toString("base64");
  } catch {
    return null;
  }
}

async function buildArchivePayload(
  supabase: any,
  userId: string,
  conversationId: string,
  messages: Message[]
): Promise<InternalArchivePayload> {
  const messageIds = messages.map((message) => message.id);
  const { data: attachmentsData, error: attachmentsError } = await supabase
    .from("message_attachments")
    .select("*")
    .in("message_id", messageIds);
  if (attachmentsError) throw new Error(attachmentsError.message);

  const attachmentsByMessage = new Map<string, MessageAttachmentRow[]>();
  for (const attachment of (attachmentsData as MessageAttachmentRow[] | null) ?? []) {
    const list = attachmentsByMessage.get(attachment.message_id) ?? [];
    list.push(attachment);
    attachmentsByMessage.set(attachment.message_id, list);
  }

  const batchId = crypto.randomUUID();
  const key = batchKey(conversationId);
  const payloadMessages: BackedUpMessagePayload[] = [];

  for (const message of messages) {
    const rawAttachments = attachmentsByMessage.get(message.id) ?? [];
    const archivedAttachments: BackedUpAttachmentPayload[] = [];
    for (const attachment of rawAttachments) {
      const inlineData = await readAttachmentInline(attachment.url);
      archivedAttachments.push({
        ...attachment,
        original_url: attachment.url,
        backup: null,
        inline_data_base64: inlineData
      });
    }
    payloadMessages.push({
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
      attachments: archivedAttachments
    });
  }

  return {
    version: 2,
    provider: "google_drive",
    userId,
    conversationId,
    batchId,
    batchKey: key,
    generatedAt: new Date().toISOString(),
    messages: payloadMessages
  };
}

function parseArchive(text: string) {
  try {
    const parsed = JSON.parse(text) as InternalArchivePayload;
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function archiveBatchesForConversation(supabase: any, userId: string, conversationId: string) {
  const { data, error } = await supabase
    .from("archive_batches")
    .select("*")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .eq("status", "success")
    .order("completed_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getBackupStatus(supabase: any, userId: string) {
  const preference = await getPreference(supabase, userId);
  if (preference) return preference;
  return {
    user_id: userId,
    provider: null,
    enabled: false,
    status: "disabled",
    google_drive_email: null,
    drive_scope: null,
    last_successful_backup_at: null,
    last_backup_error: null,
    reconnect_required: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

export async function saveGoogleDriveConnection(supabase: any, userId: string, connection: GoogleDriveConnection) {
  const normalizedEmail = connection.email?.trim().toLowerCase() ?? null;
  if (normalizedEmail) {
    const { data: existing, error } = await supabase
      .from("backup_preferences")
      .select("user_id")
      .eq("provider", "google_drive")
      .ilike("google_drive_email", normalizedEmail)
      .neq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (existing?.user_id) {
      throw new Error("This Google account is already connected to another COMMS account.");
    }
  }

  await patchPreference(supabase, userId, {
    provider: "google_drive",
    enabled: true,
    status: "enabled",
    google_drive_email: normalizedEmail,
    drive_scope: connection.scope,
    drive_access_token_enc: encryptToken(connection.accessToken),
    drive_refresh_token_enc: encryptToken(connection.refreshToken),
    drive_token_expires_at: connection.expiresAt,
    reconnect_required: false,
    last_backup_error: null
  });
}

export async function disableBackup(supabase: any, userId: string) {
  await patchPreference(supabase, userId, {
    enabled: false,
    status: "disabled",
    reconnect_required: false,
    last_backup_error: null
  });
}

export async function runBackupForUser(supabase: any, userId: string) {
  await patchPreference(supabase, userId, { status: "syncing", last_backup_error: null });
  try {
    const { accessToken } = await validAccessToken(supabase, userId);
    const conversationIds = await userConversationIds(supabase, userId);
    if (!conversationIds.length) {
      await patchPreference(supabase, userId, {
        status: "success",
        last_successful_backup_at: new Date().toISOString()
      });
      return { archivedMessages: 0, batches: 0 };
    }

    const { data: messageRows, error: messageError } = await supabase
      .from("messages")
      .select("*")
      .in("conversation_id", conversationIds)
      .eq("archive_status", "pending")
      .is("content_redacted_at", null)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (messageError) throw new Error(messageError.message);
    const messages = ((messageRows as Message[] | null) ?? []);

    if (!messages.length) {
      await patchPreference(supabase, userId, {
        status: "success",
        last_successful_backup_at: new Date().toISOString()
      });
      return { archivedMessages: 0, batches: 0 };
    }

    const conversations = [...new Set(messages.map((message) => message.conversation_id))];
    let archivedMessages = 0;
    let batchCount = 0;

    for (const conversationId of conversations) {
      const groupMessages = messages.filter((message) => message.conversation_id === conversationId);
      if (!groupMessages.length) continue;

      const payload = await buildArchivePayload(supabase, userId, conversationId, groupMessages);
      const nowIso = new Date().toISOString();
      const provisionalBatch = {
        id: payload.batchId,
        user_id: userId,
        conversation_id: conversationId,
        provider: "google_drive",
        batch_key: payload.batchKey,
        archive_version: 2,
        status: "uploading",
        message_count: payload.messages.length,
        started_at: nowIso
      };
      const { error: batchInsertError } = await supabase.from("archive_batches").upsert(provisionalBatch, { onConflict: "id" });
      if (batchInsertError) throw new Error(batchInsertError.message);

      const fileName = `comms-${conversationId}-${payload.batchKey}.json`;
      const uploaded = await uploadGoogleDriveJson(accessToken, fileName, payload);

      const { error: batchCompleteError } = await supabase
        .from("archive_batches")
        .update({
          status: "success",
          provider_file_id: uploaded.fileId,
          provider_file_name: uploaded.fileName,
          completed_at: new Date().toISOString(),
          error_message: null
        })
        .eq("id", payload.batchId);
      if (batchCompleteError) throw new Error(batchCompleteError.message);

      const archiveRows: Omit<MessageArchive, "id" | "archived_at">[] = groupMessages.map((message) => ({
        message_id: message.id,
        user_id: userId,
        archive_batch_id: payload.batchId
      }));
      const { error: archiveError } = await supabase.from("message_archives").upsert(archiveRows, { onConflict: "message_id,user_id" });
      if (archiveError) throw new Error(archiveError.message);

      const { error: messageUpdateError } = await supabase
        .from("messages")
        .update({ archive_status: "archived" })
        .in(
          "id",
          groupMessages.map((message) => message.id)
        );
      if (messageUpdateError) throw new Error(messageUpdateError.message);

      archivedMessages += groupMessages.length;
      batchCount += 1;
    }

    await patchPreference(supabase, userId, {
      status: "success",
      last_successful_backup_at: new Date().toISOString(),
      last_backup_error: null,
      reconnect_required: false
    });
    return { archivedMessages, batches: batchCount };
  } catch (error) {
    await patchPreference(supabase, userId, {
      status: "failed",
      last_backup_error: error instanceof Error ? error.message : "Backup failed."
    });
    throw error;
  }
}

export async function runRetentionCleanup(supabase: any) {
  const now = new Date().toISOString();
  const { data: candidates, error } = await supabase
    .from("messages")
    .select("id")
    .lt("retention_expires_at", now)
    .is("content_redacted_at", null)
    .in("archive_status", ["archived", "redacted"])
    .limit(2000);
  if (error) throw new Error(error.message);
  const ids = (candidates ?? []).map((row: { id: string }) => row.id);
  if (!ids.length) return { redacted: 0 };

  const { error: updateError } = await supabase
    .from("messages")
    .update({
      content: null,
      content_redacted_at: now,
      archive_status: "redacted"
    })
    .in("id", ids);
  if (updateError) throw new Error(updateError.message);
  return { redacted: ids.length };
}

async function loadArchiveMessages(supabase: any, userId: string, conversationId: string): Promise<BackedUpMessagePayload[]> {
  const batches = await archiveBatchesForConversation(supabase, userId, conversationId);
  if (!batches.length) return [];
  const { accessToken } = await validAccessToken(supabase, userId);

  const collected: BackedUpMessagePayload[] = [];
  for (const batch of batches) {
    const fileId = batch.provider_file_id as string | null;
    if (!fileId) continue;
    try {
      const fileText = await downloadGoogleDriveFile(accessToken, fileId);
      const parsed = parseArchive(fileText);
      if (!parsed?.messages?.length) continue;
      collected.push(...parsed.messages);
    } catch {
      await supabase.from("archive_batches").update({ status: "missing" }).eq("id", batch.id);
    }
  }
  return collected;
}

export async function restoreConversationArchive(supabase: any, userId: string, conversationId: string) {
  await ensureParticipant(supabase, userId, conversationId);
  const rows = await loadArchiveMessages(supabase, userId, conversationId);
  const uniqueById = new Map<string, BackedUpMessagePayload>();
  for (const row of rows) {
    if (!uniqueById.has(row.id)) uniqueById.set(row.id, row);
  }
  return [...uniqueById.values()].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export async function restoreArchivedAttachment(supabase: any, userId: string, query: RestoreAttachmentQuery) {
  await ensureParticipant(supabase, userId, query.conversationId);
  const messages = await loadArchiveMessages(supabase, userId, query.conversationId);
  const message = messages.find((item) => item.id === query.messageId);
  if (!message) throw new Error("Archived message was not found.");
  const attachment = ((message.attachments ?? []) as BackedUpAttachmentPayload[]).find((item) => item.id === query.attachmentId);
  if (!attachment) throw new Error("Archived attachment was not found.");

  const inlineData = inlineAttachmentData(attachment);
  if (inlineData) {
    return {
      body: Buffer.from(inlineData, "base64"),
      mimeType: attachment.mime_type,
      fileName: attachment.file_name
    };
  }

  if (attachment.original_url) {
    const response = await fetch(attachment.original_url);
    if (!response.ok) throw new Error("Original attachment could not be restored.");
    return {
      body: Buffer.from(await response.arrayBuffer()),
      mimeType: attachment.mime_type,
      fileName: attachment.file_name
    };
  }

  throw new Error("Archived attachment body is unavailable.");
}
