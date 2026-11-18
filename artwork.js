import { DEFAULT_BRAND, brandName, phoneOf, wechatOf } from './brand.js';
import { DISCLAIMER, GROUPS, PRODUCTS, QUOTE_RULE, TEST_LABEL, TREND_COLOR,
  aboutText, chineseDate, introText, priceValue, quoteDisclaimerText, trend } from './data.js';

const WIDTH = 1080;
const LEFT = 54;
const RIGHT = WIDTH - LEFT;
const INK = '#353034';
const MUTED = '#625652';
const WINE = '#8E2028';
const GOLD = '#D9B67A';
const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const SERIF = '"Songti SC", "Noto Serif CJK SC", ' + FONT;

function write(ctx, text, x, y, size, color = INK, options = {}) {
  const { weight = 400, align = 'left', family = FONT, maxWidth } = options;
  ctx.font = weight + ' ' + size + 'px ' + family;
  while (maxWidth && ctx.measureText(text).width > maxWidth && size > 14) {
    size -= 1;
    ctx.font = weight + ' ' + size + 'px ' + family;
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y, maxWidth);
}

function rect(ctx, x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

function frame(ctx, x, y, width, height, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
}

function gradient(ctx, y, height) {
  const fill = ctx.createLinearGradient(0, y, WIDTH, y + height);
  fill.addColorStop(0, '#561821');
  fill.addColorStop(1, WINE);
  return fill;
}

function lines(ctx, text, size, width) {
  ctx.font = '400 ' + size + 'px ' + FONT;
  const result = [];
  const tokens = text.match(/[a-zA-Z0-9]{1,18}|[^\r\n]/gu) || [];
  let line = '';
  let previous = '';
  for (const token of tokens) {
    if (line && ctx.measureText(line + token).width > width) {
      const carry = /^[，。；：、！？）】》]/u.test(token) || /^[（【《]/u.test(previous);
      if (carry && line.length > previous.length) {
        result.push(line.slice(0, -previous.length).trimEnd());
        line = previous;
      } else {
        result.push(line.trimEnd());
        line = '';
      }
    }
    if (line || token.trim()) line += token;
    previous = token;
  }
  if (line) result.push(line.trimEnd());
  return result;
}

function paragraph(ctx, rows, x, y, size, step, color = MUTED) {
  rows.forEach((line, index) => write(ctx, line, x, y + index * step, size, color));
}

function watermark(ctx, x, y, small = false) {
  const width = small ? 140 : 120;
  frame(ctx, x - width / 2, y - 22, width, 44, GOLD);
  write(ctx, 'TEST', x, y + 1, 25, '#FCE7BE', { weight: 700, align: 'center' });
}

function shownPrice(raw) {
  return priceValue(raw) === null ? '—' : String(raw).trim();
}

function table(ctx, draft, y) {
  const anchors = [LEFT + 20, 501, 724, 915];
  let index = 0;
  for (const [, section, items] of GROUPS) {
    rect(ctx, LEFT, y + 8, 5, 35, WINE);
    write(ctx, draft.quote ? section.replace(/行情$/, '') : section, LEFT + 23, y + 25, 38, WINE, { weight: 700 });
    y += 62;
    rect(ctx, LEFT, y, RIGHT - LEFT, 59, '#F4E8D4');
    const headings = draft.quote ? ['品名', '规格', '昨日参考价', '今日参考价'] : ['品名', '规格', '昨日行情', '今日行情'];
    headings.forEach((title, i) =>
      write(ctx, title, anchors[i], y + 29, 31, '#67442E', { weight: 600, align: i ? 'center' : 'left' }));
    y += 59;
    for (let n = 0; n < items.length; n++, index++) {
      const product = PRODUCTS[index];
      const row = draft.prices[index];
      if (n % 2 === 1) rect(ctx, LEFT, y, RIGHT - LEFT, 72, '#FCFAF7');
      write(ctx, product.name, anchors[0], y + 36, 34, INK, { maxWidth: 320 });
      write(ctx, product.spec, anchors[1], y + 36, 31, INK, { align: 'center' });
      write(ctx, shownPrice(row.yesterday), anchors[2], y + 36, 36, INK,
        { align: 'center', maxWidth: 172 });
      write(ctx, shownPrice(row.today), anchors[3], y + 36, 36, TREND_COLOR[trend(row)],
        { align: 'center', weight: 700, maxWidth: 172 });
      rect(ctx, LEFT, y + 71, RIGHT - LEFT, 1, '#E7DBD1');
      y += 72;
    }
    y += 38;
  }
  return y;
}

function ad(ctx, y, qrImage, brand) {
  rect(ctx, LEFT, y, RIGHT - LEFT, 382, gradient(ctx, y, 382));
  frame(ctx, LEFT + 16, y + 16, RIGHT - LEFT - 32, 350, '#B98F65');
  const wechat = wechatOf(brand);
  write(ctx, brandName(brand) + '回收', 103, y + 91, 64, '#FFF6E7', { family: SERIF, weight: 700 });
  write(ctx, '茅台 · 五粮液 · 剑南春 · 年份老酒', 105, y + 158, 30, '#F3D4A2');
  write(ctx, '免费上门  ·  专业鉴定', 105, y + 214, 29, '#FFF6E7');
  write(ctx, '联系电话  ' + phoneOf(brand), 105, y + 274, 35, '#FFF6E7', { weight: 600 });
  write(ctx, wechat ? '微信  ' + wechat : '微信同号', 105, y + 322, 27, '#F3D4A2');
  rect(ctx, 713, y + 49, 258, 258, '#FFFFFF');
  if (qrImage) ctx.drawImage(qrImage, 713, y + 49, 258, 258);
  write(ctx, qrImage ? '微信扫码咨询' : '二维码待补充', 842, y + 337, 25, '#F6DEB9', { align: 'center' });
}

export function makeLong(draft, qrImage, brand = DEFAULT_BRAND) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const intro = lines(ctx, introText(brand), 34, RIGHT - LEFT);
  const source = lines(ctx, (draft.quote ? '原始行情来源｜' : '来源｜') + draft.source, 25, RIGHT - LEFT);
  const disclaimer = lines(ctx, draft.quote ? quoteDisclaimerText(brand) : DISCLAIMER, 32, RIGHT - LEFT);
  const about = lines(ctx, aboutText(brand), 32, RIGHT - LEFT);
  const beforeTable = 350 + intro.length * 53 + source.length * 43;
  const afterTable = beforeTable + GROUPS.length * (62 + 59 + 38) + PRODUCTS.length * 72;
  const adY = afterTable + 194 + (disclaimer.length + about.length) * 50;
  c.width = WIDTH;
  c.height = adY + 435;

  rect(ctx, 0, 0, WIDTH, c.height, '#FFFFFF');
  rect(ctx, 0, 0, WIDTH, 284, gradient(ctx, 0, 284));
  rect(ctx, LEFT, 41, 95, 3, GOLD);
  write(ctx, chineseDate(draft.date).full, LEFT, 83, 36, '#F3D4A2', { weight: 600 });
  const headline = draft.quote ? brandName(brand) + '回收参考报价' : brandName(brand) + '行情参考';
  write(ctx, headline, LEFT - 3, 167, 83, '#FFF7E9', { family: SERIF, weight: 700 });
  const subtitle = draft.hideWatermark ? (draft.quote ? QUOTE_RULE : '市场行情参考') : TEST_LABEL;
  write(ctx, subtitle, LEFT, 239, 33, '#F4D6AC');
  if (!draft.hideWatermark) watermark(ctx, RIGHT - 60, 81);
  paragraph(ctx, intro, LEFT, 330, 34, 53);
  paragraph(ctx, source, LEFT, 342 + intro.length * 53, 25, 43);
  const y = table(ctx, draft, beforeTable);
  write(ctx, '— 待核实 · 单位：元', LEFT, y + 3, 27, MUTED);
  const noteY = y + 62;
  write(ctx, '价格说明', LEFT, noteY, 38, WINE, { weight: 700 });
  paragraph(ctx, disclaimer, LEFT, noteY + 54, 32, 50);
  const aboutY = noteY + 66 + disclaimer.length * 50;
  write(ctx, '关于我们', LEFT, aboutY, 38, WINE, { weight: 700 });
  paragraph(ctx, about, LEFT, aboutY + 54, 32, 50);
  ad(ctx, adY, qrImage, brand);
  return c;
}

export function makeCover(draft, brand = DEFAULT_BRAND) {
  const c = document.createElement('canvas');
  c.width = WIDTH;
  c.height = 480;
  const ctx = c.getContext('2d');
  const center = { align: 'center' };
  rect(ctx, 0, 0, WIDTH, 480, gradient(ctx, 0, 480));
  frame(ctx, 32, 32, 1016, 416, '#B98F65');
  frame(ctx, 45, 45, 990, 390, '#8C4E4A');
  for (const x of [110, 970]) {
    ctx.save();
    ctx.translate(x, 240);
    ctx.rotate(Math.PI / 4);
    frame(ctx, -24, -24, 48, 48, GOLD);
    frame(ctx, -15, -15, 30, 30, '#AF7164');
    ctx.restore();
  }
  write(ctx, chineseDate(draft.date).full, 540, 106, 32, '#F4D6AC', center);
  write(ctx, draft.quote ? '名酒回收参考' : brandName(brand) + '行情', 540, 187, 66, '#FFF6E7',
    { ...center, family: SERIF, weight: 700 });
  rect(ctx, 500, 240, 80, 2, GOLD);
  write(ctx, '茅台 · 五粮液 · 剑南春', 540, 283, 30, '#F4D6AC', center);
  if (!draft.hideWatermark) {
    write(ctx, TEST_LABEL, 540, 332, 26, '#FFF1D2', center);
    watermark(ctx, 540, 389, true);
  } else {
    write(ctx, draft.quote ? brandName(brand) + '回收参考报价' : '市场行情参考', 540, 355, 28, '#FFF1D2', center);
  }
  return c;
}
