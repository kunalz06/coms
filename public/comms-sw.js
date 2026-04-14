const CACHE_VERSION = "comms-shell-v2";
const APP_SHELL = ["/", "/app", "/login", "/register", "/reset-password", "/manifest.webmanifest", "/favicon.ico", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => undefined)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(request).then((cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
        )
      )
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match("/app")))
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }

  const isMessage = payload.type === "message";
  const options = {
    body: payload.body ?? (isMessage ? "Open COMMS to read your unread chat." : "Open COMMS to answer."),
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: payload.tag ?? (isMessage ? "comms-unread-chat" : "comms-incoming-call"),
    requireInteraction: !isMessage,
    data: { url: payload.url ?? "/app" }
  };

  event.waitUntil(
    self.registration.showNotification(
      payload.title ?? (isMessage ? "Unread COMMS chat" : "Incoming COMMS call"),
      options
    )
  );
});

async function focusOrNavigateClient(targetUrl) {
  const windowClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true
  });

  const target = new URL(targetUrl, self.location.origin).href;

  const existingClient =
    windowClients.find((client) => client.url === target) ||
    windowClients.find((client) => client.url.startsWith(self.location.origin + "/app")) ||
    windowClients[0];

  if (!existingClient) {
    return self.clients.openWindow(target);
  }

  try {
    if ("navigate" in existingClient) {
      await existingClient.navigate(target);
    }
  } catch {
    // Ignore navigation failures and still try to focus the client.
  }

  return existingClient.focus();
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url ?? "/app";

  event.waitUntil(focusOrNavigateClient(targetUrl));
});