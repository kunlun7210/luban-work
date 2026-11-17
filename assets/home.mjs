const catalog = await (await fetch(new URL('catalog.json', import.meta.url))).json();
const categories = { ALL: '全部工具', IMAGE: '图片工具', TEXT: '文本工具', DEVELOPMENT: '开发工具', QUERY: '查询工具', VIDEO: '视频工具', GENERIC: '常用工具', MISC: '其他工具' };
const categoryPaths = {
  IMAGE: 'M3 4h18v16H3zm1 13 5-5 4 4 3-3 4 4M15 8h.01', TEXT: 'M4 5h16M4 10h16M4 15h11M4 20h8', DEVELOPMENT: 'm8 6-6 6 6 6m8-12 6 6-6 6m-2-15-4 18',
  QUERY: 'M16 16l5 5M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', VIDEO: 'M3 5h18v14H3zm7 3 6 4-6 4z', GENERIC: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z', MISC: 'M7 8V5h10v3M3 8h18v12H3zm0 5h18',
};
const iconPaths = {
  qrcode: 'M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm12-3v3h3v6m0-6h3m-9 6h3',
  'password-generator': 'M6 10h12v11H6zm2 0V7a4 4 0 1 1 8 0v3m-4 5v2',
  'barcode-generator': 'M3 4v16m3-16v16m4-16v16m2-16v16m3-16v16m4-16v16m2-16v16',
  'travel-map': 'M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
};
const $ = selector => document.querySelector(selector);
const input = $('#search');
const bySlug = new Map(catalog.map(tool => [tool.id, tool]));
const recentKey = 'universal-toolbox-recent-v1';
let category = 'ALL';

function recentTools() {
  try { return JSON.parse(localStorage.getItem(recentKey) || '[]'); }
  catch { return []; }
}

function icon(tool) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const path = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', iconPaths[tool.id] || categoryPaths[tool.category]);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.7');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function card(tool) {
  const anchor = document.createElement('a');
  anchor.className = 'card';
  anchor.href = tool.url || './tool/' + tool.id + '/';
  const mark = document.createElement('span');
  mark.className = 'card-icon cat-' + tool.category;
  mark.append(icon(tool));
  const text = document.createElement('span');
  const label = document.createElement('b');
  label.textContent = tool.name;
  const meta = document.createElement('small');
  meta.textContent = categories[tool.category] + (tool.mode === 'local' ? ' · 本机工具' : '');
  text.append(label, meta);
  anchor.append(mark, text);
  anchor.addEventListener('click', () => {
    try { localStorage.setItem(recentKey, JSON.stringify([tool.id,...recentTools().filter(id=>id!==tool.id)].slice(0,6))); }
    catch { /* The tools still work without local storage. */ }
  });
  return anchor;
}

function render() {
  const query = input.value.trim().toLocaleLowerCase();
  const matches = catalog.filter(tool =>
    (query ? [tool.name, tool.id, ...(tool.keywords || [])].some(word => word.toLocaleLowerCase().includes(query))
      : category === 'ALL' || tool.category === category));
  $('#results').textContent = query ? (matches.length ? '找到 ' + matches.length + ' 个工具' : '没有找到相关工具') : '';
  $('#cards').replaceChildren(...matches.map(card));
  document.querySelectorAll('[data-category]').forEach(button => {
    const active = button.dataset.category === category && !query;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  });
}

for (const container of [$('#sidebar'), $('#tabs')]) {
  for (const [key, name] of Object.entries(categories)) {
    const button = document.createElement('button');
    const count = document.createElement('span');
    count.textContent = key === 'ALL' ? catalog.length : catalog.filter(tool => tool.category === key).length;
    button.className = 'category';
    button.dataset.category = key;
    button.append(name, count);
    button.onclick = () => { input.value = ''; category = key; render(); };
    container.append(button);
  }
}
for (const button of document.querySelectorAll('.hot button')) {
  button.onclick = () => { input.value = button.textContent; render(); $('#tool-library').scrollIntoView(); };
}
input.oninput = render;
$('.search').onsubmit = event => { event.preventDefault(); $('#tool-library').scrollIntoView(); };
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.target.matches('input, textarea') && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    input.focus();
  }
});
$('#hero-count').textContent = '· ' + catalog.length + ' 个日常工具';
$('#intro').textContent = '图片、文字、查询、开发，' + catalog.length + ' 个小工具收进一张桌面。';
const recent = recentTools().map(id=>bySlug.get(id)).filter(Boolean);
$('#recent').hidden = recent.length === 0;
$('#recent-cards').replaceChildren(...recent.map(card));
render();
