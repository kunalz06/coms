"use client";

import { useCallback, useRef, useState } from "react";

const recorderMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "video/webm;codecs=opus",
  "video/webm",
  "audio/mp4"
];

function getSupportedRecorderMimeType() {
  return recorderMimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
}

export function useMediaRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    streamRef.current = stream;
    chunksRef.current = [];
    const mimeType = getSupportedRecorderMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  }, []);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return null;
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
      };
      recorder.stop();
    });
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    streamRef.current = null;
    setRecording(false);
    const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    return new File([blob], `voice-${Date.now()}.${extension}`, { type: blob.type || "audio/webm" });
  }, []);

  const cancel = useCallback(() => {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
    setRecording(false);
  }, []);

  return { recording, start, stop, cancel };
}
