"use client";

import { ChevronDown, Info, Phone, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/auth-provider";
import { MessageComposer } from "@/features/chats/message-composer";
import { MessageList } from "@/features/chats/message-list";
import { GroupInfoPanel } from "@/features/groups/group-info-panel";
import { useCalls } from "@/features/calls/call-provider";
import { useGroupCalls } from "@/features/group-calls/group-call-provider";
import { useChat } from "@/hooks/use-chat";
import { formatRelativePresence } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { CallSession, UserProfile } from "@/types";

export function ChatPanel() {
  const { user, supabase } = useAuth();
  const target = useAppStore((state) => state.selectedChat);
  const chat = useChat(target);
  const { startCall, status } = useCalls();
  const { joinGroupCall, status: groupCallStatus } = useGroupCalls();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [recentCalls, setRecentCalls] = useState<CallSession[]>([]);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const directFriend = target?.kind === "direct" ? target.friend : null;
  const group = target?.kind === "group" ? target.conversation : null;
  const chatTitle = directFriend?.full_name ?? group?.title ?? "Conversation";
  const chatAvatar = directFriend?.avatar_url ?? group?.avatar_url ?? null;
  const groupMembers = group?.members;
  const fallbackProfile: UserProfile = {
    id: group?.id ?? "group",
    full_name: chatTitle,
    email: "",
    avatar_url: chatAvatar,
    status: "offline",
    last_seen: null,
    created_at: "",
    updated_at: ""
  };
  const senderProfiles = useMemo(() => {
    if (!groupMembers) return undefined;
    return new Map(groupMembers.flatMap((member) => (member.profile ? [[member.user_id, member.profile] as const] : [])));
  }, [groupMembers]);

  function scrollToLatest(behavior: ScrollBehavior = "smooth") {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior });
  }

  function updateScrollButton() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    setShowScrollButton(distanceFromBottom > 180);
  }

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceFromBottom < 320) scrollToLatest();
    window.setTimeout(updateScrollButton, 50);
  }, [chat.messages.length]);

  const loadRecentCalls = useCallback(async () => {
    if (!supabase || !chat.conversation) {
      setRecentCalls([]);
      return;
    }
    const { data } = await supabase
      .from("call_sessions")
      .select("*")
      .eq("conversation_id", chat.conversation.id)
      .order("started_at", { ascending: false })
      .limit(3)
      .returns<CallSession[]>();
    setRecentCalls(data ?? []);
  }, [chat.conversation, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRecentCalls(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRecentCalls, status]);

  if (!target || !user) {
    return (
      <section className="flex h-full min-h-0 flex-1 items-center justify-center">
        <div className="max-w-sm text-center">
          <h2 className="text-2xl font-semibold text-ink dark:text-white">Choose a conversation</h2>
          <p className="mt-2 text-sm text-ink/60 dark:text-white/60">Search for a friend by email or open an existing chat.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-line bg-paper/80 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-neutral-950/80">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={chatTitle} src={chatAvatar} />
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-ink dark:text-white">{chatTitle}</h2>
            <p className="truncate text-xs text-ink/55 dark:text-white/55">
              {directFriend ? (directFriend.status === "online" ? "Online" : formatRelativePresence(directFriend.last_seen)) : `${group?.members?.length ?? 0} members`}
            </p>
            {recentCalls.length ? (
              <div className="mt-1 flex max-w-[42vw] gap-1 overflow-hidden">
                {recentCalls.map((call) => (
                  <span key={call.id} className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] capitalize text-ink/55 dark:bg-white/10 dark:text-white/55">
                    {call.mode} {call.status}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {directFriend ? (
            <>
              <Button variant="ghost" className="h-10 w-10 px-0" disabled={!chat.conversation || status !== "idle"} onClick={() => chat.conversation && void startCall(directFriend, chat.conversation.id, "audio")} aria-label="Start audio call">
                <Phone className="h-5 w-5" />
              </Button>
              <Button variant="ghost" className="h-10 w-10 px-0" disabled={!chat.conversation || status !== "idle"} onClick={() => chat.conversation && void startCall(directFriend, chat.conversation.id, "video")} aria-label="Start video call">
                <Video className="h-5 w-5" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" className="h-10 w-10 px-0" disabled={!group || groupCallStatus !== "idle"} onClick={() => group && void joinGroupCall(group, "audio")} aria-label="Start group audio call">
                <Phone className="h-5 w-5" />
              </Button>
              <Button variant="ghost" className="h-10 w-10 px-0" disabled={!group || groupCallStatus !== "idle"} onClick={() => group && void joinGroupCall(group, "video")} aria-label="Start group video call">
                <Video className="h-5 w-5" />
              </Button>
              <Button variant="ghost" className="h-10 w-10 px-0" onClick={() => setGroupInfoOpen(true)} aria-label="Open group info">
                <Info className="h-5 w-5" />
              </Button>
            </>
          )}
        </div>
      </header>

      <div ref={scrollerRef} onScroll={updateScrollButton} className="relative min-h-0 flex-1 overflow-y-auto">
        {chat.loading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="ml-auto h-12 w-1/2" />
            <Skeleton className="h-20 w-3/5" />
          </div>
        ) : (
          <MessageList messages={chat.messages} currentUserId={user.uid} friend={directFriend ?? fallbackProfile} showSenderNames={Boolean(group)} senderProfiles={senderProfiles} getDownloadUrl={chat.getDownloadUrl} />
        )}
        {showScrollButton ? (
          <Button
            type="button"
            variant="secondary"
            className="sticky bottom-4 left-1/2 z-10 h-9 -translate-x-1/2 px-3 shadow-soft"
            onClick={() => scrollToLatest()}
            aria-label="Scroll to latest message"
          >
            <ChevronDown className="h-4 w-4" />
            Latest
          </Button>
        ) : null}
      </div>

      <MessageComposer disabled={!chat.conversation} uploadProgress={chat.uploadProgress} onSendText={chat.sendText} onSendFile={chat.sendFile} />
      {group ? <GroupInfoPanel group={group} open={groupInfoOpen} onClose={() => setGroupInfoOpen(false)} /> : null}
    </section>
  );
}
