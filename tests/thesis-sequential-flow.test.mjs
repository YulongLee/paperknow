import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(){
 const dom=new JSDOM('<div id="app"><aside class="sidebar"></aside><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main></div><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.cn/workspace.html#tool/writing'});
 for(const name of ['window','document','localStorage','FormData','location','AbortController'])globalThis[name]=dom.window[name];
 const scrolls=[],calls=[];
 dom.window.HTMLElement.prototype.scrollIntoView=function(){scrolls.push(this);};
 dom.window.confirm=()=>{throw Error('Moving between writing steps must not prompt');};
 const $=selector=>document.querySelector(selector);
 const ctx={notify(){},session:async()=>({status:'guest',user:null}),api:async(path,data)=>{calls.push({path,data});throw Error('Unexpected request '+path);}};
 return {dom,$,ctx,scrolls,calls,input(selector,value){const field=$(selector);field.value=value;field.dispatchEvent(new window.Event('input',{bubbles:true}));},stage(){return Number($('.dashboard').dataset.writingStage);},save(){assert.equal(flushEditorDraft(),true);return JSON.parse(localStorage.getItem('paperknow-drafts'))[0];},close(){clearEditor();dom.window.close();}};
}
const bootstrap=fixture();
const {mountWriting}=await import('../dist/workspace/writing.mjs');
const {clearEditor,flushEditorDraft}=await import('../dist/workspace/edit-guard.mjs');
bootstrap.close();

const panels=['.creation-input','#writing-material-review','#writing-reference-review','#writing-outline-area','#thesis-online-stage'];
function visiblePanels(f){return panels.map((selector,index)=>({node:f.$(selector),stage:index+1})).filter(({node})=>node&&!node.closest('[hidden]')).map(({stage})=>stage);}
function assertOnlyStage(f,stage){
 assert.equal(f.stage(),stage);assert.deepEqual(visiblePanels(f),[stage],`only the content for step ${stage} is exposed`);
 for(const [index,selector] of panels.entries()){const node=f.$(selector);if(index+1!==stage)assert.ok(node.closest('[hidden]'),'future and previous forms are actually hidden');}
}
async function advanceToOutline(f){
 f.input('#writing-title','人工智能支持教学反馈的研究');
 for(const stage of [2,3,4]){f.$('#writing-process-next').click();await settle();assertOnlyStage(f,stage);}
}

test('a new thesis exposes one form and cannot jump ahead by pointer or keyboard',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);assertOnlyStage(f,1);
  for(const stage of [2,3,4,5]){
   const step=f.$(`[data-writing-step="${stage}"]`);
   assert.equal(step.getAttribute('role'),'button');assert.equal(step.getAttribute('aria-disabled'),'true');
   step.click();await settle();assertOnlyStage(f,1);
   for(const key of ['Enter',' ']){step.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await settle();assertOnlyStage(f,1);}
  }
  assert.deepEqual(f.calls,[]);assert.equal(f.scrolls.length,0);
 }finally{f.close();}
});

test('submitting the first form validates it and advances to knowledge instead of skipping directly to references',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);
  f.$('#writing-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle();assertOnlyStage(f,1);
  f.input('#writing-title','毕业论文逐步填写');f.input('#writing-target','0');
  f.$('#writing-process-next').click();await settle();assertOnlyStage(f,1);
  f.input('#writing-target','8000');
  f.$('#writing-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await settle();assertOnlyStage(f,2);
  assert.equal(f.save().workflowUnlockedStage,2);assert.deepEqual(f.calls,[]);
 }finally{f.close();}
});

test('the persistent next control completes all five steps without generating or charging',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);const shell=f.$('.creation-grid');
  await advanceToOutline(f);
  const next=f.$('#writing-process-next');assert.equal(next.disabled,false,'outline confirmation remains reachable in the same control');
  next.click();await settle();assertOnlyStage(f,5);
  const saved=f.save();assert.equal(saved.workflowStage,5);assert.equal(saved.workflowUnlockedStage,5);assert.equal(saved.outlineConfirmed,true);assert.ok(saved.outlineRows.length>0);
  assert.match(f.$('#thesis-online-stage').textContent,/登录后保存到账户/);assert.ok(f.$('[data-thesis-manual]'),'manual writing still has an entry');
  assert.equal(f.$('.creation-grid'),shell);assert.equal(f.scrolls.length,0);assert.deepEqual(f.calls,[],'navigation is not consent to an account write, model call or payment');
 }finally{f.close();}
});

test('optional knowledge can be skipped while its unconfirmed editor text remains a recoverable draft',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','可选补充步骤验收');f.$('#writing-process-next').click();await settle();
  f.input('#knowledge-ai-input','尚未确认的研究想法');f.$('#writing-material-skip').click();await settle();assertOnlyStage(f,3);
  const saved=f.save();assert.equal(saved.workflowUnlockedStage,3);assert.equal(saved.knowledgeFiles.length,0);assert.equal(saved.writingEditorState.inputs['knowledge-ai-input'],'尚未确认的研究想法');
  f.$('[data-writing-step="2"]').click();await settle();assertOnlyStage(f,2);assert.equal(f.$('#knowledge-ai-input').value,'尚未确认的研究想法');
 }finally{f.close();}
});

function completedDraft(overrides={}){return {id:'saved-thesis',tool:'writing',title:'已有论文内容恢复',writingResume:true,workflowStage:5,workflowUnlockedStage:5,targetWords:8000,outlineConfirmed:true,outlineSource:'pasted',outlineText:'第一章 已确认的研究结构\n1.1 已有资料与方法',outlineRows:[{id:'chapter',title:'第一章 已确认的研究结构',level:1,words:0},{id:'section',title:'1.1 已有资料与方法',level:2,words:8000}],bodySections:[{id:'chapter',title:'第一章 已确认的研究结构',text:'用户已经撰写的真实正文。'}],writingReferences:[{id:'ref',title:'用户核对的参考文献',authors:'研究者',year:'2025',confirmed:true}],knowledgeFiles:[{id:'material',name:'研究记录',purpose:'研究资料',text:'用户原始研究记录。',kind:'file',state:'parsed'}],methodSuggestion:{jobId:'method-job',text:'拟开展的分析方案，不代表已经完成实验。'},...overrides};}

test('returning to earlier confirmed steps preserves references, outline, allocation and existing body',async()=>{
 const f=fixture();
 try{
  const original=completedDraft();localStorage.setItem('paperknow-drafts',JSON.stringify([original]));mountWriting(original.id,undefined,f.ctx);await settle();assertOnlyStage(f,5);
  for(const [stage,selector] of [[4,'#writing-final-back'],[3,'#writing-outline-back'],[2,'#writing-reference-back'],[1,'#writing-material-back']]){assert.ok(f.$(selector),'every later step has an explicit back control');f.$(selector).click();await settle();assertOnlyStage(f,stage);}
  let saved=f.save();assert.equal(saved.workflowUnlockedStage,5);assert.equal(saved.outlineConfirmed,true);assert.deepEqual(saved.outlineRows,original.outlineRows);assert.deepEqual(saved.bodySections,original.bodySections);assert.deepEqual(saved.writingReferences,original.writingReferences);assert.deepEqual(saved.methodSuggestion,original.methodSuggestion);
  f.$('[data-writing-step="4"]').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await settle();assertOnlyStage(f,4);
  assert.equal(f.$('#outline-paper .outline-row-title').value,original.outlineRows[0].title);
  f.$('#writing-process-next').click();await settle();assertOnlyStage(f,5);saved=f.save();assert.deepEqual(saved.bodySections,original.bodySections);
  assert.deepEqual(f.calls,[]);assert.equal(f.scrolls.length,0);
 }finally{f.close();}
});

test('saved step and previously unlocked steps restore independently without moving the user forward',async()=>{
 const f=fixture();
 try{
  const original=completedDraft({workflowStage:2});localStorage.setItem('paperknow-drafts',JSON.stringify([original]));mountWriting(original.id,undefined,f.ctx);await settle();assertOnlyStage(f,2);
  assert.equal(f.$('[data-writing-step="4"]').getAttribute('aria-disabled'),'false');const saved=f.save();assert.equal(saved.workflowStage,2);assert.equal(saved.workflowUnlockedStage,5);
  clearEditor();mountWriting(saved.id,undefined,f.ctx);await settle();assertOnlyStage(f,2);f.$('[data-writing-step="4"]').click();await settle();assertOnlyStage(f,4);
  assert.equal(f.$('#outline-paper .outline-row-title').value,original.outlineRows[0].title);assert.equal(f.save().outlineConfirmed,true);
 }finally{f.close();}
});

test('editing an already confirmed outline requires confirmation again and preserves existing body text',async()=>{
 const f=fixture();
 try{
  const original=completedDraft({workflowStage:4});localStorage.setItem('paperknow-drafts',JSON.stringify([original]));mountWriting(original.id,undefined,f.ctx);await settle();assertOnlyStage(f,4);
  f.input('#outline-paper .outline-row-title','第一章 用户修改后的研究结构');await settle();
  const saved=f.save();assert.equal(saved.outlineConfirmed,false);assert.equal(saved.workflowUnlockedStage,4);assert.deepEqual(saved.bodySections,original.bodySections);
  const finalStep=f.$('[data-writing-step="5"]');assert.equal(finalStep.getAttribute('aria-disabled'),'true');finalStep.click();await settle();assertOnlyStage(f,4);
  f.$('#writing-process-next').click();await settle();assertOnlyStage(f,5);assert.equal(f.save().outlineConfirmed,true);assert.ok(f.save().bodySections.some(row=>row.text==='用户已经撰写的真实正文。'),'an edited chapter title never deletes preexisting body');
 }finally{f.close();}
});

test('changing a confirmed target word count reallocates the outline and locks final generation until reconfirmed',async()=>{
 const f=fixture();
 try{
  const original=completedDraft({workflowStage:1});localStorage.setItem('paperknow-drafts',JSON.stringify([original]));mountWriting(original.id,undefined,f.ctx);await settle();assertOnlyStage(f,1);
  f.input('#writing-target','10000');f.$('#writing-target').dispatchEvent(new window.Event('change',{bubbles:true}));await settle();assertOnlyStage(f,1);
  let saved=f.save();assert.equal(saved.outlineConfirmed,false);assert.equal(saved.workflowUnlockedStage,4);assert.equal(Number(saved.targetWords),10000);assert.equal(saved.outlineRows.find(row=>row.id==='section').words,10000);assert.deepEqual(saved.bodySections,original.bodySections);
  const finalStep=f.$('[data-writing-step="5"]');assert.equal(finalStep.getAttribute('aria-disabled'),'true');finalStep.click();await settle();assertOnlyStage(f,1);
  f.$('[data-writing-step="4"]').click();await settle();assertOnlyStage(f,4);f.$('#writing-process-next').click();await settle();assertOnlyStage(f,5);
  saved=f.save();assert.equal(saved.workflowUnlockedStage,5);assert.equal(saved.outlineConfirmed,true);assert.deepEqual(saved.bodySections,original.bodySections);assert.deepEqual(f.calls,[]);
 }finally{f.close();}
});

test('continuing after a target input without a change event still synchronizes the requested word budget',async()=>{
 const f=fixture();
 try{
  const original=completedDraft({workflowStage:1});localStorage.setItem('paperknow-drafts',JSON.stringify([original]));mountWriting(original.id,undefined,f.ctx);await settle();
  f.input('#writing-target','12000');f.$('#writing-process-next').click();await settle();assertOnlyStage(f,2);
  const saved=f.save();assert.equal(Number(saved.targetWords),12000);assert.equal(saved.outlineRows.find(row=>row.id==='section').words,12000);assert.equal(saved.outlineAllocationTarget,12000);assert.equal(saved.outlineConfirmed,false);assert.equal(saved.workflowUnlockedStage,4);assert.deepEqual(saved.bodySections,original.bodySections);assert.deepEqual(f.calls,[]);
 }finally{f.close();}
});

test('changing a method proposal or removing confirmed research material locks final generation while preserving the manuscript',async()=>{
 for(const action of ['method','remove']){
  const f=fixture();
  try{
   const original=completedDraft({workflowStage:2});localStorage.setItem('paperknow-drafts',JSON.stringify([original]));mountWriting(original.id,undefined,f.ctx);await settle();assertOnlyStage(f,2);
   if(action==='method')f.input('#knowledge-method-input','更新后的拟开展方法，尚待真实研究验证。');else f.$('[data-knowledge-action="remove"][data-knowledge-id="material"]').click();
   await settle();const saved=f.save();assert.equal(saved.outlineConfirmed,false);assert.equal(saved.workflowUnlockedStage,4);assert.deepEqual(saved.bodySections,original.bodySections);assert.deepEqual(saved.outlineRows,original.outlineRows);
   if(action==='method')assert.equal(saved.methodSuggestion.text,'更新后的拟开展方法，尚待真实研究验证。');else assert.deepEqual(saved.knowledgeFiles,[]);
   assert.equal(f.$('[data-writing-step="5"]').getAttribute('aria-disabled'),'true');f.$('[data-writing-step="5"]').click();await settle();assertOnlyStage(f,2);assert.deepEqual(f.calls,[]);
  }finally{f.close();}
 }
});

test('deselecting a previously confirmed reference requires reconfirming the outline without losing written chapters',async()=>{
 const f=fixture();
 try{
  const original=completedDraft({workflowStage:3});localStorage.setItem('paperknow-drafts',JSON.stringify([original]));mountWriting(original.id,undefined,f.ctx);await settle();assertOnlyStage(f,3);
  const reference=f.$('[data-reference-id="ref"]');assert.equal(reference.getAttribute('aria-pressed'),'true');reference.click();await settle();
  const saved=f.save();assert.deepEqual(saved.writingReferences,[]);assert.equal(saved.outlineConfirmed,false);assert.equal(saved.workflowUnlockedStage,4);assert.deepEqual(saved.bodySections,original.bodySections);assert.deepEqual(saved.outlineRows,original.outlineRows);
  assert.equal(f.$('[data-writing-step="5"]').getAttribute('aria-disabled'),'true');f.$('[data-writing-step="5"]').click();await settle();assertOnlyStage(f,3);assert.deepEqual(f.calls,[]);
 }finally{f.close();}
});

test('legacy drafts without an unlocked-stage field retain their saved place and can continue sequentially',async()=>{
 const f=fixture();
 try{
  const original=completedDraft({workflowStage:3,outlineConfirmed:false});delete original.workflowUnlockedStage;
  localStorage.setItem('paperknow-drafts',JSON.stringify([original]));mountWriting(original.id,undefined,f.ctx);await settle();assertOnlyStage(f,3);
  assert.equal(f.$('[data-writing-step="2"]').getAttribute('aria-disabled'),'false');assert.equal(f.$('[data-writing-step="4"]').getAttribute('aria-disabled'),'true');
  f.$('#writing-process-next').click();await settle();assertOnlyStage(f,4);assert.equal(f.save().workflowUnlockedStage,4);assert.deepEqual(f.save().bodySections,original.bodySections);
 }finally{f.close();}
});
