import {choice,field,files,mountForm,node,number,select,text,downloadBlob} from './ui.mjs';
const form=(fields,label,run,help)=>({fields,actions:[choice(label,run)],help});
const action=(label,callback,primary=false)=>{
  const button=node('button',{type:'button',class:primary?'primary':''},label);
  button.onclick=callback;
  return button;
};
const store=(key,defaultValue)=>{
  try{return JSON.parse(localStorage.getItem('toolbox.'+key))??defaultValue;}
  catch{return defaultValue;}
};
const persist=(key,value)=>localStorage.setItem('toolbox.'+key,JSON.stringify(value));
const section=()=>node('section',{class:'tool-panel tool-form'});
const row=()=>node('div',{class:'actions'});
function sound(kind='wood') {
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)return;
  const context=sound.context??=new Audio();
  void context.resume().catch(()=>{});
  const now=context.currentTime;
  [kind==='wood'?515:680,kind==='wood'?265:980].forEach((frequency,index)=>{
    const tone=context.createOscillator(),gain=context.createGain();
    tone.type=index===0?'sine':'triangle';
    tone.frequency.setValueAtTime(frequency,now);
    tone.frequency.exponentialRampToValueAtTime(frequency*.65,now+.16);
    gain.gain.setValueAtTime(index===0?.20:.075,now);
    gain.gain.exponentialRampToValueAtTime(.0001,now+.28);
    tone.connect(gain).connect(context.destination);
    tone.start(now);tone.stop(now+.29);
  });
}
function pomodoro(root) {
  const card=section(),toolbar=row(),remaining=node('h2',{'aria-live':'off'},'25:00'),label=node('label',{for:'duration'},'专注时长（分钟）');
  const minutes=node('input',{id:'duration',type:'number',value:25,min:1,max:180,step:1});
  const notices=node('p',{role:'status',class:'status'});
  let until=0,left=25*60000,timer;
  function render() {
    const seconds=Math.max(0,Math.ceil(left/1000));
    remaining.textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
  }
  function stop() {
    clearInterval(timer);
    timer=undefined;
    start.textContent='开始';
  }
  function reset() {
    stop();left=Math.max(1,Math.min(180,Number(minutes.value)||25))*60000;render();
  }
  const start=action('开始',()=>{
    if(timer){left=Math.max(0,until-Date.now());stop();render();return;}
    if(left<=0)reset();
    sound('bell');notices.textContent='专注计时中。';until=Date.now()+left;
    start.textContent='暂停';
    timer=setInterval(()=>{
      left=Math.max(0,until-Date.now());
      render();
      if(left===0){stop();notices.textContent='本轮计时结束。';sound('bell');}
    },200);
  },true);
  minutes.addEventListener('input',reset);
  toolbar.append(start,action('重置',()=>{reset();notices.textContent='已重置。';}),action('休息 5 分钟',()=>{minutes.value=5;reset();start.click();}));
  card.append(label,minutes,remaining,toolbar,notices);root.append(card);
}
function muyu(root) {
  const card=section(),buttons=row(),counter=node('h2',{role:'status'});
  let hits=Number(store('wooden-fish',0))||0;
  const render=()=>{counter.textContent='敲击 '+hits.toLocaleString()+' 次';};
  const save=()=>{try{persist('wooden-fish',hits);}catch{/* Storage may be unavailable. */}render();};
  buttons.append(action('敲木鱼',()=>{sound();hits++;save();},true),action('清零',()=>{hits=0;save();}));
  render();card.append(counter,buttons);root.append(card);
}
function recording(root) {
  const panel=section(),bar=row(),notice=node('p',{class:'status',role:'status'},'桌面浏览器可录制你主动选择的屏幕或窗口。录制文件保存在当前设备。');
  const preview=node('video',{controls:true,hidden:true});
  preview.style.maxWidth='100%';
  let stream,recorder,recording,file,address;
  const save=action('下载录屏',()=>{
    if(file)downloadBlob(file,file.type.includes('mp4')?'屏幕录制.mp4':'屏幕录制.webm');
  });
  const stop=action('结束录制',()=>{if(recorder?.state==='recording')recorder.stop();});
  const start=action('选择屏幕并录制',async()=>{
    if(!navigator.mediaDevices?.getDisplayMedia||!window.MediaRecorder){notice.textContent='当前浏览器不支持录屏。';return;}
    start.disabled=true;
    try{
      stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
      recorder=new MediaRecorder(stream);
      recording=[];
      recorder.ondataavailable=event=>{if(event.data.size)recording.push(event.data);};
      recorder.onstop=()=>{
        stream.getTracks().forEach(track=>track.stop());
        file=new Blob(recording,{type:recorder.mimeType||'video/webm'});
        if(address)URL.revokeObjectURL(address);
        address=URL.createObjectURL(file);
        preview.src=address;preview.hidden=false;save.disabled=false;
        start.disabled=false;stop.disabled=true;notice.textContent='录制完成。';
      };
      stream.getVideoTracks()[0].onended=()=>{if(recorder.state==='recording')recorder.stop();};
      recorder.start(250);
      notice.textContent='录制中…';stop.disabled=false;save.disabled=true;
    }catch(error){
      stream?.getTracks().forEach(track=>track.stop());
      notice.textContent=error.name==='NotAllowedError'?'已取消分享，或浏览器没有录屏权限。':'录制启动失败。';
      start.disabled=false;
    }
  },true);
  window.addEventListener('pagehide',()=>{
    stream?.getTracks().forEach(track=>track.stop());
    if(address)URL.revokeObjectURL(address);
  },{once:true});
  stop.disabled=save.disabled=true;
  bar.append(start,stop,save);panel.append(notice,bar,preview);root.append(panel);
}

function bookkeeping(root) {
  let records=store('ledger-web',[]);
  const list=section(),total=node('h2'),entries=node('div');
  const panel=section(),labels=row();
  const date=node('input',{id:'ledger-date',type:'date',value:new Date().toISOString().slice(0,10),required:true});
  const amount=node('input',{id:'ledger-amount',type:'number',min:'.01',max:'100000000',step:'.01',required:true});
  const description=node('input',{id:'ledger-note',type:'text',maxlength:100,required:true});
  const type=node('select',{id:'ledger-type'});
  type.append(node('option',{value:'out'},'支出'),node('option',{value:'in'},'收入'));
  const formElement=node('form',{class:'tool-form'});
  const status=node('p',{role:'status',class:'status'});
  for(const [id,label,input] of [[date.id,'日期',date],[type.id,'类型',type],[amount.id,'金额',amount],[description.id,'备注',description]])formElement.append(node('label',{for:id},label),input);
  labels.append(node('button',{type:'submit',class:'primary'},'添加账目'),action('导出 CSV',()=>{
    const data=[['日期','类型','金额','备注'],...records.map(item=>[item.date,item.type==='in'?'收入':'支出',(item.amount/100).toFixed(2),item.note])];
    const escapeCell=value=>{
      const safe=/^[=+@-]/.test(value)?"'"+value:value;
      return '"'+safe.replaceAll('"','""')+'"';
    };
    downloadBlob(new Blob(['\ufeff'+data.map(record=>record.map(escapeCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'账目.csv');
  }));
  formElement.append(labels,status);
  panel.append(node('p',{class:'status'},'账目保存在当前浏览器。可导出 CSV 备份。'),formElement);
  function render() {
    const net=records.reduce((sum,item)=>sum+(item.type==='in'?item.amount:-item.amount),0);
    total.textContent='余额 '+(net/100).toFixed(2)+' 元';
    entries.replaceChildren(...records.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(item=>{
      const line=row(),what=node('span',{},item.date+' · '+item.note+' · '+(item.type==='in'?'+':'-')+(item.amount/100).toFixed(2)+' 元');
      line.append(what,action('删除',()=>{
        if(!confirm('删除这条账目？'))return;
        const remaining=records.filter(candidate=>candidate.id!==item.id);
        try{persist('ledger-web',remaining);records=remaining;render();}
        catch{status.textContent='此浏览器无法保存。';}
      }));
      return line;
    }));
  }
  formElement.onsubmit=event=>{
    event.preventDefault();
    if(!description.value.trim()){status.textContent='请填写备注。';return;}
    const item={id:crypto.randomUUID(),date:date.value,type:type.value,amount:Math.round(Number(amount.value)*100),note:description.value.trim()};
    const next=[item,...records];
    try{persist('ledger-web',next);records=next;amount.value='';description.value='';status.textContent='已保存';render();}
    catch{status.textContent='此浏览器无法保存。';}
  };
  list.append(total,entries);root.append(panel,list);render();
}
function richText(root) {
  const panel=section(),bar=row(),edit=node('div',{class:'extra-rich',contenteditable:'true',role:'textbox','aria-label':'富文本内容','aria-multiline':'true'});
  const output=node('pre',{class:'tool-output',hidden:true});
  for(const [label,command,value] of [['粗体','bold'],['斜体','italic'],['下划线','underline'],['有序列表','insertOrderedList'],['无序列表','insertUnorderedList'],['标题','formatBlock','h2']]){
    const button=action(label,()=>{edit.focus();document.execCommand(command,false,value);});
    button.onmousedown=event=>event.preventDefault();
    bar.append(button);
  }
  bar.append(action('查看 HTML',()=>{output.hidden=false;output.textContent=edit.innerHTML;}),action('下载 HTML',()=>{
    downloadBlob(new Blob(['<!doctype html><meta charset="utf-8">'+edit.innerHTML],{type:'text/html'}),'富文本.html');
  },true));
  edit.addEventListener('paste',event=>{event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));});
  edit.addEventListener('drop',event=>event.preventDefault());
  panel.append(bar,edit,output);root.append(panel);
}
function markdown(root) {
  mountForm(root,form([text('source','Markdown','# 文档\n\n在这里编辑 Markdown。')],'渲染预览',async({source})=>{
    const {default:Markdown}=await import('../vendor-extra/markdown.mjs');
    const md=new Markdown({html:false,linkify:true});
    md.disable('image');
    const rendered=md.render(source);
    const panel=section(),preview=node('div',{class:'extra-markdown'});
    preview.innerHTML=rendered;
    for(const link of preview.querySelectorAll('a')){link.target='_blank';link.rel='noopener noreferrer';}
    const bar=row();
    bar.append(action('下载 Markdown',()=>downloadBlob(new Blob([source],{type:'text/markdown'}),'文档.md')),
      action('下载 HTML',()=>downloadBlob(new Blob(['<!doctype html><meta charset="utf-8">'+rendered],{type:'text/html'}),'文档.html')));
    panel.append(preview,bar);
    return panel;
  }));
}
function life(root) {
  mountForm(root,form([field('birth','出生日期','date',{required:true}),number('years','期望年龄（岁）',90,1,120)],'生成人生周历',({birth,years})=>{
    const date=Date.parse(birth+'T00:00:00Z');
    const elapsed=Math.floor((Date.now()-date)/604800000);
    if(elapsed<0||!Number.isFinite(elapsed))throw Error('请输入有效的出生日期。');
    const birthday=new Date(date);
    const goal=new Date(date);
    goal.setUTCFullYear(birthday.getUTCFullYear()+Number(years));
    const count=Math.ceil((goal.getTime()-date)/604800000);
    const panel=section();
    panel.append(node('h2',{},'已过 '+elapsed+' 周'),node('p',{class:'status'},'绿色表示已过去的周。'));
    const grid=node('div',{class:'extra-weeks','aria-hidden':'true'});
    const fragment=document.createDocumentFragment();
    for(let week=0;week<count;week++)fragment.append(node('i',{class:week<elapsed?'used':''}));
    grid.append(fragment);panel.append(grid);return panel;
  }));
}
const assessment={
  'friend-reconcile':[
    ['修复意愿','我想过对方可能希望怎样解决这件事','如果合适，我愿意开启谈话','我愿意承认自己应承担的部分'],
    ['沟通空间','我们过去有过平静讨论分歧的经历','我可以清楚表达我的感受','我可以先听完对方的解释'],
    ['信任基础','我们多数时候都遵守彼此的约定','我相信对方会尊重我说的话','这次冲突之外我们仍有互相支持的经历'],
    ['边界与安全','我能拒绝不适合自己的要求','沟通时我不会因为害怕对方而隐瞒感受','我们都能接受对方暂时不想谈'],
    ['实际行动','我能提出一个具体可行的下一步','我给彼此留下重新建立信任的时间','无论结果如何，我能照顾好自己'],
  ],
  'friend-compatibility':[
    ['沟通','我们能认真听对方说话','分歧时可以澄清误会','交流节奏大体舒适'],
    ['支持','彼此遇到困难时愿意帮忙','我能自在分享开心的事','我们能理解对方的挫折'],
    ['互信','我们能保守对方托付的秘密','说到的事情通常会做到','我可以坦诚说出真实想法'],
    ['边界','我们尊重彼此独处的时间','彼此能接受不同的选择','提出拒绝时仍能保持尊重'],
    ['相处节奏','我们能找到共同乐趣','联系频率让双方舒服','忙碌时也能维持友谊'],
  ]
};
function quiz(root,slug) {
  const questions=assessment[slug];
  const choices=[['1','1 · 很不符合'],['2','2 · 不太符合'],['3','3 · 一般'],['4','4 · 比较符合'],['5','5 · 非常符合']];
  const fields=questions.flatMap(([, ...items],index)=>items.map((question,n)=>select('q'+index+n,question,choices,'3')));
  mountForm(root,form(fields,'查看自评',answers=>{
    const results=questions.map(([name,...items],index)=>[name,items.reduce((sum,_,n)=>sum+Number(answers['q'+index+n]),0)/items.length]);
    return results.map(([name,value])=>name+' '+value.toFixed(1)+' / 5').join('\n')+'\n\n可以先就得分较低、对双方都重要的一项聊聊。';
  },'请选择最符合当前关系的答案。结果用于个人梳理，答案只在此页处理。'));
}

export const widgets={
  'pomodoro-clock':pomodoro,'e-muyu':muyu,'screen-recorder':recording,bookkeeping,
  'richtext-editor':richText,'markdown-editor':markdown,lifecount:life,
  'friend-reconcile':root=>quiz(root,'friend-reconcile'),
  'friend-compatibility':root=>quiz(root,'friend-compatibility'),
};
