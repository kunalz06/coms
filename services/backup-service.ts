import type { ArchivedMessagePayload, BackupPreference } from "@/types";

type BackupRunResult = {
  archivedMessages: number;
  archiveBatches: number;
  skippedReason?: string;
};

async function apiJson<T>(input: RequestInfo | URL, init: RequestInit & { token: string }): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${init.token}`,
      "content-type": "application/json"
    }
  });
  const payload = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok) throw new Error(payload?.message ?? "Backup request failed.");
  return payload as T;
}

export async function getBackupPreference(token: string) {
  const payload = await apiJson<{ preference: BackupPreference | null }>("/api/backup/status", { method: "GET", token });
  return payload.preference;
}

export async function getGoogleDriveConnectUrl(token: string) {
  const payload = await apiJson<{ authUrl: string }>("/api/backup/google/connect", { method: "POST", body: "{}", token });
  return payload.authUrl;
}

export async function disableGoogleDriveBackup(token: string) {
  await apiJson<{ ok: boolean }>("/api/backup/disable", { method: "POST", body: "{}", token });
}

export async function runBackupNow(token: string) {
  return apiJson<BackupRunResult>("/api/backup/run", { method: "POST", body: "{}", token });
}

export async function restoreArchivedMessages(token: string, conversationId: string) {
  const payload = await apiJson<{ messages: ArchivedMessagePayload[] }>(`/api/backup/restore?conversationId=${encodeURIComponent(conversationId)}`, {
    method: "GET",
    token
  });
  return payload.messages;
}
