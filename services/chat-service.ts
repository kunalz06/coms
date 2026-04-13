import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attachment, Conversation, Message, MessageKind, MessageReaction, MessageReactionKind, UserProfile } from "@/types";

export async function getOrCreateConversation(supabase: SupabaseClient, userId: string, friendId: string): Promise<Conversation> {
  const pairFilter = `and(user_one_id.eq.${userId},user_two_id.eq.${friendId}),and(user_one_id.eq.${friendId},user_two_id.eq.${userId})`;
  const { data: existing, error } = await supabase.from("conversations").select("*").or(pairFilter).maybeSingle<Conversation>();
  if (error) throw error;
  if (existing) return existing;

  const { data: rpcConversation, error: rpcError } = await supabase.rpc("get_or_create_direct_conversation", { other_user_id: friendId }).single<Conversation>();
  if (rpcConversation && !rpcError) return rpcConversation;
  if (rpcError && rpcError.code !== "PGRST202") throw rpcError;

  const [user_one_id, user_two_id] = [userId, friendId].sort();
  const { data, error: insertError } = await supabase
    .from("conversations")
    .insert({ type: "direct", user_one_id, user_two_id })
    .select("*")
    .single<Conversation>();
  if (insertError) {
    const { data: retry, error: retryError } = await supabase.from("conversations").select("*").or(pairFilter).single<Conversation>();
    if (retryError) throw insertError;
    return retry;
  }
  return data;
}

export async function getMessages(supabase: SupabaseClient, conversationId: string) {
  const { data, error } = await supabase
    .from("messages")
    .select("*, attachments:message_attachments(*), reactions:message_reactions(*)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .returns<Message[]>();
  if (error) throw error;

  const reactorIds = Array.from(new Set(data.flatMap((message) => message.reactions?.map((reaction) => reaction.user_id) ?? [])));
  if (!reactorIds.length) return data;

  const { data: profiles, error: profileError } = await supabase.from("user_profiles").select("*").in("id", reactorIds).returns<UserProfile[]>();
  if (profileError) throw profileError;
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

  return data.map((message) => ({
    ...message,
    reactions: message.reactions?.map((reaction) => ({ ...reaction, profile: profileMap.get(reaction.user_id) }))
  }));
}

export async function sendMessage(
  supabase: SupabaseClient,
  values: {
    conversationId: string;
    senderId: string;
    kind: MessageKind;
    content?: string | null;
    attachment?: Omit<Attachment, "id" | "message_id" | "created_at">;
  }
) {
  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: values.conversationId,
      sender_id: values.senderId,
      kind: values.kind,
      content: values.content ?? null,
      status: "sent"
    })
    .select("*")
    .single<Message>();
  if (error) throw error;

  if (values.attachment) {
    const { error: attachmentError } = await supabase.from("message_attachments").insert({
      ...values.attachment,
      message_id: message.id
    });
    if (attachmentError) {
      await supabase.from("messages").update({ status: "failed" }).eq("id", message.id);
      throw attachmentError;
    }
  }

  return message;
}

export async function markConversationRead(supabase: SupabaseClient, conversationId: string, userId: string) {
  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .select("type")
    .eq("id", conversationId)
    .single<{ type: "direct" | "group" }>();
  if (conversationError) throw conversationError;

  if (conversation.type === "group") {
    const { error } = await supabase
      .from("conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("user_id", userId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("messages")
    .update({ status: "read" })
    .eq("conversation_id", conversationId)
    .neq("sender_id", userId)
    .in("status", ["sent", "delivered"]);
  if (error) throw error;
}

function normalizeReaction(kind: MessageReactionKind, content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("Reaction cannot be empty.");
  if (normalized.length > 80) throw new Error("Reactions must be 80 characters or fewer.");
  if (kind === "emoji" && normalized.length > 16) throw new Error("Use a shorter emoji reaction.");
  return normalized;
}

export async function toggleMessageReaction(
  supabase: SupabaseClient,
  values: {
    messageId: string;
    userId: string;
    kind: MessageReactionKind;
    content: string;
  }
) {
  const content = normalizeReaction(values.kind, values.content);
  const { data: existing, error: findError } = await supabase
    .from("message_reactions")
    .select("*")
    .eq("message_id", values.messageId)
    .eq("user_id", values.userId)
    .eq("kind", values.kind)
    .eq("content", content)
    .maybeSingle<MessageReaction>();
  if (findError) throw findError;

  if (existing) {
    const { error } = await supabase.from("message_reactions").delete().eq("id", existing.id);
    if (error) throw error;
    return null;
  }

  const { data, error } = await supabase
    .from("message_reactions")
    .insert({ message_id: values.messageId, user_id: values.userId, kind: values.kind, content })
    .select("*")
    .single<MessageReaction>();
  if (error) throw error;
  return data;
}

async function deleteMessagesForMe(supabase: SupabaseClient, userId: string, messageIds: string[]) {
  const uniqueMessageIds = Array.from(new Set(messageIds));
  if (!uniqueMessageIds.length) return;
  const { error } = await supabase
    .from("message_deletions")
    .upsert(
      uniqueMessageIds.map((messageId) => ({ message_id: messageId, user_id: userId })),
      { onConflict: "message_id,user_id", ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function deleteMessageForMe(supabase: SupabaseClient, values: { messageId: string; userId: string }) {
  await deleteMessagesForMe(supabase, values.userId, [values.messageId]);
}

export async function deleteConversationHistoryForMe(supabase: SupabaseClient, values: { conversationId: string; userId: string }) {
  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", values.conversationId)
    .returns<Array<{ id: string }>>();
  if (error) throw error;
  await deleteMessagesForMe(supabase, values.userId, data.map((message) => message.id));
}

export async function deleteMessageRangeForMe(
  supabase: SupabaseClient,
  values: {
    conversationId: string;
    userId: string;
    from: string;
    to: string;
  }
) {
  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", values.conversationId)
    .gte("created_at", values.from)
    .lte("created_at", values.to)
    .returns<Array<{ id: string }>>();
  if (error) throw error;
  await deleteMessagesForMe(supabase, values.userId, data.map((message) => message.id));
}

export async function deleteMessageForEveryone(supabase: SupabaseClient, values: { messageId: string; userId: string }) {
  const { error } = await supabase
    .from("messages")
    .update({
      deleted_for_everyone_at: new Date().toISOString(),
      deleted_by: values.userId,
      content: null
    })
    .eq("id", values.messageId)
    .eq("sender_id", values.userId);
  if (error) throw error;
}
