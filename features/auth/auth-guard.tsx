"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/features/auth/auth-provider";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 rounded-lg border border-line bg-white/70 px-4 py-3 text-sm text-ink shadow-soft dark:border-white/10 dark:bg-white/10 dark:text-white">
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening COMMS
        </div>
      </main>
    );
  }

  return children;
}
