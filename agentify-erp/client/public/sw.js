/* Service worker: caches the app shell for fast/offline start; caches only the session + lookups for offline start. Handles web-push. */
const CACHE = 'erp-shell-v2';
const API_CACHE = 'erp-session-v1'; // only the signed-in user + lookups, so the app can open offline; wiped on sign-out
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== API_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (u.pathname.startsWith('/downloads/')) return; // app file: let the browser fetch it directly (never answer with the cached home page)
  if (u.origin === location.origin && r.method === 'POST' && u.pathname === '/api/auth/logout') { e.waitUntil(caches.delete(API_CACHE)); return; }
  if (r.method === 'GET' && u.origin === location.origin && (u.pathname === '/api/auth/me' || u.pathname === '/api/settings/meta')) {
    e.respondWith(fetch(r).then((res) => { if (res.ok) { const cp = res.clone(); caches.open(API_CACHE).then((c) => c.put(r, cp)); } return res; }).catch(() => caches.open(API_CACHE).then((c) => c.match(r)).then((hit) => hit || new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/uploads/')) return;
  if (r.mode === 'navigate') { e.respondWith(fetch(r).catch(() => caches.match('/'))); return; }
  e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => { if (res.ok && /\/assets\//.test(u.pathname)) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(r, cp)); } return res; })));
});
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: 'Expert ERP', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Expert ERP', { body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', data: { link: d.link || '/' }, tag: d.tag }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close(); const link = (e.notification.data && e.notification.data.link) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => { for (const c of cs) { if ('focus' in c) { c.navigate(link); return c.focus(); } } return self.clients.openWindow(link); }));
});
