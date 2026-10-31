import {savedLiterature,removeLiteratureRecords,publishFileDeleted,reconcileLiteratureDeletions} from './literature-file-sync.mjs';
import {esc} from './ui.mjs';
import {hasStateStore,stateStoreVersion} from './state.mjs';

export function mountLiteratureDeletion({container,ctx,signal,getSelected=()=>[],onDeleted=()=>{},fetchImpl=(...args)=>fetch(...args)}={}){
 const doc=container.ownerDocument,win=doc.defaultView,route=win.location.hash;
 let busy=false;
 const current=()=>!signal?.aborted&&container.isConnected&&win.location.hash===route;
 async function api(path,body,owner){
  const deadline=win.AbortSignal.timeout(45000),combined=signal?win.AbortSignal.any([signal,deadline]):deadline;
  const response=await fetchImpl('/api'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:combined,headers:{...(body?{'Content-Type':'application/json'}:{}),...(owner?{'X-PaperKnow-User':owner}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json();if(!response.ok)throw Object.assign(Error(typeof value.error==='string'?value.error:value.error?.message||'删除未完成，请稍后重试'),{status:response.status,code:value.code});return value;
 }
 async function remove(paper){
  const latest=savedLiterature(win).find(row=>row.id===paper.id);
  if(!latest)return;
  if(JSON.stringify(latest)!==JSON.stringify(paper))throw Error('文献已在其他页面更新，请关闭此窗口后重新选择');
  if(!paper.originalFileId&&!paper.originalOwnerId&&hasStateStore('paperknow-literature')){
   const version=stateStoreVersion('paperknow-literature',paper.id),session=await api('/auth/me'),owner=session.user?.id;if(!current())return false;if(!owner)throw Error('请先登录，再删除文献。');
   const result=await api('/literature/library',{expectedUserId:owner,id:paper.id,version,item:null},owner);if(!current())return false;if(result.ownerId!==owner||result.entry?.id!==paper.id||result.entry.item!==null)throw Error('文献删除结果未确认，请稍后重试。');
  }
  if(paper.originalFileId||paper.originalOwnerId){
   if(!paper.originalFileId||!paper.originalOwnerId)throw Error('原文关联不完整，请从文件管理核对后重试');
   const owner=paper.originalOwnerId,session=await api('/auth/me');
   if(!current())return false;
   if(session.user?.id!==owner)throw Object.assign(Error('请登录上传这份原文的账户后删除'),{code:'ACCOUNT_CHANGED'});
   const files=await api('/files',undefined,owner);if(!current())return false;
   if(!Array.isArray(files.items))throw Error('原文列表无法核对，请稍后重试');
   const file=files.items.find(row=>row.id===paper.originalFileId);
   if(file){
    if(typeof file.sha256!=='string'||!file.sha256)throw Error('原文信息无法核对，请刷新后重试');
    if(JSON.stringify(savedLiterature(win).find(row=>row.id===paper.id))!==JSON.stringify(paper))throw Error('文献已在其他页面更新，请重新选择后删除');
    const result=await api('/files/'+encodeURIComponent(file.id)+'/delete',{expectedSha256:file.sha256},owner);
    if(result.deleted!==true||result.id!==file.id)throw Error('删除结果未确认，请刷新文件列表核对');
   }else{
    const result=await api('/files/deletions/check',{expectedUserId:owner,fileIds:[paper.originalFileId]},owner);
    if(result.ownerId!==owner||!result.deletedIds?.includes(paper.originalFileId))throw Error('未能确认关联原文的状态，请从文件管理核对后重试');
   }
   // Apply only the confirmed original and its owner, even if the view changed
   // while the server was removing the private object.
   publishFileDeleted({ownerId:owner,fileId:paper.originalFileId},{win});
  }else removeLiteratureRecords([paper.id],{win});
  return true;
 }
 function open(ids){
  if(!current()||busy)return;
  const rows=savedLiterature(win),requested=rows.filter(row=>ids.includes(row.id)),originals=new Set(requested.filter(row=>row.originalFileId&&row.originalOwnerId).map(row=>JSON.stringify([row.originalOwnerId,row.originalFileId])));
  let chosen=rows.filter(row=>ids.includes(row.id)||originals.has(JSON.stringify([row.originalOwnerId,row.originalFileId])));if(!chosen.length){ctx.notify('请选择要删除的文献');return;}
  const linked=chosen.some(row=>row.originalFileId);
  ctx.modal(chosen.length===1?'删除文献':'批量删除文献',`<section class="lit-delete-dialog"><p>${linked?'将删除所选文献及关联的云端原文，文件管理同步移除原件。':'将删除所选文献的题录、正文和阅读记录。'}相关笔记和阅读记录会一并移除，删除后无法恢复。</p>${linked?'<p class="lit-delete-note">已生成的独立成果文件继续保留。</p>':''}${chosen.length>requested.length?'<p class="lit-delete-note">同一原文关联的其他文献记录也将一并删除，完整列表如下。</p>':''}<ul>${chosen.map(row=>`<li>${esc(row.title)}</li>`).join('')}</ul><p data-lit-delete-progress role="status" aria-live="polite"></p><div data-lit-delete-errors role="alert"></div><div class="actions"><button type="button" class="btn lit-delete-danger" data-lit-delete-confirm>确认删除 ${chosen.length} 篇文献</button><button type="button" class="btn secondary" data-lit-delete-cancel>取消</button></div></section>`);
  const host=doc.querySelector('.lit-delete-dialog'),confirm=host.querySelector('[data-lit-delete-confirm]'),cancel=host.querySelector('[data-lit-delete-cancel]'),progress=host.querySelector('[data-lit-delete-progress]'),errors=host.querySelector('[data-lit-delete-errors]');
  cancel.onclick=()=>{if(!busy)doc.querySelector('#workspace-dialog')?.close();};
  confirm.onclick=async()=>{
   if(!current()||busy||!host.isConnected)return;busy=true;confirm.disabled=cancel.disabled=true;errors.replaceChildren();let count=0,processed=0;const failures=[];
   try{
    for(const paper of chosen){
     if(!current())break;progress.textContent=`正在删除 ${processed} / ${chosen.length} 篇文献…`;
     try{const done=await remove(paper);if(done===false)break;count++;}catch(error){failures.push({paper,message:error.message});if(error.status===401||error.code==='ACCOUNT_CHANGED'){failures.push(...chosen.slice(processed+1).map(paper=>({paper,message:'账户状态已变化，未执行删除'})));break;}}
     processed++;
    }
    if(!current())return;
    if(!failures.length){doc.querySelector('#workspace-dialog')?.close();ctx.notify(`已删除 ${count} 篇文献${linked?'，文件管理已同步':''}`);onDeleted();}
    else{
     chosen=failures.map(row=>row.paper);progress.textContent=`已删除 ${count} 篇，${failures.length} 篇未删除。`;
     errors.innerHTML='<ul>'+failures.map(row=>`<li><b>${esc(row.paper.title)}</b>：${esc(row.message)}</li>`).join('')+'</ul>';
     confirm.textContent='重试未删除的文献';cancel.textContent='关闭';onDeleted();
    }
   }finally{busy=false;if(host.isConnected)confirm.disabled=cancel.disabled=false;}
  };
  confirm.focus();
 }
 const clicked=event=>{const button=event.target.closest('[data-lit-delete],[data-lit-delete-selected]');if(!button||!container.contains(button))return;event.preventDefault();open(button.hasAttribute('data-lit-delete')?[button.dataset.litDelete]:getSelected());};
 container.addEventListener('click',clicked,{signal});
 void reconcileLiteratureDeletions({win,fetchImpl,signal,isCurrent:current}).catch(()=>{});
 return {open};
}
