self.onmessage=({data:{pattern,flags,value}})=>{
  try{
    if(!pattern)throw Error('请输入表达式。');
    if(pattern.length>1000||value.length>200000)throw Error('表达式或待测试文本过长。');
    const expression=new RegExp(pattern,flags.includes('g')?flags:flags+'g');
    const matches=[];
    for(const match of value.matchAll(expression)){
      matches.push('位置 '+match.index+'：'+JSON.stringify([...match]));
      if(matches.length===250)break;
    }
    self.postMessage({result:matches.length?matches.join('\n'):'没有匹配。'});
  }catch(error){self.postMessage({error:error.message});}
};
