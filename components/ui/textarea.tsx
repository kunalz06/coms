"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-11 w-full resize-none rounded-lg border border-line bg-white/80 px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/45 focus:border-moss focus:ring-2 focus:ring-moss/20 dark:border-white/10 dark:bg-white/10 dark:text-white dark:placeholder:text-white/45",
        className
      )}
      {...props}
    />
  )
);

Textarea.displayName = "Textarea";
