import { NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

type NotificationPreferencesBody = {
  messagesEnabled?: boolean;
  callsEnabled?: boolean;
  missedCallsEnabled?: boolean;
  showMessagePreview?: boolean;
  soundEnabled?: boolean;
};

type NotificationSettingsRow = {
  user_id: string;
  browser_notifications_enabled: boolean;
  ringtone_enabled: boolean;
  messages_enabled: boolean | null;
  calls_enabled: boolean | null;
  missed_calls_enabled: boolean | null;
  show_message_preview: boolean | null;
  sound_enabled: boolean | null;
  notifications_prompted_at: string | null;
};

function preferencesFromRow(row: NotificationSettingsRow | null) {
  const enabled = row?.browser_notifications_enabled ?? false;
  return {
    messagesEnabled: row?.messages_enabled ?? enabled,
    callsEnabled: row?.calls_enabled ?? enabled,
    missedCallsEnabled: row?.missed_calls_enabled ?? enabled,
    showMessagePreview: row?.show_message_preview ?? true,
    soundEnabled: row?.sound_enabled ?? row?.ringtone_enabled ?? true
  };
}

async function loadOrCreateSettings(userId: string) {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("notification_settings")
    .select("user_id,browser_notifications_enabled,ringtone_enabled,messages_enabled,calls_enabled,missed_calls_enabled,show_message_preview,sound_enabled,notifications_prompted_at")
    .eq("user_id", userId)
    .maybeSingle<NotificationSettingsRow>();
  if (error) throw new Error(error.message);
  if (data) return data;

  const { data: created, error: createError } = await supabase
    .from("notification_settings")
    .insert({
      user_id: userId,
      browser_notifications_enabled: false,
      ringtone_enabled: true,
      messages_enabled: false,
      calls_enabled: false,
      missed_calls_enabled: false,
      show_message_preview: true,
      sound_enabled: true,
      notifications_prompted_at: new Date().toISOString()
    })
    .select("user_id,browser_notifications_enabled,ringtone_enabled,messages_enabled,calls_enabled,missed_calls_enabled,show_message_preview,sound_enabled,notifications_prompted_at")
    .single<NotificationSettingsRow>();
  if (createError) throw new Error(createError.message);
  return created;
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const settings = await loadOrCreateSettings(decoded.uid);
    return NextResponse.json(preferencesFromRow(settings));
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not load notification preferences." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const body = (await request.json()) as NotificationPreferencesBody;
    const enabled = Boolean(body.messagesEnabled || body.callsEnabled || body.missedCallsEnabled);
    const soundEnabled = body.soundEnabled ?? true;
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("notification_settings")
      .upsert(
        {
          user_id: decoded.uid,
          browser_notifications_enabled: enabled,
          ringtone_enabled: soundEnabled,
          messages_enabled: body.messagesEnabled ?? false,
          calls_enabled: body.callsEnabled ?? false,
          missed_calls_enabled: body.missedCallsEnabled ?? false,
          show_message_preview: body.showMessagePreview ?? true,
          sound_enabled: soundEnabled,
          notifications_prompted_at: new Date().toISOString()
        },
        { onConflict: "user_id" }
      )
      .select("user_id,browser_notifications_enabled,ringtone_enabled,messages_enabled,calls_enabled,missed_calls_enabled,show_message_preview,sound_enabled,notifications_prompted_at")
      .single<NotificationSettingsRow>();
    if (error) throw new Error(error.message);
    return NextResponse.json(preferencesFromRow(data));
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not save notification preferences." },
      { status: 500 }
    );
  }
}
