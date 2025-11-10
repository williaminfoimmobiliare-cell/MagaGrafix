// ===== MagaGrafix — Service Worker (v5) =====
const CACHE = 'magagrafix-v6';

const ASSETS = [
  './',
  './index.html',
  './style.css?v=5',
  './script.js?v=5',
  './manifest.json?v=5',
  './scan.html',
  './scan.js?v=2',          // ricorda di aggiornare anche in scan.html
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, clone)).catch(()=>{});
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
