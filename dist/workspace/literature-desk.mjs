import {saveLiteratureOriginal} from './literature-upload.mjs';
import {mountLiteratureDiscoveryPage} from './literature.mjs';
import {importWorkspaceDocument} from './document-import.mjs';
import {openStoredFilePicker} from './file-picker.mjs';
import {literatureKey,validatePaper,scopes} from './literature-model.mjs';
import {list,write} from './state.mjs';
import {esc,icon,formatDate} from './ui.mjs';

const readerLink=id=>'#literature/'+encodeURIComponent(id)+'?tab=answer';
function stylesheet(doc){if(doc.querySelector('[data-literature-desk-style]'))return;const link=doc.createElement('link');link.rel='stylesheet';link.href='/workspace/literature-desk.css';link.dataset.literatureDeskStyle='';doc.head.append(link);}

export function mountLiteratureDesk(ctx,{container=document.querySelector('.dashboard'),fetcher,importDocument=importWorkspaceDocument,saveOriginal=saveLiteratureOriginal}={}){
 const doc=container.ownerDocument,win=doc.defaultView,route=win.location.hash,controller=new win.AbortController();stylesheet(doc);
 let live=true,uploading=false,discovery=null,picker=null,query='',statusFilter='all',sort='recent',shown=12,index=[];
 const current=()=>live&&container.isConnected&&win.location.hash===route;
 container.dataset.readingPage='desk';
 container.innerHTML=`<section class="lit-desk lit-desk-pro"><header class="lit-desk-header"><div class="lit-desk-brand"><span>${icon('book',25)}</span><div><h1>文献研读</h1><p>查找、阅读、理解，让每篇论文都有收获。</p></div></div><a class="lit-desk-manage" href="#category/literature?view=library">${icon('folder',16)} 管理文献 ${icon('arrow',14)}</a></header><div class="lit-desk-start"><section class="lit-desk-discover"><header><span class="lit-section-eyebrow">发现文献</span><h2>从你的研究问题开始</h2><p>检索论文标题、研究主题或 DOI，找到值得深入阅读的文献。</p></header><div data-desk-discovery></div></section><section class="lit-desk-import-card" data-desk-drop><span class="lit-desk-import-icon">${icon('upload',27)}</span><h2>打开手头的论文</h2><p>拖入论文，或选择已保存的文件，直接进入阅读工作区。</p><label class="btn primary lit-desk-upload">${icon('plus',17)} 上传文献<input type="file" accept=".pdf,.docx,.txt" data-no-file-library data-desk-upload aria-label="上传要研读的文献"></label><button type="button" class="btn secondary" data-desk-cloud>${icon('folder',16)} 从文件管理选择</button><small>PDF ≤ 20MB · DOCX / TXT ≤ 2MB</small></section></div><section class="lit-desk-import-status" data-desk-import hidden aria-live="polite"><div class="lit-desk-loading" aria-hidden="true"></div><div data-desk-import-message role="status"></div></section><section class="lit-desk-saved"><header><div><h2>我的阅读 <span data-desk-count></span></h2><p>继续上次阅读，或找到已经保存的文献。</p></div><label class="lit-desk-filter">${icon('search',16)}<input type="search" data-desk-filter placeholder="搜索标题、作者或关键词" aria-label="搜索我的文献"></label></header><div class="lit-desk-list-toolbar"><nav class="lit-desk-tabs" aria-label="阅读筛选"><button type="button" data-desk-tab="search" aria-pressed="true">全部文献</button><button type="button" data-desk-tab="saved" aria-pressed="false">已有正文</button><button type="button" data-desk-tab="reading" aria-pressed="false">阅读中</button></nav><label>排序<select data-desk-sort aria-label="文献排序"><option value="recent">最近阅读</option><option value="added">最近添加</option><option value="title">标题名称</option></select></label></div><div class="lit-desk-files" data-desk-files></div><button type="button" class="lit-desk-more" data-desk-more hidden>显示更多文献</button><p class="lit-desk-list-status" data-desk-list-status role="status"></p></section></section>`;
 const $=s=>container.querySelector(s),listen=(node,type,fn)=>node?.addEventListener(type,fn,{signal:controller.signal});
 function refresh(){index=list(literatureKey).map(p=>({id:p.id,title:p.title,authors:p.authors,year:p.year,scope:p.scope,status:p.status,notes:p.notes?.length||0,fileName:p.fileName,createdAt:p.createdAt,updatedAt:p.updatedAt,lastReadAt:p.lastReadAt,search:[p.title,p.authors,p.doi,...(p.tags||[])].join(' ').toLocaleLowerCase()}));renderFiles();}
 function renderFiles(){
  if(!current())return;const rows=index.filter(p=>(!query||p.search.includes(query))&&(statusFilter==='all'||statusFilter==='full'&&p.scope==='full'||statusFilter==='reading'&&p.status==='reading')).sort((a,b)=>sort==='title'?a.title.localeCompare(b.title,'zh-CN'):(Date.parse(sort==='added'?b.createdAt:b.lastReadAt||b.updatedAt||b.createdAt)||0)-(Date.parse(sort==='added'?a.createdAt:a.lastReadAt||a.updatedAt||a.createdAt)||0));
  $('[data-desk-count]').textContent=String(index.length);$('[data-desk-more]').hidden=rows.length<=shown;$('[data-desk-list-status]').textContent=rows.length?'已显示 '+Math.min(rows.length,shown)+' / '+rows.length+' 篇文献':'';
  $('[data-desk-files]').innerHTML=rows.length?rows.slice(0,shown).map(p=>`<article class="lit-desk-file"><span class="lit-desk-file-icon">${icon(/\.pdf$/i.test(p.fileName||'')?'file':'book',23)}<small>${/\.pdf$/i.test(p.fileName||'')?'PDF':/\.docx$/i.test(p.fileName||'')?'WORD':'文献'}</small></span><a href="${readerLink(p.id)}"><h3>${esc(p.title)}</h3><p>${esc(p.authors||'作者未填写')}${p.year?' · '+esc(p.year):''}</p><span class="lit-desk-file-meta"><b class="lit-scope ${esc(p.scope)}">${esc(scopes[p.scope]||'仅题录')}</b><i>·</i>${p.lastReadAt?'上次阅读 '+esc(formatDate(p.lastReadAt)):'添加于 '+esc(formatDate(p.createdAt))}</span></a><div><span class="lit-desk-note-count">${p.notes} 条笔记</span><a class="btn secondary" href="${readerLink(p.id)}">${p.lastReadAt?'继续阅读':'打开研读'} ${icon('arrow',15)}</a></div></article>`).join(''):`<div class="lit-desk-empty"><span>${icon('book',34)}</span><h3>${index.length?'没有匹配的文献':'从第一篇论文，开始积累你的研究'}</h3><p>${index.length?'试试其他关键词，或切换阅读筛选。':'上传手头的论文，或从上方检索感兴趣的研究。'}</p></div>`;
 }
 function setTab(tab){statusFilter=tab==='saved'?'full':tab==='reading'?'reading':'all';shown=12;container.querySelectorAll('[data-desk-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.deskTab===tab)));renderFiles();}

 async function upload(file){
  if(!file||uploading||!current())return;const input=$('[data-desk-upload]'),status=$('[data-desk-import]'),message=$('[data-desk-import-message]');
  uploading=true;input.disabled=true;status.hidden=false;status.classList.remove('is-error');status.setAttribute('aria-busy','true');
  try{
   if(!/\.(pdf|docx|txt)$/i.test(file.name||''))throw Error('请选择 PDF、DOCX 或 TXT 论文文件。');
   if(file.size>(/\.pdf$/i.test(file.name)?20:2)*1024*1024)throw Error(/\.pdf$/i.test(file.name)?'PDF 最大支持 20MB。':'Word、TXT 文献最大支持 2MB。');
   message.textContent='正在读取文献，请稍候…';const parsed=await importDocument(file,message,{signal:controller.signal});if(!current())return;
   if(!String(parsed.text||'').trim())throw Error('没有读取到可研读的正文，请检查文件或通过文献管理补充原文。');
   const rows=list(literatureKey),duplicate=rows.find(p=>parsed.originalFileId&&p.originalFileId===parsed.originalFileId||p.fileName===file.name&&p.text===parsed.text&&p.scope==='full');
   if(duplicate){win.location.hash=readerLink(duplicate.id);return;}
   if(rows.length>=200)throw Error('已保存 200 篇文献，请先在文献管理中整理不再需要的记录。');
   const original=/\.pdf$/i.test(file.name)?{originalFileId:parsed.originalFileId||'',originalOwnerId:parsed.originalOwnerId||''}:await saveOriginal(file,{signal:controller.signal,isCurrent:current,...(fetcher?{fetchImpl:fetcher}:{})});if(!current())return;
   const now=new Date().toISOString(),paper=validatePaper({id:win.crypto.randomUUID(),title:file.name.replace(/\.(pdf|docx|txt)$/i,'').slice(0,300),scope:'full',text:parsed.text,fileName:file.name,warnings:parsed.warnings||[],...original,notes:[],status:'unread',createdAt:now,updatedAt:now});
   const latest=list(literatureKey),known=latest.find(row=>original.originalFileId&&row.originalFileId===original.originalFileId);if(known){win.location.hash=readerLink(known.id);return;}if(latest.length>=200)throw Error('文献数量已达上限，原件已保留在文件管理，请整理后再导入。');write(literatureKey,[paper,...latest]);if(current())win.location.hash=readerLink(paper.id);
  }catch(error){if(current()){status.classList.add('is-error');message.textContent=error.message||'文献导入未完成，请重试；已有文献仍保留。';}}
  finally{uploading=false;if(current()){input.disabled=false;input.value='';status.setAttribute('aria-busy','false');}}
 }
 listen($('[data-desk-filter]'),'input',event=>{query=event.target.value.trim().toLocaleLowerCase();shown=12;renderFiles();});
 container.querySelectorAll('[data-desk-tab]').forEach(button=>listen(button,'click',()=>setTab(button.dataset.deskTab)));
 listen($('[data-desk-upload]'),'change',event=>void upload(event.target.files?.[0]));
 listen($('[data-desk-sort]'),'change',event=>{sort=event.target.value;shown=12;renderFiles();});listen($('[data-desk-more]'),'click',()=>{shown+=12;renderFiles();});listen(win,'storage',event=>{if(event.key===literatureKey||event.key===null)refresh();});
 listen($('[data-desk-cloud]'),'click',()=>{if(uploading)return;picker?.close();picker=openStoredFilePicker({documentObject:doc,accept:'.pdf,.docx,.txt',isCurrent:current,onSelect:upload,...(fetcher?{fetchImpl:fetcher}:{})});});
 const drop=$('[data-desk-drop]');listen(drop,'dragover',event=>{event.preventDefault();drop.classList.add('is-dragging');});listen(drop,'dragleave',()=>drop.classList.remove('is-dragging'));listen(drop,'drop',event=>{event.preventDefault();drop.classList.remove('is-dragging');void upload(event.dataTransfer?.files?.[0]);});
 refresh();
 discovery=mountLiteratureDiscoveryPage(ctx,{container:$('[data-desk-discovery]'),embedded:true,...(fetcher?{fetcher}:{})});
 return {ready:discovery?.ready,upload,refresh,dispose(){if(!live)return;live=false;controller.abort();picker?.close();discovery?.dispose();}};
}
