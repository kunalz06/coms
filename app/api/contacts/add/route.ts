import { NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";

async function existingFriendship(supabase: any, userOneId: string, userTwoId: string) {
  const { data, error } = await supabase
    .from("friendships")
    .select("id")
    .or(
      `and(requester_id.eq.${userOneId},addressee_id.eq.${userTwoId}),` +
        `and(requester_id.eq.${userTwoId},addressee_id.eq.${userOneId})`
    )
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string } | null;
}

async function usersAreBlocked(supabase: any, userOneId: string, userTwoId: string) {
  const { data, error } = await supabase
    .from("blocks")
    .select("id")
    .or(
      `and(blocker_id.eq.${userOneId},blocked_id.eq.${userTwoId}),` +
        `and(blocker_id.eq.${userTwoId},blocked_id.eq.${userOneId})`
    )
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function POST(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const body = (await request.json().catch(() => ({}))) as {
      addresseeId?: string;
    };
    const addresseeId = body.addresseeId?.trim();
    if (!addresseeId) throw new Error("Choose a COMMS user to add.");
    if (addresseeId === decoded.uid) throw new Error("Choose another COMMS user.");

    const supabase = createServiceSupabase();
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("id", addresseeId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (!profile) throw new Error("That COMMS user no longer exists.");
    if (await usersAreBlocked(supabase, decoded.uid, addresseeId)) {
      throw new Error("This user cannot be added.");
    }

    const existing = await existingFriendship(supabase, decoded.uid, addresseeId);
    if (existing) {
      const { error } = await supabase
        .from("friendships")
        .update({ status: "accepted" })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    const { error } = await supabase.from("friendships").insert({
      requester_id: decoded.uid,
      addressee_id: addresseeId,
      status: "accepted"
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Could not add friend." },
      { status: 400 }
    );
  }
}
