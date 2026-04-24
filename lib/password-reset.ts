import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { firebaseAdminAuth } from "@/lib/firebase-admin";

type ResetTokenPayload = {
  uid: string;
  email: string;
  iat: number;
  exp: number;
  purpose: "account_password_reset";
};

const RESET_TTL_SECONDS = 10 * 60;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function base64Url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function resetSecret() {
  return (
    process.env.PASSWORD_RESET_TOKEN_SECRET ??
    required("BACKUP_OAUTH_STATE_SECRET")
  );
}

function signPayload(payload: ResetTokenPayload) {
  const body = base64Url(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", resetSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifyResetToken(token: string): ResetTokenPayload {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new Error("Invalid reset link.");
  const expected = crypto
    .createHmac("sha256", resetSecret())
    .update(body)
    .digest("base64url");
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected)) {
    throw new Error("Invalid reset link.");
  }
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("Invalid reset link.");
  }
  const payload = JSON.parse(fromBase64Url(body)) as ResetTokenPayload;
  if (
    payload.purpose !== "account_password_reset" ||
    !payload.uid ||
    !payload.email ||
    !payload.exp
  ) {
    throw new Error("Invalid reset link.");
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Reset link expired. Request a new link.");
  }
  return payload;
}

function appUrl(request: Request) {
  return (process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin)
    .replace(/\/$/, "");
}

function gmailTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: required("GMAIL_USER"),
      pass: required("GMAIL_APP_PASSWORD")
    }
  });
}

export async function sendAccountPasswordReset(request: Request, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Enter a valid account email.");
  }

  const auth = firebaseAdminAuth();
  let user;
  try {
    user = await auth.getUserByEmail(normalizedEmail);
  } catch {
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const token = signPayload({
    uid: user.uid,
    email: normalizedEmail,
    iat: now,
    exp: now + RESET_TTL_SECONDS,
    purpose: "account_password_reset"
  });
  const resetLink = `${appUrl(request)}/reset-password?token=${encodeURIComponent(token)}`;
  const from = process.env.GMAIL_FROM ?? process.env.GMAIL_USER;

  await gmailTransport().sendMail({
    from,
    to: normalizedEmail,
    subject: "Reset your COMMS password",
    text: `Use this link to reset your COMMS password. It expires in 10 minutes:\n\n${resetLink}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Use this link to reset your COMMS password. It expires in 10 minutes:</p><p><a href="${resetLink}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`
  });
}

export async function applyAccountPasswordReset(token: string, password: string) {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const payload = verifyResetToken(token);
  const auth = firebaseAdminAuth();
  const user = await auth.getUser(payload.uid);
  if (user.email?.toLowerCase() !== payload.email.toLowerCase()) {
    throw new Error("Reset link no longer matches this account.");
  }
  await auth.updateUser(payload.uid, { password });
}
