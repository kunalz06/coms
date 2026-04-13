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
type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

type ClientSocket = WebSocket & {
  userId?: string;
  isAlive?: boolean;
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
    clearCall(message.callId);
    return false;
  }
  call.signals.push(message);
  return true;
}

function flushPendingDirectCallsForUser(userId: string) {
  const calls = pendingDirectCallsByUser.get(userId);
  if (!calls?.length) return;
  const now = Date.now();
  const activeCalls = calls.filter((call) => call.expiresAt > now);
  pendingDirectCallsByUser.delete(userId);
  activeCalls.forEach((call) => {
    call.signals.forEach((signal) => sendToUser(userId, signal));
  });
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
    const message = JSON.parse(raw.toString()) as Signal | Record<string, unknown>;
    if (!message || typeof message.type !== "string") return null;
    return message;
  } catch {
    return null;
  }
}

const groupCalls = new GroupCallInviteManager(userIsConversationMember, conversationMemberIds, userCanModerateGroupCall, sendToUser, hasClient, sendPushToUser);

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
      void (async () => {
        const message = parseMessage(raw);
        if (!message) {
          send(socket, { type: "error", message: "Invalid signaling message." });
          return;
        }

        if (message.type === "register" && "userId" in message && typeof message.userId === "string") {
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
          const blockState = await usersAreBlocked(directMessage.from, directMessage.to);
          if (blockState.blocked) {
            console.log("Direct call unavailable", { callId: directMessage.callId, from: directMessage.from, to: directMessage.to, reason: blockState.reason });
            send(socket, { type: "call-unavailable", callId: directMessage.callId, from: directMessage.to, to: directMessage.from, reason: blockState.reason ?? "blocked" });
            return;
          }
          if (activeCallsByUser.has(directMessage.from) || activeCallsByUser.has(directMessage.to)) {
            send(socket, { type: "call-busy", callId: directMessage.callId, from: directMessage.to, to: directMessage.from });
            return;
          }
          if (!hasClient(directMessage.to)) {
            const pushSent = await sendPushToUser(directMessage.to);
            if (!pushSent) {
              console.log("Direct call unavailable", { callId: directMessage.callId, from: directMessage.from, to: directMessage.to, reason: "offline" });
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
                expiresAt: Date.now() + 45_000,
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
          clearCall(directMessage.callId);
          forward(directMessage);
          return;
        }

        if (!queuePendingSignal(directMessage as RoutedSignal)) forward(directMessage as RoutedSignal);
      })();
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
      for (const peerId of participants) {
        if (peerId !== socket.userId) {
          sendToUser(peerId, { type: "call-end", callId, from: socket.userId, to: peerId, reason: "disconnect" });
        }
      }
    });
  });

  const heartbeat = setInterval(() => {
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
