import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attachment, Conversation, Message, MessageKind } from "@/types";

export async function getOrCreateConversation(supabase: SupabaseClient, userId: string, friendId: string): Promise<Conversation> {
  const pairFilter = `and(user_one_id.eq.${userId},user_two_id.eq.${friendId}),and(user_one_id.eq.${friendId},user_two_id.eq.${userId})`;
  const { data: existing, error } = await supabase.from("conversations").select("*").or(pairFilter).maybeSingle<Conversation>();
  if (error) throw error;
  if (existing) return existing;

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
    .select("*, attachments:message_attachments(*)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .returns<Message[]>();
  if (error) throw error;
  return data;
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
