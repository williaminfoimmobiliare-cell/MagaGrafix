// ===== MagaGrafix — Service Worker (v4) =====
const CACHE = 'magagrafix-v4';

// Metti qui gli asset “di base” che vuoi disponibili anche offline.
// ⚠️ Devono combaciare con le versioni usate in index.html (es. ?v=4).
const ASSETS = [
  './',
  './index.html',
  './style.css?v=4',
  './script.js?v=4',
  './manifest.json?v=4',
  './scan.html',
  './scan.js?v=1',          // se aggiorni scan.js, cambia anche qui il ?v=
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install: precache degli asset
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  // Attiva subito il nuovo SW senza aspettare il reload
  self.skipWaiting();
});

// Activate: pulizia cache vecchie
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)))
    )
  );
  // Prendi subito il controllo delle pagine aperte
  self.clients.claim();
});

// Fetch: cache-first con fallback rete + cache dinamica
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Gestisci solo richieste GET
  if (req.method !== 'GET') return;

  // Per richieste di navigazione (Single Page App / GitHub Pages),
  // se fallisce la rete, torna la index (offline fallback).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Per il resto: prova cache → rete; mette in cache le risposte “buone”.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Clona e salva in cache solo se risposta OK e stesso-origin
          const resClone = res.clone();
          // Evita di mettere in cache richieste a domini esterni se non vuoi
          // (qui le lasciamo, ma puoi filtrare con new URL(req.url).origin)
          caches.open(CACHE).then((cache) => cache.put(req, resClone)).catch(()=>{});
          return res;
        })
        .catch(() => {
          // Fallback minimo: se è un’icona o asset noto, prova match
          return caches.match('./index.html');
        });
    })
  );
});
