// 品牌信息：城市、品牌名、印章字、电话、微信号、二维码。
// 这些值只保存在本浏览器，不进入行情草稿，清空数据时也不会被清除。
export const DEFAULT_BRAND = Object.freeze({
  city: '上海',
  seal: '沪',
  name: '',
  phone: '13900918519',
  wechat: '',
  qr: ''
});

const KEY = 'sh-wine-draft-brand-v1';
const LIMITS = { city: 8, seal: 2, name: 14, phone: 20, wechat: 24 };

const clean = (value, limit) =>
  (typeof value === 'string' ? value : '').replace(/[\r\n\t]/g, ' ').trim().slice(0, limit);

// 品牌展示名：填了就用填的，没填就用「城市 + 名酒」。
export function brandName(brand = DEFAULT_BRAND) {
  const name = clean(brand?.name, LIMITS.name);
  if (name) return name;
  return clean(brand?.city, LIMITS.city) + '名酒' || DEFAULT_BRAND.city + '名酒';
}

export function cityOf(brand = DEFAULT_BRAND) {
  return clean(brand?.city, LIMITS.city) || DEFAULT_BRAND.city;
}

export function sealOf(brand = DEFAULT_BRAND) {
  return clean(brand?.seal, LIMITS.seal) || DEFAULT_BRAND.seal;
}

export function phoneOf(brand = DEFAULT_BRAND) {
  return clean(brand?.phone, LIMITS.phone) || DEFAULT_BRAND.phone;
}

// 空字符串表示「微信同号」。
export function wechatOf(brand = DEFAULT_BRAND) {
  return clean(brand?.wechat, LIMITS.wechat);
}

// 只有 data:image/... 才接受，避免把任意字符串塞进 img.src。
export function qrOf(brand = DEFAULT_BRAND) {
  const value = typeof brand?.qr === 'string' ? brand.qr : '';
  return /^data:image\/(png|jpeg|webp|gif);base64,/i.test(value) ? value : '';
}

export function normalizeBrand(input) {
  return {
    city: cityOf(input),
    seal: sealOf(input),
    name: clean(input?.name, LIMITS.name),
    phone: phoneOf(input),
    wechat: wechatOf(input),
    qr: qrOf(input)
  };
}

export function isDefaultBrand(brand) {
  const next = normalizeBrand(brand);
  return Object.keys(DEFAULT_BRAND).every(key => next[key] === DEFAULT_BRAND[key]);
}

export function loadBrand() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_BRAND };
    return normalizeBrand(saved);
  } catch {
    return { ...DEFAULT_BRAND };
  }
}

export function saveBrand(brand) {
  const next = normalizeBrand(brand);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    return { ok: true, brand: next };
  } catch {
    // 二维码图片过大时浏览器会拒绝写入，此时仍让本次修改生效。
    return { ok: false, brand: next };
  }
}

export function clearBrand() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 忽略禁用存储的浏览器。
  }
  return { ...DEFAULT_BRAND };
}

export { LIMITS as BRAND_LIMITS };
