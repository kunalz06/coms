export type UserProfile = {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  status: "online" | "offline";
  last_seen: string | null;
  created_at: string;
  updated_at: string;
};

export type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "accepted" | "removed";
  created_at: string;
  updated_at: string;
  friend?: UserProfile;
  latest_message?: Message | null;
  unread_count?: number;
};

export type Conversation = {
  id: string;
  type: "direct" | "group";
  title: string | null;
  avatar_url: string | null;
  created_by: string | null;
  user_one_id: string | null;
  user_two_id: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationMemberRole = "owner" | "admin" | "member";

export type ConversationMember = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: ConversationMemberRole;
  joined_at: string;
  last_read_at: string | null;
  profile?: UserProfile;
};

export type GroupConversation = Conversation & {
  type: "group";
  members?: ConversationMember[];
  latest_message?: Message | null;
  unread_count?: number;
};

export type ChatTarget =
  | { kind: "direct"; friend: UserProfile }
  | { kind: "group"; conversation: GroupConversation };

export type MessageKind = "text" | "image" | "document" | "voice";
export type MessageStatus = "sending" | "sent" | "failed" | "delivered" | "read";

export type Attachment = {
  id: string;
  message_id: string;
  url: string;
  public_id: string | null;
  resource_type: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: MessageKind;
  content: string | null;
  status: MessageStatus;
  created_at: string;
  updated_at: string;
  attachments?: Attachment[];
};

export type Block = {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
  blocked_profile?: UserProfile;
};

export type CallMode = "audio" | "video";
export type CallLogStatus = "ringing" | "connecting" | "connected" | "reconnecting" | "rejected" | "missed" | "busy" | "ended" | "failed";
export type CallStatus =
  | "idle"
  | "outgoing_ringing"
  | "incoming_ringing"
  | "acquiring_media"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ending"
  | "ended"
  | "failed";

export type CallSession = {
  id: string;
  conversation_id: string | null;
  caller_id: string;
  callee_id: string;
  mode: CallMode;
  status: CallLogStatus;
  started_at: string;
  ended_at: string | null;
  failure_reason: string | null;
};

export type SignalingMessage =
  | { type: "register"; userId: string }
  | { type: "presence"; userId: string; status: "online" | "offline" }
  | { type: "call-initiate"; callId: string; from: string; to: string; mode: CallMode; conversationId: string }
  | { type: "call-offer"; callId: string; from: string; to: string; offer: RTCSessionDescriptionInit }
  | { type: "call-answer"; callId: string; from: string; to: string; answer: RTCSessionDescriptionInit }
  | { type: "ice-candidate"; callId: string; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: "call-reject"; callId: string; from: string; to: string; reason?: string }
  | { type: "call-end"; callId: string; from: string; to: string; reason?: string }
  | { type: "call-busy"; callId: string; from: string; to: string }
  | { type: "call-unavailable"; callId: string; from: string; to: string; reason?: string }
  | { type: "error"; message: string };

export type UploadKind = "avatar" | "image" | "document" | "voice";
