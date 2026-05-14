/* global firebase */
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

// Replace these values during deployment if your Flutter build env changes.
// The service worker is served as a static file, so Dart --dart-define values
// are not visible here.
firebase.initializeApp({
  apiKey: '__FIREBASE_API_KEY__',
  authDomain: '__FIREBASE_AUTH_DOMAIN__',
  projectId: '__FIREBASE_PROJECT_ID__',
  storageBucket: '__FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: '__FIREBASE_MESSAGING_SENDER_ID__',
  appId: '__FIREBASE_APP_ID__',
});

const messaging = firebase.messaging();

function notificationOptions(data) {
  const type = data.type || 'message';
  const protectedPayload = data.privacy === 'protected';
  const title = protectedPayload ? 'COMMS' : (data.title || 'COMMS');
  const body = protectedPayload ? 'New notification' : (data.body || 'You have a new notification.');
  const targetUrl = data.targetUrl || '/app';
  return {
    title,
    options: {
      body,
      icon: '/icons/Icon-192.png',
      badge: '/favicon.png',
      tag: data.tag || `comms-${type}`,
      renotify: type === 'call',
      requireInteraction: type === 'call',
      data: {
        ...data,
        targetUrl,
      },
    },
  };
}

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const built = notificationOptions(data);
  return self.registration.showNotification(built.title, built.options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.targetUrl || '/app';
  const target = new URL(targetUrl, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) return client.navigate(target);
        return;
      }
    }
    return clients.openWindow(target);
  })());
});
