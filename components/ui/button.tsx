"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-black focus-visible:ring-ink dark:bg-paper dark:text-ink dark:hover:bg-white",
  secondary: "border border-line bg-white/70 text-ink hover:bg-white focus-visible:ring-moss dark:border-white/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/15",
  ghost: "text-ink hover:bg-ink/5 focus-visible:ring-moss dark:text-white dark:hover:bg-white/10",
  danger: "bg-coral text-white hover:bg-red-700 focus-visible:ring-coral"
};

export function Button({ className, variant = "primary", children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
