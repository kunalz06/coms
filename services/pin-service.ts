import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationPin } from "@/types";

function isMissingPinsTable(error: { code?: string; message?: string } | null) {
  return Boolean(
    error &&
      (error.code === "42P01" ||
        error.code === "PGRST205" ||
        error.message?.includes("conversation_pins"))
  );
}

export async function getConversationPins(supabase: SupabaseClient, userId: string, conversationIds: string[]) {
  const uniqueIds = Array.from(new Set(conversationIds));
  if (!uniqueIds.length) return new Map<string, string>();

  const { data, error } = await supabase
    .from("conversation_pins")
    .select("*")
    .eq("user_id", userId)
    .in("conversation_id", uniqueIds)
    .returns<ConversationPin[]>();
  if (isMissingPinsTable(error)) return new Map<string, string>();
  if (error) throw error;

  return new Map(data.map((pin) => [pin.conversation_id, pin.created_at]));
}

export async function setConversationPinned(supabase: SupabaseClient, userId: string, conversationId: string, pinned: boolean) {
  if (pinned) {
    const { error } = await supabase
      .from("conversation_pins")
      .upsert({ user_id: userId, conversation_id: conversationId }, { onConflict: "user_id,conversation_id", ignoreDuplicates: true });
    if (isMissingPinsTable(error)) throw new Error("Run the latest Supabase schema before pinning chats.");
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("conversation_pins")
    .delete()
    .eq("user_id", userId)
    .eq("conversation_id", conversationId);
  if (isMissingPinsTable(error)) throw new Error("Run the latest Supabase schema before pinning chats.");
  if (error) throw error;
}
