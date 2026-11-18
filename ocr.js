import { assembleOcr, findProduct, readRows } from './ocr-parse.js';

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

async function loadScreenshot(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = makeCanvas(Math.round(image.naturalWidth * scale), Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function headerImage(pixels, width, height) {
  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;
  for (let y = 0; y < Math.min(320, height * 0.55); y += 2) {
    const red = [];
    for (let x = Math.floor(width * 0.50); x < width; x += 2) {
      const i = 4 * (y * width + x);
      if (pixels[i] > 120 && pixels[i] - pixels[i + 1] > 55 && pixels[i] - pixels[i + 2] > 30) red.push(x);
    }
    if (red.length < width * 0.06) continue;
    left = Math.min(left, red[0]);
    right = Math.max(right, red.at(-1));
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  if (right - left < width * 0.12 || bottom - top < 20) return null;
  const header = makeCanvas(right - left + 24, bottom - top + 24);
  const ctx = header.getContext('2d');
  const image = ctx.createImageData(header.width, header.height);
  image.data.fill(255);
  for (let y = top + 5; y < bottom - 5; y++) {
    for (let x = left + 5; x < right - 5; x++) {
      const raw = 4 * (y * width + x);
      const out = 4 * ((y - top + 12) * header.width + x - left + 12);
      const shade = pixels[raw + 1] >= 150 && pixels[raw + 2] >= 150 ? 0 : 255;
      image.data.fill(shade, out, out + 3);
    }
  }
  ctx.putImageData(image, 0, 0);
  return header;
}

export function prepareScreenshot(canvas) {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, width, height);
  const header = headerImage(data, width, height);
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
  const bodyHeight = height - masked.reduce((sum, value) => sum + value, 0);
  const density = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let dark = 0;
    for (let y = 0; y < height; y++) {
      if (!masked[y] && darkAt(data, width, x, y)) dark++;
    }
    density[x] = bodyHeight ? dark / bodyHeight : 0;
  }
  const columns = [[0.25, 0.47], [0.49, 0.66], [0.67, 0.84]].map(([lo, hi]) => {
    let peak = Math.floor(width * lo);
    for (let x = peak + 1; x < width * hi; x++) {
      if (density[x] > density[peak]) peak = x;
    }
    return density[peak] > 0.26 ? peak : null;
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
  return { canvas, header, columns: columns.includes(null) ? null : columns };
}

async function retryNames(worker, canvas, boundary, unclear) {
  if (!unclear.length) return [];
  await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: nameCharacters });
  const rows = [];
  try {
    for (const item of unclear) {
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
      const index = findProduct(data.text, item.spec);
      if (index >= 0 && data.confidence >= 60) rows.push({ index, ...item.prices });
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
    for (const [index, file] of files.entries()) {
      progress(index + 1, files.length);
      try {
        const { canvas, header, columns } = prepareScreenshot(await loadScreenshot(file));
        const { data } = await worker.recognize(canvas, {}, { text: true, tsv: true });
        const marked = header ? (await worker.recognize(header)).data.text : '';
        const { rows, unclear } = readRows(data.tsv, columns);
        if (columns) rows.push(...await retryNames(worker, canvas, columns[0], unclear));
        const issue = rows.length ? '' : '第 ' + (index + 1) + ' 张未匹配到酒款，请换清晰的四列表格截图。';
        results.push({ rows, text: data.text + '\n' + marked, issue });
      } catch {
        results.push({ issue: '第 ' + (index + 1) + ' 张无法识别，请用清晰的 PNG 或 JPG 重试。' });
      }
    }
    return assembleOcr(results);
  } finally {
    await worker.terminate();
  }
}
