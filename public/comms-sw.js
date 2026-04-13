self.addEventListener("push", (event) => {
  const options = {
    body: "Open COMMS to answer.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: "comms-incoming-call",
    requireInteraction: true,
    data: { url: "/app" }
  };

  event.waitUntil(self.registration.showNotification("Incoming COMMS call", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url ?? "/app", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => client.url.includes("/app"));
      if (existingClient) return existingClient.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});
