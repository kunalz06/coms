import { NextResponse } from "next/server";
import { getBackupStatus } from "@/lib/archive";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";

export async function GET(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const preference = await getBackupStatus(createServiceSupabase(), decoded.uid);
    return NextResponse.json({ preference });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not load backup status." }, { status: 401 });
  }
}
