import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";

const bodySchema = z.object({
  kind: z.enum(["avatar", "image", "document", "voice"])
});

export async function POST(request: Request) {
  try {
    await verifyFirebaseRequest(request);
    const body = bodySchema.parse(await request.json());
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    if (!apiSecret || !apiKey) {
      return NextResponse.json({ message: "Cloudinary signing is not configured." }, { status: 503 });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `comms/${body.kind}`;
    const signature = crypto
      .createHash("sha1")
      .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
      .digest("hex");

    return NextResponse.json({ signature, timestamp, apiKey, folder });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload signing failed.";
    return NextResponse.json({ message }, { status: 401 });
  }
}
