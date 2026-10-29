/* SportLink PWA V1: offline shell only; never cache Supabase or authenticated API data. */
const CACHE = 'sportlink-shell-v1';
const SHELL = ['/', '/index.html', '/style.css', '/athlete.svg', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('sportlink-shell-') && k !== CACHE).map(k => caches.delete(k)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  // Static assets only. Application JS is network-first to avoid stale logic.
  if (['/style.css', '/app.js', '/athlete.svg', '/pwa-register.js'].includes(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(fetch(req).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(req, copy)); }
      return response;
    }).catch(() => caches.match(req)));
  }
});
