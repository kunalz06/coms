"use client";

import { useEffect, type ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { AuthProvider } from "@/features/auth/auth-provider";
import { CallProvider } from "@/features/calls/call-provider";
import { GroupCallProvider } from "@/features/group-calls/group-call-provider";
import { useAppStore } from "@/store/app-store";

function ThemeBridge() {
  const theme = useAppStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <CallProvider>
          <GroupCallProvider>
            <ThemeBridge />
            {children}
          </GroupCallProvider>
        </CallProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
