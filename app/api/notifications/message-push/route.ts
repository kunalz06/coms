import { NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { sendWebPushToUsers } from "@/lib/push-notifications";
import { createServiceSupabase } from "@/lib/supabase";
import type { Conversation, Message, MessageKind, UserProfile } from "@/types";

export const runtime = "nodejs";

type MessagePushBody = {
  messageId?: string;
};

type NotificationSettingRow = {
  user_id: string;
  browser_notifications_enabled: boolean;
};

type ConversationMuteRow = {
  user_id: string;
  muted_until: string | null;
};

function messagePreview(kind: MessageKind, content: string | null, senderName: string) {
  if (kind === "text" && content) return content.length > 140 ? `${content.slice(0, 137)}...` : content;
  if (kind === "voice") return `${senderName} sent a voice note`;
  if (kind === "document") return `${senderName} sent a document`;
  return `${senderName} sent an image`;
}

function isMuted(row: ConversationMuteRow) {
  return !row.muted_until || new Date(row.muted_until).getTime() > Date.now();
}

export async function POST(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const { messageId } = (await request.json()) as MessagePushBody;
    if (!messageId) return NextResponse.json({ message: "Missing message id." }, { status: 400 });

    const supabase = createServiceSupabase();
    const { data: message, error: messageError } = await supabase
      .from("messages")
      .select("*")
      .eq("id", messageId)
      .single<Message>();
    if (messageError || !message) return NextResponse.json({ message: "Message not found." }, { status: 404 });
    if (message.sender_id !== decoded.uid) return NextResponse.json({ message: "Cannot notify for another user's message." }, { status: 403 });

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", message.conversation_id)
      .single<Conversation>();
    if (conversationError || !conversation) return NextResponse.json({ message: "Conversation not found." }, { status: 404 });

    let recipientIds: string[] = [];
    if (conversation.type === "group") {
      const { data: members, error } = await supabase
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conversation.id)
        .neq("user_id", message.sender_id)
        .returns<Array<{ user_id: string }>>();
      if (error) throw error;
      recipientIds = members.map((member) => member.user_id);
    } else {
      recipientIds = [conversation.user_one_id, conversation.user_two_id].filter((id): id is string => Boolean(id && id !== message.sender_id));
    }

    if (!recipientIds.length) return NextResponse.json({ sent: 0 });

    const [{ data: settings, error: settingsError }, { data: mutes, error: mutesError }, { data: sender, error: senderError }] = await Promise.all([
      supabase
        .from("notification_settings")
        .select("user_id,browser_notifications_enabled")
        .in("user_id", recipientIds)
        .eq("browser_notifications_enabled", true)
        .returns<NotificationSettingRow[]>(),
      supabase
        .from("conversation_mutes")
        .select("user_id,muted_until")
        .eq("conversation_id", conversation.id)
        .in("user_id", recipientIds)
        .returns<ConversationMuteRow[]>(),
      supabase.from("user_profiles").select("*").eq("id", message.sender_id).single<UserProfile>()
    ]);
    if (settingsError) throw settingsError;
    if (mutesError) throw mutesError;
    if (senderError) throw senderError;

    const enabledRecipients = new Set(settings.map((setting) => setting.user_id));
    const mutedRecipients = new Set((mutes ?? []).filter(isMuted).map((mute) => mute.user_id));
    const finalRecipients = recipientIds.filter((id) => enabledRecipients.has(id) && !mutedRecipients.has(id));
    if (!finalRecipients.length) return NextResponse.json({ sent: 0 });

    const senderName = sender.full_name || "Someone";
    const title = conversation.type === "group" ? conversation.title ?? "Group message" : senderName;
    const body = messagePreview(message.kind, message.content, senderName);
    const result = await sendWebPushToUsers(supabase, finalRecipients, {
      type: "message",
      title,
      body,
      tag: `message:${conversation.id}`,
      url: "/app",
      conversationId: conversation.id
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not send message notification." }, { status: 500 });
  }
}
