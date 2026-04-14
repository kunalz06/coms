import { NextResponse } from "next/server";
import { z } from "zod";
import { restoreConversationArchive } from "@/lib/archive";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";

const querySchema = z.object({
  conversationId: z.string().uuid()
});

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json(
    {
      error: {
        code,
        message
      }
    },
    { status }
  );
}

function isAuthError(error: unknown) {
  return error instanceof Error && /token|auth|unauth|expired|firebase/i.test(error.message);
}

function isPermissionError(error: unknown) {
  return error instanceof Error && /forbidden|permission|access denied|not allowed|rls/i.test(error.message);
}

export async function GET(request: Request) {
  let decodedUid: string | null = null;

  try {
    const decoded = await verifyFirebaseRequest(request);
    decodedUid = decoded.uid;
  } catch (error) {
    return jsonError(401, "UNAUTHORIZED", error instanceof Error ? error.message : "Authentication is required.");
  }

  let conversationId: string;

  try {
    const parsed = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    conversationId = parsed.conversationId;
  } catch {
    return jsonError(400, "INVALID_QUERY", "A valid conversationId is required.");
  }

  try {
    const supabase = createServiceSupabase();
    const messages = await restoreConversationArchive(supabase, decodedUid, conversationId);

    if (!messages.length) {
      return jsonError(404, "ARCHIVE_NOT_FOUND", "No archived messages were found for this conversation.");
    }

    return NextResponse.json({ messages });
  } catch (error) {
    if (isAuthError(error)) {
      return jsonError(401, "UNAUTHORIZED", error instanceof Error ? error.message : "Authentication failed.");
    }

    if (isPermissionError(error)) {
      return jsonError(403, "FORBIDDEN", "You do not have access to this conversation archive.");
    }

    return jsonError(
      500,
      "RESTORE_FAILED",
      error instanceof Error ? error.message : "Could not restore archived messages."
    );
  }
}