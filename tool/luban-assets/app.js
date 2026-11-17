(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var L = window.LubanCode;
  var LC = window.LubanClash;

  var state = {
    mode: document.body.dataset.mode,
    text: '',
    ecl: 'M',
    fg: '#000000',
    bcFormat: 'CODE128',
    bcHeight: 110,
    bcShowText: true,
    saveSize: 640
  };

  var current = null;   // 最近一次成功渲染的结果
  var cv = $('cv'), ctx = cv.getContext('2d');
  var ta = $('ta');


  /* ---------------- 工具 ---------------- */
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tid);
    t._tid = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }

  function isDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function luminance(hex) {
    var c = hex.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var r = parseInt(c.substr(0, 2), 16) / 255;
    var g = parseInt(c.substr(2, 2), 16) / 255;
    var b = parseInt(c.substr(4, 2), 16) / 255;
    var f = function (v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  /* ---------------- 绘制：二维码 ---------------- */
  // 将模块矩阵画到 canvas，返回实际像素尺寸
  function paintQR(canvas, m, px, fg, bg, quiet) {
    var n = m.size;
    var total = n + quiet * 2;
    var scale = Math.max(1, Math.floor(px / total));
    var dim = total * scale;
    canvas.width = dim;
    canvas.height = dim;
    var c = canvas.getContext('2d');
    c.fillStyle = bg;
    c.fillRect(0, 0, dim, dim);
    c.fillStyle = fg;
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (m.modules[y][x]) c.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    }
    return dim;
  }

  /* ---------------- 绘制：条形码 ---------------- */
  function paintBC(canvas, bc, barHeight, showText, px, fg, bg) {
    var quiet = bc.quietLeft + bc.quietRight;
    var totalMods = bc.bits.length + quiet;
    var modW = Math.max(px > 560 ? 2 : 1, Math.floor(px / totalMods));
    var textH = showText ? Math.round(barHeight * 0.24) : 0;
    var w = totalMods * modW;
    var h = barHeight + textH;
    canvas.width = w;
    canvas.height = h;
    var c = canvas.getContext('2d');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.fillStyle = fg;
    for (var i = 0; i < bc.bits.length; i++) {
      if (bc.bits[i]) c.fillRect((bc.quietLeft + i) * modW, 0, modW, barHeight);
    }
    if (showText) {
      var txt = bc.humanReadable;
      var fontSize = Math.max(10, Math.round(textH * 0.72));
      c.font = '600 ' + fontSize + 'px ui-monospace, Menlo, monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      var maxW = w - 8;
      var mw = c.measureText(txt).width;
      if (mw > maxW) {
        fontSize = Math.max(8, Math.floor(fontSize * maxW / mw));
        c.font = '600 ' + fontSize + 'px ui-monospace, Menlo, monospace';
      }
      c.fillStyle = fg;
      c.fillText(txt, w / 2, barHeight + textH / 2 + 1);
    }
    return { w: w, h: h };
  }

  /* ---------------- 空态 / 错误 ---------------- */
  function showEmpty(msg) {
    current = null;
    cv.style.display = 'none';
    $('errTip').style.display = 'none';
    var e = $('emptyTip');
    e.style.display = 'block';
    e.innerHTML = msg || '在左侧输入内容<br>实时生成';
    $('meta').innerHTML = '';
    setActionsEnabled(false);
  }
  function showError(msg) {
    current = null;
    cv.style.display = 'none';
    $('emptyTip').style.display = 'none';
    var e = $('errTip');
    e.style.display = 'block';
    e.textContent = msg;
    $('meta').innerHTML = '';
    setActionsEnabled(false);
  }
  function setActionsEnabled(on) {
    ['savePng', 'saveSvg', 'copyImg', 'rememberCode'].forEach(function (id) {
      $(id).disabled = !on;
    });
  }

  /* ---------------- 主渲染 ---------------- */
  function render() {
    if (state.mode !== 'qr' && state.mode !== 'barcode') return;
    var text = state.text;
    if (!text) { showEmpty(); return; }

    try {
      if (state.mode === 'qr') {
        var m = L.qrEncode(text, state.ecl);
        var fg = state.fg;
        var boxW = $('cv').parentNode.clientWidth - 28;
        var maxPx = Math.max(200, Math.min(560, Math.floor(boxW)));
        cv.style.display = 'block';
        $('emptyTip').style.display = 'none';
        $('errTip').style.display = 'none';
        var dpr = Math.min(window.devicePixelRatio || 1, 3);
        // 先按 CSS 尺寸算，再乘 dpr 得到清晰位图
        paintQR(cv, m, maxPx * dpr, fg, '#ffffff', 4);
        cv.style.width = Math.round(maxPx) + 'px';
        cv.style.height = 'auto';

        current = { kind: 'qr', m: m };

        var bytes = L.utf8Bytes(text).length;
        var warn = luminance(fg) > 0.55 ? '<span class="warn">颜色过浅，可能扫不出</span>' : '';
        $('meta').innerHTML =
          '版本 <b>v' + m.version + '</b>' +
          '<span>' + m.size + '×' + m.size + ' 模块</span>' +
          '<span>纠错 ' + m.ecl + '</span>' +
          '<span>' + bytes + ' 字节</span>' +
          (warn ? warn : '');
      } else {
        var raw = text;
        var bc = L.barcodeEncode(raw, state.bcFormat);
        var boxW2 = $('cv').parentNode.clientWidth - 28;
        var maxPx2 = Math.max(220, Math.min(560, Math.floor(boxW2)));
        cv.style.display = 'block';
        $('emptyTip').style.display = 'none';
        $('errTip').style.display = 'none';
        var dpr2 = Math.min(window.devicePixelRatio || 1, 3);
        var barH = state.bcHeight * dpr2;
        paintBC(cv, bc, barH, state.bcShowText, maxPx2 * dpr2, state.fg, '#ffffff');
        cv.style.width = Math.round(maxPx2) + 'px';
        cv.style.height = 'auto';

        current = { kind: 'bc', bc: bc };

        $('meta').innerHTML =
          '<b>' + bc.format + '</b>' +
          '<span>' + bc.bits.length + ' 模块</span>' +
          '<span>' + (bc.format === 'EAN13' ? '13 位' : raw.length + ' 字符') + '</span>' +
          (luminance(state.fg) > 0.55 ? '<span class="warn">颜色过浅，可能扫不出</span>' : '');
      }
      setActionsEnabled(true);

    } catch (e) {
      showError(e.message || String(e));
    }
  }

  /* ---------------- 输入 ---------------- */
  var debounce = null;
  function onInput() {
    current = null;
    setActionsEnabled(false);
    state.text = ta.value;
    $('counter').textContent = countText(ta.value);
    checkUrlHint();
    clearTimeout(debounce);
    debounce = setTimeout(render, 140);
  }
  function countText(s) {
    var bytes = L.utf8Bytes(s).length;
    return s.length + ' 字' + (bytes !== s.length ? ' · ' + bytes + ' 字节' : '');
  }

  var URL_RE = /^(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|cn|net|org|io|me|co|cc|dev|app|xyz|top|info|tv|gov|edu)(?:\/[^\s]*)?)(?::\d+)?$/i;
  function checkUrlHint() {
    var v = ta.value.trim();
    var bar = $('urlHint');
    if (v && !/^[a-z][a-z0-9+.-]*:/i.test(v) && !/\s/.test(v) && URL_RE.test(v)) {
      bar.classList.add('show');
      bar._target = 'https://' + v;
    } else {
      bar.classList.remove('show');
    }
  }
  $('urlFix').addEventListener('click', function () {
    var t = $('urlHint')._target;
    if (t) { ta.value = t; onInput(); ta.focus(); }
    $('urlHint').classList.remove('show');
  });

  ta.addEventListener('input', onInput);
  ta.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); render(); }
  });

  /* ---------------- 模式切换 ---------------- */
  function applyMode() {
    var isQR = state.mode === 'qr';
    var isBC = state.mode === 'barcode';
    var isClash = state.mode === 'clash';

    $('mainQr').style.display = (isQR || isBC) ? '' : 'none';
    $('mainClash').style.display = isClash ? '' : 'none';

    if (isClash) { renderClash(); return; }

    $('qrOpts').style.display = isQR ? '' : 'none';
    $('bcOpts').style.display = isBC ? '' : 'none';
    $('inputLabel').textContent = isQR ? '内容' : '条码内容';
    ta.placeholder = isQR
      ? '输入文字或网址，自动生成二维码'
      : state.bcFormat === 'EAN13' ? '输入 12 或 13 位数字，如：690123456789'
      : state.bcFormat === 'CODE39' ? '输入英文字母、数字或 - . 空格 $ / + %'
      : '输入数字或字母，如：ABC-123';
    render();
  }

  /* ---------------- 选项 ---------------- */
  $('eclSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
    state.ecl = b.dataset.ecl;
    render();
  });

  $('swatches').addEventListener('click', function (e) {
    var b = e.target.closest('.sw');
    if (!b) return;
    Array.prototype.forEach.call(document.querySelectorAll('.sw'), function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    state.fg = b.dataset.color;
    $('colorPick').value = state.fg;
    render();
  });
  $('colorPick').addEventListener('input', function () {
    Array.prototype.forEach.call(document.querySelectorAll('.sw'), function (x) { x.classList.remove('on'); });
    state.fg = this.value;
    render();
  });

  $('fmtSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
    state.bcFormat = b.dataset.fmt;
    if (state.bcFormat === 'EAN13') {
      ta.placeholder = '输入 12 或 13 位数字，如：690123456789';
    } else if (state.bcFormat === 'CODE39') {
      ta.placeholder = '输入 0-9 A-Z 及 - . 空格 $ / + %';
    } else {
      ta.placeholder = '输入数字或字母，如：ABC-123';
    }
    render();
  });

  $('bcHeight').addEventListener('input', function () {
    state.bcHeight = +this.value;
    $('bcHeightVal').textContent = this.value + ' px';
    render();
  });
  $('bcText').addEventListener('change', function () {
    state.bcShowText = this.checked;
    render();
  });

  /* ---------------- 模板 ---------------- */
  var TPL = {
    url: 'https://',
    text: '',
    wifi: 'WIFI:T:WPA;S:我的Wi-Fi;P:密码123456;;',
    vcard: 'BEGIN:VCARD\nVERSION:3.0\nN:鲁班\nORG:个人\nTEL:13800138000\nEMAIL:name@example.com\nURL:https://example.com\nEND:VCARD',
    tel: 'tel:13800138000',
    sms: 'SMSTO:13800138000:你好',
    mail: 'mailto:name@example.com?subject=主题&body=正文'
  };
  $('templates').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    var t = b.dataset.tpl;
    if (state.mode === 'barcode') {
      toast('条形码模式下不支持该模板');
      return;
    }
    ta.value = TPL[t] || '';
    onInput();
    ta.focus();
    if (t === 'url') { ta.setSelectionRange(ta.value.length, ta.value.length); }
  });

  /* ---------------- 导出 ---------------- */
  function stampStr() {
    var d = new Date();
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function fileName(ext) {
    return 'qrcode-' + stampStr() + '.' + ext;
  }

  function buildExportCanvas() {
    if (!current) return null;
    var c = document.createElement('canvas');
    var px = state.saveSize;
    if (current.kind === 'qr') {
      paintQR(c, current.m, px, state.fg, '#ffffff', 4);
    } else {
      var dprLike = Math.max(2, Math.round(px / 400));
      var barH = state.bcHeight * dprLike;
      paintBC(c, current.bc, barH, state.bcShowText, px, state.fg, '#ffffff');
    }
    return c;
  }

  function triggerDownload(url, name) {
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); }, 100);
  }

  /* Chrome / Edge 支持 File System Access API：可弹「另存为」让用户自选路径。
     Safari 不支持，只能落到浏览器默认下载目录。 */
  function canPickPath() {
    return typeof window.showSaveFilePicker === 'function';
  }

  function dataURLtoBlob(dataUrl) {
    var parts = String(dataUrl).split(',');
    var m = /:(.*?);/.exec(parts[0]);
    var mime = m ? m[1] : 'application/octet-stream';
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    triggerDownload(url, fileName);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  /**
   * 保存文件：优先弹「另存为」让用户选路径，不支持则回退默认下载目录。
   * @returns {Promise<'picked'|'downloaded'|'cancel'>}
   */
  function saveBlob(blob, fileName, mime, desc, pickId) {
    if (!canPickPath()) {
      downloadBlob(blob, fileName);
      return Promise.resolve('downloaded');
    }
    var dot = fileName.lastIndexOf('.');
    var ext = dot > 0 ? fileName.slice(dot) : '';
    var opts = { id: pickId || 'luban-save', suggestedName: fileName };
    if (ext) {
      var accept = {};
      accept[mime] = [ext];
      opts.types = [{ description: desc || '文件', accept: accept }];
    }
    return window.showSaveFilePicker(opts).then(function (handle) {
      return handle.createWritable().then(function (w) {
        return w.write(blob).then(function () { return w.close(); }).then(function () { return 'picked'; });
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return 'cancel';
      downloadBlob(blob, fileName);
      return 'downloaded';
    });
  }

  function afterSave(res, extra) {
    if (res === 'picked') toast('已保存到你选择的位置' + (extra ? ' · ' + extra : ''));
    else if (res === 'downloaded') toast('已下载到浏览器默认目录（一般是「下载」）' + (extra ? ' · ' + extra : ''));
    else if (res === 'cancel') toast('已取消保存');
  }

  $('savePng').addEventListener('click', function () {
    var c = buildExportCanvas();
    if (!c) return;
    var url = c.toDataURL('image/png');
    var name = fileName('png');
    if (isIOS()) {
      $('ovImg').src = url;
      $('ovImg')._name = name;
      $('overlay').classList.add('show');
      return;
    }
    saveBlob(dataURLtoBlob(url), name, 'image/png', 'PNG 图片', 'luban-png').then(function (res) {
      afterSave(res, c.width + '×' + c.height);
    });
  });

  $('ovDownload').addEventListener('click', function () {
    triggerDownload($('ovImg').src, $('ovImg')._name || fileName('png'));
    toast('已下载到「文件」');
  });
  $('ovClose').addEventListener('click', function () {
    $('overlay').classList.remove('show');
  });
  $('overlay').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('show');
  });

  /* ---- SVG 导出 ---- */
  function qrToSVG(m, fg, quiet) {
    var n = m.size, total = n + quiet * 2;
    var d = '';
    for (var y = 0; y < n; y++) {
      var x = 0;
      while (x < n) {
        if (m.modules[y][x]) {
          var run = 1;
          while (x + run < n && m.modules[y][x + run]) run++;
          d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h' + run + 'v1h-' + run + 'z';
          x += run;
        } else {
          x++;
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total +
      '" width="' + total * 8 + '" height="' + total * 8 + '" shape-rendering="crispEdges">' +
      '<rect width="' + total + '" height="' + total + '" fill="#ffffff"/>' +
      '<path d="' + d + '" fill="' + fg + '"/></svg>';
  }

  function bcToSVG(bc, barH, showText, fg) {
    var quiet = bc.quietLeft + bc.quietRight;
    var totalMods = bc.bits.length + quiet;
    var textH = showText ? Math.round(barH * 0.24) : 0;
    var h = barH + textH;
    var rects = '';
    for (var i = 0; i < bc.bits.length; i++) {
      if (bc.bits[i]) rects += '<rect x="' + (bc.quietLeft + i) + '" y="0" width="1" height="' + barH + '"/>';
    }
    var text = '';
    if (showText) {
      var fs = Math.round(textH * 0.72);
      text = '<text x="' + (totalMods / 2) + '" y="' + (barH + textH / 2 + fs * 0.34) +
        '" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="' + fs +
        '" font-weight="600" fill="' + fg + '">' + escapeXml(bc.humanReadable) + '</text>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + totalMods + ' ' + h +
      '" width="' + totalMods * 4 + '" height="' + h * 4 + '" shape-rendering="crispEdges">' +
      '<rect width="' + totalMods + '" height="' + h + '" fill="#ffffff"/>' +
      '<g fill="' + fg + '">' + rects + '</g>' + text + '</svg>';
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  $('saveSvg').addEventListener('click', function () {
    if (!current) return;
    var svg = current.kind === 'qr'
      ? qrToSVG(current.m, state.fg, 4)
      : bcToSVG(current.bc, state.bcHeight, state.bcShowText, state.fg);
    var blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    saveBlob(blob, fileName('svg'), 'image/svg+xml', 'SVG 矢量图', 'luban-svg').then(function (res) {
      afterSave(res, '矢量可无损缩放');
    });
  });

  /* ---- 复制图片 ---- */
  $('copyImg').addEventListener('click', function () {
    var c = buildExportCanvas();
    if (!c) return;
    if (!navigator.clipboard || !window.ClipboardItem) {
      toast('当前浏览器不支持复制图片，请用「保存 PNG」');
      return;
    }
    c.toBlob(function (blob) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () {
        toast('图片已复制到剪贴板');
      }).catch(function () {
        toast('复制失败，请用「保存 PNG」');
      });
    }, 'image/png');
  });

  /* ---------------- 订阅转换 ---------------- */
  var clashState = { out: 'b64', dir: 'c2s', result: null };

  function applyClashDir() {
    var isRev = clashState.dir === 's2c';
    $('clashLabel').textContent = isRev ? '小火箭订阅' : 'Clash 配置';
    $('outRow').style.display = isRev ? 'none' : '';
    $('saveTxtLabel').textContent = isRev ? '保存 yaml' : '保存 txt';
    $('dropTitle').textContent = isRev ? '拖入 txt 订阅，或点击选择' : '拖入 YAML 文件，或点击选择';
    $('dropSub').textContent = isRev ? '支持 Base64 订阅与明文链接列表' : '支持 Clash / Clash Verge / Mihomo 配置';
    $('clashTa').placeholder = isRev
      ? 'vless://uuid@host:443?security=reality&…#节点名\nvmess://base64…\nss://…'
      : 'proxies:\n  - name: 节点名\n    type: vless\n    server: 1.2.3.4\n    port: 443\n    uuid: …';
    $('dropZone').classList.remove('loaded');
  }

  function renderClash() {
    var raw = $('clashTa').value.trim();
    var prefix = $('namePrefix').value.trim();
    var isB64 = clashState.out !== 'plain';
    var isRev = clashState.dir === 's2c';

    function idle(msg) {
      clashState.result = null;
      $('stTotal').textContent = '0';
      $('stOk').textContent = '0';
      $('stSkip').textContent = '0';
      $('nodeList').innerHTML = '<div class="node-empty">' + msg + '</div>';
      $('saveTxt').disabled = true;
      $('copyTxt').disabled = true;
    }

    if (!raw) {
      idle(isRev ? '载入订阅后<br>这里显示 Clash 节点' : '载入配置后<br>这里显示转换结果');
      $('clashNotice').innerHTML = '';
      return;
    }

    var r;
    try {
      r = isRev
        ? LC.urisToYaml(raw, { namePrefix: prefix })
        : LC.convert(raw, { base64: isB64, namePrefix: prefix });
    } catch (err) {
      idle('无法解析');
      $('clashNotice').innerHTML = '<div class="notice err">' + escapeXml(err.message || '转换失败') + '</div>';
      return;
    }

    clashState.result = r;
    $('stTotal').textContent = r.total;
    $('stOk').textContent = r.ok;
    $('stSkip').textContent = r.skipped.length;

    $('nodeList').innerHTML = r.details.length
      ? r.details.map(function (d) {
          return '<div class="node-item' + (d.skip ? ' skip' : '') + '">' +
            '<span class="nm">' + escapeXml(d.name) + '</span>' +
            (d.skip ? '<span class="reason">' + escapeXml(d.reason) + '</span>' : '') +
            '<span class="tp">' + escapeXml(d.type) + '</span></div>';
        }).join('')
      : '<div class="node-empty">没有可用节点</div>';

    if (r.ok === 0) {
      $('clashNotice').innerHTML = '<div class="notice err">没有成功转换的节点，原因见上方列表</div>';
    } else if (r.skipped.length) {
      $('clashNotice').innerHTML = '<div class="notice">' + r.skipped.length + ' 个节点未转换（原因见上）</div>';
    } else {
      $('clashNotice').innerHTML = '<div class="notice ok">' + r.ok + ' 个节点已全部转换' +
        (isRev ? '，已生成 Clash YAML' : (isB64 ? '，已做 Base64 编码' : '，明文格式')) + '</div>';
    }
    $('saveTxt').disabled = !r.ok;
    $('copyTxt').disabled = !r.ok;
  }

  var fileReadId = 0;
  function loadClashFile(file) {
    if (!file) return;
    // 大文件保护
    if (file.size > 8 * 1024 * 1024) { toast('文件过大（>8MB），请确认是配置而非二进制'); return; }
    clearTimeout(clashDebounce);
    invalidateClash();
    var readId = ++fileReadId;
    var fr = new FileReader();
    fr.onload = function () {
      if (readId !== fileReadId) return;
      $('clashTa').value = String(fr.result || '');
      $('dropZone').classList.add('loaded');
      $('dropTitle').textContent = file.name;
      $('dropSub').textContent = (file.size / 1024).toFixed(1) + ' KB · 点击可重新选择';
      $('clashMeta').textContent = file.name;
      renderClash();
      var n = clashState.result ? clashState.result.ok : 0;
      toast(n ? '已转换 ' + n + ' 个节点' : '已载入，但未识别到节点');
    };
    fr.onerror = function () { if (readId === fileReadId) { renderClash(); toast('文件读取失败'); } };
    fr.readAsText(file, 'utf-8');
  }

  $('fileInput').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (f) loadClashFile(f);
    this.value = '';  // 允许重复选择同一文件
  });

  (function bindDrop() {
    var dz = $('dropZone');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); });
    });
    ['dragleave', 'dragend', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); });
    });
    dz.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadClashFile(f);
    });
  })();

  var clashDebounce = null;
  function invalidateClash() {
    clashState.result = null;
    $('saveTxt').disabled = true;
    $('copyTxt').disabled = true;
  }
  $('clearClash').addEventListener('click', function () {
    fileReadId++;
    clearTimeout(clashDebounce);
    $('fileInput').value = '';
    $('clashTa').value = '';
    $('namePrefix').value = '';
    $('clashMeta').textContent = '未载入';
    applyClashDir();
    renderClash();
  });
  $('clashTa').addEventListener('input', function () {
    fileReadId++;
    invalidateClash();
    applyClashDir();
    $('clashMeta').textContent = '已输入 ' + L.utf8Bytes(this.value).length + ' 字节';
    clearTimeout(clashDebounce);
    clashDebounce = setTimeout(renderClash, 220);
  });
  $('namePrefix').addEventListener('input', function () {
    invalidateClash();
    clearTimeout(clashDebounce);
    clashDebounce = setTimeout(renderClash, 200);
  });
  $('outSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
    clashState.out = b.dataset.out;
    renderClash();
  });

  $('dirSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
    clashState.dir = b.dataset.dir;
    applyClashDir();
    renderClash();
  });

  $('saveTxt').addEventListener('click', function () {
    var r = clashState.result;
    if (!r || !r.text) return;
    var isRev = clashState.dir === 's2c';
    var blob = new Blob([r.text], { type: isRev ? 'text/yaml;charset=utf-8' : 'text/plain;charset=utf-8' });
    var fname = (isRev ? 'clash-' : 'shadowrocket-') + stampStr() + (isRev ? '.yaml' : '.txt');
    saveBlob(blob, fname, isRev ? 'text/yaml' : 'text/plain',
      isRev ? 'Clash 配置' : '文本文件', isRev ? 'luban-yaml' : 'luban-txt').then(function (res) {
      afterSave(res, r.ok + ' 个节点');
    });
  });

  $('copyTxt').addEventListener('click', function () {
    var r = clashState.result;
    if (!r || !r.text) return;
    if (!navigator.clipboard) { toast('当前浏览器不支持复制'); return; }
    navigator.clipboard.writeText(r.text).then(function () {
      toast('已复制到剪贴板');
    }).catch(function () {
      toast('复制失败，请用「保存 txt」');
    });
  });

  /* ---------------- 二维码历史记录 ---------------- */
  var codeHistory = [];
  var MAX_HIST = 8;

  function loadHistory() { return codeHistory.slice(); }
  function saveHistory(arr) { codeHistory = arr.slice(0, MAX_HIST); }
  $('rememberCode').addEventListener('click', function () {
    if (!current) return;
    var text = state.text;
    var list = loadHistory().filter(function (x) { return x.text !== text || x.mode !== state.mode; });
    list.unshift({ text: text, mode: state.mode, format: state.bcFormat });
    saveHistory(list);
    renderHistory();
  });
  function renderHistory() {
    var list = loadHistory();
    var box = $('histList');
    if (!list.length) {
      box.innerHTML = '<div class="hist-empty">点击「记下当前内容」可暂存；离开页面后清空</div>';
      return;
    }
    box.innerHTML = list.map(function (h, i) {
      var t = h.text.replace(/\s+/g, ' ');
      if (t.length > 46) t = t.slice(0, 46) + '…';
      return '<div class="hist-item" data-i="' + i + '">' +
        '<span class="tag">' + (h.mode === 'barcode' ? 'BC' : 'QR') + '</span>' +
        '<span class="txt">' + escapeXml(t) + '</span>' +
        '<button class="del" data-del="' + i + '" aria-label="删除">×</button></div>';
    }).join('');
  }
  $('histList').addEventListener('click', function (e) {
    var del = e.target.closest('.del');
    if (del) {
      var list = loadHistory();
      list.splice(+del.dataset.del, 1);
      saveHistory(list);
      renderHistory();
      e.stopPropagation();
      return;
    }
    var item = e.target.closest('.hist-item');
    if (!item) return;
    var h = loadHistory()[+item.dataset.i];
    if (!h) return;
    if (h.mode === 'barcode') document.querySelector('#fmtSeg [data-fmt="' + h.format + '"]').click();
    ta.value = h.text;
    onInput();
    ta.focus();
  });
  $('clearHist').addEventListener('click', function () {
    saveHistory([]);
    renderHistory();
    toast('已清空记录');
  });

  /* ---------------- 启动 ---------------- */
  renderHistory();
  setActionsEnabled(false);
  $('counter').textContent = '0 字';
  applyClashDir();

  // 首次渲染 + 字体就绪后重绘一次
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { render(); });
  }

  // 窗口尺寸变化时重绘（保持清晰）
  var rzTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(function () { if (state.text) render(); }, 180);
  });

  // 主题切换时重绘（配色相关）
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', function () { render(); });
  }

  applyMode();
})();
