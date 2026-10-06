// StudyTools service worker: network-first pages, cached static assets.
// Registered once from index.html; the scope covers the whole site.
const CACHE = 'studytools-v2026-10-04';

// Pages that must never be written to disk (logged-in / payment states).
const PRIVATE = ['/dashboard.html', '/profile.html', '/login.html', '/register.html', '/pro-success.html'];

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // third-party scripts stay untouched
  if (url.pathname.startsWith('/api/')) return;    // never cache user data
  if (PRIVATE.indexOf(url.pathname) !== -1) return; // never cache private pages

  if (request.mode === 'navigate') {
    // Pages: network first so content is never stale, cached copy for offline.
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })))
    );
    return;
  }

  // Static assets (css/js/img/svg): cache first, refresh in the background.
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }));
      return cached || network;
    })
  );
});
