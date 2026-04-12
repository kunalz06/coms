"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "firebase/auth";
import { onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { firebaseAuth, ensureFirebasePersistence } from "@/lib/firebase";
import { createBrowserSupabase } from "@/lib/supabase";
import { getProfile, setPresence, upsertProfile } from "@/services/profile-service";
import type { UserProfile } from "@/types";

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  supabase: SupabaseClient | null;
  loading: boolean;
  getIdToken: () => Promise<string>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = useMemo(() => (token ? createBrowserSupabase(token) : null), [token]);

  const getIdToken = useCallback(async () => {
    if (!firebaseAuth.currentUser) throw new Error("You are not signed in.");
    return firebaseAuth.currentUser.getIdToken();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!firebaseAuth.currentUser) {
      setProfile(null);
      return;
    }
    const freshToken = await firebaseAuth.currentUser.getIdToken();
    const client = createBrowserSupabase(freshToken);
    const data = await getProfile(client, firebaseAuth.currentUser.uid);
    setToken(freshToken);
    setProfile(data);
  }, []);

  const signOut = useCallback(async () => {
    if (user && supabase) {
      await setPresence(supabase, user.uid, "offline").catch(() => undefined);
    }
    await firebaseSignOut(firebaseAuth);
  }, [supabase, user]);

  useEffect(() => {
    let cancelled = false;
    void ensureFirebasePersistence();
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (nextUser) => {
      setLoading(true);
      try {
        if (!nextUser) {
          setUser(null);
          setProfile(null);
          setToken(null);
          return;
        }

        const freshToken = await nextUser.getIdToken();
        const client = createBrowserSupabase(freshToken);
        await upsertProfile(client, {
          id: nextUser.uid,
          email: nextUser.email ?? "",
          full_name: nextUser.displayName ?? nextUser.email?.split("@")[0] ?? "COMMS user",
          avatar_url: nextUser.photoURL
        });
        const synced = await getProfile(client, nextUser.uid);
        if (!cancelled) {
          setUser(nextUser);
          setToken(freshToken);
          setProfile(synced);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user || !supabase) return;

    const onVisibility = () => {
      void setPresence(supabase, user.uid, document.hidden ? "offline" : "online").catch(() => undefined);
    };

    const onBeforeUnload = () => {
      void setPresence(supabase, user.uid, "offline").catch(() => undefined);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [supabase, user]);

  const value = useMemo(
    () => ({ user, profile, supabase, loading, getIdToken, refreshProfile, signOut }),
    [user, profile, supabase, loading, getIdToken, refreshProfile, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
