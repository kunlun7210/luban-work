import { canvas, context, draw, exportImage, imageFile, nameStem, printJpeg, printSheet, readImage, yieldFrame } from './image.mjs';

const configs = {
  'id-photo': ['证件照制作', '换背景、调整人像位置，导出单张照片和 6 寸打印排版。', '制作证件照', [['正面证件照原图', 1]]],
  'batch-cutout': ['批量人像抠图', '一次处理最多 30 张人像照片，保存透明 PNG 或打包下载。', '开始抠图', [['人像照片', 30]]],
  ocr: ['文本识别（OCR）', '从截图和印刷图像提取文字。可以校对结果，再复制或下载。', '识别文字', [['文字图片', 10]]],
  'face-fusion': ['人脸融合', '将前景人脸与模板图五官对齐，调整融合强度并保存 PNG。', '开始融合', [['模板图（保留背景）', 1], ['前景图（提供人脸）', 1]]],
  'image-colorizer': ['黑白图像上色', '为黑白照片推测颜色，保留原图明暗。可对比原图并调整饱和度。', '开始上色', [['黑白照片', 1]]],
  'table-extractor': ['图片提取表格', '识别印刷表格中的行列和文字，校对单元格后导出 Excel 或 CSV。', '识别表格', [['表格图片', 1]]],
  'object-detection': ['拍照计数', '检测照片中的常见物体，校正标记并导出带编号的图片。', '开始检测', [['待检测图片', 1]]],
};
const slug = location.pathname.split('/').filter(Boolean).at(-1);
const [title, description, action, sources] = configs[slug];
const results = document.getElementById('result');
const status = document.getElementById('status');
const progressWrap = document.getElementById('progress');
const progressBar = progressWrap.querySelector('progress');
const run = document.getElementById('run');
const stop = document.getElementById('stop');
const settings = {};
const urlCache = new Set();
const uploaders = [];
let current;
let activeUploader = 0;

function element(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') node.className = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function notify(message, error = false, progress) {
  status.hidden = !message;
  status.textContent = message;
  status.classList.toggle('error', error);
  progressWrap.hidden = !current || error;
  if (Number.isFinite(progress)) progressBar.value = Math.min(1, Math.max(.01, progress));
  else progressBar.removeAttribute('value');
}

function button(label, onClick, className = '') {
  const control = element('button', { type: 'button', className }, label);
  control.addEventListener('click', onClick);
  return control;
}

function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = element('a', { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function download(label, blob, filename) {
  return button(label, () => save(blob, filename));
}

function outputPreview(blob, label, transparent = false) {
  const src = URL.createObjectURL(blob);
  urlCache.add(src);
  return element('figure', {}, element('img', { className: 'art' + (transparent ? ' checker' : ''), src, alt: label, loading: 'lazy' }),
    element('figcaption', {}, label));
}

function clearResults(note = '选择图片后开始处理') {
  for (const url of urlCache) URL.revokeObjectURL(url);
  urlCache.clear();
  results.replaceChildren(element('p', { className: 'placeholder' }, note));
}

function addResult(node) {
  results.querySelector('.placeholder')?.remove();
  results.append(node);
}

function refresh() {
  run.disabled = Boolean(current) || uploaders.some(input => !input.files.length);
  for (const control of document.querySelectorAll('#inputs button, #inputs input, #options input, #options select')) control.disabled = Boolean(current);
  stop.hidden = !current;
}

function makeUploader([label, max], index) {
  const files = [];
  const input = element('input', { className: 'file-control', id: 'image-' + index, type: 'file', accept: 'image/*', multiple: max > 1 });
  const selector = element('label', { className: 'drop', htmlFor: input.id },
    element('strong', {}, max > 1 ? '选择图片' : '选择一张图片'),
    element('span', {}, '也可拖放或粘贴' + (max > 1 ? ' · 最多 ' + max + ' 张' : '')));
  const list = element('ul', { className: 'file-list' });
  function update() {
    const items = files.map((file, at) => element('li', {}, element('span', {}, file.name), button('移除', () => {
      files.splice(at, 1);
      update();
      clearResults();
      notify('');
    })));
    list.replaceChildren(...items);
    refresh();
  }
  function accept(chosen) {
    if (current || !chosen.length) return;
    const valid = [...chosen].filter(imageFile);
    if (!valid.length) {
      notify('请添加 JPG、PNG、WebP 等位图。', true);
      return;
    }
    if (max === 1) files.splice(0, files.length, valid[0]);
    else files.push(...valid.slice(0, max - files.length));
    clearResults('图片已选，可以开始处理。');
    const truncated = valid.length !== chosen.length || chosen.length > max;
    notify(truncated ? '已添加可用的图片，超出数量或格式不支持的文件已跳过。' : '');
    update();
    if (uploaders.length > 1 && !uploaders[1].files.length) activeUploader = 1;
  }
  input.addEventListener('change', () => {
    accept(input.files);
    input.value = '';
  });
  input.addEventListener('focus', () => { activeUploader = index; });
  selector.addEventListener('dragover', event => {
    event.preventDefault();
    selector.classList.add('active');
  });
  selector.addEventListener('dragleave', () => selector.classList.remove('active'));
  selector.addEventListener('drop', event => {
    event.preventDefault();
    selector.classList.remove('active');
    accept(event.dataTransfer.files);
  });
  document.getElementById('inputs').append(element('fieldset', { className: 'uploader' },
    element('legend', {}, label), input, selector, list));
  return { files, accept };
}

const grid = element('div', { className: 'controls-grid' });

function control(name, label, properties, values, full = false) {
  const input = element(values ? 'select' : 'input', { id: 'option-' + name, ...properties });
  if (values) {
    input.append(...values.map(([value, caption]) => element('option', { value }, caption)));
    input.value = properties.value ?? values[0][0];
  }
  const output = element('span');
  if (properties.type === 'range') {
    const update = () => { output.textContent = ' · ' + input.value + '%'; };
    update();
    input.addEventListener('input', update);
  }
  const wrapper = element('div', { className: full ? 'full' : '' },
    element('label', { className: 'control-label', htmlFor: input.id }, label, output), input);
  settings[name] = input;
  grid.append(wrapper);
  return wrapper;
}

function recognitionRotation() {
  control('rotation', '旋转图片', {}, [['0', '不旋转'], ['90', '向右 90°'], ['180', '180°'], ['270', '向左 90°']]);
}

const number = (name, label, value, min, max) => control(name, label, { type: 'number', value, min, max, step: 1 });
const range = (name, label, value, min, max, full = false) => control(name, label, { type: 'range', value, min, max }, null, full);
const value = name => settings[name].value;
const numeric = name => Number(value(name));

document.getElementById('title').textContent = title;
document.getElementById('description').textContent = description;
run.textContent = action;
uploaders.push(...sources.map(makeUploader));

switch (slug) {
  case 'id-photo': {
    const presets = [['295x413', '一寸 · 25 × 35 毫米'], ['390x567', '二寸 · 33 × 48 毫米'],
      ['260x378', '小一寸 · 22 × 32 毫米'], ['413x531', '护照尺寸 · 35 × 45 毫米'],
      ['600x600', '2 × 2 英寸 · 51 × 51 毫米'], ['custom', '自定义像素']];
    control('size', '照片规格（300 DPI）', {}, presets, true);
    const w = number('width', '宽（像素）', 295, 100, 1600);
    const h = number('height', '高（像素）', 413, 100, 1600);
    const optional = () => { w.hidden = h.hidden = value('size') !== 'custom'; };
    optional();
    settings.size.addEventListener('change', optional);
    control('background', '背景颜色', {}, [['#ffffff', '白底'], ['#438edb', '蓝底'], ['#d7282b', '红底'], ['custom', '自定义颜色']]);
    const color = control('color', '自定义颜色', { type: 'color', value: '#e9e9e9' });
    const chosen = () => { color.hidden = value('background') !== 'custom'; };
    chosen();
    settings.background.addEventListener('change', chosen);
    range('zoom', '人像缩放', 100, 75, 135, true);
    range('shiftX', '左右微调', 0, -25, 25);
    range('shiftY', '上下微调', 0, -25, 25);
    grid.append(element('p', { className: 'hint full' }, '建议用正面、头肩完整的照片。提交前请核对办理方的尺寸和拍摄要求。'));
    break;
  }
  case 'batch-cutout':
    range('sensitivity', '边缘保留', 50, 10, 90, true);
    control('size', '输出最长边', {}, [['2400', '2400 像素'], ['1600', '1600 像素'], ['3500', '3500 像素']], true);
    break;
  case 'ocr':
    recognitionRotation();
    control('detail', '识别模式', {}, [['standard', '标准'], ['dense', '密集小字']]);
    grid.append(element('p', { className: 'hint full' }, 'PaddleOCR PP-OCRv6 · 自动识别简繁中文、英文等混排文字。'));
    break;
  case 'face-fusion':
    range('strength', '融合强度', 80, 5, 100, true);
    grid.append(element('p', { className: 'hint full' }, '两张照片各保留一张清楚的正面人脸。支持相近角度，不适合遮挡或大幅侧脸。'));
    break;
  case 'image-colorizer':
    range('saturation', '色彩强度', 100, 0, 180, true);
    grid.append(element('p', { className: 'hint full' }, '颜色由模型推测。原始照片的真实颜色需参考历史资料。'));
    break;
  case 'table-extractor':
    recognitionRotation();
    control('structure', '表格类型', {}, [['auto', '自动'], ['grid', '有框线'], ['borderless', '无框线']]);
    number('columns', '列数（0 为自动）', 0, 0, 40);
    grid.append(element('p', { className: 'hint full' }, '请先裁到表格区域。可识别清晰的印刷文字，复杂合并单元格请在导出前校对。'));
    break;
  case 'object-detection':
    control('mode', '计数方式', {}, [['objects', '常见物体 · AI'], ['round', '圆形截面 · 对比度'], ['manual', '手动打点']], true);
    range('threshold', '识别阈值', 30, 10, 90, true);
    grid.append(element('p', { className: 'hint full' }, 'AI 支持人、杯、瓶、果蔬、车辆等常见物体。圆形模式适用于与背景分明、彼此分开的截面。'));
    break;
}
if (grid.children.length) document.getElementById('options').append(grid);

document.addEventListener('paste', event => {
  if (current || event.target.closest?.('input:not([type=file]), textarea, [contenteditable]')) return;
  const files = event.clipboardData.files;
  if (files.length && [...files].some(imageFile)) {
    event.preventDefault();
    uploaders[activeUploader]?.accept(files);
  }
});

async function handleIdPhoto(file, progress, signal) {
  const { makeIdPhoto } = await import('./vision.mjs?v=4');
  const [width, height] = value('size') === 'custom'
    ? [numeric('width'), numeric('height')]
    : value('size').split('x').map(Number);
  if (![width, height].every(number => Number.isInteger(number) && number >= 100 && number <= 1600)) {
    throw new Error('自定义尺寸必须是 100 到 1600 像素的整数。');
  }
  const image = await readImage(file);
  const photo = await makeIdPhoto(image, {
    width, height, zoom: numeric('zoom'), shiftX: numeric('shiftX'), shiftY: numeric('shiftY'), sensitivity: 50,
    background: value('background') === 'custom' ? value('color') : value('background'),
  }, progress);
  signal.throwIfAborted();
  const [png, jpg] = await Promise.all([exportImage(photo), printJpeg(photo)]);
  const stem = nameStem(file.name);
  const bar = element('div', { className: 'toolbar' }, download('下载 JPG（300 DPI）', jpg, stem + '-证件照.jpg'),
    download('下载 PNG', png, stem + '-证件照.png'));
  const printFits = Math.min(width, height) <= 1130 && Math.max(width, height) <= 1730;
  const preview = element('div', { className: 'preview-pair' }, outputPreview(png, width + ' × ' + height + ' 像素'));
  if (printFits) {
    const sheet = await printJpeg(printSheet(photo));
    bar.append(download('下载 6 寸打印版', sheet, stem + '-6寸排版.jpg'));
    preview.append(outputPreview(sheet, '6 寸 · 1800 × 1200 像素 · 300 DPI'));
  }
  addResult(element('div', {}, preview, bar));
}

async function eachImage(files, progress, signal, perform) {
  let passed = 0;
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted();
    const position = (index + 1) + '/' + files.length;
    progress('处理 ' + position + ' · ' + file.name, index / files.length);
    await yieldFrame();
    try {
      await perform(file, (message, fraction = 0) => progress(position + ' · ' + message, (index + fraction) / files.length), index);
      passed++;
    } catch (error) {
      signal.throwIfAborted();
      addResult(element('div', { className: 'result-item' }, element('strong', {}, file.name),
        element('p', { className: 'hint' }, '处理失败。' + error.message)));
    }
  }
  if (!passed) throw new Error('没有图片处理成功，请检查每张图片的提示。');
  return passed + '/' + files.length + ' 张处理成功';
}

async function handleBatch(files, progress, signal) {
  const { cutout } = await import('./vision.mjs?v=4');
  const entries = [];
  const collection = element('div', { className: 'image-list' });
  addResult(collection);
  const summary = await eachImage(files, progress, signal, async (file, report, index) => {
    report('分离人像…');
    const image = await readImage(file, numeric('size'));
    const output = await cutout(image, numeric('sensitivity'));
    signal.throwIfAborted();
    const blob = await exportImage(output);
    const filename = String(index + 1).padStart(2, '0') + '-' + nameStem(file.name) + '-抠图.png';
    entries.push([filename, blob]);
    collection.append(element('div', { className: 'result-item' }, outputPreview(blob, filename, true),
      element('div', { className: 'toolbar' }, download('下载 PNG', blob, filename))));
  });
  if (entries.length > 1) {
    const packageButton = button('打包下载 ZIP', async () => {
      packageButton.disabled = true;
      try {
        if (entries.reduce((sum, [, blob]) => sum + blob.size, 0) > 220 * 1024 * 1024) {
          throw new Error('结果已超过 220 MB，请分批处理或单独下载。');
        }
        const { zipFiles } = await import('./exports.mjs');
        const files = await Promise.all(entries.map(async ([name, blob]) => [name, new Uint8Array(await blob.arrayBuffer())]));
        save(await zipFiles(Object.fromEntries(files)), '人像抠图.zip');
      } catch (error) {
        notify(error.message, true);
      } finally {
        packageButton.disabled = false;
      }
    });
    results.prepend(element('div', { className: 'toolbar' }, packageButton));
  }
  return summary;
}

async function copyText(text, field) {
  try {
    await navigator.clipboard.writeText(text);
    notify('已复制。');
  } catch {
    field.focus();
    field.select();
    notify('已选中文字，可以按系统快捷键复制。');
  }
}

async function handleOcr(files, progress, signal) {
  const { recognize, orient } = await import('./ocr.mjs?v=paddle1');
  const fields = [];
  const summary = await eachImage(files, progress, signal, async (file, report) => {
    const image = orient(await readImage(file), numeric('rotation'));
    const { text, confidence } = await recognize(image, { detail: value('detail') === 'dense' }, report, signal);
    if (!text) throw new Error('没识别到文字，请检查清晰度和语言。');
    const field = element('textarea', { value: text, 'aria-label': '识别结果 ' + file.name, spellcheck: false });
    fields.push([file.name, field]);
    addResult(element('div', { className: 'result-item' }, element('strong', {}, file.name),
      element('p', { className: 'hint' }, '识别置信度 ' + confidence + '% · 可直接编辑'),
      field,
      element('div', { className: 'toolbar' },
        button('复制文字', () => copyText(field.value, field)),
        button('下载 TXT', () => save(new Blob([field.value], { type: 'text/plain;charset=utf-8' }), nameStem(file.name) + '.txt')))));
  });
  if (fields.length > 1) {
    results.prepend(element('div', { className: 'toolbar' }, button('下载全部 TXT', () => {
      const text = fields.map(([name, field]) => name + '\n' + field.value).join('\n\n');
      save(new Blob([text], { type: 'text/plain;charset=utf-8' }), '批量文字识别.txt');
    })));
  }
  return summary;
}

async function handleFusion(files, progress, signal) {
  const { fuseFaces } = await import('./vision.mjs?v=4');
  const [base, donor] = await Promise.all(files.map(file => readImage(file, 2100)));
  const output = await fuseFaces(base, donor, numeric('strength'), progress);
  signal.throwIfAborted();
  const png = await exportImage(output);
  addResult(element('div', {}, element('div', { className: 'preview-pair' },
    outputPreview(await exportImage(base, 'image/jpeg'), '模板原图'), outputPreview(png, '融合结果')),
    element('div', { className: 'toolbar' }, download('下载融合 PNG', png, nameStem(files[0].name) + '-融合.png'))));
}

async function handleColor(file, progress, signal) {
  progress('准备上色引擎…');
  const { colorize } = await import('./color.mjs');
  const image = await readImage(file, 3200);
  const original = await exportImage(image, 'image/jpeg');
  const output = await colorize(image, numeric('saturation') / 100, progress, signal);
  signal.throwIfAborted();
  const png = await exportImage(output);
  addResult(element('div', {}, element('div', { className: 'preview-pair' }, outputPreview(original, '原图'), outputPreview(png, '上色结果')),
    element('div', { className: 'toolbar' }, download('下载上色 PNG', png, nameStem(file.name) + '-上色.png'))));
}

async function handleTable(file, progress, signal) {
  const { extractTable, orient } = await import('./ocr.mjs?v=paddle1');
  const image = orient(await readImage(file), numeric('rotation'));
  const columns = numeric('columns');
  if (!Number.isInteger(columns) || columns < 0 || columns > 40) throw new Error('列数须为 0 到 40 的整数。');
  const { matrix, confidence, structure } = await extractTable(image, {
    structure: value('structure'), columns,
  }, progress, signal);
  signal.throwIfAborted();
  const { csvBlob, xlsxBlob } = await import('./exports.mjs');
  const header = element('tr', {}, element('th', { scope: 'col' }, '行'));
  const body = element('tbody');
  const measure = element('p', { className: 'hint' });
  const render = () => {
    const width = matrix[0].length;
    measure.textContent = matrix.length + ' 行 × ' + width + ' 列 · ' + structure + ' · OCR 置信度 ' + confidence + '%';
    header.replaceChildren(element('th', { scope: 'col' }, '行'), ...matrix[0].map((_, i) => element('th', { scope: 'col' }, '第 ' + (i + 1) + ' 列')));
    body.replaceChildren(...matrix.map((row, i) => element('tr', {}, element('th', { scope: 'row' }, String(i + 1)), ...row.map((text, j) => {
      const input = element('input', { type: 'text', value: text, 'aria-label': '第 ' + (i + 1) + ' 行第 ' + (j + 1) + ' 列' });
      input.addEventListener('input', () => { matrix[i][j] = input.value; });
      return element('td', {}, input);
    }))));
  };
  render();
  const stem = nameStem(file.name);
  const xlsx = button('下载 Excel', async () => {
    xlsx.disabled = true;
    try {
      save(await xlsxBlob(matrix), stem + '.xlsx');
    } catch (error) {
      notify('Excel 导出失败。' + error.message, true);
    } finally {
      xlsx.disabled = false;
    }
  });
  const rowCount = element('input', { type: 'number', min: 1, max: 120, value: matrix.length, 'aria-label': '结果行数' });
  const columnCount = element('input', { type: 'number', min: 1, max: 40, value: matrix[0].length, 'aria-label': '结果列数' });
  const editSize = button('调整行列', () => {
    if (!rowCount.reportValidity() || !columnCount.reportValidity()) return;
    const rowNumber = rowCount.valueAsNumber, colNumber = columnCount.valueAsNumber;
    if (!Number.isInteger(rowNumber) || !Number.isInteger(colNumber)) {
      notify('行数和列数必须是整数。', true);
      return;
    }
    const retained = Array.from({ length: rowNumber }, (_, i) => Array.from({ length: colNumber }, (_, j) => matrix[i]?.[j] ?? ''));
    if (matrix.some((row, i) => row.some((text, j) => text && (i >= rowNumber || j >= colNumber)))) {
      notify('缩小会删掉有内容的单元格，请先清空相关单元格。', true);
      return;
    }
    matrix.splice(0, matrix.length, ...retained);
    notify('');
    render();
  });
  addResult(element('div', {}, measure,
    element('div', { className: 'toolbar table-control' }, element('label', {}, '行 ', rowCount), element('label', {}, '列 ', columnCount), editSize),
    element('div', { className: 'table-wrap' }, element('table', {}, element('thead', {}, header), body)),
    element('div', { className: 'toolbar' }, xlsx,
      button('下载 CSV', () => save(csvBlob(matrix), stem + '.csv')))));
}

async function handleCount(file, progress, signal) {
  const image = await readImage(file, 2200);
  const mode = value('mode');
  let marks = [];
  if (mode === 'objects') {
    progress('加载模型并识别物体…');
    const { detectObjects } = await import('./vision.mjs?v=4');
    marks = await detectObjects(image, numeric('threshold') / 100);
  }
  if (mode === 'round') {
    progress('寻找对比分明的圆形截面…');
    const { detectRounds } = await import('./rounds.mjs');
    marks = detectRounds(image, numeric('threshold') / 100);
  }
  signal.throwIfAborted();
  const { default: countView } = await import('./count-view.mjs');
  addResult(countView(image, marks, nameStem(file.name), { element, button, save, notify }));
}

stop.addEventListener('click', () => {
  if (current) current.abort(new DOMException('已停止。', 'AbortError'));
});
run.addEventListener('click', async () => {
  if (current) return;
  const job = new AbortController();
  current = job;
  refresh();
  clearResults('正在处理图片…');
  const report = (text, fraction) => { if (current === job && !job.signal.aborted) notify(text, false, fraction); };
  const files = uploaders.flatMap(input => input.files);
  const first = files[0];
  const { signal } = job;
  let summary;
  let failure;
  try {
    report('准备处理图片…');
    await yieldFrame();
    if (slug === 'id-photo') await handleIdPhoto(first, report, signal);
    if (slug === 'batch-cutout') summary = await handleBatch(files, report, signal);
    if (slug === 'ocr') summary = await handleOcr(files, report, signal);
    if (slug === 'face-fusion') await handleFusion(files, report, signal);
    if (slug === 'image-colorizer') await handleColor(first, report, signal);
    if (slug === 'table-extractor') await handleTable(first, report, signal);
    if (slug === 'object-detection') await handleCount(first, report, signal);
    signal.throwIfAborted();
  } catch (error) {
    failure = error;
    const placeholder = results.querySelector('.placeholder');
    if (placeholder) placeholder.textContent = signal.aborted ? '已停止。可以重新处理。' : '请检查输入或重试。';
  } finally {
    current = undefined;
    refresh();
    if (signal.aborted) notify('已停止。');
    else if (failure) notify(failure.message || '处理失败，请重试。', true);
    else notify(summary || '处理完成。');
  }
});
refresh();
