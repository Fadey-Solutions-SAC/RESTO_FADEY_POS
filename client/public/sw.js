/* PWA + actualización: versión __SW_VERSION__ se reemplaza en el build (vite). */

const VERSION = '__SW_VERSION__';
const CACHE_TAG = `resto-fadey-${VERSION}`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_TAG).then((cache) => cache.addAll(['/', '/index.html']).catch(() => {})),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('resto-fadey-') && k !== CACHE_TAG)
            .map((k) => {
              console.log('[sw] limpiando cache antigua:', k);
              return caches.delete(k);
            }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.pathname.startsWith('/api')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && (req.destination === 'document' || req.destination === 'script' || req.destination === 'style' || req.destination === 'image' || req.destination === 'font' || req.mode === 'navigate')) {
          const copy = res.clone();
          caches.open(CACHE_TAG).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const index = await caches.match('/index.html') || await caches.match('/');
          if (index) return index;
        }
        return Response.error();
      }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
