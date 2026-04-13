"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { addGroupMember, createGroup, deleteGroup, getGroups, removeGroupMember, updateGroup, updateGroupMemberRole } from "@/services/group-service";
import { setConversationPinned } from "@/services/pin-service";
import { searchProfileByEmail } from "@/services/profile-service";
import type { GroupConversation } from "@/types";
import { useAuth } from "@/features/auth/auth-provider";

export function useGroups() {
  const { user, supabase } = useAuth();
  const hookId = useId();
  const [groups, setGroups] = useState<GroupConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!user || !supabase) return;
      if (!options?.silent) setLoading(true);
      try {
        setGroups(await getGroups(supabase, user.uid));
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    [supabase, user]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onMessagesRead = () => void refresh({ silent: true });
    window.addEventListener("comms:messages-read", onMessagesRead);
    return () => window.removeEventListener("comms:messages-read", onMessagesRead);
  }, [refresh]);

  useEffect(() => {
    if (!supabase || !user) return;
    const safeHookId = hookId.replace(/[^a-zA-Z0-9_-]/g, "");
    const channel = supabase
      .channel(`groups:${user.uid}:${safeHookId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, () => void refresh({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => void refresh({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => void refresh({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_pins", filter: `user_id=eq.${user.uid}` }, () => void refresh({ silent: true }))
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hookId, refresh, supabase, user]);

  const create = useCallback(
    async (title: string, memberIds: string[], avatarUrl?: string | null) => {
      if (!supabase || !user) throw new Error("You are not signed in.");
      const group = await createGroup(supabase, { title, memberIds, avatarUrl, ownerId: user.uid });
      await refresh({ silent: true });
      return group;
    },
    [refresh, supabase, user]
  );

  const rename = useCallback(
    async (conversationId: string, title: string, avatarUrl?: string | null) => {
      if (!supabase) return;
      await updateGroup(supabase, conversationId, { title, avatar_url: avatarUrl });
      await refresh({ silent: true });
    },
    [refresh, supabase]
  );

  const leave = useCallback(
    async (conversationId: string) => {
      if (!supabase || !user) return;
      await removeGroupMember(supabase, conversationId, user.uid);
      await refresh({ silent: true });
    },
    [refresh, supabase, user]
  );

  const removeMember = useCallback(
    async (conversationId: string, userId: string) => {
      if (!supabase) return;
      await removeGroupMember(supabase, conversationId, userId);
      await refresh({ silent: true });
    },
    [refresh, supabase]
  );

  const addMemberByEmail = useCallback(
    async (conversationId: string, email: string) => {
      if (!supabase) throw new Error("Supabase is not ready.");
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) throw new Error("Enter an email address.");
      const profile = await searchProfileByEmail(supabase, normalizedEmail);
      if (!profile) throw new Error("No COMMS user exists with that email.");
      await addGroupMember(supabase, conversationId, profile.id);
      await refresh({ silent: true });
    },
    [refresh, supabase]
  );

  const setRole = useCallback(
    async (conversationId: string, userId: string, role: "admin" | "member") => {
      if (!supabase) return;
      await updateGroupMemberRole(supabase, conversationId, userId, role);
      await refresh({ silent: true });
    },
    [refresh, supabase]
  );

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      if (!supabase) return;
      await deleteGroup(supabase, conversationId);
      await refresh({ silent: true });
    },
    [refresh, supabase]
  );

  const togglePin = useCallback(
    async (conversationId: string, pinned: boolean) => {
      if (!supabase || !user) return;
      await setConversationPinned(supabase, user.uid, conversationId, pinned);
      await refresh({ silent: true });
    },
    [refresh, supabase, user]
  );

  return { groups, loading, refresh, create, rename, leave, addMemberByEmail, removeMember, setRole, deleteConversation, togglePin };
}
