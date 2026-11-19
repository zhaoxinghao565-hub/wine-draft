import { prepareCache } from './offline-assets.js';

const status = document.getElementById('offline-status');
const scope = new URL('./', import.meta.url);
let prepared = false;
let attempted = false;
let preparing;
let missingCount = 0;
let degraded = '';
let updatedNotice = false;
let hadController = false;

function showStatus() {
  if (degraded) {
    status.textContent = degraded;
    status.dataset.ready = 'false';
    return;
  }
  if (updatedNotice) {
    status.textContent = '已更新到新版本，刷新页面后生效';
    status.dataset.ready = 'true';
    return;
  }
  const ready = Boolean(prepared && navigator.serviceWorker.controller);
  if (ready) {
    status.textContent = missingCount
      ? '离线已就绪（' + missingCount + ' 个资源未缓存，联网时会自动补）'
      : (navigator.onLine ? '离线已就绪' : '当前离线，可继续制稿');
  } else {
    status.textContent = attempted ? '离线尚未就绪，请联网重开' : '正在准备离线使用…';
  }
  status.dataset.ready = String(ready);
}

// 旧系统（iOS 16.4 以下）不支持 module service worker，要给出准确原因而不是让用户怀疑网络。
function unsupportedMessage() {
  return '当前浏览器版本不支持离线缓存（需 iOS 16.4 或更新）；联网制稿与导出不受影响。';
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
    const result = await prepareCache(scope, (done, total) => {
      lastProgress = '正在缓存离线资源 ' + done + ' / ' + total + '…（识别组件约 13 MB）';
      if (!prepared) status.textContent = lastProgress;
    });
    lastProgress = '';
    missingCount = result && Array.isArray(result.failed) ? result.failed.length : 0;
    prepared = true;
    showStatus();
    if (navigator.onLine || !navigator.serviceWorker.controller) {
      try {
        await navigator.serviceWorker.register('./sw.js', { type: 'module', updateViaCache: 'none' });
        await navigator.serviceWorker.ready;
      } catch {
        degraded = unsupportedMessage();
        showStatus();
      }
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
  hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 首次安装也会触发 controllerchange；只有替换掉旧控制器才提示“已更新”。
    if (hadController) updatedNotice = true;
    hadController = true;
    showStatus();
  });
  window.addEventListener('online', start);
  window.addEventListener('offline', showStatus);
  start();
} else {
  status.textContent = window.isSecureContext ? unsupportedMessage() : '离线缓存需要 HTTPS';
}
