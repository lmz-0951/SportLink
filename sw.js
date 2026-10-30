/* SportLink PWA V1: offline shell only; never cache Supabase or authenticated API data. */
const CACHE = 'sportlink-shell-v5';
const SHELL = ['/', '/index.html', '/style.css', '/design-slate-orange.css', '/athlete.svg', '/icon-192.png', '/icon-512.png'];
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
  if (['/style.css', '/design-slate-orange.css', '/app.js', '/athlete.svg', '/pwa-register.js'].includes(url.pathname) || ['/icon-192.png','/icon-512.png'].includes(url.pathname)) {
    event.respondWith(fetch(req).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(req, copy)); }
      return response;
    }).catch(() => caches.match(req)));
  }
});

self.addEventListener('push',event=>{event.waitUntil((async()=>{let data={};try{data=event.data?.json()||{}}catch{}const url=new URL(String(data.url||'/?sl_tab=messages'),self.location.origin);await self.registration.showNotification(String(data.title||'SportLink 新訊息').slice(0,100),{body:String(data.body||'你收到好友訊息').slice(0,200),icon:'/icon-192.png',tag:String(data.tag||'sportlink-message').slice(0,100),data:{url:url.origin===self.location.origin?url.href:self.location.origin+'/?sl_tab=messages'}})})())});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const url=event.notification.data?.url||self.location.origin+'/?sl_tab=messages';const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=clients.find(c=>new URL(c.url).origin===self.location.origin);if(existing){await existing.focus();if('navigate' in existing)await existing.navigate(url)}else await self.clients.openWindow(url)})())});
