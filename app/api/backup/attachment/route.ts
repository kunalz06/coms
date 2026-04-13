import { NextResponse } from "next/server";
import { z } from "zod";
import { restoreArchivedAttachment } from "@/lib/archive";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";

const querySchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  attachmentId: z.string().uuid()
});

export async function GET(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const values = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const restored = await restoreArchivedAttachment(createServiceSupabase(), decoded.uid, values);
    if (!restored.body) return NextResponse.json({ message: "Archived attachment is empty." }, { status: 404 });

    return new NextResponse(restored.body, {
      headers: {
        "Content-Type": restored.mimeType,
        "Content-Disposition": `inline; filename="${restored.fileName}"`,
        "Cache-Control": "private, max-age=300"
      }
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not restore archived attachment." }, { status: 500 });
  }
}
