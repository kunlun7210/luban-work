import { generatePasswords } from './passwords.mjs';
const $ = id => document.getElementById(id);
const main = $('tool-content');
const tool = main.dataset.tool;
const bind = (id, event, handler) => $(id).addEventListener(event, handler);

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

async function copy(text, status) {
  try { await navigator.clipboard.writeText(text); $(status).textContent = '已复制'; }
  catch { $(status).textContent = '请手动选择并复制结果。'; }
}

function passwordTool() {
  main.innerHTML = '<form id="options" class="tool-panel tool-form"><label for="length">密码长度 <span id="length-value">16</span></label><input id="length" type="range" min="4" max="32" value="16"><label for="quantity">密码数量 <span id="quantity-value">10</span></label><input id="quantity" type="range" min="1" max="10" value="10"><div class="actions"><label><input id="number" type="checkbox" checked> 数字</label><label><input id="lowercase" type="checkbox" checked> 小写字母</label><label><input id="uppercase" type="checkbox"> 大写字母</label><label><input id="allSymbols" type="checkbox"> 特殊符号（全部符号）</label><label><input id="excludeAmbiguous" type="checkbox"> 排除易混淆字符</label><label><input id="symbol" type="checkbox"> 特殊符号（@ 和 ！）</label></div><div class="actions"><button class="primary">生成</button><button id="copy" type="button">复制全部</button></div><p id="status" class="status" role="status"></p><pre id="out" class="tool-output"></pre></form>';
  const groups=['number','lowercase','uppercase','allSymbols','excludeAmbiguous','symbol'];
  const generate = () => {
    const output = generatePasswords(Object.fromEntries([
      ['length', $('length').value], ['quantity', $('quantity').value],
      ...groups.map(group=>[group,$(group).checked]),
    ]));
    $('out').textContent = output;
    $('copy').disabled = !output;
    $('status').textContent = output ? '' : '请选择至少一种字符。';
  };
  for (const id of ['length','quantity']) bind(id,'input',()=> { $(id+'-value').textContent=$(id).value; });
  bind('allSymbols','change',()=>{if ($('allSymbols').checked) $('symbol').checked=false;});
  bind('symbol','change',()=>{if ($('symbol').checked) $('allSymbols').checked=false;});
  bind('options','submit',event=>{event.preventDefault();generate();});
  bind('copy','click',()=>copy($('out').textContent,'status'));
  generate();
}

async function qrTool() {
  await import('./codes.js');
  const templates = { 网址:'https://example.com', 'Wi-Fi':'WIFI:T:WPA;S:网络名称;P:网络密码;;', 名片:'BEGIN:VCARD\nVERSION:3.0\nFN:姓名\nTEL:13800138000\nEND:VCARD', 电话:'tel:13800138000', 短信:'SMSTO:13800138000:你好', 邮件:'mailto:name@example.com?subject=主题' };
  main.innerHTML = '<section class="tool-panel tool-form"><label for="qr-text">二维码内容</label><textarea id="qr-text" rows="4" maxlength="7400"></textarea><div id="templates" class="actions"></div><div class="actions"><label>纠错等级 <select id="ecc"><option value="L">L · 7%</option><option value="M" selected>M · 15%</option><option value="Q">Q · 25%</option><option value="H">H · 30%</option></select></label><label>前景色 <input id="color" type="color" value="#000000"></label></div><canvas class="preview-image" id="canvas" hidden></canvas><div class="actions"><button id="png" type="button" class="primary">下载 PNG</button><button id="svg" type="button">下载 SVG</button><button id="image-copy" type="button">复制图片</button></div><p class="status" id="message" role="status"></p></section><section class="tool-panel tool-form" id="reader"><h2>识别二维码</h2><label for="photo">选择、拖入或粘贴二维码图片</label><input id="photo" type="file" accept="image/*"><p class="status" id="scan-status" role="status"></p><pre class="tool-output" id="scan-result" hidden></pre><div class="actions"><button id="scan-copy" hidden>复制结果</button></div></section>';
  let matrix, timer, scans = 0;
  const ctx=$('canvas').getContext('2d');
  function refresh() {
    clearTimeout(timer);
    matrix = undefined;
    for (const id of ['png','svg','image-copy']) $(id).disabled = true;
    $('canvas').hidden = true;
    $('message').textContent = '';
    if (!$('qr-text').value) return;
    timer=setTimeout(()=>{
      try {
        matrix = globalThis.LubanCode.qrEncode($('qr-text').value,$('ecc').value);
        const scale=Math.ceil(640/(matrix.size+8));
        const size=(matrix.size+8)*scale;
        ctx.canvas.width=ctx.canvas.height=size;
        ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);
        ctx.fillStyle=$('color').value;
        matrix.modules.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)ctx.fillRect((x+4)*scale,(y+4)*scale,scale,scale);}));
        ctx.canvas.hidden=false;
        for(const id of ['png','svg','image-copy']) $(id).disabled=false;
      } catch (error) { $('message').textContent=error.message; }
    },120);
  }
  for (const [name,value] of Object.entries(templates)) {
    const button=document.createElement('button');
    button.textContent=name;
    button.onclick=()=>{$('qr-text').value=value;refresh();$('qr-text').focus();$('qr-text').select();};
    $('templates').append(button);
  }
  for(const id of ['qr-text','ecc','color']) bind(id,'input',refresh);
  const png=()=>new Promise(resolve=>ctx.canvas.toBlob(resolve,'image/png'));
  bind('png','click',async()=>{const blob=await png();if(blob)download(blob,'qrcode.png');});
  bind('svg','click',()=>{
    if (!matrix) return;
    const size=matrix.size+8;
    const marks=[];
    matrix.modules.forEach((row,y)=>row.forEach((dark,x)=>{if(dark) marks.push('M'+(x+4)+' '+(y+4)+'h1v1h-1z');}));
    download(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'" width="'+size*8+'" height="'+size*8+'" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path fill="'+$('color').value+'" d="'+marks.join('')+'"/></svg>'],{type:'image/svg+xml'}),'qrcode.svg');
  });
  bind('image-copy','click',async()=>{
    try {await navigator.clipboard.write([new ClipboardItem({'image/png':png()})]);$('message').textContent='已复制图片';}
    catch {$('message').textContent='复制失败，可下载 PNG。';}
  });

  async function read(file) {
    if(!file)return;
    const request=++scans;
    const url=URL.createObjectURL(file);
    $('scan-status').textContent='正在识别…';
    $('scan-copy').hidden=$('scan-result').hidden=true;
    try {
      await import('./zxing.min.js');
      const image=new Image();
      image.src=url;
      await image.decode();
      if(request!==scans)return;
      const scale=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const draw=canvas.getContext('2d',{alpha:false});
      draw.fillStyle='#fff';draw.fillRect(0,0,canvas.width,canvas.height);
      draw.drawImage(image,0,0,canvas.width,canvas.height);
      const data=draw.getImageData(0,0,canvas.width,canvas.height).data;
      const grey=new Uint8ClampedArray(canvas.width*canvas.height);
      for(let n=0;n<grey.length;n++) grey[n]=(data[4*n]+2*data[4*n+1]+data[4*n+2])>>2;
      const z=globalThis.ZXing;
      const binary=new z.BinaryBitmap(new z.HybridBinarizer(new z.RGBLuminanceSource(grey,canvas.width,canvas.height)));
      let result;
      try { result=new z.QRCodeReader().decode(binary,new Map([[z.DecodeHintType.TRY_HARDER,true]])); }
      catch { result=new z.QRCodeReader().decode(binary,new Map([[z.DecodeHintType.PURE_BARCODE,true]])); }
      $('scan-result').textContent=result.getText();
      $('scan-copy').hidden=$('scan-result').hidden=false;
      $('scan-status').textContent='';
    } catch { if(request===scans)$('scan-status').textContent='未识别到二维码，请换一张清晰图片。'; }
    finally {URL.revokeObjectURL(url);}
  }
  bind('photo','change',event=>{read(event.target.files[0]);event.target.value='';});
  bind('reader','dragover',event=>event.preventDefault());
  bind('reader','drop',event=>{event.preventDefault();read(event.dataTransfer.files[0]);});
  document.addEventListener('paste',event=>{
    const photo=Array.from(event.clipboardData?.items||[]).find(item=>item.type.startsWith('image/'));
    if(photo){event.preventDefault();read(photo.getAsFile());}
  });
  bind('scan-copy','click',()=>copy($('scan-result').textContent,'scan-status'));
  refresh();
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8',{fatal:true});
const transforms = {
  'base64-encoding': ['编码','解码',
    text=>btoa(Array.from(encoder.encode(text), byte=>String.fromCharCode(byte)).join('')),
    text=>decoder.decode(Uint8Array.from(atob(text), character=>character.charCodeAt(0)))],
  'binary-codec': ['编码','解码',
    text=>Array.from(encoder.encode(text), byte=>byte.toString(2).padStart(8,'0')).join(' '),
    text=>{const bits=text.replace(/\s/g,'');if(!/^(?:[01]{8})*$/.test(bits))throw Error('请输入由 8 位一组组成的二进制数据。');return decoder.decode(Uint8Array.from(bits.match(/.{8}/g)||[],part=>parseInt(part,2)));}],
  'unicode-converter': ['编码','解码',
    text=>text.split('').map(character=>'\\u'+character.charCodeAt(0).toString(16).padStart(4,'0')).join(''),
    text=>text.replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)))],
  'json-editor': ['格式化','压缩',text=>JSON.stringify(JSON.parse(text),null,2),text=>JSON.stringify(JSON.parse(text))],
  'params-serialization': ['JSON 转查询参数','查询参数转 JSON',
    text=>{const parsed=JSON.parse(text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('请输入 JSON 对象。');const result=new URLSearchParams();for(const [key,value] of Object.entries(parsed)){for(const item of Array.isArray(value)?value:[value])result.append(key,item===null?'':String(item));}return result.toString();},
    text=>{const result=Object.create(null);for(const [key,value] of new URLSearchParams(text)){if(!Object.hasOwn(result,key))result[key]=value;else result[key]=[].concat(result[key],value);}return JSON.stringify(result,null,2);}],
  'text-statistics': ['统计',null,text=>'字数（含空白）：'+[...text].length+'\n字数（不含空白）：'+[...text.replace(/\s/gu,'')].length+'\n行数：'+(text?text.split(/\r\n|\n|\r/).length:0)+'\nUTF-8 字节数：'+encoder.encode(text).length],
  'factorial-calculator': ['计算阶乘',null,text=>{if(!/^\d+$/.test(text.trim()))throw Error('请输入 0–1000 的整数。');const n=Number(text);if(n>1000)throw Error('请输入 0–1000 的整数。');let result=1n;for(let i=2n;i<=n;i++)result*=i;return result.toString();}],
  'timestamp': ['时间戳转日期','日期转时间戳',
    text=>{const raw=text.trim();if(!/^-?\d+$/.test(raw))throw Error('请输入秒或毫秒时间戳。');const number=Number(raw);const value=new Date(raw.replace('-','').length<=10?number*1000:number);return value.toISOString()+'\n'+value.toLocaleString();},
    text=>{const time=Date.parse(text.trim());if(!Number.isFinite(time))throw Error('请输入有效日期，例如 2026-11-17T12:00:00+08:00。');return '秒：'+Math.floor(time/1000)+'\n毫秒：'+time;}],
};

function transformTool(spec) {
  main.innerHTML = '<section class="tool-panel tool-form"><label for="value">输入</label><textarea rows="6" id="value"></textarea><div class="actions" id="commands"></div><p class="status" id="status" role="status"></p><pre class="tool-output" id="result"></pre></section>';
  const commands=$('commands');
  for(const [index,label] of spec.slice(0,2).entries()){
    if(!label)continue;
    const button=document.createElement('button');
    button.className=index===0?'primary':'';
    button.textContent=label;
    button.onclick=()=>{
      $('result').textContent='';
      $('status').textContent='';
      try{$('result').textContent=spec[index+2]($('value').value);}
      catch(error){$('status').textContent=error.message;}
    };
    commands.append(button);
  }
  const button=document.createElement('button');
  button.textContent='复制结果';
  button.onclick=()=>copy($('result').textContent,'status');
  commands.append(button);
}

if(tool==='password-generator')passwordTool();
else if(tool==='qrcode')await qrTool();
else transformTool(transforms[tool]);
