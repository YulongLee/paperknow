import {mountLiterature,mountLiteratureDiscoveryPage,openLiteratureMaterialForm,disposeLiterature} from './literature.mjs';
import {mountDocumentTranslation} from './document-translation.mjs';
import {readingWorkflowMarkup,updateReadingWorkflow,bindReadingWorkflow,focusReadingTarget} from './literature-workflow.mjs';
import {literatureKey,scopes} from './literature-model.mjs';
import {clearEditor} from './edit-guard.mjs';
import {list} from './state.mjs';
import {withStableView} from './view-stability.mjs';
import {toolBanner} from './tool-banner.mjs';
import {esc,icon} from './ui.mjs';

export const readingFeatures=Object.freeze([
 {id:'library',art:'/workspace/assets/feature-art-v1/reading-library.webp',title:'我的文献',icon:'book',color:'blue',tag:'文献管理',description:'导入与管理文献，整理题录、分组和阅读记录。'},
 {id:'search',art:'/workspace/assets/feature-art-v1/reading-search.webp',title:'文献检索',icon:'search',color:'orange',tag:'查找资料',description:'按主题检索文献，筛选、保存并继续研读。'},
 {id:'reading',art:'/workspace/assets/feature-art-v1/reading-reading.webp',title:'文献研读',icon:'file',color:'mint',tag:'理解原文',description:'选择原文，提炼核心要点、总结或深入解读。'},
 {id:'answer',art:'/workspace/assets/feature-art-v1/reading-answer.webp',title:'原文问答',icon:'help',color:'blue',tag:'围绕原文提问',description:'提出研究问题，查看回答与可定位的原文依据。'},
 {id:'translation',art:'/workspace/assets/feature-art-v1/reading-translation.webp',title:'文献翻译',icon:'language',color:'violet',tag:'跨语言阅读',description:'制作原文对照译文，或翻译整篇 PDF、Word 文档。'}
].map(Object.freeze));
export const readingFeatureHref=id=>id==='review'?'#tool/summary':'#category/literature?view='+encodeURIComponent(readingFeatures.some(feature=>feature.id===id)?id:'library');
let controller=null,child=null;
export function disposeLiteraturePages(){controller?.abort();controller=null;child?.dispose?.();child=null;disposeLiterature();}
function begin(container,feature){
 disposeLiteraturePages();clearEditor();controller=new AbortController();const signal=controller.signal;
 container.classList.remove('category-view');container.classList.add('creation-page');container.dataset.readingPage=feature;
 const hash=container.ownerDocument.defaultView.location.hash;
 return {signal,current:()=>!signal.aborted&&container.isConnected&&container.ownerDocument.defaultView.location.hash===hash};
}
function pageHeading(feature){return toolBanner('literature',{feature:'reading-'+feature.id,title:feature.title,label:'文献研读 · '+feature.title,description:feature.description,actions:'<a class="btn secondary" href="#category/literature">'+'<span aria-hidden="true">←</span>'+' 返回文献研读</a>'});}

export function mountLiteratureLanding(ctx,{container=document.querySelector('.dashboard')}={}){
 begin(container,'home');const papers=list(literatureKey),notes=papers.reduce((n,p)=>n+(p.notes?.length||0),0);
 container.innerHTML=`<section class="lit-workspace-refresh lit-catalog">${toolBanner('literature',{title:'文献研读',description:'从查找文献到理解原文，选择一项任务开始。'})}<div class="lit-overview-strip"><div><span class="lit-overview-kicker">YOUR READING SPACE</span><h2>选择任务，进入专属工作页面</h2><p>检索、研读、问答与翻译，各有清晰的操作流程。</p></div><dl><div><dt>已保存文献</dt><dd>${papers.length}<small>篇</small></dd></div><div><dt>研究笔记</dt><dd>${notes}<small>条</small></dd></div></dl></div><section class="lit-feature-grid" aria-label="文献研读功能">${readingFeatures.map((feature,index)=>`<a class="lit-feature-card ${feature.color}" data-reading-feature="${feature.id}" href="${readingFeatureHref(feature.id)}"><span class="lit-feature-art" aria-hidden="true"><img src="${feature.art}" srcset="${feature.art.replace('.webp','-320.webp')} 320w, ${feature.art} 640w" sizes="166px" width="166" height="166" alt="" loading="lazy" decoding="async"></span><span class="lit-feature-top"><span class="lit-feature-icon">${icon(feature.icon,22)}</span><span class="lit-feature-state">${feature.tag}</span></span><span class="lit-feature-copy"><b>${feature.title}</b><small>${feature.description}</small></span><span class="lit-feature-bottom"><span>0${index+1} / ${feature.title}</span><span>开始使用 ${icon('arrow',15)}</span></span></a>`).join('')}</section></section>`;
}

export function mountLiteratureFeaturePage(kind,ctx,{container=document.querySelector('.dashboard'),fetcher,translationOptions={}}={}){
 if(kind==='review'){disposeLiteraturePages();clearEditor();container.ownerDocument.defaultView.location.replace(readingFeatureHref(kind));return;}
 const feature=readingFeatures.find(row=>row.id===kind);if(!feature){mountLiteratureLanding(ctx,{container});return;}
 const {signal,current}=begin(container,kind);
 if(kind==='library'){mountLiterature(ctx);return;}
 if(kind==='search'){child=mountLiteratureDiscoveryPage(ctx,{container,...(fetcher?{fetcher}:{})});return child;}
 container.innerHTML=`<section class="lit-workspace-refresh lit-feature-page">${pageHeading(feature)}<div data-reading-page-content></div></section>`;
 const host=container.querySelector('[data-reading-page-content]');
 const importMaterial=existing=>openLiteratureMaterialForm({...ctx,onSaved:()=>{if(current())mountLiteratureFeaturePage(kind,ctx,{container,fetcher,translationOptions});}},existing);
 if(kind==='translation'){
  const documentMode=new URLSearchParams(container.ownerDocument.defaultView.location.hash.split('?')[1]||'').get('mode')==='document';
  host.innerHTML=`<nav class="document-translation-modes lit-translation-page-modes" aria-label="文献翻译方式"><a href="${readingFeatureHref('translation')}" class="${documentMode?'':'active'}" ${documentMode?'':'aria-current="page"'}>原文对照翻译</a><a href="${readingFeatureHref('translation')}&mode=document" class="${documentMode?'active':''}" ${documentMode?'aria-current="page"':''}>整篇文档翻译 <small>PDF / Word</small></a></nav><div data-reading-translation-host></div>`;
  if(documentMode){child=mountDocumentTranslation({container:host.querySelector('[data-reading-translation-host]'),notify:ctx.notify,...translationOptions});return child;}
 }
 const target=host.querySelector('[data-reading-translation-host]')||host,operation=kind==='answer'?'answer':kind==='translation'?'translate':'read',tab=kind==='translation'?'translation':kind==='answer'?'answer':'text';
 target.innerHTML=`${readingWorkflowMarkup(operation)}<section class="card lit-source-picker"><header><div><span class="rdc-section-kicker">CHOOSE YOUR SOURCE</span><h2>选择${kind==='translation'?'要翻译':kind==='answer'?'要提问':'要研读'}的文献</h2><p>选择已保存的正文或摘要，也可以导入新的研究材料。</p></div><div class="lit-source-page-actions"><button type="button" class="btn primary" data-reading-import>${icon('upload',16)} 导入文献</button><a class="btn secondary" href="${readingFeatureHref('search')}">检索文献</a></div></header><label class="asset-search">${icon('search',17)}<input type="search" data-reading-source-query aria-label="搜索已保存文献" placeholder="搜索文献标题、作者或关键词"></label><div class="lit-source-picker-list" data-reading-source-list></div></section>`;
 const workflow=target.querySelector('[data-reading-workflow]');updateReadingWorkflow(workflow,{step:1,phase:'prepare',hint:'先选择一篇文献，进入对应的'+feature.title+'页面继续；选择材料不会开始 AI 处理。',disabled:[2,3,4]});bindReadingWorkflow(workflow,()=>focusReadingTarget(target.querySelector('[data-reading-source-query]')));
 target.querySelector('[data-reading-import]').onclick=()=>importMaterial();
 function renderSources(){
  if(!current())return;const query=target.querySelector('[data-reading-source-query]').value.trim().toLocaleLowerCase(),all=list(literatureKey),rows=all.filter(p=>!query||[p.title,p.authors,...(p.tags||[])].join(' ').toLocaleLowerCase().includes(query));
  withStableView(container,()=>{target.querySelector('[data-reading-source-list]').innerHTML=rows.map(p=>{const usable=p.scope!=='metadata'&&p.text?.trim();return `<article class="lit-source-picker-row"><span class="hub-row-icon">${icon('file',21)}</span><div><h3>${esc(p.title)}</h3><p>${esc(p.authors||'作者未填写')} · ${esc(p.year||'年份未填写')}</p><small>${esc(scopes[p.scope]||'仅题录')} · ${Number(p.text?.length||0).toLocaleString('zh-CN')} 字符</small></div>${usable?`<a class="btn secondary" href="#literature/${encodeURIComponent(p.id)}?tab=${tab}">${kind==='answer'?'开始问答':kind==='translation'?'开始翻译':'开始研读'} ${icon('arrow',15)}</a>`:`<button type="button" class="btn secondary" data-reading-prepare="${esc(p.id)}">补充原文</button>`}</article>`;}).join('')||`<div class="lit-source-picker-empty">${icon('book',32)}<h3>${all.length?'没有匹配的文献':'先准备一篇文献'}</h3><p>${all.length?'换个关键词，或导入新的研究材料。':'导入正文或摘要后，即可开始'+feature.title+'。'}</p></div>`;});
 }
 target.querySelector('[data-reading-source-query]').addEventListener('input',renderSources,{signal});target.addEventListener('click',event=>{const button=event.target.closest('[data-reading-prepare]');if(button)importMaterial(list(literatureKey).find(p=>p.id===button.dataset.readingPrepare));},{signal});renderSources();
}
