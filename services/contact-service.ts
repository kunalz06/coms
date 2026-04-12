import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block, Friendship, Message, UserProfile } from "@/types";
import { getOrCreateConversation } from "@/services/chat-service";
import { searchProfileByEmail } from "@/services/profile-service";

export async function getFriends(supabase: SupabaseClient, userId: string): Promise<Friendship[]> {
  const { data: friendships, error } = await supabase
    .from("friendships")
    .select("*")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .eq("status", "accepted")
    .order("updated_at", { ascending: false })
    .returns<Friendship[]>();
  if (error) throw error;

  const friendIds = friendships.map((friendship) => (friendship.requester_id === userId ? friendship.addressee_id : friendship.requester_id));
  if (!friendIds.length) return [];

  const { data: blocks, error: blockError } = await supabase.from("blocks").select("*").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`).returns<Block[]>();
  if (blockError) throw blockError;
  const blockedIds = new Set(blocks.flatMap((block) => [block.blocker_id, block.blocked_id]).filter((id) => id !== userId));

  const visibleFriendIds = friendIds.filter((id) => !blockedIds.has(id));
  if (!visibleFriendIds.length) return [];

  const { data: profiles, error: profileError } = await supabase.from("user_profiles").select("*").in("id", visibleFriendIds).returns<UserProfile[]>();
  if (profileError) throw profileError;
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

  return Promise.all(
    friendships
      .filter((friendship) => visibleFriendIds.includes(friendship.requester_id === userId ? friendship.addressee_id : friendship.requester_id))
      .map(async (friendship) => {
        const friendId = friendship.requester_id === userId ? friendship.addressee_id : friendship.requester_id;
        const conversation = await getOrCreateConversation(supabase, userId, friendId);
        const { data: latest } = await supabase
          .from("messages")
          .select("*, message_attachments(*)")
          .eq("conversation_id", conversation.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<Message>();
        const { count } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", conversation.id)
          .neq("sender_id", userId)
          .in("status", ["sent", "delivered"]);
        return {
          ...friendship,
          friend: profileMap.get(friendId),
          latest_message: latest ?? null,
          unread_count: count ?? 0
        };
      })
  );
}

export async function addFriendByEmail(supabase: SupabaseClient, userId: string, email: string) {
  const profile = await searchProfileByEmail(supabase, email);
  if (!profile) throw new Error("No COMMS user exists with that email.");
  if (profile.id === userId) throw new Error("You cannot add yourself.");

  const { data: block } = await supabase
    .from("blocks")
    .select("id")
    .or(`and(blocker_id.eq.${userId},blocked_id.eq.${profile.id}),and(blocker_id.eq.${profile.id},blocked_id.eq.${userId})`)
    .maybeSingle();
  if (block) throw new Error("This contact is blocked.");

  const { data: existing, error: findError } = await supabase
    .from("friendships")
    .select("*")
    .or(`and(requester_id.eq.${userId},addressee_id.eq.${profile.id}),and(requester_id.eq.${profile.id},addressee_id.eq.${userId})`)
    .maybeSingle<Friendship>();
  if (findError) throw findError;
  const { error } = existing
    ? await supabase.from("friendships").update({ status: "accepted" }).eq("id", existing.id)
    : await supabase.from("friendships").insert({ requester_id: userId, addressee_id: profile.id, status: "accepted" });
  if (error) throw error;
  await getOrCreateConversation(supabase, userId, profile.id);
  return profile;
}

export async function deleteFriend(supabase: SupabaseClient, friendshipId: string) {
  const { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
  if (error) throw error;
}

export async function blockUser(supabase: SupabaseClient, userId: string, target: UserProfile) {
  const { error } = await supabase.from("blocks").upsert({ blocker_id: userId, blocked_id: target.id }, { onConflict: "blocker_id,blocked_id" });
  if (error) throw error;
  await supabase.from("friendships").delete().or(`and(requester_id.eq.${userId},addressee_id.eq.${target.id}),and(requester_id.eq.${target.id},addressee_id.eq.${userId})`);
}

export async function unblockUser(supabase: SupabaseClient, userId: string, blockedId: string) {
  const { error } = await supabase.from("blocks").delete().eq("blocker_id", userId).eq("blocked_id", blockedId);
  if (error) throw error;
}

export async function getBlockedContacts(supabase: SupabaseClient, userId: string) {
  const { data: blocks, error } = await supabase.from("blocks").select("*").eq("blocker_id", userId).returns<Block[]>();
  if (error) throw error;
  if (!blocks.length) return [];
  const { data: profiles, error: profileError } = await supabase.from("user_profiles").select("*").in("id", blocks.map((block) => block.blocked_id)).returns<UserProfile[]>();
  if (profileError) throw profileError;
  const map = new Map(profiles.map((profile) => [profile.id, profile]));
  return blocks.map((block) => ({ ...block, blocked_profile: map.get(block.blocked_id) }));
}
