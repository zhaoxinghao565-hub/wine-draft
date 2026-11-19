import { PRODUCTS, PRICE_KEYS, blankDraft, validDate } from './data.js';

const normalize = text => text.normalize('NFKC').replace(/\s+/g, '');
const key = text => normalize(text).replace(/[()｜|,、]/g, '');
const names = new Map([
  ['26年飞天原', '2026年飞天（原箱）'], ['26年飞天原箱', '2026年飞天（原箱）'],
  ['26年飞天散', '2026年飞天（散瓶）'], ['26年飞天散瓶', '2026年飞天（散瓶）'],
  ['25年飞天原', '2025年飞天（原箱）'], ['25年飞天原箱', '2025年飞天（原箱）'],
  ['25年飞天散', '2025年飞天（散瓶）'], ['25年飞天散瓶', '2025年飞天（散瓶）'],
  ['公斤茅台原', '公斤茅台（原箱）'], ['43度飞天原', '43度飞天（原箱）'],
  ['精品', '精品茅台'], ['十五年', '十五年茅台'], ['三十年', '三十年茅台'], ['五十年', '五十年茅台']
]);
const specKey = text => key(text).toLowerCase().replace('毫升', 'ml').replace('升', 'l');

export function findProduct(name, spec) {
  const productKey = key(name);
  const canonical = names.get(productKey) || productKey;
  const candidates = PRODUCTS.filter(product => key(product.name) === key(canonical));
  const exact = candidates.find(product => specKey(product.spec) === specKey(spec));
  if (exact) return PRODUCTS.indexOf(exact);
  // 规格可见却冲突时不套用模板。缺规格时仅接受品名唯一的酒款。
  if (!specKey(spec) && candidates.length === 1) return PRODUCTS.indexOf(candidates[0]);
  return -1;
}

function readPrice(words) {
  // 阈值从 72 放宽到 60：手机截图分辨率较低时置信度普遍偏低，数字格式仍会被校验。
  if (!words.length || words.some(word => word.conf < 60)) return '';
  // 去掉涨跌箭头等装饰符号（如「1680 ↑」），只保留数字、逗号和小数点。
  const raw = normalize(words.map(word => word.text).join('')).replace(/[^\d.,]/g, '');
  if (/^\d{1,7}(?:\.\d{1,2})?$/.test(raw)) return raw;
  return /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(raw) ? raw.replace(/,/g, '') : '';
}

export function readRows(tsv, columns) {
  if (!columns) return { rows: [], unclear: [] };
  const lines = new Map();
  for (const record of tsv.split('\n').slice(1)) {
    const cells = record.split('\t');
    if (cells[0] !== '5' || cells.length < 12) continue;
    const text = cells[11].trim();
    if (!text || /^[|｜¦]$/.test(text)) continue;
    const rowId = cells.slice(1, 5).join('/');
    const x = Number(cells[6]) + Number(cells[8]) / 2;
    const column = columns.filter(edge => x > edge).length;
    if (!lines.has(rowId)) lines.set(rowId, [[], [], [], []]);
    lines.get(rowId)[column].push({
      text, conf: Number(cells[10]), left: Number(cells[6]),
      top: Number(cells[7]), height: Number(cells[9])
    });
  }
  const rows = [];
  const unclear = [];
  for (const [names, specs, yesterday, today] of lines.values()) {
    const name = names.map(word => word.text).join('');
    const spec = specs.map(word => word.text).join('');
    const prices = { yesterday: readPrice(yesterday), today: readPrice(today) };
    const index = findProduct(name, spec);
    if (index >= 0) {
      rows.push({ index, ...prices });
    } else if (names.length && (prices.yesterday || prices.today) &&
        PRODUCTS.some(product => specKey(product.spec) === specKey(spec))) {
      const left = Math.min(...names.map(word => word.left));
      const top = Math.min(...names.map(word => word.top));
      const bottom = Math.max(...names.map(word => word.top + word.height));
      unclear.push({ spec, prices, left, top, bottom });
    }
  }
  return { rows, unclear };
}

function metadata(text) {
  const compact = normalize(text.replace(/\n/g, '|'));
  const dates = [...compact.matchAll(/(20\d{2})年(\d{1,2})月(\d{1,2})[日曰]/g)]
    .map(([, y, m, d]) => [y, m.padStart(2, '0'), d.padStart(2, '0')].join('-'))
    .filter(validDate);
  const sources = [...compact.matchAll(/(?:公众号|来源)[:：]([^()|，,。\[\]]{2,35})/g)].map(match => match[1]);
  return { dates, sources };
}

export function assembleOcr(images) {
  const draft = blankDraft();
  const dates = new Set();
  const sources = new Set();
  const conflicts = new Set();
  for (const image of images) {
    if (image.issue) draft.issues.push(image.issue);
    const meta = metadata(image.text || '');
    meta.dates.forEach(date => dates.add(date));
    meta.sources.forEach(source => sources.add(source));
    for (const row of image.rows || []) {
      const prices = draft.prices[row.index];
      for (const field of PRICE_KEYS) {
        const id = row.index + '/' + field;
        if (!row[field] || conflicts.has(id)) continue;
        if (prices[field] && Number(prices[field]) !== Number(row[field])) {
          prices[field] = '';
          conflicts.add(id);
          draft.issues.push(PRODUCTS[row.index].name + (field === 'today' ? ' 今日' : ' 昨日') + '识别结果冲突，已留空。');
        } else {
          prices[field] = row[field];
        }
      }
    }
  }
  if (dates.size === 1) draft.date = dates.values().next().value;
  else draft.issues.push(dates.size ? '截图日期不一致，请核实并填写。' : '没有识别出行情日期，请按原图填写。');
  if (sources.size === 1) draft.source = sources.values().next().value;
  else draft.issues.push(sources.size ? '截图来源不一致，请核实并填写。' : '没有识别出数据来源，请按原图填写。');
  return draft;
}
