// Offline-Speicher für Wesenwelt (Version 202610300803)
const VERSION = '202610300803';
const CACHE = 'wesenwelt-' + VERSION;
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];
self.addEventListener('install', e => {
  // cache: 'reload' umgeht den Zwischenspeicher von GitHub Pages, damit wirklich die neue Version landet
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage({ type: 'version', v: VERSION });
  })());
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Spielseite: erst Netz (für Updates), sonst Offline-Kopie. Alles andere: erst Offline-Kopie.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put('./index.html', c)); return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  })));
});
