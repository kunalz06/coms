self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = {};
  }

  const title = data.title || 'COMMS';
  const options = {
    body: data.body || 'You have a new notification.',
    icon: '/icons/Icon-192.png',
    badge: '/favicon.png',
    tag: data.tag || data.type || 'comms',
    data: {
      url: data.url || '/chats',
      conversationId: data.conversationId || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || '/chats';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    const absoluteUrl = new URL(url, self.location.origin).href;
    for (const client of allClients) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) return client.navigate(absoluteUrl);
        return;
      }
    }
    if (clients.openWindow) return clients.openWindow(absoluteUrl);
  })());
});
