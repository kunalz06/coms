import type { SupabaseClient } from "@supabase/supabase-js";
import type { Conversation, ConversationMute, NotificationSettings, UserProfile } from "@/types";

export async function getOrCreateNotificationSettings(supabase: SupabaseClient, userId: string) {
  const { data: existing, error } = await supabase
    .from("notification_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<NotificationSettings>();
  if (error) throw error;
  if (existing) return existing;

  const { data, error: insertError } = await supabase
    .from("notification_settings")
    .upsert({ user_id: userId }, { onConflict: "user_id" })
    .select("*")
    .single<NotificationSettings>();
  if (insertError) throw insertError;
  return data;
}

export async function updateNotificationSettings(
  supabase: SupabaseClient,
  userId: string,
  values: Partial<Pick<NotificationSettings, "browser_notifications_enabled" | "ringtone_enabled" | "notifications_prompted_at">>
) {
  const { data, error } = await supabase
    .from("notification_settings")
    .upsert({ user_id: userId, ...values }, { onConflict: "user_id" })
    .select("*")
    .single<NotificationSettings>();
  if (error) throw error;
  return data;
}

export async function getConversationMutes(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("conversation_mutes")
    .select("*")
    .eq("user_id", userId)
    .returns<ConversationMute[]>();
  if (error) throw error;
  return data;
}

export async function setConversationMute(supabase: SupabaseClient, userId: string, conversationId: string, muted: boolean) {
  if (!muted) {
    const { error } = await supabase.from("conversation_mutes").delete().eq("user_id", userId).eq("conversation_id", conversationId);
    if (error) throw error;
    return null;
  }

  const { data, error } = await supabase
    .from("conversation_mutes")
    .upsert({ user_id: userId, conversation_id: conversationId, muted_until: null }, { onConflict: "conversation_id,user_id" })
    .select("*")
    .single<ConversationMute>();
  if (error) throw error;
  return data;
}

export async function getConversationForNotification(supabase: SupabaseClient, conversationId: string) {
  const { data, error } = await supabase.from("conversations").select("*").eq("id", conversationId).single<Conversation>();
  if (error) throw error;
  return data;
}

export async function getUserProfileForNotification(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle<UserProfile>();
  if (error) throw error;
  return data;
}
