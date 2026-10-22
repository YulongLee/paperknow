import {keys,list,hasDraftScope} from './state.mjs';

// Browser-era projects have no reliable account owner. Import only the rows the
// signed-in user explicitly selects; leave all source records and files intact.
export function mountProjectHistoryImport(root,{user,api,onImported,notify=()=>{},onBusyChange=()=>{},selectedLegacyId}={}){
 const owner=typeof user?.id==='string'?user.id:'';
 let alive=true,busy=false;
 const current=()=>alive&&root.isConnected&&user?.id===owner;
 const setBusy=value=>{if(busy===value)return;busy=value;onBusyChange(value);};
 const dispose=()=>{alive=false;setBusy(false);};
 root.replaceChildren();
 if(!owner||typeof api!=='function'||hasDraftScope())return dispose;
 const source=list(keys.projects),seen=new Set(),entries=[];
 for(const row of source){
  if(!row||typeof row!=='object'||Array.isArray(row))continue;
  const localId=typeof row.id==='string'||typeof row.id==='number'?String(row.id):'',title=typeof(row.name??row.title)==='string'?String(row.name??row.title).trim():'';
  if(!localId||!title||seen.has(localId))continue;
  seen.add(localId);
  const item={localId,title,degree:typeof row.degree==='string'&&row.degree?row.degree:'本科',major:typeof row.major==='string'?row.major:'',stage:typeof row.stage==='string'&&row.stage?row.stage:'准备中',description:typeof row.description==='string'?row.description:'',status:row.status==='archived'?'archived':'active'};
  const valid=localId.length<=200&&title.length<=200&&item.degree.length<=20&&item.major.length<=100&&item.stage.length<=50&&item.description.length<=5000;
  entries.push({item,valid});
 }
 if(!entries.length)return dispose;
 const doc=root.ownerDocument,node=(tag,text,className)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
 const details=node('details',undefined,'card account-project-history');
 details.open=entries.some(entry=>entry.item.localId===String(selectedLegacyId??''));
 const summary=node('summary');summary.append(node('span','导入历史项目'),node('small',`发现 ${entries.length} 个历史项目`));
 const description=node('p','选择需要保存在当前账户的历史项目。只导入项目名称、专业、阶段和研究说明；原记录会保留。','muted');
 const contentNote=node('p','历史草稿、文件与报告不会随项目自动上传，请在“文件管理”中选择需要转存的内容，并归入对应项目。','muted');
 const form=node('form'),fieldset=node('fieldset',undefined,'account-project-history-list');
 fieldset.append(node('legend','选择要导入的项目（每次最多 100 个）'));
 const checks=[];
 for(const entry of entries){
  const{item,valid}=entry,label=node('label',undefined,'account-project-history-row'),check=node('input');check.type='checkbox';check.value=item.localId;check.name='legacy-project';check.disabled=!valid;
  if(item.localId===String(selectedLegacyId??''))label.dataset.highlighted='true';
  const copy=node('span');copy.append(node('b',item.title),node('small',valid?[item.degree,item.major,item.status==='archived'?'已归档':'进行中'].filter(Boolean).join(' · '):'信息超过导入限制，请联系支持；原记录仍保留。'));
  label.append(check,copy);fieldset.append(label);checks.push({check,entry,label});
 }
 const status=node('p','请选择项目后确认导入。','muted');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const actions=node('div',undefined,'actions'),submit=node('button','确认导入所选项目','primary'),cancel=node('button','取消选择');submit.type='submit';submit.disabled=true;cancel.type='button';actions.append(submit,cancel);
 const count=()=>checks.filter(({check})=>check.checked).length;
 const update=()=>{const n=count();status.className='muted';submit.disabled=busy||n===0||n>100;cancel.disabled=busy;for(const{check,entry}of checks)check.disabled=busy||!entry.valid;status.textContent=n>100?'每次最多导入 100 个项目，请减少选择。':n?`已选择 ${n} 个项目，确认后保存到当前账户。`:'请选择项目后确认导入。';};
 form.addEventListener('change',update);cancel.addEventListener('click',()=>{if(busy||!current())return;for(const{check}of checks)check.checked=false;update();details.open=false;summary.focus({preventScroll:true});});
 form.append(fieldset,contentNote,status,actions);details.append(summary,description,form);root.append(details);
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(!current()||busy)return;
  const selected=checks.filter(({check,entry})=>check.checked&&entry.valid).map(({entry})=>entry.item);
  if(!selected.length||selected.length>100){update();return;}
  setBusy(true);update();status.textContent=`正在导入 ${selected.length} 个项目，请稍候…`;
  let saved=false;
  try{
   const data=await api('/projects/import-local',{expectedUserId:owner,items:selected});
   if(!current())return;
   const mappings=data?.mappings;
   if(!Array.isArray(mappings)||!selected.every(item=>mappings.some(mapping=>mapping?.localId===item.localId&&typeof mapping?.projectId==='string'&&mapping.projectId))){throw Error('导入结果尚未确认，请重试；已保存的项目不会重复创建。');}
   saved=true;for(const{check}of checks)if(selected.some(item=>item.localId===check.value))check.checked=false;
   setBusy(false);update();status.textContent='项目已保存到当前账户，历史原记录仍保留。';notify('历史项目已导入，原记录仍保留。');
   if(typeof onImported==='function')await onImported(data);
  }catch(error){
   if(current()){setBusy(false);update();status.textContent=saved?'项目已导入，但最新列表暂未读取，请刷新项目列表。':typeof error?.message==='string'&&error.message?error.message:'导入暂未完成，请重试；原记录仍保留。';status.className='error';}
  }finally{setBusy(false);}
 });
 return dispose;
}
