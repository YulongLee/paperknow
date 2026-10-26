import {esc,icon} from './ui.mjs';
import {withStableView} from './view-stability.mjs';
import {artifactBase64} from './artifact-export.mjs';

const kinds=['pdf','docx','pptx','xlsx','txt','md','csv','json','html','svg','png','jpg','jpeg','zip','tex','mml','bib','ris'];
const size=value=>{const n=Number(value)||0;return n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B';};
const states={ready:'已保存',uploading:'保存中',deleting:'删除待重试',failed:'保存待重试'};
const date=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'}):'时间未记录';};

export function mountArtifactLibrary(root,{session,notify=()=>{},fetchImpl=globalThis.fetch,projectId=''}={}){
 let disposed=false,request=0,page=1,query='',kind='',project=String(projectId||''),owner=null,data=null,armed=null,editing=null,busy=false,uploadOpen=false,projects=[],projectError='';
 let originalsOpen=false,originals=null,originalsOwner=null,originalsPage=1,originalsRequest=0,originalsLoading=false,originalsError='',originalArmed=null;
 const selections={cloud:new Map(),original:new Map()};let bulkConfirm=null,bulkProgress=null;const bulkMessages={cloud:'',original:''},bulkFailures={cloud:[],original:[]};
 const controllers=new Set(),alive=()=>!disposed&&root.isConnected,doc=root.ownerDocument;
 const paint=html=>{if(alive())withStableView(root.closest('.dashboard')||root,()=>{root.innerHTML=html;});};
 const heading=()=>`<div class="cloud-artifact-heading"><div><span class="cloud-artifact-icon">${icon('folder',22)}</span><div><h2>云端文件</h2><p>生成和上传的文件集中保存，登录后可跨设备管理。</p></div></div><div class="cloud-artifact-heading-actions"><button type="button" data-cloud-refresh aria-label="刷新云端文件"><span aria-hidden="true">↻</span>刷新</button>${data?`<button type="button" data-cloud-upload-open class="cloud-artifact-primary" aria-expanded="${uploadOpen}">${icon('plus',15)}上传文件</button>`:''}</div></div>`;
 function clearSelections(){selections.cloud.clear();selections.original.clear();bulkConfirm=null;for(const area of ['cloud','original']){bulkMessages[area]='';bulkFailures[area]=[];}}
 const pageRows=area=>area==='cloud'?(data?.items||[]):filteredOriginals().slice((originalsPage-1)*10,originalsPage*10);
 function bulkToolbar(area){
  const selected=selections[area],rows=pageRows(area),all=rows.length>0&&rows.every(row=>selected.has(row.id)),running=!!bulkProgress;
  return `<section class="cloud-file-bulk" data-file-bulk="${area}" aria-label="${area==='cloud'?'云端文件':'已上传材料'}批量管理"><div class="cloud-file-bulk-actions"><label class="cloud-file-select-all"><input type="checkbox" data-bulk-all="${area}" aria-label="全选本页${area==='original'?'材料':'文件'}" ${all?'checked':''} ${!rows.length||running?'disabled':''}>全选本页</label><span role="status">已选 <b>${selected.size}</b> 个${selected.size?' · 跨页保留选择':''}</span><div><button type="button" data-bulk-clear="${area}" ${!selected.size||running?'disabled':''}>取消选择</button><button type="button" data-bulk-remove="${area}" class="cloud-artifact-danger" ${!selected.size||running?'disabled':''}>批量删除${selected.size?'（'+selected.size+'）':''}</button></div></div>${bulkConfirm===area?`<div class="cloud-file-bulk-confirm" role="alertdialog" aria-label="确认批量删除${area==='original'?'材料':'文件'}"><b>确认删除选中的 ${selected.size} 个${area==='original'?'材料原件':'云端文件'}？</b><p>删除后无法恢复。${area==='original'?'已生成的结果仍会保留。':'已下载到电脑的文件不受影响。'}</p><ul>${[...selected.values()].map(row=>`<li>${esc(row.name)}</li>`).join('')}</ul><div><button type="button" class="cloud-artifact-danger" data-bulk-confirm="${area}">确认删除 ${selected.size} 个文件</button><button type="button" data-bulk-cancel>取消</button></div></div>`:''}${bulkProgress?.area===area?`<p class="cloud-file-bulk-progress" role="status" aria-live="polite">正在删除 ${bulkProgress.done} / ${bulkProgress.total} 个文件，请稍候…<progress max="${bulkProgress.total}" value="${bulkProgress.done}" aria-label="批量删除进度"></progress></p>`:''}${bulkMessages[area]?`<p class="cloud-file-bulk-result" role="status">${esc(bulkMessages[area])}</p>`:''}${bulkFailures[area].length?`<ul class="cloud-file-bulk-failures" aria-label="未删除的文件与原因">${bulkFailures[area].map(row=>`<li><b>${esc(row.name)}</b>：${esc(row.message)}</li>`).join('')}</ul>`:''}</section>`;
 }
 function paintSelections(){
  if(!alive())return;
  const focused=doc.activeElement,focusArea=focused?.dataset?.bulkAll;
  root.querySelectorAll('[data-file-bulk]').forEach(node=>{node.outerHTML=bulkToolbar(node.dataset.fileBulk);});
  root.querySelectorAll('[data-bulk-select]').forEach(node=>{const area=node.dataset.bulkSelect;node.checked=selections[area].has(node.value);node.disabled=!!bulkProgress;node.closest('article')?.classList.toggle('is-selected',node.checked);});
  root.querySelectorAll('[data-bulk-all]').forEach(node=>{const rows=pageRows(node.dataset.bulkAll),count=rows.filter(row=>selections[node.dataset.bulkAll].has(row.id)).length;node.indeterminate=count>0&&count<rows.length;});
  if(bulkProgress)root.querySelectorAll('button,input,select').forEach(node=>{node.disabled=true;});
  else if(focusArea&&!focused.isConnected)root.querySelector('[data-bulk-all="'+focusArea+'"]')?.focus({preventScroll:true});
 }
 function selectFiles(event){
  const input=event.target;if(!input.matches('[data-bulk-select],[data-bulk-all]')||busy)return;
  const area=input.dataset.bulkSelect||input.dataset.bulkAll;if(!selections[area])return;
  const rows=input.hasAttribute('data-bulk-all')?pageRows(area):pageRows(area).filter(row=>row.id===input.value);
  for(const row of rows)if(input.checked)selections[area].set(row.id,{id:row.id,name:row.name,sha256:row.sha256});else selections[area].delete(row.id);
  bulkConfirm=null;bulkMessages[area]='';bulkFailures[area]=[];paintSelections();
 }
 async function deleteSelected(area){
  if(bulkConfirm!==area||!selections[area]?.size||!owner)return;
  const chosen=[...selections[area].values()],expectedOwner=owner,version=request;let removed=0;
  busy=true;bulkConfirm=null;bulkMessages[area]='';bulkFailures[area]=[];bulkProgress={area,done:0,total:chosen.length};paintSelections();
  try{
   for(const row of chosen){
    if(!await confirmOwner(expectedOwner,version))return;
    try{
     const input={expectedSha256:row.sha256,...(area==='cloud'?{expectedUserId:expectedOwner}:{})};
     const result=await api('/'+encodeURIComponent(row.id)+'/delete',input,expectedOwner,false,area==='cloud'?'/api/artifacts':'/api/files');
     if(result?.deleted!==true||result.id!==row.id)throw Error('删除结果无法确认，请刷新文件列表核对后再重试');
     if(!await confirmOwner(expectedOwner,version))return;
     selections[area].delete(row.id);removed++;if(area==='original')originals=originals.filter(value=>value.id!==row.id);
    }catch(error){
     if(!alive()||version!==request)return;
     if(error.status===401||error.code==='ACCOUNT_CHANGED'){invalidate(error.message);return;}
     bulkFailures[area].push({id:row.id,name:row.name,message:error.message||'删除未完成，请重试'});
    }
    if(!alive()||version!==request)return;bulkProgress.done++;paintSelections();
   }
   if(!await confirmOwner(expectedOwner,version))return;
   bulkMessages[area]=`已删除 ${removed} 个文件${bulkFailures[area].length?'，'+bulkFailures[area].length+' 个未删除，已保留选择，可核对原因后重试。':'。'}`;notify(bulkMessages[area]);
   bulkProgress=null;await refresh({preserveSelection:true});
   if(alive()&&owner===expectedOwner&&area==='original'&&originalsOpen)await loadOriginals({preserveSelection:true,preservePage:true});
  }catch(error){if(alive()&&version===request){bulkMessages[area]='批量删除已停止；已确认删除 '+removed+' 个文件，其余选择保留。'+(error.message||'请刷新后核对。');notify(bulkMessages[area]);}}finally{busy=false;bulkProgress=null;if(alive()&&data)content();}
 }
 function invalidate(message){clearSelections();bulkProgress=null;request++;originalsRequest++;owner=null;data=null;armed=null;editing=null;projects=[];originals=null;originalsOwner=null;originalsOpen=false;originalsLoading=false;originalArmed=null;paint(heading()+'<p class="cloud-artifact-error" role="alert">'+esc(message)+'</p>');}
 async function api(path,input,expectedOwner=owner,binary=false,base='/api/artifacts'){
  const c=new AbortController();controllers.add(c);const timeout=setTimeout(()=>c.abort(),60000);
  try{
   const r=await fetchImpl(base+path,{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{...(input?{'Content-Type':'application/json'}:{}),...(expectedOwner?{'X-PaperKnow-User':expectedOwner}:{})},body:input?JSON.stringify(input):undefined,signal:c.signal});
   if(!r.ok){const v=await r.json().catch(()=>({}));throw Object.assign(Error(typeof v.error==='string'?v.error:v.error?.message||'云文件暂时无法读取，请稍后重试'),{status:r.status,code:v.code});}
   return await (binary?r.blob():r.json());
  }catch(error){if(c.signal.aborted)throw Error('云文件读取超时或已中止，请重试');throw error;}finally{clearTimeout(timeout);controllers.delete(c);}
 }
 const projectOptions=(selected='',filter=false)=>`${filter?'<option value="">所有项目</option><option value="none" '+(selected==='none'?'selected':'')+'>未归入项目</option>':'<option value="">未归入项目</option>'}${projects.map(p=>`<option value="${esc(p.id)}" ${selected===p.id?'selected':''}>${esc(p.title)}</option>`).join('')}`;
 const filteredOriginals=()=>Array.isArray(originals)?originals.filter(row=>(!query||row.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))&&(!kind||row.kind===kind)&&(!project||(project==='none'?!row.project_id:row.project_id===project))):[];
 function originalMaterials(){
  const filtered=filteredOriginals(),pages=Math.max(1,Math.ceil(filtered.length/10));originalsPage=Math.min(originalsPage,pages);
  return `<section class="cloud-original-materials" aria-label="已上传材料"><button type="button" class="cloud-original-toggle" data-original-toggle aria-expanded="${originalsOpen}" aria-controls="cloud-original-content"><span>${icon('file',19)}<span><b>已上传材料${originals?`<small>${originals.length} 份</small>`:''}</b><small>已保存的论文、研究资料与学校模板，可在其他功能中选择使用。</small></span></span><span aria-hidden="true">${originalsOpen?'⌃':'⌄'}</span></button>${originalsOpen?`<div id="cloud-original-content" class="cloud-original-content">${originalsLoading?'<p class="cloud-original-status" role="status">正在读取已上传材料…</p>':originalsError?`<p class="cloud-artifact-error" role="alert">${esc(originalsError)}</p>`:''}${originals&&!originalsLoading?`${bulkToolbar('original')}<div class="cloud-original-list" aria-label="已上传材料列表">${filtered.length?filtered.slice((originalsPage-1)*10,originalsPage*10).map(row=>{
   const projectName=projects.find(p=>p.id===row.project_id)?.title;
   return `<article class="cloud-artifact-row" data-original-file="${esc(row.id)}"><div class="cloud-artifact-fileline"><label class="cloud-file-check"><input type="checkbox" data-bulk-select="original" value="${esc(row.id)}" aria-label="选择材料：${esc(row.name)}" ${selections.original.has(row.id)?'checked':''}></label><span class="cloud-artifact-kind">${esc(row.kind.toUpperCase())}</span><div class="cloud-artifact-copy"><b title="${esc(row.name)}">${esc(row.name)}</b><small>${size(row.bytes)}<i>·</i>${esc(date(row.created_at))}${row.deletionStatus==='pending'?'<i>·</i><span>删除待重试</span>':''}</small><span class="cloud-artifact-project">${icon('folder',12)}${esc(projectName||(row.project_id?'已归入项目':'未归入项目'))}</span>${originalArmed===row.id?'<p>删除原件后无法恢复；已经生成的结果仍会保留。</p>':''}</div><div class="cloud-artifact-actions">${originalArmed===row.id?`<button type="button" data-original-remove-confirm="${esc(row.id)}" class="cloud-artifact-danger">确认删除</button><button type="button" data-original-remove-cancel>取消</button>`:`${row.deletionStatus==='pending'?'':`<button type="button" data-original-download="${esc(row.id)}">下载</button>`}<button type="button" data-original-remove="${esc(row.id)}">${row.deletionStatus==='pending'?'重试删除':'删除'}</button>`}</div></div></article>`;
  }).join(''):`<p class="cloud-artifact-empty">${query||kind||project?'没有符合当前名称、格式或项目的已上传材料。':'还没有已上传材料。在写作、研读等功能中保存的原件会显示在这里。'}</p>`}</div><div class="cloud-artifact-footer"><span>共 ${filtered.length} 份材料 · 第 ${originalsPage} / ${pages} 页${query||kind||project?' · 已筛选':''}</span><div><button type="button" data-original-page="${originalsPage-1}" ${originalsPage<=1?'disabled':''}>上一页</button><button type="button" data-original-page="${originalsPage+1}" ${originalsPage>=pages?'disabled':''}>下一页</button></div></div>`:''}<div class="cloud-original-toolbar"><p>沿用上方名称、格式与项目筛选。</p><button type="button" data-original-refresh ${originalsLoading?'disabled':''}>${originalsError?'重试读取':'刷新材料'}</button></div></div>`:''}</section>`;
 }
 function content(){
  const rows=data.items||[],pages=Math.max(1,Math.ceil(data.total/10)),used=Number(data.usedBytes)||0,quota=Number(data.quotaBytes)||0;
  const upload=uploadOpen?`<form class="cloud-artifact-upload"><div><h3>上传到云端</h3><p>文档、演示、图片与数据文件，单文件最大 ${size(data.maxFileBytes)}。</p></div><label for="cloud-upload-file">选择文件<input id="cloud-upload-file" type="file" required accept="${kinds.map(k=>'.'+k).join(',')}"></label><label for="cloud-upload-project">所属项目<select id="cloud-upload-project" ${projectError?'disabled':''}>${projectOptions()}</select></label><div><button class="cloud-artifact-primary" type="submit" ${data.storageReady===false?'disabled':''}>保存到云端</button><button type="button" data-cloud-upload-close>取消</button></div><p class="cloud-artifact-form-error" role="alert"></p></form>`:'';
  paint(heading()+`<div class="cloud-artifact-overview"><div><span>当前文件</span><b>${data.total}<small> 个${query||kind||project?' · 已筛选':''}</small></b></div><div><span>云存储空间</span><b>${size(used)}<small> / ${size(quota)}</small></b><meter min="0" max="${quota||1}" value="${Math.min(used,quota||1)}" aria-label="已用云存储空间"></meter></div><div class="cloud-artifact-private">${icon('shield',22)}<span><b>私有存储</b><small>仅当前账户可访问和下载</small></span></div></div>${data.storageReady===false?'<p class="cloud-artifact-error" role="alert">云存储暂不可用，请稍后再上传。已有文件记录仍会保留。</p>':''}${upload}<form class="cloud-artifact-search"><label class="cloud-artifact-searchbox" for="cloud-artifact-query">${icon('search',16)}<input id="cloud-artifact-query" name="q" maxlength="120" aria-label="搜索云端文件" placeholder="搜索文件名称" value="${esc(query)}"></label><select name="kind" aria-label="筛选文件格式"><option value="">所有格式</option>${kinds.map(k=>`<option value="${k}" ${kind===k?'selected':''}>${k.toUpperCase()}</option>`).join('')}</select><select name="project" aria-label="筛选文件所属项目" ${projectError?'disabled':''}>${projectOptions(project,true)}</select><button type="submit">查找</button>${query||kind||project?'<button type="button" data-cloud-reset>重置</button>':''}</form>${projectError?'<p class="cloud-artifact-project-error" role="status">项目目录暂不可用，仍可管理文件；刷新后重试项目整理。</p>':''}${bulkToolbar('cloud')}<div class="cloud-artifact-list" aria-label="云端文件列表">${rows.length?rows.map(row=>{
   const projectId=row.projectId||row.project_id||'',projectName=projects.find(p=>p.id===projectId)?.title;
   const editor=editing===row.id?`<form class="cloud-artifact-metadata" data-cloud-metadata="${esc(row.id)}"><label for="cloud-name-${esc(row.id)}">文件名称<input id="cloud-name-${esc(row.id)}" name="name" maxlength="180" required value="${esc(row.name)}"></label>${!projectError?`<label>所属项目<select name="projectId">${projectId&&!projectName?`<option value="${esc(projectId)}" selected>保留原项目</option>`:''}${projectOptions(projectId)}</select></label>`:''}<div><button type="submit" class="cloud-artifact-primary">保存修改</button><button type="button" data-cloud-edit-cancel>取消</button></div><p class="cloud-artifact-form-error" role="alert"></p></form>`:'';
   return `<article class="cloud-artifact-row" data-cloud-file="${esc(row.id)}"><div class="cloud-artifact-fileline"><label class="cloud-file-check"><input type="checkbox" data-bulk-select="cloud" value="${esc(row.id)}" aria-label="选择文件：${esc(row.name)}" ${selections.cloud.has(row.id)?'checked':''}></label><span class="cloud-artifact-kind kind-${['png','jpg','jpeg','svg'].includes(row.kind)?'image':row.kind==='pptx'?'slides':['csv','xlsx','json'].includes(row.kind)?'data':'document'}">${esc(row.kind.toUpperCase())}</span><div class="cloud-artifact-copy"><b title="${esc(row.name)}">${esc(row.name)}</b><small>${size(row.bytes)}<i>·</i>${esc(date(row.createdAt))}<i>·</i><span class="cloud-artifact-status ${row.status==='ready'?'ready':''}">${esc(states[row.status]||'待核对')}</span></small><span class="cloud-artifact-project">${icon('folder',12)}${esc(projectName||(projectId?'已归入项目':'未归入项目'))}</span>${armed===row.id?'<p>删除后无法从云端恢复，已下载的本地文件不受影响。</p>':''}</div><div class="cloud-artifact-actions">${armed===row.id?`<button type="button" data-cloud-remove-confirm="${esc(row.id)}" class="cloud-artifact-danger">确认删除</button><button type="button" data-cloud-remove-cancel>取消</button>`:`${row.status==='ready'?`<button type="button" data-cloud-download="${esc(row.id)}">下载</button><button type="button" data-cloud-edit="${esc(row.id)}" aria-expanded="${editing===row.id}">管理</button>`:''}<button type="button" data-cloud-remove="${esc(row.id)}">${row.status==='deleting'?'重试删除':'删除'}</button>`}</div></div>${editor}</article>`;
  }).join(''):`<div class="cloud-artifact-empty">${icon('folder',34)}<h3>${query||kind||project?'没有匹配的文件':'把你的研究成果保存到云端'}</h3><p>${query||kind||project?'尝试其他名称、格式或项目。':'上传已有文件，或在写作、绘图等功能中导出成果。保存成功后，即可在这里统一管理。'}</p></div>`}</div><div class="cloud-artifact-footer"><span>共 ${data.total} 个文件 · 第 ${page} / ${pages} 页</span><div><button type="button" data-cloud-page="${page-1}" ${page<=1?'disabled':''}>上一页</button><button type="button" data-cloud-page="${page+1}" ${page>=pages?'disabled':''}>下一页</button></div></div>${originalMaterials()}`);paintSelections();
 }
 async function refresh({preserveSelection=false}={}){
  if(!preserveSelection)clearSelections();
  const version=++request;originalsRequest++;originalsLoading=false;armed=null;editing=null;data=null;projects=[];projectError='';paint(heading()+'<p class="cloud-artifact-empty" role="status">正在读取云文件…</p>');
  try{
   const current=await session(true);if(!alive()||version!==request)return;
   const nextOwner=current?.user?.id||null;if(nextOwner!==owner)clearSelections();owner=nextOwner;
   if(originalsOwner!==owner){selections.original.clear();originals=null;originalsOwner=null;originalsOpen=false;originalsPage=1;originalsError='';originalArmed=null;}
   if(!owner){clearSelections();paint(heading()+'<div class="cloud-artifact-empty"><h3>登录后管理云端文件</h3><p>你的文件只对自己的账户开放。</p><a class="btn primary" href="/auth.html?next='+encodeURIComponent('/workspace.html#assets')+'">登录账户</a></div>');return;}
   const expectedOwner=owner,filters=new URLSearchParams({page:String(page),pageSize:'10',q:query,expectedUserId:owner});if(kind)filters.set('kind',kind);if(project)filters.set('projectId',project);
   const [fileRead,projectRead]=await Promise.allSettled([api('?'+filters,undefined,expectedOwner),api('',undefined,expectedOwner,false,'/api/projects')]);
   const confirmed=await session(true);if(!alive()||version!==request)return;
   if(confirmed?.user?.id!==expectedOwner){invalidate('登录账户已变化，请刷新后重试');return;}
   if(fileRead.status==='rejected')throw fileRead.reason;
   const value=fileRead.value;
   if(!Array.isArray(value.items)||!Number.isSafeInteger(value.total)||value.items.some(r=>!r||!/^[A-Za-z0-9_-]+$/.test(r.id)||typeof r.name!=='string'||typeof r.kind!=='string'))throw Error('云文件列表响应无法核对，请刷新重试');
   if(projectRead.status==='rejected'&&(projectRead.reason.status===401||projectRead.reason.code==='ACCOUNT_CHANGED'))throw projectRead.reason;
   if(projectRead.status==='fulfilled'&&Array.isArray(projectRead.value.items)&&projectRead.value.items.every(p=>typeof p.id==='string'&&typeof p.title==='string'))projects=projectRead.value.items;
   else projectError='项目目录读取失败';
   data=value;if(page>1&&rowsEmpty(value)){page=Math.max(1,Math.ceil(value.total/10));return refresh({preserveSelection:true});}content();
  }catch(error){if(alive()&&version===request&&error.name!=='AbortError'){if(error.status===401||error.code==='ACCOUNT_CHANGED')invalidate(error.message);else paint(heading()+'<p class="cloud-artifact-error" role="alert">'+esc(error.message)+'</p>'+((query||kind||project)?'<button type="button" data-cloud-reset>清除筛选并重试</button>':''));}}
 }
 const rowsEmpty=value=>!value.items.length&&value.total<=(page-1)*10;
 async function confirmOwner(expectedOwner,version){const current=await session(true);if(!alive()||version!==request)return false;if(current?.user?.id!==expectedOwner){invalidate('登录账户已变化，操作已停止；请切回原账户后重试');return false;}return true;}
 function paintOriginals(){if(alive()&&data)withStableView(root.closest('.dashboard')||root,()=>{const panel=root.querySelector('.cloud-original-materials');if(panel)panel.outerHTML=originalMaterials();paintSelections();});}
 async function loadOriginals({preserveSelection=false,preservePage=false}={}){
  if(!preserveSelection){selections.original.clear();bulkConfirm=null;bulkMessages.original='';bulkFailures.original=[];}
  if(!owner||!data||!originalsOpen)return;const expectedOwner=owner,version=request,ticket=++originalsRequest;
  originalsLoading=true;originalsError='';originalArmed=null;paintOriginals();
  const current=()=>alive()&&version===request&&ticket===originalsRequest&&originalsOpen;
  try{
   if(!await confirmOwner(expectedOwner,version)||!current())return;
   const value=await api('?'+new URLSearchParams({expectedUserId:expectedOwner}),undefined,expectedOwner,false,'/api/files');
   if(!current()||!await confirmOwner(expectedOwner,version)||!current())return;
   if(!Array.isArray(value.items)||value.items.some(row=>!row||typeof row.id!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(row.id)||typeof row.name!=='string'||!['txt','docx','pdf'].includes(row.kind)||!Number.isSafeInteger(row.bytes)||row.bytes<0||typeof row.sha256!=='string'||!row.sha256))throw Error('已上传材料列表响应无法核对，请重试');
   originals=value.items;originalsOwner=expectedOwner;if(!preservePage)originalsPage=1;
  }catch(error){if(current()){if(error.status===401||error.code==='ACCOUNT_CHANGED')invalidate(error.message);else originalsError=error.message||'已上传材料暂时无法读取，请稍后重试';}}
  finally{if(current()){originalsLoading=false;paintOriginals();}}
 }
 async function originalAction(button){
  if(button.hasAttribute('data-original-toggle')){
   if(originalsOpen){originalsOpen=false;originalsRequest++;originalsLoading=false;originalArmed=null;paintOriginals();return;}
   if(!owner||!await confirmOwner(owner,request))return;originalsOpen=true;originalArmed=null;
   if(!originals||originalsOwner!==owner){void loadOriginals();return;}paintOriginals();return;
  }
  if(button.hasAttribute('data-original-refresh')){void loadOriginals();return;}
  if(button.hasAttribute('data-original-page')){originalsPage=Number(button.dataset.originalPage);originalArmed=null;paintOriginals();return;}
  if(button.hasAttribute('data-original-remove-cancel')){originalArmed=null;paintOriginals();return;}
  if(button.hasAttribute('data-original-remove')){originalArmed=button.dataset.originalRemove;originalsError='';paintOriginals();return;}
  const id=button.dataset.originalDownload||button.dataset.originalRemoveConfirm,row=originals?.find(row=>row.id===id);if(!row||!owner||originalsOwner!==owner)return;
  const expectedOwner=owner,version=request;busy=true;button.disabled=true;
  try{
   if(!await confirmOwner(expectedOwner,version))return;
   if(button.hasAttribute('data-original-download')){
    const blob=await api('/'+encodeURIComponent(id)+'/download?'+new URLSearchParams({expectedUserId:expectedOwner}),undefined,expectedOwner,true,'/api/files');
    if(blob.size!==row.bytes)throw Error('材料大小校验未通过，未发起下载');
    if(!await confirmOwner(expectedOwner,version))return;
    const url=URL.createObjectURL(blob),a=doc.createElement('a');a.href=url;a.download=row.name;doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);notify('已发起材料下载，请确认浏览器保存完成。');
   }else{
    await api('/'+encodeURIComponent(id)+'/delete',{expectedSha256:row.sha256},expectedOwner,false,'/api/files');
    if(!await confirmOwner(expectedOwner,version))return;
    originals=originals.filter(item=>item.id!==id);selections.original.delete(id);originalArmed=null;originalsError='';paintOriginals();notify('已删除材料原件，已生成结果仍会保留。');
   }
  }catch(error){if(alive()&&version===request){if(error.status===401||error.code==='ACCOUNT_CHANGED')invalidate(error.message);else{originalsError=error.message||'材料操作未完成，请稍后重试';paintOriginals();}notify(error.message||'材料操作未完成，请稍后重试');}}
  finally{busy=false;if(button.isConnected)button.disabled=false;}
 }
 async function action(event){
  const button=event.target.closest('button');if(!button||!root.contains(button)||busy)return;
  if(button.matches('[data-original-toggle],[data-original-refresh],[data-original-page],[data-original-remove-cancel],[data-original-remove],[data-original-download],[data-original-remove-confirm]')){await originalAction(button);return;}
  if(button.hasAttribute('data-bulk-clear')){const area=button.dataset.bulkClear;selections[area].clear();bulkMessages[area]='';bulkFailures[area]=[];bulkConfirm=null;paintSelections();return;}
  if(button.hasAttribute('data-bulk-cancel')){bulkConfirm=null;paintSelections();return;}
  if(button.hasAttribute('data-bulk-remove')){const area=button.dataset.bulkRemove;if(selections[area]?.size){bulkConfirm=area;paintSelections();root.querySelector('[data-bulk-confirm="'+area+'"]')?.focus({preventScroll:true});}return;}
  if(button.hasAttribute('data-bulk-confirm')){await deleteSelected(button.dataset.bulkConfirm);return;}
  if(button.hasAttribute('data-cloud-refresh')){void refresh();return;}
  if(button.hasAttribute('data-cloud-reset')){query='';kind='';project='';page=1;void refresh();return;}
  if(button.hasAttribute('data-cloud-page')){page=Number(button.dataset.cloudPage);void refresh({preserveSelection:true});return;}
  if(button.hasAttribute('data-cloud-upload-open')||button.hasAttribute('data-cloud-upload-close')){uploadOpen=button.hasAttribute('data-cloud-upload-open')?!uploadOpen:false;content();if(uploadOpen)root.querySelector('#cloud-upload-file')?.focus({preventScroll:true});return;}
  if(button.hasAttribute('data-cloud-remove-cancel')){armed=null;content();return;}
  if(button.hasAttribute('data-cloud-edit-cancel')){editing=null;content();return;}
  if(button.hasAttribute('data-cloud-edit')){editing=editing===button.dataset.cloudEdit?null:button.dataset.cloudEdit;armed=null;content();if(editing)root.querySelector('[data-cloud-metadata] input')?.focus({preventScroll:true});return;}
  if(button.hasAttribute('data-cloud-remove')){armed=button.dataset.cloudRemove;editing=null;content();return;}
  const id=button.dataset.cloudDownload||button.dataset.cloudRemoveConfirm,row=data?.items.find(r=>r.id===id);if(!row||!owner)return;
  const expectedOwner=owner,version=request;busy=true;button.disabled=true;
  try{
   if(!await confirmOwner(expectedOwner,version))return;
   if(button.hasAttribute('data-cloud-download')){
    const blob=await api('/'+encodeURIComponent(id)+'/download?'+new URLSearchParams({expectedUserId:expectedOwner}),undefined,expectedOwner,true);
    if(blob.size!==row.bytes)throw Error('文件大小校验未通过，未发起下载');
    const confirmed=await session(true);if(!alive()||version!==request)return;
    if(confirmed?.user?.id!==expectedOwner){invalidate('登录账户已变化，已停止下载；请切回原账户后重试');notify('登录账户已变化，已停止下载；请切回原账户后重试');return;}
    const url=URL.createObjectURL(blob),a=doc.createElement('a');a.href=url;a.download=row.name;doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);notify('已发起云文件下载，请确认浏览器保存完成。');
   }else{
    await api('/'+encodeURIComponent(id)+'/delete',{expectedSha256:row.sha256,expectedUserId:expectedOwner},expectedOwner);if(!alive()||version!==request)return;notify('云文件已删除。');if(page>1&&data.items.length===1)page--;await refresh();
   }
  }catch(error){if(alive()&&version===request){if(error.status===401||error.code==='ACCOUNT_CHANGED')invalidate(error.message);notify(error.message||'操作未完成，请稍后重试');}}
  finally{busy=false;if(button.isConnected)button.disabled=false;}
 }
 async function submit(event){
  const form=event.target;if(!form.matches('.cloud-artifact-search,.cloud-artifact-upload,.cloud-artifact-metadata'))return;event.preventDefault();if(busy||!data)return;
  if(form.matches('.cloud-artifact-search')){query=form.querySelector('input').value.trim();kind=form.querySelector('[name=kind]').value;project=form.querySelector('[name=project]').value;page=1;originalsPage=1;void refresh();return;}
  const expectedOwner=owner,version=request,errorNode=form.querySelector('[role=alert]'),button=form.querySelector('[type=submit]');
  errorNode.textContent='';busy=true;button.disabled=true;
  try{
   if(!await confirmOwner(expectedOwner,version))return;
   if(form.matches('.cloud-artifact-metadata')){
    const row=data.items.find(r=>r.id===form.dataset.cloudMetadata);if(!row)throw Error('文件列表已变化，请刷新后重试');
    const name=form.querySelector('[name=name]').value.trim();
    if(!name||name.split('.').at(-1).toLowerCase()!==row.kind)throw Error('请填写文件名称，并保留 .'+row.kind+' 扩展名');
    const payload={version:row.version,name,expectedUserId:expectedOwner};
    const projectInput=form.querySelector('[name=projectId]');if(projectInput)payload.projectId=projectInput.value||null;
    await api('/'+encodeURIComponent(row.id)+'/metadata',payload,expectedOwner);
    if(!await confirmOwner(expectedOwner,version))return;notify('文件名称和项目归属已保存。');await refresh();
   }else{
    const file=form.querySelector('input[type=file]').files?.[0];if(!file)throw Error('请先选择要上传的文件');
    if(!kinds.includes(file.name.split('.').at(-1).toLowerCase()))throw Error('暂不支持此文件格式，请选择文档、图片、演示或数据文件');
    if(!file.size||file.size>(data.maxFileBytes||20971520))throw Error('文件不能为空，且不能超过 '+size(data.maxFileBytes||20971520));
    button.textContent='正在保存…';
    const encoded=await artifactBase64(file);if(!await confirmOwner(expectedOwner,version))return;
    const payload={name:file.name,data:encoded,sourceType:'other',expectedUserId:expectedOwner};
    const projectId=form.querySelector('#cloud-upload-project').value;if(projectId)payload.projectId=projectId;
    const value=await api('',payload,expectedOwner);
    if(!value?.item?.id)throw Error('保存结果无法核对，请刷新列表确认后再重试');
    if(!await confirmOwner(expectedOwner,version))return;uploadOpen=false;page=1;query='';kind='';project='';notify('文件已保存到云端，相同内容会自动合并。');await refresh();
   }
  }catch(error){if(alive()&&version===request){if(error.status===401||error.code==='ACCOUNT_CHANGED')invalidate(error.message);else if(errorNode.isConnected)errorNode.textContent=error.message||'保存未完成，请稍后重试';notify(error.message||'保存未完成，请稍后重试');}}
  finally{busy=false;if(button.isConnected){button.disabled=false;button.textContent=form.matches('.cloud-artifact-upload')?'保存到云端':'保存修改';}}
 }
 root.classList.add('cloud-artifact-library','card');root.addEventListener('click',action);root.addEventListener('submit',submit);root.addEventListener('change',selectFiles);void refresh();
 return {refresh,dispose(){disposed=true;request++;controllers.forEach(c=>c.abort());root.removeEventListener('click',action);root.removeEventListener('submit',submit);root.removeEventListener('change',selectFiles);clearSelections();}};
}
