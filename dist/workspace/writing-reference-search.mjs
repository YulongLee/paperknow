import {esc,icon} from './ui.mjs';
import {arxivMetadata,arxivBaseIdentifier} from './arxiv-metadata.mjs';

const sources={all:'聚合检索',crossref:'Crossref',europepmc:'Europe PMC',pubmed:'PubMed',openalex:'OpenAlex',semantic_scholar:'Semantic Scholar',arxiv:'arXiv',aminer:'AMiner'};
export const pubmedSourceNotice='PubMed 数据来自 NCBI；文献题录与摘要的使用须遵守来源政策。<a href="https://www.ncbi.nlm.nih.gov/About/disclaimer.html" target="_blank" rel="noopener noreferrer">NCBI 免责声明与版权政策 ↗</a>';
/** Unavailable providers are informational only, never offered as selectable sources. */
export function unavailableAcademicSources(statuses,enabled=[]){
 const labels={...sources,cnki:'知网'},seen=new Set();
 return (Array.isArray(statuses)?statuses:[]).filter(row=>row&&Object.hasOwn(labels,row.id)&&row.id!=='all'&&row.configured===false&&!enabled.includes(row.id)&&!seen.has(row.id)&&seen.add(row.id)).map(row=>({id:row.id,label:labels[row.id],reason:clip(row.reason,300)||'该来源暂未开放，请使用其他已开放来源。'}));
}
const referenceSortLabels={relevance:'相关性',year:'发表年份优先',citations:'被引次数优先',submittedDate:'最新预印本',lastUpdatedDate:'预印本最近更新'};
const chronologicalSort=value=>['submittedDate','lastUpdatedDate'].includes(value);
const arxivAttribution='Thank you to arXiv for use of its open access interoperability.';
const searchFailure=(message,extra={})=>Object.assign(new Error(message),extra,{publicSearchMessage:true});
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
 const source=clip(input.source,60).toLocaleLowerCase(),arxiv=arxivMetadata({...input,source}),sourceId=arxiv.sourceId||clip(input.sourceId||input.id,200),doi=validDoi(doiOf(input.doi));
 const year=/^\d{4}$/.test(String(input.year??''))?String(input.year):'';
 const label=sources[source]||clip(input.sourceLabel||input.source,60)||'学术数据库';
 return {id:`online-${source.replace(/[^a-z0-9-]/g,'').slice(0,25)||'source'}-${hash(doi||sourceId||title+'|'+year)}`,
  title,authors:clip(input.authors,1000),year,doi,url:safeReferenceURL(input.url)||(doi?'https://doi.org/'+encodeURI(doi):''),
  source,sourceId,sourceLabel:label+' · 在线题录，未读取全文',scope:'metadata',text:'',abstract:clip(input.abstract,12000),
  ...(typeof input.openAccess==='boolean'?{openAccess:input.openAccess}:{}),fullTextUrl:safeReferenceURL(input.fullTextUrl),type:clip(input.type,80),tags:[],
  ...referenceBibliography(input),...arxiv,confirmed:false,fullTextRead:false};
}

// Keep only provider-supplied bibliographic fields; metadata never becomes read material.
function referenceBibliography(input){
 const result={},types=['generic','thesis','journal','conference','book','patent','standard','yearbook','newspaper','report','chapter','preprint','other'];
 if(types.includes(input.documentType))result.documentType=input.documentType==='other'?'generic':input.documentType;
 for(const [key,max] of [['journal',500],['publisher',500],['publicationSource',300],['volume',100],['issue',100],['pages',100],['venue',500]])if(typeof input[key]==='string'&&clip(input[key],max))result[key]=clip(input[key],max);
 if(typeof input.citationBucket==='string'&&/^(?:0|1-10|11-50|51-200|200-1000|201-1000|1000-5000|1001-5000|5000\+)$/.test(input.citationBucket))result.citationBucket=input.citationBucket;
 if(Number.isSafeInteger(input.citationCount)&&input.citationCount>=0){result.citationCount=input.citationCount;if(Object.hasOwn(sources,input.citationCountSource)&&input.citationCountSource!=='all')result.citationCountSource=input.citationCountSource;}
 if(Array.isArray(input.keywords))result.keywords=[...new Set(input.keywords.filter(v=>typeof v==='string').map(v=>clip(v,80)).filter(Boolean))].slice(0,20);
 if(Array.isArray(input.authorNames))result.authorNames=input.authorNames.slice(0,100).map(v=>typeof v==='string'?{literal:clip(v,200)}:v).filter(v=>v&&typeof v==='object'&&!Array.isArray(v)).map(v=>Object.fromEntries(['family','given','literal'].filter(k=>typeof v[k]==='string'&&clip(v[k],200)).map(k=>[k,clip(v[k],200)]))).filter(v=>Object.keys(v).length);
 if(Array.isArray(input.sourceProvenance))result.sourceProvenance=input.sourceProvenance.slice(0,7).filter(v=>v&&Object.hasOwn(sources,v.source)&&v.source!=='all').map(v=>({source:v.source,sourceId:clip(v.sourceId,200),...Object.fromEntries(['journal','publisher','volume','issue','pages','venue'].filter(k=>typeof v[k]==='string').map(k=>[k,clip(v[k],k==='journal'||k==='publisher'||k==='venue'?500:100)])),...(/^(?:0|1-10|11-50|51-200|200-1000|201-1000|1000-5000|1001-5000|5000\+)$/.test(v.citationBucket||'')?{citationBucket:v.citationBucket}:{}),...(types.includes(v.documentType)?{documentType:v.documentType}:{}),...(validDoi(doiOf(v.doi))?{doi:validDoi(doiOf(v.doi))}:{}),...(/^\d{4}$/.test(String(v.year??''))?{year:String(v.year)}:{}),url:safeReferenceURL(v.url),...(typeof v.openAccess==='boolean'?{openAccess:v.openAccess}:{}),...(safeReferenceURL(v.fullTextUrl)?{fullTextUrl:safeReferenceURL(v.fullTextUrl)}:{}),...(Number.isSafeInteger(v.citationCount)&&v.citationCount>=0?{citationCount:v.citationCount}:{})}));
 return result;
}

function identities(row){
 const ids=[],doi=validDoi(doiOf(row?.doi));if(doi)ids.push('doi:'+doi);
 if(row?.source==='arxiv'){const id=arxivBaseIdentifier(row.arxivId||row.sourceId);if(id)ids.push('arxiv:'+id);}
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
 const sort=form.querySelector('[name=sort]').value;if(!Object.hasOwn(referenceSortLabels,sort))throw Error('请选择有效的排序方式。');
 const source=chronologicalSort(sort)?'arxiv':'all',value={q:query,source,sort,limit:'10'};
 for(const key of ['yearFrom','yearTo']){const year=form.querySelector(`[name=${key}]`).value.trim();if(year){if(!/^\d{4}$/.test(year)||Number(year)<1000||Number(year)>new Date().getFullYear()+1)throw Error('年份请填写有效的四位年份，或留空。');value[key]=year;}}
 if(value.yearFrom&&value.yearTo&&Number(value.yearFrom)>Number(value.yearTo))throw Error('起始年份不能晚于结束年份。');
 if(source==='arxiv'){
  const range=form.querySelector('[name=dateRange]').value;if(!['all','7','30'].includes(range))throw Error('请选择有效的提交时间范围。');
  if(range!=='all'){const now=new Date(),end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));value.dateTo=end.toISOString().slice(0,10);end.setUTCDate(end.getUTCDate()-Number(range)+1);value.dateFrom=end.toISOString().slice(0,10);}
 }
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
 isActive=()=>true,onClose,fetcher=(...args)=>fetch(...args),destination='当前草稿',autoSearch=mode==='recommend'}={}){
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
  <header class="wrs-intro"><span class="wrs-symbol">${icon(mode==='recommend'?'book':'search',24)}</span><div><span class="wrs-kicker">REFERENCE DISCOVERY</span><h2 id="${id}-title">${mode==='recommend'?'围绕研究主题，寻找真实文献':'搜索与你研究相关的文献'}</h2><p>${mode==='recommend'?'根据题目与关键词检索相关题录；你可以修改检索词，缩小研究范围。':'输入题目、关键词或 DOI，查找相关文献。'}</p></div></header>
  <form class="wrs-form" data-unprotected><label for="${id}-query">${mode==='recommend'?'推荐检索词（可编辑）':'检索词'}</label><div class="wrs-search-line"><input type="search" id="${id}-query" name="q" minlength="2" maxlength="200" required autocomplete="off" placeholder="输入研究主题、英文关键词或 DOI" value="${esc(query??buildReferenceSearchQuery(context))}"><button class="btn primary" type="submit">${icon('search',16)}检索文献</button></div>
  <details class="wrs-filters"><summary>高级筛选 <span>可选</span></summary><div class="wrs-filter-grid"><label for="${id}-sort">排序方式<select id="${id}-sort" name="sort">${Object.entries(referenceSortLabels).map(([value,label])=>`<option value="${value}"${chronologicalSort(value)?' data-ref-latest-option hidden disabled':''}>${label}</option>`).join('')}</select></label><label for="${id}-from">起始年份<input id="${id}-from" name="yearFrom" type="number" min="1000" max="${new Date().getFullYear()+1}" step="1" placeholder="不限"></label><label for="${id}-to">结束年份<input id="${id}-to" name="yearTo" type="number" min="1000" max="${new Date().getFullYear()+1}" step="1" placeholder="不限"></label><label class="wrs-oa"><input name="openAccess" type="checkbox">仅开放获取文献</label><label for="${id}-range" data-ref-date-range hidden>提交时间（UTC）<select id="${id}-range" name="dateRange" disabled><option value="all">不限时间</option><option value="7">近 7 天</option><option value="30">近 30 天</option></select></label></div><p data-ref-preprint-notice hidden>预印本可能尚未经过同行评审，请结合发表信息核对。</p></details></form>
  <div class="wrs-request-state"><p data-ref-status role="status" aria-live="polite">${autoSearch?'正在准备主题检索…':'输入检索词后开始；本次仅查找题录，不会生成正文或扣除积分。'}</p><button class="btn secondary" type="button" data-ref-cancel hidden>取消检索</button></div><p data-ref-error class="wrs-error" role="alert"></p>
  <section class="wrs-loading" data-ref-loading hidden aria-label="文献检索进度"><span class="wrs-loading-spinner" aria-hidden="true"></span><h3>正在检索文献</h3><p data-ref-loading-query></p><p class="wrs-loading-hint">正在查找与研究主题相关的文献，请稍候。</p><div class="wrs-loading-lines" aria-hidden="true"><i></i><i></i><i></i></div></section>
  <div data-ref-results class="wrs-results" aria-busy="false"><div class="wrs-empty">${icon('book',30)}<h3>先找到文献，再核对依据</h3><p>选择需要的题录，添加后核对作者、年份和引用用途。</p></div></div>
  <footer class="wrs-footer"><div><strong data-ref-selection>尚未选择文献</strong><small>仅添加题录与可用摘要，未读取全文，也不会自动确认引用。</small></div><button type="button" class="btn secondary" data-ref-done>完成</button><button type="button" class="btn primary" data-ref-import disabled>添加所选题录</button></footer><details class="wrs-data-use" data-ref-data-use hidden><summary>数据使用说明</summary><p class="wrs-arxiv-attribution" data-ref-arxiv-attribution hidden>${arxivAttribution}</p><p class="wrs-arxiv-attribution" data-ref-pubmed-notice hidden>${pubmedSourceNotice}</p></details></section>`;
 const form=$('form');
 function updateSourceControls(){
  const chronological=chronologicalSort(form.querySelector('[name=sort]').value);
  $('[data-ref-date-range]').hidden=!chronological;$('[data-ref-preprint-notice]').hidden=!chronological;form.querySelector('[name=dateRange]').disabled=!chronological;
 }
 updateSourceControls();
 async function loadSources(){
  const abort=new AbortController();capabilityController=abort;capabilityTimer=setTimeout(()=>abort.abort(),4000);
  try{
   const response=await fetcher('/api/capabilities',{method:'GET',credentials:'same-origin',cache:'no-store',signal:abort.signal,headers:{Accept:'application/json'}});
   if(!response.ok)return;const body=await response.json();if(!current()||abort.signal.aborted||!Array.isArray(body.academicSearchSources))return;
   const enabled=body.academicSearchSources.filter(value=>value!=='all'&&Object.hasOwn(sources,value)),latest=enabled.includes('arxiv');
   for(const option of form.querySelectorAll('[data-ref-latest-option]')){option.hidden=!latest;option.disabled=!latest;}
   if(!latest&&chronologicalSort(form.querySelector('[name=sort]').value))form.querySelector('[name=sort]').value='relevance';
   $('[data-ref-pubmed-notice]').hidden=!enabled.includes('pubmed');$('[data-ref-arxiv-attribution]').hidden=!latest;
   updateSourceControls();updateDataUse();
  }catch{/* The server still selects the available search services for an aggregate query. */}
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
 function updateDataUse(){
  $('[data-ref-data-use]').hidden=$('[data-ref-arxiv-attribution]').hidden&&$('[data-ref-pubmed-notice]').hidden;
 }
 function sourceMarkup(){
  if(sourceStates.some(row=>row.id==='arxiv')||items.some(row=>row.source==='arxiv'||row.sourceProvenance?.some(value=>value.source==='arxiv')))$('[data-ref-arxiv-attribution]').hidden=false;
  if(sourceStates.some(row=>row.id==='pubmed')||items.some(row=>row.source==='pubmed'||row.sourceProvenance?.some(value=>value.source==='pubmed')))$('[data-ref-pubmed-notice]').hidden=false;
  updateDataUse();
 }
 function rowsMarkup(){
  sourceMarkup();
  $('[data-ref-results]').innerHTML=items.length?`<div class="wrs-result-heading"><h3>检索结果 <span>${items.length} 篇</span></h3><p>检索词：${esc(lastFilters?.q||'')} · ${esc(referenceSortLabels[lastFilters?.sort]||'相关性')}</p></div><div class="wrs-result-list">${items.map((row,index)=>{const present=already(row);return `<article class="wrs-result ${present?'is-existing':''}"><div class="wrs-result-main"><label class="wrs-result-choice"><input type="checkbox" data-ref-select="${esc(row.id)}" ${present?'disabled':''} ${selected.has(row.id)&&!present?'checked':''}><span><span class="wrs-result-index">${String(index+1).padStart(2,'0')}${row.source==='arxiv'?' · 预印本':''}</span><b>${esc(row.title)}</b><small>${esc(row.authors||'作者未提供')} · ${esc(row.year||'年份未提供')}</small>${row.source==='arxiv'?`<small class="wrs-paper-dates">${row.publishedDate?'首次提交 '+esc(row.publishedDate.slice(0,10))+'（UTC）':''}${row.updatedDate?' · 最近更新 '+esc(row.updatedDate.slice(0,10))+'（UTC）':''}</small>`:''}</span></label><span class="wrs-metadata-label">${present?'已添加':'仅题录 · 未读全文'}</span></div><div class="wrs-result-links">${row.arxivId?`<span class="wrs-arxiv-id">预印本编号：${esc(row.arxivId)}</span>`:''}${row.doi?`<span class="wrs-doi">DOI：${esc(row.doi)}</span>`:''}${row.url?`<a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">查看文献 ↗</a>`:''}${row.fullTextUrl&&row.fullTextUrl!==row.url?`<a href="${esc(row.fullTextUrl)}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a>`:''}${row.openAccess?'<span class="wrs-open-access">开放获取</span>':''}${row.categories?.length?`<span class="wrs-categories">${esc(row.categories.join(' · '))}</span>`:''}</div>${row.source==='arxiv'?'<p class="wrs-preprint-note">预印本 · 可能尚未经过同行评审。原文将在新页面打开，尚未自动读取全文。</p>':''}${row.abstract?`<details class="wrs-abstract"><summary>查看摘要（非全文）</summary><p>${esc(row.abstract)}</p></details>`:''}</article>`;}).join('')}</div>`:`<div class="wrs-empty">${icon('search',30)}<h3>暂未找到匹配文献</h3><p>可减少检索词、扩大年份范围，或尝试对应的英文关键词。</p><button type="button" class="btn secondary" data-ref-retry>重新检索</button></div>`;
  updateSelection();
 }
 function updateSearchAction(){
  const button=form.querySelector('button[type=submit]');let changed=false;
  if(busy){try{changed=JSON.stringify(filtersFrom(form))!==JSON.stringify(lastFilters);}catch{changed=true;}}
  button.disabled=importBusy||busy&&!changed;
  button.setAttribute('aria-busy',String(busy));
  button.innerHTML=busy&&!changed?'<span class="wrs-button-spinner" aria-hidden="true"></span>检索中…':icon('search',16)+(busy?'按新条件检索':'检索文献');
 }
 function setBusy(value){
  busy=value;$('.writing-reference-search').classList.toggle('is-searching',value);
  $('[data-ref-cancel]').hidden=!value;$('[data-ref-loading]').hidden=!value;
  const result=$('[data-ref-results]');result.hidden=value;result.setAttribute('aria-busy',String(value));
  $('[data-ref-loading-query]').textContent=value?'检索主题：'+lastFilters.q:'';
  updateSearchAction();updateSelection();
 }
 async function search(filters){
  if(!current()||importBusy)return;
  try{filters=filters||filtersFrom(form);}catch(error){message(error.message,true);return;}
  if(busy&&JSON.stringify(filters)===JSON.stringify(lastFilters))return;
  controller?.abort();clearTimeout(timer);const request=++sequence,abort=new AbortController();controller=abort;let timedOut=false;
  lastFilters={...filters};selected.clear();clearError();setBusy(true);message('正在检索文献，请稍候…');
  timer=setTimeout(()=>{timedOut=true;abort.abort();},filters.source==='arxiv'?32000:20000);
  try{
   const response=await fetcher('/api/literature/search?'+new URLSearchParams(filters),{method:'GET',credentials:'same-origin',cache:'no-store',signal:abort.signal,headers:{Accept:'application/json'}});
   const body=await response.json();if(!current()||request!==sequence)return;
   if(timedOut)throw searchFailure('检索超时，请稍后重试。');if(abort.signal.aborted)return;
   if(!response.ok)throw searchFailure(response.status===429?'检索过于频繁，请稍后重试。':'文献检索暂时无法完成，请稍后重试。',{sources:Array.isArray(body.sources)?body.sources:[]});
   if(!Array.isArray(body.items))throw searchFailure('检索响应不完整，请稍后重试。');
   items=newReferenceSearchItems(body.items);sourceStates=Array.isArray(body.sources)?body.sources:[];rowsMarkup();
   message(body.partial?`找到 ${items.length} 篇可用题录，部分结果暂未取得，可稍后重试。`:`找到 ${items.length} 篇题录。请选择需要核对的文献；这不代表已读取全文。`);
  }catch(error){
   if(!current()||request!==sequence)return;
   if(abort.signal.aborted&&!timedOut){message('已取消本次检索，可以调整关键词后重新查询。');return;}
   items=[];sourceStates=Array.isArray(error.sources)?error.sources:[];sourceMarkup();
   message(timedOut?'检索超时，请稍后重试或减少检索条件。':error.publicSearchMessage?error.message:'文献检索暂时无法完成，请稍后重试。',true);message('未取得可用的检索结果，不会添加或编造文献。');
   $('[data-ref-results]').innerHTML=`<div class="wrs-empty is-error">${icon('search',30)}<h3>本次检索未完成</h3><p>已添加的文献保持原样。稍后可以重新查询。</p><button type="button" class="btn secondary" data-ref-retry>重试本次检索</button></div>`;
  }finally{if(current()&&request===sequence){clearTimeout(timer);setBusy(false);controller=null;}}
 }
 listen(form.querySelector('[name=sort]'),'change',updateSourceControls);
 listen(form,'input',updateSearchAction);listen(form,'change',updateSearchAction);
 listen(form,'submit',event=>{event.preventDefault();void search();});
 listen($('[data-ref-cancel]'),'click',()=>{sequence++;clearTimeout(timer);controller?.abort();controller=null;setBusy(false);message('已取消本次检索，可以调整关键词后重新查询。');});
 listen($('[data-ref-done]'),'click',close);
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
 if(container.closest('dialog')?.open&&!autoSearch)form.querySelector('[name=q]').focus({preventScroll:true});
 const capabilities=loadSources();
 const initialSearch=autoSearch&&current()&&form.querySelector('[name=q]').value.trim().length>=2?search():Promise.resolve();
 const ready=Promise.all([capabilities,initialSearch]);
 if(autoSearch&&(!form.querySelector('[name=q]').value.trim()||form.querySelector('[name=q]').value.trim().length<2))message('请先填写论文题目或研究关键词，再开始推荐检索。');
 dispose.ready=ready;dispose.search=()=>search();return dispose;
}
