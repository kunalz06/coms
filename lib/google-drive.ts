import crypto from "node:crypto";

type BuildAuthUrlOptions = {
  origin: string;
};

type ExchangeOptions = {
  origin: string;
};

type RefreshOptions = {
  origin: string;
};

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

export type GoogleDriveConnection = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
  email: string | null;
};

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata openid email profile";
const STATE_TTL_SECONDS = 10 * 60;

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

function redirectUri(origin: string) {
  return process.env.GOOGLE_DRIVE_REDIRECT_URI ?? `${origin.replace(/\/$/, "")}/api/backup/google/callback`;
}

function signState(payload: Record<string, unknown>) {
  const secret = required("BACKUP_OAUTH_STATE_SECRET");
  const body = base64Url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyGoogleOAuthState(state: string) {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("Invalid OAuth state.");
  const secret = required("BACKUP_OAUTH_STATE_SECRET");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (expected !== sig) throw new Error("OAuth state signature mismatch.");
  const payload = JSON.parse(fromBase64Url(body)) as { userId?: string; exp?: number };
  if (!payload.userId || !payload.exp) throw new Error("OAuth state payload is invalid.");
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("OAuth state expired.");
  return payload.userId;
}

function maybeDecodeEmail(idToken?: string) {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(fromBase64Url(parts[1])) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

async function fetchGoogleEmail(accessToken: string) {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) return null;
    const json = (await response.json().catch(() => ({}))) as { email?: string };
    return typeof json.email === "string" ? json.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function tokenRequest(payload: URLSearchParams) {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload
  });
  const json = (await response.json().catch(() => ({}))) as GoogleTokenResponse & { error?: string; error_description?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description ?? json.error ?? "Google token exchange failed.");
  }
  return json;
}

export function buildGoogleDriveAuthUrl(userId: string, options: BuildAuthUrlOptions) {
  const clientId = required("GOOGLE_DRIVE_CLIENT_ID");
  const redirect = redirectUri(options.origin);
  const now = Math.floor(Date.now() / 1000);
  const state = signState({ userId, iat: now, exp: now + STATE_TTL_SECONDS });
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export async function exchangeGoogleDriveCode(code: string, options: ExchangeOptions): Promise<GoogleDriveConnection> {
  const payload = new URLSearchParams({
    code,
    client_id: required("GOOGLE_DRIVE_CLIENT_ID"),
    client_secret: required("GOOGLE_DRIVE_CLIENT_SECRET"),
    redirect_uri: redirectUri(options.origin),
    grant_type: "authorization_code"
  });
  const json = await tokenRequest(payload);
  const expiresAt = typeof json.expires_in === "number" ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null;
  const decodedEmail = maybeDecodeEmail(json.id_token)?.toLowerCase() ?? null;
  const resolvedEmail = decodedEmail ?? (await fetchGoogleEmail(json.access_token));
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt,
    scope: json.scope ?? null,
    email: resolvedEmail
  };
}

export async function refreshGoogleDriveAccessToken(refreshToken: string, options: RefreshOptions): Promise<GoogleDriveConnection> {
  const payload = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: required("GOOGLE_DRIVE_CLIENT_ID"),
    client_secret: required("GOOGLE_DRIVE_CLIENT_SECRET"),
    redirect_uri: redirectUri(options.origin),
    grant_type: "refresh_token"
  });
  const json = await tokenRequest(payload);
  const expiresAt = typeof json.expires_in === "number" ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null;
  const decodedEmail = maybeDecodeEmail(json.id_token)?.toLowerCase() ?? null;
  const resolvedEmail = decodedEmail ?? (await fetchGoogleEmail(json.access_token));
  return {
    accessToken: json.access_token,
    refreshToken,
    expiresAt,
    scope: json.scope ?? null,
    email: resolvedEmail
  };
}

export async function uploadGoogleDriveJson(
  accessToken: string,
  fileName: string,
  data: unknown,
  existingFileId?: string | null
) {
  const metadata = {
    name: fileName,
    parents: ["appDataFolder"],
    mimeType: "application/json"
  };
  const boundary = `comms-${crypto.randomUUID()}`;
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    "Content-Type: application/json\r\n\r\n" +
    `${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;

  const endpoint = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

  const response = await fetch(endpoint, {
    method: existingFileId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });

  const json = (await response.json().catch(() => ({}))) as { id?: string; name?: string; error?: { message?: string } };
  if (!response.ok || !json.id) {
    throw new Error(json.error?.message ?? "Google Drive upload failed.");
  }
  return { fileId: json.id, fileName: json.name ?? fileName };
}

export async function downloadGoogleDriveFile(accessToken: string, fileId: string) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    throw new Error("Google Drive archive file could not be downloaded.");
  }
  return response.text();
}
