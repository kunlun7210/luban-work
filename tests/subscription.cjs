const assert = require('node:assert/strict');
const engine = require('../tools/subscriptions');
const yaml = require('../tools/vendor/js-yaml.umd.min.js');

async function run() {
  globalThis.jsyaml = yaml;
  const { readSubscription, exportNodes } = await import('../tool/subscription-converter/converter.mjs');
  const input = `
defaults: &ss { type: ss, port: 443, cipher: aes-128-gcm, password: 00123, udp: true }
proxies:
  - { <<: *ss, name: 中文节点, server: "2001:db8::1" }
  - { <<: *ss, name: 中文节点, server: ss.example.com, udp: false }
  - { type: trojan, name: Proxy, server: trojan.example.com, port: 443, password: "a,b", sni: cdn.example.com }
  - { type: vless, name: Reality, server: reality.example.com, port: 443, uuid: 12345678-1234-4123-8123-123456789abc, tls: true, flow: xtls-rprx-vision, servername: example.com, reality-opts: { public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA, short-id: 0012 } }
  - { type: hysteria2, name: HY2, server: quic.example.com, port: 443, password: password, sni: example.com, obfs: salamander, obfs-password: demo }
  - { type: anytls, name: AnyTLS, server: tls.example.com, port: 443, password: only-test }
  - { <<: *ss, name: Invalid, server: ss.example.com, port: 99999 }
  - { <<: *ss, name: Chained, server: ss.example.com, dialer-proxy: Proxy }
`;
  const rows = readSubscription(input, engine);
  const convert = (format, settings = {}) => exportNodes(rows, { format, ...settings }, engine);
  const config = yaml.load(convert('clash', { split: true }).text);
  assert.equal(config.proxies.length, 6);
  assert.equal(config.proxies[0].password, '00123');
  assert.equal(config.proxies[0].udp, true);
  assert.equal(config.proxies[1].udp, false);
  assert.equal(config.proxies[1].name, '中文节点 (2)');
  assert.equal(config.proxies[3]['reality-opts']['short-id'], '0012');
  assert.equal(config.proxies[3].port, 443);
  assert.equal(config['proxy-groups'][0].name, 'Proxy-Group');
  assert.ok(config.rules.includes('DOMAIN-SUFFIX,cn,DIRECT'));
  assert.ok(config.rules.includes('GEOIP,CN,DIRECT,no-resolve'));
  assert.equal(config.rules.at(-1), 'MATCH,Proxy-Group');
  assert.deepEqual(Object.keys(yaml.load(convert('provider').text)), ['proxies']);
  assert.equal(convert('surge').ok, 4);
  assert.match(convert('surge').text, /password="a,b"/);
  assert.match(convert('surge').text, /salamander-password=demo/);
  assert.match(convert('loon').text, /Reality = VLESS,.*public-key=.+short-id=0012, flow=xtls-rprx-vision/);
  assert.match(convert('quanx').text, /^vless=.*reality-base64-pubkey=.*vless-flow=xtls-rprx-vision/m);
  assert.equal(convert('quanx').ok, 4);
  const links = convert('links', { selected: new Set([0, 3, 5]), prefix: 'Test-' });
  assert.equal(links.ok, 3);
  const imported = readSubscription(engine.b64utf8(links.text), engine);
  assert.deepEqual(imported.map(row => row.label), ['Test-中文节点', 'Test-Reality', 'Test-AnyTLS']);
  assert.equal(imported[0].node.server, '2001:db8::1');
  assert.equal(imported[2].node.password, 'only-test');
  assert.match(readSubscription('https://example.com/sub?token=private', engine)[0].error, /读取订阅网址/);
  assert.equal(readSubscription('https://example.com:443#HTTP', engine)[0].node.tls, true);
  assert.throws(() => readSubscription('proxy-providers: {source: {type: http}}', engine), /外部节点源/);
  const cyclic = readSubscription('proxies: [&a {type: ss, server: a.test, port: 443, cipher: aes-128-gcm, password: x, extra: *a}]', engine);
  assert.match(cyclic[0].error, /嵌套/);
  if (process.env.SUBSCRIPTION_TEST_CONFIG) require('node:fs').writeFileSync(process.env.SUBSCRIPTION_TEST_CONFIG, yaml.dump(config));
  console.log('Subscription format, compatibility, selection, and round-trip checks passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
