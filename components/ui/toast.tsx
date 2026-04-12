"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Toast = {
  id: string;
  title: string;
  description?: string;
  variant: "success" | "error" | "info";
};

type ToastContextValue = {
  showToast: (toast: Omit<Toast, "id">) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((items) => items.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = crypto.randomUUID();
      setToasts((items) => [...items, { ...toast, id }]);
      window.setTimeout(() => removeToast(id), 5000);
    },
    [removeToast]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-[70] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
        {toasts.map((toast) => {
          const Icon = toast.variant === "success" ? CheckCircle2 : toast.variant === "error" ? AlertCircle : Info;
          return (
            <div
              key={toast.id}
              className={cn(
                "rounded-lg border bg-white/95 p-4 text-sm shadow-soft backdrop-blur dark:bg-neutral-950/95",
                toast.variant === "success" && "border-moss/40",
                toast.variant === "error" && "border-coral/40",
                toast.variant === "info" && "border-teal/40"
              )}
            >
              <div className="flex gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink dark:text-white">{toast.title}</p>
                  {toast.description ? <p className="mt-1 text-ink/65 dark:text-white/65">{toast.description}</p> : null}
                </div>
                <button onClick={() => removeToast(toast.id)} aria-label="Dismiss" className="rounded p-1 text-ink/60 hover:bg-ink/5 dark:text-white/60 dark:hover:bg-white/10">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider.");
  return context;
}
