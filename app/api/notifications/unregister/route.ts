import { NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

type UnregisterBody = {
  token?: string;
};

export async function POST(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const body = (await request.json().catch(() => ({}))) as UnregisterBody;
    const supabase = createServiceSupabase();
    const query = supabase
      .from("notification_devices")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("user_id", decoded.uid)
      .eq("provider", "fcm")
      .eq("platform", "web_pwa");
    const { error } = body.token?.trim()
      ? await query.eq("token", body.token.trim())
      : await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ unregistered: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not unregister notification token." },
      { status: 500 }
    );
  }
}
