"use client";

import dynamic from "next/dynamic";
import { PhoneOff, Users } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/features/auth/auth-provider";
import { signalingUrl } from "@/lib/signaling-url";
import { getGroup } from "@/services/group-service";
import type { CallMode, GroupConversation, UserProfile } from "@/types";

const JitsiMeeting = dynamic(() => import("@jitsi/react-sdk").then((module) => module.JitsiMeeting), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-white/65">Opening secure group room</div>
});

type GroupCallStatus = "idle" | "joining" | "connected" | "failed";
type GroupCallStartResponse = { mode: CallMode };
type GroupCallResponse = { type: "group-call-response"; requestId: string; ok: boolean; data?: unknown; error?: string };
type GroupCallEvent =
  | { type: "group-call-invite"; conversationId: string; from: string; mode: CallMode }
  | { type: "group-call-ended"; conversationId: string; userId: string };
type ActiveGroupCall = { conversation: GroupConversation; mode: CallMode; roomName: string };
type IncomingGroupCall = { conversation: GroupConversation; caller: UserProfile | null; mode: CallMode };
type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type GroupCallContextValue = {
  status: GroupCallStatus;
  active: ActiveGroupCall | null;
  joinGroupCall: (conversation: GroupConversation, mode: CallMode) => Promise<void>;
};

const GroupCallContext = createContext<GroupCallContextValue | null>(null);

function jitsiDomain() {
  return process.env.NEXT_PUBLIC_JITSI_DOMAIN || "meet.jit.si";
}

function roomNameFor(conversationId: string) {
  return `comms-group-${conversationId.replace(/[^a-zA-Z0-9]/g, "")}`;
}

function profileFor(group: GroupConversation | null, userId: string): UserProfile | undefined {
  return group?.members?.find((member) => member.user_id === userId)?.profile;
}

export function GroupCallProvider({ children }: { children: ReactNode }) {
  const { user, profile, supabase } = useAuth();
  const { showToast } = useToast();
  const socketRef = useRef<WebSocket | null>(null);
  const shouldReconnectRef = useRef(true);
  const pendingRequestsRef = useRef(new Map<string, PendingRequest>());
  const activeRef = useRef<ActiveGroupCall | null>(null);
  const [status, setStatus] = useState<GroupCallStatus>("idle");
  const [active, setActive] = useState<ActiveGroupCall | null>(null);
  const [incoming, setIncoming] = useState<IncomingGroupCall | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const sendMessage = useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Group call signaling is not connected.");
    socket.send(JSON.stringify(payload));
  }, []);

  const sendRequest = useCallback(
    async <T,>(type: string, payload: Record<string, unknown>) => {
      if (!user) throw new Error("Sign in before joining a group call.");
      const requestId = crypto.randomUUID();
      const promise = new Promise<T>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          pendingRequestsRef.current.delete(requestId);
          reject(new Error("Group call request timed out."));
        }, 10_000);
        pendingRequestsRef.current.set(requestId, {
          resolve: (value) => {
            window.clearTimeout(timeout);
            resolve(value as T);
          },
          reject: (error) => {
            window.clearTimeout(timeout);
            reject(error);
          }
        });
      });
      sendMessage({ type, requestId, from: user.uid, ...payload });
      return promise;
    },
    [sendMessage, user]
  );

  const cleanup = useCallback(
    async (notify = true) => {
      const current = activeRef.current;
      if (notify && current) {
        try {
          await sendRequest("group-call-leave", { conversationId: current.conversation.id });
        } catch {
          // The Jitsi room may already have closed; local cleanup still needs to complete.
        }
      }
      setActive(null);
      activeRef.current = null;
      setStatus("idle");
    },
    [sendRequest]
  );

  const handleIncomingInvite = useCallback(
    async (message: Extract<GroupCallEvent, { type: "group-call-invite" }>) => {
      if (!supabase || !user || message.from === user.uid || activeRef.current) return;
      try {
        const conversation = await getGroup(supabase, message.conversationId, user.uid);
        const caller = profileFor(conversation, message.from) ?? null;
        setIncoming({ conversation, caller, mode: message.mode });
      } catch {
        showToast({ variant: "error", title: "Group call unavailable", description: "Could not load the group details for this call." });
      }
    },
    [showToast, supabase, user]
  );

  const handleSocketMessage = useCallback(
    (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as GroupCallResponse | GroupCallEvent;
      if (message.type === "group-call-response") {
        const pending = pendingRequestsRef.current.get(message.requestId);
        if (!pending) return;
        pendingRequestsRef.current.delete(message.requestId);
        if (message.ok) pending.resolve(message.data);
        else pending.reject(new Error(message.error ?? "Group call request failed."));
        return;
      }
      if (message.type === "group-call-invite") {
        void handleIncomingInvite(message);
        return;
      }
      if (message.type === "group-call-ended") {
        setIncoming((current) => (current?.conversation.id === message.conversationId ? null : current));
        if (activeRef.current?.conversation.id === message.conversationId) void cleanup(false);
      }
    },
    [cleanup, handleIncomingInvite]
  );

  const connectSocket = useCallback(
    function openGroupCallSocket() {
      if (!user || socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING) return;
      shouldReconnectRef.current = true;
      const socket = new WebSocket(signalingUrl());
      socketRef.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: "register", userId: user.uid }));
      socket.onmessage = handleSocketMessage;
      socket.onclose = () => {
        socketRef.current = null;
        if (activeRef.current) {
          showToast({ variant: "error", title: "Group call disconnected", description: "The call was cleaned up locally. Rejoin when signaling reconnects." });
          void cleanup(false);
        }
        if (user && shouldReconnectRef.current) window.setTimeout(openGroupCallSocket, 1500);
      };
    },
    [cleanup, handleSocketMessage, showToast, user]
  );

  const waitForSocket = useCallback(async () => {
    const existing = socketRef.current;
    if (existing?.readyState === WebSocket.OPEN) return;
    if (!user) throw new Error("Sign in before joining a group call.");
    if (!existing || existing.readyState === WebSocket.CLOSED) connectSocket();
    const socket = socketRef.current;
    if (!socket) throw new Error("Group call signaling is not available.");
    if (socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Group call signaling timed out."));
      }, 8000);
      const cleanupListeners = () => {
        window.clearTimeout(timeout);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
      };
      const onOpen = () => {
        cleanupListeners();
        resolve();
      };
      const onError = () => {
        cleanupListeners();
        reject(new Error("Group call signaling failed."));
      };
      const onClose = () => {
        cleanupListeners();
        reject(new Error("Group call signaling closed."));
      };
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
    });
  }, [cleanup, connectSocket, user]);

  const joinGroupCall = useCallback(
    async (conversation: GroupConversation, mode: CallMode) => {
      if (!user) return;
      if (status !== "idle") {
        showToast({ variant: "info", title: "A group call is already active" });
        return;
      }
      try {
        setStatus("joining");
        await waitForSocket();
        const response = await sendRequest<GroupCallStartResponse>("group-call-start", { conversationId: conversation.id, mode });
        const nextActive = { conversation, mode: response.mode, roomName: roomNameFor(conversation.id) };
        setActive(nextActive);
        activeRef.current = nextActive;
        setStatus("connected");
      } catch (error) {
        showToast({ variant: "error", title: "Could not start group call", description: error instanceof Error ? error.message : "Try again." });
        await cleanup(false);
        setStatus("failed");
        window.setTimeout(() => setStatus("idle"), 600);
      }
    },
    [cleanup, sendRequest, showToast, status, user, waitForSocket]
  );

  const acceptIncoming = useCallback(async () => {
    if (!incoming) return;
    const call = incoming;
    setIncoming(null);
    try {
      setStatus("joining");
      await waitForSocket();
      const response = await sendRequest<GroupCallStartResponse>("group-call-join", { conversationId: call.conversation.id, mode: call.mode });
      const nextActive = { conversation: call.conversation, mode: response.mode, roomName: roomNameFor(call.conversation.id) };
      setActive(nextActive);
      activeRef.current = nextActive;
      setStatus("connected");
    } catch (error) {
      showToast({ variant: "error", title: "Could not join group call", description: error instanceof Error ? error.message : "Try again." });
      await cleanup(false);
      setStatus("failed");
      window.setTimeout(() => setStatus("idle"), 600);
    }
  }, [cleanup, incoming, sendRequest, showToast, waitForSocket]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connectSocket();
    const pendingRequests = pendingRequestsRef.current;
    return () => {
      shouldReconnectRef.current = false;
      socketRef.current?.close();
      socketRef.current = null;
      pendingRequests.forEach((pending) => pending.reject(new Error("Group call signaling closed.")));
      pendingRequests.clear();
      void cleanup(false);
    };
  }, [cleanup, connectSocket]);

  const value = useMemo(() => ({ status, active, joinGroupCall }), [active, joinGroupCall, status]);
  const group = active?.conversation ?? null;
  const currentProfile = group && user ? profileFor(group, user.uid) ?? profile : profile;
  const toolbarButtons = active?.mode === "audio" ? ["microphone", "desktop", "chat", "participants-pane", "hangup", "settings"] : undefined;

  return (
    <GroupCallContext.Provider value={value}>
      {children}
      <Modal open={Boolean(incoming)} title="Incoming group call" onClose={() => setIncoming(null)}>
        {incoming ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={incoming.conversation.title ?? "Group"} src={incoming.conversation.avatar_url} size="lg" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink dark:text-white">{incoming.conversation.title}</p>
                <p className="text-sm text-ink/60 dark:text-white/60">
                  {incoming.caller?.full_name ?? "A group member"} started a {incoming.mode} call
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void acceptIncoming()}>Join</Button>
              <Button variant="danger" onClick={() => setIncoming(null)}>Reject</Button>
            </div>
          </div>
        ) : null}
      </Modal>
      {active ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/75 p-4 backdrop-blur-sm">
          <div className="flex h-[min(820px,calc(100vh-2rem))] w-[min(1120px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-white/15 bg-neutral-950 text-white shadow-soft">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={active.conversation.title ?? "Group"} src={active.conversation.avatar_url} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{active.conversation.title}</p>
                  <p className="flex items-center gap-1 text-sm capitalize text-white/60">
                    <Users className="h-3.5 w-3.5" />
                    Jitsi {active.mode} call
                  </p>
                </div>
              </div>
              <Button variant="danger" onClick={() => void cleanup()}>
                <PhoneOff className="h-4 w-4" />
                Leave
              </Button>
            </div>
            <div className="min-h-0 flex-1 bg-black">
              <JitsiMeeting
                domain={jitsiDomain()}
                roomName={active.roomName}
                userInfo={{ displayName: currentProfile?.full_name ?? "COMMS user", email: currentProfile?.email ?? "" }}
                configOverwrite={{ prejoinPageEnabled: false, startWithAudioMuted: false, startWithVideoMuted: active.mode === "audio", disableDeepLinking: true }}
                interfaceConfigOverwrite={{ APP_NAME: "COMMS", SHOW_JITSI_WATERMARK: false, SHOW_WATERMARK_FOR_GUESTS: false, TOOLBAR_BUTTONS: toolbarButtons }}
                getIFrameRef={(iframeRef) => {
                  iframeRef.style.height = "100%";
                  iframeRef.style.width = "100%";
                  iframeRef.style.border = "0";
                }}
                onReadyToClose={() => void cleanup()}
              />
            </div>
          </div>
        </div>
      ) : null}
    </GroupCallContext.Provider>
  );
}

export function useGroupCalls() {
  const context = useContext(GroupCallContext);
  if (!context) throw new Error("useGroupCalls must be used inside GroupCallProvider.");
  return context;
}
