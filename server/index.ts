import { createServer } from "node:http";
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
}

function forward(message: RoutedSignal) {
  sendToUser(message.to, message);
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

const groupCalls = new GroupCallInviteManager(userIsConversationMember, conversationMemberIds, sendToUser);

void app.prepare().then(() => {
  const handleUpgrade = app.getUpgradeHandler();
  const server = createServer((request, response) => {
    if (request.url === "/healthz") {
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
            console.log("Direct call unavailable", { callId: directMessage.callId, from: directMessage.from, to: directMessage.to, reason: "offline" });
            send(socket, { type: "call-unavailable", callId: directMessage.callId, from: directMessage.to, to: directMessage.from, reason: "offline" });
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

        forward(directMessage as RoutedSignal);
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
