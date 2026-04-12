import type { UploadKind } from "@/types";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VOICE_BYTES = 10 * 1024 * 1024;

export const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
export const documentTypes = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
export const imageAccept = Array.from(imageTypes).join(",");
export const documentAccept = ".pdf,.txt,.doc,.docx,.xls,.xlsx";
const voiceExtensions = [".webm", ".ogg", ".mp3", ".mp4", ".m4a", ".wav"];

function isSupportedVoiceFile(file: File) {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith("audio/")) return true;
  if (type === "video/webm" || type === "video/mp4") return true;
  return voiceExtensions.some((extension) => name.endsWith(extension));
}

export function validateUpload(file: File, kind: UploadKind) {
  if (kind === "avatar" || kind === "image") {
    if (!imageTypes.has(file.type)) return "Use a JPG, PNG, or WebP image.";
    if (file.size > MAX_IMAGE_BYTES) return "Images must be 5 MB or smaller.";
  }

  if (kind === "document") {
    if (!documentTypes.has(file.type)) return "This document type is not supported.";
    if (file.size > MAX_DOCUMENT_BYTES) return "Documents must be 5 MB or smaller.";
  }

  if (kind === "voice") {
    if (!isSupportedVoiceFile(file)) return "This voice recording format is not supported.";
    if (file.size > MAX_VOICE_BYTES) return "Voice messages must be 10 MB or smaller.";
  }

  return null;
}
