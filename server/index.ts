import { createServer, type ServerResponse } from "node:http";
import { createPrivateKey, sign } from "node:crypto";
import next from "next";
import { createClient } from "@supabase/supabase-js";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { GroupCallInviteManager, isGroupCallMessage } from "./group-call-invites";

type Signal =
  | { type: "register"; userId: string }
  | { type: "call-initiate"; callId: string; from: string; to: string; mode: "audio" | "video"; conversationId: string }
  | { type: "call-offer"; callId: string; from: string; to: string; offer: unknown }
  | { type: "call-answer"; callId: string; from: string; to: string; answer: unknown }
  | { type: "ice-candidate"; callId: string; from: string; to: string; candidate: unknown }
  | { type: "call-reject"; callId: string; from: string; to: string; reason?: string }
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
const pendingDirectCallsByUser = new Map<string, PendingDirectCall[]>();
const DIRECT_CALL_RING_MS = 45_000;
const MAX_PENDING_SIGNALS_PER_CALL = 80;
const MAX_SIGNALING_BYTES = 96 * 1024;

function writeCorsHeaders(response: ServerResponse) {
  response.setHeader("access-control-allow-origin", process.env.ALLOWED_ORIGIN ?? "*");
  response.setHeader("access-control-allow-methods", "GET, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
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
  for (const [userId, calls] of pendingDirectCallsByUser.entries()) {
    const nextCalls = calls.filter((call) => call.callId !== callId);
    if (nextCalls.length) pendingDirectCallsByUser.set(userId, nextCalls);
    else pendingDirectCallsByUser.delete(userId);
  }
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

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function vapidPrivateKey() {
  try {
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
    if (!privateKey || !publicKey) return null;
    const publicBytes = Buffer.from(publicKey, "base64url");
    if (publicBytes.length !== 65 || publicBytes[0] !== 4) return null;
    return createPrivateKey({
      key: {
        kty: "EC",
        crv: "P-256",
        d: privateKey,
        x: publicBytes.subarray(1, 33).toString("base64url"),
        y: publicBytes.subarray(33, 65).toString("base64url")
      },
      format: "jwk"
    });
  } catch {
    return null;
  }
}

async function sendPushToUser(userId: string) {
  const supabase = serviceSupabase();
  const key = vapidPrivateKey();
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!supabase || !key || !publicKey) return false;

  const { data, error } = await supabase.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", userId).returns<PushSubscriptionRow[]>();
  if (error || !data?.length) return false;

  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@comms.local";
  const results = await Promise.all(
    data.map(async (subscription) => {
      const endpoint = new URL(subscription.endpoint);
      const jwtHeader = base64Url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
      const jwtPayload = base64Url(JSON.stringify({ aud: endpoint.origin, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject }));
      const signature = sign("sha256", Buffer.from(`${jwtHeader}.${jwtPayload}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
      const response = await fetch(subscription.endpoint, {
        method: "POST",
        headers: {
          authorization: `vapid t=${jwtHeader}.${jwtPayload}.${signature}, k=${publicKey}`,
          ttl: "60",
          urgency: "high"
        }
      });
      if (response.status === 404 || response.status === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
      }
      return response.ok || response.status === 201 || response.status === 202;
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
    if (request.url === "/healthz") {
      writeCorsHeaders(response);
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
          if (!hasClient(directMessage.to)) {
            const pushSent = await sendPushToUser(directMessage.to);
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
            activeCallsByUser.set(directMessage.from, directMessage.callId);
            activeCallsByUser.set(directMessage.to, directMessage.callId);
            participantsByCall.set(directMessage.callId, new Set([directMessage.from, directMessage.to]));
            console.log("Direct call push sent to offline recipient", { callId: directMessage.callId, from: directMessage.from, to: directMessage.to });
            return;
          }
          activeCallsByUser.set(directMessage.from, directMessage.callId);
          activeCallsByUser.set(directMessage.to, directMessage.callId);
          participantsByCall.set(directMessage.callId, new Set([directMessage.from, directMessage.to]));
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
      const participants = participantsByCall.get(callId) ?? new Set<string>();
      clearCall(callId);
      void updateDirectCallSession(callId, "ended", "disconnect");
      for (const peerId of participants) {
        if (peerId !== socket.userId) {
          sendToUser(peerId, { type: "call-end", callId, from: socket.userId, to: peerId, reason: "disconnect" });
        }
      }
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

  wss.on("close", () => clearInterval(heartbeat));

  server.listen(port, hostname, () => {
    console.log(`COMMS ready on http://${hostname}:${port}`);
  });
});
