"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { File, Image as ImageIcon, Mic, Send, Square } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useMediaRecorder } from "@/hooks/use-media-recorder";
import { documentAccept, imageAccept } from "@/lib/cloudinary";
import { messageSchema } from "@/lib/validators";
import type { UploadKind } from "@/types";

type Values = z.infer<typeof messageSchema>;

type MessageComposerProps = {
  disabled?: boolean;
  uploadProgress: number;
  onSendText: (content: string) => Promise<void>;
  onSendFile: (file: File, kind: UploadKind, options?: { signal?: AbortSignal }) => Promise<void>;
};

export function MessageComposer({ disabled, uploadProgress, onSendText, onSendFile }: MessageComposerProps) {
  const { showToast } = useToast();
  const imageRef = useRef<HTMLInputElement | null>(null);
  const docRef = useRef<HTMLInputElement | null>(null);
  const [sending, setSending] = useState(false);
  const [failedUpload, setFailedUpload] = useState<{ file: File; kind: UploadKind } | null>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const recorder = useMediaRecorder();
  const form = useForm<Values>({ resolver: zodResolver(messageSchema), defaultValues: { content: "" } });

  async function submit(values: Values) {
    setSending(true);
    try {
      await onSendText(values.content);
      form.reset({ content: "" });
    } catch (error) {
      showToast({ variant: "error", title: "Message failed", description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setSending(false);
    }
  }

  async function handleFile(file: File | undefined, kind: UploadKind) {
    if (!file) return;
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    setUploadingName(file.name);
    setFailedUpload(null);
    try {
      await onSendFile(file, kind, { signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        showToast({ variant: "info", title: "Upload canceled" });
      } else {
        setFailedUpload({ file, kind });
        showToast({ variant: "error", title: "Upload failed", description: error instanceof Error ? error.message : "Check the file and try again." });
      }
    } finally {
      uploadAbortRef.current = null;
      setUploadingName(null);
    }
  }

  function cancelUpload() {
    uploadAbortRef.current?.abort();
  }

  async function toggleRecording() {
    try {
      if (recorder.recording) {
        const file = await recorder.stop();
        if (file) await handleFile(file, "voice");
      } else {
        await recorder.start();
      }
    } catch {
      showToast({ variant: "error", title: "Microphone unavailable", description: "Allow microphone access to record voice messages." });
    }
  }

  return (
    <div className="border-t border-line bg-paper/85 p-3 backdrop-blur dark:border-white/10 dark:bg-neutral-950/85">
      {uploadProgress > 0 ? (
        <div className="mb-3 rounded-lg border border-line bg-white/70 p-2 text-xs text-ink/60 dark:border-white/10 dark:bg-white/10 dark:text-white/60">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="truncate">Uploading {uploadingName ?? "file"}</span>
            <button type="button" onClick={cancelUpload} className="rounded px-2 py-1 text-coral hover:bg-coral/10">
              Cancel
            </button>
          </div>
          <div className="h-1 rounded-full bg-ink/10 dark:bg-white/10">
            <div className="h-full rounded-full bg-teal transition-all" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      ) : null}
      {failedUpload ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-coral/30 bg-coral/10 p-2 text-xs text-ink dark:text-white">
          <span className="truncate">Upload failed: {failedUpload.file.name}</span>
          <button type="button" onClick={() => void handleFile(failedUpload.file, failedUpload.kind)} className="rounded px-2 py-1 font-medium hover:bg-coral/10">
            Retry
          </button>
        </div>
      ) : null}
      <form onSubmit={form.handleSubmit(submit)} className="flex items-end gap-2">
        <input ref={imageRef} className="hidden" type="file" accept={imageAccept} onChange={(event) => void handleFile(event.target.files?.[0], "image")} />
        <input ref={docRef} className="hidden" type="file" accept={documentAccept} onChange={(event) => void handleFile(event.target.files?.[0], "document")} />
        <Button type="button" variant="ghost" className="h-11 w-11 px-0" onClick={() => imageRef.current?.click()} disabled={disabled} aria-label="Attach image">
          <ImageIcon className="h-5 w-5" />
        </Button>
        <Button type="button" variant="ghost" className="h-11 w-11 px-0" onClick={() => docRef.current?.click()} disabled={disabled} aria-label="Attach document">
          <File className="h-5 w-5" />
        </Button>
        <Textarea
          placeholder="Write a message"
          rows={1}
          disabled={disabled}
          {...form.register("content")}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void form.handleSubmit(submit)();
            }
          }}
        />
        <Button type="button" variant={recorder.recording ? "danger" : "ghost"} className="h-11 w-11 px-0" onClick={() => void toggleRecording()} disabled={disabled} aria-label="Record voice message">
          {recorder.recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </Button>
        <Button type="submit" className="h-11 w-11 px-0" disabled={disabled || sending} aria-label="Send message">
          <Send className="h-5 w-5" />
        </Button>
      </form>
    </div>
  );
}
