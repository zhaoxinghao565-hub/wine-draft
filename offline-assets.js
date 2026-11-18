// 离线缓存清单。识别组件（ocr-engine）也一并缓存，断网时仍可识别新截图。
const files = new Map([
  ['index.html', /text\/html/i],
  ['style.css', /text\/css/i],
  ['app.js', /javascript/i],
  ['brand.js', /javascript/i],
  ['data.js', /javascript/i],
  ['artwork.js', /javascript/i],
  ['offline.js', /javascript/i],
  ['offline-assets.js', /javascript/i],
  ['ocr.js', /javascript/i],
  ['ocr-parse.js', /javascript/i],
  ['sample.json', /json/i],
  ['manifest.json', /json/i],
  ['contact-qr.png', /image\/png/i],
  ['icon-192.png', /image\/png/i],
  ['icon-512.png', /image\/png/i],
  // Tesseract.js 本地识别引擎（约 13 MB）。分开发布时 Content-Type 可能是
  // text/javascript、application/gzip 或 application/octet-stream，这里一并接受。
  ['ocr-engine/tesseract.esm.min.js', /javascript/i],
  ['ocr-engine/worker.min.js', /javascript/i],
  ['ocr-engine/tesseract-core-lstm.wasm.js', /javascript/i],
  ['ocr-engine/tesseract-core-simd-lstm.wasm.js', /javascript/i],
  ['ocr-engine/chi_sim.traineddata.gz', /octet-stream|gzip/i],
  ['ocr-engine/eng.traineddata.gz', /octet-stream|gzip/i]
]);

export const cachePrefix = scope => 'wine-draft:' + scope.href + ':';
export const cacheName = scope => cachePrefix(scope) + 'v2.3.0';
export const isAsset = name => files.has(name);
export const resource = (scope, name) => new URL(name, scope).href;
export const assetNames = () => [...files.keys()];
export const ocrAssetNames = () => [...files.keys()].filter(name => name.startsWith('ocr-engine/'));

async function fetchAsset(scope, name) {
  const response = await fetch(resource(scope, name), { cache: 'reload', credentials: 'same-origin' });
  // 私有站登录页或部署错误页不得替换本地工具。
  const type = response.headers.get('Content-Type') || '';
  if (!response.ok || !files.get(name).test(type) || new URL(response.url).origin !== scope.origin) {
    throw new Error('离线资源加载失败：' + name);
  }
  return response;
}

export async function prepareCache(scope, onProgress) {
  const cache = await caches.open(cacheName(scope));
  const missing = [];
  for (const name of files.keys()) {
    if (!(await cache.match(resource(scope, name)))) missing.push(name);
  }
  const total = missing.length;
  let done = 0;
  if (onProgress) onProgress(done, total);
  if (!total) return;
  // 先并发下载，再逐个写入，避免中途失败时留下半个缓存。
  const responses = await Promise.all(missing.map(name => fetchAsset(scope, name)));
  for (const [index, name] of missing.entries()) {
    await cache.put(resource(scope, name), responses[index]);
    done += 1;
    if (onProgress) onProgress(done, total);
  }
}
