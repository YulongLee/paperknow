import {thesisResearchText,thesisReference,confirmThesisMaterials,confirmThesisReferences,selectThesisReference} from './helpers/thesis-flow.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const dom=new JSDOM('<div id="app"><aside class="sidebar"></aside><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main></div><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.cn/workspace.html#tool/writing'});
 for(const key of ['window','document','localStorage','FormData','location','AbortController'])globalThis[key]=dom.window[key];
 const scrolls=[],focuses=[],originalFocus=dom.window.HTMLElement.prototype.focus;
 dom.window.HTMLElement.prototype.scrollIntoView=function(options){scrolls.push({element:this,options});};
 dom.window.HTMLElement.prototype.focus=function(options){focuses.push({element:this,options});originalFocus.call(this,options);};
 document.querySelector('dialog').close=()=>{};
 const $=selector=>document.querySelector(selector),input=(selector,value)=>{$(selector).value=value;$(selector).dispatchEvent(new window.Event('input',{bubbles:true}));};
 const ctx={session:async()=>({status:'guest',user:null}),notify(){},modal(_title,html){$('#workspace-dialog-body').innerHTML=html;}};
 return {dom,$,input,ctx,scrolls,focuses,close(){clearEditor();dom.window.close();}};
}

const bootstrap=fixture();
const {mountWriting}=await import('../dist/workspace/writing.mjs');
const {clearEditor}=await import('../dist/workspace/edit-guard.mjs');
bootstrap.dom.window.close();

test('five-step transitions keep the viewport and do not force focus away from the user',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);
  assert.equal(f.scrolls.length,0,'mounting does not move the user');
  f.input('#writing-title','真实研究步骤定位');f.input('#writing-method','文献分析');f.input('#writing-material','用户提供的真实研究资料');
  const shell=f.$('.creation-grid');
  f.$('#writing-process-next').focus();
  const retainedFocus=document.activeElement,focusCount=f.focuses.length;
  for(const selector of ['#writing-generate','#writing-material-confirm','#writing-reference-confirm']){
   const count=f.scrolls.length;if(selector==='#writing-material-confirm')confirmThesisMaterials();else if(selector==='#writing-reference-confirm')confirmThesisReferences();else f.$(selector).click();await settle();
   assert.equal(f.scrolls.length,count,'a stage change never scrolls');
   assert.equal(f.$('.creation-grid'),shell,'the content shell stays mounted');
   assert.equal(document.activeElement,retainedFocus);
   assert.equal(f.focuses.length,focusCount,'step changes never force focus');
  }
  assert.equal(f.$('.dashboard').dataset.writingStage,'4');
  assert.equal(f.$('#outline-paper .outline-row-title')!==null,true);
  assert.equal(f.scrolls.some(call=>call.element.id==='outline-paper'),false);
  assert.equal(f.$('#writing-title').value,'真实研究步骤定位');
  assert.equal(f.$('#writing-material').value,thesisResearchText);
  f.$('[data-writing-step="3"]').click();await settle();
  f.$('[data-writing-step="4"]').click();await settle();
  assert.equal(f.scrolls.length,0,'clicking step cards preserves the viewport');
  assert.equal(document.activeElement,retainedFocus);
  const beforeFinal=f.scrolls.length;f.$('#outline-confirm').click();await settle();
  assert.equal(f.$('.dashboard').dataset.writingStage,'5');
  assert.equal(f.scrolls.length,beforeFinal);
  assert.equal(document.activeElement,retainedFocus);
  assert.match(f.$('#thesis-online-stage').textContent,/登录后保存到账户/);
  f.$('[data-writing-step="1"]').click();await settle();
  assert.equal(document.activeElement,retainedFocus);
  assert.equal(f.scrolls.length,0);
  assert.equal(f.focuses.length,focusCount);
  const status=f.$('#writing-process-context-text');
  assert.equal(status.getAttribute('role'),'status');
  assert.equal(status.getAttribute('aria-live'),'polite');
  assert.equal(status.getAttribute('aria-atomic'),'true');
  assert.equal(status.textContent,'当前步骤：基础信息填写');
 }finally{f.close();}
});

test('completed steps use one real check in the original number slot and retain confirmation when returning',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','状态检查');
  f.$('#writing-generate').click();await settle();confirmThesisMaterials();await settle();confirmThesisReferences();await settle();
  const steps=[...document.querySelectorAll('[data-writing-step]')];
  assert.equal(steps.length,5);
  assert.deepEqual(steps.map(step=>step.querySelector('.writing-detail-step-number').textContent),['✓','✓','✓','04','05']);
  assert.deepEqual(steps.map(step=>step.querySelector('.writing-detail-step-state').textContent),['已完成','已完成','已完成','正在进行','待解锁']);
  assert.equal(steps.filter(step=>step.classList.contains('is-complete')).length,3);
  assert.equal(steps.filter(step=>step.getAttribute('aria-current')==='step').length,1);
  assert.equal(steps[3].getAttribute('aria-current'),'step');
  assert.ok(steps.every(step=>step.querySelectorAll('.writing-detail-step-number').length===1));
  assert.ok(steps.every(step=>step.querySelector('.writing-detail-step-number').getAttribute('aria-hidden')==='true'));
  steps[1].click();await settle();
  assert.deepEqual(steps.map(step=>step.querySelector('.writing-detail-step-number').textContent),['✓','02','✓','04','05']);
  assert.equal(steps[1].getAttribute('aria-current'),'step');
 }finally{f.close();}
});

test('editing the current step and rerendering its controls does not move focus or scroll',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','保持输入位置');
  const title=f.$('#writing-title');title.focus();const count=f.scrolls.length;
  f.input('#writing-title','保持输入位置，不应跳动');await settle();
  assert.equal(document.activeElement,title);assert.equal(f.scrolls.length,count);
  f.$('#writing-generate').click();await settle();confirmThesisMaterials();await settle();confirmThesisReferences();await settle();
  const field=f.$('#outline-paper .outline-row-title');field.focus();const stageScrolls=f.scrolls.length;
  field.value='第一章 用户重新填写的标题';field.dispatchEvent(new window.Event('input',{bubbles:true}));await settle();
  assert.equal(document.activeElement,field);assert.equal(f.scrolls.length,stageScrolls);assert.equal(field.value,'第一章 用户重新填写的标题');
 }finally{f.close();}
});

test('queued navigation from a disposed editor cannot move the replacement page',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','离开前切换');f.$('#writing-generate').click();
  clearEditor();f.$('.dashboard').innerHTML='<h2 id="replacement" tabindex="-1">另一页</h2>';f.$('#replacement').focus();
  await settle();assert.equal(f.scrolls.length,0);assert.equal(document.activeElement,f.$('#replacement'));
 }finally{f.close();}
});

test('rapid step changes schedule no focus or scroll work',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','快速切换步骤');
  f.$('#writing-generate').click();confirmThesisMaterials();confirmThesisReferences();
  await settle();
  assert.equal(f.scrolls.length,0);
  assert.equal(f.$('.dashboard').dataset.writingStage,'4');
  assert.equal(f.focuses.length,0);
  assert.equal(f.$('#writing-process-context-text').textContent,'当前步骤：论文提纲确认');
 }finally{f.close();}
});

test('collapsed flow advances in place while a validation error still locates its field',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);
  f.input('#writing-title','短');f.$('#writing-process-next').click();await settle();
  assert.equal(f.$('.dashboard').dataset.writingStage,'1');
  assert.equal(document.activeElement,f.$('#writing-title'));
  assert.match(f.$('#writing-error').textContent,/至少 2 个字/);
  f.input('#writing-title','折叠流程后继续写作');
  f.$('.writing-process-toggle').click();
  assert.ok(f.$('.writing-process-guide').classList.contains('is-collapsed'));
  f.$('#writing-process-next').focus();const focusCount=f.focuses.length;
  for(const stage of ['2','3','4']){
   if(stage==='3')f.input('#knowledge-ai-input',thesisResearchText);if(stage==='4')selectThesisReference();f.$('#writing-process-next').click();await settle();
   assert.equal(f.$('.dashboard').dataset.writingStage,stage);
   assert.equal(document.activeElement,f.$('#writing-process-next'));
   assert.equal(f.focuses.length,focusCount);
   assert.equal(f.scrolls.length,0);
  }
 }finally{f.close();}
});

test('completed-step colors remain green rather than being replaced by the task accent',async()=>{
 const css=await readFile(new URL('../dist/workspace/writing-detail-commercial.css',import.meta.url),'utf8');
 const dom=new JSDOM(`<style>${css}</style><div id="app"><main class="dashboard writing-detail-commercial"><section class="writing-detail-stepper"><ol><li class="is-complete"><span class="writing-detail-step-number">✓</span><div><b>已确认步骤</b><em class="writing-detail-step-state">已完成</em></div></li></ol></section></main></div>`);
 try{
  const doc=dom.window.document,style=node=>dom.window.getComputedStyle(doc.querySelector(node));
  assert.equal(style('.is-complete').backgroundColor,'rgb(244, 251, 247)');
  assert.equal(style('.writing-detail-step-number').color,'rgb(34, 123, 92)');
  assert.equal(style('.is-complete b').color,'rgb(42, 125, 94)');
  assert.equal(style('.writing-detail-step-state').color,'rgb(42, 125, 94)');
  doc.body.classList.add('hub-theme-dark');
  assert.equal(style('.is-complete').backgroundColor,'rgb(24, 53, 47)');
  assert.equal(style('.writing-detail-step-number').color,'rgb(139, 214, 177)');
  assert.equal(style('.is-complete b').color,'rgb(139, 214, 177)');
 }finally{dom.window.close();}
});


test('unmet thesis requirements cannot be bypassed through step cards, hidden actions or the legacy skip',async()=>{
 const f=fixture();let requests=0;f.ctx.api=async()=>{requests++;throw Error('Blocked steps must not submit online work');};
 try{mountWriting(undefined,undefined,f.ctx);f.$('[data-writing-step="5"]').click();f.$('#outline-confirm').click();assert.equal(f.$('.dashboard').dataset.writingStage,'1');
  f.input('#writing-title','逐步确认的研究');f.$('#writing-generate').click();assert.equal(f.$('.dashboard').dataset.writingStage,'2');f.input('#knowledge-ai-input','1');f.$('#writing-material-confirm').click();assert.equal(f.$('.dashboard').dataset.writingStage,'2');assert.match(f.$('#writing-step-error').textContent,/100/);
  for(const step of ['3','4','5']){f.$('[data-writing-step="'+step+'"]').click();assert.equal(f.$('.dashboard').dataset.writingStage,'2');}
  assert.equal(f.$('#writing-material-skip').hidden,true);f.$('#writing-material-skip').click();f.$('#writing-reference-confirm').click();f.$('#outline-confirm').click();assert.equal(f.$('.dashboard').dataset.writingStage,'2');
  confirmThesisMaterials();assert.equal(f.$('.dashboard').dataset.writingStage,'3');f.$('#writing-reference-confirm').click();assert.equal(f.$('.dashboard').dataset.writingStage,'3');assert.match(f.$('#writing-reference-status').textContent,/至少.*1.*参考文献/);f.$('[data-writing-step="4"]').click();f.$('#outline-confirm').click();assert.equal(f.$('.dashboard').dataset.writingStage,'3');assert.equal(requests,0);
  confirmThesisReferences();assert.equal(f.$('.dashboard').dataset.writingStage,'4');f.$('#outline-confirm').click();await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'5');assert.equal(requests,0);
 }finally{f.close();}
});

test('restoring an incomplete later thesis draft returns to the earliest missing step without discarding body or proposal',()=>{
 const f=fixture();try{const row={id:'legacy-incomplete',tool:'writing',title:'恢复待补资料的研究',degree:'本科',language:'中文',targetWords:8000,workflowStage:5,workflowUnlockedStage:5,outlineConfirmed:true,outlineText:'第一章 已有提纲',outlineRows:[{id:'c1',level:1,title:'第一章 已有提纲',words:8000}],bodySections:[{id:'c1',title:'第一章 已有提纲',text:'之前手动撰写并保存的正文。'}],knowledgeFiles:[{id:'too-short',name:'旧版说明',text:'1',kind:'file'}],writingReferences:[{...thesisReference}],methodSuggestion:{text:thesisResearchText,jobId:'proposed-plan'}};localStorage.setItem('paperknow-drafts',JSON.stringify([row]));mountWriting(row.id,undefined,f.ctx);assert.equal(f.$('.dashboard').dataset.writingStage,'2');assert.match(f.$('#writing-step-error').textContent,/100/);assert.equal(f.$('[data-writing-step="5"]').getAttribute('aria-disabled'),'true');f.$('#writing-save').click();const saved=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.deepEqual(saved.bodySections,row.bodySections);assert.deepEqual(saved.outlineRows,row.outlineRows);assert.deepEqual(saved.methodSuggestion,row.methodSuggestion);assert.equal(saved.workflowStage,2);assert.equal(saved.outlineConfirmed,false);
 }finally{f.close();}
});

test('unconfirmed restored research input cannot unlock a later step until it replaces the recorded short source',async()=>{
 const f=fixture();try{
  const row={id:'restored-pending-input',tool:'writing',title:'恢复尚未确认的研究说明',degree:'本科',language:'中文',targetWords:8000,workflowStage:5,workflowUnlockedStage:5,outlineConfirmed:true,outlineText:'第一章 研究背景',outlineRows:[{id:'c1',level:1,title:'第一章 研究背景',words:8000}],bodySections:[{id:'c1',title:'第一章 研究背景',text:'已有正文需要完整保留。'}],knowledgeFiles:[{id:'original-note',name:'原研究说明',kind:'ai',text:'1'}],writingReferences:[{...thesisReference}],writingEditorState:{inputs:{'knowledge-ai-input':thesisResearchText}}};
  localStorage.setItem('paperknow-drafts',JSON.stringify([row]));mountWriting(row.id,undefined,f.ctx);await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'2');assert.equal(f.$('#knowledge-ai-input').value,thesisResearchText);assert.equal(f.$('[data-writing-step="5"]').getAttribute('aria-disabled'),'true');f.$('[data-writing-step="5"]').click();assert.equal(f.$('.dashboard').dataset.writingStage,'2');
  f.$('#writing-save').click();let saved=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.equal(saved.knowledgeFiles[0].text,'1');assert.equal(saved.writingEditorState.inputs['knowledge-ai-input'],thesisResearchText);assert.deepEqual(saved.bodySections,row.bodySections);
  f.$('#writing-material-confirm').click();assert.equal(f.$('.dashboard').dataset.writingStage,'3');f.$('#writing-save').click();saved=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.equal(saved.knowledgeFiles[0].text,thesisResearchText);assert.equal(saved.knowledgeFiles[0].id,'original-note');assert.deepEqual(saved.bodySections,row.bodySections);
 }finally{f.close();}
});

test('hidden outline and body actions cannot skip Step 2 even when stored materials and references are valid',()=>{
 const f=fixture();try{
  const row={id:'step-two-hidden-actions',tool:'writing',title:'资料已备但尚未逐步确认',degree:'本科',language:'中文',targetWords:8000,workflowStage:2,workflowUnlockedStage:2,outlineConfirmed:false,outlineText:'第一章 既有研究结构',outlineRows:[{id:'c1',level:1,title:'第一章 既有研究结构',words:8000}],bodySections:[{id:'c1',title:'第一章 既有研究结构',text:'既有正文必须保留。'}],knowledgeFiles:[{id:'file-source',name:'已保存研究资料',kind:'file',text:thesisResearchText}],writingReferences:[{...thesisReference}]};
  localStorage.setItem('paperknow-drafts',JSON.stringify([row]));mountWriting(row.id,undefined,f.ctx);assert.equal(f.$('.dashboard').dataset.writingStage,'2');f.input('#outline-source-input','第一章 隐藏按钮不能采用的结构');
  for(const selector of ['#outline-edit','#writing-version-back','#body-finish','#outline-template-create','#outline-paste-apply']){assert.ok(f.$(selector),selector);f.$(selector).click();assert.equal(f.$('.dashboard').dataset.writingStage,'2',selector+' must not skip confirmation');assert.equal(f.$('#writing-outline-area').hidden,true);assert.equal(f.$('#writing-body-area').hidden,true);}
  f.$('#writing-save').click();const saved=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.equal(saved.workflowStage,2);assert.equal(saved.workflowUnlockedStage,2);assert.equal(saved.outlineText,row.outlineText);assert.deepEqual(saved.outlineRows,row.outlineRows);assert.deepEqual(saved.bodySections,row.bodySections);
 }finally{f.close();}
});
