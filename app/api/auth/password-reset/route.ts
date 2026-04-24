import { NextResponse } from "next/server";
import { applyAccountPasswordReset, sendAccountPasswordReset } from "@/lib/password-reset";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      token?: string;
      password?: string;
    };

    if (body.token) {
      await applyAccountPasswordReset(body.token, body.password ?? "");
      return NextResponse.json({ ok: true });
    }

    await sendAccountPasswordReset(request, body.email ?? "");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Password reset failed." },
      { status: 400 }
    );
  }
}
