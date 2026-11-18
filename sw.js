import { cacheName, cachePrefix, isAsset, prepareCache, resource } from './offline-assets.js';

// v2 增加正式稿与本机截图识别入口。
const scope = new URL(self.registration.scope);

self.addEventListener('install', event => {
  event.waitUntil(prepareCache(scope));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(cachePrefix(scope)) && key !== cacheName(scope))
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function localResponse(request, name) {
  try {
    const cache = await caches.open(cacheName(scope));
    const cached = await cache.match(resource(scope, name));
    if (cached) return cached;
  } catch {
    // 浏览器存储不可用时走普通联网请求。
  }
  return fetch(request);
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  const name = event.request.mode === 'navigate' && !path ? 'index.html' : path;
  if (isAsset(name)) event.respondWith(localResponse(event.request, name));
});
