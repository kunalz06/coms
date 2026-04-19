import { NextResponse } from "next/server";
import { saveGoogleDriveConnection } from "@/lib/archive";
import { exchangeGoogleDriveCode, verifyGoogleOAuthState } from "@/lib/google-drive";
import { createServiceSupabase } from "@/lib/supabase";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? url.origin).replace(/\/$/, "");

  try {
    if (error) throw new Error(error === "access_denied" ? "Google Drive connection was cancelled." : error);
    if (!code || !state) throw new Error("Google Drive did not return a valid connection response.");
    const userId = verifyGoogleOAuthState(state);
    const connection = await exchangeGoogleDriveCode(code, {
      origin: url.origin,
    });
    await saveGoogleDriveConnection(createServiceSupabase(), userId, connection);
    return NextResponse.redirect(`${appUrl}/app?backup=connected`);
  } catch (caught) {
    const message = encodeURIComponent(caught instanceof Error ? caught.message : "Google Drive connection failed.");
    return NextResponse.redirect(`${appUrl}/app?backup=failed&message=${message}`);
  }
}
