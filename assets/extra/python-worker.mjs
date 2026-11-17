import {loadMicroPython} from '../vendor-extra/micropython/micropython.mjs';

self.onmessage=async({data:source})=>{
  try{
    if(typeof source!=='string'||source.length>100000)throw Error('程序过长或格式无效。');
    let output='';
    const report=value=>{
      output+=String(value)+'\n';
      if(output.length>50000)throw Error('输出超过 50000 个字符，程序已停止。');
    };
    const engine=await loadMicroPython({
      url:new URL('../vendor-extra/micropython/micropython.wasm',import.meta.url).href,
      heapsize:8*1024*1024,stdout:report,stderr:report,
    });
    engine.runPython(source);
    self.postMessage({output:output.trimEnd()});
  }catch(error){self.postMessage({error:error.message});}
};
