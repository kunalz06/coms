import type { WebSocket } from "ws";
import { randomUUID } from "node:crypto";

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
  | { type: "group-call-ice-candidate"; from: string; to: string; conversationId: string; candidate: unknown }
  | { type: "group-call-share-request"; requestId: string; from: string; conversationId: string }
  | { type: "group-call-share-decision"; from: string; to: string; conversationId: string; approved: boolean }
  | { type: "group-call-share-status"; from: string; conversationId: string; enabled: boolean };

type GroupCallSession = {
  id: string;
  conversationId: string;
  hostId: string;
  mode: "audio" | "video";
  invitedUserIds: Set<string>;
  participantIds: Set<string>;
  approvedScreenSharers: Set<string>;
  startedAt: number;
};

type SendToUser = (userId: string, payload: unknown) => void;
type VerifyMembership = (conversationId: string, userId: string) => Promise<boolean>;
type ListMembers = (conversationId: string) => Promise<string[]>;
type CanEndCall = (conversationId: string, userId: string) => Promise<boolean>;
type IsUserOnline = (userId: string) => boolean;
type SendPush = (userId: string) => Promise<boolean>;
type PersistGroupCall = {
  start: (session: GroupCallSession) => Promise<void>;
  join: (session: GroupCallSession, userId: string) => Promise<void>;
  leave: (session: GroupCallSession, userId: string) => Promise<void>;
  end: (session: GroupCallSession, status: "ended" | "failed", reason?: string) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512;
}

function isMode(value: unknown): value is "audio" | "video" {
  return value === "audio" || value === "video";
}

export function isGroupCallMessage(message: unknown): message is GroupCallMessage {
  if (!isRecord(message) || typeof message.type !== "string" || !message.type.startsWith("group-call-")) return false;
  if (!isNonEmptyString(message.from) || !isNonEmptyString(message.conversationId)) return false;
  switch (message.type) {
    case "group-call-start":
    case "group-call-join":
      return isNonEmptyString(message.requestId) && isMode(message.mode);
    case "group-call-leave":
    case "group-call-end":
      return message.requestId === undefined || isNonEmptyString(message.requestId);
    case "group-call-offer":
      return isNonEmptyString(message.to) && "offer" in message;
    case "group-call-answer":
      return isNonEmptyString(message.to) && "answer" in message;
    case "group-call-ice-candidate":
      return isNonEmptyString(message.to) && "candidate" in message;
    case "group-call-share-request":
      return isNonEmptyString(message.requestId);
    case "group-call-share-decision":
      return isNonEmptyString(message.to) && typeof message.approved === "boolean";
    case "group-call-share-status":
      return typeof message.enabled === "boolean";
    default:
      return false;
  }
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
    private readonly sendPush: SendPush,
    private readonly persist?: PersistGroupCall
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
        case "group-call-share-request":
          await this.requestShare(message);
          return;
        case "group-call-share-decision":
          await this.shareDecision(message);
          return;
        case "group-call-share-status":
          await this.shareStatus(message);
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
        id: randomUUID(),
        conversationId: message.conversationId,
        hostId: message.from,
        mode: message.mode,
        invitedUserIds: new Set(memberIds),
        participantIds: new Set(),
        approvedScreenSharers: new Set([message.from]),
        startedAt: Date.now()
      };
      const createdSession = session;
      this.sessions.set(message.conversationId, createdSession);
      await this.persist?.start(createdSession).catch((error) => console.error("Group call start persistence failed", { conversationId: createdSession.conversationId, message: toErrorMessage(error) }));
    }

    const activeSession = session;
    await this.joinSession(socket, activeSession, message.from, message.requestId);

    for (const userId of memberIds) {
      if (userId !== message.from) {
        this.sendToUser(userId, { type: "group-call-invite", conversationId: message.conversationId, from: message.from, mode: activeSession.mode });
        if (!this.isUserOnline(userId)) void this.sendPush(userId);
      }
    }
  }

  private async join(socket: ClientSocket, message: Extract<GroupCallMessage, { type: "group-call-join" }>) {
    const session = this.sessions.get(message.conversationId);
    if (!session) throw new Error("This group call has ended.");
    await this.allowedMemberIds(message.conversationId, message.from);
    await this.joinSession(socket, session, message.from, message.requestId);
  }

  private async joinSession(socket: ClientSocket, session: GroupCallSession, userId: string, requestId: string) {
    const existingParticipantIds = [...session.participantIds].filter((participantId) => participantId !== userId);
    if (!session.participantIds.has(userId) && session.participantIds.size >= MAX_GROUP_CALL_PARTICIPANTS) {
      throw new Error("Group calls are limited to 10 people in this MVP.");
    }

    const wasAlreadyParticipant = session.participantIds.has(userId);
    session.participantIds.add(userId);
    session.invitedUserIds.add(userId);
    if (await this.isPrivilegedSharer(session, userId)) {
      session.approvedScreenSharers.add(userId);
    }
    this.socketsByUser.set(socket, session.conversationId);
    if (!wasAlreadyParticipant) {
      await this.persist?.join(session, userId).catch((error) => console.error("Group call join persistence failed", { conversationId: session.conversationId, userId, message: toErrorMessage(error) }));
    }

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
    await this.persist?.end(session, "ended").catch((error) => console.error("Group call end persistence failed", { conversationId: session.conversationId, message: toErrorMessage(error) }));
    this.sessions.delete(message.conversationId);
  }

  private async requestShare(message: Extract<GroupCallMessage, { type: "group-call-share-request" }>) {
    const session = this.sessions.get(message.conversationId);
    if (!session || !session.participantIds.has(message.from)) {
      throw new Error("This group call has ended.");
    }
    const canShareDirectly = await this.isPrivilegedSharer(session, message.from);
    if (canShareDirectly) {
      session.approvedScreenSharers.add(message.from);
      this.respond(message.from, message.requestId, true, { approved: true });
      return;
    }

    const approvers = [...session.participantIds].filter((participantId) => participantId !== message.from);
    let sent = 0;
    for (const approverId of approvers) {
      if (!(await this.isPrivilegedSharer(session, approverId))) continue;
      this.sendToUser(approverId, {
        type: "group-call-share-request",
        conversationId: session.conversationId,
        from: message.from
      });
      sent += 1;
    }
    if (sent === 0) {
      this.respond(message.from, message.requestId, false, null, "No owner/admin/call-starter is available to approve screen sharing.");
      return;
    }
    this.respond(message.from, message.requestId, true, { requested: true });
  }

  private async shareDecision(message: Extract<GroupCallMessage, { type: "group-call-share-decision" }>) {
    const session = this.sessions.get(message.conversationId);
    if (!session || !session.participantIds.has(message.to) || !session.participantIds.has(message.from)) return;
    const canApprove = await this.isPrivilegedSharer(session, message.from);
    if (!canApprove) {
      throw new Error("Only owner/admin/call-starter can approve screen sharing.");
    }
    if (message.approved) {
      session.approvedScreenSharers.add(message.to);
    } else {
      session.approvedScreenSharers.delete(message.to);
    }
    this.sendToUser(message.to, {
      type: "group-call-share-decision",
      conversationId: message.conversationId,
      from: message.from,
      approved: message.approved
    });
  }

  private async shareStatus(message: Extract<GroupCallMessage, { type: "group-call-share-status" }>) {
    const session = this.sessions.get(message.conversationId);
    if (!session || !session.participantIds.has(message.from)) return;
    const privileged = await this.isPrivilegedSharer(session, message.from);
    const allowed = privileged || session.approvedScreenSharers.has(message.from);
    if (!allowed) {
      throw new Error("Screen sharing approval is required.");
    }
    session.participantIds.forEach((participantId) => {
      if (participantId === message.from) return;
      this.sendToUser(participantId, {
        type: "group-call-share-status",
        conversationId: message.conversationId,
        from: message.from,
        enabled: message.enabled
      });
    });
  }

  private async isPrivilegedSharer(session: GroupCallSession, userId: string) {
    if (session.hostId === userId) return true;
    return this.canEndCall(session.conversationId, userId);
  }

  private leave(conversationId: string, userId: string, requestId?: string) {
    const session = this.sessions.get(conversationId);
    if (!session || !session.participantIds.has(userId)) {
      this.respond(userId, requestId, true, { left: true, ended: true });
      return;
    }
    session.participantIds.delete(userId);
    session.approvedScreenSharers.delete(userId);
    void this.persist?.leave(session, userId).catch((error) => console.error("Group call leave persistence failed", { conversationId, userId, message: toErrorMessage(error) }));
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
    void this.persist?.end(session, "ended").catch((error) => console.error("Group call end persistence failed", { conversationId, message: toErrorMessage(error) }));
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
