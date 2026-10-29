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
 let live=true,uploading=false,discovery=null,picker=null,query='';
 const current=()=>live&&container.isConnected&&win.location.hash===route;
 container.dataset.readingPage='desk';
 container.innerHTML=`<section class="lit-desk"><header class="lit-desk-header"><div><span class="lit-desk-kicker">${icon('book',17)} YOUR READING DESK</span><h1>文献研读</h1><p>找到论文，打开原文，和 AI 一起读懂研究。</p></div><div class="lit-desk-actions"><button type="button" class="btn secondary" data-desk-cloud>${icon('folder',16)} 从文件管理选择</button><label class="btn primary lit-desk-upload">${icon('upload',17)} 上传文献<input type="file" accept=".pdf,.docx,.txt" data-no-file-library data-desk-upload aria-label="上传要研读的文献"></label></div></header><nav class="lit-desk-tabs" aria-label="查找文献"><button type="button" data-desk-tab="search" aria-pressed="true">查找文献</button><button type="button" data-desk-tab="saved" aria-pressed="false">我的文献 <span data-desk-count></span></button><a href="#category/literature?view=library">管理文献 ${icon('arrow',14)}</a></nav><section class="lit-desk-import-status" data-desk-import hidden aria-live="polite"><div class="lit-desk-loading" aria-hidden="true"></div><div data-desk-import-message role="status"></div></section><div data-desk-discovery></div><section class="lit-desk-saved"><header><div><h2 data-desk-list-title>继续阅读</h2><p>上传的文献与已保存的论文都可以直接打开。</p></div><label class="lit-desk-filter">${icon('search',16)}<input type="search" data-desk-filter placeholder="搜索已保存的标题、作者或关键词" aria-label="搜索我的文献"></label></header><div class="lit-desk-files" data-desk-files></div><div class="lit-desk-drop" data-desk-drop><span>${icon('upload',23)}</span><div><b>将论文拖到这里，开始研读</b><p>PDF 最大 20MB · Word（DOCX）、TXT 最大 2MB</p></div><button type="button" class="btn secondary" data-desk-choose>选择文件</button></div></section></section>`;
 const $=s=>container.querySelector(s),listen=(node,type,fn)=>node?.addEventListener(type,fn,{signal:controller.signal});
 function renderFiles(){
  if(!current())return;const all=list(literatureKey),rows=all.filter(p=>!query||[p.title,p.authors,p.doi,...(p.tags||[])].join(' ').toLocaleLowerCase().includes(query)).sort((a,b)=>(Date.parse(b.lastReadAt||b.updatedAt||b.createdAt)||0)-(Date.parse(a.lastReadAt||a.updatedAt||a.createdAt)||0));
  $('[data-desk-count]').textContent=String(all.length);$('[data-desk-filter]').closest('label').hidden=!all.length;
  $('[data-desk-files]').innerHTML=rows.length?rows.map(p=>`<article class="lit-desk-file"><span class="lit-desk-file-icon">${icon(/\.pdf$/i.test(p.fileName||'')?'file':'book',23)}<small>${/\.pdf$/i.test(p.fileName||'')?'PDF':/\.docx$/i.test(p.fileName||'')?'WORD':'文献'}</small></span><a href="${readerLink(p.id)}"><h3>${esc(p.title)}</h3><p>${esc(p.authors||'作者未填写')}${p.year?' · '+esc(p.year):''}</p><span>${esc(scopes[p.scope]||'仅题录')}<i>·</i>${esc(formatDate(p.lastReadAt||p.updatedAt||p.createdAt))}</span></a><div><span class="lit-desk-note-count">${p.notes?.length||0} 条笔记</span><a class="btn secondary" href="${readerLink(p.id)}">打开研读 ${icon('arrow',15)}</a></div></article>`).join(''):`<div class="lit-desk-empty">${icon('book',34)}<h3>${all.length?'没有找到匹配的文献':'准备好第一篇论文'}</h3><p>${all.length?'换个关键词，或上传新的论文。':'检索感兴趣的研究，或上传手头的论文开始阅读。'}</p></div>`;
 }
 function setTab(tab){if(!current())return;container.querySelectorAll('[data-desk-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.deskTab===tab)));$('[data-desk-discovery]').hidden=tab==='saved';$('[data-desk-list-title]').textContent=tab==='saved'?'我的文献':'继续阅读';if(tab==='saved')$('[data-desk-filter]').focus({preventScroll:true});}

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
 listen($('[data-desk-filter]'),'input',event=>{query=event.target.value.trim().toLocaleLowerCase();renderFiles();});
 container.querySelectorAll('[data-desk-tab]').forEach(button=>listen(button,'click',()=>setTab(button.dataset.deskTab)));
 listen($('[data-desk-upload]'),'change',event=>void upload(event.target.files?.[0]));
 listen($('[data-desk-choose]'),'click',()=>$('[data-desk-upload]').click());
 listen($('[data-desk-cloud]'),'click',()=>{if(uploading)return;picker?.close();picker=openStoredFilePicker({documentObject:doc,accept:'.pdf,.docx,.txt',isCurrent:current,onSelect:upload,...(fetcher?{fetchImpl:fetcher}:{})});});
 const drop=$('[data-desk-drop]');listen(drop,'dragover',event=>{event.preventDefault();drop.classList.add('is-dragging');});listen(drop,'dragleave',()=>drop.classList.remove('is-dragging'));listen(drop,'drop',event=>{event.preventDefault();drop.classList.remove('is-dragging');void upload(event.dataTransfer?.files?.[0]);});
 renderFiles();
 discovery=mountLiteratureDiscoveryPage(ctx,{container:$('[data-desk-discovery]'),embedded:true,...(fetcher?{fetcher}:{})});
 return {ready:discovery?.ready,upload,refresh:renderFiles,dispose(){if(!live)return;live=false;controller.abort();picker?.close();discovery?.dispose();}};
}
