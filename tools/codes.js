/* ==========================================================================
   鲁班二维码生成器 — 编码核心 (core)
   纯 JS 零依赖：QR Code (1-40, L/M/Q/H) + Code128 / EAN-13 / Code 39
   该文件既可在浏览器 <script> 引入，也可在 Node 中 require 用于回归测试。
   算法参考 ISO/IEC 18004 (QR) 与 ISO/IEC 15417 (Code 128) / 15420 (EAN) / 16388 (Code 39)
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LubanCode = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. UTF-8 编码
   * ------------------------------------------------------------------ */
  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      // 处理孤立代理项 / 代理对
      if (c >= 0xD800 && c <= 0xDBFF) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          c = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
          i++;
        } else {
          c = 0xFFFD;
        }
      } else if (c >= 0xDC00 && c <= 0xDFFF) {
        c = 0xFFFD;
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 2. QR Code
   * ------------------------------------------------------------------ */
  // 每块纠错码字数 [等级][版本]
  var ECC_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  };
  // 纠错块数 [等级][版本]
  var NUM_BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  };
  var ALNUM_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

  function numRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  function numDataCodewords(ver, ecl) {
    return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];
  }
  function alignmentPositions(ver) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }
  function charCountBits(mode, ver) {
    var idx = ver <= 9 ? 0 : (ver <= 26 ? 1 : 2);
    if (mode === 'numeric') return [10, 12, 14][idx];
    if (mode === 'alnum') return [9, 11, 13][idx];
    return [8, 16, 16][idx];
  }
  function pickMode(text) {
    if (/^[0-9]+$/.test(text)) return 'numeric';
    var ok = text.length > 0;
    for (var i = 0; i < text.length; i++) {
      if (ALNUM_CHARSET.indexOf(text.charAt(i)) < 0) { ok = false; break; }
    }
    return ok ? 'alnum' : 'byte';
  }
  // 该模式下有效数据的比特数
  function segDataBits(text, mode) {
    if (mode === 'numeric') {
      var n = text.length;
      return Math.floor(n / 3) * 10 + [0, 4, 7][n % 3];
    }
    if (mode === 'alnum') {
      var n2 = text.length;
      return Math.floor(n2 / 2) * 11 + (n2 % 2) * 6;
    }
    return utf8Bytes(text).length * 8;
  }

  function reedSolomonDivisor(degree) {
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (var d = 0; d < degree; d++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = rsMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = rsMul(root, 0x02);
    }
    return result;
  }
  function reedSolomonRemainder(data, divisor) {
    var result = divisor.map(function () { return 0; });
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ result.shift();
      result.push(0);
      for (var j = 0; j < divisor.length; j++) result[j] ^= rsMul(divisor[j], factor);
    }
    return result;
  }
  function rsMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }

  // 生成数据码字（含模式指示符、字符计数、终止符、填充）
  function buildDataCodewords(text, mode, ver, ecl, useECI) {
    var bits = [];
    function append(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    }
    // ECI 26 = UTF-8：显式声明字符集，避免解码器按 Latin-1 误判
    if (useECI && mode === 'byte') {
      append(7, 4);   // ECI 模式指示符
      append(26, 8);  // ECI 设计ator（单字节形式）
    }
    var modeBits = mode === 'numeric' ? 1 : (mode === 'alnum' ? 2 : 4);
    append(modeBits, 4);
    // 字节模式的字符计数必须是 UTF-8 字节数，而非 JS 字符数
    var payload = mode === 'byte' ? utf8Bytes(text) : null;
    append(payload ? payload.length : text.length, charCountBits(mode, ver));

    if (mode === 'numeric') {
      for (var i = 0; i < text.length; ) {
        var n = Math.min(3, text.length - i);
        append(parseInt(text.substr(i, n), 10), n * 3 + 1);
        i += n;
      }
    } else if (mode === 'alnum') {
      for (var k = 0; k < text.length; ) {
        if (k + 1 < text.length) {
          append(ALNUM_CHARSET.indexOf(text.charAt(k)) * 45 + ALNUM_CHARSET.indexOf(text.charAt(k + 1)), 11);
          k += 2;
        } else {
          append(ALNUM_CHARSET.indexOf(text.charAt(k)), 6);
          k += 1;
        }
      }
    } else {
      var bytes = payload || utf8Bytes(text);
      for (var b = 0; b < bytes.length; b++) append(bytes[b], 8);
    }

    var capacityBits = numDataCodewords(ver, ecl) * 8;
    if (bits.length > capacityBits) return null; // 版本不足
    // 终止符（最多 4 bit）
    for (var t = 0; t < 4 && bits.length < capacityBits; t++) bits.push(0);
    // 补零到字节边界
    while (bits.length % 8 !== 0) bits.push(0);
    // 交替填充 0xEC / 0x11
    var pad = [0xEC, 0x11], pi = 0;
    while (bits.length < capacityBits) {
      append(pad[pi], 8);
      pi ^= 1;
    }
    var codewords = [];
    for (var c = 0; c < bits.length; c += 8) {
      var v = 0;
      for (var d = 0; d < 8; d++) v = (v << 1) | bits[c + d];
      codewords.push(v);
    }
    return codewords;
  }

  function addEccAndInterleave(data, ver, ecl) {
    var numBlocks = NUM_BLOCKS[ecl][ver];
    var blockEccLen = ECC_PER_BLOCK[ecl][ver];
    var rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - rawCodewords % numBlocks;
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var blocks = [], rsDiv = reedSolomonDivisor(blockEccLen), k = 0;
    for (var i = 0; i < numBlocks; i++) {
      var datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      var dat = data.slice(k, k + datLen);
      k += datLen;
      var ecc = reedSolomonRemainder(dat, rsDiv);
      if (i < numShortBlocks) dat.push(0); // 占位，交错时跳过
      blocks.push(dat.concat(ecc));
    }
    var result = [];
    for (var idx = 0; idx < blocks[0].length; idx++) {
      for (var j = 0; j < blocks.length; j++) {
        if (idx !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
          result.push(blocks[j][idx]);
        }
      }
    }
    return result;
  }

  function buildMatrix(ver, ecl, allCodewords) {
    var size = ver * 4 + 17;
    var modules = [], isFunc = [];
    for (var i = 0; i < size; i++) {
      modules.push(new Array(size).fill(false));
      isFunc.push(new Array(size).fill(false));
    }
    function setFn(x, y, dark) {
      if (x < 0 || x >= size || y < 0 || y >= size) return;
      modules[y][x] = dark;
      isFunc[y][x] = true;
    }
    function drawFinder(x, y) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFn(x + dx, y + dy, dist !== 2 && dist !== 4);
        }
      }
    }
    function drawAlign(x, y) {
      for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
          setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
    function eclBits() { return { L: 1, M: 0, Q: 3, H: 2 }[ecl]; }
    function drawFormat(msk) {
      var data = (eclBits() << 3) | msk;
      var rem = data;
      for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412;
      for (var a = 0; a <= 5; a++) setFn(8, a, getBit(bits, a));
      setFn(8, 7, getBit(bits, 6));
      setFn(8, 8, getBit(bits, 7));
      setFn(7, 8, getBit(bits, 8));
      for (var b = 9; b < 15; b++) setFn(14 - b, 8, getBit(bits, b));
      for (var c = 0; c < 8; c++) setFn(size - 1 - c, 8, getBit(bits, c));
      for (var d = 8; d < 15; d++) setFn(8, size - 15 + d, getBit(bits, d));
      setFn(8, size - 8, true);
    }
    function drawVersion() {
      if (ver < 7) return;
      var rem = ver;
      for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var bits = (ver << 12) | rem;
      for (var j = 0; j < 18; j++) {
        var dark = getBit(bits, j);
        var a = size - 11 + j % 3, b = Math.floor(j / 3);
        setFn(a, b, dark);
        setFn(b, a, dark);
      }
    }

    // --- 功能图形 ---
    for (var t = 0; t < size; t++) {
      setFn(6, t, t % 2 === 0);
      setFn(t, 6, t % 2 === 0);
    }
    drawFinder(3, 3);
    drawFinder(size - 4, 3);
    drawFinder(3, size - 4);
    var pos = alignmentPositions(ver), n = pos.length;
    for (var ai = 0; ai < n; ai++) {
      for (var aj = 0; aj < n; aj++) {
        if ((ai === 0 && aj === 0) || (ai === 0 && aj === n - 1) || (ai === n - 1 && aj === 0)) continue;
        drawAlign(pos[ai], pos[aj]);
      }
    }
    drawFormat(0); // 先占位，掩码确定后重绘
    drawVersion();

    // --- 数据区布置 ---
    var bitIdx = 0, totalBits = allCodewords.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var jj = 0; jj < 2; jj++) {
          var x = right - jj;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!isFunc[y][x] && bitIdx < totalBits) {
            modules[y][x] = getBit(allCodewords[bitIdx >>> 3], 7 - (bitIdx & 7));
            bitIdx++;
          }
        }
      }
    }

    // --- 掩码评分 ---
    function applyMask(msk) {
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          if (isFunc[y][x]) continue;
          var inv;
          switch (msk) {
            case 0: inv = (x + y) % 2 === 0; break;
            case 1: inv = y % 2 === 0; break;
            case 2: inv = x % 3 === 0; break;
            case 3: inv = (x + y) % 3 === 0; break;
            case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
            case 5: inv = (x * y) % 2 + (x * y) % 3 === 0; break;
            case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
            default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          }
          if (inv) modules[y][x] = !modules[y][x];
        }
      }
    }
    function penalty() {
      var N1 = 3, N2 = 3, N3 = 40, N4 = 10, result = 0;
      function addHistory(len, hist) {
        if (hist[0] === 0) len += size;
        hist.pop();
        hist.unshift(len);
      }
      function countPatterns(hist) {
        var nCore = hist[1];
        var core = nCore > 0 && hist[2] === nCore && hist[3] === nCore * 3 && hist[4] === nCore && hist[5] === nCore;
        return (core && hist[0] >= nCore * 4 && hist[6] >= nCore ? 1 : 0) +
               (core && hist[6] >= nCore * 4 && hist[0] >= nCore ? 1 : 0);
      }
      function terminateAndCount(color, len, hist) {
        if (color) { addHistory(len, hist); len = 0; }
        len += size;
        addHistory(len, hist);
        return countPatterns(hist);
      }
      // 行
      for (var y = 0; y < size; y++) {
        var runColor = false, runX = 0, hist = [0, 0, 0, 0, 0, 0, 0];
        for (var x = 0; x < size; x++) {
          if (modules[y][x] === runColor) {
            runX++;
            if (runX === 5) result += N1;
            else if (runX > 5) result++;
          } else {
            addHistory(runX, hist);
            if (!runColor) result += countPatterns(hist) * N3;
            runColor = modules[y][x];
            runX = 1;
          }
        }
        result += terminateAndCount(runColor, runX, hist) * N3;
      }
      // 列
      for (var x2 = 0; x2 < size; x2++) {
        var rc = false, ry = 0, h2 = [0, 0, 0, 0, 0, 0, 0];
        for (var y2 = 0; y2 < size; y2++) {
          if (modules[y2][x2] === rc) {
            ry++;
            if (ry === 5) result += N1;
            else if (ry > 5) result++;
          } else {
            addHistory(ry, h2);
            if (!rc) result += countPatterns(h2) * N3;
            rc = modules[y2][x2];
            ry = 1;
          }
        }
        result += terminateAndCount(rc, ry, h2) * N3;
      }
      // 2x2 同色块
      for (var y3 = 0; y3 < size - 1; y3++) {
        for (var x3 = 0; x3 < size - 1; x3++) {
          var col = modules[y3][x3];
          if (col === modules[y3][x3 + 1] && col === modules[y3 + 1][x3] && col === modules[y3 + 1][x3 + 1]) result += N2;
        }
      }
      // 黑白比例
      var dark = 0;
      for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) if (modules[yy][xx]) dark++;
      var total = size * size;
      var kk = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
      result += kk * N4;
      return result;
    }

    var bestMask = 0, minPenalty = Infinity;
    for (var msk = 0; msk < 8; msk++) {
      applyMask(msk);
      drawFormat(msk);
      var p = penalty();
      if (p < minPenalty) { minPenalty = p; bestMask = msk; }
      applyMask(msk); // 异或还原
    }
    applyMask(bestMask);
    drawFormat(bestMask);

    return { size: size, modules: modules, mask: bestMask, version: ver };
  }

  /**
   * 生成 QR 矩阵
   * @param {string} text 内容
   * @param {string} ecl  纠错等级 L|M|Q|H（默认 M）
   * @param {number} [forceVersion] 指定版本（0=自动最小）
   * @param {{eci?:boolean}} [opt] eci: 非 ASCII 时是否声明 UTF-8（默认 true）
   * @returns {{size, modules, version, mask, mode, ecl}}
   */
  function qrEncode(text, ecl, forceVersion, opt) {
    opt = opt || {};
    ecl = (ecl || 'M').toUpperCase();
    if (!ECC_PER_BLOCK[ecl]) ecl = 'M';
    text = String(text == null ? '' : text);
    if (text.length === 0) throw new Error('内容为空');
    var mode = pickMode(text);
    var hasNonAscii = /[^\x00-\x7F]/.test(text);
    var useECI = mode === 'byte' && (opt.eci === undefined ? hasNonAscii : !!opt.eci);
    var start = forceVersion && forceVersion >= 1 && forceVersion <= 40 ? forceVersion : 1;
    var end = forceVersion && forceVersion >= 1 && forceVersion <= 40 ? forceVersion : 40;
    for (var ver = start; ver <= end; ver++) {
      var capBits = numDataCodewords(ver, ecl) * 8;
      var need = 4 + charCountBits(mode, ver) + segDataBits(text, mode) + (useECI ? 12 : 0);
      if (need > capBits) continue;
      var dataCw = buildDataCodewords(text, mode, ver, ecl, useECI);
      if (!dataCw) continue;
      var allCw = addEccAndInterleave(dataCw, ver, ecl);
      var m = buildMatrix(ver, ecl, allCw);
      m.mode = mode;
      m.ecl = ecl;
      m.eci = useECI;
      return m;
    }
    throw new Error('内容过长，超出 QR 版本 40 容量（' + ecl + ' 级）');
  }

  /* ------------------------------------------------------------------ *
   * 3. Code 128
   * ------------------------------------------------------------------ */
  // 107 个码字的条空宽度序列（bar,space,bar,space,bar,space）
  var CODE128_W = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
  ];
  function widthsToBits(w) {
    var out = [], dark = true;
    for (var i = 0; i < w.length; i++) {
      var n = +w[i];
      for (var j = 0; j < n; j++) out.push(dark ? 1 : 0);
      dark = !dark;
    }
    return out;
  }
  // Code B 值
  function codeBValue(ch) {
    var c = ch.charCodeAt(0);
    if (c >= 32 && c <= 127) return c - 32;
    return -1;
  }

  /**
   * Code 128 编码
   * @param {string} text
   * @param {string} [mode] 'auto' | 'B' | 'C'
   */
  function code128Encode(text, mode) {
    text = String(text || '');
    mode = mode || 'auto';
    if (!text.length) throw new Error('内容为空');
    var values = []; // 码字值序列（不含起始/校验/终止）
    var startCode;

    var isDigits = /^[0-9]+$/.test(text);
    var useC = false;
    if (mode === 'C') useC = true;
    else if (mode === 'B') useC = false;
    else useC = isDigits && text.length >= 2 && text.length % 2 === 0;

    if (useC) {
      if (!isDigits) throw new Error('Code 128-C 仅支持纯数字');
      if (text.length % 2 !== 0) throw new Error('Code 128-C 需要偶数位数字');
      startCode = 105;
      for (var i = 0; i < text.length; i += 2) values.push(parseInt(text.substr(i, 2), 10));
    } else {
      startCode = 104;
      for (var j = 0; j < text.length; j++) {
        var v = codeBValue(text.charAt(j));
        if (v < 0) throw new Error('Code 128-B 不支持字符：' + text.charAt(j) + '（仅支持 ASCII 32-127）');
        values.push(v);
      }
    }

    // 校验位
    var sum = startCode;
    for (var k = 0; k < values.length; k++) sum += values[k] * (k + 1);
    var checksum = sum % 103;

    var seq = [startCode].concat(values, [checksum, 106]);
    var bits = [];
    for (var m = 0; m < seq.length; m++) bits = bits.concat(widthsToBits(CODE128_W[seq[m]]));

    return {
      format: 'CODE128',
      bits: bits,
      text: text,
      humanReadable: text,
      quietLeft: 10,
      quietRight: 10,
      checksum: checksum,
      startCode: startCode
    };
  }

  /* ------------------------------------------------------------------ *
   * 4. EAN-13
   * ------------------------------------------------------------------ */
  var EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  var EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  var EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  var EAN_PARITY = ['000000', '001011', '001101', '001110', '010011', '011001', '011100', '010101', '010110', '011010'];

  function ean13Checksum(d12) {
    var sum = 0;
    for (var i = 0; i < 12; i++) {
      sum += (+d12.charAt(i)) * (i % 2 === 0 ? 1 : 3);
    }
    return (10 - (sum % 10)) % 10;
  }
  /**
   * EAN-13 编码（12 位自动补校验位，13 位校验错误会抛错）
   */
  function ean13Encode(text) {
    text = String(text || '');
    if (!/^\d{12,13}$/.test(text)) throw new Error('EAN-13 只接受 12 或 13 位数字');
    if (text.length === 12) text += ean13Checksum(text);
    if (text.length !== 13) throw new Error('EAN-13 需要 12 或 13 位数字');
    var expect = ean13Checksum(text.substr(0, 12));
    if (+text.charAt(12) !== expect) throw new Error('EAN-13 校验位错误（应为 ' + expect + '）');

    var bits = '101';
    var parity = EAN_PARITY[+text.charAt(0)];
    for (var i = 1; i <= 6; i++) {
      var d = +text.charAt(i);
      bits += parity.charAt(i - 1) === '0' ? EAN_L[d] : EAN_G[d];
    }
    bits += '01010';
    for (var j = 7; j <= 12; j++) bits += EAN_R[+text.charAt(j)];
    bits += '101';

    return {
      format: 'EAN13',
      bits: bits.split('').map(Number),
      text: text,
      humanReadable: text,
      quietLeft: 11,
      quietRight: 7
    };
  }

  /* ------------------------------------------------------------------ *
   * 5. Code 39
   * ------------------------------------------------------------------ */
  var CODE39 = {
    '0': '101001101101', '1': '110100101011', '2': '101100101011', '3': '110110010101',
    '4': '101001101011', '5': '110100110101', '6': '101100110101', '7': '101001011011',
    '8': '110100101101', '9': '101100101101',
    'A': '110101001011', 'B': '101101001011', 'C': '110110100101', 'D': '101011001011',
    'E': '110101100101', 'F': '101101100101', 'G': '101010011011', 'H': '110101001101',
    'I': '101101001101', 'J': '101011001101', 'K': '110101010011', 'L': '101101010011',
    'M': '110110101001', 'N': '101011010011', 'O': '110101101001', 'P': '101101101001',
    'Q': '101010110011', 'R': '110101011001', 'S': '101101011001', 'T': '101011011001',
    'U': '110010101011', 'V': '100110101011', 'W': '110011010101', 'X': '100101101011',
    'Y': '110010110101', 'Z': '100110110101',
    '-': '100101011011', '.': '110010101101', ' ': '100110101101',
    '$': '100100100101', '/': '100100101001', '+': '100101001001', '%': '101001001001',
    '*': '100101101101'
  };
  function code39Encode(text) {
    text = String(text || '');
    if (!/^[a-zA-Z0-9 .$/+%\-]+$/.test(text)) throw new Error('Code 39 仅支持英文字母、数字、空格及 - . $ / + %');
    text = text.toUpperCase();
    if (!text.length) throw new Error('内容为空');
    var bits = [];
    var full = '*' + text + '*';
    for (var i = 0; i < full.length; i++) {
      var pat = CODE39[full.charAt(i)];
      if (!pat) throw new Error('Code 39 不支持字符：' + full.charAt(i) + '（支持 0-9 A-Z 空格 - . $ / + %）');
      if (i > 0) bits.push(0); // 字符间窄空隙
      for (var j = 0; j < pat.length; j++) bits.push(+pat.charAt(j));
    }
    return {
      format: 'CODE39',
      bits: bits,
      text: text,
      humanReadable: full,
      quietLeft: 10,
      quietRight: 10
    };
  }

  /* ------------------------------------------------------------------ *
   * 6. 统一入口
   * ------------------------------------------------------------------ */
  function barcodeEncode(text, format, opt) {
    if (String(text).length > 120) throw new Error('条码内容最多 120 个字符');
    format = (format || 'CODE128').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (format === 'CODE128' || format === 'C128') return code128Encode(text, (opt && opt.code128Mode) || 'auto');
    if (format === 'EAN13' || format === 'EAN') return ean13Encode(text);
    if (format === 'CODE39' || format === 'C39') return code39Encode(text);
    throw new Error('未知条形码格式：' + format);
  }

  return {
    utf8Bytes: utf8Bytes,
    qrEncode: qrEncode,
    barcodeEncode: barcodeEncode,
    code128Encode: code128Encode,
    ean13Encode: ean13Encode,
    code39Encode: code39Encode,
    _internal: {
      numRawDataModules: numRawDataModules,
      numDataCodewords: numDataCodewords,
      alignmentPositions: alignmentPositions,
      CODE128_W: CODE128_W,
      CODE39: CODE39,
      EAN_L: EAN_L, EAN_G: EAN_G, EAN_R: EAN_R, EAN_PARITY: EAN_PARITY
    }
  };
}));
