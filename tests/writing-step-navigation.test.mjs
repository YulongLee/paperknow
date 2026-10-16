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

test('five-step transitions focus the visible heading and reuse one content anchor without scrolling the outline',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);
  assert.equal(f.scrolls.length,0,'mounting does not move the user');
  f.input('#writing-title','真实研究步骤定位');f.input('#writing-method','文献分析');f.input('#writing-material','用户提供的真实研究资料');
  const shell=f.$('.creation-grid');
  for(const [selector,heading] of [['#writing-generate','#writing-material-review h2'],['#writing-material-confirm','#writing-reference-review h2'],['#writing-reference-confirm','.preview-heading h2']]){
   const count=f.scrolls.length;f.$(selector).click();await settle();
   assert.equal(f.scrolls.length,count+1,'a stage change scrolls once');
   assert.equal(f.scrolls.at(-1).element,shell);
   assert.deepEqual(f.scrolls.at(-1).options,{block:'start',inline:'nearest',behavior:'instant'});
   assert.equal(document.activeElement,f.$(heading));
   assert.equal(f.focuses.at(-1).options.preventScroll,true);
   assert.equal(document.activeElement.closest('[hidden]'),null);
  }
  assert.equal(f.$('.dashboard').dataset.writingStage,'4');
  assert.equal(f.$('#outline-paper .outline-row-title')!==null,true);
  assert.equal(f.scrolls.some(call=>call.element.id==='outline-paper'),false);
  assert.equal(f.$('#writing-title').value,'真实研究步骤定位');
  assert.match(f.$('#writing-material').value,/真实研究资料/);
  f.$('[data-writing-step="3"]').click();await settle();
  f.$('[data-writing-step="4"]').click();await settle();
  assert.equal(f.scrolls.at(-1).element,shell,'step navigation uses the same anchor as confirmation');
  assert.equal(document.activeElement,f.$('.preview-heading h2'));
  const beforeFinal=f.scrolls.length;f.$('#outline-confirm').click();await settle();
  assert.equal(f.$('.dashboard').dataset.writingStage,'5');
  assert.equal(f.scrolls.length,beforeFinal+1);
  assert.equal(f.scrolls.at(-1).element,shell);
  assert.equal(document.activeElement,f.$('.preview-heading h2'));
  assert.match(f.$('#thesis-online-stage').textContent,/登录后保存到账户/);
  f.$('[data-writing-step="1"]').click();await settle();
  assert.equal(document.activeElement,f.$('.creation-input>h2'));
  assert.equal(f.scrolls.at(-1).element,shell);
 }finally{f.close();}
});

test('completed steps use one real check in the original number slot and reset cleanly when returning',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','状态检查');
  f.$('#writing-generate').click();await settle();f.$('#writing-material-confirm').click();await settle();f.$('#writing-reference-confirm').click();await settle();
  const steps=[...document.querySelectorAll('[data-writing-step]')];
  assert.equal(steps.length,5);
  assert.deepEqual(steps.map(step=>step.querySelector('.writing-detail-step-number').textContent),['✓','✓','✓','04','05']);
  assert.deepEqual(steps.map(step=>step.querySelector('.writing-detail-step-state').textContent),['已完成','已完成','已完成','正在进行','待进行']);
  assert.equal(steps.filter(step=>step.classList.contains('is-complete')).length,3);
  assert.equal(steps.filter(step=>step.getAttribute('aria-current')==='step').length,1);
  assert.equal(steps[3].getAttribute('aria-current'),'step');
  assert.ok(steps.every(step=>step.querySelectorAll('.writing-detail-step-number').length===1));
  assert.ok(steps.every(step=>step.querySelector('.writing-detail-step-number').getAttribute('aria-hidden')==='true'));
  steps[1].click();await settle();
  assert.deepEqual(steps.map(step=>step.querySelector('.writing-detail-step-number').textContent),['✓','02','03','04','05']);
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
  f.$('#writing-generate').click();await settle();f.$('#writing-material-confirm').click();await settle();f.$('#writing-reference-confirm').click();await settle();
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

test('rapid step changes discard stale focus and scroll work',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','快速切换步骤');
  f.$('#writing-generate').click();f.$('#writing-material-confirm').click();f.$('#writing-reference-confirm').click();
  await settle();
  assert.equal(f.scrolls.length,1);
  assert.equal(f.$('.dashboard').dataset.writingStage,'4');
  assert.equal(document.activeElement,f.$('.preview-heading h2'));
  assert.equal(document.activeElement.closest('[hidden]'),null);
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
