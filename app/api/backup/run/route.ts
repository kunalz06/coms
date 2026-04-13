import { NextResponse } from "next/server";
import { runBackupForUser } from "@/lib/archive";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const result = await runBackupForUser(createServiceSupabase(), decoded.uid);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Backup failed." }, { status: 500 });
  }
}
