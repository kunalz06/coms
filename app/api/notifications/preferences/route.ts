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
  call_ringtone_enabled: boolean;
  notifications_prompted_at: string | null;
};

function preferencesFromRow(row: NotificationSettingsRow | null) {
  const enabled = row?.browser_notifications_enabled ?? false;
  return {
    messagesEnabled: enabled,
    callsEnabled: enabled,
    missedCallsEnabled: enabled,
    showMessagePreview: true,
    soundEnabled: row?.call_ringtone_enabled ?? true
  };
}

async function loadOrCreateSettings(userId: string) {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("notification_settings")
    .select("user_id,browser_notifications_enabled,call_ringtone_enabled,notifications_prompted_at")
    .eq("user_id", userId)
    .maybeSingle<NotificationSettingsRow>();
  if (error) throw new Error(error.message);
  if (data) return data;

  const { data: created, error: createError } = await supabase
    .from("notification_settings")
    .insert({
      user_id: userId,
      browser_notifications_enabled: false,
      call_ringtone_enabled: true,
      notifications_prompted_at: new Date().toISOString()
    })
    .select("user_id,browser_notifications_enabled,call_ringtone_enabled,notifications_prompted_at")
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
    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("notification_settings")
      .upsert(
        {
          user_id: decoded.uid,
          browser_notifications_enabled: enabled,
          call_ringtone_enabled: body.soundEnabled ?? true,
          notifications_prompted_at: new Date().toISOString()
        },
        { onConflict: "user_id" }
      )
      .select("user_id,browser_notifications_enabled,call_ringtone_enabled,notifications_prompted_at")
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
