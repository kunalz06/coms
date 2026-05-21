import { NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";
import { sendWebPushToUsers } from "@/lib/push-notifications";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const supabase = createServiceSupabase();
    const result = await sendWebPushToUsers(supabase, [decoded.uid], {
      type: "test",
      title: "COMMS",
      body: "Notifications are ready.",
      tag: "comms-test",
      url: "/settings/notifications"
    }).catch((error) => ({
      sent: 0,
      failed: 0,
      message: error instanceof Error ? error.message : "Push delivery is not configured."
    }));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not send test notification." },
      { status: 500 }
    );
  }
}
