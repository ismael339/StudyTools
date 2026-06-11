const CACHE_RESET = 'studytools-cache-reset-2026-06-11-v2';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => fetch(request)));
    return;
  }

  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
