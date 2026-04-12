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
      <div className="flex items-center gap-3 text-sm text-ink/70 dark:text-white/70">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading COMMS
      </div>
    </main>
  );
}
