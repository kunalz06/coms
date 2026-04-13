import type { SupabaseClient } from "@supabase/supabase-js";
import type { Conversation, ConversationMute, NotificationSettings, UserProfile } from "@/types";

export function isNotificationStorageMissingError(error: unknown) {
  const candidate = error as { code?: string; message?: string; details?: string; status?: number } | null;
  const message = `${candidate?.message ?? ""} ${candidate?.details ?? ""}`.toLowerCase();
  const tableMentioned = message.includes("notification_settings") || message.includes("conversation_mutes") || message.includes("push_subscriptions");

  return (
    candidate?.code === "PGRST205" ||
    candidate?.code === "42P01" ||
    candidate?.status === 404 ||
    (tableMentioned && (message.includes("schema cache") || message.includes("does not exist") || message.includes("could not find")))
  );
}

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

export async function savePushSubscription(supabase: SupabaseClient, values: { userId: string; subscription: PushSubscriptionJSON; userAgent?: string }) {
  const p256dh = values.subscription.keys?.p256dh;
  const auth = values.subscription.keys?.auth;
  if (!values.subscription.endpoint || !p256dh || !auth) throw new Error("Browser push subscription is incomplete.");

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: values.userId,
      endpoint: values.subscription.endpoint,
      p256dh,
      auth,
      user_agent: values.userAgent ?? null
    },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
}

export async function removePushSubscription(supabase: SupabaseClient, userId: string, endpoint: string) {
  const { error } = await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
  if (error) throw error;
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
