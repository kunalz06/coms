import { safeFileName } from "@/lib/utils";
import { validateUpload } from "@/lib/cloudinary";
import type { UploadKind } from "@/types";

export type CloudinaryUploadResult = {
  url: string;
  publicId: string;
  resourceType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type UploadOptions = {
  file: File;
  kind: UploadKind;
  getIdToken: () => Promise<string>;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
};

async function getSignature(kind: UploadKind, token: string) {
  const response = await fetch("/api/cloudinary/sign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ kind })
  });
  if (!response.ok) return null;
  return response.json() as Promise<{ signature: string; timestamp: number; apiKey: string; folder: string }>;
}

async function assertUploadPassesSecurityHooks(file: File) {
  // Production hook placeholder: call a malware scanning service here before upload.
  // Keep the function async so a future server-side scanner can be added without changing callers.
  if (!file.size) throw new Error("This file is empty.");
}

async function compressImageForUpload(file: File, kind: UploadKind) {
  if ((kind !== "image" && kind !== "avatar") || typeof document === "undefined") return file;
  if (typeof createImageBitmap === "undefined") return file;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const maxEdge = kind === "avatar" ? 720 : 1600;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  if (scale >= 1 && file.size < 900_000) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const targetType = file.type === "image/png" ? "image/webp" : file.type;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, targetType, 0.82));
  if (!blob || blob.size >= file.size) return file;
  const extension = targetType === "image/webp" ? ".webp" : file.name.slice(file.name.lastIndexOf(".")) || ".jpg";
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}${extension}`, { type: targetType, lastModified: Date.now() });
}

export async function uploadToCloudinary({ file, kind, getIdToken, onProgress, signal }: UploadOptions) {
  if (signal?.aborted) throw new DOMException("Upload canceled.", "AbortError");
  await assertUploadPassesSecurityHooks(file);
  const uploadFile = await compressImageForUpload(file, kind);
  const validation = validateUpload(uploadFile, kind);
  if (validation) throw new Error(validation);

  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!cloudName) throw new Error("Cloudinary is not configured.");

  const token = await getIdToken();
  const signed = await getSignature(kind, token).catch(() => null);
  const formData = new FormData();
  formData.append("file", uploadFile, safeFileName(uploadFile.name));

  if (signed) {
    formData.append("api_key", signed.apiKey);
    formData.append("timestamp", String(signed.timestamp));
    formData.append("signature", signed.signature);
    formData.append("folder", signed.folder);
  } else {
    const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UNSIGNED_PRESET;
    if (!preset) throw new Error("Cloudinary upload preset is not configured.");
    formData.append("upload_preset", preset);
    formData.append("folder", `comms/${kind}`);
  }

  const isPdf = uploadFile.type === "application/pdf" || uploadFile.name.toLowerCase().endsWith(".pdf");
  const resource = kind === "document" ? (isPdf ? "image" : "raw") : kind === "voice" ? "video" : "image";
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/${resource}/upload`;

  const response = await new Promise<Response>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abortUpload = () => {
      signal?.removeEventListener("abort", abortUpload);
      request.abort();
      reject(new DOMException("Upload canceled.", "AbortError"));
    };
    request.open("POST", url);
    signal?.addEventListener("abort", abortUpload, { once: true });
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      signal?.removeEventListener("abort", abortUpload);
      resolve(new Response(request.responseText, { status: request.status, statusText: request.statusText }));
    };
    request.onerror = () => {
      signal?.removeEventListener("abort", abortUpload);
      reject(new Error("Upload failed. Check your connection and try again."));
    };
    request.send(formData);
  });

  if (!response.ok) throw new Error("Cloudinary rejected the upload.");
  const payload = (await response.json()) as { secure_url: string; public_id: string; resource_type: string };
  onProgress?.(100);

  return {
    url: payload.secure_url,
    publicId: payload.public_id,
    resourceType: payload.resource_type,
    fileName: safeFileName(uploadFile.name),
    mimeType: uploadFile.type || "audio/webm",
    sizeBytes: uploadFile.size
  } satisfies CloudinaryUploadResult;
}
