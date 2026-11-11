import {icon} from './ui.mjs';

// Rearrange existing controls without replacing their handlers or task state.
export function mountLiteratureAssistantLayout(container) {
 const doc=container.ownerDocument,win=doc.defaultView,abort=new win.AbortController();
 if(!doc.querySelector('link[data-lit-assistant-layout]')){
  const link=doc.createElement('link');link.rel='stylesheet';link.href='/workspace/literature-assistant-layout.css';link.dataset.litAssistantLayout='';doc.head.append(link);
 }
 const card=container.querySelector('.lit-ai-card'),inputs=card?.querySelector('.lit-ai-inputs'),actions=card?.querySelector('.lit-ai-actions');
 if(!card||!inputs||!actions)return{dispose(){abort.abort();}};
 container.dataset.compactAssistant='true';
 const composer=doc.createElement('div');composer.className='lit-assistant-composer';composer.dataset.litComposer='';
 const footer=doc.createElement('div');footer.className='lit-assistant-compose-footer';
 const nav=card.querySelector('.lit-ai-tabs'),selected=nav?.querySelector('[aria-pressed=true]');
 const tools=doc.createElement('details');tools.className='lit-assistant-tools';tools.dataset.litTools='';
 const summary=doc.createElement('summary');summary.innerHTML=icon('book',15)+'<span></span><span aria-hidden="true">⌄</span>';
 summary.querySelector('span').textContent=selected?.dataset.litAiOperation==='answer'?'文献工具':selected?.textContent||'文献工具';
 summary.setAttribute('aria-label','文献工具，当前：'+(selected?.textContent||'问答'));tools.append(summary);
 if(nav){nav.setAttribute('aria-label','文献工具');tools.append(nav);}
 footer.append(tools);
 const range=inputs.querySelector('.lit-assistant-range');
 if(range){
  const body=doc.createElement('div');body.className='lit-assistant-range-panel';
  for(const child of [...range.children])if(child.tagName!=='SUMMARY')body.append(child);
  range.append(body);const title=range.querySelector('summary');title.setAttribute('aria-label','调整本次阅读范围');
  title.querySelector('span').textContent='原文范围';title.querySelector('span:last-child').textContent='⌄';footer.append(range);
 }
 const question=inputs.querySelector('[data-lit-ai-question]');
 let frame;const requestFrame=win.requestAnimationFrame?.bind(win)||(fn=>win.setTimeout(fn,0)),cancelFrame=win.cancelAnimationFrame?.bind(win)||win.clearTimeout.bind(win);
 const resizeInput=()=>{if(!question)return;question.style.height='auto';const height=Math.max(48,Math.min(112,question.scrollHeight));question.style.height=height+'px';question.style.overflowY=question.scrollHeight>112?'auto':'hidden';};
 if(question){
  question.rows=1;question.setAttribute('aria-label','向这篇文献提问');question.placeholder='询问论文内容，或选中原文提问…';
  const label=question.closest('label');const labelText=doc.createElement('span');labelText.className='lit-assistant-sr-only';labelText.textContent='向这篇文献提问';
  for(const child of [...label.childNodes])if(child.nodeType===3)child.remove();label.prepend(labelText);
  question.style.height='48px';question.addEventListener('input',resizeInput,{signal:abort.signal});
  const style=doc.querySelector('link[data-lit-assistant-layout]'),resize=()=>{if(frame!==undefined)cancelFrame(frame);frame=requestFrame(resizeInput);};
  if(style.sheet)resize();else style.addEventListener('load',resize,{once:true,signal:abort.signal});
  win.addEventListener('resize',resize,{signal:abort.signal});
 }else{
  const hint=doc.createElement('p');hint.className='lit-assistant-mode-hint';
  hint.textContent=selected?.dataset.litAssistantMode==='summary'?'梳理研究问题、方法与主要发现':selected?.dataset.litAssistantMode==='deep'?'深入分析研究方法、证据与局限':selected?.dataset.litAiOperation==='translate'?'保留原文术语与段落顺序':'提炼关键概念、核心方法与重要结论';inputs.append(hint);
 }
 const quick=inputs.querySelector('.lit-ai-quick-questions'),empty=card.querySelector('.lit-ai-results>.lit-ai-empty');
 if(quick){if(empty)empty.append(quick);else quick.hidden=true;}
 const send=actions.querySelector('[data-lit-ai-open]');if(send&&question){send.innerHTML=icon('send',17)+'<span>发送</span>';send.setAttribute('aria-label','发送问题');}
 actions.querySelector(':scope>span')?.remove();footer.append(actions);const price=card.querySelector('[data-lit-price]');composer.append(inputs);if(price)composer.append(price);composer.append(footer);card.append(composer);
 for(const result of card.querySelectorAll('.lit-ai-result')){
  const toolbar=doc.createElement('div');toolbar.className='lit-assistant-result-toolbar';
  const copy=result.querySelector('.lit-assistant-result-tools'),evidence=result.querySelector('.lit-assistant-evidence'),more=result.querySelector('.lit-assistant-more'),edit=result.querySelector('.lit-assistant-edit'),exports=result.querySelector('.lit-assistant-export');
  if(copy)toolbar.append(copy);if(evidence)toolbar.append(evidence);
  if(more){const body=more.querySelector(':scope>div');if(edit)body.prepend(edit);if(exports)body.append(exports);toolbar.append(more);}
  result.append(toolbar);
  for(const detail of [evidence,more,edit,exports].filter(Boolean))detail.addEventListener('toggle',()=>{
   if(!detail.open)return;const viewport=result.closest('.lit-ai-results'),bounds=detail.getBoundingClientRect(),view=viewport.getBoundingClientRect();
   if(bounds.height>viewport.clientHeight-32)viewport.scrollTop+=bounds.top-view.top-12;
   else if(bounds.bottom>view.bottom-12)viewport.scrollTop+=bounds.bottom-view.bottom+12;
  },{signal:abort.signal});
 }
 const studio=container.closest('.lit-reader-studio');
 if(studio){
  const expand=doc.createElement('button');expand.type='button';expand.className='lit-assistant-expand';expand.dataset.litAssistantExpand='';
  const syncExpand=()=>{const expanded=studio.dataset.assistantExpanded==='true';expand.innerHTML=icon('grid',14)+'<span>'+(expanded?'还原':'放大')+'</span>';expand.setAttribute('aria-label',expanded?'还原原文与 AI 双栏布局':'放大 AI 对话窗口');expand.setAttribute('aria-pressed',String(expanded));};
  syncExpand();card.querySelector('.lit-ai-head').append(expand);
  expand.addEventListener('click',()=>{const expanded=studio.dataset.assistantExpanded!=='true';if(expanded&&studio.dataset.focus==='true')studio.querySelector('[data-reader-focus]')?.click();studio.dataset.assistantExpanded=String(expanded);syncExpand();win.dispatchEvent(new win.Event('resize'));},{signal:abort.signal});
  doc.addEventListener('click',event=>{if(event.target.closest('[data-reader-layout-reset]')){studio.dataset.assistantExpanded='false';syncExpand();}},{signal:abort.signal});
  doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&studio.dataset.assistantExpanded==='true'&&!tools.open&&!range?.open){studio.dataset.assistantExpanded='false';syncExpand();win.dispatchEvent(new win.Event('resize'));}},{signal:abort.signal});
 }
 const popovers=[tools,...(range?[range]:[])];
 for(const popover of popovers)popover.addEventListener('toggle',()=>{if(popover.open)for(const other of popovers)if(other!==popover)other.open=false;},{signal:abort.signal});
 doc.addEventListener('click',event=>{for(const popover of popovers)if(popover.open&&!popover.contains(event.target))popover.open=false;},{signal:abort.signal});
 doc.addEventListener('keydown',event=>{if(event.key==='Escape')for(const popover of popovers)if(popover.open){popover.open=false;popover.querySelector('summary').focus({preventScroll:true});event.stopPropagation();}},{signal:abort.signal});
 return{dispose(){abort.abort();if(frame!==undefined)cancelFrame(frame);}};
}
