import crypto from "node:crypto";
import type { ArchiveFilePayload } from "@/types";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_FILE_URL = "https://www.googleapis.com/drive/v3/files";

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type StoredDriveTokens = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
};

export type DriveConnection = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scope: string;
  email: string | null;
};

type GoogleDriveUrlOptions = {
  origin?: string;
};

function normalizeOrigin(origin?: string) {
  if (!origin) return null;
  return origin.replace(/\/$/, "");
}

function appUrl(options: GoogleDriveUrlOptions = {}) {
  const overrideRedirect = process.env.GOOGLE_DRIVE_REDIRECT_URI?.trim();
  if (overrideRedirect) {
    try {
      return new URL(overrideRedirect).origin.replace(/\/$/, "");
    } catch (_) {
      // Fall through to the other app URL sources.
    }
  }

  const fromOptions = normalizeOrigin(options.origin);
  if (fromOptions) return fromOptions;

  const fromEnv = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return fromEnv.replace(/\/$/, "");
}

export function googleDriveRedirectUri(options: GoogleDriveUrlOptions = {}) {
  const override = process.env.GOOGLE_DRIVE_REDIRECT_URI?.trim();
  if (override) return override.replace(/\/$/, "");
  return `${appUrl(options)}/api/backup/google/callback`;
}

function googleClientConfig() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Drive OAuth is not configured.");
  return { clientId, clientSecret };
}

function stateSecret() {
  return process.env.BACKUP_OAUTH_STATE_SECRET ?? process.env.NEXTAUTH_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "comms-dev-state";
}

function encryptionKey() {
  const configured = process.env.BACKUP_TOKEN_ENCRYPTION_KEY;
  return crypto.createHash("sha256").update(configured ?? "comms-dev-backup-token-key").digest();
}

export function signGoogleOAuthState(userId: string) {
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt: Date.now() + 10 * 60 * 1000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGoogleOAuthState(state: string) {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) throw new Error("Invalid Google Drive connection state.");
  const expected = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("Google Drive connection state could not be verified.");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId?: string; expiresAt?: number };
  if (!parsed.userId || !parsed.expiresAt || parsed.expiresAt < Date.now()) throw new Error("Google Drive connection state expired.");
  return parsed.userId;
}

export function buildGoogleDriveAuthUrl(
  userId: string,
  options: GoogleDriveUrlOptions = {}
) {
  const { clientId } = googleClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleDriveRedirectUri(options),
    response_type: "code",
    scope: `${DRIVE_SCOPE} openid email`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signGoogleOAuthState(userId)
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export function encryptToken(token: string | null | undefined) {
  if (!token) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptToken(value: string | null | undefined) {
  if (!value) return null;
  const [ivText, tagText, ciphertextText] = value.split(".");
  if (!ivText || !tagText || !ciphertextText) throw new Error("Stored Google Drive token is invalid.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}

async function parseGoogleTokenResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok || payload.error) throw new Error(payload.error_description ?? payload.error ?? "Google Drive authorization failed.");
  if (!payload.access_token || !payload.expires_in) throw new Error("Google Drive did not return a usable access token.");
  return payload;
}

export async function exchangeGoogleDriveCode(
  code: string,
  options: GoogleDriveUrlOptions = {}
): Promise<DriveConnection> {
  const { clientId, clientSecret } = googleClientConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleDriveRedirectUri(options),
      grant_type: "authorization_code"
    })
  });
  const payload = await parseGoogleTokenResponse(response);
  const accessToken = payload.access_token!;
  const email = await getGoogleDriveEmail(accessToken).catch(() => null);

  return {
    accessToken,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: new Date(Date.now() + payload.expires_in! * 1000).toISOString(),
    scope: payload.scope ?? DRIVE_SCOPE,
    email
  };
}

export async function refreshGoogleDriveAccessToken(tokens: StoredDriveTokens): Promise<DriveConnection> {
  if (!tokens.refreshToken) throw new Error("Google Drive needs to be reconnected.");
  const { clientId, clientSecret } = googleClientConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const payload = await parseGoogleTokenResponse(response);

  return {
    accessToken: payload.access_token!,
    refreshToken: tokens.refreshToken,
    expiresAt: new Date(Date.now() + payload.expires_in! * 1000).toISOString(),
    scope: payload.scope ?? DRIVE_SCOPE,
    email: null
  };
}

export async function getGoogleDriveEmail(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { email?: string };
  return payload.email ?? null;
}

export async function uploadArchiveToGoogleDrive(accessToken: string, fileName: string, archive: ArchiveFilePayload) {
  const boundary = `comms-${crypto.randomUUID()}`;
  const metadata = {
    name: fileName,
    parents: ["appDataFolder"],
    mimeType: "application/json"
  };
  const archiveBody = JSON.stringify(archive);
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    archiveBody,
    `--${boundary}--`,
    ""
  ].join("\r\n");

  const response = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": `multipart/related; boundary=${boundary}`
    },
    body
  });
  const payload = (await response.json().catch(() => ({}))) as { id?: string; name?: string; error?: { message?: string } };
  if (!response.ok || !payload.id) throw new Error(payload.error?.message ?? "Google Drive archive upload failed.");
  return { fileId: payload.id, fileName: payload.name ?? fileName };
}

export async function uploadBinaryToGoogleDrive(accessToken: string, values: { fileName: string; mimeType: string; body: ArrayBuffer }) {
  const boundary = `comms-${crypto.randomUUID()}`;
  const metadata = {
    name: values.fileName,
    parents: ["appDataFolder"],
    mimeType: values.mimeType
  };
  const prefix = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${values.mimeType}`,
    "",
    ""
  ].join("\r\n");
  const suffix = `\r\n--${boundary}--\r\n`;
  const body = new Blob([prefix, values.body, suffix], { type: `multipart/related; boundary=${boundary}` });
  const response = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,mimeType,size`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": `multipart/related; boundary=${boundary}`
    },
    body
  });
  const payload = (await response.json().catch(() => ({}))) as { id?: string; name?: string; mimeType?: string; size?: string; error?: { message?: string } };
  if (!response.ok || !payload.id) throw new Error(payload.error?.message ?? "Google Drive attachment upload failed.");
  return {
    fileId: payload.id,
    fileName: payload.name ?? values.fileName,
    mimeType: payload.mimeType ?? values.mimeType,
    sizeBytes: Number(payload.size ?? values.body.byteLength)
  };
}

export async function fetchArchiveFromGoogleDrive(accessToken: string, fileId: string) {
  const response = await fetch(`${DRIVE_FILE_URL}/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (response.status === 404) throw new Error("This Google Drive archive file is missing.");
  if (!response.ok) throw new Error("Could not restore this Google Drive archive.");
  return (await response.json()) as ArchiveFilePayload;
}

export async function fetchBinaryFromGoogleDrive(accessToken: string, fileId: string) {
  const response = await fetch(`${DRIVE_FILE_URL}/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (response.status === 404) throw new Error("This Google Drive attachment file is missing.");
  if (!response.ok || !response.body) throw new Error("Could not restore this Google Drive attachment.");
  return response;
}
