// Service worker sederhana: cache app-shell (HTML/CSS/JS/ikon) supaya
// situs bisa diinstal sebagai app di HP. Data dari /api/* SELALU diambil
// langsung dari server (tidak di-cache) supaya berita & status pengaduan
// selalu yang terbaru.

const CACHE_NAME = 'damkar-ds-shell-v1';
const APP_SHELL = [
  'index.html',
  'berita.html',
  'berita-detail.html',
  'layanan.html',
  'profil.html',
  'program.html',
  'pengaduan.html',
  'kontak.html',
  'css/style.css',
  'js/layout.js',
  'js/main.js',
  'partials/header.html',
  'partials/footer.html',
  'manifest.json',
  'img/icons/icon-192.png',
  'img/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Jangan cache API — selalu ambil data terbaru dari server.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // App shell: cache-first, fallback ke network, lalu update cache diam-diam.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
