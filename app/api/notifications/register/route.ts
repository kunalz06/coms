import { NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

type RegisterBody = {
  platform?: string;
  provider?: string;
  token?: string;
  userAgent?: string;
};

export async function POST(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const body = (await request.json()) as RegisterBody;
    if (body.platform !== "web_pwa" || body.provider !== "fcm") {
      return NextResponse.json({ message: "Unsupported notification device." }, { status: 400 });
    }
    if (!body.token?.trim()) {
      return NextResponse.json({ message: "Missing notification token." }, { status: 400 });
    }

    const supabase = createServiceSupabase();
    const { error } = await supabase.from("notification_settings").upsert(
      {
        user_id: decoded.uid,
        browser_notifications_enabled: true,
        notifications_prompted_at: new Date().toISOString()
      },
      { onConflict: "user_id" }
    );
    if (error) throw new Error(error.message);

    return NextResponse.json({ registered: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not register notification token." },
      { status: 500 }
    );
  }
}
