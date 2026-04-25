import { NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";

export async function GET(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const url = new URL(request.url);
    const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ profile: null });
    }

    const supabase = createServiceSupabase();
    const { data, error } = await supabase
      .from("user_profiles")
      .select("id,email,full_name,avatar_url,status,last_seen,created_at,updated_at")
      .eq("email", email)
      .neq("id", decoded.uid)
      .maybeSingle();
    if (error) throw new Error(error.message);

    return NextResponse.json({ profile: data ?? null });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not search contacts." },
      { status: 400 }
    );
  }
}
