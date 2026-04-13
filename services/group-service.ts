import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationMember, GroupConversation, Message, UserProfile } from "@/types";

export const MAX_GROUP_MEMBERS = 10;

type CreateGroupValues = {
  title: string;
  avatarUrl?: string | null;
  ownerId: string;
  memberIds: string[];
};

async function attachGroupMetadata(supabase: SupabaseClient, group: GroupConversation, userId: string): Promise<GroupConversation> {
  const membersResult = await getGroupMembers(supabase, group.id);
  const myMembership = membersResult.find((member) => member.user_id === userId);
  let unreadQuery = supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", group.id)
    .neq("sender_id", userId);
  if (myMembership?.last_read_at) unreadQuery = unreadQuery.gt("created_at", myMembership.last_read_at);

  const [latestResult, unreadResult] = await Promise.all([
    supabase
      .from("messages")
      .select("*, attachments:message_attachments(*)")
      .eq("conversation_id", group.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Message>(),
    unreadQuery
  ]);

  return {
    ...group,
    members: membersResult,
    latest_message: latestResult.data ?? null,
    unread_count: unreadResult.count ?? 0
  };
}

export async function getGroups(supabase: SupabaseClient, userId: string) {
  const { data: memberships, error } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId)
    .returns<Array<{ conversation_id: string }>>();
  if (error) throw error;
  const groupIds = memberships.map((membership) => membership.conversation_id);
  if (!groupIds.length) return [];

  const { data: groups, error: groupsError } = await supabase
    .from("conversations")
    .select("*")
    .eq("type", "group")
    .in("id", groupIds)
    .order("updated_at", { ascending: false })
    .returns<GroupConversation[]>();
  if (groupsError) throw groupsError;

  return Promise.all(groups.map((group) => attachGroupMetadata(supabase, group, userId)));
}

export async function getGroup(supabase: SupabaseClient, conversationId: string, userId: string) {
  const { data: group, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("type", "group")
    .single<GroupConversation>();
  if (error) throw error;
  return attachGroupMetadata(supabase, group, userId);
}

export async function getGroupMembers(supabase: SupabaseClient, conversationId: string) {
  const { data: members, error } = await supabase
    .from("conversation_members")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("joined_at", { ascending: true })
    .returns<ConversationMember[]>();
  if (error) throw error;
  if (!members.length) return [];

  const { data: profiles, error: profileError } = await supabase.from("user_profiles").select("*").in("id", members.map((member) => member.user_id)).returns<UserProfile[]>();
  if (profileError) throw profileError;
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  return members.map((member) => ({ ...member, profile: profileMap.get(member.user_id) }));
}

export async function createGroup(supabase: SupabaseClient, values: CreateGroupValues) {
  const memberIds = Array.from(new Set([values.ownerId, ...values.memberIds]));
  if (memberIds.length < 2) throw new Error("Add at least one other member.");
  if (memberIds.length > MAX_GROUP_MEMBERS) throw new Error(`Groups are limited to ${MAX_GROUP_MEMBERS} people for now.`);

  const { data: conversation, error } = await supabase
    .from("conversations")
    .insert({
      type: "group",
      title: values.title.trim(),
      avatar_url: values.avatarUrl ?? null,
      created_by: values.ownerId
    })
    .select("*")
    .single<GroupConversation>();
  if (error) throw error;

  const { error: memberError } = await supabase.from("conversation_members").insert(
    memberIds.map((memberId) => ({
      conversation_id: conversation.id,
      user_id: memberId,
      role: memberId === values.ownerId ? "owner" : "member"
    }))
  );
  if (memberError) throw memberError;
  return attachGroupMetadata(supabase, conversation, values.ownerId);
}

export async function updateGroup(supabase: SupabaseClient, conversationId: string, values: { title?: string; avatar_url?: string | null }) {
  const { error } = await supabase.from("conversations").update(values).eq("id", conversationId).eq("type", "group");
  if (error) throw error;
}

export async function addGroupMember(supabase: SupabaseClient, conversationId: string, userId: string) {
  const members = await getGroupMembers(supabase, conversationId);
  if (members.length >= MAX_GROUP_MEMBERS) throw new Error(`Groups are limited to ${MAX_GROUP_MEMBERS} people for now.`);
  const { error } = await supabase.from("conversation_members").insert({ conversation_id: conversationId, user_id: userId, role: "member" });
  if (error) throw error;
}

export async function removeGroupMember(supabase: SupabaseClient, conversationId: string, userId: string) {
  const { error } = await supabase.from("conversation_members").delete().eq("conversation_id", conversationId).eq("user_id", userId);
  if (error) throw error;
}

export async function updateGroupMemberRole(supabase: SupabaseClient, conversationId: string, userId: string, role: "admin" | "member") {
  const { error } = await supabase.from("conversation_members").update({ role }).eq("conversation_id", conversationId).eq("user_id", userId);
  if (error) throw error;
}

export async function deleteGroup(supabase: SupabaseClient, conversationId: string) {
  const { error } = await supabase.from("conversations").delete().eq("id", conversationId).eq("type", "group");
  if (error) throw error;
}
