"use client";

import { Mic, MicOff, PhoneOff, PhoneIncoming, RotateCcw, Users, Video, VideoOff } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/features/auth/auth-provider";
import { useNotifications } from "@/features/notifications/notification-provider";
import { getCallMedia, getVideoStreamForFacing, type CameraFacing } from "@/lib/media-devices";
import { signalingUrl, warmSignalingServer } from "@/lib/signaling-url";
import { getGroup } from "@/services/group-service";
import type { CallMode, GroupConversation, UserProfile } from "@/types";

type GroupCallStatus = "idle" | "joining" | "connected" | "failed";
type GroupCallStartResponse = { mode: CallMode; hostId?: string; participantIds?: string[] };
type GroupCallAvailablePayload = { conversationId: string; from: string; mode: CallMode; participantCount?: number; startedAt?: number };
type GroupCallLeaveResponse = GroupCallAvailablePayload & { left: boolean; ended: boolean };
type GroupCallResponse = { type: "group-call-response"; requestId: string; ok: boolean; data?: unknown; error?: string };
type GroupCallEvent =
  | { type: "group-call-invite"; conversationId: string; from: string; mode: CallMode }
  | ({ type: "group-call-available" } & GroupCallAvailablePayload)
  | { type: "group-call-ended"; conversationId: string; userId: string; endedBy?: string }
  | { type: "group-call-peer-joined"; conversationId: string; userId: string }
  | { type: "group-call-peer-left"; conversationId: string; userId: string }
  | { type: "group-call-offer"; conversationId: string; from: string; to: string; offer: RTCSessionDescriptionInit }
  | { type: "group-call-answer"; conversationId: string; from: string; to: string; answer: RTCSessionDescriptionInit }
  | { type: "group-call-ice-candidate"; conversationId: string; from: string; to: string; candidate: RTCIceCandidateInit };
type ActiveGroupCall = { conversation: GroupConversation; mode: CallMode; hostId: string };
type IncomingGroupCall = { conversation: GroupConversation; caller: UserProfile | null; mode: CallMode };
type AvailableGroupCall = { conversation: GroupConversation; caller: UserProfile | null; mode: CallMode; participantCount: number; startedAt: number };
type RemoteParticipant = { userId: string; profile?: UserProfile; stream: MediaStream | null; state: RTCPeerConnectionState | "waiting" };
type PendingRequest = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type GroupCallContextValue = {
  status: GroupCallStatus;
  active: ActiveGroupCall | null;
  availableCalls: Map<string, AvailableGroupCall>;
  joinGroupCall: (conversation: GroupConversation, mode: CallMode) => Promise<void>;
  joinAvailableGroupCall: (conversation: GroupConversation) => Promise<void>;
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

function isLeaveResponse(value: unknown): value is GroupCallLeaveResponse {
  return value !== null && typeof value === "object" && "left" in value && "ended" in value && "conversationId" in value && "mode" in value;
}

function socketIsOpeningOrOpen(socket: WebSocket | null) {
  return socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING;
}

function detectMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
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
    <div className="relative aspect-video min-h-[120px] overflow-hidden rounded-lg bg-black sm:min-h-[180px]">
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

function canEndGroupCall(call: ActiveGroupCall | null, userId: string | undefined) {
  if (!call || !userId) return false;
  const myRole = call.conversation.members?.find((member) => member.user_id === userId)?.role;
  return call.hostId === userId || myRole === "owner" || myRole === "admin";
}

export function GroupCallProvider({ children }: { children: ReactNode }) {
  const { user, profile, supabase } = useAuth();
  const { showToast } = useToast();
  const { notifyIncomingCall, startRingtone, stopRingtone } = useNotifications();
  const socketRef = useRef<WebSocket | null>(null);
  const handleSocketMessageRef = useRef<(event: MessageEvent<string>) => void>(() => undefined);
  const shouldReconnectRef = useRef(true);
  const pendingRequestsRef = useRef(new Map<string, PendingRequest>());
  const cleanupRef = useRef<(notify?: boolean) => Promise<void>>(async () => undefined);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const activeRef = useRef<ActiveGroupCall | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<GroupCallStatus>("idle");
  const [active, setActive] = useState<ActiveGroupCall | null>(null);
  const [incoming, setIncoming] = useState<IncomingGroupCall | null>(null);
  const [availableCalls, setAvailableCalls] = useState(new Map<string, AvailableGroupCall>());
  const [dismissedAvailableCallIds, setDismissedAvailableCallIds] = useState(new Set<string>());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("user");
  const [isMobileBrowser] = useState(detectMobileBrowser);

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
      let leaveResponse: unknown = null;
      if (notify && current) {
        try {
          leaveResponse = await sendRequest("group-call-leave", { conversationId: current.conversation.id });
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
      setCameraFacing("user");
      setStatus("idle");
      stopRingtone();
      if (current && isLeaveResponse(leaveResponse) && !leaveResponse.ended) {
        const caller = profileFor(current.conversation, leaveResponse.from) ?? null;
        setAvailableCalls((calls) => {
          const nextCalls = new Map(calls);
          nextCalls.set(current.conversation.id, {
            conversation: current.conversation,
            caller,
            mode: leaveResponse.mode,
            participantCount: leaveResponse.participantCount ?? 1,
            startedAt: leaveResponse.startedAt ?? Date.now()
          });
          return nextCalls;
        });
        setDismissedAvailableCallIds((ids) => {
          const nextIds = new Set(ids);
          nextIds.delete(current.conversation.id);
          return nextIds;
        });
      }
    },
    [sendRequest, stopRingtone]
  );

  const rememberAvailableCall = useCallback(
    async (message: GroupCallAvailablePayload) => {
      if (!supabase || !user || activeRef.current?.conversation.id === message.conversationId) return;
      const conversation = await getGroup(supabase, message.conversationId, user.uid);
      const caller = profileFor(conversation, message.from) ?? null;
      setAvailableCalls((calls) => {
        const nextCalls = new Map(calls);
        nextCalls.set(conversation.id, {
          conversation,
          caller,
          mode: message.mode,
          participantCount: message.participantCount ?? 1,
          startedAt: message.startedAt ?? Date.now()
        });
        return nextCalls;
      });
      setDismissedAvailableCallIds((ids) => {
        const nextIds = new Set(ids);
        nextIds.delete(conversation.id);
        return nextIds;
      });
    },
    [supabase, user]
  );

  const getMedia = useCallback(async (mode: CallMode) => {
    const { stream, effectiveMode } = await getCallMedia(mode, cameraFacing);
    localStreamRef.current = stream;
    setLocalStream(stream);
    setMicEnabled(true);
    setCameraEnabled(effectiveMode === "video");
    if (mode === "video" && effectiveMode === "audio") {
      showToast({ variant: "info", title: "Camera unavailable", description: "Joining as audio only." });
    }
    return { stream, effectiveMode };
  }, [cameraFacing, showToast]);

  const handleIncomingInvite = useCallback(
    async (message: Extract<GroupCallEvent, { type: "group-call-invite" }>) => {
      if (!supabase || !user || message.from === user.uid || activeRef.current) return;
      try {
        const conversation = await getGroup(supabase, message.conversationId, user.uid);
        const caller = profileFor(conversation, message.from) ?? null;
        setIncoming({ conversation, caller, mode: message.mode });
        notifyIncomingCall({
          conversationId: conversation.id,
          title: `Incoming group ${message.mode} call`,
          body: `${caller?.full_name ?? "A group member"} is calling ${conversation.title ?? "your group"}`
        });
        startRingtone(conversation.id);
      } catch {
        showToast({ variant: "error", title: "Group call unavailable", description: "Could not load the group details for this call." });
      }
    },
    [notifyIncomingCall, showToast, startRingtone, supabase, user]
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
      if (message.type === "group-call-available") void rememberAvailableCall(message);
      if (message.type === "group-call-ended") {
        setAvailableCalls((calls) => {
          const nextCalls = new Map(calls);
          nextCalls.delete(message.conversationId);
          return nextCalls;
        });
        setDismissedAvailableCallIds((ids) => {
          const nextIds = new Set(ids);
          nextIds.delete(message.conversationId);
          return nextIds;
        });
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
    [cleanup, handleAnswer, handleIceCandidate, handleIncomingInvite, handleOffer, rememberAvailableCall, removePeer, setParticipant]
  );

  useEffect(() => {
    handleSocketMessageRef.current = handleSocketMessage;
  }, [handleSocketMessage]);

  useEffect(() => {
    cleanupRef.current = cleanup;
  }, [cleanup]);

  const connectSocket = useCallback(
    async function openGroupCallSocket() {
      const userId = user?.uid;
      if (!userId || socketIsOpeningOrOpen(socketRef.current)) return;
      shouldReconnectRef.current = true;
      await warmSignalingServer();
      if (!shouldReconnectRef.current || socketIsOpeningOrOpen(socketRef.current)) return;
      const socket = new WebSocket(signalingUrl());
      socketRef.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: "register", userId }));
      socket.onmessage = (event) => handleSocketMessageRef.current(event);
      socket.onclose = () => {
        socketRef.current = null;
        if (activeRef.current) {
          showToast({ variant: "error", title: "Group call disconnected", description: "The call was cleaned up locally. Rejoin when signaling reconnects." });
          void cleanupRef.current(false);
        }
        if (shouldReconnectRef.current) window.setTimeout(() => void openGroupCallSocket(), 1500);
      };
    },
    [showToast, user?.uid]
  );

  const waitForSocket = useCallback(async () => {
    const existing = socketRef.current;
    if (existing?.readyState === WebSocket.OPEN) return;
    if (!user) throw new Error("Sign in before joining a group call.");
    if (!existing || existing.readyState === WebSocket.CLOSED) await connectSocket();
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
      const { effectiveMode } = await getMedia(mode);
      const nextActive = { conversation, mode: effectiveMode, hostId: user.uid };
      setActive(nextActive);
      activeRef.current = nextActive;
      await waitForSocket();
      const response = await sendRequest<GroupCallStartResponse>(requestType, { conversationId: conversation.id, mode: effectiveMode });
      if (!isStartResponse(response)) throw new Error("Group call server returned an invalid response.");
      const joinedActive = { conversation, mode: effectiveMode, hostId: response.hostId ?? user.uid };
      setAvailableCalls((calls) => {
        const nextCalls = new Map(calls);
        nextCalls.delete(conversation.id);
        return nextCalls;
      });
      setDismissedAvailableCallIds((ids) => {
        const nextIds = new Set(ids);
        nextIds.delete(conversation.id);
        return nextIds;
      });
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
    stopRingtone();
    try {
      await joinMeshCall(call.conversation, call.mode, "group-call-join");
    } catch (error) {
      showToast({ variant: "error", title: "Could not join group call", description: error instanceof Error ? error.message : "Check camera and microphone permissions." });
      await cleanup(true);
      setStatus("failed");
      window.setTimeout(() => setStatus("idle"), 600);
    }
  }, [cleanup, incoming, joinMeshCall, showToast, stopRingtone]);

  const joinAvailableGroupCall = useCallback(
    async (conversation: GroupConversation) => {
      const availableCall = availableCalls.get(conversation.id);
      if (!availableCall) {
        showToast({ variant: "info", title: "No active call", description: "This group call has already ended." });
        return;
      }
      if (status !== "idle") {
        showToast({ variant: "info", title: "A group call is already active" });
        return;
      }
      try {
        await joinMeshCall(availableCall.conversation, availableCall.mode, "group-call-join");
      } catch (error) {
        showToast({ variant: "error", title: "Could not join group call", description: error instanceof Error ? error.message : "Check camera and microphone permissions." });
        await cleanup(true);
        setStatus("failed");
        window.setTimeout(() => setStatus("idle"), 600);
      }
    },
    [availableCalls, cleanup, joinMeshCall, showToast, status]
  );

  const dismissAvailableCall = useCallback((conversationId: string) => {
    setDismissedAvailableCallIds((ids) => {
      const nextIds = new Set(ids);
      nextIds.add(conversationId);
      return nextIds;
    });
  }, []);

  const endCallForEveryone = useCallback(async () => {
    const current = activeRef.current;
    if (!current) return;
    try {
      await sendRequest("group-call-end", { conversationId: current.conversation.id });
      await cleanup(false);
      showToast({ variant: "success", title: "Group call ended" });
    } catch (error) {
      showToast({ variant: "error", title: "Could not end call", description: error instanceof Error ? error.message : "Try again." });
    }
  }, [cleanup, sendRequest, showToast]);

  const dismissIncoming = useCallback(() => {
    stopRingtone();
    setIncoming(null);
  }, [stopRingtone]);

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
        const videoStream = await getVideoStreamForFacing(cameraFacing);
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
  }, [cameraFacing, localStream, sendOfferToPeer, showToast]);

  const rotateCamera = useCallback(async () => {
    if (!localStream || !localStream.getVideoTracks().length) return;
    const nextFacing = cameraFacing === "user" ? "environment" : "user";
    const currentTrack = localStream.getVideoTracks()[0];
    const currentDeviceId = currentTrack?.getSettings().deviceId;
    const videoSenders = [...peersRef.current.values()]
      .map((peer) => peer.getSenders().find((item) => item.track?.kind === "video"))
      .filter((sender): sender is RTCRtpSender => Boolean(sender));
    localStream.removeTrack(currentTrack);
    currentTrack.stop();
    try {
      const videoStream = await getVideoStreamForFacing(nextFacing, { avoidDeviceId: currentDeviceId, requireDifferentDevice: true });
      const [nextTrack] = videoStream.getVideoTracks();
      localStream.addTrack(nextTrack);
      await Promise.all(videoSenders.map((sender) => sender.replaceTrack(nextTrack)));
      setCameraFacing(nextFacing);
      setCameraEnabled(nextTrack.enabled);
      setLocalStream(new MediaStream(localStream.getTracks()));
    } catch {
      try {
        const restoreStream = await getVideoStreamForFacing(cameraFacing);
        const [restoreTrack] = restoreStream.getVideoTracks();
        localStream.addTrack(restoreTrack);
        await Promise.all(videoSenders.map((sender) => sender.replaceTrack(restoreTrack)));
        setLocalStream(new MediaStream(localStream.getTracks()));
      } catch {
        setCameraEnabled(false);
      }
      showToast({ variant: "error", title: "Could not rotate camera", description: "Your browser did not provide another camera." });
    }
  }, [cameraFacing, localStream, showToast]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    void connectSocket();
    const pendingRequests = pendingRequestsRef.current;
    return () => {
      shouldReconnectRef.current = false;
      socketRef.current?.close();
      socketRef.current = null;
      pendingRequests.forEach((pending) => pending.reject(new Error("Group call signaling closed.")));
      pendingRequests.clear();
      void cleanupRef.current(false);
    };
  }, [connectSocket]);

  const value = useMemo(() => ({ status, active, availableCalls, joinGroupCall, joinAvailableGroupCall }), [active, availableCalls, joinAvailableGroupCall, joinGroupCall, status]);
  const group = active?.conversation ?? null;
  const currentProfile = group && user ? profileFor(group, user.uid) ?? profile : profile;
  const participantCount = participants.length + (active ? 1 : 0);
  const availableCall = incoming ? null : [...availableCalls.values()].find((call) => !dismissedAvailableCallIds.has(call.conversation.id)) ?? null;
  const mayEndForEveryone = canEndGroupCall(active, user?.uid);

  return (
    <GroupCallContext.Provider value={value}>
      {children}
      <Modal open={Boolean(incoming)} title="Incoming group call" onClose={dismissIncoming}>
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
              <Button variant="danger" onClick={dismissIncoming}>Reject</Button>
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal open={Boolean(availableCall)} title="Group call active" onClose={() => availableCall && dismissAvailableCall(availableCall.conversation.id)}>
        {availableCall ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={availableCall.conversation.title ?? "Group"} src={availableCall.conversation.avatar_url} size="lg" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink dark:text-white">{availableCall.conversation.title}</p>
                <p className="text-sm text-ink/60 dark:text-white/60">
                  {availableCall.caller?.full_name ?? "A group member"} has an active {availableCall.mode} call
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void joinAvailableGroupCall(availableCall.conversation)}>
                <PhoneIncoming className="h-4 w-4" />
                Join call
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
      {active ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/75 p-0 backdrop-blur-sm sm:p-4">
          <div className="flex h-[100dvh] w-full flex-col overflow-hidden border border-white/15 bg-neutral-950 text-white shadow-soft sm:h-[min(820px,calc(100vh-2rem))] sm:w-[min(1120px,calc(100vw-2rem))] sm:rounded-lg">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-3 py-3 sm:px-4">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={active.conversation.title ?? "Group"} src={active.conversation.avatar_url} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{active.conversation.title}</p>
                  <p className="flex items-center gap-1 text-sm capitalize text-white/60">
                    <Users className="h-3.5 w-3.5" />
                    {participantCount}/10 in {active.mode} call
                  </p>
                </div>
              </div>
              <div className="flex flex-1 justify-end gap-2 sm:flex-none">
                {mayEndForEveryone ? (
                  <Button variant="danger" className="h-9 px-3" onClick={() => void endCallForEveryone()}>
                    <PhoneOff className="h-4 w-4" />
                    End call
                  </Button>
                ) : null}
                <Button variant={mayEndForEveryone ? "secondary" : "danger"} className="h-9 px-3" onClick={() => void cleanup(true)}>
                  <PhoneOff className="h-4 w-4" />
                  Leave
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
              <div className="grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
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
            <div className="grid grid-cols-2 gap-2 border-t border-white/10 px-3 py-3 sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:px-4">
              <Button variant="secondary" className="h-9 px-3" onClick={toggleMic}>{micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />} Mic</Button>
              <Button variant="secondary" className="h-9 px-3" onClick={toggleCamera} disabled={!localStream?.getVideoTracks().length}>{cameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />} Camera</Button>
              {isMobileBrowser && localStream?.getVideoTracks().length ? (
                <Button variant="secondary" className="h-9 px-3 sm:hidden" onClick={() => void rotateCamera()}>
                  <RotateCcw className="h-4 w-4" />
                  Rotate
                </Button>
              ) : null}
              <Button variant="secondary" className="h-9 px-3" onClick={() => void switchMode()}>
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
