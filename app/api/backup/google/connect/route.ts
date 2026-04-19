import { NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { buildGoogleDriveAuthUrl } from "@/lib/google-drive";

export async function POST(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const origin = new URL(request.url).origin;
    return NextResponse.json({
      authUrl: buildGoogleDriveAuthUrl(decoded.uid, { origin }),
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Could not start Google Drive connection." }, { status: 401 });
  }
}
