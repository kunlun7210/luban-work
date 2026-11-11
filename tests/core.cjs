const assert = require('node:assert/strict');
const { BitMatrix, BitArray, Code128Reader, Code39Reader, EAN13Reader } = require('@zxing/library');
const Decoder = require('@zxing/library/cjs/core/qrcode/decoder/Decoder').default;
const { qrEncode, barcodeEncode } = require('../tools/codes');
const clash = require('../tools/subscriptions');

function scanQR(content, level, version) {
  const symbol = qrEncode(content, level, version);
  const matrix = new BitMatrix(symbol.size);
  for (let y = 0; y < symbol.size; y++) {
    for (let x = 0; x < symbol.size; x++) if (symbol.modules[y][x]) matrix.set(x, y);
  }
  assert.equal(new Decoder().decodeBitMatrix(matrix).getText(), content);
}

for (let version = 1; version <= 40; version++) {
  for (const level of 'LMQH') scanQR('A123', level, version);
}
scanQR('遮图 · Zhetu 😄', 'Q');
scanQR('https://example.test/?q=' + '中文'.repeat(130), 'H');
assert.throws(() => qrEncode('中文'.repeat(1000), 'H'), /过长/);

const barcodes = [
  ['CODE128', '  ABC-123  ', '  ABC-123  ', new Code128Reader()],
  ['CODE128', '0098123456', '0098123456', new Code128Reader()],
  ['EAN13', '590123412345', '5901234123457', new EAN13Reader()],
  ['CODE39', 'luban-39 /+', 'LUBAN-39 /+', new Code39Reader()],
];
for (const [type, input, expected, reader] of barcodes) {
  const bar = barcodeEncode(input, type);
  const modules = [...Array(bar.quietLeft).fill(0), ...bar.bits, ...Array(bar.quietRight).fill(0)];
  const row = new BitArray(modules.length * 3);
  modules.forEach((dark, i) => {
    if (dark) for (let x = i * 3; x < i * 3 + 3; x++) row.set(x);
  });
  assert.equal(reader.decodeRow(0, row).getText(), expected);
}
assert.throws(() => barcodeEncode('x590123412345', 'EAN13'), /数字/);
assert.throws(() => barcodeEncode('5901234123458', 'EAN13'), /校验位/);
assert.throws(() => barcodeEncode('A*B', 'CODE39'), /仅支持/);

const forward = clash.convert(`
base: &base {type: ss, port: 443, cipher: aes-256-gcm, password: 00123}
proxies:
  - {<<: *base, name: "中文节点", server: "2001:db8::1"}
  - {type: ss, name: SS2022, server: example.test, port: 443, cipher: 2022-blake3-aes-128-gcm, password: 'abc+/='}
  - {type: hysteria2, name: HY2, server: example.test, port: 443, ports: "5000-6000", up: 20, down: 50, password: 'a@b#c'}
  - {type: vless, name: WS, server: example.test, port: 443, tls: true, uuid: 12345678-1234-4123-8123-123456789abc, network: ws, ws-opts: {path: "/a?x=1", headers: {Host: cdn.example.test}, max-early-data: 2048, early-data-header-name: Sec-WebSocket-Protocol}}
  - {type: socks5, name: broken, server: example.test, port: 443junk}
  - {<<: *base, name: unsupported-plugin, server: example.test, plugin: unknown}
  - invalid
`);
assert.equal(forward.ok, 4);
assert.equal(forward.skipped.length, 3);
assert.match(forward.uris[0], /@\[2001:db8::1\]:443/);
assert.match(forward.uris[1], /^ss:\/\/2022-blake3-aes-128-gcm:abc%2B%2F%3D@/);
assert.match(forward.uris[2], /mport=5000-6000&upmbps=20&downmbps=50/);
const reverse = clash.urisToYaml(forward.encoded);
assert.equal(reverse.ok, 4);
const parsed = clash.parseYAML(reverse.yaml).proxies;
assert.equal(parsed[0].password, '00123');
assert.equal(parsed[0].server, '2001:db8::1');
assert.equal(parsed[1].password, 'abc+/=');
assert.equal(parsed[2].password, 'a@b#c');
assert.equal(parsed[2].ports, '5000-6000');
assert.equal(parsed[3]['ws-opts']['max-early-data'], '2048');
assert.equal(parsed[3]['ws-opts'].path, '/a?x=1');
const invalid = clash.urisToYaml('# comment\ntrojan://a@example.test:99999#bad\nunknown://1\nvmess://abc');
assert.equal(invalid.skipped.length, 3);
assert.equal(invalid.text, '');
const names = clash.urisToYaml('socks5://example.test:1080#Proxy\nsocks5://example.test:1081#Proxy\nsocks5://example.test:1082#DIRECT');
assert.deepEqual(names.nodes.map(n => n.name), ['Proxy', 'Proxy (2)', 'DIRECT (2)']);
assert.equal(clash.parseYAML(names.yaml)['proxy-groups'][0].name, 'Proxy-Group');
assert.throws(() => clash.parseYAML('secret: fake-password\nsecret: another'), error => !error.message.includes('fake-password') && /YAML/.test(error.message));
console.log('162 QR round trips, all 3 barcode formats, and subscription fixtures passed.');
