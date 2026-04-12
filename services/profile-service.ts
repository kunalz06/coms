import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/types";

export async function upsertProfile(
  supabase: SupabaseClient,
  profile: Pick<UserProfile, "id" | "email" | "full_name"> & Partial<Pick<UserProfile, "avatar_url">>
) {
  const { error } = await supabase.from("user_profiles").upsert({
    id: profile.id,
    email: profile.email.toLowerCase(),
    full_name: profile.full_name,
    avatar_url: profile.avatar_url ?? null,
    status: "online",
    last_seen: new Date().toISOString()
  });
  if (error) throw error;
}

export async function getProfile(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle<UserProfile>();
  if (error) throw error;
  return data;
}

export async function searchProfileByEmail(supabase: SupabaseClient, email: string) {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle<UserProfile>();
  if (error) throw error;
  return data;
}

export async function updateProfile(supabase: SupabaseClient, userId: string, values: Partial<Pick<UserProfile, "email" | "full_name" | "avatar_url" | "status" | "last_seen">>) {
  const { error } = await supabase.from("user_profiles").update(values).eq("id", userId);
  if (error) throw error;
}

export async function setPresence(supabase: SupabaseClient, userId: string, status: "online" | "offline") {
  const lastSeen = new Date().toISOString();
  await updateProfile(supabase, userId, { status, last_seen: lastSeen });
  await supabase.from("presence_events").insert({ user_id: userId, status });
}
