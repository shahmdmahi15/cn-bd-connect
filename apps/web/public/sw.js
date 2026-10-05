const CACHE_NAME = 'cn-bd-connect-v4';
const STATIC_ASSETS = ['/', '/manifest.json', '/logo.png', '/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Never intercept dynamic backend API or socket traffic
  if (
    event.request.url.includes('/api/') ||
    event.request.url.includes('/socket.io/')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request)),
  );
});

// --- Web Push Notifications (iOS 16.4+ APNs, Android, Desktop) ---
self.addEventListener('push', (event) => {
  let data = {
    title: 'CN-BD Connect 📞',
    body: 'Incoming call...',
    tag: 'call-alert',
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  const title = data.title || 'CN-BD Connect';
  const options = {
    body: data.body || 'Incoming call...',
    icon: data.icon || '/icons/icon-192x192.png',
    badge: data.badge || '/icons/icon-72x72.png',
    sound: '/ringtone.mp3',
    // Strong rhythmic incoming call vibration pattern (ringing pulse)
    vibrate: [600, 300, 600, 300, 600, 300, 1000, 400, 1000],
    tag: data.tag || 'call-notification',
    renotify: true,
    requireInteraction: true,
    data: data.data || { url: '/' },
    actions: [
      { action: 'answer', title: '📞 Answer Call' },
      { action: 'decline', title: '❌ Decline' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// --- Handle Notification Click: Focus existing tab or open PWA window ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const urlToOpen = notificationData.url || '/';

  if (event.action === 'decline') {
    // Notify clients that call was declined from notification
    event.waitUntil(
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((windowClients) => {
          for (const client of windowClients) {
            client.postMessage({
              type: 'INCOMING_CALL_DECLINED',
              data: notificationData,
            });
          }
        }),
    );
    return;
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // If app tab already open, focus it and notify client
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin)) {
            client.postMessage({
              type: 'OPEN_INCOMING_CALL',
              data: notificationData,
            });
            if ('focus' in client) {
              client.focus();
            }
            if ('navigate' in client && urlToOpen !== '/') {
              return client.navigate(urlToOpen);
            }
            return client;
          }
        }
        // Otherwise open new PWA window with deep-link
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      }),
  );
});
