"use client";

import { Mic, MicOff, PhoneOff, RotateCcw, Video, VideoOff } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/features/auth/auth-provider";
import { useNotifications } from "@/features/notifications/notification-provider";
import { CALL_TIMEOUT_MS, canTransitionCall, readableCallStatus } from "@/lib/call-state";
import { getCallMedia, getVideoStreamForFacing, type CameraFacing } from "@/lib/media-devices";
import { signalingUrl, warmSignalingServer } from "@/lib/signaling-url";
import { getProfile } from "@/services/profile-service";
import type { CallMode, CallStatus, SignalingMessage, UserProfile } from "@/types";

type IncomingCall = {
  callId: string;
  from: UserProfile;
  mode: CallMode;
  conversationId: string;
};

type ActiveCall = {
  callId: string;
  peer: UserProfile;
  conversationId: string;
  mode: CallMode;
};

type CallContextValue = {
  status: CallStatus;
  mode: CallMode;
  startCall: (peer: UserProfile, conversationId: string, mode: CallMode) => Promise<void>;
};

const CallContext = createContext<CallContextValue | null>(null);

function unavailableMessage(reason?: string) {
  if (reason === "offline") return "The contact is not connected to calling right now. Ask them to open COMMS and try again.";
  if (reason === "blocked") return "This call is blocked by contact settings.";
  if (reason === "block-check-failed") return "The calling server could not verify block settings. Check the Render Supabase service-role environment variable.";
  return "The contact is unavailable.";
}

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

function attachStream(stream: MediaStream | null, element: HTMLVideoElement | null) {
  if (!element || element.srcObject === stream) return;
  element.srcObject = stream;
  void element.play().catch(() => undefined);
}

function socketIsOpeningOrOpen(socket: WebSocket | null) {
  return socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING;
}

function detectMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { user, supabase } = useAuth();
  const { showToast } = useToast();
  const { notifyIncomingCall, startRingtone, stopRingtone } = useNotifications();
  const socketRef = useRef<WebSocket | null>(null);
  const handleMessageRef = useRef<(event: MessageEvent<string>) => void>(() => undefined);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const connectSocketRef = useRef<() => Promise<void>>(async () => undefined);
  const resetCallRef = useRef<() => Promise<void>>(async () => undefined);
  const shouldReconnectRef = useRef(true);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const callTimeoutRef = useRef<number | null>(null);
  const [status, setCallStatus] = useState<CallStatus>("idle");
  const [mode, setMode] = useState<CallMode>("audio");
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("user");
  const [isMobileBrowser] = useState(detectMobileBrowser);
  const statusRef = useRef(status);
  const activeRef = useRef(active);
  const incomingRef = useRef(incoming);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const transitionTo = useCallback((nextStatus: CallStatus) => {
    const currentStatus = statusRef.current;
    if (!canTransitionCall(currentStatus, nextStatus)) {
      console.warn(`Ignored invalid call transition: ${currentStatus} -> ${nextStatus}`);
      return false;
    }
    statusRef.current = nextStatus;
    setCallStatus(nextStatus);
    return true;
  }, []);

  const forceStatus = useCallback((nextStatus: CallStatus) => {
    statusRef.current = nextStatus;
    setCallStatus(nextStatus);
  }, []);

  const clearCallTimeout = useCallback(() => {
    if (callTimeoutRef.current) {
      window.clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    incomingRef.current = incoming;
  }, [incoming]);

  useEffect(() => attachStream(localStream, localVideoRef.current), [localStream]);
  useEffect(() => attachStream(remoteStream, remoteVideoRef.current), [remoteStream]);
  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);
  useEffect(() => {
    remoteStreamRef.current = remoteStream;
  }, [remoteStream]);

  const sendSignal = useCallback((message: SignalingMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Signaling is not connected.");
    socket.send(JSON.stringify(message));
  }, []);

  const waitForSignaling = useCallback(async () => {
    const existing = socketRef.current;
    if (existing?.readyState === WebSocket.OPEN) return;
    await connectSocketRef.current();
    const socket = socketRef.current;
    if (!socket) throw new Error("Signaling is not available.");
    if (socket.readyState === WebSocket.OPEN) return;
    if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) throw new Error("Signaling is reconnecting. Try again.");

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Signaling connection timed out."));
      }, 8000);
      const cleanup = () => {
        window.clearTimeout(timeout);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Signaling connection failed."));
      };
      const onClose = () => {
        cleanup();
        reject(new Error("Signaling connection closed."));
      };
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
    });
  }, []);

  const writeCallSession = useCallback(
    async (callId: string, values: Record<string, unknown>) => {
      if (!supabase) return;
      await supabase.from("call_sessions").upsert({ id: callId, ...values }).throwOnError();
    },
    [supabase]
  );

  const updateCallSession = useCallback(
    async (callId: string, values: Record<string, unknown>) => {
      if (!supabase) return;
      await supabase.from("call_sessions").update(values).eq("id", callId).throwOnError();
    },
    [supabase]
  );

  const resetCall = useCallback(
    async (reason: "ended" | "failed" | "missed" | "rejected" | "busy" = "ended") => {
      const call = activeRef.current;
      const incomingCall = incomingRef.current;
      const callId = call?.callId ?? incomingCall?.callId;
      const hadCallState = statusRef.current !== "idle" || Boolean(callId);
      clearCallTimeout();
      if (hadCallState && statusRef.current !== "idle" && statusRef.current !== "ending") {
        transitionTo("ending");
      }
      peerRef.current?.getSenders().forEach((sender) => sender.track?.stop());
      peerRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
      peerRef.current = null;
      pendingCandidatesRef.current = [];
      pendingOfferRef.current = null;
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      setIncoming(null);
      setActive(null);
      setMode("audio");
      setMicEnabled(true);
      setCameraEnabled(true);
      setCameraFacing("user");
      if (callId) {
        await updateCallSession(callId, {
          status: reason,
          ended_at: new Date().toISOString(),
          failure_reason: reason === "failed" ? "Connection failed" : reason === "busy" ? "Peer busy" : null
        }).catch(() => undefined);
      }
      if (hadCallState) {
        forceStatus("ended");
        window.setTimeout(() => forceStatus("idle"), 250);
      }
      stopRingtone();
    },
    [clearCallTimeout, forceStatus, stopRingtone, transitionTo, updateCallSession]
  );

  useEffect(() => {
    clearCallTimeout();
    if (status !== "outgoing_ringing" && status !== "incoming_ringing") return;

    callTimeoutRef.current = window.setTimeout(() => {
      const call = activeRef.current;
      const incomingCall = incomingRef.current;
      if (statusRef.current === "outgoing_ringing" && call && user) {
        try {
          sendSignal({ type: "call-end", callId: call.callId, from: user.uid, to: call.peer.id, reason: "missed" });
        } catch {
          // The database log still captures the missed call even if signaling is already gone.
        }
        showToast({ variant: "info", title: "No answer", description: "The call was marked as missed." });
        void resetCall("missed");
      }
      if (statusRef.current === "incoming_ringing" && incomingCall && user) {
        try {
          sendSignal({ type: "call-end", callId: incomingCall.callId, from: user.uid, to: incomingCall.from.id, reason: "missed" });
        } catch {
          // The caller may have closed the socket; cleanup still runs locally.
        }
        void resetCall("missed");
      }
    }, CALL_TIMEOUT_MS);

    return clearCallTimeout;
  }, [clearCallTimeout, resetCall, sendSignal, showToast, status, user]);

  const createPeer = useCallback(
    (callId: string, peerId: string) => {
      if (peerRef.current) return peerRef.current;
      const connection = new RTCPeerConnection(rtcConfig());
      connection.onicecandidate = (event) => {
        if (event.candidate && user) {
          sendSignal({ type: "ice-candidate", callId, from: user.uid, to: peerId, candidate: event.candidate.toJSON() });
        }
      };
      connection.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) setRemoteStream(stream);
      };
      connection.onconnectionstatechange = () => {
        const state = connection.connectionState;
        if (state === "connected") {
          clearCallTimeout();
          transitionTo("connected");
          void updateCallSession(callId, { status: "connected" }).catch(() => undefined);
        }
        if (state === "disconnected") {
          transitionTo("reconnecting");
          void updateCallSession(callId, { status: "reconnecting" }).catch(() => undefined);
          window.setTimeout(() => {
            if (connection.connectionState === "disconnected") void resetCall("failed");
          }, 8000);
        }
        if (state === "failed") {
          transitionTo("failed");
          void resetCall("failed");
        }
      };
      peerRef.current = connection;
      return connection;
    },
    [clearCallTimeout, resetCall, sendSignal, transitionTo, updateCallSession, user]
  );

  const addPendingCandidates = useCallback(async () => {
    const peer = peerRef.current;
    if (!peer?.remoteDescription) return;
    const candidates = pendingCandidatesRef.current.splice(0);
    await Promise.all(candidates.map((candidate) => peer.addIceCandidate(candidate).catch(() => undefined)));
  }, []);

  const getMedia = useCallback(async (nextMode: CallMode) => {
    const { stream, effectiveMode } = await getCallMedia(nextMode, cameraFacing);
    setLocalStream(stream);
    setMicEnabled(true);
    setMode(effectiveMode);
    setCameraEnabled(effectiveMode === "video");
    if (nextMode === "video" && effectiveMode === "audio") {
      showToast({ variant: "info", title: "Camera unavailable", description: "Starting as an audio call instead." });
    }
    return { stream, effectiveMode };
  }, [cameraFacing, showToast]);

  const handleOffer = useCallback(
    async (message: Extract<SignalingMessage, { type: "call-offer" }>) => {
      if (!user || !supabase) return;
      if (!activeRef.current || activeRef.current.callId !== message.callId) {
        pendingOfferRef.current = message.offer;
        return;
      }
      const peer = createPeer(message.callId, message.from);
      await peer.setRemoteDescription(message.offer);
      await addPendingCandidates();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendSignal({ type: "call-answer", callId: message.callId, from: user.uid, to: message.from, answer });
      transitionTo("connecting");
    },
    [addPendingCandidates, createPeer, sendSignal, supabase, transitionTo, user]
  );

  const acceptCall = useCallback(async () => {
    if (!incoming || !user) return;
    try {
      stopRingtone();
      transitionTo("acquiring_media");
      const { stream, effectiveMode } = await getMedia(incoming.mode);
      const peer = createPeer(incoming.callId, incoming.from.id);
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const nextActive = { callId: incoming.callId, peer: incoming.from, conversationId: incoming.conversationId, mode: effectiveMode };
      setActive(nextActive);
      activeRef.current = nextActive;
      setIncoming(null);
      transitionTo("connecting");
      if (pendingOfferRef.current) {
        await peer.setRemoteDescription(pendingOfferRef.current);
        pendingOfferRef.current = null;
        await addPendingCandidates();
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendSignal({ type: "call-answer", callId: incoming.callId, from: user.uid, to: incoming.from.id, answer });
      }
    } catch {
      showToast({ variant: "error", title: "Call failed", description: "Check camera and microphone permissions." });
      sendSignal({ type: "call-reject", callId: incoming.callId, from: user.uid, to: incoming.from.id, reason: "media-denied" });
      await resetCall("failed");
    }
  }, [addPendingCandidates, createPeer, getMedia, incoming, resetCall, sendSignal, showToast, stopRingtone, transitionTo, user]);

  const rejectCall = useCallback(async () => {
    if (!incoming || !user) return;
    sendSignal({ type: "call-reject", callId: incoming.callId, from: user.uid, to: incoming.from.id, reason: "rejected" });
    await resetCall("rejected");
  }, [incoming, resetCall, sendSignal, user]);

  const endCall = useCallback(
    async (reason = "ended") => {
      const call = activeRef.current;
      if (call && user) {
        sendSignal({ type: "call-end", callId: call.callId, from: user.uid, to: call.peer.id, reason });
      }
      await resetCall();
    },
    [resetCall, sendSignal, user]
  );

  const handleMessage = useCallback(
    async (raw: MessageEvent<string>) => {
      if (!user || !supabase) return;
      const message = JSON.parse(raw.data) as SignalingMessage;
      if (message.type === "call-initiate") {
        if (message.to !== user.uid) return;
        if (statusRef.current !== "idle") {
          sendSignal({ type: "call-busy", callId: message.callId, from: user.uid, to: message.from });
          return;
        }
        const caller = await getProfile(supabase, message.from);
        if (!caller) return;
        transitionTo("incoming_ringing");
        setMode(message.mode);
        setIncoming({ callId: message.callId, from: caller, mode: message.mode, conversationId: message.conversationId });
        notifyIncomingCall({
          conversationId: message.conversationId,
          title: `Incoming ${message.mode} call`,
          body: `${caller.full_name} is calling you`
        });
        startRingtone(message.conversationId);
      }
      if (message.type === "call-offer") await handleOffer(message);
      if (message.type === "call-answer" && peerRef.current && activeRef.current?.callId === message.callId) {
        await peerRef.current.setRemoteDescription(message.answer);
        await addPendingCandidates();
        transitionTo("connecting");
      }
      if (message.type === "ice-candidate") {
        const belongsToActiveCall = activeRef.current?.callId === message.callId;
        const belongsToIncomingCall = incomingRef.current?.callId === message.callId;
        if (belongsToActiveCall || belongsToIncomingCall) {
          if (peerRef.current?.remoteDescription) await peerRef.current.addIceCandidate(message.candidate).catch(() => undefined);
          else pendingCandidatesRef.current.push(message.candidate);
        }
      }
      if (message.type === "call-reject" || message.type === "call-busy" || message.type === "call-unavailable") {
        showToast({
          variant: "info",
          title: "Call ended",
          description: message.type === "call-busy" ? "The contact is already in a call." : unavailableMessage(message.reason)
        });
        await resetCall(message.type === "call-busy" ? "busy" : message.type === "call-reject" ? "rejected" : message.reason === "offline" ? "missed" : "ended");
      }
      if (message.type === "call-end") {
        await resetCall(message.reason === "missed" ? "missed" : "ended");
      }
      if (message.type === "error") showToast({ variant: "error", title: "Calling error", description: message.message });
    },
    [addPendingCandidates, handleOffer, notifyIncomingCall, resetCall, sendSignal, showToast, startRingtone, supabase, transitionTo, user]
  );

  useEffect(() => {
    handleMessageRef.current = (event) => void handleMessage(event);
  }, [handleMessage]);

  useEffect(() => {
    resetCallRef.current = () => resetCall();
  }, [resetCall]);

  const connectSocket = useCallback(async () => {
    const userId = user?.uid;
    if (!userId || socketIsOpeningOrOpen(socketRef.current)) return;
    shouldReconnectRef.current = true;
    await warmSignalingServer();
    if (!shouldReconnectRef.current || socketIsOpeningOrOpen(socketRef.current)) return;
    const socket = new WebSocket(signalingUrl());
    socketRef.current = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: "register", userId } satisfies SignalingMessage));
    socket.onmessage = (event) => handleMessageRef.current(event);
    socket.onclose = () => {
      socketRef.current = null;
      if (shouldReconnectRef.current) window.setTimeout(() => void connectSocketRef.current(), 1500);
    };
  }, [user?.uid]);

  useEffect(() => {
    connectSocketRef.current = connectSocket;
  }, [connectSocket]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    void connectSocket();
    return () => {
      shouldReconnectRef.current = false;
      socketRef.current?.close();
      socketRef.current = null;
      void resetCallRef.current();
    };
  }, [connectSocket]);

  const startCall = useCallback(
    async (peer: UserProfile, conversationId: string, nextMode: CallMode) => {
      if (!user || !supabase) return;
      if (statusRef.current !== "idle") {
        showToast({ variant: "info", title: "A call is already active" });
        return;
      }
      const callId = crypto.randomUUID();
      try {
        await waitForSignaling();
        transitionTo("acquiring_media");
        const { stream, effectiveMode } = await getMedia(nextMode);
        const connection = createPeer(callId, peer.id);
        stream.getTracks().forEach((track) => connection.addTrack(track, stream));
        const nextActive = { callId, peer, conversationId, mode: effectiveMode };
        setActive(nextActive);
        activeRef.current = nextActive;
        await writeCallSession(callId, {
          conversation_id: conversationId,
          caller_id: user.uid,
          callee_id: peer.id,
          mode: effectiveMode,
          status: "ringing"
        });
        transitionTo("outgoing_ringing");
        sendSignal({ type: "call-initiate", callId, from: user.uid, to: peer.id, mode: effectiveMode, conversationId });
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        sendSignal({ type: "call-offer", callId, from: user.uid, to: peer.id, offer });
      } catch (error) {
        showToast({ variant: "error", title: "Could not start call", description: error instanceof Error ? error.message : "Check permissions and try again." });
        await resetCall("failed");
      }
    },
    [createPeer, getMedia, resetCall, sendSignal, showToast, supabase, transitionTo, user, waitForSignaling, writeCallSession]
  );

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
    const call = activeRef.current;
    const peer = peerRef.current;
    if (!call || !peer || !user || !localStream) return;
    try {
      if (mode === "audio") {
        const videoStream = await getVideoStreamForFacing(cameraFacing);
        const [track] = videoStream.getVideoTracks();
        localStream.addTrack(track);
        peer.addTrack(track, localStream);
        setMode("video");
        setCameraEnabled(true);
      } else {
        localStream.getVideoTracks().forEach((track) => {
          track.stop();
          localStream.removeTrack(track);
          const sender = peer.getSenders().find((item) => item.track === track);
          if (sender) peer.removeTrack(sender);
        });
        setMode("audio");
        setCameraEnabled(false);
      }
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      sendSignal({ type: "call-offer", callId: call.callId, from: user.uid, to: call.peer.id, offer });
    } catch {
      showToast({ variant: "error", title: "Camera unavailable", description: "Allow camera access to switch to video." });
    }
  }, [cameraFacing, localStream, mode, sendSignal, showToast, user]);

  const rotateCamera = useCallback(async () => {
    const peer = peerRef.current;
    if (!localStream || !peer || !localStream.getVideoTracks().length) return;
    const nextFacing = cameraFacing === "user" ? "environment" : "user";
    const currentTrack = localStream.getVideoTracks()[0];
    const currentDeviceId = currentTrack?.getSettings().deviceId;
    const sender = peer.getSenders().find((item) => item.track?.kind === "video");
    localStream.removeTrack(currentTrack);
    currentTrack.stop();
    try {
      const videoStream = await getVideoStreamForFacing(nextFacing, { avoidDeviceId: currentDeviceId, requireDifferentDevice: true });
      const [nextTrack] = videoStream.getVideoTracks();
      localStream.addTrack(nextTrack);
      await sender?.replaceTrack(nextTrack);
      setCameraFacing(nextFacing);
      setCameraEnabled(nextTrack.enabled);
      setLocalStream(new MediaStream(localStream.getTracks()));
    } catch {
      try {
        const restoreStream = await getVideoStreamForFacing(cameraFacing);
        const [restoreTrack] = restoreStream.getVideoTracks();
        localStream.addTrack(restoreTrack);
        await sender?.replaceTrack(restoreTrack);
        setLocalStream(new MediaStream(localStream.getTracks()));
      } catch {
        setCameraEnabled(false);
      }
      showToast({ variant: "error", title: "Could not rotate camera", description: "Your browser did not provide another camera." });
    }
  }, [cameraFacing, localStream, showToast]);

  const value = useMemo(() => ({ status, mode, startCall }), [mode, startCall, status]);

  return (
    <CallContext.Provider value={value}>
      {children}
      <Modal open={Boolean(incoming)} title="Incoming call" onClose={() => void rejectCall()}>
        {incoming ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={incoming.from.full_name} src={incoming.from.avatar_url} size="lg" />
              <div>
                <p className="font-semibold text-ink dark:text-white">{incoming.from.full_name}</p>
                <p className="text-sm text-ink/60 dark:text-white/60">{incoming.mode === "video" ? "Video call" : "Audio call"}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void acceptCall()}>Accept</Button>
              <Button variant="danger" onClick={() => void rejectCall()}>Reject</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {active ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/70 p-0 backdrop-blur-sm sm:p-4">
          <div className="flex h-[100dvh] w-full flex-col overflow-hidden border border-white/15 bg-neutral-950 text-white shadow-soft sm:h-[min(760px,calc(100vh-2rem))] sm:w-[min(1040px,calc(100vw-2rem))] sm:rounded-lg">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-3">
                <Avatar name={active.peer.full_name} src={active.peer.avatar_url} />
                <div>
                  <p className="font-semibold">{active.peer.full_name}</p>
                  <p className="capitalize text-sm text-white/60">{readableCallStatus(status)}</p>
                </div>
              </div>
              <Button variant="danger" onClick={() => void endCall()}>
                <PhoneOff className="h-4 w-4" />
                End
              </Button>
            </div>
            <div className="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-[1fr_280px]">
              <div className="relative overflow-hidden rounded-lg bg-black">
                <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
                {!remoteStream?.getVideoTracks().length ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Avatar name={active.peer.full_name} src={active.peer.avatar_url} size="lg" />
                  </div>
                ) : null}
              </div>
              <div className="flex min-h-0 flex-col gap-3">
                <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                  <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
                  {!localStream?.getVideoTracks().length ? (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">Audio only</div>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={toggleMic}>{micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />} Mic</Button>
                  <Button variant="secondary" onClick={toggleCamera} disabled={!localStream?.getVideoTracks().length}>{cameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />} Camera</Button>
                  {isMobileBrowser && localStream?.getVideoTracks().length ? (
                    <Button variant="secondary" className="col-span-2 md:hidden" onClick={() => void rotateCamera()}>
                      <RotateCcw className="h-4 w-4" />
                      Rotate camera
                    </Button>
                  ) : null}
                  <Button variant="secondary" className="col-span-2" onClick={() => void switchMode()}>
                    {mode === "audio" ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                    {mode === "audio" ? "Switch to video" : "Switch to audio"}
                  </Button>
                </div>
                <p className="text-xs leading-5 text-white/55">
                  WebRTC carries media directly. The WebSocket only exchanges offers, answers, and ICE candidates.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </CallContext.Provider>
  );
}

export function useCalls() {
  const context = useContext(CallContext);
  if (!context) throw new Error("useCalls must be used inside CallProvider.");
  return context;
}
