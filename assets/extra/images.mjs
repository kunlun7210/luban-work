import {choice,field,file,files,node,number,select,text} from './ui.mjs';
const vendor = pathname => import('../vendor-extra/'+pathname);
const outputFormats=[['image/png','PNG'],['image/jpeg','JPG'],['image/webp','WebP']];
const fileField=()=>file('images','选择图片','image/*');
const quality=()=>number('quality','画质（%）',85,1,100);
const maxSide=4096;
const single=(result)=>files(result);

function canvas(width,height) {
  if(width*height>24e6||width<1||height<1)throw Error('输出尺寸太大或无效。');
  const surface=document.createElement('canvas');
  surface.width=Math.round(width);surface.height=Math.round(height);
  return surface;
}
async function load(image) {
  if(!image)throw Error('请选择图片文件。');
  if(image.size>100*1024*1024)throw Error('图片文件需小于 100 MB。');
  const address=URL.createObjectURL(image);
  const decoded=new Image();
  decoded.src=address;
  try {await decoded.decode();return decoded;}
  catch {throw Error('无法读取图片，建议使用 PNG、JPG、WebP 或浏览器支持的格式。');}
  finally {URL.revokeObjectURL(address);}
}
function fit(width,height,limit=maxSide){const ratio=Math.min(1,limit/Math.max(width,height));return [Math.max(1,Math.round(width*ratio)),Math.max(1,Math.round(height*ratio))];}
function copyImage(image,width,height) {
  const surface=canvas(width,height);
  surface.getContext('2d').drawImage(image,0,0,surface.width,surface.height);
  return surface;
}
function exportCanvas(surface,type='image/png',quality=1) {
  const source=type==='image/jpeg'?canvas(surface.width,surface.height):surface;
  if(source!==surface){
    const context=source.getContext('2d');
    context.fillStyle='#fff';context.fillRect(0,0,source.width,source.height);
    context.drawImage(surface,0,0);
  }
  return new Promise((resolve,reject)=>source.toBlob(blob=>blob?.type===type?resolve(blob):reject(Error('此浏览器不支持该格式导出。')),type,quality));
}
function filename(original,suffix,format) {
  return (original?.replace(/\.[^.]+$/,'')||'图片')+suffix+'.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[format]||'png');
}
async function entry(surface,name,type='image/png',quality=1){return {blob:await exportCanvas(surface,type,quality),name,preview:true};}
async function pixels(source,transform) {
  const image=await load(source);
  const surface=copyImage(image,...fit(image.naturalWidth,image.naturalHeight));
  const ctx=surface.getContext('2d',{willReadFrequently:true});
  const frame=ctx.getImageData(0,0,surface.width,surface.height);
  transform(frame,ctx,surface);
  ctx.putImageData(frame,0,0);
  return surface;
}
const slugForm=(fields,label,run,help)=>({fields,actions:[choice(label,run)],help});
const luminance=(bytes,i)=>(bytes[i]*.299+bytes[i+1]*.587+bytes[i+2]*.114);
const hex=(...rgb)=>'#'+rgb.map(value=>Number(value).toString(16).padStart(2,'0')).join('');

export const images={
  'image-compressor':slugForm([file('images','选择图片','image/*',true),number('side','最长边（像素）',1920,64,4096),select('format','输出格式',outputFormats,'image/jpeg'),quality()],
    '压缩图片',async({images,side,format,quality},progress)=>{
      if(images.length>30)throw Error('每次最多 30 张。');
      const results=[];
      for(const [index,source] of images.entries()){
        progress('正在处理 '+(index+1)+' / '+images.length);
        const image=await load(source);
        results.push(await entry(copyImage(image,...fit(image.naturalWidth,image.naturalHeight,Number(side))),filename(source.name,'-压缩',format),format,Number(quality)/100));
      }
      return {files:results,message:'原图共 '+images.reduce((sum,image)=>sum+image.size,0).toLocaleString()+' 字节，输出共 '+results.reduce((sum,result)=>sum+result.blob.size,0).toLocaleString()+' 字节。'};
    }),
  'image-converter':slugForm([fileField(),select('format','输出格式',outputFormats),quality()],
    '转换格式',async({images,format,quality})=>{
      const image=await load(images[0]);
      return single(await entry(copyImage(image,...fit(image.naturalWidth,image.naturalHeight)),filename(images[0].name,'',format),format,Number(quality)/100));
    }),
  'picture-resizer':slugForm([fileField(),number('width','宽度（像素）',1080,1,4096),number('height','高度（像素）',1080,1,4096),field('aspect','保持比例，按宽度计算','checkbox',{value:true}),
    select('format','输出格式',outputFormats)],'调整尺寸',async({images,width,height,aspect,format})=>{
      const image=await load(images[0]);
      const h=aspect?Math.max(1,Math.round(width*image.naturalHeight/image.naturalWidth)):Number(height);
      if(h>4096)throw Error('结果高度超过 4096 像素，请缩小宽度。');
      return single(await entry(copyImage(image,Number(width),h),filename(images[0].name,'-缩放',format),format));
    }),
  'image2base64':slugForm([fileField(),field('prefix','包含 Data URL 前缀','checkbox',{value:true})],'转换为 Base64',async({images,prefix})=>{
    if(images[0].size>8*1024*1024)throw Error('请选择小于 8 MB 的图片。');
    const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('读取失败。'));reader.readAsDataURL(images[0]);});
    return prefix?encoded:encoded.split(',')[1];
  }),
  'text2image':slugForm([text('value','文字内容'),number('width','图片宽度（像素）',1000,320,2400),number('size','字号（像素）',42,10,120),
    field('ink','文字颜色','color',{value:'#26382d'}),field('paper','背景颜色','color',{value:'#faf6eb'})],'生成图片',async({value,width,size,ink,paper})=>{
    if(!value.trim()||value.length>6000)throw Error('请输入 1–6000 字的内容。');
    width=Number(width);size=Number(size);
    const temporary=canvas(32,32).getContext('2d');
    const font=size+'px system-ui, sans-serif';
    temporary.font=font;
    const lines=[];
    for(const paragraph of value.split(/\r?\n/)) {
      let line='';
      for(const character of paragraph){
        if(line&&temporary.measureText(line+character).width>width-64){lines.push(line);line='';}
        line+=character;
      }
      lines.push(line);
    }
    const spacing=Math.ceil(size*1.45);
    const output=canvas(width,64+spacing*lines.length);
    const ctx=output.getContext('2d');
    ctx.fillStyle=paper;ctx.fillRect(0,0,output.width,output.height);ctx.fillStyle=ink;ctx.font=font;ctx.textBaseline='top';
    lines.forEach((line,index)=>ctx.fillText(line,32,32+index*spacing));
    return single(await entry(output,'文字图片.png'));
  }),
  'watermark':slugForm([fileField(),field('mark','水印文字','text',{required:true,maxlength:80}),
    number('opacity','不透明度（%）',45,5,100),field('ink','水印颜色','color',{value:'#ffffff'}),
    select('position','位置',[['tile','平铺'],['bottom','右下角'],['center','正中']])],'加水印',async({images,mark,opacity,ink,position})=>{
    const image=await load(images[0]);
    const imageCanvas=copyImage(image,...fit(image.naturalWidth,image.naturalHeight));
    const {width,height}=imageCanvas;
    const ctx=imageCanvas.getContext('2d');
    const size=Math.max(12,Math.round(Math.min(width,height)/14));
    ctx.font='bold '+size+'px system-ui';
    ctx.fillStyle=ink;ctx.globalAlpha=Number(opacity)/100;
    ctx.strokeStyle='#383838';ctx.lineWidth=Math.max(1,size/13);ctx.textBaseline='middle';
    const paint=(x,y)=>{ctx.strokeText(mark,x,y);ctx.fillText(mark,x,y);};
    if(position==='tile'){
      const side=Math.hypot(width,height);
      const step=Math.max(size*4,ctx.measureText(mark).width+size*1.5);
      ctx.translate(width/2,height/2);ctx.rotate(-Math.PI/7);
      for(let y=-side/2;y<side/2;y+=size*3)for(let x=-side/2;x<side/2;x+=step)paint(x,y);
    }else{
      ctx.textAlign=position==='center'?'center':'right';
      paint(position==='center'?width/2:width-size/2,position==='center'?height/2:height-size);
    }
    return single(await entry(imageCanvas,filename(images[0].name,'-水印')));
  }),
  'image-invert':slugForm([fileField()],'反色',async({images})=>single(await entry(await pixels(images[0],({data})=>{
    for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)data[i+c]=255-data[i+c];
  }),filename(images[0].name,'-反色')))),
  'image-patina':slugForm([fileField(),number('strength','泛黄程度（%）',65,0,100)],'生成包浆效果',async({images,strength})=>single(await entry(await pixels(images[0],({data})=>{
    const factor=Number(strength)/100;
    for(let i=0;i<data.length;i+=4){
      const r=data[i],g=data[i+1],b=data[i+2];
      data[i]=Math.min(255,r*(1-factor)+factor*(.393*r+.769*g+.189*b));
      data[i+1]=Math.min(255,g*(1-factor)+factor*(.349*r+.686*g+.168*b));
      data[i+2]=Math.min(255,b*(1-factor)+factor*(.272*r+.534*g+.131*b));
    }
  }),filename(images[0].name,'-包浆')))),
  'picture-sketch':slugForm([fileField()],'转换为素描',async({images})=>single(await entry(await pixels(images[0],(frame,_context,surface)=>{
    const {data}=frame,{width,height}=surface;
    const reverse=canvas(width,height);
    const context=reverse.getContext('2d',{willReadFrequently:true});
    const gray=context.createImageData(width,height);
    for(let i=0;i<data.length;i+=4){
      const value=255-luminance(data,i);
      gray.data[i]=gray.data[i+1]=gray.data[i+2]=value;gray.data[i+3]=255;
    }
    context.putImageData(gray,0,0);
    const blurred=canvas(width,height).getContext('2d',{willReadFrequently:true});
    blurred.filter='blur('+Math.max(2,Math.min(width,height)/130)+'px)';
    blurred.drawImage(reverse,0,0);
    const overlay=blurred.getImageData(0,0,width,height).data;
    for(let i=0;i<data.length;i+=4){
      const value=Math.min(255,luminance(data,i)*255/Math.max(1,255-overlay[i]));
      data[i]=data[i+1]=data[i+2]=value;
    }
  }),filename(images[0].name,'-素描')))),
  'nine-grid':slugForm([fileField(),field('square','居中裁为正方形','checkbox',{value:true})],'生成九宫格',async({images,square})=>{
    const image=await load(images[0]);
    const width=image.naturalWidth,height=image.naturalHeight;
    const side=Math.min(width,height);
    const originX=square?(width-side)/2:0,originY=square?(height-side)/2:0;
    const cellWidth=(square?side:width)/3,cellHeight=(square?side:height)/3;
    if(cellWidth<1||cellHeight<1)throw Error('图片分辨率太小。');
    const output=[];
    for(let y=0;y<3;y++)for(let x=0;x<3;x++){
      const tile=canvas(...fit(cellWidth,cellHeight));
      tile.getContext('2d').drawImage(image,originX+x*cellWidth,originY+y*cellHeight,cellWidth,cellHeight,0,0,tile.width,tile.height);
      output.push(await entry(tile,'九宫格-'+(y*3+x+1)+'.png'));
    }
    const {zipSync}=await import('../../vip/vendor/fflate.mjs');
    const entries={};
    for(const item of output)entries[item.name]=new Uint8Array(await item.blob.arrayBuffer());
    return files({blob:new Blob([zipSync(entries)],{type:'application/zip'}),name:'九宫格.zip'},...output);
  }),
  'mirage-tank':slugForm([file('light','白底显示的表图','image/*'),file('dark','黑底显示的里图','image/*'),
    number('strength','分离度（%）',70,50,100)],'合成透明图',async({light,dark,strength})=>{
    const outer=await load(light[0]),inner=await load(dark[0]);
    const [width,height]=fit(outer.naturalWidth,outer.naturalHeight,2048);
    const surface=copyImage(outer,width,height);
    const target=surface.getContext('2d',{willReadFrequently:true});
    const canvasData=target.getImageData(0,0,width,height);
    const darkData=copyImage(inner,width,height).getContext('2d').getImageData(0,0,width,height).data;
    const lightMin=Number(strength)/2.5;
    for(let i=0;i<canvasData.data.length;i+=4) {
      const top=lightMin+(255-lightMin)*luminance(canvasData.data,i)/255;
      const bottom=(255-lightMin)*luminance(darkData,i)/255*.55;
      const alpha=Math.min(255,Math.max(1,255-top+bottom));
      const tone=Math.min(255,Math.round(bottom*255/alpha));
      canvasData.data[i]=canvasData.data[i+1]=canvasData.data[i+2]=tone;canvasData.data[i+3]=alpha;
    }
    target.putImageData(canvasData,0,0);
    return single(await entry(surface,'幻影坦克.png'));
  }),
  'image-editor':slugForm([fileField(),select('rotation','旋转',[['0','不旋转'],['90','顺时针 90°'],['180','180°'],['270','逆时针 90°']]),
    field('mirror','水平翻转','checkbox'),number('brightness','亮度（%）',100,20,220),
    number('left','裁掉左侧（%）',0,0,45),number('right','裁掉右侧（%）',0,0,45),
    number('top','裁掉上方（%）',0,0,45),number('bottom','裁掉下方（%）',0,0,45)],'应用编辑并预览',async values=>{
    const image=await load(values.images[0]);
    const sx=image.naturalWidth*Number(values.left)/100,sy=image.naturalHeight*Number(values.top)/100;
    const sw=image.naturalWidth*(1-(Number(values.left)+Number(values.right))/100),sh=image.naturalHeight*(1-(Number(values.top)+Number(values.bottom))/100);
    const [w,h]=fit(sw,sh);
    const rotation=Number(values.rotation),swap=rotation%180!==0;
    const surface=canvas(swap?h:w,swap?w:h);
    const ctx=surface.getContext('2d');
    ctx.translate(surface.width/2,surface.height/2);ctx.rotate(rotation*Math.PI/180);
    if(values.mirror)ctx.scale(-1,1);
    ctx.filter='brightness('+Number(values.brightness)/100+')';
    ctx.drawImage(image,sx,sy,sw,sh,-w/2,-h/2,w,h);
    return single(await entry(surface,filename(values.images[0].name,'-编辑')));
  }),
  'color-picker':slugForm([fileField()],'打开图片取色',async({images})=>{
    const source=await load(images[0]);
    const surface=copyImage(source,...fit(source.naturalWidth,source.naturalHeight,1200));
    const ctx=surface.getContext('2d',{willReadFrequently:true});
    surface.className='extra-color-image';
    surface.tabIndex=0;
    const result=node('section',{class:'tool-panel'});
    const label=node('p',{role:'status'},'点击图片获取颜色。也可以用方向键移动取色点。');
    let x=0,y=0;
    function pick(){
      const [r,g,b]=ctx.getImageData(x,y,1,1).data;
      label.textContent=hex(r,g,b).toUpperCase()+' · RGB('+[r,g,b].join(', ')+')';
    }
    surface.addEventListener('pointerdown',event=>{
      const bounds=surface.getBoundingClientRect();
      x=Math.min(surface.width-1,Math.max(0,Math.floor((event.clientX-bounds.left)*surface.width/bounds.width)));
      y=Math.min(surface.height-1,Math.max(0,Math.floor((event.clientY-bounds.top)*surface.height/bounds.height)));
      pick();
    });
    surface.addEventListener('keydown', event=>{
      const movement={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
      if(!movement)return;
      event.preventDefault();
      x=Math.max(0,Math.min(surface.width-1,x+movement[0]));
      y=Math.max(0,Math.min(surface.height-1,y+movement[1]));
      pick();
    });
    result.append(surface,label);
    return result;
  }),
  'img2pdf':slugForm([file('images','按页码顺序选择图片','image/*',true),select('layout','纸张方向',[['portrait','纵向'],['landscape','横向']])],'生成 PDF',async({images,layout},progress)=>{
    if(images.length>30)throw Error('每次最多 30 张图片。');
    const {jsPDF}=await vendor('pdfwrite.mjs');
    const pdf=new jsPDF({orientation:layout,unit:'mm',format:'a4',compress:true});
    const width=pdf.internal.pageSize.getWidth()-20,height=pdf.internal.pageSize.getHeight()-20;
    for(const [index,image] of images.entries()){
      progress('生成第 '+(index+1)+' 页');
      if(index)pdf.addPage();
      const loaded=await load(image);
      const surface=copyImage(loaded,...fit(loaded.naturalWidth,loaded.naturalHeight,2200));
      const scale=Math.min(width/surface.width,height/surface.height);
      const jpg=await exportCanvas(surface,'image/jpeg',.88);
      pdf.addImage(new Uint8Array(await jpg.arrayBuffer()),'JPEG',10+(width-surface.width*scale)/2,10+(height-surface.height*scale)/2,surface.width*scale,surface.height*scale);
    }
    return files({blob:pdf.output('blob'),name:'图片合成.pdf'});
  }),
};
