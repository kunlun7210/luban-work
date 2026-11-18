const prefix = 'luban-work-shell-';
const cacheName = prefix + 'v8';
const scope = self.registration.scope;
const assets = [
  './', 'index.html', 'register.js', 'assets/site.css', 'assets/home.mjs',
  'assets/catalog.json', 'assets/toolbox-classic.svg', 'tools/', 'tools/index.html', 'tools/styles.css',
  'tools/pdf/', 'tools/pdf/index.html', 'tools/pdf/pdf.css', 'tools/pdf/pdf.js', 'tools/pdf/pdf-worker.js',
  'tools/codes.js', 'tools/subscriptions.js', 'tools/app.js', 'tools/vendor/js-yaml.umd.min.js',
  'tool/subscription-converter/', 'tool/subscription-converter/index.html',
  'tool/subscription-converter/subscription.css', 'tool/subscription-converter/subscription.mjs',
  'tool/subscription-converter/rules.mjs', 'tool/subscription-converter/acl4ssr-presets.json',
  'tool/subscription-converter/ACL4SSR-NOTICE.txt', 'tool/subscription-converter/converter.mjs', 'tool/subscription-converter/TOWER-LICENSE.txt',
].map(path => new URL(path, scope).href);
const assetSet = new Set(assets);
const pdfEngine = new Set(['qpdf.js', 'qpdf.wasm'].map(
  file => new URL('tools/pdf/vendor/qpdf-wasm-0.3.1/' + file, scope).href,
));
const directoryRoutes = new Set(['tools', 'tools/pdf', 'tool/subscription-converter'].map(path => new URL(path, scope).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(assets.map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  url.hash = '';
  if (request.mode === 'navigate') {
    url.search = '';
    if (directoryRoutes.has(url.href)) url.pathname += '/';
  }
  if (!assetSet.has(url.href) && !pdfEngine.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(url.href);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && pdfEngine.has(url.href)) {
      try {
        await cache.put(url.href, response.clone());
      } catch {
        // The PDF engine can still run if storage is unavailable.
      }
    }
    return response;
  })());
});
