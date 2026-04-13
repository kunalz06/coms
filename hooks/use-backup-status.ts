"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { disableGoogleDriveBackup, getBackupPreference, getGoogleDriveConnectUrl, runBackupNow } from "@/services/backup-service";
import type { BackupPreference } from "@/types";

export function useBackupStatus() {
  const { user, getIdToken } = useAuth();
  const [preference, setPreference] = useState<BackupPreference | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setPreference(null);
      return null;
    }
    setLoading(true);
    try {
      const token = await getIdToken();
      const nextPreference = await getBackupPreference(token);
      setPreference(nextPreference);
      return nextPreference;
    } finally {
      setLoading(false);
    }
  }, [getIdToken, user]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const connectGoogleDrive = useCallback(async () => {
    if (!user) throw new Error("Sign in to enable backup.");
    const token = await getIdToken();
    const authUrl = await getGoogleDriveConnectUrl(token);
    window.location.assign(authUrl);
  }, [getIdToken, user]);

  const backupNow = useCallback(async () => {
    if (!user) throw new Error("Sign in to back up chats.");
    setSyncing(true);
    try {
      const token = await getIdToken();
      const result = await runBackupNow(token);
      await load();
      return result;
    } finally {
      setSyncing(false);
    }
  }, [getIdToken, load, user]);

  const disable = useCallback(async () => {
    if (!user) return;
    const token = await getIdToken();
    await disableGoogleDriveBackup(token);
    await load();
  }, [getIdToken, load, user]);

  return useMemo(
    () => ({
      preference,
      loading,
      syncing,
      load,
      connectGoogleDrive,
      backupNow,
      disable
    }),
    [backupNow, connectGoogleDrive, disable, load, loading, preference, syncing]
  );
}
