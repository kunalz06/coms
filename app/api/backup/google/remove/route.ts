import { NextResponse } from "next/server";
import { removeGoogleDriveConnection } from "@/lib/archive";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    await removeGoogleDriveConnection(createServiceSupabase(), decoded.uid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not remove Google account." },
      { status: 500 }
    );
  }
}
