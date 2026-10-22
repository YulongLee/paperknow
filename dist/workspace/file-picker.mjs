import {esc,icon} from './ui.mjs';
import {bindStoredFile} from './file-selection.mjs';

const mimeKinds={'application/pdf':['pdf'],'text/plain':['txt'],'text/csv':['csv'],'text/tab-separated-values':['tsv'],'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['docx'],'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['xlsx'],'image/png':['png'],'image/jpeg':['jpg','jpeg'],'image/webp':['webp'],'image/*':['png','jpg','jpeg','webp','svg']};
export function acceptedStoredFile(row,accept=''){
 const kind=String(row.kind||row.name?.split('.').at(-1)||'').toLowerCase();
 return !!kind&&(!accept.trim()||accept.toLowerCase().split(',').some(rule=>rule.trim()==='.'+kind||(mimeKinds[rule.trim()]||[]).includes(kind)));
}
const size=bytes=>Number(bytes)>=1048576?(Number(bytes)/1048576).toFixed(1)+' MB':Math.ceil(Number(bytes)/1024)+' KB';
const formatLabel=accept=>[...new Set(String(accept||'').split(',').flatMap(rule=>rule.trim().startsWith('.')?[rule.trim().slice(1).toUpperCase()]:(mimeKinds[rule.trim()]||[]).map(kind=>kind.toUpperCase())))].join(' / ')||'当前功能支持的文件';

export function openStoredFilePicker({input,onSelect,fetchImpl=(...args)=>fetch(...args),documentObject=input?.ownerDocument||document,isCurrent=()=>!!input?.isConnected,accept=input?.accept||'',requestTimeout=60000}={}){
 const doc=documentObject,win=doc.defaultView,returnFocus=doc.activeElement,route=win.location.hash,dialog=doc.createElement('dialog');
 dialog.className='stored-file-picker';dialog.setAttribute('aria-labelledby','stored-file-title');dialog.innerHTML=`<header><div><span class="stored-file-eyebrow">你的云端资料库</span><h2 id="stored-file-title">从文件管理选择</h2><p>选择已保存的材料或生成文件，继续当前处理。</p></div><button type="button" data-picker-close aria-label="关闭文件选择">${icon('close',20)}</button></header><div class="stored-file-content"><p class="stored-file-status" role="status">正在读取你的文件…</p></div>`;
 doc.body.append(dialog);dialog.showModal();
 let closed=false,owner='',query='',source='all',items=[],originals=[],nextCursor=null,busy=false,revision=0;
 const controllers=new Set(),valid=()=>!closed&&dialog.isConnected&&isCurrent()&&win.location.hash===route;
 function close(){if(closed)return;closed=true;revision++;controllers.forEach(c=>c.abort());observer.disconnect();win.removeEventListener('hashchange',close);dialog.close();dialog.remove();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});}
 const observer=new win.MutationObserver(()=>{if(!isCurrent())close();});observer.observe(doc.body,{childList:true,subtree:true});win.addEventListener('hashchange',close);dialog.querySelector('[data-picker-close]').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 async function request(path,binary=false){
  const controller=new AbortController();controllers.add(controller);let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},requestTimeout);
  try{const response=await fetchImpl('/api'+path,{credentials:'same-origin',cache:'no-store',redirect:'error',headers:owner?{'X-PaperKnow-User':owner}:{},signal:controller.signal});if(!response.ok){const value=await response.json().catch(()=>({}));throw Object.assign(Error(typeof value.error==='string'?value.error:value.error?.message||'文件暂时无法读取，请刷新后重试。'),{status:response.status,code:response.status===401?'ACCOUNT_CHANGED':value.code});}const value=await (binary?response.arrayBuffer():response.json());if(!valid())throw new DOMException('页面已关闭','AbortError');return value;}catch(error){if(timedOut&&valid())throw Error('文件读取超时，请重试；尚未开始处理。');throw error;}finally{clearTimeout(timer);controllers.delete(controller);}
 }
 async function checkOwner(){const session=await request('/auth/me');if(!session.user?.id)throw Object.assign(Error('请先登录，再选择账户中的文件。'),{code:'ACCOUNT_CHANGED'});if(owner&&session.user.id!==owner)throw Object.assign(Error('登录账户已变化，请关闭后重新选择文件。'),{code:'ACCOUNT_CHANGED'});return session.user.id;}
 function failure(error){if(!valid())return;items=[];originals=[];dialog.querySelector('.stored-file-content').innerHTML=`<div class="stored-file-empty"><p role="alert">${esc(error.message)}</p><button type="button" class="btn secondary" data-picker-retry>重新读取</button></div>`;dialog.querySelector('[data-picker-retry]').onclick=()=>{owner='';void load();};}
 function status(message){const node=dialog.querySelector('.stored-file-status');if(node)node.textContent=message;}
 function paint(){if(!valid())return;const seen=new Set(),rows=[...(source==='artifact'?[]:originals),...(source==='original'?[]:items)].filter(row=>acceptedStoredFile(row,accept)).filter(row=>!query||row.name.toLowerCase().includes(query.toLowerCase())).filter(row=>{const key=JSON.stringify([row.name,row.kind,row.sha256]);if(seen.has(key))return false;seen.add(key);return true;});
  dialog.querySelector('.stored-file-content').innerHTML=`<form class="stored-file-search"><label>${icon('search',17)}<input type="search" aria-label="搜索已保存文件" placeholder="搜索文件名称" value="${esc(query)}" maxlength="120"></label><button type="submit" class="btn secondary" ${busy?'disabled':''}>搜索</button></form><div class="stored-file-filters" role="group" aria-label="文件来源">${[['all','全部文件'],['original','上传材料'],['artifact','云端文件']].map(([value,label])=>`<button type="button" data-picker-source="${value}" aria-pressed="${source===value}">${label}</button>`).join('')}</div><p class="stored-file-format">仅显示当前功能支持的格式：${esc(formatLabel(accept))}</p><div class="stored-file-list" aria-label="可选文件">${rows.length?rows.map(row=>`<button type="button" class="stored-file-row" data-picker-key="${row.sourceType}:${esc(row.id)}" ${busy?'disabled':''}><span class="stored-file-icon">${icon('file',21)}</span><span class="stored-file-name"><b>${esc(row.name)}</b><small>${row.sourceType==='original'?'上传材料':'云端文件'} · ${esc(String(row.kind).toUpperCase())} · ${size(row.bytes)}</small></span><span class="stored-file-use">选择 ${icon('arrow',14)}</span></button>`).join(''):'<div class="stored-file-empty">'+icon('folder',34)+'<b>没有匹配的文件</b><p>可调整搜索条件，或先在文件管理中上传材料。</p></div>'}</div><footer><p class="stored-file-status" role="status">${busy?'正在读取文件…':'选择文件后将填入当前功能，不会自动开始生成或扣费。'}</p>${nextCursor&&source!=='original'?'<button type="button" class="btn secondary" data-picker-more>加载更多</button>':''}</footer>`;
  dialog.querySelector('form').onsubmit=event=>{event.preventDefault();query=dialog.querySelector('input[type=search]').value.trim();void load();};
  dialog.querySelectorAll('[data-picker-source]').forEach(button=>button.onclick=()=>{if(busy)return;source=button.dataset.pickerSource;paint();});
  dialog.querySelector('[data-picker-more]')?.addEventListener('click',()=>{if(!busy)void load(true);});
  dialog.querySelectorAll('[data-picker-key]').forEach(button=>button.onclick=()=>{const row=rows.find(row=>row.sourceType+':'+row.id===button.dataset.pickerKey);if(row&&!busy)void choose(row);});
 }
 async function load(more=false){
  if(busy||!valid())return;busy=true;const ticket=++revision;
  try{owner=await checkOwner();const parameters=new URLSearchParams({limit:'50',expectedUserId:owner});if(query)parameters.set('q',query);if(more&&nextCursor)parameters.set('cursor',nextCursor);
   const [files,artifacts]=await Promise.all([more?Promise.resolve(null):request('/files'),request('/artifacts?'+parameters)]);
   await checkOwner();if(!valid()||ticket!==revision)return;
   if(files)originals=(files.items||[]).filter(row=>row.deletionStatus!=='pending').map(row=>({...row,sourceType:'original'}));
   const incoming=(artifacts.items||[]).filter(row=>row.status==='ready').map(row=>({...row,sourceType:'artifact'}));items=more?[...items,...incoming]:incoming;nextCursor=artifacts.nextCursor||null;busy=false;paint();
  }catch(error){if(valid()&&error.name!=='AbortError'){busy=false;failure(error);}}finally{busy=false;}
 }
 async function choose(row){
  busy=true;paint();status('正在核验并读取：'+row.name);
  try{await checkOwner();if(!valid())return;const path=row.sourceType==='original'?'/files/':'/artifacts/',buffer=await request(path+encodeURIComponent(row.id)+'/download?expectedUserId='+encodeURIComponent(owner),true);
   if(buffer.byteLength!==row.bytes)throw Error('文件大小与保存记录不一致，请刷新列表后重试。');
   const hash=Array.from(new Uint8Array(await win.crypto.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==row.sha256)throw Error('文件完整性校验未通过，请刷新后重试。');await checkOwner();if(!valid())return;
   const file=bindStoredFile(new win.File([buffer],row.name,{type:row.mimeType||'',lastModified:Date.parse(row.updatedAt||row.createdAt||row.created_at)||Date.now()}),{ownerId:owner,sourceType:row.sourceType,id:row.id,sha256:row.sha256});
   if(onSelect)await onSelect(file);else{const transfer=new win.DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new win.Event('change',{bubbles:true}));}close();
  }catch(error){if(valid()&&error.name!=='AbortError'){busy=false;if(error.code==='ACCOUNT_CHANGED')failure(error);else{paint();status(error.message||'文件选择未完成，请重试。');}}}finally{busy=false;}
 }
 void load();return {close};
}

// Decorate only new upload controls, without fetching or rescanning on each
// progress update. Feature validators and their existing change handlers stay in charge.
export function installStoredFilePickers(root,{fetchImpl}={}){
 const doc=root.ownerDocument,win=doc.defaultView,decorated=new WeakSet();let picker=null;
 const excluded=input=>input.matches('#cloud-upload-file,#upload-file,#settings-file,[data-no-file-library]')||!!input.closest('#settings-data,.settings-import');
 function add(input,anchor,beforeSelect,accept=input.accept){
  if(!anchor||decorated.has(anchor)||excluded(input))return;decorated.add(anchor);const button=doc.createElement('button');button.type='button';button.className='stored-file-trigger btn secondary';button.innerHTML=icon('folder',15)+'从文件管理选择';button.setAttribute('aria-label','从文件管理选择'+(input.getAttribute('aria-label')||''));
  // Never nest a button in an upload label: label default activation would open
  // the native file dialog while the cloud picker is already being shown.
  const label=anchor.closest('label'),placement=label||anchor;placement.insertAdjacentElement('afterend',button);
  button.onclick=event=>{event.preventDefault();event.stopPropagation();if(input.disabled||anchor.disabled||!input.isConnected)return;beforeSelect?.();picker?.close();picker=openStoredFilePicker({input,fetchImpl,accept});};
 }
 function scan(node){if(node.nodeType!==1)return;const inputs=[...(node.matches('input[type=file]')?[node]:[]),...node.querySelectorAll('input[type=file]')];
  for(const input of inputs){if(excluded(input)||!input.accept)continue;
   if(input.id==='wf-file'){for(const anchor of root.querySelectorAll('[data-wf-upload]'))add(input,anchor,()=>{input.dataset.mode=anchor.dataset.wfUpload;});continue;}
   if(input.id==='writing-file'){for(const anchor of root.querySelectorAll('.knowledge-upload-trigger'))add(input,anchor,()=>{const purpose=root.querySelector('#material-purpose');if(purpose)purpose.value=anchor.dataset.purpose==='proposal'?'导师要求':anchor.dataset.purpose==='format'?'格式要求':'已有草稿';},anchor.dataset.purpose==='other'?'.docx,.pdf,.txt':'.docx,.pdf');add(input,input);continue;}
   const anchor=input.matches('[data-template-file]')?input.parentElement.querySelector('[data-template-choose]'):input.id==='outline-file'?root.querySelector('#outline-upload-trigger'):input;
   add(input,anchor||input);
  }
 }
 scan(root);const observer=new win.MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)scan(node);});observer.observe(root,{childList:true,subtree:true});
 return {dispose(){observer.disconnect();picker?.close();}};
}
