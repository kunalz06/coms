"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/features/auth/auth-provider";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/app" : "/login");
  }, [loading, router, user]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="flex items-center justify-center gap-3 text-sm text-ink/70 dark:text-white/70">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading COMMS
        </div>
        <a
          href="https://devsoftware.vercel.app"
          className="mt-3 inline-flex text-xs font-medium text-ink/55 underline-offset-4 transition hover:text-ink hover:underline dark:text-white/55 dark:hover:text-white"
        >
          Made by DEV ♾️ Software Studio
        </a>
      </div>
    </main>
  );
}
