import crypto from "node:crypto";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { firebaseAdminAuth } from "@/lib/firebase-admin";
import { createServiceSupabase } from "@/lib/supabase";

type ResetPurpose = "account" | "privacy_lock" | "privacy_hidden";
type PrivacyType = "lock" | "hidden";

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_WINDOW_MS = 20 * 60 * 1000;
const OTP_COOLDOWN_MS = 20 * 60 * 1000;
const OTP_MAX_IN_WINDOW = 5;
const OTP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let cachedTransport: nodemailer.Transporter | null = null;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function gmailTransport() {
  if (cachedTransport) return cachedTransport;
  const options = {
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    name: "comms",
    family: 4,
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 10_000,
    tls: {
      servername: "smtp.gmail.com"
    },
    auth: {
      user: required("GMAIL_USER"),
      pass: required("GMAIL_APP_PASSWORD").replace(/\s+/g, "")
    }
  } as SMTPTransport.Options;
  cachedTransport = nodemailer.createTransport(options);
  return cachedTransport;
}

function normalizeEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Enter a valid account email.");
  }
  return normalizedEmail;
}

function privacyPurpose(type: PrivacyType): ResetPurpose {
  return type === "lock" ? "privacy_lock" : "privacy_hidden";
}

function generateOtp() {
  let value = "";
  for (let i = 0; i < 6; i += 1) {
    value += OTP_ALPHABET[crypto.randomInt(OTP_ALPHABET.length)];
  }
  return value;
}

function hashOtp(otp: string, salt: string) {
  return crypto
    .createHash("sha256")
    .update(`${salt}:${otp.trim().toUpperCase()}`)
    .digest("hex");
}

function publicCooldownMessage(until: Date) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  return `Too many OTP requests. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

async function assertCanIssueOtp(email: string, purpose: ResetPurpose) {
  const supabase = createServiceSupabase();
  const windowStart = new Date(Date.now() - OTP_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("password_reset_otp_events")
    .select("created_at")
    .eq("email", email)
    .eq("purpose", purpose)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if ((data?.length ?? 0) < OTP_MAX_IN_WINDOW) return;

  const latest = new Date(data![0].created_at as string);
  const cooldownUntil = new Date(latest.getTime() + OTP_COOLDOWN_MS);
  if (Date.now() < cooldownUntil.getTime()) {
    throw new Error(publicCooldownMessage(cooldownUntil));
  }
}

async function storeOtp({
  userId,
  email,
  purpose,
  otp
}: {
  userId: string;
  email: string;
  purpose: ResetPurpose;
  otp: string;
}) {
  const supabase = createServiceSupabase();
  const salt = crypto.randomBytes(16).toString("base64url");
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  await assertCanIssueOtp(email, purpose);

  const { error: deleteError } = await supabase
    .from("password_reset_otps")
    .delete()
    .eq("email", email)
    .eq("purpose", purpose);
  if (deleteError) throw new Error(deleteError.message);

  const { error: insertError } = await supabase
    .from("password_reset_otps")
    .insert({
      user_id: userId,
      email,
      purpose,
      otp_hash: hashOtp(otp, salt),
      salt,
      expires_at: expiresAt
    });
  if (insertError) throw new Error(insertError.message);

  const { error: eventError } = await supabase
    .from("password_reset_otp_events")
    .insert({ user_id: userId, email, purpose });
  if (eventError) throw new Error(eventError.message);
}

async function verifyAndDeleteOtp({
  userId,
  email,
  purpose,
  otp
}: {
  userId: string;
  email: string;
  purpose: ResetPurpose;
  otp: string;
}) {
  const normalizedOtp = otp.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(normalizedOtp)) {
    throw new Error("Enter the 6 character OTP sent to your email.");
  }

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("password_reset_otps")
    .select("id,user_id,email,purpose,otp_hash,salt,expires_at")
    .eq("email", email)
    .eq("purpose", purpose)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.user_id !== userId) {
    throw new Error("Invalid or expired OTP.");
  }
  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    await supabase.from("password_reset_otps").delete().eq("id", data.id);
    throw new Error("OTP expired. Request a new OTP.");
  }
  const expected = data.otp_hash as string;
  const actual = hashOtp(normalizedOtp, data.salt as string);
  if (
    Buffer.byteLength(expected) !== Buffer.byteLength(actual) ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
  ) {
    throw new Error("Invalid or expired OTP.");
  }

  const { error: deleteError } = await supabase
    .from("password_reset_otps")
    .delete()
    .eq("id", data.id);
  if (deleteError) throw new Error(deleteError.message);
}

async function sendOtpEmail(email: string, subject: string, label: string, otp: string) {
  if (process.env.OTP_EMAIL_WEBHOOK_URL && process.env.OTP_EMAIL_WEBHOOK_SECRET) {
    await sendOtpEmailThroughWebhook(email, subject, label, otp);
    return;
  }

  const from = process.env.GMAIL_FROM ?? required("GMAIL_USER");
  const transport = gmailTransport();
  const content = otpEmailContent(label, otp);
  await transport.sendMail({
    from,
    to: email,
    subject,
    text: content.text,
    html: content.html
  });
}

async function sendOtpEmailThroughWebhook(email: string, subject: string, label: string, otp: string) {
  const response = await fetch(required("OTP_EMAIL_WEBHOOK_URL"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-comms-email-secret": required("OTP_EMAIL_WEBHOOK_SECRET")
    },
    body: JSON.stringify({ email, subject, label, otp }),
    signal: AbortSignal.timeout(12_000)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OTP email webhook failed with ${response.status}${detail ? `: ${detail}` : ""}`);
  }
}

function otpEmailContent(label: string, otp: string) {
  return {
    text:
      `Your COMMS ${label} OTP is ${otp}.\n\n` +
      "It expires in 5 minutes. If you did not request this, you can ignore this email.",
    html:
      `<p>Your COMMS ${label} OTP is <strong>${otp}</strong>.</p>` +
      "<p>It expires in 5 minutes. If you did not request this, you can ignore this email.</p>"
  };
}

async function queueOtpEmail(email: string, subject: string, label: string, otp: string) {
  await deliverOtpEmail(email, subject, label, otp);
}

async function deliverOtpEmail(email: string, subject: string, label: string, otp: string) {
  try {
    await sendOtpEmail(email, subject, label, otp);
    console.log("OTP email sent", {
      email,
      label,
      provider: process.env.OTP_EMAIL_WEBHOOK_URL ? "vercel-email-webhook" : "gmail-smtp"
    });
  } catch (error) {
    cachedTransport = null;
    const message = error instanceof Error ? error.message : String(error);
    console.error("OTP email delivery failed", {
      email,
      label,
      provider: process.env.OTP_EMAIL_WEBHOOK_URL ? "vercel-email-webhook" : "gmail-smtp",
      message
    });
    throw new Error("Could not send OTP email. Check the configured OTP email delivery service.");
  }
}

export async function sendAccountPasswordReset(email: string) {
  const normalizedEmail = normalizeEmail(email);

  const auth = firebaseAdminAuth();
  let user;
  try {
    user = await auth.getUserByEmail(normalizedEmail);
  } catch {
    return;
  }

  const otp = generateOtp();
  await storeOtp({
    userId: user.uid,
    email: normalizedEmail,
    purpose: "account",
    otp
  });
  await queueOtpEmail(normalizedEmail, "Reset your COMMS password", "account password reset", otp);
}

export async function applyAccountPasswordReset({
  email,
  otp,
  password
}: {
  email: string;
  otp: string;
  password: string;
}) {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const normalizedEmail = normalizeEmail(email);
  const auth = firebaseAdminAuth();
  const user = await auth.getUserByEmail(normalizedEmail);
  await verifyAndDeleteOtp({
    userId: user.uid,
    email: normalizedEmail,
    purpose: "account",
    otp
  });
  await auth.updateUser(user.uid, { password });
}

export async function sendPrivacyPasswordReset(
  userId: string,
  email: string,
  privacyType: PrivacyType
) {
  const normalizedEmail = normalizeEmail(email);

  const label = privacyType === "lock" ? "chat lock password reset" : "hidden chats password reset";
  const otp = generateOtp();
  await storeOtp({
    userId,
    email: normalizedEmail,
    purpose: privacyPurpose(privacyType),
    otp
  });
  await queueOtpEmail(normalizedEmail, `Reset your COMMS ${label}`, label, otp);
}

export async function verifyPrivacyPasswordReset(
  userId: string,
  email: string,
  otp: string,
  privacyType: PrivacyType
) {
  const normalizedEmail = normalizeEmail(email);
  const auth = firebaseAdminAuth();
  const user = await auth.getUser(userId);
  if (user.email?.toLowerCase() !== normalizedEmail) {
    throw new Error("Reset email must match the signed-in account.");
  }
  await verifyAndDeleteOtp({
    userId,
    email: normalizedEmail,
    purpose: privacyPurpose(privacyType),
    otp
  });
}
