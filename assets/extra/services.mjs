import {choice,field,file,node,number,outputLink,select,text} from './ui.mjs';
const form=(fields,label,run,help)=>({fields,actions:[choice(label,run)],help});
const dateNow=()=>new Date().toISOString().slice(0,10);
const language=[['zh-CN','简体中文'],['zh-TW','繁体中文'],['en','英语'],['ja','日语'],['ko','韩语'],['fr','法语'],['de','德语'],['es','西班牙语'],['ru','俄语'],['ar','阿拉伯语']];
function endpoint(base,params) {
  const url=new URL(base);
  url.search=new URLSearchParams(params).toString();
  return url;
}
async function json(url,options={}) {
  let response;
  try{response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000),...options});}
  catch{throw Error('服务连接失败，请检查网络后重试。');}
  if(response.status===429)throw Error('服务达到频率限制，请稍后重试。');
  if(!response.ok)throw Error('服务暂时未能完成请求（HTTP '+response.status+'）。');
  return await response.json();
}
function linkPanel(title,href,name) {
  const panel=node('section',{class:'tool-panel tool-form'});
  panel.append(node('p',{},title),outputLink(href,name));
  return panel;
}
function validWebURL(value) {
  try{
    const url=new URL(value.trim());
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error();
    return url;
  }catch{throw Error('请输入完整的 HTTP 或 HTTPS 网址。');}
}
function isolatedJSONP(target) {
  target.searchParams.set('callback','respond');
  const frame=node('iframe',{sandbox:'allow-scripts',hidden:true,referrerpolicy:'no-referrer',title:'短网址查询服务'});
  const identifier=crypto.randomUUID();
  const token=JSON.stringify(identifier);
  const address=target.href.replaceAll('&','&amp;').replaceAll('"','&quot;');
  frame.srcdoc='<meta name="referrer" content="no-referrer"><script>function respond(data){ parent.postMessage({token:'+token+',data}, "*"); }</script><script src="'+address+'"></script>';
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{frame.remove();window.removeEventListener('message',answer);clearTimeout(timer);};
    const timer=setTimeout(()=>{cleanup();reject(Error('服务暂时不可用。'));},15000);
    function answer(event) {
      if(event.source!==frame.contentWindow||event.data?.token!==identifier)return;
      const {data}=event.data;
      cleanup();
      if(data.errorcode){reject(Error('服务未完成请求：'+data.errormessage));return;}
      resolve(data);
    }
    window.addEventListener('message',answer);
    document.body.append(frame);
  });
}
async function wiki(host,title,max=9000) {
  const url=endpoint('https://'+host+'/w/api.php',{action:'query',prop:'extracts',explaintext:'1',format:'json',formatversion:'2',redirects:'1',titles:title,origin:'*'});
  const result=await json(url,{signal:AbortSignal.timeout(6000)});
  const page=result.query?.pages?.[0];
  if(page?.missing||!page?.extract?.trim())throw Error('未找到相关条目。');
  const panel=node('section',{class:'tool-panel tool-form'});
  panel.append(node('h2',{},page.title),node('pre',{class:'tool-output'},page.extract.trim().slice(0,max)),
    outputLink('https://'+host+'/wiki/'+encodeURIComponent(page.title),'原文与许可'));
  return panel;
}

export const services={
  'url-shortener':{
    fields:[field('url','输入网址','url',{required:true,maxlength:4096})],
    help:'提交时，这个网址会发送到 is.gd。生成的公开短链会保存在其服务。还原支持 is.gd 链接。',
    actions:[
      choice('生成短网址',async({url})=>{
        const target=validWebURL(url);
        const {shorturl}=await isolatedJSONP(endpoint('https://is.gd/create.php',{format:'json',url:target.href}));
        if(!shorturl||validWebURL(shorturl).hostname!=='is.gd')throw Error('服务未返回有效短网址。');
        return linkPanel('短网址已生成',shorturl,shorturl);
      }),
      choice('还原短网址',async({url})=>{
        const target=validWebURL(url);
        if(target.hostname!=='is.gd')throw Error('请输入 is.gd 短网址。');
        const output=await isolatedJSONP(endpoint('https://is.gd/forward.php',{format:'json',shorturl:target.href}));
        const restored=output.url;
        if(!restored)throw Error('未找到原网址。');
        return linkPanel('原始网址',restored,restored);
      })
    ]
  },
  'translator':form([text('value','原文'),select('from','原文语言',language,'en'),select('to','目标语言',language,'zh-CN')],
    '翻译',async({value,from,to})=>{
      const content=value.trim();
      if(!content||new TextEncoder().encode(content).byteLength>500)throw Error('每次请输入 1–500 个 UTF-8 字节。');
      if(from===to)return content;
      const result=await json(endpoint('https://api.mymemory.translated.net/get',{q:content,langpair:from+'|'+to}));
      if(Number(result.responseStatus)!==200||!result.responseData?.translatedText)throw Error('翻译服务暂未返回结果。');
      return result.responseData.translatedText;
    },'仅在点击翻译时把原文发送给 MyMemory。每次最多 500 个 UTF-8 字节。'),
  'currency-converter':form([
    number('amount','金额',100,0,1e12,.01),
    field('base','原币种（3 字母）','text',{value:'USD',required:true,pattern:'[A-Za-z]{3}'}),
    field('quote','目标币种（3 字母）','text',{value:'CNY',required:true,pattern:'[A-Za-z]{3}'}),
  ],'换算',async({amount,base,quote})=>{
    base=base.toUpperCase();quote=quote.toUpperCase();
    if(base===quote)return amount+' '+base+' = '+amount+' '+quote;
    const rates=await json(endpoint('https://api.frankfurter.dev/v2/rates',{base,quotes:quote}));
    const result=Array.isArray(rates)?rates.find(row=>row.base===base&&row.quote===quote):null;
    if(!result||!Number.isFinite(result.rate))throw Error('这组币种暂不可查，请检查币种代码。');
    return amount+' '+base+' = '+(Number(amount)*result.rate).toLocaleString(undefined,{maximumFractionDigits:4})+' '+quote+
      '\n参考汇率 '+result.rate+'\n日期 '+result.date;
  },'数据使用 Frankfurter 提供的参考汇率。'),
  'whois':form([field('domain','域名','text',{required:true,placeholder:'example.com'})],
    '查询域名注册信息',async({domain})=>{
      let hostname;
      try{
        const name=domain.trim().replace(/\.$/,'');
        if(/[/:@?#\s]/.test(name)||!name.includes('.'))throw Error();
        hostname=new URL('https://'+name).hostname;
        if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(hostname))throw Error();
      }catch{throw Error('请输入域名，例如 example.com。');}
      const url='https://rdap.org/domain/'+encodeURIComponent(hostname);
      let result;
      const tld=hostname.split('.').at(-1);
      try{
        const direct=['com','net'].includes(tld)?'https://rdap.verisign.com/'+tld+'/v1/domain/'+encodeURIComponent(hostname):url;
        result=await json(direct,{signal:AbortSignal.timeout(4500)});
      }catch{
        return linkPanel('浏览器未能直接取得 '+hostname+' 的注册信息，可打开官方数据。',url,'在 RDAP 查看 '+hostname);
      }
      const panel=node('section',{class:'tool-panel tool-form'});
      const values=[
        '域名 '+(result.ldhName||hostname),'状态 '+(result.status||[]).join('、'),
        ...(result.events||[]).map(event=>event.eventAction+' '+event.eventDate),
        ...(result.nameservers||[]).map(server=>'NS '+server.ldhName),
      ];
      panel.append(node('pre',{class:'tool-output'},values.join('\n')),outputLink(url,'查看原始 RDAP 数据'));
      return panel;
    },'查询的域名将发送至 RDAP 服务，所示内容以注册局公开数据为准。'),
  'icp':form([field('domain','域名或备案号','text',{required:true,maxlength:200})],
    '打开工信部查询',({domain})=>{
      const panel=linkPanel('待查询：'+domain.trim(),'https://beian.miit.gov.cn/','工信部备案管理系统');
      panel.prepend(node('p',{class:'status'},'请在工信部网站输入域名或备案号并完成验证。'));
      return panel;
    },'工信部系统需要人工验证。'),
  'histoday':form([field('date','日期','date',{value:dateNow(),required:true})],'查看历史事件',({date})=>{
    const [,month,day]=date.split('-').map(Number);
    return wiki('zh.wikipedia.org',month+'月'+day+'日');
  },'资料来自中文维基百科，显示该日期条目的历史记录。'),
  'chinese-dictionary':form([field('word','字词','text',{required:true,maxlength:30})],
    '查词',async({word})=>{
      const term=word.trim();
      if(!term)throw Error('请输入字或词。');
      try{return await wiki('zh.wiktionary.org',term,6500);}
      catch{return linkPanel(term+' · 中文维基词典','https://zh.wiktionary.org/wiki/'+encodeURIComponent(term),'打开词条');}
    },'释义来自中文维基词典。'),
  'what-anime':form([file('photo','选择动画截图','image/*')],'搜索动画画面',async({photo})=>{
    if(photo[0].size>8*1024*1024)throw Error('请选择小于 8 MB 的图片。');
    const data=new FormData();data.append('image',photo[0]);
    const result=await json('https://api.trace.moe/search?anilistInfo',{method:'POST',body:data});
    const panel=node('section',{class:'tool-panel tool-form'});
    for(const match of (result.result||[]).slice(0,5)){
      const title=match.anilist?.title?.native||match.anilist?.title?.romaji||match.filename;
      const value=node('p',{},title+' · 第 '+(match.episode??'?')+' 集 · '+Math.round(match.from)+' 秒 · '+Math.round(match.similarity*100)+'%');
      panel.append(value);
      if(match.anilist?.id)panel.append(outputLink('https://anilist.co/anime/'+encodeURIComponent(match.anilist.id),'查看动画'));
    }
    if(!panel.childNodes.length)throw Error('没有找到匹配画面。');
    return panel;
  },'提交后会将选择的图片发送到 trace.moe 进行识别。'),
  'bilibili-cover':form([field('video','Bilibili 视频网址或 BV 号'),text('source','或粘贴视频网页源代码（含 og:image）')],
    '获取封面',async({video,source})=>{
      const id=video.match(/(?:^|[/?&=])(BV[A-Za-z0-9]{10})(?=$|[/?#&\s])/i)?.[1];
      let cover='',title='';
      if(source.trim()){
        if(source.length>2e6)throw Error('请只粘贴含 og:image 的 meta 标签，或小于 2 MB 的源代码。');
        const template=document.createElement('template');
        template.innerHTML=source;
        const html=template.content;
        cover=html.querySelector('meta[property="og:image"],meta[name="og:image"],meta[itemprop="image"]')?.content||'';
        title=html.querySelector('meta[property="og:title"]')?.content||'';
      }else if(id){
        try{
          const result=await json(endpoint('https://api.bilibili.com/x/web-interface/view',{bvid:id}),{signal:AbortSignal.timeout(4000)});
          cover=result.data?.pic||'';title=result.data?.title||'';
        }catch {
          const panel=linkPanel('浏览器未能直接取得封面。请打开视频页，复制网页源代码中含 og:image 的标签并粘贴回来。','https://www.bilibili.com/video/'+encodeURIComponent(id)+'/','打开 Bilibili 视频页');
          return panel;
        }
      }else throw Error('请输入有效的 BV 号、视频网址，或粘贴网页源代码。');
      if(!cover)throw Error('没有找到封面，请检查是否包含 og:image 标签。');
      if(cover.startsWith('//'))cover='https:'+cover;
      const url=validWebURL(cover);
      if(!/(?:^|\.)hdslb\.com$/i.test(url.hostname))throw Error('封面需来自 Bilibili 的 hdslb.com 图片服务器。');
      url.protocol='https:';
      const panel=linkPanel(title||'视频封面',url.href,'打开原图');
      panel.append(node('img',{src:url.href,alt:title||'Bilibili 视频封面',referrerpolicy:'no-referrer',class:'preview-image'}));
      return panel;
    },'可按 BV 号查询，也可从 Bilibili 视频网页的 og:image 标签提取封面。'),
  'bing-wallpaper':form([select('market','区域',[['zh-CN','中国大陆'],['en-US','美国']])],
    '查看必应壁纸',async({market})=>{
      const {images}=await json(new URL('../../data/bing-'+market+'.json',import.meta.url));
      const panel=node('section',{class:'tool-panel tool-form'});
      for(const item of images){
        const image=node('img',{src:item.url,alt:item.title||'必应壁纸',loading:'lazy',class:'preview-image',referrerpolicy:'no-referrer'});
        const details=node('div',{class:'tool-panel tool-form'});
        details.append(node('h2',{},item.title||'必应壁纸'),image,node('p',{class:'status'},item.date+' · '+item.copyright),outputLink(item.url,'打开原图'));
        panel.append(details);
      }
      if(!panel.childNodes.length)throw Error('暂无可显示的壁纸。');
      return panel;
    },'图片及版权信息来自 Microsoft Bing。'),
  'speedtest':form([select('provider','测速服务',[['cloudflare','Cloudflare'],['fast','FAST.com']])],
    '打开测速',({provider})=>linkPanel('测速结果由所选服务提供。',provider==='fast'?'https://fast.com/':'https://speed.cloudflare.com/','开始测速')),
  'tts':form([text('value','朗读文本'),select('lang','语言',language,'zh-CN'),
    number('rate','语速',1,.4,2,.1)],'开始朗读',async({value,lang,rate})=>{
      if(!window.speechSynthesis)throw Error('当前浏览器不支持语音合成。');
      if(!value.trim()||value.length>1500)throw Error('每次请输入 1–1500 个字符。');
      let voices=speechSynthesis.getVoices();
      if(!voices.length){
        await new Promise(resolve=>{
          const event=()=>{clearTimeout(timer);resolve();};
          const timer=setTimeout(()=>{speechSynthesis.removeEventListener('voiceschanged',event);resolve();},1100);
          speechSynthesis.addEventListener('voiceschanged',event,{once:true});
        });
        voices=speechSynthesis.getVoices();
      }
      const voice=voices.find(item=>item.localService&&item.lang.toLowerCase()===lang.toLowerCase())||
        voices.find(item=>item.localService&&item.lang.toLowerCase().startsWith(lang.split('-')[0].toLowerCase()));
      if(!voice)throw Error('此设备尚无对应语言的本地语音。');
      const speech=new SpeechSynthesisUtterance(value);
      speech.voice=voice;speech.lang=voice.lang;speech.rate=Number(rate);
      speechSynthesis.cancel();speechSynthesis.speak(speech);
      const panel=node('section',{class:'tool-panel actions'});
      const stop=node('button',{type:'button'},'停止朗读');
      stop.onclick=()=>speechSynthesis.cancel();panel.append(stop);
      return panel;
    },'使用浏览器可用的本机语音，适用于朗读试听。'),
};
