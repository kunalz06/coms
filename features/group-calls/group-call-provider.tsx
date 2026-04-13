"use client";

import { Mic, MicOff, PhoneOff, Users, Video, VideoOff } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/features/auth/auth-provider";
import { signalingUrl } from "@/lib/signaling-url";
import { getGroup } from "@/services/group-service";
import type { CallMode, GroupConversation, UserProfile } from "@/types";

type GroupCallStatus = "idle" | "joining" | "connected" | "failed";
type GroupCallStartResponse = { mode: CallMode; participantIds?: string[] };
type GroupCallResponse = { type: "group-call-response"; requestId: string; ok: boolean; data?: unknown; error?: string };
type GroupCallEvent =
  | { type: "group-call-invite"; conversationId: string; from: string; mode: CallMode }
  | { type: "group-call-ended"; conversationId: string; userId: string }
  | { type: "group-call-peer-joined"; conversationId: string; userId: string }
  | { type: "group-call-peer-left"; conversationId: string; userId: string }
  | { type: "group-call-offer"; conversationId: string; from: string; to: string; offer: RTCSessionDescriptionInit }
  | { type: "group-call-answer"; conversationId: string; from: string; to: string; answer: RTCSessionDescriptionInit }
  | { type: "group-call-ice-candidate"; conversationId: string; from: string; to: string; candidate: RTCIceCandidateInit };
type ActiveGroupCall = { conversation: GroupConversation; mode: CallMode };
type IncomingGroupCall = { conversation: GroupConversation; caller: UserProfile | null; mode: CallMode };
type RemoteParticipant = { userId: string; profile?: UserProfile; stream: MediaStream | null; state: RTCPeerConnectionState | "waiting" };
type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type GroupCallContextValue = {
  status: GroupCallStatus;
  active: ActiveGroupCall | null;
  joinGroupCall: (conversation: GroupConversation, mode: CallMode) => Promise<void>;
};

const GroupCallContext = createContext<GroupCallContextValue | null>(null);

function rtcConfig(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [];
  const stun = process.env.NEXT_PUBLIC_STUN_URLS?.split(",").map((url) => url.trim()).filter(Boolean);
  if (stun?.length) iceServers.push({ urls: stun });
  const turn = process.env.NEXT_PUBLIC_TURN_URLS?.split(",").map((url) => url.trim()).filter(Boolean);
  if (turn?.length) {
    iceServers.push({
      urls: turn,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL
    });
  }
  return { iceServers, iceCandidatePoolSize: 4 };
}

function profileFor(group: GroupConversation | null, userId: string): UserProfile | undefined {
  return group?.members?.find((member) => member.user_id === userId)?.profile;
}

function isStartResponse(value: unknown): value is GroupCallStartResponse {
  return value !== null && typeof value === "object" && "mode" in value;
}

function VideoTile({ stream, name, avatarUrl, muted = false, label }: { stream: MediaStream | null; name: string; avatarUrl?: string | null; muted?: boolean; label?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || element.srcObject === stream) return;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
  }, [stream]);

  const hasVideo = Boolean(stream?.getVideoTracks().some((track) => track.readyState === "live"));

  return (
    <div className="relative min-h-[180px] overflow-hidden rounded-lg bg-black">
      <video ref={videoRef} autoPlay muted={muted} playsInline className={`h-full w-full object-cover ${hasVideo ? "block" : "hidden"}`} />
      {!hasVideo ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900">
          <Avatar name={name} src={avatarUrl ?? null} size="lg" />
          <span className="text-sm text-white/65">Audio only</span>
        </div>
      ) : null}
      <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded bg-black/60 px-2 py-1 text-xs text-white">{label ?? name}</div>
    </div>
  );
}

export function GroupCallProvider({ children }: { children: ReactNode }) {
  const { user, profile, supabase } = useAuth();
  const { showToast } = useToast();
  const socketRef = useRef<WebSocket | null>(null);
  const shouldReconnectRef = useRef(true);
  const pendingRequestsRef = useRef(new Map<string, PendingRequest>());
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const activeRef = useRef<ActiveGroupCall | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<GroupCallStatus>("idle");
  const [active, setActive] = useState<ActiveGroupCall | null>(null);
  const [incoming, setIncoming] = useState<IncomingGroupCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

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

  const setParticipant = useCallback((userId: string, values: Partial<RemoteParticipant>) => {
    const group = activeRef.current?.conversation ?? null;
    setParticipants((current) => {
      const existing = current.find((participant) => participant.userId === userId);
      if (existing) {
        return current.map((participant) => (participant.userId === userId ? { ...participant, ...values } : participant));
      }
      return [...current, { userId, profile: profileFor(group, userId), stream: null, state: "waiting", ...values }];
    });
  }, []);

  const addPendingCandidates = useCallback(async (peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer?.remoteDescription) return;
    const pending = pendingCandidatesRef.current.get(peerId) ?? [];
    pendingCandidatesRef.current.delete(peerId);
    await Promise.all(pending.map((candidate) => peer.addIceCandidate(candidate).catch(() => undefined)));
  }, []);

  const removePeer = useCallback((peerId: string) => {
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    pendingCandidatesRef.current.delete(peerId);
    setParticipants((current) => current.filter((participant) => participant.userId !== peerId));
  }, []);

  const createPeer = useCallback(
    (peerId: string) => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;
      const current = activeRef.current;
      if (!current || !user) throw new Error("Group call is not active.");

      const connection = new RTCPeerConnection(rtcConfig());
      localStreamRef.current?.getTracks().forEach((track) => connection.addTrack(track, localStreamRef.current as MediaStream));
      connection.onicecandidate = (event) => {
        if (!event.candidate || !activeRef.current || !user) return;
        sendMessage({
          type: "group-call-ice-candidate",
          from: user.uid,
          to: peerId,
          conversationId: activeRef.current.conversation.id,
          candidate: event.candidate.toJSON()
        });
      };
      connection.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) setParticipant(peerId, { stream, state: connection.connectionState });
      };
      connection.onconnectionstatechange = () => {
        setParticipant(peerId, { state: connection.connectionState });
        if (connection.connectionState === "failed" || connection.connectionState === "closed") removePeer(peerId);
      };
      peersRef.current.set(peerId, connection);
      setParticipant(peerId, { state: "waiting" });
      return connection;
    },
    [removePeer, sendMessage, setParticipant, user]
  );

  const sendOfferToPeer = useCallback(
    async (peerId: string) => {
      const current = activeRef.current;
      if (!current || !user) return;
      const peer = createPeer(peerId);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      sendMessage({ type: "group-call-offer", from: user.uid, to: peerId, conversationId: current.conversation.id, offer });
    },
    [createPeer, sendMessage, user]
  );

  const cleanup = useCallback(
    async (notify = true) => {
      const current = activeRef.current;
      if (notify && current) {
        try {
          await sendRequest("group-call-leave", { conversationId: current.conversation.id });
        } catch {
          // The signaling socket can already be gone; local media cleanup still has to run.
        }
      }
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      pendingCandidatesRef.current.clear();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      activeRef.current = null;
      setLocalStream(null);
      setParticipants([]);
      setActive(null);
      setMicEnabled(true);
      setCameraEnabled(true);
      setStatus("idle");
    },
    [sendRequest]
  );

  const getMedia = useCallback(async (mode: CallMode) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === "video" });
    localStreamRef.current = stream;
    setLocalStream(stream);
    setMicEnabled(true);
    setCameraEnabled(mode === "video");
    return stream;
  }, []);

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

  const handleOffer = useCallback(
    async (message: Extract<GroupCallEvent, { type: "group-call-offer" }>) => {
      if (!user || message.to !== user.uid || activeRef.current?.conversation.id !== message.conversationId) return;
      const peer = createPeer(message.from);
      await peer.setRemoteDescription(message.offer);
      await addPendingCandidates(message.from);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendMessage({ type: "group-call-answer", from: user.uid, to: message.from, conversationId: message.conversationId, answer });
    },
    [addPendingCandidates, createPeer, sendMessage, user]
  );

  const handleAnswer = useCallback(
    async (message: Extract<GroupCallEvent, { type: "group-call-answer" }>) => {
      if (!user || message.to !== user.uid || activeRef.current?.conversation.id !== message.conversationId) return;
      const peer = peersRef.current.get(message.from);
      if (!peer) return;
      await peer.setRemoteDescription(message.answer);
      await addPendingCandidates(message.from);
    },
    [addPendingCandidates, user]
  );

  const handleIceCandidate = useCallback(
    async (message: Extract<GroupCallEvent, { type: "group-call-ice-candidate" }>) => {
      if (!user || message.to !== user.uid || activeRef.current?.conversation.id !== message.conversationId) return;
      const peer = peersRef.current.get(message.from);
      if (peer?.remoteDescription) {
        await peer.addIceCandidate(message.candidate).catch(() => undefined);
        return;
      }
      const pending = pendingCandidatesRef.current.get(message.from) ?? [];
      pending.push(message.candidate);
      pendingCandidatesRef.current.set(message.from, pending);
    },
    [user]
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
      if (message.type === "group-call-invite") void handleIncomingInvite(message);
      if (message.type === "group-call-ended") {
        setIncoming((current) => (current?.conversation.id === message.conversationId ? null : current));
        if (activeRef.current?.conversation.id === message.conversationId) void cleanup(false);
      }
      if (message.type === "group-call-peer-joined" && activeRef.current?.conversation.id === message.conversationId) {
        setParticipant(message.userId, { state: "waiting" });
      }
      if (message.type === "group-call-peer-left" && activeRef.current?.conversation.id === message.conversationId) removePeer(message.userId);
      if (message.type === "group-call-offer") void handleOffer(message);
      if (message.type === "group-call-answer") void handleAnswer(message);
      if (message.type === "group-call-ice-candidate") void handleIceCandidate(message);
    },
    [cleanup, handleAnswer, handleIceCandidate, handleIncomingInvite, handleOffer, removePeer, setParticipant]
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

  const joinMeshCall = useCallback(
    async (conversation: GroupConversation, mode: CallMode, requestType: "group-call-start" | "group-call-join") => {
      if (!user) return;
      setStatus("joining");
      await getMedia(mode);
      const nextActive = { conversation, mode };
      setActive(nextActive);
      activeRef.current = nextActive;
      await waitForSocket();
      const response = await sendRequest<GroupCallStartResponse>(requestType, { conversationId: conversation.id, mode });
      if (!isStartResponse(response)) throw new Error("Group call server returned an invalid response.");
      const joinedActive = { conversation, mode: response.mode };
      setActive(joinedActive);
      activeRef.current = joinedActive;
      setStatus("connected");
      await Promise.all((response.participantIds ?? []).map((peerId) => sendOfferToPeer(peerId)));
    },
    [getMedia, sendOfferToPeer, sendRequest, user, waitForSocket]
  );

  const joinGroupCall = useCallback(
    async (conversation: GroupConversation, mode: CallMode) => {
      if (!user) return;
      if (status !== "idle") {
        showToast({ variant: "info", title: "A group call is already active" });
        return;
      }
      try {
        await joinMeshCall(conversation, mode, "group-call-start");
      } catch (error) {
        showToast({ variant: "error", title: "Could not start group call", description: error instanceof Error ? error.message : "Check camera and microphone permissions." });
        await cleanup(true);
        setStatus("failed");
        window.setTimeout(() => setStatus("idle"), 600);
      }
    },
    [cleanup, joinMeshCall, showToast, status, user]
  );

  const acceptIncoming = useCallback(async () => {
    if (!incoming) return;
    const call = incoming;
    setIncoming(null);
    try {
      await joinMeshCall(call.conversation, call.mode, "group-call-join");
    } catch (error) {
      showToast({ variant: "error", title: "Could not join group call", description: error instanceof Error ? error.message : "Check camera and microphone permissions." });
      await cleanup(true);
      setStatus("failed");
      window.setTimeout(() => setStatus("idle"), 600);
    }
  }, [cleanup, incoming, joinMeshCall, showToast]);

  const toggleMic = useCallback(() => {
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !track.enabled;
      setMicEnabled(track.enabled);
    });
  }, [localStream]);

  const toggleCamera = useCallback(() => {
    localStream?.getVideoTracks().forEach((track) => {
      track.enabled = !track.enabled;
      setCameraEnabled(track.enabled);
    });
  }, [localStream]);

  const switchMode = useCallback(async () => {
    if (!localStream || !activeRef.current) return;
    try {
      if (activeRef.current.mode === "audio") {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const [track] = videoStream.getVideoTracks();
        localStream.addTrack(track);
        peersRef.current.forEach((peer) => peer.addTrack(track, localStream));
        const nextActive = { ...activeRef.current, mode: "video" as CallMode };
        setActive(nextActive);
        activeRef.current = nextActive;
        setCameraEnabled(true);
      } else {
        localStream.getVideoTracks().forEach((track) => {
          track.stop();
          localStream.removeTrack(track);
          peersRef.current.forEach((peer) => {
            const sender = peer.getSenders().find((item) => item.track === track);
            if (sender) peer.removeTrack(sender);
          });
        });
        const nextActive = { ...activeRef.current, mode: "audio" as CallMode };
        setActive(nextActive);
        activeRef.current = nextActive;
        setCameraEnabled(false);
      }
      await Promise.all([...peersRef.current.keys()].map((peerId) => sendOfferToPeer(peerId)));
    } catch {
      showToast({ variant: "error", title: "Camera unavailable", description: "Allow camera access to switch to video." });
    }
  }, [localStream, sendOfferToPeer, showToast]);

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
  const participantCount = participants.length + (active ? 1 : 0);

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
                    {participantCount}/5 in {active.mode} call
                  </p>
                </div>
              </div>
              <Button variant="danger" onClick={() => void cleanup(true)}>
                <PhoneOff className="h-4 w-4" />
                Leave
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="grid min-h-full auto-rows-fr gap-3 md:grid-cols-2">
                <VideoTile stream={localStream} name={currentProfile?.full_name ?? "You"} avatarUrl={currentProfile?.avatar_url} muted label="You" />
                {participants.map((participant) => (
                  <VideoTile
                    key={participant.userId}
                    stream={participant.stream}
                    name={participant.profile?.full_name ?? "Group member"}
                    avatarUrl={participant.profile?.avatar_url}
                    label={`${participant.profile?.full_name ?? "Group member"} · ${participant.state}`}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 px-4 py-3">
              <Button variant="secondary" onClick={toggleMic}>{micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />} Mic</Button>
              <Button variant="secondary" onClick={toggleCamera} disabled={!localStream?.getVideoTracks().length}>{cameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />} Camera</Button>
              <Button variant="secondary" onClick={() => void switchMode()}>
                {active.mode === "audio" ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                {active.mode === "audio" ? "Switch to video" : "Switch to audio"}
              </Button>
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
