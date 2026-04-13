"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getCachedArchiveMessages, setCachedArchiveMessages } from "@/lib/archive-cache";
import { restoreArchivedMessages, runBackupNow } from "@/services/backup-service";
import {
  deleteConversationHistoryForMe,
  deleteMessageForEveryone,
  deleteMessageForMe,
  deleteMessageRangeForMe,
  editMessage,
  getMessages,
  getOrCreateConversation,
  markConversationRead,
  sendMessage,
  shareMessageToConversation,
  toggleMessageReaction
} from "@/services/chat-service";
import { sendUnreadMessagePush } from "@/services/notification-service";
import { uploadToCloudinary, type CloudinaryUploadResult } from "@/services/upload-service";
import type { ArchivedAttachmentPayload, Attachment, ChatTarget, Conversation, Message, MessageKind, MessageReactionKind, UploadKind } from "@/types";
import { useAuth } from "@/features/auth/auth-provider";

const REFRESH_INTERVAL_MS = 10_000;

export function useChat(target: ChatTarget | null) {
  const { user, supabase, getIdToken } = useAuth();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const conversationId = conversation?.id ?? null;

  const toRestoredAttachment = useCallback(
    (nextConversationId: string, messageId: string, attachment: ArchivedAttachmentPayload, token: string): Attachment => {
      const backupUrl = attachment.backup
        ? `/api/backup/attachment?conversationId=${encodeURIComponent(nextConversationId)}&messageId=${encodeURIComponent(messageId)}&attachmentId=${encodeURIComponent(attachment.id)}&token=${encodeURIComponent(token)}`
        : attachment.original_url;
      return {
        id: attachment.id,
        message_id: attachment.message_id,
        url: backupUrl,
        public_id: attachment.public_id,
        resource_type: attachment.resource_type,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
        created_at: attachment.created_at
      };
    },
    []
  );

  const hydrateArchivedMessages = useCallback(
    async (nextConversationId: string, nextMessages: Message[]) => {
      if (!nextMessages.some((message) => message.content_redacted_at)) return nextMessages;
      const token = await getIdToken();
      const mergeArchived = (archivedMessages: Awaited<ReturnType<typeof restoreArchivedMessages>>) => {
        const archivedById = new Map(archivedMessages.map((message) => [message.id, message]));
        return nextMessages.map((message) => {
          const archived = archivedById.get(message.id);
          if (!archived) return message;
          return {
            ...message,
            content: message.content ?? archived.content,
            attachments: message.content_redacted_at
              ? archived.attachments?.map((attachment) => toRestoredAttachment(nextConversationId, message.id, attachment, token))
              : message.attachments?.length
                ? message.attachments
                : archived.attachments?.map((attachment) => toRestoredAttachment(nextConversationId, message.id, attachment, token))
          };
        });
      };

      const cached = await getCachedArchiveMessages(nextConversationId);
      if (cached) return mergeArchived(cached);

      try {
        const restored = await restoreArchivedMessages(token, nextConversationId);
        await setCachedArchiveMessages(nextConversationId, restored);
        return mergeArchived(restored);
      } catch {
        return nextMessages;
      }
    },
    [getIdToken, toRestoredAttachment]
  );

  const triggerBackgroundBackup = useCallback(() => {
    window.setTimeout(() => {
      void getIdToken()
        .then((token) => runBackupNow(token))
        .catch(() => undefined);
    }, 1200);
  }, [getIdToken]);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!supabase || !user || !target) {
      setConversation(null);
      setMessages([]);
      return;
    }
    if (!options?.silent) setLoading(true);
    try {
      const nextConversation =
        target.kind === "direct"
          ? await getOrCreateConversation(supabase, user.uid, target.friend.id)
          : target.conversation;
      setConversation(nextConversation);
      const nextMessages = await getMessages(supabase, nextConversation.id);
      setMessages(await hydrateArchivedMessages(nextConversation.id, nextMessages));
      await markConversationRead(supabase, nextConversation.id, user.uid);
      window.dispatchEvent(new CustomEvent("comms:messages-read", { detail: { conversationId: nextConversation.id } }));
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [hydrateArchivedMessages, supabase, target, user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!supabase || !conversationId) return;
    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, () => void load({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "message_deletions" }, () => void load({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "message_attachments" }, () => void load({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, () => void load({ silent: true }))
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, load, supabase]);

  useEffect(() => {
    if (!target || !supabase || !user) return;
    const interval = window.setInterval(() => {
      void load({ silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [target, load, supabase, user]);

  const sendText = useCallback(
    async (content: string) => {
      if (!supabase || !user || !conversation) throw new Error("Choose a conversation first.");
      const trimmed = content.trim();
      if (!trimmed) return;
      const optimistic: Message = {
        id: `local-${crypto.randomUUID()}`,
        conversation_id: conversation.id,
        sender_id: user.uid,
        kind: "text",
        content: trimmed,
        status: "sending",
        deleted_for_everyone_at: null,
        deleted_by: null,
        edited_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        retention_expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        content_redacted_at: null,
        archive_status: "pending",
        attachments: []
      };
      setMessages((items) => [...items, optimistic]);
      try {
        const sent = await sendMessage(supabase, { conversationId: conversation.id, senderId: user.uid, kind: "text", content: trimmed });
        void sendUnreadMessagePush({ messageId: sent.id, getIdToken });
        triggerBackgroundBackup();
        await load({ silent: true });
      } catch (error) {
        setMessages((items) => items.map((item) => (item.id === optimistic.id ? { ...item, status: "failed" } : item)));
        throw error;
      }
    },
    [conversation, getIdToken, load, supabase, triggerBackgroundBackup, user]
  );

  const sendFile = useCallback(
    async (file: File, uploadKind: UploadKind, options?: { signal?: AbortSignal }) => {
      if (!supabase || !user || !conversation) throw new Error("Choose a conversation first.");
      setUploadProgress(1);
      try {
        const result: CloudinaryUploadResult = await uploadToCloudinary({
          file,
          kind: uploadKind,
          getIdToken,
          onProgress: setUploadProgress,
          signal: options?.signal
        });
        const kind: MessageKind = uploadKind === "voice" ? "voice" : uploadKind === "document" ? "document" : "image";
        const sent = await sendMessage(supabase, {
          conversationId: conversation.id,
          senderId: user.uid,
          kind,
          content: kind === "document" ? result.fileName : null,
          attachment: {
            url: result.url,
            public_id: result.publicId,
            resource_type: result.resourceType,
            file_name: result.fileName,
            mime_type: result.mimeType,
            size_bytes: result.sizeBytes
          }
        });
        void sendUnreadMessagePush({ messageId: sent.id, getIdToken });
        triggerBackgroundBackup();
        await load({ silent: true });
      } finally {
        setUploadProgress(0);
      }
    },
    [conversation, getIdToken, load, supabase, triggerBackgroundBackup, user]
  );

  const getDownloadUrl = useCallback(
    async (url: string) => {
      const token = await getIdToken();
      if (url.startsWith("/api/backup/attachment")) {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message ?? "Could not restore this archived file.");
        }
        const blob = await response.blob();
        return URL.createObjectURL(blob);
      }
      const response = await fetch(`/api/files/download?url=${encodeURIComponent(url)}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Could not open this file.");
      }
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    },
    [getIdToken]
  );

  const reactToMessage = useCallback(
    async (messageId: string, kind: MessageReactionKind, content: string) => {
      if (!supabase || !user) throw new Error("Sign in to react.");
      if (messageId.startsWith("local-")) throw new Error("Wait for the message to finish sending first.");
      await toggleMessageReaction(supabase, { messageId, userId: user.uid, kind, content });
      await load({ silent: true });
    },
    [load, supabase, user]
  );

  const removeMessageForMe = useCallback(
    async (messageId: string) => {
      if (!supabase || !user) throw new Error("Sign in to delete messages.");
      if (messageId.startsWith("local-")) throw new Error("Wait for the message to finish sending first.");
      await deleteMessageForMe(supabase, { messageId, userId: user.uid });
      await load({ silent: true });
    },
    [load, supabase, user]
  );

  const removeMessageForEveryone = useCallback(
    async (messageId: string) => {
      if (!supabase || !user) throw new Error("Sign in to delete messages.");
      if (messageId.startsWith("local-")) throw new Error("Wait for the message to finish sending first.");
      await deleteMessageForEveryone(supabase, { messageId, userId: user.uid });
      await load({ silent: true });
    },
    [load, supabase, user]
  );

  const editTextMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!supabase || !user) throw new Error("Sign in to edit messages.");
      if (messageId.startsWith("local-")) throw new Error("Wait for the message to finish sending first.");
      await editMessage(supabase, { messageId, userId: user.uid, content });
      await load({ silent: true });
    },
    [load, supabase, user]
  );

  const deleteHistoryForMe = useCallback(async () => {
    if (!supabase || !user || !conversation) throw new Error("Choose a conversation first.");
    await deleteConversationHistoryForMe(supabase, { conversationId: conversation.id, userId: user.uid });
    await load({ silent: true });
  }, [conversation, load, supabase, user]);

  const deleteRangeForMe = useCallback(
    async (from: string, to: string) => {
      if (!supabase || !user || !conversation) throw new Error("Choose a conversation first.");
      await deleteMessageRangeForMe(supabase, { conversationId: conversation.id, userId: user.uid, from, to });
      await load({ silent: true });
    },
    [conversation, load, supabase, user]
  );

  const shareMessageToTarget = useCallback(
    async (message: Message, shareTarget: ChatTarget) => {
      if (!supabase || !user) throw new Error("Sign in to share messages.");
      const destination =
        shareTarget.kind === "direct"
          ? await getOrCreateConversation(supabase, user.uid, shareTarget.friend.id)
          : shareTarget.conversation;
      await shareMessageToConversation(supabase, {
        sourceMessage: message,
        conversationId: destination.id,
        senderId: user.uid
      });
      if (destination.id === conversation?.id) await load({ silent: true });
    },
    [conversation?.id, load, supabase, user]
  );

  return useMemo(
    () => ({
      conversation,
      messages,
      loading,
      uploadProgress,
      sendText,
      sendFile,
      getDownloadUrl,
      reactToMessage,
      removeMessageForMe,
      removeMessageForEveryone,
      editTextMessage,
      deleteHistoryForMe,
      deleteRangeForMe,
      shareMessageToTarget,
      reload: load
    }),
    [
      conversation,
      deleteHistoryForMe,
      deleteRangeForMe,
      editTextMessage,
      getDownloadUrl,
      loading,
      load,
      messages,
      reactToMessage,
      removeMessageForEveryone,
      removeMessageForMe,
      sendFile,
      sendText,
      shareMessageToTarget,
      uploadProgress
    ]
  );
}
