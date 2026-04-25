import { NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { sendPrivacyPasswordReset, verifyPrivacyPasswordReset } from "@/lib/password-reset";

function privacyType(value: unknown) {
  if (value === "lock" || value === "hidden") return value;
  throw new Error("Unknown privacy password type.");
}

export async function POST(request: Request) {
  try {
    const decoded = await verifyFirebaseRequest(request);
    const body = (await request.json().catch(() => ({}))) as {
      type?: string;
      otp?: string;
    };
    const type = privacyType(body.type);
    const email = decoded.email ?? "";

    if (body.otp) {
      await verifyPrivacyPasswordReset(decoded.uid, email, body.otp, type);
      return NextResponse.json({ ok: true, type, email: email.trim().toLowerCase() });
    }

    await sendPrivacyPasswordReset(decoded.uid, email, type);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Privacy password reset failed." },
      { status: 400 }
    );
  }
}
