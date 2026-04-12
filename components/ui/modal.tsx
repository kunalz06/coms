"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-lg border border-white/20 bg-paper p-5 shadow-soft dark:bg-neutral-950">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink dark:text-white">{title}</h2>
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="h-8 px-3" onClick={onClose}>Close</Button>
            <Button variant="ghost" className="h-8 w-8 px-0" onClick={onClose} aria-label="Close popup">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
