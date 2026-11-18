// Client syntax adapted from Tower's ConfigurationGenerator.swift (MIT).
// https://github.com/pengchujin/tower/tree/873f854
export const maxBytes = 8 * 1024 * 1024;
const maxNodes = 5000;
const own = (object, key) => Object.hasOwn(object, key);
const fail = message => { throw new Error(message); };
const enabled = value => /^(true|1)$/i.test(String(value));
const uriPattern = /^[a-z][a-z0-9+.-]*:\/\//i;
const reserved = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL'];
const aliases = { socks: 'socks5', hy2: 'hysteria2' };

const numericKeys = new Set(['port', 'alterId', 'alterid', 'version', 'mtu', 'amnezia-junk-packet-count',
  'max-early-data', 'hop-interval', 'heartbeat-interval', 'request-timeout', 'idle-session-timeout',
  'min-idle-session', 'persistent-keepalive', 'reserved']);
const booleanKeys = new Set(['udp', 'tfo', 'tls', 'skip-cert-verify', 'fast-open', 'reduce-rtt',
  'udp-over-tcp', 'disable-sni', 'remote-dns-resolve', 'mptcp', 'h3', 'lazy', 'v2ray-http-upgrade',
  'v2ray-http-upgrade-fast-open', 'packet-addr', 'xudp']);

function typed(value, key, budget, depth = 0) {
  if (--budget.left < 0 || depth > 40) fail('节点参数嵌套或展开后过大');
  // Preserve credentials and identifiers, such as a password of 00123 or a Reality short ID.
  if (Array.isArray(value)) return value.map(item => typed(item, key, budget, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [name, typed(item, name, budget, depth + 1)]),
  );
  if (numericKeys.has(key) && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
  if (booleanKeys.has(key) && /^(?:true|false|[01])$/i.test(value)) return enabled(value);
  return value;
}

function safeHost(value) {
  const host = String(value ?? '');
  if (!host || /[\s/@?#%\\,="]/.test(host)) fail('服务器地址格式错误');
  try {
    const url = new URL('http://' + (host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host));
    if (url.port || !url.hostname || (host.includes(':') && !url.hostname.startsWith('['))) throw new Error();
    return url.hostname.replace(/^\[|\]$/g, '');
  } catch { fail('服务器地址格式错误'); }
}

function canonical(raw, index, budget) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('节点格式错误');
  const type = String(raw.type ?? '').toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(type)) fail('缺少有效协议类型');
  const port = Number(raw.port);
  if (!/^\d{1,5}$/.test(String(raw.port)) || port < 1 || port > 65535) fail('端口应为 1–65535');
  const name = typeof raw.name === 'string' ? raw.name.trim().replace(/[\r\n\t]+/g, ' ') : '';
  const node = { ...typed(raw, '', budget), name: name || '节点 ' + (index + 1),
    type: own(aliases, type) ? aliases[type] : type, server: safeHost(raw.server ?? raw.address), port };
  if (['vmess', 'vless', 'tuic'].includes(node.type) && !node.uuid) fail('缺少 UUID');
  if (['ss', 'ssr', 'trojan', 'hysteria2', 'anytls'].includes(node.type) && !(node.password || node.auth)) fail('缺少密码');
  if (node.type === 'hysteria2' && node.obfs === 'salamander' && !node['obfs-password']) fail('缺少 Salamander 混淆密码');
  if (['hysteria2', 'anytls'].includes(node.type) && !node.password && node.auth) node.password = node.auth;
  if (['ss', 'ssr'].includes(node.type) && !node.cipher) fail('缺少加密方式');
  if (node.type === 'snell' && !node.psk) fail('缺少 PSK');
  if (node['reality-opts'] && !node['reality-opts']['public-key']) fail('缺少 Reality 公钥');
  return node;
}

function fromURI(line, engine) {
  if (/^anytls:\/\//i.test(line)) {
    const url = new URL(line);
    const query = url.searchParams;
    if ([...query.keys()].some(key => !['sni', 'insecure', 'allowInsecure', 'alpn', 'fp'].includes(key))) fail('AnyTLS 链接含未知参数');
    return {
      name: decodeURIComponent(url.hash.slice(1)), type: 'anytls', server: url.hostname, port: url.port,
      password: decodeURIComponent(url.username), sni: query.get('sni') || undefined,
      'skip-cert-verify': enabled(query.get('insecure') ?? query.get('allowInsecure')),
      alpn: query.has('alpn') ? query.get('alpn').split(',') : undefined,
      'client-fingerprint': query.get('fp') || undefined,
    };
  }
  if (/^https?:\/\//i.test(line)) {
    const url = new URL(line);
    const hasPort = /^https?:\/\/[^/?#]+:\d+(?:[/?#]|$)/i.test(line);
    if (!hasPort || (url.pathname && url.pathname !== '/') || url.search) fail('这是订阅地址，请用「读取订阅网址」');
  }
  const node = engine.uriToNode(line);
  if (node.type === 'vless') {
    const params = new URL(line).searchParams;
    if (params.get('encryption') && params.get('encryption') !== 'none') {
      fail('暂不支持此 VLESS 加密方式');
    }
  }
  return node;
}

export function readSubscription(input, engine) {
  let text = input.trim().replace(/^\uFEFF/, '');
  if (!text) fail('请先粘贴内容或选择文件');
  if (new TextEncoder().encode(text).length > maxBytes) fail('内容超过 8 MB');
  if (/^[a-z0-9+/_=\s-]+$/i.test(text) && text.length >= 16) {
    try {
      const decoded = engine.base64DecodeToString(text).trim();
      if (uriPattern.test(decoded) || /(?:^|\n)\s*(?:proxies:|[a-z][a-z0-9+.-]*:\/\/)/i.test(decoded)) text = decoded;
    } catch { /* Continue with the original input. */ }
  }
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^(#|\/\/)/.test(line));
  const linkInput = lines.some(line => uriPattern.test(line));
  let entries = lines;
  if (!linkInput) {
    const document = engine.parseYAML(text);
    const keys = ['proxies', 'proxy', 'Proxy', 'Proxies'];
    entries = Array.isArray(document) ? document : keys.map(key => document?.[key]).find(Array.isArray);
    if (!entries) fail(document?.['proxy-providers'] ? '配置只引用了外部节点源，请导入节点源本身的 YAML 或订阅内容'
      : '未识别到 Clash 节点列表、明文分享链接或 Base64 订阅');
  }
  if (!entries.length) fail('没有可转换的节点');
  if (entries.length > maxNodes) fail('单次最多处理 5000 个节点');
  const budget = { left: 400000 };
  return entries.map((entry, index) => {
    try {
      const node = canonical(linkInput ? fromURI(entry, engine) : entry, index, budget);
      return { id: index, label: node.name, type: node.type, node };
    } catch (error) {
      return { id: index, label: '条目 ' + (index + 1),
        error: error instanceof TypeError || error instanceof SyntaxError || error instanceof URIError
          ? '节点地址、格式或编码错误' : error.message };
    }
  });
}

const clientTypes = {
  surge: ['ss', 'trojan', 'hysteria2', 'snell', 'socks5', 'http'],
  loon: ['ss', 'ssr', 'vmess', 'vless', 'trojan', 'hysteria2', 'anytls', 'socks5', 'http'],
  quanx: ['ss', 'ssr', 'vmess', 'vless', 'trojan', 'socks5', 'http'],
};

function conf(value) {
  const text = String(value);
  if (/[\u0000-\u001f\u007f]/.test(text)) fail('字段含控制字符');
  return /[\s,="'#;\\]/.test(text) ? JSON.stringify(text) : text;
}

function shareLink(node, engine) {
  if (node.type !== 'anytls') {
    const uri = engine.nodeToUri(node);
    if (!uri) fail('小火箭链接暂不支持该协议');
    return uri;
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ sni: node.sni || node.servername, insecure: node['skip-cert-verify'] ? '1' : '',
    alpn: node.alpn?.toString(), fp: node['client-fingerprint'] })) {
    if (value) query.set(key, value);
  }
  const host = node.server.includes(':') ? '[' + node.server + ']' : node.server;
  return 'anytls://' + encodeURIComponent(node.password) + '@' + host + ':' + node.port
    + (query.size ? '?' + query : '') + '#' + encodeURIComponent(node.name);
}

function clientLine(node, target) {
  const type = node.type;
  if (!clientTypes[target].includes(type)) fail('所选客户端的节点导出不支持此协议');
  const isLoon = target === 'loon';
  const isQX = target === 'quanx';
  const host = node.server.includes(':') ? '[' + node.server + ']' : node.server;
  const endpoint = isQX ? [host + ':' + node.port] : [host, node.port];
  const options = [];
  const add = (key, value) => {
    if (value !== undefined && value !== null && value !== '') options.push(key + '=' + conf(value));
  };
  const sni = node.sni || node.servername;
  const tls = Boolean(node.tls || node['reality-opts'] || ['trojan', 'hysteria2', 'anytls'].includes(type));
  const network = node.network || 'tcp';
  const ws = node['ws-opts'];
  const reality = node['reality-opts'];
  const fingerprint = node['client-fingerprint'];
  const realityProfile = { chrome: 'chrome', safari: 'safari-ios18', ios: 'safari-ios18' };
  const canSetReality = type === 'vless' && reality && (isLoon || isQX)
    && (!fingerprint || (isLoon && own(realityProfile, fingerprint)));
  if (node['dialer-proxy'] || ((reality || fingerprint || node.flow) && !canSetReality)
      || node.smux || node['udp-over-tcp'] || node.fingerprint || node['disable-sni']
      || node['packet-encoding'] || (node.encryption && node.encryption !== 'none') ||
      node['servername'] && node.sni && node.servername !== node.sni) fail('节点包含此目标暂无法保留的高级参数');
  if (network !== 'tcp' && (network !== 'ws' || !['vmess', 'vless', 'trojan'].includes(type))) fail('所选目标暂不支持此传输方式');
  if (ws && (ws['max-early-data'] || ws['early-data-header-name'] || Object.keys(ws.headers || {}).some(key => key.toLowerCase() !== 'host'))) {
    fail('所选目标暂无法保留 WebSocket 早期数据或自定义请求头');
  }
  if (node.alpn?.length) fail('此目标暂无法保留节点的自定义 ALPN');
  let scheme = type;
  if (type === 'ss' || type === 'ssr') {
    if (!['aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305',
      ...(type === 'ssr' ? ['aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb', 'chacha20-ietf'] : [])].includes(node.cipher)) {
      fail('此目标暂不输出该加密方式');
    }
    scheme = isLoon ? (type === 'ss' ? 'Shadowsocks' : 'ShadowsocksR') : isQX ? 'shadowsocks' : 'ss';
    if (isLoon) endpoint.push(node.cipher, conf(node.password));
    else {
      add(isQX ? 'method' : 'encrypt-method', node.cipher);
      add('password', node.password);
    }
    if (type === 'ssr') {
      add(isQX ? 'ssr-protocol' : 'protocol', node.protocol || 'origin');
      add(isQX ? 'ssr-protocol-param' : 'protocol-param', node['protocol-param']);
      add('obfs', node.obfs || 'plain');
      add(isQX ? 'obfs-host' : 'obfs-param', node['obfs-param']);
    } else if (node.plugin) {
      if (!['obfs', 'simple-obfs'].includes(node.plugin) || !['http', 'tls'].includes(node['plugin-opts']?.mode)) {
        fail('此目标暂不支持该 Shadowsocks 插件');
      }
      add(isLoon ? 'obfs-name' : 'obfs', node['plugin-opts'].mode);
      add('obfs-host', node['plugin-opts'].host);
    }
    if (tls) fail('此目标暂无法保留 Shadowsocks 的独立 TLS 设置');
  } else if (type === 'vmess' || type === 'vless') {
    if (Number(node.alterId ?? node.alterid ?? 0) !== 0) fail('此目标暂不支持非零 VMess Alter ID');
    if (isLoon) {
      scheme = type === 'vmess' ? 'VMess' : 'VLESS';
      if (type === 'vmess') endpoint.push(node.cipher || 'auto');
      endpoint.push(conf(node.uuid));
      add('over-tls', tls);
      if (network === 'tcp') add('transport', 'tcp');
      if (type === 'vmess') add('alterId', 0);
    } else {
      add('method', type === 'vless' ? 'none' : node.cipher === 'chacha20-poly1305' ? 'chacha20-ietf-poly1305' : 'aes-128-gcm');
      if (type === 'vmess' && node.cipher && !['auto', 'aes-128-gcm', 'chacha20-poly1305'].includes(node.cipher)) fail('此目标暂不支持该 VMess 加密方式');
      add('password', node.uuid);
    }
  } else if (['trojan', 'hysteria2', 'anytls'].includes(type)) {
    if (isLoon) endpoint.push(conf(node.password || node.auth));
    else add('password', node.password || node.auth);
    if (type === 'hysteria2') {
      if (node.ports || node.up || node.down) fail('此目标暂无法保留跳跃端口或限速参数');
      if (node.obfs && node.obfs !== 'salamander') fail('此目标暂不支持该混淆方式');
      add('salamander-password', node['obfs-password']);
    }
  } else if (type === 'snell') {
    add('psk', node.psk);
    add('version', node.version || 4);
    add('obfs', node['obfs-opts']?.mode);
    add('obfs-host', node['obfs-opts']?.host);
  } else {
    if (tls && !isQX && (!isLoon || type === 'http')) scheme = type === 'http' ? 'https' : 'socks5-tls';
    if (isLoon && (node.username || node.password)) endpoint.push(node.username ? conf(node.username) : '""', JSON.stringify(String(node.password || '')));
    else {
      add('username', node.username);
      add('password', node.password);
    }
  }
  const wsHost = ws?.headers?.Host || ws?.headers?.host;
  if (isQX && network === 'ws') {
    if (sni && sni !== wsHost) fail('此目标暂无法同时保留不同的 SNI 和 WebSocket Host');
    add('obfs', tls ? 'wss' : 'ws');
    add('obfs-host', wsHost || sni);
    add('obfs-uri', ws?.path || '/');
  } else if (network === 'ws') {
    add(isLoon ? 'transport' : 'ws', isLoon ? 'ws' : true);
    add(isLoon ? 'path' : 'ws-path', ws?.path || '/');
    if (wsHost && !isLoon) add('ws-headers', 'Host:' + wsHost);
    if (isLoon) add('host', wsHost);
  }
  if (tls) {
    if (isQX && network !== 'ws') {
      const obfsTLS = type === 'vmess' || type === 'vless';
      add(obfsTLS ? 'obfs' : 'over-tls', obfsTLS ? 'over-tls' : true);
      add(obfsTLS ? 'obfs-host' : 'tls-host', sni);
    } else if (!isQX) {
      if (isLoon && type === 'socks5') add('over-tls', true);
      add(isLoon && !['socks5', 'http'].includes(type) ? 'tls-name' : 'sni', sni);
    }
    if (node['skip-cert-verify']) add(isQX ? 'tls-verification' : 'skip-cert-verify', !isQX);
  }
  if (node.udp !== undefined && type !== 'http') add(isLoon ? 'udp' : 'udp-relay', enabled(node.udp));
  if (canSetReality) {
    add(isLoon ? 'public-key' : 'reality-base64-pubkey', reality['public-key']);
    add(isLoon ? 'short-id' : 'reality-hex-shortid', reality['short-id']);
    if (isLoon && fingerprint) add('tls-profile', realityProfile[fingerprint]);
    add(isLoon ? 'flow' : 'vless-flow', node.flow === 'xtls-rprx-vision-udp443' && isQX ? 'xtls-rprx-vision' : node.flow);
  }
  if (node.tfo !== undefined && (isLoon || isQX)) add('fast-open', enabled(node.tfo));
  if (isQX) add('tag', node.name);
  return (isQX ? scheme + '=' : conf(node.name) + ' = ') + (isQX ? [] : [scheme]).concat(endpoint, options).join(', ');
}

const mihomoTypes = new Set(['ss', 'ssr', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2', 'tuic', 'snell',
  'socks5', 'http', 'anytls', 'wireguard', 'ssh']);
export function exportNodes(rows, options, engine) {
  const { format, prefix = '', selected, split } = options;
  const names = new Set(reserved);
  const results = [];
  const nodes = [], lines = [];
  for (const row of rows) {
    if (row.error) { results.push(row); continue; }
    if (selected && !selected.has(row.id)) continue;
    const base = prefix.trim() + row.node.name;
    let name = base;
    for (let next = 2; names.has(name); next++) name = base + ' (' + next + ')';
    const node = { ...row.node, name };
    try {
      if (format === 'clash' || format === 'provider') {
        if (!mihomoTypes.has(node.type)) fail('暂未验证该协议的 Mihomo 配置');
        if (node['dialer-proxy']) fail('该节点依赖原配置中的链式代理，请保留原配置使用');
      } else if (format === 'links' || format === 'base64') {
        if (node['dialer-proxy'] || node.smux || node.fingerprint || node['packet-encoding'] ||
            (node.encryption && node.encryption !== 'none') ||
            (['http', 'socks5'].includes(node.type) && (node['skip-cert-verify'] || node.sni || node.servername || node.alpn?.length || (node.type === 'socks5' && node.tls)))) {
          fail('分享链接暂无法保留该节点的高级参数');
        }
        lines.push(shareLink(node, engine));
      } else {
        lines.push(clientLine(node, format));
      }
      names.add(name);
      nodes.push(node);
      results.push({ ...row, label: name });
    } catch (error) { results.push({ ...row, label: name, error: error.message }); }
  }

  let text = '';
  if (nodes.length && (format === 'clash' || format === 'provider')) {
    const config = engine.nodesToConfig(nodes, { fullConfig: format === 'clash' });
    if (format === 'clash') {
      if (split) config.rules.unshift(
        'DOMAIN-SUFFIX,local,DIRECT', 'DOMAIN-SUFFIX,lan,DIRECT', 'DOMAIN-SUFFIX,cn,DIRECT',
        'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve', 'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
        'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve', 'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
        'IP-CIDR,169.254.0.0/16,DIRECT,no-resolve', 'IP-CIDR6,::1/128,DIRECT,no-resolve',
        'IP-CIDR6,fc00::/7,DIRECT,no-resolve', 'IP-CIDR6,fe80::/10,DIRECT,no-resolve', 'GEOIP,CN,DIRECT,no-resolve',
      );
    }
    text = globalThis.jsyaml.dump(config, { noRefs: true, lineWidth: -1 });
  } else if (lines.length) {
    text = format === 'base64' ? engine.b64utf8(lines.join('\n')) : lines.join('\n') + '\n';
  }
  return { text, results, ok: nodes.length };
}
