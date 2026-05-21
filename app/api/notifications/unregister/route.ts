import { NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("notification_settings")
      .upsert(
        {
          user_id: decoded.uid,
          browser_notifications_enabled: false,
          notifications_prompted_at: new Date().toISOString()
        },
        { onConflict: "user_id" }
      );
    if (error) throw new Error(error.message);
    return NextResponse.json({ unregistered: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not unregister notification token." },
      { status: 500 }
    );
  }
}
