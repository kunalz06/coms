"use client";

import { Ban, LogOut, Pin, Plus, Search, Settings, Trash2, UserPlus, Users } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/features/auth/auth-provider";
import { SettingsPanel } from "@/features/settings/settings-panel";
import { CreateGroupModal } from "@/features/groups/create-group-modal";
import { useContacts } from "@/hooks/use-contacts";
import { useDebounce } from "@/hooks/use-debounce";
import { useGroups } from "@/hooks/use-groups";
import { formatRelativePresence } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { UserProfile } from "@/types";

export function ContactsSidebar() {
  const { profile, signOut } = useAuth();
  const { friends, loading, search, addFriend, removeFriend, block, blocked, unblock, togglePin: toggleFriendPin } = useContacts();
  const groups = useGroups();
  const { showToast } = useToast();
  const selectedFriend = useAppStore((state) => state.selectedFriend);
  const setSelectedFriend = useAppStore((state) => state.setSelectedFriend);
  const selectedChat = useAppStore((state) => state.selectedChat);
  const setSelectedChat = useAppStore((state) => state.setSelectedChat);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<UserProfile | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [chatFilter, setChatFilter] = useState<"all" | "direct" | "groups">("all");
  const debounced = useDebounce(query, 400);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleFriends = useMemo(
    () =>
      normalizedQuery
        ? friends.filter((friendship) => {
            const friend = friendship.friend;
            return friend?.full_name.toLowerCase().includes(normalizedQuery) || friend?.email.toLowerCase().includes(normalizedQuery);
          })
        : friends,
    [friends, normalizedQuery]
  );
  const visibleGroups = useMemo(
    () => (normalizedQuery ? groups.groups.filter((group) => group.title?.toLowerCase().includes(normalizedQuery)) : groups.groups),
    [groups.groups, normalizedQuery]
  );
  const visibleChats = useMemo(() => {
    const chats = [
      ...visibleFriends.map((friendship) => ({ kind: "direct" as const, friendship })),
      ...visibleGroups.map((group) => ({ kind: "group" as const, group }))
    ];
    return chats.sort((a, b) => {
      const aPinned = a.kind === "direct" ? a.friendship.pinned_at : a.group.pinned_at;
      const bPinned = b.kind === "direct" ? b.friendship.pinned_at : b.group.pinned_at;
      const pinned = Number(Boolean(bPinned)) - Number(Boolean(aPinned));
      if (pinned) return pinned;
      const aUnread = a.kind === "direct" ? a.friendship.unread_count ?? 0 : a.group.unread_count ?? 0;
      const bUnread = b.kind === "direct" ? b.friendship.unread_count ?? 0 : b.group.unread_count ?? 0;
      const unread = Number(bUnread > 0) - Number(aUnread > 0);
      if (unread) return unread;
      const aTime = a.kind === "direct" ? a.friendship.latest_message?.created_at ?? a.friendship.updated_at : a.group.latest_message?.created_at ?? a.group.last_message_at ?? a.group.updated_at;
      const bTime = b.kind === "direct" ? b.friendship.latest_message?.created_at ?? b.friendship.updated_at : b.group.latest_message?.created_at ?? b.group.last_message_at ?? b.group.updated_at;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  }, [visibleFriends, visibleGroups]);
  const visibleChatCount = chatFilter === "all" ? visibleChats.length : chatFilter === "direct" ? visibleFriends.length : visibleGroups.length;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!debounced.includes("@")) {
        setResult(null);
        return;
      }
      const found = await search(debounced).catch(() => null);
      if (!cancelled) setResult(found);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [debounced, search]);

  async function onAddFriend() {
    if (!result) return;
    try {
      await addFriend(result.email);
      showToast({ variant: "success", title: "Friend added", description: `${result.full_name} is ready to chat.` });
      setQuery("");
      setResult(null);
    } catch (error) {
      showToast({ variant: "error", title: "Could not add friend", description: error instanceof Error ? error.message : "Try again." });
    }
  }

  async function onBlock(friend: UserProfile) {
    await block(friend);
    if (selectedFriend?.id === friend.id) setSelectedFriend(null);
    showToast({ variant: "success", title: "Contact blocked", description: "Messages and calls are stopped in COMMS." });
  }

  function selectFriendFromKeyboard(event: KeyboardEvent<HTMLDivElement>, friend: UserProfile) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedFriend(friend);
    }
  }

  const renderFriendship = (friendship: (typeof friends)[number]) => {
    const friend = friendship.friend;
    if (!friend) return null;
    const active = selectedChat?.kind === "direct" && selectedFriend?.id === friend.id;
    return (
      <div
        key={friendship.id}
        role="button"
        tabIndex={0}
        onClick={() => setSelectedFriend(friend)}
        onKeyDown={(event) => selectFriendFromKeyboard(event, friend)}
        className={`group w-full rounded-lg border p-3 text-left transition ${
          active ? "border-moss bg-moss/10" : "border-transparent hover:border-line hover:bg-white/60 dark:hover:border-white/10 dark:hover:bg-white/10"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar name={friend.full_name} src={friend.avatar_url} />
            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-paper ${friend.status === "online" ? "bg-moss" : "bg-ink/30"}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-ink dark:text-white">{friend.full_name}</p>
              <div className="flex shrink-0 items-center gap-1">
                {friendship.pinned_at ? <Pin className="h-3.5 w-3.5 fill-current text-moss dark:text-emerald-300" /> : null}
                {friendship.unread_count ? <span className="rounded-full bg-coral px-2 py-0.5 text-xs text-white">{friendship.unread_count}</span> : null}
              </div>
            </div>
            <p className="truncate text-xs text-ink/55 dark:text-white/55">{friendship.latest_message?.content || formatRelativePresence(friend.last_seen)}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 sm:hidden sm:group-hover:flex sm:group-focus-within:flex">
          <Button
            variant="ghost"
            className="h-8 px-2"
            onClick={(event) => {
              event.stopPropagation();
              if (friendship.conversation_id) {
                void toggleFriendPin(friendship.conversation_id, !friendship.pinned_at).catch((error) => {
                  showToast({ variant: "error", title: "Could not update pin", description: error instanceof Error ? error.message : "Try again." });
                });
              }
            }}
          >
            <Pin className={`h-4 w-4 ${friendship.pinned_at ? "fill-current" : ""}`} />
            {friendship.pinned_at ? "Unpin" : "Pin"}
          </Button>
          <Button variant="ghost" className="h-8 px-2" onClick={(event) => { event.stopPropagation(); void removeFriend(friendship.id); }}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          <Button variant="ghost" className="h-8 px-2" onClick={(event) => { event.stopPropagation(); void onBlock(friend); }}>
            <Ban className="h-4 w-4" />
            Block
          </Button>
        </div>
      </div>
    );
  };

  const renderGroup = (group: (typeof groups.groups)[number]) => {
    const active = selectedChat?.kind === "group" && selectedChat.conversation.id === group.id;
    return (
      <div
        key={group.id}
        role="button"
        tabIndex={0}
        onClick={() => setSelectedChat({ kind: "group", conversation: group })}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelectedChat({ kind: "group", conversation: group });
          }
        }}
        className={`group w-full rounded-lg border p-3 text-left transition ${
          active ? "border-moss bg-moss/10" : "border-transparent hover:border-line hover:bg-white/60 dark:hover:border-white/10 dark:hover:bg-white/10"
        }`}
      >
        <div className="flex items-center gap-3">
          <Avatar name={group.title ?? "Group"} src={group.avatar_url} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-ink dark:text-white">{group.title}</p>
              <div className="flex shrink-0 items-center gap-1">
                {group.pinned_at ? <Pin className="h-3.5 w-3.5 fill-current text-moss dark:text-emerald-300" /> : null}
                {group.unread_count ? <span className="rounded-full bg-coral px-2 py-0.5 text-xs text-white">{group.unread_count}</span> : null}
              </div>
            </div>
            <p className="truncate text-xs text-ink/55 dark:text-white/55">
              {group.latest_message?.content || `${group.members?.length ?? 0} members`}
            </p>
          </div>
          <Users className="h-4 w-4 text-ink/40 dark:text-white/40" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 sm:hidden sm:group-hover:flex sm:group-focus-within:flex">
          <Button
            variant="ghost"
            className="h-8 px-2"
            onClick={(event) => {
              event.stopPropagation();
              void groups.togglePin(group.id, !group.pinned_at).catch((error) => {
                showToast({ variant: "error", title: "Could not update pin", description: error instanceof Error ? error.message : "Try again." });
              });
            }}
          >
            <Pin className={`h-4 w-4 ${group.pinned_at ? "fill-current" : ""}`} />
            {group.pinned_at ? "Unpin" : "Pin"}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <aside className={`${selectedChat ? "hidden md:flex" : "flex"} h-full min-h-0 flex-col border-r border-line/80 bg-paper/70 p-3 backdrop-blur dark:border-white/10 dark:bg-neutral-950/65 sm:p-4`}>
      <div className="mb-4">
        <p className="text-xs font-semibold tracking-[0.16em] text-moss dark:text-emerald-300">COMMS</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink dark:text-white">Messages</h1>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink/45 dark:text-white/45" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by email" className="pl-9" />
      </div>

      {result ? (
        <div className="mt-3 rounded-lg border border-line bg-white/70 p-3 dark:border-white/10 dark:bg-white/10">
          <div className="flex items-center gap-3">
            <Avatar name={result.full_name} src={result.avatar_url} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink dark:text-white">{result.full_name}</p>
              <p className="truncate text-xs text-ink/60 dark:text-white/60">{result.email}</p>
            </div>
          </div>
          <Button onClick={onAddFriend} className="mt-3 w-full" variant="secondary">
            <UserPlus className="h-4 w-4" />
            Add friend
          </Button>
        </div>
      ) : null}

      <div className="mt-5 flex-1 overflow-y-auto">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase text-ink/50 dark:text-white/45">Chats</p>
          <Button variant="ghost" className="h-8 px-2" onClick={() => setCreateGroupOpen(true)}>
            <Plus className="h-4 w-4" />
            Group
          </Button>
        </div>
        <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-ink/5 p-1 text-xs dark:bg-white/10">
          {(["all", "direct", "groups"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setChatFilter(filter)}
              className={`rounded-md px-2 py-1 capitalize transition ${chatFilter === filter ? "bg-white text-ink shadow-sm dark:bg-neutral-900 dark:text-white" : "text-ink/60 hover:text-ink dark:text-white/60 dark:hover:text-white"}`}
            >
              {filter}
            </button>
          ))}
        </div>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : visibleChatCount ? (
          <div className="space-y-2">
            {chatFilter === "all" ? visibleChats.map((chat) => (chat.kind === "direct" ? renderFriendship(chat.friendship) : renderGroup(chat.group))) : null}
            {chatFilter === "direct" ? visibleFriends.map((friendship) => renderFriendship(friendship)) : null}
            {chatFilter === "groups" ? visibleGroups.map((group) => renderGroup(group)) : null}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line p-4 text-sm text-ink/60 dark:border-white/10 dark:text-white/60">
            Search by email to add your first friend.
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-line bg-white/65 p-3 dark:border-white/10 dark:bg-white/10">
        {profile ? (
          <div className="mb-3 flex items-center gap-3">
            <Avatar name={profile.full_name} src={profile.avatar_url} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink dark:text-white">{profile.full_name}</p>
              <p className="truncate text-xs text-ink/60 dark:text-white/60">{profile.email}</p>
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setSettingsOpen(true)}><Settings className="h-4 w-4" /> Settings</Button>
          <Button variant="ghost" onClick={() => void signOut()}><LogOut className="h-4 w-4" /> Sign out</Button>
        </div>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} blocked={blocked} unblock={unblock} />
      <CreateGroupModal
        open={createGroupOpen}
        friends={friends}
        onClose={() => setCreateGroupOpen(false)}
        onCreate={groups.create}
        onCreated={(group) => setSelectedChat({ kind: "group", conversation: group })}
      />
    </aside>
  );
}
