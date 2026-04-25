import { NextResponse } from "next/server";
import { applyAccountPasswordReset, sendAccountPasswordReset } from "@/lib/password-reset";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      otp?: string;
      password?: string;
    };

    if (body.otp || body.password) {
      await applyAccountPasswordReset({
        email: body.email ?? "",
        otp: body.otp ?? "",
        password: body.password ?? ""
      });
      return NextResponse.json({ ok: true });
    }

    await sendAccountPasswordReset(body.email ?? "");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Password reset failed." },
      { status: 400 }
    );
  }
}
