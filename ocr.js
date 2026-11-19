import { assembleOcr, findProduct, matchedRow, needsBrandLabels, readRows } from './ocr-parse.js';

const engine = new URL('./ocr-engine/', import.meta.url);
const nameCharacters = '0123456789零一二三四五六七八九十百年飞天原箱整散瓶公斤茅台度精品水晶剑珍藏级普代粮液()（）';
const darkAt = (pixels, width, x, y) => {
  const i = 4 * (y * width + x);
  return 0.30 * pixels[i] + 0.59 * pixels[i + 1] + 0.11 * pixels[i + 2] < 130;
};

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function averageBrightness(ctx, width, height) {
  const { data } = ctx.getImageData(0, 0, width, height);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4 * 53) {
    sum += 0.30 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
    count += 1;
  }
  return count ? sum / count : 255;
}

async function loadScreenshot(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // 长截图压得太小会让 30px 的文字变成 20px，识别率明显下降；上限放宽到 3200。
    let scale = Math.min(1, 3200 / Math.max(image.naturalWidth, image.naturalHeight));
    let width = Math.round(image.naturalWidth * scale);
    let height = Math.round(image.naturalHeight * scale);
    // 窄图（微信压缩常见）先放大到约 1000px 宽，文字变大后识别率明显回升。
    if (width < 800) {
      const up = Math.min(3, 1200 / width);
      if (height * up <= 4000) {
        width = Math.round(width * up);
        height = Math.round(height * up);
      }
    }
    const raw = makeCanvas(width, height);
    const rawCtx = raw.getContext('2d');
    rawCtx.fillStyle = '#fff';
    rawCtx.fillRect(0, 0, raw.width, raw.height);
    rawCtx.drawImage(image, 0, 0, raw.width, raw.height);

    let work = raw;
    // 深色模式截图（黑底白字）Tesseract 几乎读不出来，识别前先做反色；日期红块仍从原图取。
    if (averageBrightness(rawCtx, raw.width, raw.height) < 110) {
      work = makeCanvas(raw.width, raw.height);
      const ctx = work.getContext('2d');
      ctx.drawImage(raw, 0, 0);
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, work.width, work.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    return { raw, work, sourceWidth: image.naturalWidth };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 涨跌箭头是蓝底圆角图标；OCR 在低质量图上会把它读成数字（如 1680 → 16803）。
// 在识别前把它涂白，从源头消除这类错值。
function isArrowPixel(r, g, b) {
  return b > r + 18 && b > 95;
}

function arrowBoxes(pixels, width, height, xStart) {
  const boxes = [];
  let band = null;
  for (let y = 0; y < height; y += 2) {
    let left = Infinity;
    let right = -1;
    let count = 0;
    for (let x = Math.max(0, xStart); x < width; x += 2) {
      const i = 4 * (y * width + x);
      if (isArrowPixel(pixels[i], pixels[i + 1], pixels[i + 2])) {
        count += 1;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    if (count >= 8) {
      if (!band) band = { top: y, bottom: y, left, right };
      else {
        band.bottom = y;
        band.left = Math.min(band.left, left);
        band.right = Math.max(band.right, right);
      }
    } else if (band) {
      boxes.push(band);
      band = null;
    }
  }
  if (band) boxes.push(band);
  return boxes
    .filter(box => {
      const h = box.bottom - box.top;
      const w = box.right - box.left;
      return h >= 12 && h <= 80 && w >= 12 && w <= 80 && w / h > 0.5 && w / h < 1.8;
    })
    .slice(0, 80);
}

function cropRedBlock(pixels, width, block) {
  const { left, right, top, bottom } = block;
  const header = makeCanvas(right - left + 24, bottom - top + 24);
  const ctx = header.getContext('2d');
  const image = ctx.createImageData(header.width, header.height);
  image.data.fill(255);
  for (let y = Math.max(0, top + 5); y < bottom - 5; y++) {
    for (let x = Math.max(0, left + 5); x < right - 5; x++) {
      const raw = 4 * (y * width + x);
      const out = 4 * ((y - top + 12) * header.width + x - left + 12);
      const shade = pixels[raw + 1] >= 150 && pixels[raw + 2] >= 150 ? 0 : 255;
      image.data.fill(shade, out, out + 3);
    }
  }
  ctx.putImageData(image, 0, 0);

  // 日期块左边的黑底品牌标题（茅台 / 五粮液 / 剑南春…），用于校验酒款归属。
  const brandLeft = Math.floor(width * 0.275);
  const brandWidth = Math.max(1, left - brandLeft - 4);
  const brand = makeCanvas(brandWidth + 16, bottom - top + 16);
  const brandCtx = brand.getContext('2d');
  const brandData = brandCtx.createImageData(brand.width, brand.height);
  brandData.data.fill(255);
  for (let y = Math.max(0, top + 5); y < bottom - 5; y++) {
    for (let x = brandLeft; x < brandLeft + brandWidth; x++) {
      const raw = 4 * (y * width + x);
      const out = 4 * ((y - top + 8) * brand.width + x - brandLeft + 8);
      const shade = pixels[raw] >= 90 && pixels[raw + 1] >= 90 && pixels[raw + 2] >= 90 ? 0 : 255;
      brandData.data.fill(shade, out, out + 3);
    }
  }
  brandCtx.putImageData(brandData, 0, 0);
  return { header, brand, end: bottom + 6 };
}

// 长截图里每个品牌区块都有自己的红色日期块，位置不固定；整图扫描并取前几个。
function headerImages(pixels, width, height) {
  const limit = Math.min(height, Math.round(height * 0.85));
  const bands = [];
  let current = null;
  for (let y = 0; y < limit; y += 2) {
    const red = [];
    for (let x = Math.floor(width * 0.45); x < width; x += 2) {
      const i = 4 * (y * width + x);
      if (pixels[i] > 120 && pixels[i] - pixels[i + 1] > 55 && pixels[i] - pixels[i + 2] > 30) red.push(x);
    }
    if (red.length < width * 0.06) {
      if (current) { bands.push(current); current = null; }
      continue;
    }
    if (!current) current = { left: red[0], right: red.at(-1), top: y, bottom: y };
    else {
      current.left = Math.min(current.left, red[0]);
      current.right = Math.max(current.right, red.at(-1));
      current.bottom = y;
    }
  }
  if (current) bands.push(current);
  return bands
    .filter(block => block.right - block.left >= width * 0.12 && block.bottom - block.top >= 20)
    .slice(0, 3)
    .map(block => cropRedBlock(pixels, width, block));
}

export function prepareScreenshot(raw, work = raw) {
  const width = work.width;
  const height = work.height;
  const rawCtx = raw.getContext('2d');
  const rawData = raw === work ? null : rawCtx.getImageData(0, 0, width, height).data;
  const originalPixels = rawData || rawCtx.getImageData(0, 0, width, height).data;

  const canvas = work;
  // 轻微旋转（手机拍照/缩放）会让整行错位，先估角度再转正。
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, width, height);
  // 红底日期块和顶部元信息始终在原始配色上检测，反色图会把红色变成青色。
  const headers = headerImages(rawData || data, width, height);
  const masked = new Uint8Array(height);
  const left = Math.floor(width * 0.1);
  const right = Math.floor(width * 0.9);
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = left; x < right; x += 2) dark += Number(darkAt(data, width, x, y));
    if (dark > (right - left) * 0.205) {
      masked.fill(1, Math.max(0, y - 2), Math.min(height, y + 3));
    }
  }
  const maskedRows = masked.reduce((sum, value) => sum + value, 0);
  // 表格密集时遮罩会吃掉大半页面，导致密度全为 0；超过 60% 就不再遮罩。
  if (maskedRows > height * 0.6) masked.fill(0);
  const bodyHeight = height - masked.reduce((sum, value) => sum + value, 0);
  const density = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let dark = 0;
    for (let y = 0; y < height; y++) {
      if (!masked[y] && darkAt(data, width, x, y)) dark++;
    }
    density[x] = bodyHeight ? dark / bodyHeight : 0;
  }
  // 找不到竖线时按四列表格的常见比例兜底，避免整张图直接放弃。
  const fallback = [0.33, 0.60, 0.79].map(ratio => Math.round(width * ratio));
  const columns = [[0.25, 0.47], [0.49, 0.66], [0.67, 0.84]].map(([lo, hi], index) => {
    let peak = Math.floor(width * lo);
    for (let x = peak + 1; x < width * hi; x++) {
      if (density[x] > density[peak]) peak = x;
    }
    return density[peak] > 0.18 ? peak : fallback[index];
  });
  ctx.fillStyle = '#fff';
  for (let y = 0; y < height; y++) if (masked[y]) ctx.fillRect(0, y, width, 1);
  for (const x of columns) if (x !== null) ctx.fillRect(x - 4, 0, 9, height);
  let leftEdge = 0;
  while (leftEdge < width * 0.16 && density[leftEdge] > 0.8) leftEdge++;
  let rightEdge = width - 1;
  while (rightEdge > width * 0.84 && density[rightEdge] > 0.8) rightEdge--;
  ctx.fillRect(0, 0, leftEdge, height);
  ctx.fillRect(rightEdge + 1, 0, width - rightEdge, height);
  // 元信息条：整图上方 30%（最多 360px），红底、白底、深色底都能读到日期与来源。
  const metaHeight = Math.max(1, Math.min(360, Math.round(height * 0.30)));
  const meta = makeCanvas(width, metaHeight);
  const metaCtx = meta.getContext('2d');
  metaCtx.fillStyle = '#fff';
  metaCtx.fillRect(0, 0, width, metaHeight);
  metaCtx.drawImage(raw, 0, 0, width, metaHeight, 0, 0, width, metaHeight);
  return { canvas, headers, meta, columns };
}

async function retryNames(worker, canvas, columns, unclear, budget) {
  if (!unclear.length) return [];
  const boundary = columns[0];
  const recovered = [];
  await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: nameCharacters });
  try {
    for (const item of unclear.slice(0, 14)) {
      const left = Math.max(0, Math.min(item.left - 12, Math.floor(boundary * 0.24)));
      const top = Math.max(0, item.top - 20);
      const width = boundary - 14 - left;
      const height = Math.min(canvas.height, item.bottom + 20) - top;
      const crop = makeCanvas(600, 150);
      const ctx = crop.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 150);
      ctx.drawImage(canvas, left, top, width, height, 0, 13, 600, 125);
      const { data } = await worker.recognize(crop);
      crop.width = crop.height = 1;
      const index = findProduct(data.text, item.spec);
      const row = matchedRow(index, item.brand, data.text, item.prices);
      if (row && data.confidence >= 60) recovered.push({ row, item });
    }
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
  }
  // 名字救回来了但价格还缺的行，循环结束后再统一补识别（参数切换很贵，集中做）。
  for (const { row, item } of recovered) {
    for (const field of ['yesterday', 'today']) {
      if (!row[field] && budget.left > 0) {
        budget.left -= 1;
        row[field] = await ocrCell(worker, canvas, columns, field, item.top, item.bottom);
      }
    }
  }
  return recovered.map(({ row }) => ({ ...row, checkBrand: false }));
}

// 用数字白名单单独识别一个价格单元格（深色截图已在 work 图里反色）。
async function ocrCell(worker, canvas, columns, field, top, bottom) {
  const start = field === 'yesterday' ? columns[1] : columns[2];
  const end = field === 'yesterday' ? columns[2] : canvas.width;
  const left = Math.max(0, start - 10);
  const width = Math.max(8, Math.min(canvas.width, end + 10) - left);
  const y = Math.max(0, top - 8);
  const height = Math.max(8, Math.min(canvas.height, bottom + 8) - y);
  const crop = makeCanvas(Math.max(8, width * 2), Math.max(8, height * 2));
  const ctx = crop.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, crop.width, crop.height);
  ctx.drawImage(canvas, left, y, width, height, 0, 0, crop.width, crop.height);
  let value = '';
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789.' });
    const { data } = await worker.recognize(crop);
    value = (data.text || '').replace(/[^\d.]/g, '');
  } finally {
    crop.width = crop.height = 1;
  }
  return /^\d{1,7}(?:\.\d{1,2})?$/.test(value) ? value : '';
}

async function retryMissingPrices(worker, canvas, columns, missing, budget) {
  if (!missing.length) return [];
  const rows = [];
  try {
    for (const item of missing) {
      if (budget.left <= 0) break;
      budget.left -= 1;
      const value = await ocrCell(worker, canvas, columns, item.field, item.top, item.bottom);
      if (value) rows.push({ index: item.index, [item.field]: value, checkBrand: false });
    }
    return rows;
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
  }
}

export async function recognizeScreenshots(files, progress) {
  const { default: { createWorker } } = await import('./ocr-engine/tesseract.esm.min.js');
  const worker = await new Promise((resolve, reject) => {
    createWorker(['chi_sim', 'eng'], 1, {
      workerPath: new URL('worker.min.js', engine).href,
      corePath: engine.href,
      langPath: engine.href.slice(0, -1),
      workerBlobURL: false,
      cacheMethod: 'none',
      errorHandler: reject
    }).then(resolve, reject);
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const results = [];
    // 价格单元格补识别很贵（每次约 2 秒），整批最多补 4 格。
    const cellBudget = { left: 4 };
    for (const [index, file] of files.entries()) {
      progress(index + 1, files.length);
      try {
        const shot = await loadScreenshot(file);
        const { canvas, headers, meta, columns } = prepareScreenshot(shot.raw, shot.work);
        const { data } = await worker.recognize(canvas, {}, { text: true, tsv: true });
        let banner = '';
        const brands = [];
        const needBrands = needsBrandLabels();
        for (const item of headers) {
          banner += (await worker.recognize(item.header)).data.text + '\n';
          if (needBrands) {
            const label = (await worker.recognize(item.brand)).data.text.replace(/\s/g, '');
            brands.push({ end: item.end, label });
          }
        }
        const topText = meta ? (await worker.recognize(meta)).data.text : '';
        const marked = (banner + '\n' + topText).trim();
        const { rows, unclear, missing } = readRows(data.tsv, columns, brands);
        if (columns) {
          rows.push(...await retryNames(worker, canvas, columns, unclear, cellBudget));
          rows.push(...await retryMissingPrices(worker, canvas, columns, missing, cellBudget));
        }
        const issue = rows.length ? '' : '第 ' + (index + 1) +
          ' 张里没有 15 款模板内的酒款（可能只截到表头或其他品牌），请换含目标酒款的截图。';
        const warning = shot.sourceWidth < 800
          ? '第 ' + (index + 1) + ' 张截图宽度只有 ' + shot.sourceWidth + ' 像素，识别率会下降，建议发送原图。'
          : '';
        results.push({ rows, text: data.text + '\n' + marked, issue, warning });
      } catch {
        results.push({ issue: '第 ' + (index + 1) + ' 张无法识别，请用清晰的 PNG 或 JPG 重试。' });
      }
    }
    return assembleOcr(results);
  } finally {
    await worker.terminate();
  }
}
