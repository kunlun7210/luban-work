const labelFor = id => 'field-' + id;

export function node(tag, attrs = {}, text) {
  const value = document.createElement(tag);
  for (const [key, item] of Object.entries(attrs)) {
    if (item !== undefined) value.setAttribute(key, item === true ? '' : item);
  }
  if (text !== undefined) value.textContent = text;
  return value;
}

export const field = (id, label, type = 'text', options = {}) => ({ id, label, type, ...options });
export const select = (id, label, choices, value) => field(id, label, 'select', { choices, value });
export const file = (id, label, accept, multiple = false) => field(id, label, 'file', { accept, multiple, required: true });
export const number = (id, label, value, min, max, step = 1) => field(id, label, 'number', { value, min, max, step, required: true });
export const text = (id, label, value = '') => field(id, label, 'textarea', { value });
export const choice = (label, run) => ({ label, run });

function control(spec) {
  const {id,label,type,value,choices,...attributes}=spec;
  const group = node('div', {class:'extra-field'});
  const input=node(type==='textarea'||type==='select'?type:'input',{id:labelFor(id),name:id,
    type:type==='textarea'||type==='select'?undefined:type,...attributes});
  if(type==='select') for(const item of choices){
    const [key,title]=Array.isArray(item)?item:[item,item];
    input.append(node('option',{value:key},title));
  }
  if(type==='checkbox') input.checked=Boolean(value);
  else if(value!==undefined)input.value=value;
  const name=node('label',{for:input.id},label);
  if(type==='checkbox')group.append(input,name);
  else group.append(name,input);
  return [group,input];
}

export function downloadBlob(blob, name) {
  const address=URL.createObjectURL(blob);
  const link=node('a',{href:address,download:name});
  link.click();
  setTimeout(()=>URL.revokeObjectURL(address),1000);
}

export function mountForm(root, spec) {
  const form=node('form',{class:'tool-panel tool-form'});
  if(spec.help)form.append(node('p',{class:'status'},spec.help));
  const inputs=spec.fields.map(control);
  form.append(...inputs.map(([group])=>group));
  const bar=node('div',{class:'actions'});
  for(const [index,action] of spec.actions.entries())bar.append(node('button',{type:'submit',value:index,class:index===0?'primary':''},action.label));
  const status=node('p',{role:'status',class:'status'});
  const result=node('div',{class:'extra-result'});
  const previews=[];
  form.append(bar,status);
  root.replaceChildren(form,result);
  window.addEventListener('pagehide',()=>previews.splice(0).forEach(address=>URL.revokeObjectURL(address)),{once:true});
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const index=Number(event.submitter?.value||0);
    const values=Object.fromEntries(inputs.map(([,input])=>[input.name,input.type==='file'?[...input.files]:input.type==='checkbox'?input.checked:input.value]));
    const buttons=[...bar.children];
    buttons.forEach(button=>button.disabled=true);
    previews.splice(0).forEach(address=>URL.revokeObjectURL(address));
    result.replaceChildren();
    status.textContent='处理中…';
    try {
      const output=await spec.actions[index].run(values,message=>status.textContent=message);
      if(typeof output==='string'||typeof output==='number') {
        const value=String(output);
        const card=node('section',{class:'tool-panel'});
        const copy=node('button',{type:'button'},'复制结果');
        copy.onclick=async()=>{
          try{await navigator.clipboard.writeText(value);status.textContent='已复制';}
          catch{status.textContent='可选中结果手动复制。';}
        };
        const controls=node('div',{class:'actions'});
        controls.append(copy);
        card.append(node('pre',{class:'tool-output'},value),controls);
        result.append(card);
      } else if(output instanceof Node){result.append(output);}
      else if(output?.files?.length) {
        const card=node('section',{class:'tool-panel extra-files'});
        for(const {blob,name,preview} of output.files) {
          const actions=node('div',{class:'actions'});
          const button=node('button',{type:'button'},'下载 '+name);
          button.onclick=()=>downloadBlob(blob,name);
          if(preview) {
            const address=URL.createObjectURL(blob);
            previews.push(address);
            card.append(node('img',{src:address,alt:name,class:'preview-image'}));
          }
          actions.append(button);
          card.append(actions);
        }
        result.append(card);
      }
      status.textContent=output?.message||'';
    } catch(error){status.textContent=error?.message||(typeof error==='string'?error:'处理失败，请检查输入。');}
    finally{buttons.forEach(button=>button.disabled=false);}
  });
}

export function outputLink(href,label=href) {
  const url = new URL(href);
  if(!['https:','http:'].includes(url.protocol))throw Error('服务返回的网址无效。');
  return node('a',{href:url.href,target:'_blank',rel:'noopener noreferrer',class:'button primary'},label);
}
export const files = (...entries) => ({files:entries});
