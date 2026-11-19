import { PRODUCTS, PRICE_KEYS, priceValue, validDate } from './data.js';

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

// 只有模板里存在同名酒款时，才值得为每一块截图额外 OCR 品牌标题（很耗时）。
export function needsBrandLabels() {
  const seen = new Set();
  for (const product of PRODUCTS) {
    if (seen.has(key(product.name))) return true;
    seen.add(key(product.name));
  }
  return false;
}

export function findProduct(name, spec) {
  const productKey = key(name);
  const canonical = names.get(productKey) || productKey;
  const candidates = PRODUCTS.filter(product => key(product.name) === key(canonical));
  const exact = candidates.find(product => specKey(product.spec) === specKey(spec));
  if (exact) return PRODUCTS.indexOf(exact);
  return -1;
}

function namesForReview(name) { return names.get(key(name)) || name; }

// 短名（精品、十五年……）在本模板里是否对应多款酒。唯一则不需要品牌佐证。
function ambiguousName(name) {
  const canonical = namesForReview(name);
  return PRODUCTS.filter(product => key(product.name) === key(canonical)).length > 1;
}

function readPrice(words) {
  // 去掉涨跌箭头等装饰符号，只保留数字、逗号和小数点。
  words = words.filter(word => !/^[↑↓⬆⬇↗↘]+$/.test(word.text));
  // 箭头图标常被读成单个数字（如「3」），按几何特征剔除：近方形、明显比文字高的 token。
  words = words.filter(word => {
    if (!(word.height && word.width)) return true;
    const square = word.width / word.height > 0.65 && word.width / word.height < 1.6;
    return !(square && word.height >= 34 && word.width >= 26);
  });
  if (!words.length || words.some(word => word.conf < 60)) return '';
  const raw = normalize(words.map(word => word.text).join('')).replace(/[^\d.,]/g, '');
  if (/^\d{1,7}(?:\.\d{1,2})?$/.test(raw)) return raw;
  return /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(raw) ? raw.replace(/,/g, '') : '';
}

const BRANDS = { '茅台': 'maotai', '贵州茅台': 'maotai', '五粮液': 'wuliangye', '剑南春': 'jiannanchun' };

function brandGroup(label) {
  return label ? BRANDS[normalize(label)] || '' : '';
}

// 品牌标签读不出来时不据此否决；读出来但和酒款分组冲突才丢弃（说明这一行认错了）。
export function brandMatches(index, label) {
  const group = brandGroup(label);
  if (!group) return true;
  return PRODUCTS[index].group.startsWith(group);
}

// 同一天同一款酒的涨跌幅不可能很大；差异过大说明数字被误读（如箭头被读成 3）。
function implausible(a, b) {
  if (priceValue(a) === null || priceValue(b) === null) return false;
  const hi = Math.max(Number(a), Number(b));
  const lo = Math.min(Number(a), Number(b));
  return hi - lo > Math.max(500, hi * 0.5);
}

// 箭头被读成尾部数字时（如 2260 → 22603），去掉末位往往能恢复合理值。
function trimCandidates(value, other) {
  const out = [];
  const text = String(value);
  for (let cut = 1; cut <= 2; cut++) {
    const trimmed = text.slice(0, -cut);
    if (/^\d{1,7}(?:\.\d{1,2})?$/.test(trimmed) && !implausible(trimmed, other)) out.push(trimmed);
  }
  return out;
}

export function matchedRow(index, label, name, prices) {
  if (index < 0 || !brandMatches(index, label)) return null;
  const checkBrand = !label && ambiguousName(name);
  return { index, ...prices, checkBrand };
}

export function readRows(tsv, columns, brands = []) {
  if (!columns) return { rows: [], unclear: [], missing: [] };
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
      top: Number(cells[7]), width: Number(cells[8]), height: Number(cells[9])
    });
  }
  const rows = [];
  const unclear = [];
  const missing = [];
  for (const [nameWords, specWords, yesterday, today] of lines.values()) {
    const brand = brands.filter(item => item.end <= (nameWords[0]?.top ?? -1)).pop()?.label;
    const name = nameWords.map(word => word.text).join('');
    const spec = specWords.map(word => word.text).join('');
    const prices = { yesterday: readPrice(yesterday), today: readPrice(today) };
    const index = findProduct(name, spec);
    const named = PRODUCTS.filter(product => key(product.name) === key(namesForReview(name)));
    if (index >= 0) {
      const row = matchedRow(index, brand, name, prices);
      if (row) {
        if (implausible(prices.yesterday, prices.today)) row.suspicious = true;
        rows.push(row);
        // 记下缺价的格子，供后续定向补识别（数字白名单）。
        const allWords = [...nameWords, ...specWords, ...yesterday, ...today];
        if (allWords.length) {
          const top = Math.min(...allWords.map(word => word.top));
          const bottom = Math.max(...allWords.map(word => word.top + word.height));
          for (const field of PRICE_KEYS) {
            if (!prices[field]) missing.push({ index, field, top, bottom });
          }
        }
      }
    } else if (named.length) {
      for (const product of named) {
        const candidate = PRODUCTS.indexOf(product);
        if (brandMatches(candidate, brand)) rows.push({ index: candidate, checkSpec: true });
      }
    } else if ((prices.yesterday || prices.today) &&
        PRODUCTS.some(product => specKey(product.spec) === specKey(spec))) {
      // 只要名字没匹配上就安排一次定向重试：OCR 可能"很自信地读错"，不能只看置信度。
      const left = Math.min(...nameWords.map(word => word.left));
      const top = Math.min(...nameWords.map(word => word.top));
      const bottom = Math.max(...nameWords.map(word => word.top + word.height));
      unclear.push({ spec, prices, left, top, bottom, brand });
    }
  }
  return { rows, unclear, missing };
}

function metadata(text) {
  const compact = normalize(text.replace(/\n/g, '|'));
  const dates = [...compact.matchAll(/(20\d{2})年(\d{1,2})月(\d{1,2})[日曰]/g)]
    .map(([, y, m, d]) => [y, m.padStart(2, '0'), d.padStart(2, '0')].join('-'))
    .filter(validDate);
  const sources = [...compact.matchAll(/(?:公众号|来源)[:：]([^()|，,。\[\]]{2,35})/g)].map(match => match[1]);
  return { dates, sources };
}

// 没有日期栏的截图，可以用"与其他有日期截图重复的报价"推断它属于同一批。
function unlinkedPhotos(images, dated) {
  const keys = images.map(image => new Set((image.rows || [])
    .filter(row => !row.checkSpec && row.yesterday && row.today)
    .map(row => [row.index, row.yesterday, row.today].join('/'))));
  const linked = new Set(dated);
  for (let pass = 0; pass < images.length; pass++) {
    const prior = linked.size;
    keys.forEach((rows, i) => {
      if (!linked.has(i) && [...linked].some(j => [...rows].some(row => keys[j].has(row)))) linked.add(i);
    });
    if (linked.size === prior) break;
  }
  return images.flatMap((image, i) => image.rows?.length && !linked.has(i) ? [i + 1] : []);
}

export function assembleOcr(images) {
  const dates = new Set();
  const sources = new Set();
  const issues = [];
  const dated = [];
  const matches = PRODUCTS.map(() => []);
  images.forEach((image, n) => {
    if (image.issue) issues.push(image.issue);
    if (image.warning) issues.push(image.warning);
    const meta = metadata(image.text || '');
    if (meta.dates.length) dated.push(n);
    meta.dates.forEach(date => dates.add(date));
    meta.sources.forEach(source => sources.add(source));
    for (const row of image.rows || []) matches[row.index].push({ ...row, photo: n + 1 });
  });
  const date = dates.size === 1 ? [...dates][0] : '';
  const source = sources.size === 1 ? [...sources][0] : '';
  if (!date) issues.push(dates.size ? '截图日期不一致，请分批导入。' : '请对照原图填写本批行情日期。');
  if (!source) issues.push('请对照原图填写本批来源。');
  return { matches, date, source, issues, mixedDates: dates.size > 1,
    confirmPhotos: date ? unlinkedPhotos(images, dated) : [] };
}

// 把本次识别结果合并进已有草稿：只更新识别到的酒款，冲突或需人工确认的格子标记为待核对。
export function mergeScan(existing, batch) {
  const review = [];
  const prices = existing.prices.map((prior, i) => {
    const row = { ...prior };
    const records = batch.matches[i];
    const checked = {};
    for (const field of PRICE_KEYS) {
      const choices = [...new Set(records.filter(item => !item.checkSpec && item[field]).map(item => item[field]))];
      const verified = records.some(item => !item.checkSpec && !item.checkBrand && !item.suspicious
        && !implausible(item.yesterday, item.today) && item[field]);
      if (choices.length === 1 && verified) {
        row[field] = choices[0];
      } else if (records.length) {
        const suspect = records.some(item => item.suspicious || implausible(item.yesterday, item.today));
        const photos = [...new Set(records.map(item => item.photo))];
        checked[field] = {
          choices,
          photos,
          reason: choices.length > 1 ? '报价冲突'
            : suspect ? '涨跌幅异常'
            : choices.length ? '品牌待核对'
            : records.every(item => item.checkSpec) ? '规格待核对' : '数字待核对'
        };
      }
      // 本次没有识别到这款酒时保留原值，不打扰用户。
    }
    // 一列没读出来、另一列有值时，有值的那列也要求确认：缺了对照价就无法判断它是否被误读。
    if (records.length) {
      const readFailure = field => {
        const check = checked[field];
        return check && (check.reason === '数字待核对' || check.reason === '规格待核对');
      };
      const photos = [...new Set(records.map(item => item.photo))];
      if (readFailure('yesterday') && priceValue(row.today) !== null && !checked.today) {
        checked.today = { choices: [], photos, reason: '缺少对照价' };
      }
      if (readFailure('today') && priceValue(row.yesterday) !== null && !checked.yesterday) {
        checked.yesterday = { choices: [], photos, reason: '缺少对照价' };
      }
    }
    // 跨记录合并后整体复核：价格分别来自不同识别记录时，单条记录内部无法判断异常。
    if (implausible(row.yesterday, row.today)) {
      for (const field of PRICE_KEYS) {
        if (!row[field]) continue;
        const other = field === 'yesterday' ? row.today : row.yesterday;
        const choices = [...new Set([row[field], ...trimCandidates(row[field], other)])];
        if (!checked[field]) {
          checked[field] = {
            choices,
            photos: [...new Set(records.map(item => item.photo))],
            reason: '涨跌幅异常'
          };
        } else {
          checked[field] = { ...checked[field], choices, reason: '涨跌幅异常' };
        }
      }
    }
    review.push(checked);
    return row;
  });
  return { ...existing, prices, review, date: batch.date, source: batch.source,
    issues: batch.issues, locked: false };
}
