/* ==========================================================================
   鲁班工具箱 — Clash YAML → Shadowrocket 订阅转换核心
   js-yaml 解析配置 + 多协议 URI 生成
   同时支持浏览器与 Node（回归测试用）
   ========================================================================== */
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports
    ? require('./vendor/js-yaml.umd.min.js') : root.jsyaml);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LubanClash = api;
}(typeof self !== 'undefined' ? self : this, function (yaml) {
  'use strict';

  /* ===================== 基础工具 ===================== */
  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          c = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
          i++;
        } else c = 0xFFFD;
      } else if (c >= 0xDC00 && c <= 0xDFFF) c = 0xFFFD;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  var B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(bytes) {
    var out = '', i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64CHARS[(n >> 18) & 63] + B64CHARS[(n >> 12) & 63] + B64CHARS[(n >> 6) & 63] + B64CHARS[n & 63];
    }
    var rem = bytes.length - i;
    if (rem === 1) {
      var n1 = bytes[i] << 16;
      out += B64CHARS[(n1 >> 18) & 63] + B64CHARS[(n1 >> 12) & 63] + '==';
    } else if (rem === 2) {
      var n2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64CHARS[(n2 >> 18) & 63] + B64CHARS[(n2 >> 12) & 63] + B64CHARS[(n2 >> 6) & 63] + '=';
    }
    return out;
  }
  function b64utf8(s) { return base64(utf8Bytes(String(s))); }
  // URL 安全变体：用于 URI userinfo 段，避免 / + = 破坏解析
  function b64url(s) { return b64utf8(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

  function qs(params) {
    var parts = [];
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      var v = params[k];
      if (v === undefined || v === null || v === '') continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  var MAX_INPUT = 8 * 1024 * 1024;
  var MAX_NODES = 5000;
  var yamlSchema = yaml.FAILSAFE_SCHEMA.withTags(yaml.mergeTag);

  function parseYAML(src) {
    if (new TextEncoder().encode(src).length > MAX_INPUT) throw new Error('内容超过 8 MB');
    try {
      // 保留 00123 等未加引号的凭据，不把它们转换成数字。
      return yaml.load(src, { schema: yamlSchema, maxDepth: 48, maxAliases: MAX_NODES });
    } catch (e) {
      // 解析器的原始错误可包含完整的订阅凭据。
      var line = e.mark && e.mark.line;
      throw new Error('YAML 格式错误' + (Number.isInteger(line) ? '（第 ' + (line + 1) + ' 行）' : ''));
    }
  }

  /* ===================== 协议映射 ===================== */
  function pickName(p, i) {
    var n = typeof p.name === 'string' || typeof p.name === 'number' ? String(p.name) : '';
    return n || ('节点 ' + (i + 1));
  }

  function hostOf(p) {
    var raw = String(p.server ?? p.address ?? '');
    if (!raw || /[\s/@?#%\\]/.test(raw)) throw new Error('缺少 server 或地址格式错误');
    var host = raw.includes(':') && !raw.startsWith('[') ? '[' + raw + ']' : raw;
    try {
      var parsed = new URL('http://' + host);
      if (!parsed.hostname || parsed.port || parsed.username || parsed.password) throw new Error();
      return parsed.hostname;
    } catch (e) {
      throw new Error('server 地址格式错误');
    }
  }

  function portOf(p) {
    var v = String(p.port ?? '');
    var n = Number(v);
    if (!/^\d{1,5}$/.test(v) || n < 1 || n > 65535) throw new Error('port 应为 1–65535 的整数');
    return n;
  }

  function normalizePortRanges(value) {
    var ranges = String(value).split(',').map(function (r) { return r.trim().replace(':', '-'); });
    ranges.forEach(function (range) {
      if (!/^\d{1,5}(-\d{1,5})?$/.test(range)) throw new Error('端口范围格式错误');
      var ports = range.split('-').map(function (port) { return portOf({ port: port }); });
      if (ports.length > 1 && ports[0] > ports[1]) throw new Error('端口范围格式错误');
    });
    return ranges.join(',');
  }

  function boolOf(v) { return /^(true|1)$/i.test(String(v)); }

  function checkTransport(value) {
    var net = String(value || 'tcp').toLowerCase();
    if (!['tcp', 'ws', 'grpc', 'h2', 'http'].includes(net)) throw new Error('暂不支持此传输方式');
    return net;
  }

  function setTransport(node, net, path, host, serviceName, ed, eh) {
    node.network = net;
    if (net === 'ws') {
      node['ws-opts'] = { path: path || '/' };
      if (host) node['ws-opts'].headers = { Host: host };
      if (ed) node['ws-opts']['max-early-data'] = Number(ed);
      if (eh) node['ws-opts']['early-data-header-name'] = eh;
    } else if (net === 'grpc') {
      node['grpc-opts'] = { 'grpc-service-name': serviceName || '' };
    } else if (net === 'h2') {
      node['h2-opts'] = { path: path || '/' };
      if (host) node['h2-opts'].host = [host];
    } else if (net === 'http') {
      node['http-opts'] = { path: [path || '/'] };
      if (host) node['http-opts'].headers = { Host: [host] };
    }
  }

  // 传输层（ws / grpc / h2 / http）公共参数
  function transportOf(p) {
    var net = checkTransport(p.network);
    var out = { type: net };
    if (net === 'ws') {
      var ws = p['ws-opts'] || p['ws-opts-extra'] || {};
      out.path = ws.path || '/';
      if (ws.headers && (ws.headers.Host || ws.headers.host)) out.host = ws.headers.Host || ws.headers.host;
      if (ws['max-early-data']) out.ed = ws['max-early-data'];
      if (ws['early-data-header-name']) out.eh = ws['early-data-header-name'];
    } else if (net === 'grpc') {
      var g = p['grpc-opts'] || {};
      out.serviceName = g['grpc-service-name'] || '';
    } else if (net === 'h2') {
      var h2 = p['h2-opts'] || {};
      out.path = h2.path || '/';
      if (h2.host && h2.host.length) out.host = Array.isArray(h2.host) ? h2.host[0] : h2.host;
    } else if (net === 'http') {
      var h = p['http-opts'] || {};
      out.path = (Array.isArray(h.path) ? h.path[0] : h.path) || '/';
      if (h.headers && h.headers.Host) out.host = Array.isArray(h.headers.Host) ? h.headers.Host[0] : h.headers.Host;
    }
    return out;
  }

  function sniOf(p) {
    return p.servername || p.sni || (p['ws-opts'] && p['ws-opts'].headers && (p['ws-opts'].headers.Host || p['ws-opts'].headers.host)) || '';
  }

  function nodeToUri(p, index) {
    var type = String(p.type || '').toLowerCase();
    var name = pickName(p, index || 0);
    var host = hostOf(p);
    var port = portOf(p);
    var tag = '#' + encodeURIComponent(name);

    switch (type) {
      /* ---------- Shadowsocks ---------- */
      case 'ss': {
        var method = p.cipher || p.method;
        if (!method) throw new Error('缺少 cipher');
        var pass = p.password !== undefined ? String(p.password) : '';
        if (!pass) throw new Error('缺少 password');
        var q = {};
        if (p.plugin === 'obfs') {
          var o = p['plugin-opts'] || {};
          var seg = ['obfs-local', 'obfs=' + (o.mode || 'http')];
          if (o.host) seg.push('obfs-host=' + o.host);
          q.plugin = seg.join(';');
        } else if (p.plugin === 'v2ray-plugin') {
          var o2 = p['plugin-opts'] || {};
          var seg2 = ['v2ray-plugin'];
          if (o2.mode) seg2.push('mode=' + o2.mode);
          if (boolOf(o2.tls)) seg2.push('tls');
          if (o2.host) seg2.push('host=' + o2.host);
          if (o2.path) seg2.push('path=' + o2.path);
          q.plugin = seg2.join(';');
        } else if (p.plugin === 'shadow-tls') {
          var o3 = p['plugin-opts'] || {};
          var seg3 = ['shadow-tls'];
          if (o3.host) seg3.push('host=' + o3.host);
          if (o3.password) seg3.push('password=' + o3.password);
          if (o3.version) seg3.push('version=' + o3.version);
          q.plugin = seg3.join(';');
        } else if (p.plugin) {
          throw new Error('不支持的 Shadowsocks 插件');
        }
        var sipUser = /^2022-/.test(method)
          ? encodeURIComponent(method) + ':' + encodeURIComponent(pass)
          : b64url(method + ':' + pass);
        return 'ss://' + sipUser + '@' + host + ':' + port + (q.plugin ? '/' : '') + qs(q) + tag;
      }

      /* ---------- ShadowsocksR ---------- */
      case 'ssr': {
        if (host.startsWith('[')) throw new Error('SSR 链接不支持 IPv6');
        var m2 = p.cipher;
        if (!m2 || !p.password) throw new Error('缺少 cipher 或 password');
        var pw = p.password !== undefined ? String(p.password) : '';
        var proto = p.protocol || 'origin';
        var obfs = p.obfs || 'plain';
        var main = host + ':' + port + ':' + proto + ':' + m2 + ':' + obfs + ':' + b64url(pw) + '/';
        var prm = [];
        if (p['protocol-param']) prm.push('protoparam=' + b64url(p['protocol-param']));
        if (p['obfs-param']) prm.push('obfsparam=' + b64url(p['obfs-param']));
        prm.push('remarks=' + b64url(name));
        return 'ssr://' + b64url(main + '?' + prm.join('&'));
      }

      /* ---------- VMess ---------- */
      case 'vmess': {
        var net = transportOf(p);
        var tls = boolOf(p.tls);
        var vm = {
          v: '2',
          ps: name,
          add: host,
          port: String(port),
          id: p.uuid || p.id || '',
          aid: String(p.alterId !== undefined ? p.alterId : (p.alterid !== undefined ? p.alterid : 0)),
          scy: p.cipher || 'auto',
          net: net.type,
          type: 'none',
          host: net.host || '',
          path: net.path || '',
          tls: tls ? 'tls' : '',
          sni: sniOf(p),
          alpn: Array.isArray(p.alpn) ? p.alpn.join(',') : (p.alpn || ''),
          allowInsecure: boolOf(p['skip-cert-verify']) ? '1' : '0',
          ed: net.ed || '', eh: net.eh || '',
          fp: p['client-fingerprint'] || ''
        };
        if (!vm.id) throw new Error('缺少 uuid');
        if (net.type === 'grpc') { vm.path = net.serviceName || ''; }
        return 'vmess://' + b64utf8(JSON.stringify(vm));
      }

      /* ---------- VLESS ---------- */
      case 'vless': {
        var netl = transportOf(p);
        var sec = boolOf(p.tls) ? 'tls' : 'none';
        if (p.flow && String(p.flow).indexOf('reality') >= 0) sec = 'reality';
        if (p.reality || p['reality-opts']) sec = 'reality';
        var ql = {
          encryption: 'none',
          security: sec,
          sni: sniOf(p),
          fp: p['client-fingerprint'] || '',
          pbk: (p['reality-opts'] && p['reality-opts']['public-key']) || '',
          sid: (p['reality-opts'] && p['reality-opts']['short-id']) || '',
          type: netl.type,
          path: netl.path || '',
          ed: netl.ed || '', eh: netl.eh || '',
          host: netl.host || '',
          serviceName: netl.serviceName || '',
          flow: p.flow || '',
          alpn: Array.isArray(p.alpn) ? p.alpn.join(',') : (p.alpn || '')
        };
        if (sec === 'reality' && !ql.pbk) throw new Error('缺少 Reality 公钥');
        if (boolOf(p['skip-cert-verify'])) ql.allowInsecure = '1';
        if (!p.uuid) throw new Error('缺少 uuid');
        return 'vless://' + encodeURIComponent(p.uuid) + '@' + host + ':' + port + qs(ql) + tag;
      }

      /* ---------- Trojan ---------- */
      case 'trojan': {
        var nett = transportOf(p);
        var pass2 = p.password !== undefined ? String(p.password) : '';
        if (!pass2) throw new Error('缺少 password');
        var qt = {
          sni: sniOf(p),
          allowInsecure: boolOf(p['skip-cert-verify']) ? '1' : '0',
          type: nett.type,
          path: nett.path || '',
          ed: nett.ed || '', eh: nett.eh || '',
          host: nett.host || '',
          serviceName: nett.serviceName || '',
          alpn: Array.isArray(p.alpn) ? p.alpn.join(',') : (p.alpn || '')
        };
        return 'trojan://' + encodeURIComponent(pass2) + '@' + host + ':' + port + qs(qt) + tag;
      }

      /* ---------- Hysteria2 ---------- */
      case 'hysteria2':
      case 'hy2': {
        var pw3 = p.password !== undefined ? String(p.password) : (p.auth || '');
        if (!pw3) throw new Error('缺少 password / auth');
        var qh = {
          sni: sniOf(p),
          insecure: boolOf(p['skip-cert-verify']) ? '1' : '0',
          obfs: p.obfs || '',
          'obfs-password': p['obfs-password'] || '',
          alpn: Array.isArray(p.alpn) ? p.alpn.join(',') : (p.alpn || '')
        };
        if (p.ports) qh.mport = normalizePortRanges(p.ports);
        if (p.up) qh.upmbps = p.up;
        if (p.down) qh.downmbps = p.down;
        return 'hysteria2://' + encodeURIComponent(pw3) + '@' + host + ':' + port + qs(qh) + tag;
      }

      /* ---------- Hysteria (v1) ---------- */
      case 'hysteria': {
        var auth = p['auth-str'] || p['auth_str'] || p.auth || '';
        var qy = {
          auth: auth,
          sni: sniOf(p),
          insecure: boolOf(p['skip-cert-verify']) ? '1' : '0',
          protocol: p.protocol || 'udp',
          upmbps: p.up || '',
          downmbps: p.down || ''
        };
        return 'hysteria://' + host + ':' + port + qs(qy) + tag;
      }

      /* ---------- TUIC ---------- */
      case 'tuic': {
        var uu = p.uuid || '';
        var tp = p.password !== undefined ? String(p.password) : '';
        if (!uu) throw new Error('缺少 uuid');
        var qt2 = {
          sni: sniOf(p),
          alpn: Array.isArray(p.alpn) ? p.alpn.join(',') : (p.alpn || 'h3'),
          congestion_control: p['congestion-controller'] || p['congestion_control'] || 'bbr',
          udp_relay_mode: p['udp-relay-mode'] || 'native',
          allow_insecure: boolOf(p['skip-cert-verify']) ? '1' : '0'
        };
        return 'tuic://' + encodeURIComponent(uu) + ':' + encodeURIComponent(tp) + '@' + host + ':' + port + qs(qt2) + tag;
      }

      /* ---------- Snell ---------- */
      case 'snell': {
        var psk = p.psk !== undefined ? String(p.psk) : '';
        if (!psk) throw new Error('缺少 psk');
        var qs2 = {
          version: p.version || '4',
          obfs: p['obfs-opts'] && p['obfs-opts'].mode ? p['obfs-opts'].mode : '',
          'obfs-host': p['obfs-opts'] && p['obfs-opts'].host ? p['obfs-opts'].host : ''
        };
        return 'snell://' + encodeURIComponent(psk) + '@' + host + ':' + port + qs(qs2) + tag;
      }

      /* ---------- SOCKS5 / HTTP ---------- */
      case 'socks5':
      case 'socks': {
        var u1 = p.username || p['username'] || '';
        var p1 = p.password !== undefined ? String(p.password) : '';
        var cred = u1 ? encodeURIComponent(u1) + (p1 ? ':' + encodeURIComponent(p1) : '') + '@' : '';
        return 'socks5://' + cred + host + ':' + port + tag;
      }
      case 'http': {
        var u2 = p.username || '';
        var p2 = p.password !== undefined ? String(p.password) : '';
        var cred2 = u2 ? encodeURIComponent(u2) + (p2 ? ':' + encodeURIComponent(p2) : '') + '@' : '';
        var tls2 = boolOf(p.tls) ? 'https' : 'http';
        return tls2 + '://' + cred2 + host + ':' + port + tag;
      }

      default:
        return null;
    }
  }

  /* ===================== 主入口 ===================== */
  var SUPPORTED = ['ss', 'ssr', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2', 'hy2', 'tuic', 'snell', 'socks5', 'socks', 'http'];

  function extractProxies(doc) {
    if (!doc) return null;
    if (Array.isArray(doc)) return doc;
    var keys = ['proxies', 'proxy', 'Proxy', 'Proxies'];
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(doc[keys[i]])) return doc[keys[i]];
    }
    return null;
  }

  /**
   * @param {string} yamlText Clash 配置或订阅原文
   * @param {{base64?:boolean, namePrefix?:string, nameSuffix?:string}} opt
   */
  function convert(yamlText, opt) {
    opt = opt || {};
    var doc = parseYAML(yamlText);
    var proxies = extractProxies(doc);
    if (!proxies) {
      throw new Error('未找到 proxies 列表。请确认这是 Clash 配置或订阅文件（含 proxies: 字段）。');
    }
    if (!proxies.length) throw new Error('proxies 列表为空');
    if (proxies.length > MAX_NODES) throw new Error('单次最多转换 5000 个节点');

    var prefix = opt.namePrefix || '';
    var suffix = opt.nameSuffix || '';
    var uris = [], skipped = [], details = [], seen = {};
    for (var i = 0; i < proxies.length; i++) {
      var p = proxies[i];
      if (!p || typeof p !== 'object' || Array.isArray(p)) {
        var invalid = { name: '节点 ' + (i + 1), type: '-', skip: true, reason: '节点不是有效配置对象' };
        skipped.push(invalid);
        details.push(invalid);
        continue;
      }
      var baseName = pickName(p, i);
      var finalName = prefix + baseName + suffix;
      var type = typeof p.type === 'string' ? p.type : '?';
      try {
        var q = { ...p, name: finalName };
        var uri = nodeToUri(q, i);
        if (!uri) {
          skipped.push({ name: finalName, type: type, reason: '不支持的协议类型' });
          details.push({ name: finalName, type: type, skip: true, reason: '不支持的协议类型' });
          continue;
        }
        if (seen[uri]) {
          skipped.push({ name: finalName, type: type, reason: '与前面的节点重复' });
          details.push({ name: finalName, type: type, skip: true, reason: '重复节点' });
          continue;
        }
        seen[uri] = true;
        uris.push(uri);
        details.push({ name: finalName, type: type, skip: false, uri: uri });
      } catch (e) {
        var msg = e instanceof TypeError ? '节点字段类型错误' : (e.message || '转换失败');
        skipped.push({ name: finalName, type: type, reason: msg });
        details.push({ name: finalName, type: type, skip: true, reason: msg });
      }
    }

    var output = uris.join('\n');
    var encoded = opt.base64 === false ? output : b64utf8(output);

    return {
      total: proxies.length,
      ok: uris.length,
      skipped: skipped,
      details: details,
      uris: uris,
      plain: output,
      encoded: encoded,
      text: opt.base64 === false ? output : encoded
    };
  }

  /* ===================== 反向解析（自检用） ===================== */
  function base64DecodeToString(b64) {
    var clean = String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('Base64 格式错误');
    var binary = atob(clean);
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, function (c) { return c.charCodeAt(0); }));
  }

  /** 把 URI 拆成可用于断言的结构（独立实现，不复用生成侧逻辑） */
  function parseUri(uri) {
    var m = /^([a-z0-9+.-]+):\/\/([\s\S]*)$/i.exec(uri);
    if (!m) return null;
    var scheme = m[1].toLowerCase();
    var rest = m[2];
    var hashIdx = rest.lastIndexOf('#');
    var name = '';
    if (hashIdx >= 0) {
      name = decodeURIComponent(rest.slice(hashIdx + 1));
      rest = rest.slice(0, hashIdx);
    }
    var query = '';
    var qi = rest.indexOf('?');
    if (qi >= 0) { query = rest.slice(qi + 1); rest = rest.slice(0, qi); }
    var params = {};
    query.split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      params[decodeURIComponent(p[0])] = p.length > 1 ? decodeURIComponent(p.slice(1).join('=')) : '';
    });

    if (scheme === 'vmess') {
      var j = JSON.parse(base64DecodeToString(rest));
      return { scheme: scheme, name: name || j.ps, json: j, params: params };
    }
    if (scheme === 'ssr') {
      var dec = base64DecodeToString(rest);
      var parts = dec.split('/?');
      var main = parts[0].split(':');
      var q2 = {};
      (parts[1] || '').split('&').forEach(function (kv) {
        if (!kv) return;
        var p = kv.split('=');
        q2[p[0]] = base64DecodeToString(p[1] || '');
      });
      return { scheme: scheme, name: q2.remarks || name, host: main[0], port: +main[1], protocol: main[2], method: main[3], obfs: main[4], password: base64DecodeToString(main[5] || ''), params: q2 };
    }
    // 通用 userinfo@host:port
    var atIdx = rest.lastIndexOf('@');
    var cred = '', hostport = rest;
    if (atIdx >= 0) { cred = rest.slice(0, atIdx); hostport = rest.slice(atIdx + 1); }
    var hp = /^(.*):(\d+)$/.exec(hostport);
    return {
      scheme: scheme,
      name: name,
      cred: cred,
      credDecoded: (scheme === 'ss' || scheme === 'ssr') ? base64DecodeToString(cred) : decodeURIComponent(cred),
      host: hp ? hp[1] : hostport,
      port: hp ? +hp[2] : null,
      params: params
    };
  }

  /* ===================== 反向：URI → Clash 节点 ===================== */
  function splitHostPort(s) {
    var match = /^(\[[^\]]+\]|[^:/?#]+):(\d+)$/.exec(String(s).replace(/\/$/, ''));
    if (!match) throw new Error('链接缺少有效的地址或端口');
    return { host: hostOf({ server: match[1] }).replace(/^\[|\]$/g, ''), port: portOf({ port: match[2] }) };
  }

  function parseQuery(q) {
    return Object.assign(Object.create(null), Object.fromEntries(new URLSearchParams(q)));
  }

  function splitCommon(uri) {
    var rest = uri.slice(uri.indexOf('://') + 3);
    var name = '', query = '';
    var hi = rest.lastIndexOf('#');
    if (hi >= 0) {
      try { name = decodeURIComponent(rest.slice(hi + 1)); } catch (e) { name = rest.slice(hi + 1); }
      rest = rest.slice(0, hi);
    }
    var qi = rest.indexOf('?');
    if (qi >= 0) { query = rest.slice(qi + 1); rest = rest.slice(0, qi); }
    var at = rest.lastIndexOf('@');
    var cred = at >= 0 ? rest.slice(0, at) : '';
    var hostport = at >= 0 ? rest.slice(at + 1) : rest;
    var hp = splitHostPort(hostport);
    return { name: name, cred: cred, host: hp.host, port: hp.port, query: query, params: parseQuery(query) };
  }

  function truthy(v) { return v === '1' || v === 'true' || v === true; }

  /** 单条 URI → Clash 节点对象（失败抛错） */
  function uriToNode(uri) {
    var m = /^([a-z0-9+.-]+):\/\//i.exec(uri);
    if (!m) throw new Error('不是合法的分享链接');
    var scheme = m[1].toLowerCase();

    if (scheme === 'ss') {
      var body = uri.slice(5);
      var name0 = '';
      var hi = body.lastIndexOf('#');
      if (hi >= 0) { try { name0 = decodeURIComponent(body.slice(hi + 1)); } catch (e) { name0 = body.slice(hi + 1); } body = body.slice(0, hi); }
      var qs0 = '';
      var qi0 = body.indexOf('?');
      if (qi0 >= 0) { qs0 = body.slice(qi0 + 1); body = body.slice(0, qi0); }
      var at0 = body.lastIndexOf('@');
      var method, password, hostport;
      if (at0 >= 0) {
        var credRaw = body.slice(0, at0);
        hostport = body.slice(at0 + 1);
        var dec = credRaw.includes(':') ? decodeURIComponent(credRaw) : base64DecodeToString(credRaw);
        var ci = dec.indexOf(':');
        method = dec.slice(0, ci);
        password = dec.slice(ci + 1);
      } else {
        var full = base64DecodeToString(body);
        var at1 = full.lastIndexOf('@');
        if (at1 < 0) throw new Error('ss 链接格式无法识别');
        var c1 = full.slice(0, at1);
        hostport = full.slice(at1 + 1);
        var ci1 = c1.indexOf(':');
        method = c1.slice(0, ci1);
        password = c1.slice(ci1 + 1);
      }
      if (!method || !password) throw new Error('缺少 cipher 或 password');
      var hp0 = splitHostPort(hostport);
      var node = { name: name0, type: 'ss', server: hp0.host, port: hp0.port, cipher: method, password: password, udp: true };
      var q0 = parseQuery(qs0);
      if (q0.plugin) {
        var seg = q0.plugin.split(';');
        var head = seg[0];
        var kv = Object.create(null);
        seg.slice(1).forEach(function (p) {
          var i = p.indexOf('=');
          if (i > 0) kv[p.slice(0, i)] = p.slice(i + 1);
          else if (p) kv[p] = true;
        });
        if (head === 'obfs-local' || head === 'simple-obfs') {
          node.plugin = 'obfs';
          node['plugin-opts'] = { mode: kv.obfs || 'http' };
          if (kv['obfs-host']) node['plugin-opts'].host = kv['obfs-host'];
        } else if (head === 'v2ray-plugin') {
          node.plugin = 'v2ray-plugin';
          node['plugin-opts'] = { mode: kv.mode || 'websocket' };
          if (kv.tls) node['plugin-opts'].tls = true;
          if (kv.host) node['plugin-opts'].host = kv.host;
          if (kv.path) node['plugin-opts'].path = kv.path;
        } else if (head === 'shadow-tls') {
          node.plugin = 'shadow-tls';
          node['plugin-opts'] = {};
          if (kv.host) node['plugin-opts'].host = kv.host;
          if (kv.password) node['plugin-opts'].password = kv.password;
          if (kv.version) node['plugin-opts'].version = portOf({ port: kv.version });
        } else {
          throw new Error('不支持的 Shadowsocks 插件');
        }
      }
      return node;
    }

    if (scheme === 'vmess') {
      var json = JSON.parse(base64DecodeToString(uri.slice(8)));
      var netV = checkTransport(json.net);
      var nV = {
        name: json.ps || '',
        type: 'vmess',
        server: json.add,
        port: portOf({ port: json.port }),
        uuid: json.id,
        alterId: parseInt(json.aid || 0, 10),
        cipher: json.scy || 'auto',
        udp: true
      };
      if (json.tls === 'tls' || json.tls === true) nV.tls = true;
      if (json.sni) nV.servername = json.sni;
      if (json.fp) nV['client-fingerprint'] = json.fp;
      if (json.alpn) nV.alpn = String(json.alpn).split(',').filter(Boolean);
      if (truthy(json.allowInsecure)) nV['skip-cert-verify'] = true;
      setTransport(nV, netV, json.path, json.host, json.path, json.ed, json.eh);
      return nV;
    }

    if (scheme === 'ssr') {
      var dec2 = base64DecodeToString(uri.slice(6));
      var seg2 = dec2.split('/?');
      var main = seg2[0].split(':');
      var qp = {};
      (seg2[1] || '').split('&').forEach(function (kv2) {
        if (!kv2) return;
        var i2 = kv2.indexOf('=');
        qp[kv2.slice(0, i2)] = base64DecodeToString(kv2.slice(i2 + 1));
      });
      return {
        name: qp.remarks || '',
        type: 'ssr',
        server: main[0],
        port: portOf({ port: main[1] }),
        cipher: main[3],
        password: base64DecodeToString(main[5] || ''),
        protocol: main[2],
        'protocol-param': qp.protoparam || '',
        obfs: main[4],
        'obfs-param': qp.obfsparam || ''
      };
    }

    var c = splitCommon(uri);
    var p = c.params;

    if (scheme === 'vless') {
      var security = p.security || (p.pbk ? 'reality' : 'none');
      var netL = checkTransport(p.type);
      if (!['none', 'tls', 'reality'].includes(security)) throw new Error('暂不支持此 VLESS 安全类型');
      if (security === 'reality' && !p.pbk) throw new Error('缺少 Reality 公钥');
      var nL = {
        name: c.name,
        type: 'vless',
        server: c.host,
        port: c.port,
        uuid: decodeURIComponent(c.cred),
        udp: true,
        tls: security === 'tls' || security === 'reality',
        network: netL
      };
      if (p.sni) nL.servername = p.sni;
      if (p.flow) nL.flow = p.flow;
      if (p.fp) nL['client-fingerprint'] = p.fp;
      if (p.alpn) nL.alpn = String(p.alpn).split(',').filter(Boolean);
      if (security === 'reality' && (p.pbk || p.sid)) {
        nL['reality-opts'] = {};
        if (p.pbk) nL['reality-opts']['public-key'] = p.pbk;
        if (p.sid) nL['reality-opts']['short-id'] = p.sid;
      }
      setTransport(nL, netL, p.path, p.host, p.serviceName, p.ed, p.eh);
      if (truthy(p.allowInsecure)) nL['skip-cert-verify'] = true;
      return nL;
    }

    if (scheme === 'trojan') {
      var netT = checkTransport(p.type);
      var nT = {
        name: c.name,
        type: 'trojan',
        server: c.host,
        port: c.port,
        password: decodeURIComponent(c.cred || ''),
        udp: true
      };
      if (p.sni) nT.sni = p.sni;
      if (truthy(p.allowInsecure)) nT['skip-cert-verify'] = true;
      if (p.alpn) nT.alpn = String(p.alpn).split(',').filter(Boolean);
      if (netT !== 'tcp') nT.network = netT;
      setTransport(nT, netT, p.path, p.host, p.serviceName, p.ed, p.eh);
      return nT;
    }

    if (scheme === 'hysteria2' || scheme === 'hy2') {
      var nH = {
        name: c.name,
        type: 'hysteria2',
        server: c.host,
        port: c.port,
        password: decodeURIComponent(c.cred || '')
      };
      if (p.sni) nH.sni = p.sni;
      if (truthy(p.insecure)) nH['skip-cert-verify'] = true;
      if (p.obfs) nH.obfs = p.obfs;
      if (p['obfs-password']) nH['obfs-password'] = p['obfs-password'];
      if (p.mport) nH.ports = normalizePortRanges(p.mport);
      if (p.upmbps) nH.up = p.upmbps;
      if (p.downmbps) nH.down = p.downmbps;
      if (p.alpn) nH.alpn = String(p.alpn).split(',').filter(Boolean);
      return nH;
    }

    if (scheme === 'hysteria') {
      var nH1 = { name: c.name, type: 'hysteria', server: c.host, port: c.port };
      if (p.auth) nH1['auth-str'] = p.auth;
      if (p.sni) nH1.sni = p.sni;
      if (truthy(p.insecure)) nH1['skip-cert-verify'] = true;
      if (p.protocol) nH1.protocol = p.protocol;
      if (p.upmbps) nH1.up = p.upmbps;
      if (p.downmbps) nH1.down = p.downmbps;
      return nH1;
    }

    if (scheme === 'tuic') {
      var ci3 = (c.cred || '').indexOf(':');
      var uuid3 = ci3 >= 0 ? decodeURIComponent(c.cred.slice(0, ci3)) : decodeURIComponent(c.cred || '');
      var pass3 = ci3 >= 0 ? decodeURIComponent(c.cred.slice(ci3 + 1)) : '';
      var nT3 = { name: c.name, type: 'tuic', server: c.host, port: c.port, uuid: uuid3, password: pass3 };
      if (p.sni) nT3.sni = p.sni;
      if (p.alpn) nT3.alpn = String(p.alpn).split(',').filter(Boolean);
      if (p.congestion_control) nT3['congestion-controller'] = p.congestion_control;
      if (p.udp_relay_mode) nT3['udp-relay-mode'] = p.udp_relay_mode;
      if (truthy(p.allow_insecure)) nT3['skip-cert-verify'] = true;
      return nT3;
    }

    if (scheme === 'snell') {
      var nS = { name: c.name, type: 'snell', server: c.host, port: c.port, psk: decodeURIComponent(c.cred || '') };
      if (p.version) nS.version = parseInt(p.version, 10);
      if (p.obfs) nS['obfs-opts'] = { mode: p.obfs };
      if (p['obfs-host']) {
        nS['obfs-opts'] = nS['obfs-opts'] || {};
        nS['obfs-opts'].host = p['obfs-host'];
      }
      return nS;
    }

    if (scheme === 'socks5' || scheme === 'socks') {
      var u5 = '', pw5 = '';
      if (c.cred) {
        var i5 = c.cred.indexOf(':');
        u5 = decodeURIComponent(i5 >= 0 ? c.cred.slice(0, i5) : c.cred);
        pw5 = i5 >= 0 ? decodeURIComponent(c.cred.slice(i5 + 1)) : '';
      }
      var n5 = { name: c.name, type: 'socks5', server: c.host, port: c.port, udp: true };
      if (u5) n5.username = u5;
      if (pw5) n5.password = pw5;
      return n5;
    }

    if (scheme === 'http' || scheme === 'https') {
      var u6 = '', pw6 = '';
      if (c.cred) {
        var i6 = c.cred.indexOf(':');
        u6 = decodeURIComponent(i6 >= 0 ? c.cred.slice(0, i6) : c.cred);
        pw6 = i6 >= 0 ? decodeURIComponent(c.cred.slice(i6 + 1)) : '';
      }
      var n6 = { name: c.name, type: 'http', server: c.host, port: c.port };
      if (u6) n6.username = u6;
      if (pw6) n6.password = pw6;
      if (scheme === 'https') n6.tls = true;
      return n6;
    }

    throw new Error('暂不支持该协议：' + scheme);
  }

  /* ===================== YAML 序列化 ===================== */
  function nodesToYaml(nodes, opt) {
    var config = { proxies: nodes };
    if (!opt || opt.fullConfig !== false) {
      config['mixed-port'] = 7890;
      config['allow-lan'] = false;
      config.mode = 'rule';
      config['log-level'] = 'info';
      var reserved = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL'].concat(nodes.map(function (n) { return n.name; })));
      var group = 'Proxy';
      while (reserved.has(group)) group += '-Group';
      config['proxy-groups'] = [{ name: group, type: 'select', proxies: nodes.map(function (n) { return n.name; }).concat('DIRECT') }];
      config.rules = ['MATCH,' + group];
    }
    return yaml.dump(config);
  }

  /**
   * Shadowrocket 订阅（txt，可 Base64）→ Clash YAML
   * @param {string} text
   * @param {{fullConfig?:boolean}} opt
   */
  function urisToYaml(text, opt) {
    opt = opt || {};
    var raw = String(text || '').trim();
    if (!raw) throw new Error('内容为空');
    if (new TextEncoder().encode(raw).length > MAX_INPUT) throw new Error('内容超过 8 MB');

    // 自动识别 Base64 订阅
    var compact = raw.replace(/\s+/g, '');
    if (compact.length >= 16 && /^[A-Za-z0-9+/=_-]+$/.test(compact)) {
      try {
        var dec = base64DecodeToString(compact);
        if (/[a-z0-9+.-]+:\/\//i.test(dec)) raw = dec;
      } catch (e) { /* 继续逐行报告非法输入 */ }
    }

    var lines = raw.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!lines.length) throw new Error('没有可解析的链接');

    lines = lines.filter(function (line) { return !/^#|^\/\//.test(line); });
    if (lines.length > MAX_NODES) throw new Error('单次最多转换 5000 个节点');
    var nodes = [], skipped = [], details = [];
    var usedNames = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL']);
    lines.forEach(function (line, i) {
      if (/^#/.test(line) || /^\/\//.test(line)) return;
      var uri = line;
      if (!/^[a-z0-9+.-]+:\/\//i.test(uri)) {
        skipped.push({ line: i + 1, reason: '不是分享链接' });
        details.push({ name: '第 ' + (i + 1) + ' 行', type: '-', skip: true, reason: '不是分享链接' });
        return;
      }
      try {
        var n = uriToNode(uri);
        hostOf(n);
        portOf(n);
        if (['vmess', 'vless', 'tuic'].includes(n.type) && !n.uuid) throw new Error('缺少 uuid');
        if (['ssr', 'trojan', 'hysteria2'].includes(n.type) && !n.password) throw new Error('缺少 password');
        if (n.type === 'snell' && !n.psk) throw new Error('缺少 psk');
        if (!n.name) n.name = n.type + '-' + n.server + ':' + n.port;
        if (opt.namePrefix) n.name = opt.namePrefix + n.name;
        var baseName = n.name;
        for (var index = 2; usedNames.has(n.name); index++) n.name = baseName + ' (' + index + ')';
        usedNames.add(n.name);
        nodes.push(n);
        details.push({ name: n.name, type: n.type, skip: false });
      } catch (e) {
        var scheme = (uri.match(/^([a-z0-9+.-]+):/i) || [])[1] || '?';
        var reason = e instanceof SyntaxError || e instanceof TypeError ? '链接格式或编码错误' : e.message;
        skipped.push({ line: i + 1, reason: reason });
        details.push({ name: '第 ' + (i + 1) + ' 行', type: scheme, skip: true, reason: reason });
      }
    });

    var resultYaml = nodes.length ? nodesToYaml(nodes, opt) : '';
    return {
      total: lines.length,
      ok: nodes.length,
      skipped: skipped,
      details: details,
      nodes: nodes,
      yaml: resultYaml,
      text: resultYaml
    };
  }

  return {
    parseYAML: parseYAML,
    convert: convert,
    urisToYaml: urisToYaml,
    uriToNode: uriToNode,
    nodesToYaml: nodesToYaml,
    nodeToUri: nodeToUri,
    parseUri: parseUri,
    base64DecodeToString: base64DecodeToString,
    b64utf8: b64utf8,
    b64url: b64url,
    SUPPORTED: SUPPORTED
  };
}));
