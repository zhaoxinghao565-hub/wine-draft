import { prepareCache } from './offline-assets.js';

const status = document.getElementById('offline-status');
const scope = new URL('./', import.meta.url);
let prepared = false;
let attempted = false;
let preparing;

function showStatus() {
  const ready = Boolean(prepared && navigator.serviceWorker.controller);
  if (ready) {
    status.textContent = navigator.onLine ? '离线已就绪' : '当前离线，可继续制稿';
  } else {
    status.textContent = attempted ? '离线尚未就绪，请联网重开' : '正在准备离线使用…';
  }
  status.dataset.ready = String(ready);
}

async function enableOffline() {
  let lastProgress = '';
  const timer = setTimeout(() => {
    if (lastProgress) {
      status.textContent = lastProgress;
      return;
    }
    attempted = true;
    showStatus();
  }, 12000);
  try {
    // 由当前页面预加载，同源私有站授权和本地预览均沿用当前页面的连接。
    await prepareCache(scope, (done, total) => {
      lastProgress = '正在缓存离线资源 ' + done + ' / ' + total + '…（识别组件约 13 MB）';
      if (!prepared) status.textContent = lastProgress;
    });
    lastProgress = '';
    prepared = true;
    showStatus();
    if (navigator.onLine || !navigator.serviceWorker.controller) {
      await navigator.serviceWorker.register('./sw.js', { type: 'module', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
    }
  } catch {
    attempted = true;
    showStatus();
  } finally {
    clearTimeout(timer);
  }
}

function start() {
  if (!preparing) preparing = enableOffline().finally(() => { preparing = null; });
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.addEventListener('controllerchange', showStatus);
  window.addEventListener('online', start);
  window.addEventListener('offline', showStatus);
  start();
} else {
  status.textContent = '离线缓存需要 HTTPS';
}
