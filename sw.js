const CACHE_NAME = 'pwg-chatroom-shell-v62';
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css?v=media6',
  '/app.js?v=media7',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/pwg-logo.png',
  '/sky-background.png',
  '/icon-512-maskable.png',
  '/apple-touch-icon.png',
  '/vendor/qrcode-generator.js',
  '/vendor/jsQR.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('pwg-chatroom-') && key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || 'Du hast eine neue Mitteilung.' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'PWG Chatroom', {
    body: data.body || 'Du hast eine neue Mitteilung.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'pwg-chatroom',
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        if ('navigate' in client) await client.navigate(targetUrl);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put('/index.html', response.clone()));
      return response;
    }).catch(async () => (await caches.match('/index.html')) || Response.error()));
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
