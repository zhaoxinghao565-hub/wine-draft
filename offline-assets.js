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
export const cacheName = scope => cachePrefix(scope) + 'v3.3.1';
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
  const failed = [];
  if (onProgress) onProgress(done, total);
  if (!total) return { total, failed };
  // 单个资源失败（弱网、单文件 404）不应让整个离线能力失效：逐个记录，其余照常缓存。
  const results = await Promise.allSettled(missing.map(name => fetchAsset(scope, name)));
  for (const [index, name] of missing.entries()) {
    const result = results[index];
    if (result.status === 'fulfilled') {
      try {
        await cache.put(resource(scope, name), result.value);
      } catch {
        failed.push(name);
      }
    } else {
      failed.push(name);
    }
    done += 1;
    if (onProgress) onProgress(done, total);
  }
  return { total, failed };
}
