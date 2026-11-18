// GitHub Pages substitutes the commit SHA for this version when staging the site.
const CACHE_VERSION = 'development-v1';
const scope = self.registration.scope;
const cachePrefix = `sub-t-training-planner:${scope}:`;
const cacheName = cachePrefix + CACHE_VERSION;
const indexUrl = new URL('index.html', scope).href;
const offlineUrls = new Set([
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'src/app.mjs',
  'src/coros.mjs',
  'src/cross-training.mjs',
  'src/engine.mjs',
  'src/pwa.mjs',
  'src/reference.mjs',
].map((path) => new URL(path, scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cacheExists = await caches.has(cacheName);
    try {
      const cache = await caches.open(cacheName);
      await cache.addAll([...offlineUrls].map((url) => new Request(url, { cache: 'reload' })));
    } catch (error) {
      if (!cacheExists) await caches.delete(cacheName);
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const oldCaches = (await caches.keys()).filter((key) => key.startsWith(cachePrefix) && key !== cacheName);
    await Promise.all(oldCaches.map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'activate-update') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const canonical = url.origin + url.pathname;
  const isAppNavigation = request.mode === 'navigate' && (canonical === scope || canonical === indexUrl);
  const key = isAppNavigation ? indexUrl : canonical;
  if (!offlineUrls.has(key)) return;

  event.respondWith((async () => {
    const cached = await caches.match(key, { cacheName });
    return cached ?? fetch(request);
  })());
});
