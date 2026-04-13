import { NextResponse } from "next/server";
import { runRetentionCleanup } from "@/lib/archive";
import { createServiceSupabase } from "@/lib/supabase";

function authorized(request: Request) {
  const secret = process.env.BACKUP_RETENTION_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ message: "Unauthorized retention cleanup request." }, { status: 401 });

  try {
    const result = await runRetentionCleanup(createServiceSupabase());
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Retention cleanup failed." }, { status: 500 });
  }
}
