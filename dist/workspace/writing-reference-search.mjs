import {esc,icon} from './ui.mjs';

const sources={all:'聚合检索',crossref:'Crossref',europepmc:'Europe PMC',openalex:'OpenAlex',aminer:'AMiner'};
const baselineSources=['crossref','europepmc'];
const sourceDescriptions={crossref:'Crossref 覆盖多个学科的出版题录',europepmc:'Europe PMC 侧重生命科学与医学',openalex:'OpenAlex 扩展跨学科文献与开放获取信息',aminer:'AMiner 提供跨学科学术题录'};
const aminerScopeNotice='AMiner 检索提供学术题录，导入后可继续补充全文和阅读笔记。';
const sourceStatusLabels={ok:'已检索',unsupported_filter:'不支持当前筛选',not_configured:'暂未开放',budget_exhausted:'今日检索额度已用完',rate_limited:'请求较多，请稍后重试'};
const aminerSourceReasons={ok:'',unsupported_filter:'AMiner 暂不支持开放获取筛选，请取消此条件或切换其他来源。',not_configured:'AMiner 暂未开放，请切换其他来源或使用聚合检索。',budget_exhausted:'AMiner 今日检索额度已用完，其他可用来源仍可继续检索。',rate_limited:'AMiner 请求较多，请稍后重试或切换其他来源。',error:'AMiner 暂时无法响应，请稍后重试或切换其他来源。'};
const sourceReason=row=>row.id==='aminer'?(aminerSourceReasons[row.status]??aminerSourceReasons.error):row.status==='not_configured'?'该来源暂未开放，请切换其他来源或使用聚合检索。':row.status==='budget_exhausted'?'该来源今日检索额度已用完，其他可用来源仍可继续检索。':clip(row.reason,300);
const clip=(value,max=200)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const plainKey=value=>String(value??'').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu,'');
const doiOf=value=>clip(value,300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi\s*:\s*/i,'').toLocaleLowerCase();
const validDoi=value=>/^10\.\d{4,9}\/\S+$/i.test(value)?value:'';
const hash=value=>{let n=2166136261;for(const c of String(value)){n^=c.codePointAt(0);n=Math.imul(n,16777619);}return (n>>>0).toString(36);};
let counter=0,activeSearch=null;

export function safeReferenceURL(value){
 try{const url=new URL(String(value??''));return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
}

export function buildReferenceSearchQuery(context={}){
 const title=clip(context.title,200),words=Array.isArray(context.keywords)?context.keywords:String(context.keywords||'').split(/[，,、;；\n]/);
 const keywords=[...new Set(words.map(word=>clip(word,80)).filter(word=>word&&!title.toLocaleLowerCase().includes(word.toLocaleLowerCase())))].slice(0,4);
 return clip([title,...keywords].filter(Boolean).join(' ')||context.direction||context.major||'',200);
}

/** Search returns bibliographic metadata, never a read or confirmed full text. */
export function normalizeReferenceSearchItem(input={}){
 const title=clip(input.title,300);if(!title)return null;
 const source=clip(input.source,60).toLocaleLowerCase(),sourceId=clip(input.sourceId||input.id,200),doi=validDoi(doiOf(input.doi));
 const year=/^\d{4}$/.test(String(input.year??''))?String(input.year):'';
 const label=sources[source]||clip(input.sourceLabel||input.source,60)||'学术数据库';
 return {id:`online-${source.replace(/[^a-z0-9-]/g,'').slice(0,25)||'source'}-${hash(doi||sourceId||title+'|'+year)}`,
  title,authors:clip(input.authors,1000),year,doi,url:safeReferenceURL(input.url)||(doi?'https://doi.org/'+encodeURI(doi):''),
  source,sourceId,sourceLabel:label+' · 在线题录，未读取全文',scope:'metadata',text:'',abstract:clip(input.abstract,12000),
  ...(typeof input.openAccess==='boolean'?{openAccess:input.openAccess}:{}),fullTextUrl:safeReferenceURL(input.fullTextUrl),type:clip(input.type,80),tags:[],
  confirmed:false,fullTextRead:false};
}

function identities(row){
 const ids=[],doi=validDoi(doiOf(row?.doi));if(doi)ids.push('doi:'+doi);
 const title=plainKey(row?.title||row?.name),year=/^\d{4}$/.test(String(row?.year??''))?String(row.year):'';
 if(title)ids.push('title:'+title+'|'+year);
 if(row?.source&&row?.sourceId)ids.push('source:'+plainKey(row.source)+':'+String(row.sourceId));
 if(row?.id)ids.push('id:'+String(row.id));return ids;
}
export const referenceSearchKey=row=>identities(row)[0]||'';

/** Existing records win; a repeated search cannot replace a user's text/notes. */
export function newReferenceSearchItems(candidates,existing=[]){
 const seen=new Set((Array.isArray(existing)?existing:[]).flatMap(identities)),items=[];
 for(const raw of Array.isArray(candidates)?candidates:[]){const row=normalizeReferenceSearchItem(raw);if(!row)continue;const keys=identities(row);if(keys.some(key=>seen.has(key)))continue;keys.forEach(key=>seen.add(key));items.push(row);}return items;
}

function filtersFrom(form){
 const query=form.querySelector('[name=q]').value.replace(/\s+/g,' ').trim();
 if(query.length<2||query.length>200)throw Error('请输入 2–200 个字符的题目、DOI 或关键词。');
 const source=form.querySelector('[name=source]').value;if(!Object.hasOwn(sources,source))throw Error('请选择有效的检索来源。');
 const value={q:query,source,limit:'10'};
 for(const key of ['yearFrom','yearTo']){const year=form.querySelector(`[name=${key}]`).value.trim();if(year){if(!/^\d{4}$/.test(year)||Number(year)<1000||Number(year)>new Date().getFullYear()+1)throw Error('年份请填写有效的四位年份，或留空。');value[key]=year;}}
 if(value.yearFrom&&value.yearTo&&Number(value.yearFrom)>Number(value.yearTo))throw Error('起始年份不能晚于结束年份。');
 if(form.querySelector('[name=openAccess]').checked)value.openAccess='true';return value;
}

export function openWritingReferenceSearch(options={}){
 if(typeof options.modal!=='function')throw Error('需要提供文献检索弹窗。');
 const id='writing-reference-search-host-'+(++counter);
 options.modal(options.mode==='recommend'?'推荐参考文献':'搜索参考文献',`<div id="${id}" class="wrs-host"></div>`);
 const container=document.getElementById(id);if(!container)throw Error('文献检索窗口尚未打开。');
 return mountWritingReferenceSearch({...options,container});
}

/** Mount independently so both the writing step and literature library can reuse it. */
export function mountWritingReferenceSearch({container,mode='search',context={},query,getExisting=()=>[],onImport,
 isActive=()=>true,onClose,onLocalSearch,fetcher=(...args)=>fetch(...args),destination='当前草稿',autoSearch=mode==='recommend'}={}){
 if(!container||typeof onImport!=='function')throw Error('请提供检索容器与文献添加操作。');
 activeSearch?.();const id='wrs-'+(++counter),initialHash=location.hash;
 let alive=true,controller=null,timer=null,sequence=0,busy=false,importBusy=false,items=[],sourceStates=[],selected=new Set(),imported=[],lastFilters=null,capabilityController=null,capabilityTimer=null;
 const disposers=[],win=container.ownerDocument.defaultView,$=selector=>container.querySelector(selector);
 const listen=(target,event,handler)=>{target?.addEventListener(event,handler);disposers.push(()=>target?.removeEventListener(event,handler));};
 const current=()=>alive&&container.isConnected&&location.hash===initialHash&&isActive();
 const existing=()=>{const rows=getExisting();return [...(Array.isArray(rows)?rows:[]),...imported];};
 const already=row=>newReferenceSearchItems([row],existing()).length===0;
 const message=(text,error=false)=>{if(!current())return;const target=$(error?'[data-ref-error]':'[data-ref-status]');target.textContent=text;};
 const clearError=()=>message('',true);
 function close(){if(!current())return;const dialog=container.closest('dialog');dispose();if(onClose)onClose();else dialog?.close();}
 function dispose(){if(!alive)return;alive=false;sequence++;clearTimeout(timer);clearTimeout(capabilityTimer);controller?.abort();capabilityController?.abort();disposers.splice(0).forEach(remove=>remove());observer?.disconnect();if(activeSearch===dispose)activeSearch=null;}
 let observer=null;activeSearch=dispose;
 container.innerHTML=`<section class="writing-reference-search" aria-labelledby="${id}-title">
  <header class="wrs-intro"><span class="wrs-symbol">${icon(mode==='recommend'?'book':'search',24)}</span><div><span class="wrs-kicker">REFERENCE DISCOVERY</span><h2 id="${id}-title">${mode==='recommend'?'围绕研究主题，寻找真实文献':'找到可追溯的研究来源'}</h2><p>${mode==='recommend'?'根据题目与关键词检索相关题录；你可以修改检索词，缩小研究范围。':'按题目、关键词或 DOI 检索公开学术数据库。'}</p></div>${onLocalSearch?'<button type="button" class="btn secondary wrs-local-switch" data-ref-local>搜索我的文献库</button>':''}</header>
  <form class="wrs-form" data-unprotected><label for="${id}-query">${mode==='recommend'?'推荐检索词（可编辑）':'检索词'}</label><div class="wrs-search-line"><input type="search" id="${id}-query" name="q" minlength="2" maxlength="200" required autocomplete="off" placeholder="输入研究主题、英文关键词或 DOI" value="${esc(query??buildReferenceSearchQuery(context))}"><button class="btn primary" type="submit">${icon('search',16)}检索文献</button></div>
  <details class="wrs-filters"><summary>筛选来源与年份 <span>可选</span></summary><div class="wrs-filter-grid"><label for="${id}-source">检索来源<select id="${id}-source" name="source">${['all',...baselineSources].map(value=>`<option value="${value}">${sources[value]}</option>`).join('')}</select></label><label for="${id}-from">起始年份<input id="${id}-from" name="yearFrom" type="number" min="1000" max="${new Date().getFullYear()+1}" step="1" placeholder="不限"></label><label for="${id}-to">结束年份<input id="${id}-to" name="yearTo" type="number" min="1000" max="${new Date().getFullYear()+1}" step="1" placeholder="不限"></label><label class="wrs-oa"><input name="openAccess" type="checkbox">仅开放获取文献</label></div><p data-ref-provider-description>${baselineSources.map(value=>sourceDescriptions[value]).join('，')}。中文结果取决于数据库收录，英文关键词通常更易匹配。聚合检索会查询当前可用来源；开放获取筛选仅查询支持此条件的来源。</p></details></form>
  <div class="wrs-request-state"><p data-ref-status role="status" aria-live="polite">${autoSearch?'正在准备主题检索…':'输入检索词后开始；本次仅查找题录，不会生成正文或扣除积分。'}</p><button class="btn secondary" type="button" data-ref-cancel hidden>取消检索</button></div><p data-ref-error class="wrs-error" role="alert"></p><div data-ref-sources class="wrs-source-states" aria-label="数据库检索状态"></div>
  <div data-ref-results class="wrs-results" aria-busy="false"><div class="wrs-empty">${icon('book',30)}<h3>先找到文献，再核对依据</h3><p>选择需要的题录，添加后核对作者、年份和引用用途。</p></div></div>
  <footer class="wrs-footer"><div><strong data-ref-selection>尚未选择文献</strong><small>仅添加题录与可用摘要，未读取全文，也不会自动确认引用。</small></div><button type="button" class="btn secondary" data-ref-done>完成</button><button type="button" class="btn primary" data-ref-import disabled>添加所选题录</button></footer></section>`;
 const form=$('form');
 async function loadSources(){
  const abort=new AbortController();capabilityController=abort;capabilityTimer=setTimeout(()=>abort.abort(),4000);
  try{
   const response=await fetcher('/api/capabilities',{method:'GET',credentials:'same-origin',cache:'no-store',signal:abort.signal,headers:{Accept:'application/json'}});
   if(!response.ok)return;const body=await response.json();if(!current()||abort.signal.aborted||!Array.isArray(body.academicSearchSources))return;
   const enabled=[...new Set(body.academicSearchSources.filter(value=>value!=='all'&&Object.hasOwn(sourceDescriptions,value)))],select=form.querySelector('[name=source]'),previous=select.value;
   select.innerHTML=['all',...enabled].map(value=>`<option value="${value}">${sources[value]}</option>`).join('');select.value=enabled.includes(previous)?previous:'all';
   $('[data-ref-provider-description]').textContent=(enabled.length?enabled.map(value=>sourceDescriptions[value]).join('，')+'。':'当前暂无已开放的检索来源。')+'中文结果取决于数据库收录，英文关键词通常更易匹配。聚合检索会查询当前可用来源；开放获取筛选仅查询支持此条件的来源。'+(enabled.includes('aminer')?aminerScopeNotice:'');
  }catch{/* Keep existing public sources usable when the status request is unavailable. */}
  finally{clearTimeout(capabilityTimer);capabilityController=null;}
 }
 function updateSelection(){
  const count=items.filter(row=>selected.has(row.id)&&!already(row)).length;
  $('[data-ref-selection]').textContent=count?`已选 ${count} 篇题录`:'尚未选择文献';
  $('[data-ref-import]').disabled=!count||importBusy||busy;
  $('[data-ref-import]').textContent=importBusy?'正在添加…':count?`添加 ${count} 篇至${destination}`:'添加所选题录';
  $('[data-ref-done]').disabled=importBusy;
  container.querySelectorAll('[data-ref-select]').forEach(input=>{input.disabled=busy||importBusy||already(items.find(row=>row.id===input.dataset.refSelect));});
 }
 function sourceMarkup(){
  $('[data-ref-sources]').innerHTML=sourceStates.map(row=>{const state=row.status==='ok'?'ok':row.status==='unsupported_filter'?'unsupported':'error',label=sources[row.id]||clip(row.label,80)||'学术来源',reason=sourceReason(row);return `<span class="wrs-source-state ${state}"><i aria-hidden="true"></i><b>${esc(label)}</b><span>${esc(sourceStatusLabels[row.status]||'暂不可用')}</span>${reason?`<small>${esc(reason)}</small>`:''}</span>`;}).join('');
 }
 function rowsMarkup(){
  sourceMarkup();
  $('[data-ref-results]').innerHTML=items.length?`<div class="wrs-result-heading"><h3>检索结果 <span>${items.length} 篇</span></h3><p>检索词：${esc(lastFilters?.q||'')} · 按数据库返回顺序展示</p></div><div class="wrs-result-list">${items.map((row,index)=>{const present=already(row);return `<article class="wrs-result ${present?'is-existing':''}"><div class="wrs-result-main"><label class="wrs-result-choice"><input type="checkbox" data-ref-select="${esc(row.id)}" ${present?'disabled':''} ${selected.has(row.id)&&!present?'checked':''}><span><span class="wrs-result-index">${String(index+1).padStart(2,'0')} · ${esc(sources[row.source]||row.source||'学术数据库')}</span><b>${esc(row.title)}</b><small>${esc(row.authors||'数据库未提供作者')} · ${esc(row.year||'年份未提供')}</small></span></label><span class="wrs-metadata-label">${present?'已添加':'仅题录 · 未读全文'}</span></div><div class="wrs-result-links">${row.doi?`<span class="wrs-doi">DOI：${esc(row.doi)}</span>`:''}${row.url?`<a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">来源页面 ↗</a>`:''}${row.fullTextUrl&&row.fullTextUrl!==row.url?`<a href="${esc(row.fullTextUrl)}" target="_blank" rel="noopener noreferrer">原文入口 ↗</a>`:''}${row.openAccess?'<span class="wrs-open-access">开放获取</span>':''}</div>${row.abstract?`<details class="wrs-abstract"><summary>查看数据库摘要（非全文）</summary><p>${esc(row.abstract)}</p></details>`:''}</article>`;}).join('')}</div>`:`<div class="wrs-empty">${icon('search',30)}<h3>暂未找到匹配文献</h3><p>已查询可用来源。可减少检索词、扩大年份范围，或尝试对应的英文关键词。</p><button type="button" class="btn secondary" data-ref-retry>重新检索</button></div>`;
  updateSelection();
 }
 function setBusy(value){busy=value;$('[data-ref-cancel]').hidden=!value;$('[data-ref-results]').setAttribute('aria-busy',String(value));form.querySelector('button[type=submit]').textContent=value?'更换条件重新检索':'检索文献';updateSelection();}
 async function search(filters){
  if(!current()||importBusy)return;
  try{filters=filters||filtersFrom(form);}catch(error){message(error.message,true);return;}
  controller?.abort();clearTimeout(timer);const request=++sequence,abort=new AbortController();controller=abort;let timedOut=false;
  lastFilters={...filters};selected.clear();clearError();setBusy(true);message(`正在检索“${filters.q}”…`);
  timer=setTimeout(()=>{timedOut=true;abort.abort();},20000);
  try{
   const response=await fetcher('/api/literature/search?'+new URLSearchParams(filters),{method:'GET',credentials:'same-origin',cache:'no-store',signal:abort.signal,headers:{Accept:'application/json'}});
   const body=await response.json();if(!current()||request!==sequence)return;
   if(timedOut)throw Error('检索超时，请稍后重试。');if(abort.signal.aborted)return;
   if(!response.ok){const states=Array.isArray(body.sources)?body.sources:[],unavailable=states.find(row=>row.id==='aminer'&&row.status!=='ok')||states.find(row=>row.status==='not_configured'||row.status==='budget_exhausted')||(filters.source==='aminer'?{id:'aminer',status:response.status===429?'rate_limited':'error'}:null);throw Object.assign(Error(unavailable?sourceReason(unavailable):typeof body.error==='string'?clip(body.error,300):response.status===429?'检索过于频繁，请稍后重试。':'数据库暂时无法响应，请稍后重试。'),{sources:states});}
   if(!Array.isArray(body.items))throw Error('检索响应不完整，请稍后重试。');
   items=newReferenceSearchItems(body.items);sourceStates=Array.isArray(body.sources)?body.sources:[];rowsMarkup();
   message(body.partial?`找到 ${items.length} 篇题录；部分来源暂不可用，可核对下方来源状态后重试。`:`找到 ${items.length} 篇题录。请选择需要核对的文献；这不代表已读取全文。`);
  }catch(error){
   if(!current()||request!==sequence)return;
   if(abort.signal.aborted&&!timedOut){message('已取消本次检索，可以调整关键词后重新查询。');return;}
   items=[];sourceStates=Array.isArray(error.sources)?error.sources:[];sourceMarkup();
   message(timedOut?'检索超时，请稍后重试或减少检索条件。':error.message||'检索未完成，请检查网络后重试。',true);message('未取得可用的检索结果，不会添加或编造文献。');
   $('[data-ref-results]').innerHTML=`<div class="wrs-empty is-error">${icon('search',30)}<h3>本次检索未完成</h3><p>已添加的文献保持原样。稍后可以重新查询。</p><button type="button" class="btn secondary" data-ref-retry>重试本次检索</button></div>`;
  }finally{if(current()&&request===sequence){clearTimeout(timer);setBusy(false);controller=null;}}
 }
 listen(form,'submit',event=>{event.preventDefault();void search();});
 listen($('[data-ref-cancel]'),'click',()=>{sequence++;clearTimeout(timer);controller?.abort();controller=null;setBusy(false);message('已取消本次检索，可以调整关键词后重新查询。');});
 listen($('[data-ref-done]'),'click',close);
 listen($('[data-ref-local]'),'click',()=>{if(!current()||importBusy)return;dispose();onLocalSearch?.();});
 listen($('[data-ref-results]'),'click',event=>{if(event.target.closest('[data-ref-retry]'))void search(lastFilters);});
 listen($('[data-ref-results]'),'change',event=>{const input=event.target.closest('[data-ref-select]');if(!input||busy||importBusy||!current())return;input.checked?selected.add(input.dataset.refSelect):selected.delete(input.dataset.refSelect);input.closest('.wrs-result').classList.toggle('is-selected',input.checked);updateSelection();});
 listen($('[data-ref-import]'),'click',async()=>{
  if(!current()||busy||importBusy)return;const rows=newReferenceSearchItems(items.filter(row=>selected.has(row.id)),existing());
  if(!rows.length){message('所选文献已存在，无需重复添加。');rowsMarkup();return;}
  importBusy=true;clearError();updateSelection();
  try{await onImport(rows,{isCurrent:current});if(!current())return;imported.push(...rows);selected.clear();rowsMarkup();message(`已添加 ${rows.length} 篇题录至${destination}。引用仍待核对确认，全文尚未读取。`);}
  catch(error){if(current())message(error.message||'添加未完成，所选题录已保留，请重试。',true);}
  finally{importBusy=false;if(current())updateSelection();}
 });
 listen(win,'hashchange',dispose);listen(container.closest('dialog'),'close',dispose);
 if(win.MutationObserver){observer=new win.MutationObserver(()=>{if(alive&&!container.isConnected)dispose();});observer.observe(container.ownerDocument.body,{childList:true,subtree:true});}
 if(container.closest('dialog')?.open)form.querySelector('[name=q]').focus();
 const ready=loadSources().then(()=>autoSearch&&current()&&!sequence&&form.querySelector('[name=q]').value.trim().length>=2?search():undefined);
 if(autoSearch&&(!form.querySelector('[name=q]').value.trim()||form.querySelector('[name=q]').value.trim().length<2))message('请先填写论文题目或研究关键词，再开始推荐检索。');
 dispose.ready=ready;dispose.search=()=>search();return dispose;
}
