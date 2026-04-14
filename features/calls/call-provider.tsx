"use client";

import { Maximize2, Mic, MicOff, Minimize2, PhoneOff, ScreenShare, ScreenShareOff, Video, VideoOff } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/features/auth/auth-provider";
import { useNotifications } from "@/features/notifications/notification-provider";
import { CALL_TIMEOUT_MS, canTransitionCall, readableCallStatus } from "@/lib/call-state";
import { getCallMedia, getScreenShareStream, getVideoStream } from "@/lib/media-devices";
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

export function CallProvider({ children }: { children: ReactNode }) {
  const { user, supabase } = useAuth();
  const { showToast } = useToast();
  const { notifyIncomingCall, startRingtone, stopRingtone } = useNotifications();
  const socketRef = useRef<WebSocket | null>(null);
  const handleMessageRef = useRef<(event: MessageEvent<string>) => void>(() => undefined);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingOfferRef = useRef<Extract<SignalingMessage, { type: "call-offer" }> | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const connectSocketRef = useRef<() => Promise<void>>(async () => undefined);
  const resetCallRef = useRef<() => Promise<void>>(async () => undefined);
  const shouldReconnectRef = useRef(true);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenSharePreviousModeRef = useRef<CallMode>("audio");
  const restoreCameraAfterShareRef = useRef(false);
  const callTimeoutRef = useRef<number | null>(null);
  const [status, setCallStatus] = useState<CallStatus>("idle");
  const [mode, setMode] = useState<CallMode>("audio");
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [parkedCall, setParkedCall] = useState<ActiveCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const statusRef = useRef(status);
  const activeRef = useRef(active);
  const incomingRef = useRef(incoming);
  const parkedCallRef = useRef(parkedCall);

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

  useEffect(() => {
    parkedCallRef.current = parkedCall;
  }, [parkedCall]);

  useEffect(() => attachStream(localStream, localVideoRef.current), [isCallMinimized, localStream]);
  useEffect(() => attachStream(remoteStream, remoteVideoRef.current), [isCallMinimized, remoteStream]);
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

  const parkActiveCall = useCallback(
    async (reason: "left" | "disconnect" = "left") => {
      const call = activeRef.current;
      if (!call) return;
      clearCallTimeout();
      peerRef.current?.close();
      if (screenTrackRef.current) {
        screenTrackRef.current.onended = null;
        screenTrackRef.current.stop();
      }
      peerRef.current = null;
      videoSenderRef.current = null;
      pendingCandidatesRef.current = [];
      pendingOfferRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      setIncoming(null);
      setActive(null);
      setParkedCall(call);
      setMode(call.mode);
      setMicEnabled(true);
      setCameraEnabled(call.mode === "video");
      setIsScreenSharing(false);
      setIsCallMinimized(false);
      forceStatus("idle");
      if (reason === "disconnect") {
        showToast({ variant: "info", title: "Call paused", description: "The other person left. You can rejoin while the call remains active." });
      }
    },
    [clearCallTimeout, forceStatus, showToast]
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
      if (screenTrackRef.current) {
        screenTrackRef.current.onended = null;
        screenTrackRef.current.stop();
        screenTrackRef.current = null;
      }
      peerRef.current?.getSenders().forEach((sender) => sender.track?.stop());
      peerRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
      peerRef.current = null;
      videoSenderRef.current = null;
      pendingCandidatesRef.current = [];
      pendingOfferRef.current = null;
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      setIncoming(null);
      setActive(null);
      setParkedCall(null);
      setMode("audio");
      setMicEnabled(true);
      setCameraEnabled(true);
      setIsScreenSharing(false);
      setIsCallMinimized(false);
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

  const replaceOutgoingVideoTrack = useCallback(async (track: MediaStreamTrack | null, stream: MediaStream | null) => {
    const peer = peerRef.current;
    if (!peer || !stream) return;
    const existingSender = videoSenderRef.current;
    if (existingSender && peer.getSenders().includes(existingSender)) {
      await existingSender.replaceTrack(track);
      if (!track) {
        peer.removeTrack(existingSender);
        videoSenderRef.current = null;
      }
      return;
    }
    if (track) videoSenderRef.current = peer.addTrack(track, stream);
  }, []);

  const renegotiateActiveCall = useCallback(async () => {
    const call = activeRef.current;
    const peer = peerRef.current;
    if (!call || !peer || !user) return;
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    sendSignal({ type: "call-offer", callId: call.callId, from: user.uid, to: call.peer.id, offer });
  }, [sendSignal, user]);

  const addPendingCandidates = useCallback(async () => {
    const peer = peerRef.current;
    if (!peer?.remoteDescription) return;
    const candidates = pendingCandidatesRef.current.splice(0);
    await Promise.all(candidates.map((candidate) => peer.addIceCandidate(candidate).catch(() => undefined)));
  }, []);

  const getMedia = useCallback(async (nextMode: CallMode) => {
    const { stream, effectiveMode } = await getCallMedia(nextMode);
    setLocalStream(stream);
    setMicEnabled(true);
    setMode(effectiveMode);
    setCameraEnabled(effectiveMode === "video");
    if (nextMode === "video" && effectiveMode === "audio") {
      showToast({ variant: "info", title: "Camera unavailable", description: "Starting as an audio call instead." });
    }
    return { stream, effectiveMode };
  }, [showToast]);

  const handleOffer = useCallback(
    async (message: Extract<SignalingMessage, { type: "call-offer" }>) => {
      if (!user || !supabase) return;
      if (!activeRef.current || activeRef.current.callId !== message.callId) {
        const currentIncoming = incomingRef.current;
        if (!currentIncoming || (currentIncoming.callId === message.callId && currentIncoming.from.id === message.from)) {
          pendingOfferRef.current = message;
        }
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

  const waitForPendingOffer = useCallback(async (callId: string, fromId: string) => {
    const existing = pendingOfferRef.current;
    if (existing?.callId === callId && existing.from === fromId) return existing;

    return new Promise<Extract<SignalingMessage, { type: "call-offer" }> | null>((resolve) => {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        const pending = pendingOfferRef.current;
        if (pending?.callId === callId && pending.from === fromId) {
          window.clearInterval(interval);
          resolve(pending);
          return;
        }
        if (Date.now() - startedAt > 5000) {
          window.clearInterval(interval);
          resolve(null);
        }
      }, 50);
    });
  }, []);

  const acceptCall = useCallback(async () => {
    if (!incoming || !user) return;
    try {
      stopRingtone();
      transitionTo("acquiring_media");
      const { stream, effectiveMode } = await getMedia(incoming.mode);
      const peer = createPeer(incoming.callId, incoming.from.id);
      stream.getTracks().forEach((track) => {
        const sender = peer.addTrack(track, stream);
        if (track.kind === "video") videoSenderRef.current = sender;
      });
      const nextActive = { callId: incoming.callId, peer: incoming.from, conversationId: incoming.conversationId, mode: effectiveMode };
      setActive(nextActive);
      activeRef.current = nextActive;
      setIncoming(null);
      transitionTo("connecting");
      const pendingOffer = await waitForPendingOffer(incoming.callId, incoming.from.id);
      if (pendingOffer) {
        await peer.setRemoteDescription(pendingOffer.offer);
        pendingOfferRef.current = null;
        await addPendingCandidates();
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendSignal({ type: "call-answer", callId: pendingOffer.callId, from: user.uid, to: pendingOffer.from, answer });
      } else if (!peer.remoteDescription) {
        throw new Error("Call offer was not received.");
      }
    } catch {
      showToast({ variant: "error", title: "Call failed", description: "Check camera and microphone permissions." });
      try {
        sendSignal({ type: "call-reject", callId: incoming.callId, from: user.uid, to: incoming.from.id, reason: "media-denied" });
      } catch {
        // The caller may already be disconnected; local cleanup still needs to finish.
      }
      await resetCall("failed");
    }
  }, [addPendingCandidates, createPeer, getMedia, incoming, resetCall, sendSignal, showToast, stopRingtone, transitionTo, user, waitForPendingOffer]);

  const rejectCall = useCallback(async () => {
    if (!incoming || !user) return;
    sendSignal({ type: "call-reject", callId: incoming.callId, from: user.uid, to: incoming.from.id, reason: "rejected" });
    await resetCall("rejected");
  }, [incoming, resetCall, sendSignal, user]);

  const leaveCall = useCallback(async () => {
    const call = activeRef.current;
    if (!call || !user) return;
    try {
      sendSignal({ type: "call-left", callId: call.callId, from: user.uid, to: call.peer.id, reason: "left" });
    } catch {
      // The peer may already be gone; we still park the local call state.
    }
    await parkActiveCall("left");
  }, [parkActiveCall, sendSignal, user]);

  const joinAvailableCall = useCallback(async () => {
    const call = parkedCallRef.current;
    if (!call || !user || !supabase) return;
    try {
      await waitForSignaling();
      transitionTo("acquiring_media");
      const { stream, effectiveMode } = await getMedia(call.mode);
      const peer = createPeer(call.callId, call.peer.id);
      stream.getTracks().forEach((track) => {
        const sender = peer.addTrack(track, stream);
        if (track.kind === "video") videoSenderRef.current = sender;
      });
      const nextActive = { ...call, mode: effectiveMode };
      setActive(nextActive);
      activeRef.current = nextActive;
      setParkedCall(null);
      setMode(effectiveMode);
      setCameraEnabled(effectiveMode === "video");
      transitionTo("connecting");
      await updateCallSession(call.callId, { status: "connecting" }).catch(() => undefined);
      sendSignal({ type: "call-join", callId: call.callId, from: user.uid, to: call.peer.id, mode: effectiveMode, conversationId: call.conversationId });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      sendSignal({ type: "call-offer", callId: call.callId, from: user.uid, to: call.peer.id, offer });
    } catch (error) {
      showToast({ variant: "error", title: "Could not rejoin call", description: error instanceof Error ? error.message : "Check camera and microphone permissions." });
      await parkActiveCall("left");
    }
  }, [createPeer, getMedia, parkActiveCall, sendSignal, showToast, supabase, transitionTo, updateCallSession, user, waitForSignaling]);

  const endCall = useCallback(
    async (reason = "ended") => {
      const call = activeRef.current ?? parkedCallRef.current;
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
      if (message.type === "call-left") {
        if (activeRef.current?.callId === message.callId) {
          peerRef.current?.close();
          peerRef.current = null;
          videoSenderRef.current = null;
          pendingCandidatesRef.current = [];
          pendingOfferRef.current = null;
          remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
          remoteStreamRef.current = null;
          setRemoteStream(null);
          setCameraEnabled(activeRef.current.mode === "video");
          transitionTo("reconnecting");
          void updateCallSession(message.callId, { status: "reconnecting" }).catch(() => undefined);
        }
      }
      if (message.type === "call-available") {
        if (parkedCallRef.current?.callId === message.callId) return;
        const peer = await getProfile(supabase, message.from);
        if (!peer) return;
        setParkedCall({
          callId: message.callId,
          peer,
          conversationId: message.conversationId,
          mode: message.mode
        });
        setActive(null);
        forceStatus("idle");
      }
      if (message.type === "call-join" && activeRef.current?.callId === message.callId) {
        transitionTo("connecting");
        await updateCallSession(message.callId, { status: "connecting" }).catch(() => undefined);
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
    [addPendingCandidates, forceStatus, handleOffer, notifyIncomingCall, resetCall, sendSignal, showToast, startRingtone, supabase, transitionTo, updateCallSession, user]
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
      if (statusRef.current !== "idle" || parkedCallRef.current) {
        showToast({ variant: "info", title: "A call is already active" });
        return;
      }
      const callId = crypto.randomUUID();
      try {
        await waitForSignaling();
        transitionTo("acquiring_media");
        const { stream, effectiveMode } = await getMedia(nextMode);
        const connection = createPeer(callId, peer.id);
        stream.getTracks().forEach((track) => {
          const sender = connection.addTrack(track, stream);
          if (track.kind === "video") videoSenderRef.current = sender;
        });
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

  const stopScreenShare = useCallback(
    async (restoreCamera = true) => {
      const screenTrack = screenTrackRef.current;
      const stream = localStreamRef.current;
      if (!screenTrack || !stream) return;

      screenTrack.onended = null;
      stream.removeTrack(screenTrack);
      if (screenTrack.readyState !== "ended") screenTrack.stop();
      screenTrackRef.current = null;
      setIsScreenSharing(false);

      let restoredCamera = false;
      if (restoreCamera && restoreCameraAfterShareRef.current) {
        try {
          const cameraStream = await getVideoStream();
          const [cameraTrack] = cameraStream.getVideoTracks();
          stream.addTrack(cameraTrack);
          await replaceOutgoingVideoTrack(cameraTrack, stream);
          setCameraEnabled(true);
          setMode("video");
          restoredCamera = true;
        } catch {
          showToast({ variant: "error", title: "Camera unavailable", description: "Screen sharing stopped, but the camera could not be restored." });
        }
      }

      if (!restoredCamera) {
        await replaceOutgoingVideoTrack(null, stream);
        setCameraEnabled(false);
        setMode(screenSharePreviousModeRef.current === "audio" ? "audio" : "video");
      }

      const nextStream = new MediaStream(stream.getTracks());
      localStreamRef.current = nextStream;
      setLocalStream(nextStream);
      await renegotiateActiveCall();
    },
    [renegotiateActiveCall, replaceOutgoingVideoTrack, showToast]
  );

  const toggleScreenShare = useCallback(async () => {
    const stream = localStreamRef.current;
    const call = activeRef.current;
    if (!stream || !call) return;

    if (isScreenSharing) {
      await stopScreenShare(true);
      return;
    }

    try {
      const displayStream = await getScreenShareStream();
      const [screenTrack] = displayStream.getVideoTracks();
      if (!screenTrack) throw new Error("No screen track was selected.");

      screenSharePreviousModeRef.current = mode;
      restoreCameraAfterShareRef.current = mode === "video" && cameraEnabled;
      stream.getVideoTracks().forEach((track) => {
        stream.removeTrack(track);
        track.stop();
      });
      stream.addTrack(screenTrack);
      screenTrackRef.current = screenTrack;
      screenTrack.onended = () => void stopScreenShare(true);

      await replaceOutgoingVideoTrack(screenTrack, stream);
      const nextStream = new MediaStream(stream.getTracks());
      localStreamRef.current = nextStream;
      setLocalStream(nextStream);
      setMode("video");
      setCameraEnabled(false);
      setIsScreenSharing(true);
      await renegotiateActiveCall();
    } catch (error) {
      showToast({
        variant: "error",
        title: "Screen sharing unavailable",
        description: error instanceof Error ? error.message : "Your browser did not allow screen sharing."
      });
    }
  }, [cameraEnabled, isScreenSharing, mode, renegotiateActiveCall, replaceOutgoingVideoTrack, showToast, stopScreenShare]);

  const toggleCamera = useCallback(async () => {
    const call = activeRef.current;
    const peer = peerRef.current;
    if (!call || !peer || !user || !localStream || mode !== "video" || isScreenSharing) return;

    try {
      if (cameraEnabled) {
        localStream.getVideoTracks().forEach((track) => {
          const sender = peer.getSenders().find((item) => item.track === track);
          if (sender) peer.removeTrack(sender);
          if (videoSenderRef.current === sender) videoSenderRef.current = null;
          localStream.removeTrack(track);
          track.stop();
        });
        setCameraEnabled(false);
      } else {
        const videoStream = await getVideoStream();
        const [track] = videoStream.getVideoTracks();
        localStream.addTrack(track);
        videoSenderRef.current = peer.addTrack(track, localStream);
        setCameraEnabled(true);
      }

      const nextStream = new MediaStream(localStream.getTracks());
      localStreamRef.current = nextStream;
      setLocalStream(nextStream);
      await renegotiateActiveCall();
    } catch {
      showToast({ variant: "error", title: "Camera unavailable", description: "Allow camera access to turn video on." });
    }
  }, [cameraEnabled, isScreenSharing, localStream, mode, renegotiateActiveCall, showToast, user]);

  const switchMode = useCallback(async () => {
    const call = activeRef.current;
    const peer = peerRef.current;
    if (!call || !peer || !user || !localStream || isScreenSharing) return;
    try {
      if (mode === "audio") {
        const videoStream = await getVideoStream();
        const [track] = videoStream.getVideoTracks();
        localStream.addTrack(track);
        videoSenderRef.current = peer.addTrack(track, localStream);
        setMode("video");
        setCameraEnabled(true);
        const nextStream = new MediaStream(localStream.getTracks());
        localStreamRef.current = nextStream;
        setLocalStream(nextStream);
      } else {
        localStream.getVideoTracks().forEach((track) => {
          track.stop();
          localStream.removeTrack(track);
          const sender = peer.getSenders().find((item) => item.track === track);
          if (sender) peer.removeTrack(sender);
          if (videoSenderRef.current === sender) videoSenderRef.current = null;
        });
        setMode("audio");
        setCameraEnabled(false);
        const nextStream = new MediaStream(localStream.getTracks());
        localStreamRef.current = nextStream;
        setLocalStream(nextStream);
      }
      await renegotiateActiveCall();
    } catch {
      showToast({ variant: "error", title: "Camera unavailable", description: "Allow camera access to switch to video." });
    }
  }, [isScreenSharing, localStream, mode, renegotiateActiveCall, showToast, user]);

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
              <Button onClick={() => void acceptCall()}>Join</Button>
              <Button variant="danger" onClick={() => void rejectCall()}>Reject</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {parkedCall ? (
        <div className="fixed bottom-4 left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 rounded-lg border border-white/15 bg-neutral-950 px-3 py-3 text-white shadow-soft sm:bottom-5">
          <div className="flex items-center justify-between gap-3">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => void joinAvailableCall()}>
              <Avatar name={parkedCall.peer.full_name} src={parkedCall.peer.avatar_url} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{parkedCall.peer.full_name}</span>
                <span className="block truncate text-xs text-white/65">Call is still active</span>
              </span>
            </button>
            <Button variant="secondary" className="h-9 px-3" onClick={() => void joinAvailableCall()}>
              <Maximize2 className="h-4 w-4" />
              Join
            </Button>
            <Button variant="danger" className="h-9 px-3" onClick={() => void endCall()}>
              <PhoneOff className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {active && isCallMinimized ? (
        <div className="fixed bottom-4 left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 rounded-lg border border-white/15 bg-neutral-950 px-3 py-3 text-white shadow-soft sm:bottom-5">
          <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
          <div className="flex items-center justify-between gap-3">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setIsCallMinimized(false)}>
              <Avatar name={active.peer.full_name} src={active.peer.avatar_url} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{active.peer.full_name}</span>
                <span className="block truncate text-xs text-white/65">{readableCallStatus(status)}</span>
              </span>
            </button>
            <Button variant="secondary" className="h-9 px-3" onClick={() => setIsCallMinimized(false)}>
              <Maximize2 className="h-4 w-4" />
              Open
            </Button>
            <Button variant="secondary" className="h-9 px-3" onClick={() => void leaveCall()}>
              <PhoneOff className="h-4 w-4" />
              Leave
            </Button>
            <Button variant="danger" className="h-9 px-3" onClick={() => void endCall()}>
              <PhoneOff className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {active && !isCallMinimized ? (
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
              <div className="flex items-center gap-2">
                <Button variant="secondary" className="h-9 px-3" onClick={() => setIsCallMinimized(true)}>
                  <Minimize2 className="h-4 w-4" />
                  Minimize
                </Button>
                <Button variant="secondary" className="h-9 px-3" onClick={() => void leaveCall()}>
                  <PhoneOff className="h-4 w-4" />
                  Leave
                </Button>
                <Button variant="danger" className="h-9 px-3" onClick={() => void endCall()}>
                  <PhoneOff className="h-4 w-4" />
                  End
                </Button>
              </div>
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
                  <Button variant="secondary" onClick={() => void toggleCamera()} disabled={mode === "audio" || isScreenSharing}>{cameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />} Camera</Button>
                  <Button variant="secondary" className="col-span-2" onClick={() => void toggleScreenShare()}>
                    {isScreenSharing ? <ScreenShareOff className="h-4 w-4" /> : <ScreenShare className="h-4 w-4" />}
                    {isScreenSharing ? "Stop sharing" : "Share screen"}
                  </Button>
                  <Button variant="secondary" className="col-span-2" onClick={() => void switchMode()} disabled={isScreenSharing}>
                    {mode === "audio" ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                    {mode === "audio" ? "Switch to video" : "Switch to audio"}
                  </Button>
                </div>
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
