// ====== MagaGrafix — Service Worker ======
const CACHE = 'magagrafix-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=3',
  './script.js?v=3',
  './manifest.json?v=3',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Installa e salva i file in cache
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

// Attiva e cancella cache vecchie
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

// Serve i file dalla cache
self.addEventListener('fetch', e => {
  const req = e.request;
  e.respondWith(
    caches.match(req).then(cached =>
      cached ||
      fetch(req).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, clone));
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
