function fallbackSignalingUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function signalingUrl() {
  const rawUrl = process.env.NEXT_PUBLIC_SIGNALING_URL?.trim();
  if (!rawUrl) return fallbackSignalingUrl();

  let value = rawUrl
    .replace(/^wss:\/\/https\/\//i, "wss://")
    .replace(/^wss:\/\/https:\/\//i, "wss://")
    .replace(/^ws:\/\/http\/\//i, "ws://")
    .replace(/^ws:\/\/http:\/\//i, "ws://")
    .replace(/^https\/\//i, "wss://")
    .replace(/^https:\/\//i, "wss://")
    .replace(/^http\/\//i, "ws://")
    .replace(/^http:\/\//i, "ws://");

  if (value.startsWith("//")) {
    value = `${window.location.protocol === "https:" ? "wss:" : "ws:"}${value}`;
  }

  if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    value = `${protocol}//${value.replace(/^\/+/, "")}`;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return fallbackSignalingUrl();
    if (url.pathname === "/" || url.pathname === "") url.pathname = "/ws";
    return url.toString();
  } catch {
    return fallbackSignalingUrl();
  }
}

export function signalingHealthUrl() {
  const url = new URL(signalingUrl());
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/healthz";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function warmSignalingServer() {
  try {
    await fetch(signalingHealthUrl(), { cache: "no-store" });
  } catch {
    // Render can close a cold WebSocket before the service is fully awake; the
    // actual socket connection still owns the user-facing error path.
  }
}
