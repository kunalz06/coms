"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type ModalProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
};

export function Modal({ open, title, children, onClose }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-3 backdrop-blur-sm md:p-4" role="dialog" aria-modal="true">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-auto rounded-lg border border-white/20 bg-paper p-4 shadow-soft dark:bg-neutral-950 md:max-h-[90vh] md:p-5">
        <div className="sticky -top-4 z-10 mb-4 flex items-center justify-between gap-4 bg-paper/95 pb-3 backdrop-blur dark:bg-neutral-950/95 md:-top-5">
          <h2 className="min-w-0 truncate text-lg font-semibold text-ink dark:text-white">{title}</h2>
          <Button variant="ghost" className="h-8 px-3" onClick={onClose}>Close</Button>
        </div>
        {children}
      </div>
    </div>
  );
}
