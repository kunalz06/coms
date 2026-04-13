import type { WebSocket } from "ws";

const MAX_GROUP_CALL_PARTICIPANTS = 10;

type ClientSocket = WebSocket & {
  userId?: string;
};

type GroupCallMessage =
  | { type: "group-call-start"; requestId: string; from: string; conversationId: string; mode: "audio" | "video" }
  | { type: "group-call-join"; requestId: string; from: string; conversationId: string; mode: "audio" | "video" }
  | { type: "group-call-leave"; requestId?: string; from: string; conversationId: string }
  | { type: "group-call-end"; requestId?: string; from: string; conversationId: string }
  | { type: "group-call-offer"; from: string; to: string; conversationId: string; offer: unknown }
  | { type: "group-call-answer"; from: string; to: string; conversationId: string; answer: unknown }
  | { type: "group-call-ice-candidate"; from: string; to: string; conversationId: string; candidate: unknown };

type GroupCallSession = {
  conversationId: string;
  hostId: string;
  mode: "audio" | "video";
  invitedUserIds: Set<string>;
  participantIds: Set<string>;
  startedAt: number;
};

type SendToUser = (userId: string, payload: unknown) => void;
type VerifyMembership = (conversationId: string, userId: string) => Promise<boolean>;
type ListMembers = (conversationId: string) => Promise<string[]>;
type CanEndCall = (conversationId: string, userId: string) => Promise<boolean>;
type IsUserOnline = (userId: string) => boolean;
type SendPush = (userId: string) => Promise<boolean>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function isGroupCallMessage(message: unknown): message is GroupCallMessage {
  return isRecord(message) && typeof message.type === "string" && message.type.startsWith("group-call-");
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Group call signaling failed.";
}

export class GroupCallInviteManager {
  private readonly sessions = new Map<string, GroupCallSession>();
  private readonly socketsByUser = new WeakMap<ClientSocket, string>();

  constructor(
    private readonly verifyMembership: VerifyMembership,
    private readonly listMembers: ListMembers,
    private readonly canEndCall: CanEndCall,
    private readonly sendToUser: SendToUser,
    private readonly isUserOnline: IsUserOnline,
    private readonly sendPush: SendPush
  ) {}

  async handle(socket: ClientSocket, message: GroupCallMessage) {
    try {
      switch (message.type) {
        case "group-call-start":
          await this.start(socket, message);
          return;
        case "group-call-join":
          await this.join(socket, message);
          return;
        case "group-call-leave":
          this.leave(message.conversationId, message.from, message.requestId);
          return;
        case "group-call-end":
          await this.end(message);
          return;
        case "group-call-offer":
        case "group-call-answer":
        case "group-call-ice-candidate":
          await this.relay(message);
          return;
      }
    } catch (error) {
      this.respond(message.from, "requestId" in message ? message.requestId : undefined, false, null, toErrorMessage(error));
    }
  }

  leaveBySocket(socket: ClientSocket) {
    const conversationId = this.socketsByUser.get(socket);
    if (socket.userId && conversationId) this.leave(conversationId, socket.userId);
  }

  notifyAvailableCallsForUser(userId: string) {
    this.sessions.forEach((session) => {
      if (!session.invitedUserIds.has(userId) || session.participantIds.has(userId)) return;
      this.sendToUser(userId, {
        type: "group-call-available",
        conversationId: session.conversationId,
        from: session.hostId,
        mode: session.mode,
        participantCount: session.participantIds.size,
        startedAt: session.startedAt
      });
    });
  }

  private async start(socket: ClientSocket, message: Extract<GroupCallMessage, { type: "group-call-start" }>) {
    const memberIds = await this.allowedMemberIds(message.conversationId, message.from);
    let session = this.sessions.get(message.conversationId);
    if (!session) {
      session = {
        conversationId: message.conversationId,
        hostId: message.from,
        mode: message.mode,
        invitedUserIds: new Set(memberIds),
        participantIds: new Set(),
        startedAt: Date.now()
      };
      this.sessions.set(message.conversationId, session);
    }

    this.joinSession(socket, session, message.from, message.requestId);

    for (const userId of memberIds) {
      if (userId !== message.from) {
        this.sendToUser(userId, { type: "group-call-invite", conversationId: message.conversationId, from: message.from, mode: session.mode });
        if (!this.isUserOnline(userId)) void this.sendPush(userId);
      }
    }
  }

  private async join(socket: ClientSocket, message: Extract<GroupCallMessage, { type: "group-call-join" }>) {
    const session = this.sessions.get(message.conversationId);
    if (!session) throw new Error("This group call has ended.");
    await this.allowedMemberIds(message.conversationId, message.from);
    this.joinSession(socket, session, message.from, message.requestId);
  }

  private joinSession(socket: ClientSocket, session: GroupCallSession, userId: string, requestId: string) {
    const existingParticipantIds = [...session.participantIds].filter((participantId) => participantId !== userId);
    if (!session.participantIds.has(userId) && session.participantIds.size >= MAX_GROUP_CALL_PARTICIPANTS) {
      throw new Error("Group calls are limited to 10 people in this MVP.");
    }

    session.participantIds.add(userId);
    session.invitedUserIds.add(userId);
    this.socketsByUser.set(socket, session.conversationId);

    this.respond(userId, requestId, true, {
      conversationId: session.conversationId,
      mode: session.mode,
      hostId: session.hostId,
      participantIds: existingParticipantIds
    });

    existingParticipantIds.forEach((participantId) => {
      this.sendToUser(participantId, { type: "group-call-peer-joined", conversationId: session.conversationId, userId });
    });
  }

  private async relay(message: Extract<GroupCallMessage, { type: "group-call-offer" | "group-call-answer" | "group-call-ice-candidate" }>) {
    const session = this.sessions.get(message.conversationId);
    const isValidPair = session?.participantIds.has(message.from) && session.participantIds.has(message.to);
    const isMember = await this.verifyMembership(message.conversationId, message.from);
    if (!session || !isValidPair || !isMember) return;
    this.sendToUser(message.to, message);
  }

  private async allowedMemberIds(conversationId: string, userId: string) {
    const [isMember, memberIds] = await Promise.all([this.verifyMembership(conversationId, userId), this.listMembers(conversationId)]);
    if (!isMember) throw new Error("You are not a member of this group.");
    return memberIds.slice(0, MAX_GROUP_CALL_PARTICIPANTS);
  }

  private async end(message: Extract<GroupCallMessage, { type: "group-call-end" }>) {
    const session = this.sessions.get(message.conversationId);
    if (!session) {
      this.respond(message.from, message.requestId, true, { ended: true });
      return;
    }
    const canEnd = session.hostId === message.from || (await this.canEndCall(message.conversationId, message.from));
    if (!canEnd) throw new Error("Only the call host, group owner, or group admins can end the call for everyone.");

    this.notifyInvitees(session, { type: "group-call-ended", conversationId: message.conversationId, userId: message.from, endedBy: message.from });
    this.respond(message.from, message.requestId, true, { ended: true });
    this.sessions.delete(message.conversationId);
  }

  private leave(conversationId: string, userId: string, requestId?: string) {
    const session = this.sessions.get(conversationId);
    if (!session || !session.participantIds.has(userId)) {
      this.respond(userId, requestId, true, { left: true, ended: true });
      return;
    }
    session.participantIds.delete(userId);
    session.participantIds.forEach((participantId) => {
      this.sendToUser(participantId, { type: "group-call-peer-left", conversationId, userId });
    });
    if (session.participantIds.size > 0) {
      this.respond(userId, requestId, true, {
        left: true,
        ended: false,
        conversationId,
        from: session.hostId,
        mode: session.mode,
        participantCount: session.participantIds.size,
        startedAt: session.startedAt
      });
      this.sendToUser(userId, {
        type: "group-call-available",
        conversationId,
        from: session.hostId,
        mode: session.mode,
        participantCount: session.participantIds.size,
        startedAt: session.startedAt
      });
      return;
    }
    this.notifyInvitees(session, { type: "group-call-ended", conversationId, userId });
    this.respond(userId, requestId, true, { left: true, ended: true });
    this.sessions.delete(conversationId);
  }

  private notifyInvitees(session: GroupCallSession, payload: unknown) {
    session.invitedUserIds.forEach((userId) => this.sendToUser(userId, payload));
  }

  private respond(userId: string, requestId: string | undefined, ok: boolean, data?: unknown, error?: string) {
    if (!requestId) return;
    this.sendToUser(userId, { type: "group-call-response", requestId, ok, data, error });
  }
}
