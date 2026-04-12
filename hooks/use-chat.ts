"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getMessages, getOrCreateConversation, markConversationRead, sendMessage } from "@/services/chat-service";
import { uploadToCloudinary, type CloudinaryUploadResult } from "@/services/upload-service";
import type { ChatTarget, Conversation, Message, MessageKind, UploadKind } from "@/types";
import { useAuth } from "@/features/auth/auth-provider";

const REFRESH_INTERVAL_MS = 10_000;

export function useChat(target: ChatTarget | null) {
  const { user, supabase, getIdToken } = useAuth();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const conversationId = conversation?.id ?? null;

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
      setMessages(nextMessages);
      await markConversationRead(supabase, nextConversation.id, user.uid);
      window.dispatchEvent(new CustomEvent("comms:messages-read", { detail: { conversationId: nextConversation.id } }));
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [supabase, target, user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!supabase || !conversationId) return;
    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, () => void load({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "message_attachments" }, () => void load({ silent: true }))
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        attachments: []
      };
      setMessages((items) => [...items, optimistic]);
      try {
        await sendMessage(supabase, { conversationId: conversation.id, senderId: user.uid, kind: "text", content: trimmed });
        await load({ silent: true });
      } catch (error) {
        setMessages((items) => items.map((item) => (item.id === optimistic.id ? { ...item, status: "failed" } : item)));
        throw error;
      }
    },
    [conversation, load, supabase, user]
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
        await sendMessage(supabase, {
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
        await load({ silent: true });
      } finally {
        setUploadProgress(0);
      }
    },
    [conversation, getIdToken, load, supabase, user]
  );

  const getDownloadUrl = useCallback(
    async (url: string) => {
      const token = await getIdToken();
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

  return useMemo(
    () => ({ conversation, messages, loading, uploadProgress, sendText, sendFile, getDownloadUrl, reload: load }),
    [conversation, getDownloadUrl, loading, load, messages, sendFile, sendText, uploadProgress]
  );
}
