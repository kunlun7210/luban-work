import {choice,field,file,files,node,number,select,text} from './ui.mjs';
const vendor=pathname=>import('../vendor-extra/'+pathname);
const form=(fields,label,run,help)=>({fields,actions:[choice(label,run)],help});
const zipLib=()=>import('../../vip/vendor/fflate.mjs');
const zipType='application/zip';
const asFile=(data,name,type)=>({blob:new Blob([data],{type}),name});
const asBytes=async file=>new Uint8Array(await file.arrayBuffer());
const cleanName=name=>name.replace(/[\\/:\x00-\x1f]/g,'_').replace(/^\.+/,'')||'file';
const max=1024*1024;
async function zipFiles(entries, name) {
  const {zipSync}=await zipLib();
  return files(asFile(zipSync(entries,{level:5}),name,zipType));
}
function canvas(w,h){
  const canvas=document.createElement('canvas');
  canvas.width=w;canvas.height=h;
  return canvas;
}
const png=surface=>new Promise((resolve,reject)=>surface.toBlob(blob=>blob?resolve(blob):reject(Error('导出图片失败。'))));
async function image(file) {
  if(file.size>40*max)throw Error('图片文件需小于 40 MB。');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();
    image.src=url;
    await image.decode();
    return image;
  }catch{throw Error('无法解码图片。');}
  finally{URL.revokeObjectURL(url);}
}

async function pdfToImages({input,range,scale},progress) {
  const root=new URL('../vendor-extra/pdfjs/',import.meta.url);
  const pdfjs=await vendor('pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.mjs',root).href;
  if(input[0].size>80*max)throw Error('请选择小于 80 MB 的 PDF。');
  const job=pdfjs.getDocument({data:await asBytes(input[0]),isEvalSupported:false,
    cMapUrl:new URL('cmaps/',root).href,cMapPacked:true,standardFontDataUrl:new URL('standard_fonts/',root).href,
    wasmUrl:new URL('wasm/',root).href,iccUrl:new URL('iccs/',root).href});
  try{
    const pdf=await job.promise;
    const picked=new Set();
    for(const segment of (range.trim()||('1-'+pdf.numPages)).split(',')){
      const range=segment.trim().match(/^(\d+)(?:-(\d+))?$/);
      if(!range)throw Error('页码格式示例：1,3-5。');
      const first=Number(range[1]),last=Number(range[2]||range[1]);
      if(first<1||last<first||last>pdf.numPages||last-first>49)throw Error('页码越界，每次最多转换 50 页。');
      for(let page=first;page<=last;page++)picked.add(page);
    }
    if(picked.size>50)throw Error('每次最多转换 50 页。');
    const output={};
    for(const [index,page] of [...picked].entries()){
      progress('渲染 '+(index+1)+' / '+picked.size);
      const documentPage=await pdf.getPage(page);
      const provisional=documentPage.getViewport({scale:Number(scale)});
      const viewport=documentPage.getViewport({scale:Number(scale)*Math.min(1,4096/Math.max(provisional.width,provisional.height))});
      const target=canvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
      await documentPage.render({canvas:target,canvasContext:target.getContext('2d'),viewport}).promise;
      output['第-'+page+'-页.png']=await asBytes(await png(target));
      documentPage.cleanup();
    }
    if(picked.size===1){
      const [name,data]=Object.entries(output)[0];
      return files({...asFile(data,name,'image/png'),preview:true});
    }
    return await zipFiles(output,'PDF-图片.zip');
  }finally{await job.destroy();}
}

async function gifSplit({input},progress) {
  const source=input[0];
  if(source.size>25*max)throw Error('请选择小于 25 MB 的 GIF。');
  const {parseGIF,decompressFrames}=await vendor('gifdecode.mjs');
  const gif=parseGIF(await source.arrayBuffer());
  const {width,height}=gif.lsd;
  const count=gif.frames.filter(frame=>frame.image).length;
  if(!count||count>180||width*height*count>70e6)throw Error('帧数或总像素过大。最多 180 帧、7000 万像素。');
  const frames=decompressFrames(gif,true);
  const stage=canvas(width,height),context=stage.getContext('2d',{willReadFrequently:true});
  const output={};
  const delays=[];
  for(const [index,frame] of frames.entries()){
    const {left,top,width,height}=frame.dims;
    const previous=frame.disposalType===3?context.getImageData(0,0,stage.width,stage.height):null;
    const patch=canvas(width,height);
    patch.getContext('2d').putImageData(new ImageData(frame.patch,width,height),0,0);
    context.drawImage(patch,left,top);
    output['frame-'+String(index+1).padStart(3,'0')+'.png']=await asBytes(await png(stage));
    delays.push(frame.delay||100);
    if(frame.disposalType===2)context.clearRect(left,top,width,height);
    if(previous)context.putImageData(previous,0,0);
    if(index%5===0)progress('导出帧 '+(index+1)+' / '+frames.length);
  }
  output['delays-ms.json']=new TextEncoder().encode(JSON.stringify(delays));
  return zipFiles(output,'GIF-逐帧.zip');
}
async function gifEncode({input,side,delay,loop},progress) {
  if(input.length>60)throw Error('每次最多使用 60 张图片。');
  const {GIFEncoder,quantize,applyPalette}=await vendor('gifencode.mjs');
  const first=await image(input[0]);
  const scale=Math.min(1,Number(side)/Math.max(first.naturalWidth,first.naturalHeight));
  const width=Math.max(1,Math.round(first.naturalWidth*scale)),height=Math.max(1,Math.round(first.naturalHeight*scale));
  const target=canvas(width,height),context=target.getContext('2d',{willReadFrequently:true});
  const encoder=GIFEncoder();
  for(const [index,file] of input.entries()){
    progress('编码帧 '+(index+1)+' / '+input.length);
    const loaded=index===0?first:await image(file);
    const factor=Math.min(width/loaded.naturalWidth,height/loaded.naturalHeight);
    const w=loaded.naturalWidth*factor,h=loaded.naturalHeight*factor;
    context.fillStyle='#fff';
    context.fillRect(0,0,width,height);
    context.drawImage(loaded,(width-w)/2,(height-h)/2,w,h);
    const rgba=context.getImageData(0,0,width,height).data;
    const palette=quantize(rgba,256);
    encoder.writeFrame(applyPalette(rgba,palette),width,height,{palette,delay:Number(delay),repeat:loop?0:-1});
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  encoder.finish();
  return files(asFile(encoder.bytes(),'合成.gif','image/gif'));
}
async function convertMedia(mode,{input,start,duration,width,fps},progress) {
  if(input[0].size>150*max)throw Error('请选择小于 150 MB 的媒体文件。');
  const {FFmpeg}=await vendor('ffmpeg/classes.js');
  let engine=new FFmpeg();
  engine.on('progress',({progress:value})=>{
    progress('转换中 '+Math.min(99,Math.max(0,Math.round(value*100)))+'%');
  });
  const timeout=setTimeout(()=>engine.terminate(),180000);
  const base='https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/';
  try{
    progress('正在加载 FFmpeg 浏览器引擎…');
    await engine.load({coreURL:base+'ffmpeg-core.js',wasmURL:base+'ffmpeg-core.wasm'});
    await engine.writeFile('input',await asBytes(input[0]));
    const trim=mode==='gif'?['-ss',String(start),'-t',String(duration)]:[];
    const config={
      gif:['output.gif','image/gif',['-an','-vf',`fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`,'-loop','0']],
      audio:['output.mp3','audio/mpeg',['-vn','-c:a','libmp3lame','-q:a','2']],
      mp4:['output.mp4','video/mp4',['-c:v','libx264','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart']],
    }[mode];
    const result=await engine.exec(['-i','input',...trim,...config[2],config[0]]);
    if(result!==0)throw Error('无法转换这份媒体文件，请检查格式和内容。');
    return files(asFile(await engine.readFile(config[0]),config[0],config[1]));
  }finally{clearTimeout(timeout);engine.terminate();}
}
function csv(results) {
  const cell=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  return results.map(row=>row.map(cell).join(',')).join('\r\n');
}
async function sqliteQuery({input,query}) {
  if(input[0].size>50*max)throw Error('请选择小于 50 MB 的 SQLite 文件。');
  const {default:create}=await vendor('sqlite/sql-wasm-browser.js');
  const sql=await create({locateFile:name=>new URL('../vendor-extra/sqlite/'+name,import.meta.url).href});
  const database=new sql.Database(await asBytes(input[0]));
  try{
    const blocks=database.exec(query.trim()||"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const root=node('section',{class:'tool-panel extra-table'});
    for(const result of blocks){
      const table=node('table');
      const heading=node('tr');
      heading.append(...result.columns.map(title=>node('th',{},title)));
      table.append(heading);
      const rows=result.values.slice(0,500).map(row=>row.map(value=>value instanceof Uint8Array?'[BLOB '+value.length+' 字节]':value));
      for(const row of rows){const line=node('tr');line.append(...row.map(value=>node('td',{},value==null?'NULL':String(value))));table.append(line);}
      root.append(table,node('details',{},''));
      const text=node('pre',{class:'tool-output'},csv([result.columns,...rows]));
      root.lastChild.append(node('summary',{},'查看 CSV'),text);
    }
    if(!blocks.length)root.append(node('p',{},'语句已执行，未返回结果。'));
    return root;
  }finally{database.close();}
}

export const media={
  'zip-archive':{fields:[file('input','选择文件或 ZIP 压缩包','',true)],actions:[
    choice('压缩为 ZIP',async({input})=>{
      if(input.length>100||input.reduce((size,file)=>size+file.size,0)>150*max)throw Error('最多 100 个文件，合计不超过 150 MB。');
      const entries=Object.create(null);
      for(const [index,file] of input.entries()){
        const name=cleanName(file.name);
        const key=Object.hasOwn(entries,name)?(index+1)+'-'+name:name;
        entries[key]=await asBytes(file);
      }
      return zipFiles(entries,'压缩包.zip');
    }),
    choice('解压 ZIP',async({input})=>{
      if(input.length!==1||input[0].size>100*max)throw Error('请选择一个小于 100 MB 的 ZIP。');
      const {unzipSync}=await zipLib();
      let total=0, entries=0;
      const unpacked=unzipSync(await asBytes(input[0]),{filter:item=>{
        if(item.name.endsWith('/'))return false;
        if(++entries>200||(total+=item.originalSize)>150*max)throw Error('解压上限为 200 个文件、150 MB。');
        return true;
      }});
      const output=Object.entries(unpacked).map(([name,data])=>asFile(data,cleanName(name),'application/octet-stream'));
      if(!output.length)throw Error('压缩包内没有文件。');
      return files(...output);
    })
  ]},
  'pdf2img':form([file('input','选择 PDF','.pdf,application/pdf'),field('range','页码范围','text',{placeholder:'留空表示全部，例如 1,3-5'}),number('scale','输出倍率',2,1,4,.5)],'转换为图片',pdfToImages),
  'gif-splitter':form([file('input','选择 GIF','image/gif,.gif')],'分解为 PNG',gifSplit),
  'gif-encoder':form([file('input','依次选择动画帧','image/*',true),number('side','最长边（像素）',480,32,960),
    number('delay','每帧间隔（毫秒）',150,20,10000,10),field('loop','循环播放','checkbox',{value:true})],'生成 GIF',gifEncode),
  'video2gif':form([file('input','选择视频','video/*,.mkv'),number('start','开始时间（秒）',0,0,36000,.1),number('duration','截取时长（秒）',5,1,30,.1),
    number('width','输出宽度（像素）',480,128,960,16),number('fps','每秒帧数',12,5,24)],'转换为 GIF',(values,progress)=>convertMedia('gif',values,progress),'转换在此设备运行。首次使用会从 unpkg 下载 FFmpeg 引擎。'),
  'webm2mp4':form([file('input','选择 WebM 视频','video/webm,.webm')],'转换为 MP4',(values,progress)=>convertMedia('mp4',values,progress),'转换在此设备运行。首次使用会从 unpkg 下载 FFmpeg 引擎。'),
  'audio-extractor':form([file('input','选择视频或音频','video/*,audio/*,.mkv')],'提取 MP3',(values,progress)=>convertMedia('audio',values,progress),'转换在此设备运行。首次使用会从 unpkg 下载 FFmpeg 引擎。'),
  'sqlite-viewer':form([file('input','选择 SQLite 数据库','.db,.sqlite,.sqlite3,application/vnd.sqlite3'),text('query','查询语句，可留空查看表名')],'执行查询',sqliteQuery,'查询在当前浏览器的内存副本执行。每组结果显示前 500 行。'),
  'micropython-interpreter':form([text('script','Python 代码','print("Hello, MicroPython!")')],'运行 Python',async({script})=>{
    const worker=new Worker(new URL('./python-worker.mjs',import.meta.url),{type:'module'});
    try{return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('加载或执行超时，已停止。')),9000);
      worker.onmessage=({data})=>{clearTimeout(timer);data.error?reject(Error(data.error)):resolve(data.output||'执行完成。');};
      worker.onerror=()=>{clearTimeout(timer);reject(Error('MicroPython 引擎启动失败。'));};
      worker.postMessage(script);
    });}finally{worker.terminate();}
  },'使用 MicroPython WebAssembly，支持基础 Python 语法和 MicroPython 标准模块。'),
  'lua-interpreter':form([text('script','Lua 代码','print("Hello, Lua!")')],'运行 Lua',async({script})=>{
    const worker=new Worker(new URL('./lua-worker.mjs',import.meta.url),{type:'module'});
    try{return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('执行超时，已停止。')),3500);
      worker.onmessage=({data})=>{clearTimeout(timer);data.error?reject(Error(data.error)):resolve(data.text||'执行完成。');};
      worker.onerror=()=>{clearTimeout(timer);reject(Error('Lua 引擎启动失败。'));};
      worker.postMessage(script);
    });}finally{worker.terminate();}
  },'支持 Lua 5.3 语法。运行过程与网页隔离。'),
};
