const prefix = 'luban-work-shell-';
const cacheName = prefix + 'v1';
const scope = self.registration.scope;
const assets = [
  './', 'index.html', 'register.js', 'tools/', 'tools/index.html', 'tools/styles.css',
  'tools/codes.js', 'tools/subscriptions.js', 'tools/app.js', 'tools/vendor/js-yaml.umd.min.js',
].map(path => new URL(path, scope).href);
const assetSet = new Set(assets);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache =>
    cache.addAll(assets.map(url => new Request(url, { cache: 'reload' })))));
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
    if (url.href === new URL('tools', scope).href) url.pathname += '/';
  }
  if (!assetSet.has(url.href)) return;
  event.respondWith(caches.open(cacheName).then(async cache => await cache.match(url.href) || fetch(request)));
});
