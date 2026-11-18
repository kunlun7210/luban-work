import { readSubscription, exportNodes, maxBytes } from './converter.mjs';

const $ = id => document.getElementById(id);
const source = $('source');
const formats = {
  clash: ['mihomo.yaml', '完整配置可直接导入 Clash Verge / Mihomo。分流开启时，中国大陆和局域网直连，其余走代理。'],
  provider: ['mihomo-nodes.yaml', '仅导出 proxies 列表，供现有配置作为节点源使用。'],
  base64: ['shadowrocket-base64.txt', '下载 Base64 订阅内容。需要订阅网址时，可自行保存到可信的私有托管位置。'],
  links: ['shadowrocket-links.txt', '复制或下载每行一个分享链接，可按客户端支持的方式导入。'],
  surge: ['surge-nodes.txt', '把节点条目粘贴到 Surge 配置的 [Proxy] 段。'],
  loon: ['loon-nodes.txt', '把节点条目粘贴到 Loon 配置的 [Proxy] 段。'],
  quanx: ['quantumult-x-nodes.txt', '把节点条目粘贴到 Quantumult X 配置的 [server_local] 段。'],
};
let rows = [];
let selected = new Set();
let compatibility = [];
let currentRead;
let revision = 0;
let preset;
let rulesRequest;
const savedKey = 'luban.subscription.sources.v1';
const sourceSelection = new Set();
const engine = () => globalThis.LubanClash;
const options = () => ({ format: $('format').value, prefix: $('prefix').value, split: $('split').checked, preset: $('rules').value === 'acl' ? preset : undefined });

function status(id, message, isError = false) {
  $(id).textContent = message;
  $(id).classList.toggle('error', isError);
}

function visibleRows() {
  const query = $('node-search').value.trim().toLowerCase();
  return compatibility.filter(row => !query || [row.label, row.type].some(value => value?.toLowerCase().includes(query)));
}

function renderList() {
  const list = $('nodes');
  list.hidden = !rows.length;
  $('node-controls').hidden = !rows.length;
  const fragment = document.createDocumentFragment();
  if (rows.length) {
    for (const row of visibleRows()) {
      const item = document.createElement('li');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.id = row.id;
      checkbox.checked = !row.error && selected.has(row.id);
      checkbox.disabled = Boolean(row.error);
      const title = document.createElement('span');
      title.textContent = row.label;
      label.append(checkbox, title);
      if (row.type) {
        const type = document.createElement('small');
        type.textContent = row.type;
        label.append(type);
      }
      item.append(label);
      if (row.error) {
        const issue = document.createElement('small');
        issue.className = 'error';
        issue.textContent = row.error;
        item.append(issue);
      }
      fragment.append(item);
    }
    if (!fragment.childNodes.length) {
      const empty = document.createElement('li');
      empty.textContent = '没有匹配的节点';
      fragment.append(empty);
    }
  }
  list.replaceChildren(fragment);
}

function renderOutput() {
  const settings = options();
  $('format-help').textContent = formats[settings.format][1];
  const isClash = settings.format === 'clash';
  $('rules-row').hidden = !isClash;
  $('split-row').hidden = !isClash || $('rules').value === 'acl';
  const waitingForRules = isClash && $('rules').value === 'acl' && !preset;
  const result = waitingForRules ? { text: '', ok: 0 } : exportNodes(rows, { ...settings, selected }, engine());
  if (result.ruleStats) {
    const { count, skipped } = result.ruleStats;
    status('rules-status', count + ' 条分流规则' + (skipped ? ' · 跳过 ' + skipped + ' 条不兼容规则' : ''));
  }
  const skipped = compatibility.filter(row => row.error).length;
  $('result').value = result.text;
  $('download').disabled = $('copy').disabled = !result.text;
  status('node-status', rows.length
    ? '已读取 ' + rows.length + ' 项 · 已选 ' + result.ok + ' 项 · ' + skipped + ' 项无法导出'
    : '解析后显示节点和兼容性。');
  status('export-status', result.ok ? '已生成 ' + result.ok + ' 个节点' : '');
}

function refresh() {
  compatibility = exportNodes(rows, { ...options(), preset: undefined }, engine()).results;
  renderList();
  renderOutput();
}

function cancelRead() {
  revision++;
  currentRead?.abort();
  currentRead = undefined;
  $('read-url').disabled = false;
}

function resetResults() {
  rows = [];
  selected.clear();
  $('node-search').value = '';
  refresh();
}

function parse() {
  cancelRead();
  try {
    rows = readSubscription(source.value, engine());
    selected = new Set(rows.filter(row => !row.error).map(row => row.id));
    $('node-search').value = '';
    status('source-status', '已解析 ' + rows.length + ' 项');
    refresh();
  } catch (error) {
    resetResults();
    status('source-status', error.message, true);
  }
}

async function loadFile(file) {
  if (!file) return;
  cancelRead();
  const now = revision;
  if (file.size > maxBytes) {
    status('source-status', '文件超过 8 MB', true);
    return;
  }
  resetResults();
  status('source-status', '正在读取文件…');
  try {
    const content = await file.text();
    if (now !== revision) return;
    source.value = content;
    parse();
  } catch {
    if (now === revision) status('source-status', '文件读取失败', true);
  }
}

$('parse').onclick = parse;
$('choose-file').onclick = () => $('source-file').click();
$('source-file').onchange = event => {
  loadFile(event.target.files[0]);
  event.target.value = '';
};
source.addEventListener('input', () => {
  cancelRead();
  resetResults();
  status('source-status', '');
});
source.addEventListener('dragover', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  source.classList.add('dragging');
});
source.addEventListener('dragleave', () => source.classList.remove('dragging'));
source.addEventListener('drop', event => {
  source.classList.remove('dragging');
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  loadFile(event.dataTransfer.files[0]);
});
$('clear').onclick = () => {
  cancelRead();
  source.value = $('source-url').value = $('prefix').value = '';
  resetResults();
  status('source-status', '');
  source.focus();
};
$('example').onclick = () => {
  source.value = `proxies:
  - name: 示例 SS
    type: ss
    server: ss.example.com
    port: 443
    cipher: aes-128-gcm
    password: demo-only
    udp: true
  - name: 示例 Trojan
    type: trojan
    server: trojan.example.com
    port: 443
    password: demo-only
    sni: trojan.example.com`;
  parse();
};

$('read-url').onclick = async () => {
  cancelRead();
  let url;
  try {
    url = new URL($('source-url').value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    status('source-status', '请输入有效的 HTTP 或 HTTPS 订阅网址', true);
    return;
  }
  const now = revision;
  const controller = currentRead = new AbortController();
  $('read-url').disabled = true;
  resetResults();
  status('source-status', '正在读取订阅…');
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body) throw new Error();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        if (now === revision) status('source-status', '订阅内容超过 8 MB', true);
        return;
      }
      text += decoder.decode(value, { stream: true });
    }
    if (now !== revision) return;
    source.value = text + decoder.decode();
    parse();
  } catch {
    if (now === revision) status('source-status', '读取失败。请检查链接，或下载订阅文件后导入。', true);
  } finally {
    clearTimeout(timeout);
    if (now === revision) {
      currentRead = undefined;
      $('read-url').disabled = false;
    }
  }
};

$('node-search').oninput = () => renderList();
$('nodes').onchange = event => {
  const id = Number(event.target.dataset.id);
  if (!Number.isInteger(id)) return;
  if (event.target.checked) selected.add(id);
  else selected.delete(id);
  renderOutput();
};
for (const [id, checked] of [['select-visible', true], ['deselect-visible', false]]) {
  $(id).onclick = () => {
    for (const row of visibleRows()) {
      if (row.error) continue;
      if (checked) selected.add(row.id);
      else selected.delete(row.id);
    }
    renderList();
    renderOutput();
  };
}
function readSaved() {
  return JSON.parse(localStorage.getItem(savedKey) || '[]');
}

function renderSaved() {
  const list = $('saved-list');
  const fragment = document.createDocumentFragment();
  const entries = readSaved();
  for (const entry of entries) {
    const item = document.createElement('li');
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = sourceSelection.has(entry.id);
    checkbox.onchange = () => {
      if (checkbox.checked) sourceSelection.add(entry.id);
      else sourceSelection.delete(entry.id);
      $('combine-sources').disabled = !sourceSelection.size;
    };
    const name = document.createElement('span');
    name.textContent = entry.name;
    label.append(checkbox, name);
    const remove = document.createElement('button');
    remove.textContent = '删除';
    remove.type = 'button';
    remove.setAttribute('aria-label', '删除订阅 ' + entry.name);
    remove.onclick = () => {
      try {
        localStorage.setItem(savedKey, JSON.stringify(readSaved().filter(saved => saved.id !== entry.id)));
        sourceSelection.delete(entry.id);
        renderSaved();
        status('saved-status', '已删除');
      } catch { status('saved-status', '无法写入浏览器存储', true); }
    };
    item.append(label, remove);
    fragment.append(item);
  }
  const ids = new Set(entries.map(entry => entry.id));
  for (const id of sourceSelection) if (!ids.has(id)) sourceSelection.delete(id);
  list.replaceChildren(fragment);
  list.hidden = !entries.length;
  $('combine-sources').disabled = !sourceSelection.size;
}

$('save-source').onclick = () => {
  const name = $('saved-name').value.trim();
  if (!name) {
    $('saved-name').focus();
    return status('saved-status', '请填写订阅名称', true);
  }
  try {
    const imported = readSubscription(source.value, engine());
    if (!imported.some(row => row.node)) throw new Error('当前内容没有可保存的节点');
    const id = crypto.randomUUID();
    localStorage.setItem(savedKey, JSON.stringify([...readSaved(), { id, name, content: source.value }]));
    sourceSelection.add(id);
    $('saved-name').value = '';
    renderSaved();
    status('saved-status', '已保存到当前浏览器');
  } catch (error) {
    status('saved-status', error.name === 'QuotaExceededError' ? '浏览器存储空间不足' : error.message, true);
  }
};

$('combine-sources').onclick = () => {
  try {
    const entries = readSaved().filter(entry => sourceSelection.has(entry.id));
    if (!entries.length) return;
    const encoder = new TextEncoder();
    const combinedSize = entries.reduce((sum, entry) => sum + encoder.encode(entry.content).length, 0);
    if (combinedSize > maxBytes) throw new Error('所选订阅合计超过 8 MB');
    const combined = entries.flatMap(entry => readSubscription(entry.content, engine()).map(row => ({
      ...row, label: row.error ? entry.name + ' · ' + row.label : row.label,
    })));
    if (combined.length > 5000) throw new Error('单次最多加载 5000 个节点');
    cancelRead();
    source.value = '';
    rows = combined.map((row, id) => ({ ...row, id }));
    selected = new Set(rows.filter(row => row.node).map(row => row.id));
    $('node-search').value = '';
    status('source-status', '');
    status('saved-status', '已加载 ' + entries.length + ' 个订阅');
    refresh();
  } catch (error) { status('saved-status', error.message, true); }
};

try { renderSaved(); }
catch { status('saved-status', '当前浏览器无法读取已保存的订阅', true); }
window.addEventListener('storage', event => {
  if (event.key !== savedKey && event.key !== null) return;
  try { renderSaved(); }
  catch { status('saved-status', '当前浏览器无法读取已保存的订阅', true); }
});

$('rules').onchange = async () => {
  status('rules-status', '');
  renderOutput();
  if ($('rules').value !== 'acl' || preset) return;
  status('rules-status', '正在加载规则…');
  rulesRequest ||= fetch(new URL('acl4ssr-mini.json', import.meta.url)).then(response => {
    if (!response.ok) throw new Error();
    return response.json();
  });
  try {
    preset = await rulesRequest;
    if ($('rules').value === 'acl') status('rules-status', '规则已加载');
    renderOutput();
  } catch {
    rulesRequest = undefined;
    if ($('rules').value !== 'acl') return;
    $('rules').value = 'standard';
    renderOutput();
    status('rules-status', '未能加载规则，已恢复基础分流', true);
  }
};

$('format').onchange = refresh;
$('prefix').oninput = refresh;
$('split').onchange = renderOutput;
$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('result').value);
    status('export-status', '已复制');
  } catch {
    status('export-status', '复制失败，请下载文件或手动选中预览内容', true);
  }
};
$('download').onclick = () => {
  const [name] = formats[$('format').value];
  const url = URL.createObjectURL(new Blob([$('result').value], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};

refresh();
const workspace = document.querySelector('.subscription-grid');
workspace.inert = false;
workspace.removeAttribute('aria-busy');
