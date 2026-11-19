import { PRODUCTS, GROUPS, PRICE_KEYS, article, blankDraft, imageName, importDraft,
  outputDraft, pendingCount, priceValue, screenshotPrompt, trend, validDate } from './data.js';
import { makeCover, makeLong } from './artwork.js';
import { mergeScan } from './ocr-parse.js';
import { DEFAULT_BRAND, brandName, clearBrand, loadBrand, normalizeBrand, saveBrand, sealOf } from './brand.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'sh-wine-draft-v1';
const KINDS = ['long', 'cover'];
let draft = blankDraft();
let brand = loadBrand();
let files = {};
let generation = 0;
let timer;
let rendering = false;
let queuedRender = null;
let selected = 'cover';
let contactQr = { key: '', promise: null };
let scanning = false;
let photoUrls = [];

// 保留本次识别的原图，便于对照核对。
function showPhotos(photos) {
  photoUrls.forEach(url => URL.revokeObjectURL(url));
  photoUrls = photos.map(photo => URL.createObjectURL(photo));
  const box = $('scan-refs');
  if (!box) return;
  box.replaceChildren(...photoUrls.map((url, i) => {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = '查看原图 ' + (i + 1);
    return link;
  }));
}

function loadContactQr() {
  // 二维码可替换：填了就用自定义图片，否则用内置 contact-qr.png。
  const key = brand.qr || new URL('./contact-qr.png', import.meta.url).href;
  if (contactQr.key !== key) {
    const image = new Image();
    image.src = key;
    contactQr = { key, promise: image.decode().then(() => image, () => null) };
  }
  return contactQr.promise;
}

// 二维码先缩到合适尺寸再保存：手机照片动辄 3-5 MB，直接存会把 localStorage 撑爆。
async function compressQr(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    let dataUrl = '';
    for (const limit of [768, 512, 384]) {
      const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL('image/png');
      canvas.width = canvas.height = 1;
      if (dataUrl.length <= 400000) break; // 约 300 KB
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.prices) || saved.prices.length !== PRODUCTS.length) return;
    draft = { ...blankDraft(), ...saved, hideWatermark: false };
    $('output-kind').value = draft.locked ? 'market' : 'quote';
    $('remember').checked = true;
  } catch {
    // 浏览器禁用存储时仍可使用本页的其他功能。
  }
}

function persist() {
  try {
    if ($('remember').checked) {
      // 刷新后重新确认数据使用权，避免沿用上次的发布确认。
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...draft, hideWatermark: false }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    if ($('remember').checked) {
      $('remember').checked = false;
      $('import-status').textContent = '当前浏览器无法保存草稿，本页仍可使用。';
    }
  }
}

function makePriceTable() {
  let index = 0;
  for (const [, section, items] of GROUPS) {
    const group = document.createElement('section');
    group.className = 'price-group';
    const heading = document.createElement('h3');
    heading.textContent = section;
    const table = document.createElement('table');
    table.setAttribute('aria-label', section);
    table.innerHTML = '<colgroup><col><col><col><col></colgroup><thead><tr>' +
      '<th scope="col">品名</th><th scope="col">规格</th><th scope="col">昨日行情</th><th scope="col">今日行情</th></tr></thead><tbody></tbody>';
    const tbody = table.tBodies[0];
    for (const [name, spec] of items) {
      const rowIndex = index++;
      const row = tbody.insertRow();
      row.insertCell().textContent = name;
      row.insertCell().textContent = spec;
      for (const key of PRICE_KEYS) {
        const field = document.createElement('input');
        field.type = 'text';
        field.inputMode = 'decimal';
        field.placeholder = '—';
        field.maxLength = 24;
        field.id = key + '-' + rowIndex;
        field.dataset.price = key;
        field.setAttribute('aria-label', name + ' ' + spec + (key === 'today' ? ' 今日行情' : ' 昨日行情'));
        field.addEventListener('input', () => {
          draft.prices[rowIndex][key] = field.value;
          if (draft.review?.[rowIndex]) delete draft.review[rowIndex][key];
          dataChanged();
          refreshRow(rowIndex);
        });
        const review = document.createElement('div');
        review.id = 'review-' + key + '-' + rowIndex;
        review.className = 'review';
        row.insertCell().append(field, review);
      }
    }
    group.append(heading, table);
    $('prices').append(group);
  }
}

function refreshRow(index) {
  const row = draft.prices[index];
  for (const key of PRICE_KEYS) {
    const field = $(key + '-' + index);
    field.value = row[key];
    const check = draft.review?.[index]?.[key];
    field.dataset.review = String(Boolean(check));
    const panel = $('review-' + key + '-' + index);
    panel.replaceChildren();
    if (check) {
      const note = document.createElement('span');
      note.className = 'review-note';
      note.textContent = check.reason + (photoUrls.length && check.photos?.length ? ' · 图' + check.photos.join('、') : '');
      panel.append(note);
      const values = check.choices?.length ? check.choices : (priceValue(row[key]) !== null ? [row[key]] : []);
      for (const value of values) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'review-option';
        button.textContent = check.choices?.length ? '选 ' + value : '确认原价';
        button.addEventListener('click', () => {
          field.value = value;
          field.dispatchEvent(new Event('input'));
        });
        panel.append(button);
      }
    }
    field.setAttribute('aria-invalid', String(row[key].trim() !== '' && priceValue(row[key]) === null));
  }
  $('today-' + index).dataset.trend = trend(row);
}

function fillEditor() {
  $('date').value = draft.date;
  $('source').value = draft.source;
  PRODUCTS.forEach((_, index) => refreshRow(index));
  $('issues').hidden = !draft.issues.length;
  $('issues').open = Boolean(draft.issues.length);
  $('issue-list').replaceChildren(...draft.issues.map(issue => {
    const li = document.createElement('li');
    li.textContent = issue;
    return li;
  }));
}

function hasDraftContent() {
  return Boolean(draft.date || draft.source || draft.prices.some(row =>
    String(row.yesterday || '').trim() || String(row.today || '').trim()));
}

function previewProblem() {
  if (!validDate(draft.date) || !draft.source.trim()) return '填写有效的日期和来源后即可生成';
  return Array.from(draft.source).length > 240 ? '请将来源缩短到 240 字以内' : '';
}

function canConfirmFormal() {
  return !draft.locked && !previewProblem() &&
    currentOutput().prices.some(row => priceValue(row.today) !== null);
}

function currentOutput() {
  const prices = draft.prices.map((row, i) => ({
    yesterday: draft.review?.[i]?.yesterday ? '' : row.yesterday,
    today: draft.review?.[i]?.today ? '' : row.today
  }));
  return outputDraft({ ...draft, prices }, $('output-kind').value === 'quote');
}

function reviewCount() {
  return (draft.review || []).filter(check => Object.keys(check || {}).length).length;
}

function refreshText() {
  const count = pendingCount(draft);
  const reviewing = reviewCount();
  $('count').textContent = reviewing ? reviewing + ' 款待核对' : (count ? count + ' 款待核实' : '15 款已录入');
  const formal = draft.hideWatermark;
  const ready = canConfirmFormal();
  const exported = currentOutput();
  $('mode').textContent = formal ? '正式稿' : draft.locked ? '历史测试' : '制稿草稿';
  $('mode').dataset.formal = String(formal);
  $('edition').dataset.formal = String(formal);
  $('edition').hidden = Boolean(previewProblem());
  $('rights').disabled = !ready;
  $('rights-label').hidden = draft.locked;
  $('formal').hidden = draft.locked;
  $('formal').disabled = !ready || !$('rights').checked;
  $('formal').textContent = formal ? '返回测试稿' : '生成正式稿';
  $('quote-note').textContent = exported.quote ? '录入表保留原价。长图的昨日和今日参考价分别减 10 元。' :
    '长图按录入表的市场原价展示。';
  const status = formal ? '正式稿。保存图片和文案后，可在公众号手动发布。' :
    draft.locked ? '历史测试样例，导出带 TEST 水印。' :
    ready ? '草稿导出带 TEST 水印。核对并确认后可生成正式稿。' :
    '录入已核实的今日行情后可生成正式稿。';
  const pending = pendingCount(exported);
  $('edition-status').textContent = status + (ready && pending ? ' ' + pending + ' 款有待核实项，缺值显示「—」。' : '');

  const sourceLength = Array.from(draft.source).length;
  const sourceTooLong = sourceLength > 240;
  $('source-hint').hidden = !sourceTooLong;
  if (sourceTooLong) {
    $('source-hint').textContent = '来源请控制在 240 字以内（当前 ' + sourceLength + ' 字），否则无法生成图片。';
  }
  $('source').setAttribute('aria-invalid', String(sourceTooLong));

  const hasDate = validDate(draft.date);
  const text = hasDate ? article(exported, brand) : { title: '', body: '' };
  $('article-title').value = text.title;
  $('article-body').value = text.body;
  // 没有可用文案时禁用复制，避免复制出空内容。
  $('copy-title').disabled = !text.title;
  $('copy-body').disabled = !text.body;
  $('copy-status').textContent = '';
}

function dataChanged() {
  $('rights').checked = false;
  draft.hideWatermark = false;
  update();
}

function update() {
  refreshText();
  persist();
  requestImages();
}

function replaceDraft(next, message) {
  draft = next;
  $('output-kind').value = draft.locked ? 'market' : 'quote';
  $('import-status').textContent = message;
  fillEditor();
  dataChanged();
}

function selectImage(kind) {
  selected = kind;
  for (const item of KINDS) {
    $('show-' + item).setAttribute('aria-pressed', String(kind === item));
  }
  const asset = files[kind];
  const img = $('preview-image');
  img.hidden = !asset;
  $('placeholder').hidden = Boolean(asset);
  $('dimensions').hidden = !asset;
  if (!asset) {
    img.removeAttribute('src');
    return;
  }
  img.src = asset.url;
  img.alt = kind === 'long' ? '行情长图预览' : '公众号封面预览';
  $('open-image').href = asset.url;
  $('dimensions').textContent = asset.width + ' × ' + asset.height + ' 像素';
  img.parentElement.scrollTop = 0;
}

function requestImages() {
  const version = ++generation;
  clearTimeout(timer);
  queuedRender = null;
  Object.values(files).forEach(asset => URL.revokeObjectURL(asset.url));
  files = {};
  $('share-status').textContent = '';
  $('qr-status').hidden = true;
  $('download-links').hidden = true;
  for (const kind of KINDS) {
    $('share-' + kind).disabled = true;
    $('download-' + kind).removeAttribute('href');
  }
  $('open-image').removeAttribute('href');
  selectImage(selected);

  const problem = previewProblem();
  $('render-status').textContent = problem || '正在生成图片…';
  if (!problem) timer = setTimeout(() => prepareImages(version), 130);
}

function renderFile(kind, qrImage, exported) {
  const canvas = kind === 'long' ? makeLong(exported, qrImage, brand) : makeCover(exported, brand);
  const filename = imageName(exported, kind, brand);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      const width = canvas.width;
      const height = canvas.height;
      canvas.width = canvas.height = 1;
      if (!blob || blob.type !== 'image/png') {
        reject(new Error('PNG 生成失败'));
        return;
      }
      const file = new File([blob], filename, { type: 'image/png' });
      resolve({ file, width, height });
    }, 'image/png');
  });
}

async function prepareImages(version) {
  // 连点或改价很快时，避免两张画布同时生成把页面卡住：排队，只保留最后一次。
  if (rendering) {
    queuedRender = version;
    return;
  }
  rendering = true;
  try {
    const qrImage = await loadContactQr();
    if (version !== generation) return;
    const exported = currentOutput();
    const results = await Promise.all(KINDS.map(kind => renderFile(kind, qrImage, exported)));
    if (version !== generation) return;
    for (const [index, kind] of KINDS.entries()) {
      const asset = results[index];
      asset.url = URL.createObjectURL(asset.file);
      files[kind] = asset;
      const link = $('download-' + kind);
      link.href = asset.url;
      link.download = asset.file.name;
      $('share-' + kind).disabled = false;
    }
    if (!qrImage) {
      $('qr-status').textContent = brand.qr
        ? '自定义二维码无法解析，长图暂留空。可在「品牌与联系方式」里重新上传。'
        : '联系二维码未加载，长图暂留空。请联网刷新后重试。';
    }
    $('qr-status').hidden = Boolean(qrImage);
    $('download-links').hidden = false;
    selectImage(selected);
  } catch {
    if (version !== generation) return;
    $('render-status').textContent = '图片生成失败。可点击重试，或重新打开本页。';
    const retry = document.createElement('button');
    retry.className = 'secondary';
    retry.textContent = '重试生成';
    retry.addEventListener('click', () => {
      retry.remove();
      requestImages();
    }, { once: true });
    $('placeholder').querySelector('button')?.remove();
    $('placeholder').append(retry);
  } finally {
    rendering = false;
    const next = queuedRender;
    queuedRender = null;
    if (next === generation) prepareImages(next);
  }
}

async function save(kind) {
  const asset = files[kind];
  if (!asset) return;
  const version = generation;
  selectImage(kind);
  const payload = { files: [asset.file] };
  try {
    // 分享必须由点击直接触发。PNG 已生成，这里先调用分享再等待结果。
    if (navigator.share && navigator.canShare?.(payload)) {
      await navigator.share(payload);
      if (version === generation) $('share-status').textContent = '分享面板已关闭，请在「照片」或「文件」确认图片。';
      return;
    }
  } catch (error) {
    if (version !== generation) return;
    if (error.name === 'AbortError') {
      $('share-status').textContent = '分享已取消，可重试或使用下方下载链接。';
      return;
    }
  }
  $('download-' + kind).click();
  $('share-status').textContent = '已发起 PNG 下载。可在「文件」打开后存储图像，或单独打开图片后长按保存。';
}

async function copyField(field, status, label) {
  const value = field.value;
  if (!value) return;
  let copied = false;
  try {
    await navigator.clipboard.writeText(value);
    copied = true;
  } catch {
    field.hidden = false;
    field.focus();
    field.select();
    field.setSelectionRange(0, value.length);
    try { copied = document.execCommand('copy'); } catch { /* 保留文字选择供手动复制。 */ }
  }
  status.textContent = copied ? '已复制' + label + '。' : '已选中文字，可长按选择「拷贝」。';
}

function showStep(step) {
  document.body.dataset.step = step;
  $('edit-tab').setAttribute('aria-pressed', String(step === 'edit'));
  $('output-tab').setAttribute('aria-pressed', String(step === 'output'));
  window.scrollTo(0, 0);
}

let qrPreviewSrc = '';

function fillBrandForm() {
  // 仅在值不同时写回，避免输入过程中光标跳到末尾。
  const put = (id, value) => { const el = $(id); if (el.value !== value) el.value = value; };
  put('brand-city', brand.city);
  put('brand-seal-input', brand.seal);
  put('brand-name-input', brand.name);
  put('brand-phone', brand.phone);
  put('brand-wechat', brand.wechat);
  const custom = Boolean(brand.qr);
  if (custom !== Boolean(qrPreviewSrc)) {
    qrPreviewSrc = custom ? brand.qr : '';
    if (custom) $('brand-qr-preview').src = brand.qr;
    else $('brand-qr-preview').removeAttribute('src');
  }
  $('brand-qr-preview').hidden = !custom;
  $('brand-qr-note').textContent = custom ? '已使用自定义二维码' : '当前使用内置二维码';
  $('brand-qr-reset').disabled = !custom;
}

function applyBrand() {
  $('brand-seal').textContent = sealOf(brand);
  $('brand-name').textContent = brandName(brand);
  document.title = brandName(brand) + '行情制稿台';
  $('preview-image').alt = brandName(brand) + '行情制稿预览';
  $('screenshot-prompt').value = screenshotPrompt(brand);
  fillBrandForm();
}

function readBrandForm() {
  return {
    city: $('brand-city').value,
    seal: $('brand-seal-input').value,
    name: $('brand-name-input').value,
    phone: $('brand-phone').value,
    wechat: $('brand-wechat').value,
    qr: brand.qr
  };
}

let brandTimer;
function brandChanged(message) {
  // 输入时立即更新页头与文案；存储和重绘合并到停顿后再做，避免每个按键都重写缓存、重画两张长图。
  brand = normalizeBrand(readBrandForm());
  applyBrand();
  clearTimeout(brandTimer);
  brandTimer = setTimeout(() => {
    const saved = saveBrand(brand);
    $('brand-status').textContent = saved.ok ? (message || '') :
      '已套用到图片和文案，但当前浏览器存不下这份设置，刷新后会恢复上次保存的值。';
    update();
  }, 300);
}

makePriceTable();
restore();
applyBrand();
fillEditor();
update();
showStep('edit');

$('screenshots').addEventListener('change', event => {
  const count = event.target.files.length;
  $('scan').disabled = scanning || !count;
  $('scan-status').textContent = count ? '已选 ' + count + ' 张。识别会填入一份新草稿。' :
    '可同时选取多张。截图在本机识别，建议用清晰的四列表格原图。';
});

$('scan').addEventListener('click', async () => {
  const field = $('screenshots');
  const input = Array.from(field.files);
  const status = $('scan-status');
  if (scanning || !input.length) return;
  if (input.length > 5) {
    field.value = '';
    status.textContent = '一次最多识别 5 张。请重新选择 1～5 张截图。';
    return;
  }
  scanning = true;
  field.disabled = true;
  $('scan').disabled = true;
  const version = generation;
  status.textContent = '正在准备本机识别…';
  try {
    const { recognizeScreenshots } = await import('./ocr.js');
    const batch = await recognizeScreenshots(input, (index, count) => {
      status.textContent = '正在识别第 ' + index + ' / ' + count + ' 张截图…';
    });
    if (version !== generation) {
      status.textContent = '识别期间草稿已改动，请重新点「识别并填入」。';
      return;
    }
    if (batch.mixedDates) {
      status.textContent = '截图日期不一致，请按日期分别识别。草稿已保留。';
      return;
    }
    if (!batch.matches.some(rows => rows.length)) {
      status.textContent = '这张截图里没有 15 款模板内的酒款（可能只截到表头或其他品牌）。草稿已保留。';
      return;
    }
    if (batch.confirmPhotos.length && !window.confirm('图 ' + batch.confirmPhotos.join('、') +
        ' 没有日期，也无法通过重复报价与有日期的截图衔接。确认它们都属于 ' + batch.date + ' 的行情吗？')) {
      status.textContent = '已取消本次识别，草稿已保留。';
      return;
    }
    const next = mergeScan(draft, batch);
    draft = next;
    showPhotos(input);
    $('json').value = '';
    $('import-status').textContent = '';
    $('price-details').open = true;
    fillEditor();
    update();
    field.value = '';
    // 按"本次真正识别到几款"报数，未识别到的行保持原值（不能算作已更新）。
    const touched = batch.matches.filter(rows => rows.length).length;
    const reviewing = next.review.filter(check => Object.keys(check).length).length;
    status.textContent = '本次识别到 ' + touched + ' 款' +
      (reviewing ? '，其中 ' + reviewing + ' 款待核对' : '') +
      '；未识别到的酒款保持原值。未确认前导出显示「—」。';
  } catch {
    status.textContent = '识别未完成，草稿已保留。请联网重试或换一张清晰截图。';
  } finally {
    scanning = false;
    field.disabled = false;
    $('scan').disabled = !field.files.length;
  }
});

$('import').addEventListener('click', () => {
  let next;
  try {
    next = importDraft($('json').value);
  } catch (error) {
    $('import-status').textContent = error.message;
    return;
  }
  // 与截图识别一致：已有录入内容时先确认，避免静默覆盖手工数据。
  if (hasDraftContent() && !window.confirm('导入会用新数据整份替换当前的日期、来源和价格，且无法撤销。继续导入？')) {
    $('import-status').textContent = '已取消导入，当前草稿保持不变。';
    return;
  }
  replaceDraft(next, '已导入。请核对日期、来源和待核实的酒款。');
});

$('sample').addEventListener('click', async () => {
  const button = $('sample');
  if (button.disabled) return;
  button.disabled = true;
  const version = generation;
  try {
    const response = await fetch('./sample.json');
    if (!response.ok) throw new Error();
    const text = await response.text();
    if (version !== generation) return;
    const next = importDraft(text);
    $('json').value = text;
    replaceDraft(next, '已载入 2026-11-18 历史测试样例。');
  } catch {
    $('import-status').textContent = '加载测试样例失败，可重试或手动粘贴 sample.json。';
  } finally {
    button.disabled = false;
  }
});

$('date').addEventListener('input', event => {
  draft.date = event.target.value;
  dataChanged();
});

$('source').addEventListener('input', event => {
  draft.source = event.target.value.trim();
  dataChanged();
});

$('remember').addEventListener('change', persist);
$('output-kind').addEventListener('change', dataChanged);
$('rights').addEventListener('change', () => {
  if (!$('rights').checked && draft.hideWatermark) {
    draft.hideWatermark = false;
    update();
  } else {
    refreshText();
  }
});

$('formal').addEventListener('click', () => {
  if (!canConfirmFormal() || !$('rights').checked) return;
  draft.hideWatermark = !draft.hideWatermark;
  if (!draft.hideWatermark) $('rights').checked = false;
  update();
});

$('clear').addEventListener('click', () => {
  if (!window.confirm('清空本页价格、日期、来源和已保存草稿？')) return;
  $('remember').checked = false;
  $('json').value = '';
  replaceDraft(blankDraft(), '已清空。');
});

for (const id of ['brand-city', 'brand-seal-input', 'brand-name-input', 'brand-phone', 'brand-wechat']) {
  $(id).addEventListener('input', () => brandChanged());
}

$('brand-qr').addEventListener('change', event => {
  const file = event.target.files?.[0];
  const status = $('brand-status');
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) {
    status.textContent = '请选择 PNG 或 JPG 格式的二维码图片。';
    event.target.value = '';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    status.textContent = '二维码图片请小于 10 MB。';
    event.target.value = '';
    return;
  }
  status.textContent = '正在处理二维码…';
  compressQr(file).then(dataUrl => {
    brand = { ...brand, qr: dataUrl };
    brandChanged('二维码已更新（已压缩到适合保存的尺寸）。');
    event.target.value = '';
  }).catch(() => {
    status.textContent = '读取图片失败，请换一张试试。';
    event.target.value = '';
  });
});

$('brand-qr-reset').addEventListener('click', () => {
  brand = { ...brand, qr: DEFAULT_BRAND.qr };
  brandChanged('已恢复内置二维码。');
});

$('brand-reset').addEventListener('click', () => {
  if (!window.confirm('恢复默认品牌：城市上海、电话 13900918519、内置二维码？')) return;
  brand = clearBrand();
  applyBrand();
  $('brand-status').textContent = '已恢复默认品牌。';
  update();
});

$('edit-tab').addEventListener('click', () => showStep('edit'));
$('output-tab').addEventListener('click', () => showStep('output'));
$('next').addEventListener('click', () => showStep('output'));
for (const kind of KINDS) {
  $('show-' + kind).addEventListener('click', () => selectImage(kind));
  $('share-' + kind).addEventListener('click', () => save(kind));
}
$('copy-prompt').addEventListener('click', () => copyField($('screenshot-prompt'), $('prompt-status'), '整理提示词'));
for (const [key, label] of [['title', '标题'], ['body', '正文']]) {
  $('copy-' + key).addEventListener('click', () => copyField($('article-' + key), $('copy-status'), label));
}
