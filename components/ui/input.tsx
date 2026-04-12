"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-lg border border-line bg-white/80 px-3 text-sm text-ink outline-none transition placeholder:text-ink/45 focus:border-moss focus:ring-2 focus:ring-moss/20 dark:border-white/10 dark:bg-white/10 dark:text-white dark:placeholder:text-white/45",
        className
      )}
      {...props}
    />
  )
);

Input.displayName = "Input";
