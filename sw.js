import { cacheName, cachePrefix, isAsset, prepareCache, resource } from './offline-assets.js';

// 安装时只缓存制稿壳。识别组件由页面在第一次识别时写入同一缓存。
const scope = new URL(self.registration.scope);

self.addEventListener('install', event => {
  // 缓存完成后立即跳过等待，让新版本在下次刷新时就能生效（否则要等所有旧页面关闭）。
  event.waitUntil(prepareCache(scope).then(() => self.skipWaiting()));
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
