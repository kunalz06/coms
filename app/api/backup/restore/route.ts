import { NextResponse } from "next/server";
import { z } from "zod";
import { restoreConversationArchive } from "@/lib/archive";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";

const querySchema = z.object({
  conversationId: z.string().uuid()
});

export async function GET(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const { conversationId } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const messages = await restoreConversationArchive(createServiceSupabase(), decoded.uid, conversationId);
    return NextResponse.json({ messages });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not restore archived messages." }, { status: 500 });
  }
}
