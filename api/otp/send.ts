import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

type OtpSendBody = {
  email?: string;
  subject?: string;
  label?: string;
  otp?: string;
};

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

function parseBody(body: unknown): OtpSendBody {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as OtpSendBody;
    } catch {
      return {};
    }
  }
  return body as OtpSendBody;
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

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const expectedSecret = required("OTP_EMAIL_WEBHOOK_SECRET");
  const actualSecret = req.headers["x-comms-email-secret"];
  if (actualSecret !== expectedSecret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { email, subject, label, otp } = parseBody(req.body);
  if (!email || !subject || !label || !otp) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const from = process.env.GMAIL_FROM ?? required("GMAIL_USER");
  const content = otpEmailContent(label, otp);

  try {
    await gmailTransport().sendMail({
      from,
      to: email,
      subject,
      text: content.text,
      html: content.html
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    cachedTransport = null;
    const message = error instanceof Error ? error.message : String(error);
    console.error("Vercel OTP email delivery failed", { email, label, message });
    res.status(502).json({ error: "smtp_failed" });
  }
}
