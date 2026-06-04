const CACHE = 'ping-v1';
const ASSETS = ['/', '/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// Background notification scheduling
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SCHEDULE_NOTIFICATIONS') {
    const reminders = e.data.reminders || [];
    const now = Date.now();
    reminders.forEach(r => {
      if (!r.done && r.time) {
        const ms = new Date(r.time).getTime() - now;
        if (ms > 0 && ms < 7 * 24 * 60 * 60 * 1000) {
          setTimeout(() => {
            self.registration.showNotification('Ping', {
              body: r.title,
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: r.id,
              data: { id: r.id }
            });
          }, ms);
        }
      }
    });
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
