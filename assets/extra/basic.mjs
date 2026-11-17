import {choice,field,node,number,select,text} from './ui.mjs';

const vendor = pathname => import('../vendor-extra/'+pathname);
const simple = (label, run, inputs = [text('value','输入')]) => ({fields:inputs,actions:[choice(label,run)]});
const bounds = (value,min,max,label='数值') => {
  const number=Number(value);
  if(!Number.isFinite(number)||number<min||number>max)throw Error(label+'超出可用范围。');
  return number;
};

function convertBase(raw, from, to) {
  const input=raw.trim().toUpperCase();
  const negative=input.startsWith('-');
  const digits=input.replace(/^[+-]/,'');
  if(!digits||digits.length>8192)throw Error('请输入有效整数，最多 8192 位。');
  const alphabet='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let value=0n;
  for(const digit of digits) {
    const i=alphabet.indexOf(digit);
    if(i<0||i>=from)throw Error('字符 '+digit+' 不属于 '+from+' 进制。');
    value=value*BigInt(from)+BigInt(i);
  }
  return (negative?-value:value).toString(to).toUpperCase();
}

function ipv4(value) {
  const parts=value.split('.');
  if(parts.length!==4||parts.some(part=>!/^(0|[1-9]\d{0,2})$/.test(part)||Number(part)>255))throw Error('请输入有效的 IPv4 地址。');
  return parts.reduce((total,part)=>(total<<8)|Number(part),0)>>>0;
}
function ipText(value){return [24,16,8,0].map(bits=>(value>>>bits)&255).join('.');}
function cidr(value) {
  const match=value.trim().match(/^([^/]+)\/(\d{1,2})$/);
  if(!match||Number(match[2])>32)throw Error('请输入 IPv4 CIDR，例如 192.168.1.10/24。');
  const bits=Number(match[2]);
  const mask=bits===0?0:(0xffffffff<<(32-bits))>>>0;
  const first=(ipv4(match[1])&mask)>>>0;
  const last=(first|~mask)>>>0;
  const addresses=2**(32-bits);
  const usable=bits>=31?addresses:addresses-2;
  return [
    '网络地址 '+ipText(first),'子网掩码 '+ipText(mask),'广播地址 '+ipText(last),
    '可用地址 '+ipText(bits<31?first+1:first)+' 至 '+ipText(bits<31?last-1:last),
    'IP 总数 '+addresses,'可用数 '+usable
  ].join('\n');
}

const morseCodes='.- -... -.-. -.. . ..-. --. .... .. .--- -.- .-.. -- -. --- .--. --.- .-. ... - ..- ...- .-- -..- -.-- --.. ----- .---- ..--- ...-- ....- ..... -.... --... ---.. ----.'.split(' ');
const morse=new Map([...('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')].map((letter,index)=>[letter,morseCodes[index]]));
for(const [letter,code] of Object.entries({'.':'.-.-.-',',':'--..--','?':'..--..','/':'-..-.','-':'-....-',':':'---...','!':'-.-.--'}))morse.set(letter,code);
const inverseMorse=new Map([...morse].map(([letter,code])=>[code,letter]));
function morseTransform(value,reverse) {
  if(!value.trim())return '';
  return reverse?value.trim().split(/\s*\/\s*/).map(word=>word.split(/\s+/).map(code=>{
    if(!inverseMorse.has(code))throw Error('未知电码 '+code);
    return inverseMorse.get(code);
  }).join('')).join(' '):value.toUpperCase().trim().split(/\s+/).map(word=>[...word].map(letter=>{
    if(!morse.has(letter))throw Error('无法为 '+letter+' 编码。');
    return morse.get(letter);
  }).join(' ')).join(' / ');
}

function parseXml(value) {
  const doc=new DOMParser().parseFromString(value,'application/xml');
  if(doc.querySelector('parsererror'))throw Error('XML 格式错误。');
  function read(element) {
    const record=Object.create(null);
    for(const attr of element.attributes)record['@'+attr.name]=attr.value;
    for(const child of element.children) {
      const content=read(child);
      if(!Object.hasOwn(record,child.tagName))record[child.tagName]=content;
      else record[child.tagName]=[].concat(record[child.tagName],content);
    }
    const value=[...element.childNodes].filter(node=>node.nodeType===3||node.nodeType===4).map(node=>node.nodeValue).join('').trim();
    if(!Object.keys(record).length)return value;
    if(value) record['#text']=value;
    return record;
  }
  return JSON.stringify({[doc.documentElement.tagName]:read(doc.documentElement)},null,2);
}

function chinese(value, financial) {
  const input=value.trim();
  if(!/^-?\d{1,16}(?:\.\d{1,8})?$/.test(input))throw Error('请输入最多 16 位整数、8 位小数的数字。');
  const alphabet=financial?'零壹贰叁肆伍陆柒捌玖':'零一二三四五六七八九';
  const units=financial?' 拾佰仟':' 十百千';
  const [whole,decimal]=input.replace(/^-/,'').split('.');
  const compact=whole.replace(/^0+(?=\d)/,'');
  const groups=compact.match(/\d{1,4}(?=(?:\d{4})*$)/g);
  let out='', gap=false;
  groups.forEach((group,index)=>{
    const numeric=Number(group);
    if(!numeric){if(out)gap=true;return;}
    if(out&&(gap||numeric<1000))out+=alphabet[0];
    gap=false;
    let local='',zero=false;
    [...group].forEach((character,pos)=>{
      if(character==='0'){if(local)zero=true;return;}
      if(zero)local+=alphabet[0];
      zero=false;
      const order=group.length-pos-1;
      local+=alphabet[Number(character)]+(order?units[order]:'');
    });
    out+=local+['','万','亿','万亿'][groups.length-index-1];
  });
  if(!out)out=alphabet[0];
  if(!financial)out=out.replace(/^一十/,'十');
  return (input.startsWith('-')?'负':'')+out+(decimal?'点'+[...decimal].map(character=>alphabet[Number(character)]).join(''):'');
}

function unbiased(size) {
  if(!Number.isSafeInteger(size)||size<1||size>2**32)throw Error('随机范围最多包含 2³² 个整数。');
  const limit=2**32-2**32%size;
  const buffer=new Uint32Array(1);
  do{crypto.getRandomValues(buffer);}while(buffer[0]>=limit);
  return buffer[0]%size;
}
function days(value) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('请选择有效日期。');
  const time=Date.parse(value+'T00:00:00Z');
  if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)throw Error('请选择有效日期。');
  return time/86400000;
}

export const basic = {
  'base-converter': simple('转换',({value,from,to})=>convertBase(value,Number(from),Number(to)),
    [field('value','整数','text',{required:true}),number('from','原进制',10,2,36),number('to','目标进制',16,2,36)]),
  'cidr-calculator': simple('计算',({value})=>cidr(value),[field('value','IPv4 CIDR','text',{required:true,placeholder:'192.168.1.10/24'})]),
  'md5-hash': {fields:[text('value','文本'),field('upload','或选择文件','file')],actions:[choice('计算 MD5',async({value,upload})=>{
    const {default:md5}=await vendor('md5.mjs');
    if(!upload.length)return md5.hash(value);
    const app=new md5.ArrayBuffer();
    for(let offset=0;offset<upload[0].size;offset+=1048576)app.append(await upload[0].slice(offset,offset+1048576).arrayBuffer());
    return app.end();
  })]},
  'morse-code': {fields:[text('value','文字或摩斯电码')],help:'字母电码以空格分隔，单词以 / 分隔。',actions:[
    choice('编码',({value})=>morseTransform(value,false)),choice('解码',({value})=>morseTransform(value,true))]},
  'ua-parser': simple('解析',async({value})=>{
    const {default:UAParser}=await vendor('ua.mjs');
    return JSON.stringify(new UAParser(value.trim()||navigator.userAgent).getResult(),null,2);
  },[text('value','User-Agent',navigator.userAgent)]),
  'number2chinese': simple('转换',({value,mode})=>chinese(value,mode==='financial'),
    [field('value','数字','text',{required:true}),select('mode','形式',[['normal','常用写法'],['financial','财务大写']])]),
  'yaml2json': {fields:[text('value','YAML 或 JSON')],actions:[choice('YAML 转 JSON',async({value})=>{
    const yaml=await vendor('yaml.mjs');
    return JSON.stringify(yaml.load(value),null,2)??'';
  }),choice('JSON 转 YAML',async({value})=>(await vendor('yaml.mjs')).dump(JSON.parse(value)))]},
  'kinship-calculator': simple('计算称谓',async({value,sex,reverse})=>{
    const {default:relationship}=await vendor('kinship.mjs');
    const answer=relationship({text:value,sex:Number(sex),reverse:Boolean(reverse)});
    if(!answer?.length)throw Error('没有匹配关系，请用「爸爸的妈妈」这样的格式输入。');
    return answer.join('、');
  },[field('value','关系链','text',{required:true,placeholder:'爸爸的妈妈'}),select('sex','本人性别',[['-1','不限'],['1','男'],['0','女']]),field('reverse','查询对方如何称呼我','checkbox')]),
  'bmi-calculator': simple('计算 BMI',({height,weight})=>(Number(weight)/(Number(height)/100)**2).toFixed(2),
    [number('height','身高（厘米）',170,30,300,.1),number('weight','体重（千克）',65,1,700,.1)]),
  'xml2json': simple('转换为 JSON',({value})=>parseXml(value),[text('value','XML')]),
  'pangu': simple('调整空格',({value})=>value
    .replace(/([\p{Script=Han}])([A-Za-z0-9@#])/gu,'$1 $2')
    .replace(/([A-Za-z0-9])([\p{Script=Han}])/gu,'$1 $2'),[text('value','中英文混排文字')]),
  'ganzhi': simple('查询',async({date})=>{
    const {Solar}=await vendor('lunar.mjs');
    days(date);
    const [year,month,day]=date.split('-').map(Number);
    const lunar=Solar.fromYmd(year,month,day).getLunar();
    return [lunar.toString(),'年柱 '+lunar.getYearInGanZhiExact(),'月柱 '+lunar.getMonthInGanZhiExact(),'日柱 '+lunar.getDayInGanZhi()].join('\n');
  },[field('date','公历日期','date',{required:true,value:new Date().toISOString().slice(0,10)})]),
  'regex-hub': {fields:[select('preset','常用表达式',[['','自定义'],['^1[3-9]\\d{9}$','中国大陆手机号'],['^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$','电子邮件'],['^-?\\d+(?:\\.\\d+)?$','数字'],['^[A-Za-z0-9_]{4,16}$','用户名'],['https?://[^\\s]+','网址']]),
    field('pattern','表达式'),field('flags','修饰符','text',{value:'g'}),text('value','测试文本')],actions:[choice('测试',async({preset,pattern,flags,value})=>{
      const worker=new Worker(new URL('./regex-worker.mjs',import.meta.url),{type:'module'});
      try{return await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('表达式执行超时，请缩短测试文本或修改表达式。')),1200);
        worker.onmessage=event=>{clearTimeout(timer);const {result,error}=event.data;error?reject(Error(error)):resolve(result);};
        worker.onerror=()=>{clearTimeout(timer);reject(Error('表达式执行失败。'));};
        worker.postMessage({pattern:pattern||preset,flags,value});
      });}finally{worker.terminate();}
    })]},
  'random-number': simple('生成',({minimum,maximum,quantity,distinct})=>{
    const min=Number(minimum),max=Number(maximum),count=Number(quantity),size=max-min+1;
    if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||size<1||size>2**32)throw Error('请输入有效区间，上限须大于或等于下限。');
    if(distinct&&count>size)throw Error('数量大于区间内可选的数字。');
    if(!distinct)return Array.from({length:count},()=>min+unbiased(size)).join('\n');
    const values=new Set();
    for(let i=size-count;i<size;i++){const index=unbiased(i+1);values.add(values.has(index)?i:index);}
    const result=[...values].map(item=>item+min);
    for(let i=result.length-1;i>0;i--){const j=unbiased(i+1);[result[i],result[j]]=[result[j],result[i]];}
    return result.join('\n');
  },[number('minimum','最小值',1,-2147483648,2147483647),number('maximum','最大值',100,-2147483648,2147483647),
    number('quantity','数量',10,1,200),field('distinct','排除重复数字','checkbox')]),
  'date-calculator': {fields:[field('start','开始日期','date',{required:true}),field('end','结束日期','date'),
    number('offset','加减天数',0,-365000,365000)],actions:[
    choice('计算日期差',({start,end})=>String(days(end)-days(start))+' 天'),
    choice('加减天数',({start,offset})=>new Date((days(start)+Number(offset))*86400000).toISOString().slice(0,10))]},
  'figlet-ascii': simple('生成大字',async({value})=>{
    if(!value.trim()||/[^\x20-\x7e]/.test(value))throw Error('请输入一行英文字母、数字或常用符号。');
    const {default:figlet}=await vendor('figlet.mjs');
    return figlet.textSync(value,{font:'Standard'});
  },[field('value','英文文本','text',{maxlength:100,required:true})]),
  'exotic-text': simple('转换',({value,style})=>[...value].map(character=>{
    const code=character.charCodeAt(0);
    const digit=code>=48&&code<=57, upper=code>=65&&code<=90,lower=code>=97&&code<=122;
    if(style==='wide')return code>=33&&code<=126?String.fromCharCode(code+65248):character===' '?'　':character;
    if(!digit&&!upper&&!lower)return character;
    const bases=style==='bold'?[0x1d7ce,0x1d400,0x1d41a]:[0x1d7f6,0x1d670,0x1d68a];
    return String.fromCodePoint(digit?bases[0]+code-48:upper?bases[1]+code-65:bases[2]+code-97);
  }).join(''),[text('value','文字'),select('style','样式',[['bold','粗体'],['mono','等宽'],['wide','全角']])]),
  'what2eat': simple('帮我选',({value})=>{
    const list=value.split(/[\n、，,]/).map(item=>item.trim()).filter(Boolean);
    if(!list.length)throw Error('请至少填写一道菜。');
    return list[unbiased(list.length)];
  },[text('value','备选菜品，每行一项','米线\n饺子\n寿司\n炒饭\n面条\n盖浇饭')]),
  'linuxman': simple('查说明',({value})=>{
    const command=value.trim().toLowerCase();
    if(!/^[a-z0-9][a-z0-9_+-]*$/.test(command))throw Error('请输入单个命令名。');
    const block=node('section',{class:'tool-panel'});
    block.append(node('p',{},'打开 Debian 在线手册查看该命令的参数与用法。'),
      node('a',{href:'https://manpages.debian.org/'+encodeURIComponent(command),target:'_blank',rel:'noopener noreferrer',class:'button primary'},'查看 '+command+' 手册'));
    return block;
  },[field('value','命令名','text',{required:true,placeholder:'ls'})]),
  'minify-js': simple('压缩 JavaScript',async({value})=>{
    const {minify}=await vendor('terser.mjs');
    const result=await minify(value);
    return result.code??'';
  },[text('value','JavaScript 源代码')]),
};
