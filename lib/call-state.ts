import type { CallStatus } from "@/types";

export const CALL_TIMEOUT_MS = 40_000;

const allowedTransitions: Record<CallStatus, CallStatus[]> = {
  idle: ["incoming_ringing", "acquiring_media"],
  incoming_ringing: ["acquiring_media", "ending", "failed"],
  outgoing_ringing: ["connecting", "ending", "failed"],
  acquiring_media: ["outgoing_ringing", "connecting", "ending", "failed"],
  connecting: ["connected", "reconnecting", "ending", "failed"],
  connected: ["reconnecting", "ending", "failed"],
  reconnecting: ["connected", "ending", "failed"],
  ending: ["ended", "failed"],
  ended: ["idle"],
  failed: ["idle", "ending"]
};

export function canTransitionCall(from: CallStatus, to: CallStatus) {
  if (from === to) return true;
  return allowedTransitions[from]?.includes(to) ?? false;
}

export function readableCallStatus(status: CallStatus) {
  return status.replace(/_/g, " ");
}
