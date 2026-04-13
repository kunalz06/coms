"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { addFriendByEmail, blockUser, deleteFriend, getBlockedContacts, getFriends, unblockUser } from "@/services/contact-service";
import { setConversationPinned } from "@/services/pin-service";
import { searchProfileByEmail } from "@/services/profile-service";
import type { Block, Friendship, UserProfile } from "@/types";
import { useAuth } from "@/features/auth/auth-provider";

const REFRESH_INTERVAL_MS = 10_000;

export function useContacts() {
  const { user, supabase } = useAuth();
  const hookId = useId();
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [blocked, setBlocked] = useState<Array<Block & { blocked_profile?: UserProfile }>>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!user || !supabase) return;
    if (!options?.silent) setLoading(true);
    try {
      const [nextFriends, nextBlocked] = await Promise.all([getFriends(supabase, user.uid), getBlockedContacts(supabase, user.uid)]);
      setFriends(nextFriends.filter((item) => item.friend));
      setBlocked(nextBlocked);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [supabase, user]);

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
    const interval = window.setInterval(() => {
      void refresh({ silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh, supabase, user]);

  useEffect(() => {
    if (!supabase || !user) return;
    const safeHookId = hookId.replace(/[^a-zA-Z0-9_-]/g, "");
    const channel = supabase
      .channel(`contacts:${user.uid}:${safeHookId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => void refresh({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "blocks" }, () => void refresh({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => void refresh({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_pins", filter: `user_id=eq.${user.uid}` }, () => void refresh({ silent: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "user_profiles" }, () => void refresh({ silent: true }))
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hookId, refresh, supabase, user]);

  const search = useCallback(
    async (email: string) => {
      if (!supabase) return null;
      return searchProfileByEmail(supabase, email);
    },
    [supabase]
  );

  const addFriend = useCallback(
    async (email: string) => {
      if (!supabase || !user) throw new Error("You are not signed in.");
      const profile = await addFriendByEmail(supabase, user.uid, email);
      await refresh();
      return profile;
    },
    [refresh, supabase, user]
  );

  const removeFriend = useCallback(
    async (friendshipId: string) => {
      if (!supabase) return;
      await deleteFriend(supabase, friendshipId);
      await refresh();
    },
    [refresh, supabase]
  );

  const block = useCallback(
    async (target: UserProfile) => {
      if (!supabase || !user) return;
      await blockUser(supabase, user.uid, target);
      await refresh();
    },
    [refresh, supabase, user]
  );

  const unblock = useCallback(
    async (blockedId: string) => {
      if (!supabase || !user) return;
      await unblockUser(supabase, user.uid, blockedId);
      await refresh();
    },
    [refresh, supabase, user]
  );

  const togglePin = useCallback(
    async (conversationId: string, pinned: boolean) => {
      if (!supabase || !user) return;
      await setConversationPinned(supabase, user.uid, conversationId, pinned);
      await refresh({ silent: true });
    },
    [refresh, supabase, user]
  );

  return { friends, blocked, loading, refresh, search, addFriend, removeFriend, block, unblock, togglePin };
}
