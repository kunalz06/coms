import { createServer, type ServerResponse } from "node:http";
import next from "next";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { GroupCallInviteManager, isGroupCallMessage } from "./group-call-invites";

type Signal =
  | { type: "register"; userId: string }
  | { type: "call-initiate"; callId: string; from: string; to: string; mode: "audio" | "video"; conversationId: string }
  | { type: "call-offer"; callId: string; from: string; to: string; offer: unknown }
  | { type: "call-answer"; callId: string; from: string; to: string; answer: unknown }
  | { type: "ice-candidate"; callId: string; from: string; to: string; candidate: unknown }
  | { type: "call-reject"; callId: string; from: string; to: string; reason?: string }
  | { type: "call-left"; callId: string; from: string; to: string; reason?: string }
  | { type: "call-join"; callId: string; from: string; to: string; mode: "audio" | "video"; conversationId: string }
  | { type: "call-available"; callId: string; from: string; to: string; mode: "audio" | "video"; conversationId: string }
  | { type: "call-end"; callId: string; from: string; to: string; reason?: string }
  | { type: "call-busy"; callId: string; from: string; to: string }
  | { type: "call-unavailable"; callId: string; from: string; to: string; reason?: string };

type RoutedSignal = Exclude<Signal, { type: "register" }>;
type PendingDirectCall = {
  callId: string;
  from: string;
  to: string;
  conversationId: string;
  mode: "audio" | "video";
  expiresAt: number;
  signals: RoutedSignal[];
};
type DirectCallSession = {
  callId: string;
  from: string;
  to: string;
  conversationId: string;
  mode: "audio" | "video";
};
type DirectConversationRow = {
  id: string;
  type: "direct" | "group";
  user_one_id: string | null;
  user_two_id: string | null;
};
type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};
type PushPayload = {
  type: string;
  title: string;
  body: string;
  tag?: string;
  url?: string;
  conversationId?: string;
};

type ClientSocket = WebSocket & {
  userId?: string;
  isAlive?: boolean;
  messageQueue?: Promise<void>;
};

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const clients = new Map<string, Set<ClientSocket>>();
const activeCallsByUser = new Map<string, string>();
const participantsByCall = new Map<string, Set<string>>();
const directCallSessions = new Map<string, DirectCallSession>();
const pendingDirectCallsByUser = new Map<string, PendingDirectCall[]>();
const DIRECT_CALL_RING_MS = 45_000;
const MAX_PENDING_SIGNALS_PER_CALL = 80;
const MAX_SIGNALING_BYTES = 96 * 1024;
const SELF_PING_INTERVAL_MS = 5 * 60 * 1000;

function writeCorsHeaders(response: ServerResponse, origin?: string) {
  const configured = process.env.ALLOWED_ORIGIN?.trim();
  if (!configured || configured === "*") {
    response.setHeader("access-control-allow-origin", "*");
  } else if (origin && allowedOrigin(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "origin");
  }
  response.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type, authorization");
  response.setHeader("access-control-max-age", "86400");
}

function serviceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function allowedOrigin(origin: string | undefined) {
  const configured = process.env.ALLOWED_ORIGIN?.trim();
  if (!configured || configured === "*") return true;
  if (!origin) return false;
  return configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(origin);
}

function rejectUpgrade(socket: { write: (chunk: string) => unknown; destroy: () => void }, statusCode: number, reason: string) {
  socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function selfPingUrl() {
  const explicit = process.env.SELF_PING_URL?.trim();
  if (explicit) return explicit;
  const renderHost = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
  if (renderHost) return `https://${renderHost}/healthz`;
  return `http://127.0.0.1:${port}/healthz`;
}

function startSelfPing() {
  const url = selfPingUrl();
  const ping = async () => {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) {
        console.warn("Self ping returned a non-OK response", {
          status: response.status,
          url
        });
      }
    } catch (error) {
      console.warn("Self ping failed", {
        url,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };
  const timer = setInterval(() => {
    void ping();
  }, SELF_PING_INTERVAL_MS);
  timer.unref?.();
  void ping();
  return timer;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512;
}

function isCallMode(value: unknown): value is "audio" | "video" {
  return value === "audio" || value === "video";
}

function isDirectSignal(message: Signal | Record<string, unknown>): message is Signal {
  const candidate = message as Record<string, unknown>;
  if (typeof candidate.type !== "string") return false;
  if (candidate.type === "register") return isNonEmptyString(candidate.userId);
  if (
    ![
      "call-initiate",
      "call-offer",
      "call-answer",
      "ice-candidate",
      "call-reject",
      "call-left",
      "call-join",
      "call-end",
      "call-busy",
      "call-unavailable"
    ].includes(candidate.type)
  ) {
    return false;
  }
  if (!isNonEmptyString(candidate.callId) || !isNonEmptyString(candidate.from) || !isNonEmptyString(candidate.to)) return false;
  if (candidate.from === candidate.to) return false;
  if (candidate.type === "call-initiate") return isCallMode(candidate.mode) && isNonEmptyString(candidate.conversationId);
  if (candidate.type === "call-join") return isCallMode(candidate.mode) && isNonEmptyString(candidate.conversationId);
  return true;
}

async function usersAreBlocked(a: string, b: string) {
  const supabase = serviceSupabase();
  if (!supabase) return { blocked: false, reason: null };
  const { data, error } = await supabase
    .from("blocks")
    .select("id")
    .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`)
    .maybeSingle();
  if (error) {
    console.error("Call block check failed", { callerId: a, calleeId: b, message: error.message });
    return { blocked: true, reason: "block-check-failed" };
  }
  return { blocked: Boolean(data), reason: data ? "blocked" : null };
}

async function verifyDirectConversation(conversationId: string, callerId: string, calleeId: string) {
  const supabase = serviceSupabase();
  if (!supabase) return { ok: true, reason: null };
  const { data, error } = await supabase
    .from("conversations")
    .select("id,type,user_one_id,user_two_id")
    .eq("id", conversationId)
    .maybeSingle<DirectConversationRow>();
  if (error) {
    console.error("Direct call conversation check failed", { conversationId, callerId, calleeId, message: error.message });
    return { ok: false, reason: "conversation-check-failed" };
  }
  if (!data || data.type !== "direct") return { ok: false, reason: "conversation-not-found" };
  const participants = new Set([data.user_one_id, data.user_two_id].filter(Boolean));
  return { ok: participants.has(callerId) && participants.has(calleeId), reason: participants.has(callerId) && participants.has(calleeId) ? null : "not-a-participant" };
}

async function upsertDirectCallSession(message: Extract<Signal, { type: "call-initiate" }>, status: "ringing" | "busy" | "missed" | "failed" = "ringing", failureReason?: string) {
  const supabase = serviceSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("call_sessions").upsert({
    id: message.callId,
    conversation_id: message.conversationId,
    caller_id: message.from,
    callee_id: message.to,
    mode: message.mode,
    status,
    ended_at: status === "ringing" ? null : new Date().toISOString(),
    failure_reason: failureReason ?? null
  });
  if (error) console.error("Direct call log upsert failed", { callId: message.callId, status, message: error.message });
}

async function updateDirectCallSession(callId: string, status: "connecting" | "connected" | "reconnecting" | "rejected" | "missed" | "busy" | "ended" | "failed", failureReason?: string) {
  const supabase = serviceSupabase();
  if (!supabase) return;
  const shouldEnd = ["rejected", "missed", "busy", "ended", "failed"].includes(status);
  const { error } = await supabase
    .from("call_sessions")
    .update({
      status,
      ended_at: shouldEnd ? new Date().toISOString() : null,
      failure_reason: failureReason ?? null
    })
    .eq("id", callId);
  if (error) console.error("Direct call log update failed", { callId, status, message: error.message });
}

async function userIsConversationMember(conversationId: string, userId: string) {
  const supabase = serviceSupabase();
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("conversation_members")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

async function userCanModerateGroupCall(conversationId: string, userId: string) {
  const supabase = serviceSupabase();
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("conversation_members")
    .select("role")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle<{ role: "owner" | "admin" | "member" }>();
  if (error) return false;
  return data?.role === "owner" || data?.role === "admin";
}

async function conversationMemberIds(conversationId: string) {
  const supabase = serviceSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .returns<Array<{ user_id: string }>>();
  if (error) return [];
  return data.map((member) => member.user_id);
}

const groupCallPersistence = {
  async start(session: { id: string; conversationId: string; hostId: string; mode: "audio" | "video" }) {
    const supabase = serviceSupabase();
    if (!supabase) return;
    const { error } = await supabase.from("group_call_sessions").upsert({
      id: session.id,
      conversation_id: session.conversationId,
      started_by: session.hostId,
      mode: session.mode,
      status: "active",
      started_at: new Date().toISOString(),
      ended_at: null,
      failure_reason: null
    });
    if (error) throw error;
  },
  async join(session: { id: string }, userId: string) {
    const supabase = serviceSupabase();
    if (!supabase) return;
    const { error } = await supabase.from("group_call_participants").upsert(
      {
        session_id: session.id,
        user_id: userId,
        joined_at: new Date().toISOString(),
        left_at: null
      },
      { onConflict: "session_id,user_id" }
    );
    if (error) throw error;
  },
  async leave(session: { id: string }, userId: string) {
    const supabase = serviceSupabase();
    if (!supabase) return;
    const { error } = await supabase
      .from("group_call_participants")
      .update({ left_at: new Date().toISOString() })
      .eq("session_id", session.id)
      .eq("user_id", userId);
    if (error) throw error;
  },
  async end(session: { id: string }, status: "ended" | "failed", reason?: string) {
    const supabase = serviceSupabase();
    if (!supabase) return;
    const { error } = await supabase
      .from("group_call_sessions")
      .update({
        status,
        ended_at: new Date().toISOString(),
        failure_reason: reason ?? null
      })
      .eq("id", session.id);
    if (error) throw error;
  }
};

function send(socket: WebSocket | undefined, payload: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function sendToUser(userId: string, payload: unknown) {
  clients.get(userId)?.forEach((socket) => send(socket, payload));
}

function addClient(userId: string, socket: ClientSocket) {
  const sockets = clients.get(userId) ?? new Set<ClientSocket>();
  sockets.add(socket);
  clients.set(userId, sockets);
}

function removeClient(userId: string, socket: ClientSocket) {
  const sockets = clients.get(userId);
  if (!sockets) return false;
  sockets.delete(socket);
  if (sockets.size) return false;
  clients.delete(userId);
  return true;
}

function hasClient(userId: string) {
  return Boolean(clients.get(userId)?.size);
}

function clearCall(callId: string) {
  for (const [userId, currentCallId] of activeCallsByUser.entries()) {
    if (currentCallId === callId) activeCallsByUser.delete(userId);
  }
  participantsByCall.delete(callId);
  directCallSessions.delete(callId);
  for (const [userId, calls] of pendingDirectCallsByUser.entries()) {
    const nextCalls = calls.filter((call) => call.callId !== callId);
    if (nextCalls.length) pendingDirectCallsByUser.set(userId, nextCalls);
    else pendingDirectCallsByUser.delete(userId);
  }
}

function getDirectSession(callId: string) {
  return directCallSessions.get(callId) ?? null;
}

function parkDirectCall(userId: string, callId: string, reason = "left") {
  const session = getDirectSession(callId);
  if (!session) return null;
  if (activeCallsByUser.get(userId) !== callId) return session;
  activeCallsByUser.delete(userId);
  const peerId = session.from === userId ? session.to : session.from;
  sendToUser(peerId, { type: "call-left", callId, from: userId, to: peerId, reason });
  sendToUser(userId, { type: "call-available", callId, from: peerId, to: userId, mode: session.mode, conversationId: session.conversationId });
  return session;
}

function registerDirectCall(call: DirectCallSession) {
  directCallSessions.set(call.callId, call);
  activeCallsByUser.set(call.from, call.callId);
  activeCallsByUser.set(call.to, call.callId);
  participantsByCall.set(call.callId, new Set([call.from, call.to]));
}

function directCallsForUser(userId: string) {
  return [...directCallSessions.values()].filter((session) => session.from === userId || session.to === userId);
}

function forward(message: RoutedSignal) {
  sendToUser(message.to, message);
}

function pendingCallForUser(userId: string, callId: string) {
  return pendingDirectCallsByUser.get(userId)?.find((call) => call.callId === callId);
}

function queuePendingSignal(message: RoutedSignal) {
  const call = pendingCallForUser(message.to, message.callId);
  if (!call) return false;
  if (Date.now() > call.expiresAt) {
    void updateDirectCallSession(message.callId, "missed", "ring-timeout");
    sendToUser(call.from, { type: "call-end", callId: call.callId, from: call.to, to: call.from, reason: "missed" });
    clearCall(message.callId);
    return false;
  }
  if (call.signals.length >= MAX_PENDING_SIGNALS_PER_CALL) return true;
  call.signals.push(message);
  return true;
}

function flushPendingDirectCallsForUser(userId: string) {
  const calls = pendingDirectCallsByUser.get(userId);
  if (!calls?.length) return;
  const now = Date.now();
  const activeCalls = calls.filter((call) => call.expiresAt > now);
  const expiredCalls = calls.filter((call) => call.expiresAt <= now);
  pendingDirectCallsByUser.delete(userId);
  expiredCalls.forEach((call) => {
    void updateDirectCallSession(call.callId, "missed", "ring-timeout");
    clearCall(call.callId);
  });
  activeCalls.forEach((call) => {
    call.signals.forEach((signal) => sendToUser(userId, signal));
  });
}

function expirePendingDirectCalls() {
  const now = Date.now();
  for (const [userId, calls] of pendingDirectCallsByUser.entries()) {
    const activeCalls = calls.filter((call) => call.expiresAt > now);
    const expiredCalls = calls.filter((call) => call.expiresAt <= now);
    expiredCalls.forEach((call) => {
      sendToUser(call.from, { type: "call-end", callId: call.callId, from: call.to, to: call.from, reason: "missed" });
      void updateDirectCallSession(call.callId, "missed", "ring-timeout");
      clearCall(call.callId);
    });
    if (activeCalls.length) pendingDirectCallsByUser.set(userId, activeCalls);
    else pendingDirectCallsByUser.delete(userId);
  }
}

let vapidConfigured = false;

function configureVapid() {
  if (vapidConfigured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@comms.local", publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

async function sendPushToUser(userId: string, payload?: PushPayload) {
  const supabase = serviceSupabase();
  if (!supabase || !configureVapid()) return false;

  const { data: setting, error: settingError } = await supabase
    .from("notification_settings")
    .select("browser_notifications_enabled")
    .eq("user_id", userId)
    .maybeSingle<{ browser_notifications_enabled: boolean }>();
  if (settingError || setting?.browser_notifications_enabled !== true) return false;

  const { data, error } = await supabase.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", userId).returns<PushSubscriptionRow[]>();
  if (error || !data?.length) return false;

  const body = JSON.stringify(
    payload ?? {
      type: "call",
      title: "Incoming COMMS call",
      body: "Open COMMS to answer.",
      tag: `call:${userId}`,
      url: "/calls"
    }
  );
  const results = await Promise.all(
    data.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth
            }
          },
          body,
          { TTL: 60, urgency: "high" }
        );
        return true;
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        }
        return false;
      }
    })
  );

  return results.some(Boolean);
}

function parseMessage(raw: RawData) {
  try {
    const size = Array.isArray(raw) ? raw.reduce((total, item) => total + item.length, 0) : Buffer.isBuffer(raw) ? raw.length : raw.byteLength;
    if (size > MAX_SIGNALING_BYTES) return null;
    const message = JSON.parse(raw.toString()) as Signal | Record<string, unknown>;
    if (!message || typeof message.type !== "string") return null;
    return message;
  } catch {
    return null;
  }
}

const groupCalls = new GroupCallInviteManager(userIsConversationMember, conversationMemberIds, userCanModerateGroupCall, sendToUser, hasClient, sendPushToUser, groupCallPersistence);

void app.prepare().then(() => {
  const handleUpgrade = app.getUpgradeHandler();
  const server = createServer((request, response) => {
    const requestUrl = request.url ?? "/";
    const isApiRequest = requestUrl.startsWith("/api/");
    if (isApiRequest) {
      writeCorsHeaders(response, request.headers.origin);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
    }

    if (request.url === "/healthz") {
      writeCorsHeaders(response, request.headers.origin);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, service: "comms-signaling" }));
      return;
    }
    void handle(request, response);
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (url.pathname !== "/ws") {
      void handleUpgrade(request, socket, head);
      return;
    }
    if (!allowedOrigin(request.headers.origin)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket: ClientSocket) => {
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (raw) => {
      socket.messageQueue = (socket.messageQueue ?? Promise.resolve()).then(async () => {
        const message = parseMessage(raw);
        if (!message) {
          send(socket, { type: "error", message: "Invalid signaling message." });
          return;
        }

        if (!isGroupCallMessage(message) && !isDirectSignal(message)) {
          send(socket, { type: "error", message: "Unsupported signaling message." });
          return;
        }

        if (message.type === "register") {
          socket.userId = message.userId;
          addClient(message.userId, socket);
          console.log("Signaling client registered", { userId: message.userId, sockets: clients.get(message.userId)?.size ?? 0 });
          groupCalls.notifyAvailableCallsForUser(message.userId);
          for (const session of directCallsForUser(message.userId)) {
            if (activeCallsByUser.get(message.userId) === session.callId) continue;
            const peerId = session.from === message.userId ? session.to : session.from;
            send(socket, {
              type: "call-available",
              callId: session.callId,
              from: peerId,
              to: message.userId,
              mode: session.mode,
              conversationId: session.conversationId
            });
          }
          flushPendingDirectCallsForUser(message.userId);
          return;
        }

        const from = "from" in message && typeof message.from === "string" ? message.from : null;
        if (!socket.userId || socket.userId !== from) {
          send(socket, { type: "error", message: "Signaling identity mismatch." });
          return;
        }

        if (isGroupCallMessage(message)) {
          await groupCalls.handle(socket, message);
          return;
        }

        const directMessage = message as Signal;

        if (directMessage.type === "call-initiate") {
          const conversationState = await verifyDirectConversation(directMessage.conversationId, directMessage.from, directMessage.to);
          if (!conversationState.ok) {
            console.log("Direct call unavailable", { callId: directMessage.callId, from: directMessage.from, to: directMessage.to, reason: conversationState.reason });
            await upsertDirectCallSession(directMessage, "failed", conversationState.reason ?? "invalid-conversation");
            send(socket, { type: "call-unavailable", callId: directMessage.callId, from: directMessage.to, to: directMessage.from, reason: conversationState.reason ?? "invalid-conversation" });
            return;
          }
          const blockState = await usersAreBlocked(directMessage.from, directMessage.to);
          if (blockState.blocked) {
            console.log("Direct call unavailable", { callId: directMessage.callId, from: directMessage.from, to: directMessage.to, reason: blockState.reason });
            await upsertDirectCallSession(directMessage, "failed", blockState.reason ?? "blocked");
            send(socket, { type: "call-unavailable", callId: directMessage.callId, from: directMessage.to, to: directMessage.from, reason: blockState.reason ?? "blocked" });
            return;
          }
          if (activeCallsByUser.has(directMessage.from) || activeCallsByUser.has(directMessage.to)) {
            await upsertDirectCallSession(directMessage, "busy", "busy");
            send(socket, { type: "call-busy", callId: directMessage.callId, from: directMessage.to, to: directMessage.from });
            return;
          }
          await upsertDirectCallSession(directMessage, "ringing");
          registerDirectCall({
            callId: directMessage.callId,
            from: directMessage.from,
            to: directMessage.to,
            conversationId: directMessage.conversationId,
            mode: directMessage.mode
          });
          if (!hasClient(directMessage.to)) {
            const pushSent = await sendPushToUser(directMessage.to, {
              type: "call",
              title: directMessage.mode === "video" ? "Incoming video call" : "Incoming audio call",
              body: "Open COMMS to answer.",
              tag: `call:${directMessage.callId}`,
              url: "/calls",
              conversationId: directMessage.conversationId
            });
            if (!pushSent) {
              console.log("Direct call unavailable", { callId: directMessage.callId, from: directMessage.from, to: directMessage.to, reason: "offline" });
              await updateDirectCallSession(directMessage.callId, "missed", "offline");
              send(socket, { type: "call-unavailable", callId: directMessage.callId, from: directMessage.to, to: directMessage.from, reason: "offline" });
              return;
            }
            pendingDirectCallsByUser.set(directMessage.to, [
              ...(pendingDirectCallsByUser.get(directMessage.to) ?? []),
              {
                callId: directMessage.callId,
                from: directMessage.from,
                to: directMessage.to,
                conversationId: directMessage.conversationId,
                mode: directMessage.mode,
                expiresAt: Date.now() + DIRECT_CALL_RING_MS,
                signals: [directMessage]
              }
            ]);
            console.log("Direct call push sent to offline recipient", { callId: directMessage.callId, from: directMessage.from, to: directMessage.to });
            return;
          }
          forward(directMessage);
          return;
        }

        if (directMessage.type === "call-left") {
          const session = getDirectSession(directMessage.callId);
          if (!session) return;
          parkDirectCall(directMessage.from, directMessage.callId, directMessage.reason ?? "left");
          await updateDirectCallSession(directMessage.callId, "reconnecting");
          return;
        }

        if (directMessage.type === "call-join") {
          const session = getDirectSession(directMessage.callId);
          if (!session) {
            send(socket, { type: "call-unavailable", callId: directMessage.callId, from: directMessage.to, to: directMessage.from, reason: "ended" });
            return;
          }
          if (session.from !== directMessage.from && session.to !== directMessage.from) {
            send(socket, { type: "call-unavailable", callId: directMessage.callId, from: directMessage.to, to: directMessage.from, reason: "not-a-participant" });
            return;
          }
          activeCallsByUser.set(directMessage.from, directMessage.callId);
          activeCallsByUser.set(directMessage.to, directMessage.callId);
          participantsByCall.set(directMessage.callId, new Set([session.from, session.to]));
          await updateDirectCallSession(directMessage.callId, "connecting");
          forward(directMessage);
          return;
        }

        if (directMessage.type === "call-end" || directMessage.type === "call-reject" || directMessage.type === "call-busy" || directMessage.type === "call-unavailable") {
          const nextStatus =
            directMessage.type === "call-reject"
              ? "rejected"
              : directMessage.type === "call-busy"
                ? "busy"
                : directMessage.type === "call-unavailable"
                  ? "failed"
                  : directMessage.reason === "missed"
                    ? "missed"
                    : "ended";
          await updateDirectCallSession(directMessage.callId, nextStatus, "reason" in directMessage ? directMessage.reason : undefined);
          clearCall(directMessage.callId);
          forward(directMessage);
          return;
        }

        if (directMessage.type === "register") return;
        const routedMessage = directMessage as RoutedSignal;
        const participants = participantsByCall.get(routedMessage.callId);
        if (!participants?.has(routedMessage.from) || !participants.has(routedMessage.to)) {
          send(socket, { type: "error", message: "This call is no longer active." });
          return;
        }
        if (routedMessage.type === "call-answer") void updateDirectCallSession(routedMessage.callId, "connecting");
        if (!queuePendingSignal(routedMessage)) forward(routedMessage);
      }).catch((error) => {
        console.error("Signaling message handling failed", { userId: socket.userId, message: error instanceof Error ? error.message : String(error) });
        send(socket, { type: "error", message: "Signaling failed. Try the call again." });
      });
    });

    socket.on("close", () => {
      if (!socket.userId) return;
      groupCalls.leaveBySocket(socket);
      const wasLastSocketForUser = removeClient(socket.userId, socket);
      console.log("Signaling client closed", { userId: socket.userId, remainingSockets: clients.get(socket.userId)?.size ?? 0 });
      if (!wasLastSocketForUser) return;
      const callId = activeCallsByUser.get(socket.userId);
      if (!callId) return;
      parkDirectCall(socket.userId, callId, "disconnect");
      void updateDirectCallSession(callId, "reconnecting");
    });
  });

  const heartbeat = setInterval(() => {
    expirePendingDirectCalls();
    wss.clients.forEach((socket: ClientSocket) => {
      if (!socket.isAlive) {
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, 30_000);
  const selfPing = startSelfPing();

  wss.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(selfPing);
  });

  server.listen(port, hostname, () => {
    console.log(`COMMS ready on http://${hostname}:${port}`);
  });
});
