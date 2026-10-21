import {projects as localProjects,hasDraftScope,draftScopeOwnerId} from './state.mjs';
import {withStableView} from './view-stability.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let owner=null,rows=[],status='loading',revision=0,request=null,requestEpoch=0,loadedAt=0;
const listeners=new Set();
const emit=()=>{revision++;for(const listener of listeners)listener();};
export const projectReference=(ownerId,id)=>`account:${encodeURIComponent(ownerId)}:${encodeURIComponent(id)}`;
function reference(value){
 if(!String(value||'').startsWith('account:'))return null;
 const parts=String(value).split(':');
 try{if(parts.length!==3||!parts[1]||!parts[2])throw Error();return {ownerId:decodeURIComponent(parts[1]),id:decodeURIComponent(parts[2])};}catch{throw Error('项目关联信息无效，请重新选择所属项目。');}
}
export function resolveAccountProjectId(value,ownerId){
 if(!value)return null;
 const ref=reference(value);
 if(ref){if(!ownerId||ref.ownerId!==ownerId)throw Error('所属项目属于其他账户，请重新选择当前账户的项目。');return ref.id;}
 if(hasDraftScope()){
  if(!ownerId||draftScopeOwnerId()!==ownerId)throw Error('登录账户已变化，请重新打开账户草稿后选择项目。');
  if(!localProjects().some(row=>String(row.id)===String(value)))throw Error('原关联项目暂不可用，请重新选择所属项目。');
  return String(value);
 }
 return null;
}
export function selectableProjects(){
 if(hasDraftScope())return localProjects().map(row=>({...row,name:row.name||row.title,projectId:row.id,projectScope:'account',ownerId:draftScopeOwnerId()}));
 return [...rows.map(row=>({...row,id:projectReference(owner.id,row.id),projectId:row.id,ownerId:owner.id,name:row.title||row.name,projectScope:'account'})),...localProjects().map(row=>({...row,projectScope:'local'}))];
}
export function setProjectDirectorySession(user,{status:nextStatus='ready'}={}){
 const next=user?.id?{id:String(user.id)}:null,changed=next?.id!==owner?.id,previousStatus=status;
 if(changed){requestEpoch++;request=null;rows=[];loadedAt=0;}
 owner=next;status=next?(changed?'idle':status):nextStatus==='loading'?'loading':nextStatus==='error'?'error':'guest';if(changed||status!==previousStatus)emit();
 if(next&&listeners.size&&(changed||status==='idle'))void refreshAccountProjects();
}
export function updateAccountProjects(ownerId,items,{invalidate=true}={}){
 if(!owner||owner.id!==ownerId||!Array.isArray(items))return false;
 if(invalidate){requestEpoch++;request=null;}
 rows=items.filter(row=>row&&typeof row.id==='string'&&typeof (row.title??row.name)==='string').map(row=>({...row}));status='ready';loadedAt=Date.now();emit();return true;
}
export async function refreshAccountProjects({force=false}={}){
 if(!owner)return [];
 if(request)return request;
 if(!force&&status==='ready'&&Date.now()-loadedAt<5000)return rows;
 const expected=owner.id,epoch=++requestEpoch;status='loading';emit();
 request=(async()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetch('/api/projects',{credentials:'same-origin',cache:'no-store',headers:{'X-PaperKnow-User':expected},signal:controller.signal});
   const data=await response.json();
   if(epoch!==requestEpoch||owner?.id!==expected)return [];
   if(!response.ok||!Array.isArray(data.items))throw Error('账户项目暂时无法读取。');
   updateAccountProjects(expected,data.items,{invalidate:false});return rows;
  }catch(error){if(epoch===requestEpoch&&owner?.id===expected){rows=[];status='error';emit();}return [];}
  finally{clearTimeout(timer);if(epoch===requestEpoch)request=null;}
 })();return request;
}
export function installProjectPickers(root,{onSessionRetry}={}){
 const doc=root.ownerDocument,win=doc.defaultView,seen=new WeakMap(),optionMarkup=new WeakMap();let alive=true,scheduled=false;
 function paint(select){
  const initial=!seen.has(select),value=initial?select.dataset.projectRef||select.value:select.value;
  const stamp=JSON.stringify([revision,hasDraftScope(),draftScopeOwnerId(),value,localProjects()]);
  if(seen.get(select)===stamp)return;
  const choices=selectableProjects().filter(p=>!select.hasAttribute('data-project-account-only')||p.projectScope==='account'),account=choices.filter(p=>p.projectScope==='account'),local=choices.filter(p=>p.projectScope!=='account');
  const option=p=>`<option value="${esc(p.id)}" ${String(p.id)===String(value)?'selected':''}>${esc(p.name||p.title||'未命名项目')}${p.status==='archived'?'（已归档）':''}</option>`;
  let html='<option value="">未归入项目</option>';
  if(account.length)html+=`<optgroup label="账户项目">${account.map(option).join('')}</optgroup>`;
  if(local.length)html+=`<optgroup label="本地项目">${local.map(option).join('')}</optgroup>`;
  const missing=!!value&&!choices.some(p=>String(p.id)===String(value));
  if(missing)html+=`<option value="${esc(value)}" selected disabled>原关联项目暂不可用，请重新选择</option>`;
  if(optionMarkup.get(select)!==html){select.innerHTML=html;select.value=value||'';optionMarkup.set(select,html);}select.setAttribute('aria-busy',String(!hasDraftScope()&&status==='loading'));
  if(missing)select.setAttribute('aria-invalid','true');else select.removeAttribute('aria-invalid');
  let note=select.nextElementSibling;
  if(!note?.hasAttribute('data-project-picker-status')){note=doc.createElement('span');note.dataset.projectPickerStatus='';note.className='project-picker-status';note.setAttribute('role','status');select.after(note);}
  note.replaceChildren();
  if(!hasDraftScope()&&status==='loading')note.textContent='正在读取账户项目…';
  else if(!hasDraftScope()&&status==='error'){
   note.append(doc.createTextNode(owner?'账户项目读取失败，已保留当前选择。':'账户连接暂不可用，已保留当前选择。'));
   if(owner||onSessionRetry){const retry=doc.createElement('button');retry.type='button';retry.textContent=owner?'重新读取':'重新连接';retry.onclick=()=>owner?void refreshAccountProjects({force:true}):void onSessionRetry();note.append(retry);}
  }else if(!hasDraftScope()&&status==='guest'&&!local.length)note.textContent='登录后可选择“我的项目”中创建的账户项目。';
  else if(!hasDraftScope()&&account.length)note.textContent='账户项目关联在线任务与生成成果；草稿按页面提示保存。';
  note.hidden=!note.textContent;seen.set(select,stamp);
 }
 function update(){if(!alive||!root.isConnected)return;withStableView(root.closest('.dashboard')||root,()=>root.querySelectorAll('select[data-project-picker]').forEach(paint));}
 function schedule(){if(scheduled||!alive)return;scheduled=true;queueMicrotask(()=>{scheduled=false;update();if(root.querySelector('select[data-project-picker]'))void refreshAccountProjects();});}
 const observer=new win.MutationObserver(records=>{if(records.some(record=>[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches?.('select[data-project-picker]')||node.querySelector?.('select[data-project-picker]')))))schedule();});
 observer.observe(root,{childList:true,subtree:true});listeners.add(update);schedule();
 const change=event=>{const select=event.target;if(select.matches?.('select[data-project-picker]')){select.dataset.projectRef=select.value;select.removeAttribute('aria-invalid');}};
 root.addEventListener('change',change);
 return ()=>{alive=false;observer.disconnect();listeners.delete(update);root.removeEventListener('change',change);};
}
