import { DEFAULT_BRAND, brandName, cityOf, phoneOf, wechatOf } from './brand.js';

export const CONTACT = '13900918519';
export const TEST_LABEL = '测试参考，非实时行情';
export const DISCLAIMER = '以上价格为名酒市场行情参考，仅供了解市场价格变化，不代表实际回收报价。具体回收价格根据酒品年份、规格、原箱或散瓶、外观品相、保存情况及实物查验结果综合确定。行情数据日期及来源以当日标注为准。';
export const QUOTE_RULE = '昨日、今日两列均按对应原价每项减 10 元。';

export function introText(brand = DEFAULT_BRAND) {
  return '每日更新茅台、五粮液、剑南春等名酒行情。' + cityOf(brand) +
    '地区提供名酒、洋酒、红酒回收咨询，支持发送酒品照片初步估价。';
}

export function quoteDisclaimerText(brand = DEFAULT_BRAND, options = {}) {
  const formal = Boolean(options.formal);
  const head = '以上为' + brandName(brand) + '回收参考报价，';
  const tail = '实际回收价格根据酒品年份、规格、包装、品相、保存情况及实物查验结果综合确定。';
  // 正式稿不写"减 10 元"的算法，也不写内部待核实流程。
  return formal ? head + tail : head + QUOTE_RULE + '缺值或原价低于 10 元的项目留空待核实。' + tail;
}

export function aboutText(brand = DEFAULT_BRAND) {
  const city = cityOf(brand);
  return '我们立足' + city + '本地市场，主要提供茅台、五粮液、剑南春、国窖1573等知名白酒，以及各类年份老酒、洋酒、红酒的回收服务。支持线上咨询、酒品照片初步估价及' +
    city + '全市预约免费上门回收。根据酒品年份、规格、品相及保存情况综合评估，致力于为客户提供专业、便捷、透明的名酒回收服务。';
}

// 兼容旧引用：使用默认品牌时的文案。
export const INTRO = introText();
export const QUOTE_DISCLAIMER = quoteDisclaimerText();
export const ABOUT = aboutText();
export const GROUPS = [
  ['maotai_liutong', '贵州茅台｜核心流通行情', [
    ['2026年飞天（原箱）', '53度/500ml'], ['2026年飞天（散瓶）', '53度/500ml'],
    ['2025年飞天（原箱）', '53度/500ml'], ['2025年飞天（散瓶）', '53度/500ml'],
    ['公斤茅台（原箱）', '53度/1L'], ['43度飞天（原箱）', '43度/500ml']
  ]],
  ['maotai_shoucang', '贵州茅台｜高年份收藏行情', [
    ['精品茅台', '53度/500ml'], ['十五年茅台', '53度/500ml'],
    ['三十年茅台', '53度/500ml'], ['五十年茅台', '53度/500ml']
  ]],
  ['wuliangye', '五粮液行情', [
    ['普五（八代）', '52度/500ml'], ['普五（八代）', '52度/5L'], ['五粮液', '39度/500ml']
  ]],
  ['jiannanchun', '剑南春行情', [
    ['水晶剑', '52度/500ml'], ['珍藏级', '52度/500ml']
  ]]
];
export const PRODUCTS = GROUPS.flatMap(([group, section, items]) =>
  items.map(([name, spec]) => ({ group, section, name, spec }))
);
export const PRICE_KEYS = ['yesterday', 'today'];
export const TREND_COLOR = { up: '#AA292D', down: '#167048', flat: '#353034', unknown: '#6C6260' };

export function blankDraft() {
  return { date: '', source: '', locked: false, hideWatermark: false,
    prices: PRODUCTS.map(() => ({ yesterday: '', today: '' })), issues: [] };
}

export function screenshotPrompt(brand = DEFAULT_BRAND) {
  const template = { date: '', source: '', is_test: false,
    products: PRODUCTS.map(product => ({ ...product, yesterday: null, today: null })) };
  return [
    '请把我发的行情截图整理成' + brandName(brand) + '行情制稿台可导入的 JSON，只回复一个 JSON 对象。',
    '逐行核对年份、原箱或散瓶、容量及昨日/今日列，照抄原价。读不清的价格填 null，保留全部 15 行。',
    'date 填截图标注的 YYYY-MM-DD，source 填实际来源；同一批截图日期有冲突或日期、来源无法确认时，对应字段留空，交给我核对。',
    '当期制稿使用 is_test: false。历史样例、模拟数据或明确仅供测试的资料使用 is_test: true。',
    JSON.stringify(template, null, 2)
  ].join('\n');
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function chineseDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return { short: month + '月' + day + '日', full: year + '年' + month + '月' + day + '日' };
}

export function priceValue(raw) {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const value = String(raw).trim();
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const price = Number(value);
  return Number.isFinite(price) && price <= Number.MAX_SAFE_INTEGER ? price : null;
}

export function trend(row) {
  const yesterday = priceValue(row.yesterday);
  const today = priceValue(row.today);
  if (yesterday === null || today === null) return 'unknown';
  if (today > yesterday) return 'up';
  if (today < yesterday) return 'down';
  return 'flat';
}

const normalize = value => typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, '').toLowerCase() : '';
const packOf = name => normalize(name).match(/\((原箱|散瓶)\)$/)?.[1];

export function importDraft(text) {
  let input;
  try {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
    input = JSON.parse(fenced ? fenced[1] : trimmed);
  } catch {
    throw new Error('JSON 格式有误，请粘贴完整对象，检查引号和逗号。');
  }
  if (!Array.isArray(input?.products)) throw new Error('请提供包含 products 数组的 JSON 对象。');
  const draft = blankDraft();
  draft.date = validDate(input.date) ? input.date : '';
  draft.source = typeof input.source === 'string' ? input.source.trim() : '';
  draft.locked = input.is_test === true;
  const seen = new Set();
  for (const [line, row] of input.products.entries()) {
    const index = PRODUCTS.findIndex(product => ['group', 'name', 'spec'].every(
      key => normalize(product[key]) === normalize(row?.[key])));
    const product = PRODUCTS[index];
    const packaging = row?.packaging ?? row?.pack;
    if (!product) {
      draft.issues.push('第 ' + (line + 1) + ' 条酒款、分组或规格无法匹配，待核实。');
      continue;
    }
    if (seen.has(index)) {
      draft.prices[index] = { yesterday: '', today: '' };
      draft.issues.push(product.name + '（' + product.spec + '）重复，待核实。');
      continue;
    }
    seen.add(index);
    if ((row.section != null && normalize(row.section) !== normalize(product.section)) ||
        (packaging != null && normalize(packaging) !== packOf(product.name))) {
      draft.issues.push(product.name + ' 的分组或原箱/散瓶标注冲突，待核实。');
      continue;
    }
    for (const key of PRICE_KEYS) {
      const raw = row[key];
      if (priceValue(raw) !== null) draft.prices[index][key] = String(raw).trim();
      else if (raw != null && String(raw).trim() !== '') {
        draft.issues.push(product.name + '的' + (key === 'today' ? '今日' : '昨日') + '价格无效，待核实。');
      }
    }
  }
  return draft;
}

export function pendingCount(draft) {
  return draft.prices.filter(row => trend(row) === 'unknown').length;
}

export function outputDraft(draft, quote) {
  if (!quote) return draft;
  const calculate = raw => {
    if (priceValue(raw) === null) return '';
    const [whole, fraction] = String(raw).trim().split('.');
    if (Number(whole) < 10) return '';
    return String(Number(whole) - 10) + (fraction === undefined ? '' : '.' + fraction);
  };
  return { ...draft, quote: true, prices: draft.prices.map(row => ({
    yesterday: calculate(row.yesterday), today: calculate(row.today)
  })) };
}

export function article(draft, brand = DEFAULT_BRAND) {
  const date = chineseDate(draft.date);
  const test = !draft.hideWatermark;
  const format = draft.quote ? '回收参考报价' : '行情参考';
  // 只统计有今日报价的酒款，标题与正文跟实际图片一致（来自 v11）。
  const priced = draft.prices
    .map((row, index) => ({ row, product: PRODUCTS[index] }))
    .filter(({ row }) => priceValue(row.today) !== null);
  if (!priced.length) return { title: '', body: '' };
  const brands = [...new Set(priced.map(({ product }) =>
    product.section.split('｜')[0].replace(/行情$/, '').replace('贵州茅台', '茅台')))].join('、');
  // 正式稿的正文不写价格换算规则，避免对外暴露加价方式。
  const qualifier = (test ? '本图为' + TEST_LABEL + '。' : '') +
    (draft.quote ? (test ? QUOTE_RULE : '') : '市场行情仅供参考。');
  const wechat = wechatOf(brand);
  return {
    title: date.short + brandName(brand) + format + '｜' + brands,
    body: '本期汇总' + brands + '共' + priced.length + '款名酒的' + format + '。' +
      qualifier + cityOf(brand) + '地区提供名酒、洋酒、红酒回收咨询，可发送酒品照片初步估价，支持预约免费上门和专业鉴定。' +
      '实际报价结合年份、规格、品相和保存情况综合评估。联系电话 ' + phoneOf(brand) + '，' +
      (wechat ? '微信 ' + wechat : '微信同号') + '。'
  };
}

export function imageName(draft, kind, brand = DEFAULT_BRAND) {
  const subject = draft.quote ? (kind === 'cover' ? '回收报价封面' : '回收参考报价') :
    (kind === 'cover' ? '封面' : '行情');
  return brandName(brand) + subject + '_' + draft.date + (draft.hideWatermark ? '' : '_测试') + '.png';
}
