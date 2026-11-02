import {applyThesisOutline,thesisResearchText,thesisReference,confirmThesisMaterials,confirmThesisReferences,selectThesisReference,confirmThesisResearch} from './helpers/thesis-flow.mjs';
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
   const count=f.scrolls.length;if(selector==='#writing-material-confirm')confirmThesisMaterials();else if(selector==='#writing-reference-confirm')await confirmThesisReferences();else f.$(selector).click();await settle();
   assert.equal(f.scrolls.length,count,'a stage change never scrolls');
   assert.equal(f.$('.creation-grid'),shell,'the content shell stays mounted');
   assert.equal(document.activeElement,retainedFocus);
   assert.equal(f.focuses.length,focusCount,'step changes never force focus');
  }
  assert.equal(f.$('.dashboard').dataset.writingStage,'4');
  assert.equal(f.$('#outline-paper .outline-row-title'),null,'confirming research does not silently invent an outline');
  applyThesisOutline();
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
  f.$('#writing-generate').click();await settle();confirmThesisMaterials();await settle();await confirmThesisReferences();await settle();
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
  f.$('#writing-generate').click();await settle();confirmThesisMaterials();await settle();await confirmThesisReferences();await settle();
  applyThesisOutline();const field=f.$('#outline-paper .outline-row-title');field.focus();const stageScrolls=f.scrolls.length;
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
  f.$('#writing-generate').click();confirmThesisMaterials();await confirmThesisReferences();
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
   if(stage==='3')f.input('#knowledge-ai-input',thesisResearchText);if(stage==='4')await selectThesisReference();f.$('#writing-process-next').click();await settle();
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


test('optional materials advance normally while required references and outline confirmation cannot be bypassed',async()=>{
 const f=fixture();let requests=0;f.ctx.api=async()=>{requests++;throw Error('Unconfirmed steps must not submit online work');};
 try{
  mountWriting(undefined,undefined,f.ctx);f.$('[data-writing-step="5"]').click();f.$('#outline-confirm').click();assert.equal(f.$('.dashboard').dataset.writingStage,'1');
  f.input('#writing-title','逐步确认的研究');f.$('#writing-generate').click();assert.equal(f.$('.dashboard').dataset.writingStage,'2');
  f.input('#knowledge-ai-input','简短的补充说明');f.$('#writing-material-confirm').click();assert.equal(f.$('.dashboard').dataset.writingStage,'3');assert.equal(f.$('#writing-step-error').hidden,true);
  for(const step of ['4','5']){f.$('[data-writing-step="'+step+'"]').click();assert.equal(f.$('.dashboard').dataset.writingStage,'3');}
  f.$('#writing-reference-confirm').click();assert.equal(f.$('.dashboard').dataset.writingStage,'3');assert.match(f.$('#writing-reference-status').textContent,/至少.*1.*参考文献/);f.$('#outline-confirm').click();assert.equal(f.$('.dashboard').dataset.writingStage,'3');assert.equal(requests,0);
  await confirmThesisReferences();assert.equal(f.$('.dashboard').dataset.writingStage,'4');f.$('[data-writing-step="5"]').click();assert.equal(f.$('.dashboard').dataset.writingStage,'4','a selected reference cannot bypass outline confirmation');
  applyThesisOutline();f.$('#outline-confirm').click();await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'5');assert.equal(requests,0);
 }finally{f.close();}
});

test('restoring an otherwise confirmed thesis keeps the final stage even with no substantive optional materials',async()=>{
 const f=fixture();try{
  const row={id:'legacy-optional-material',tool:'writing',title:'恢复未上传资料的研究',degree:'本科',language:'中文',targetWords:8000,workflowStage:5,workflowUnlockedStage:5,outlineConfirmed:true,outlineText:'第一章 已有提纲',outlineRows:[{id:'c1',level:1,title:'第一章 已有提纲',words:8000}],bodySections:[{id:'c1',title:'第一章 已有提纲',text:'之前手动撰写并保存的正文。'}],knowledgeFiles:[{id:'short-optional',name:'旧版补充说明',text:'1',kind:'file'}],writingReferences:[{...thesisReference}],methodSuggestion:{text:thesisResearchText,jobId:'proposed-plan'}};
  localStorage.setItem('paperknow-drafts',JSON.stringify([row]));mountWriting(row.id,undefined,f.ctx);await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'5');assert.equal(f.$('#writing-step-error').hidden,true);assert.match(f.$('#thesis-online-stage').textContent,/登录后保存到账户/);
  f.$('#writing-save').click();const saved=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.deepEqual(saved.bodySections,row.bodySections);assert.deepEqual(saved.outlineRows,row.outlineRows);assert.deepEqual(saved.methodSuggestion,row.methodSuggestion);assert.equal(saved.workflowStage,5);assert.equal(saved.outlineConfirmed,true);
 }finally{f.close();}
});

for(const action of ['#writing-material-confirm','#writing-material-skip'])test('empty optional research materials can advance through '+action+' without creating evidence or submitting a paid job',async()=>{
 const f=fixture();let requests=0;f.ctx.api=async()=>{requests++;throw Error('Optional knowledge navigation must not create an AI job');};
 try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','未上传研究资料的论文');f.$('#writing-generate').click();await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'2');assert.equal(f.$('#knowledge-ai-input').value,'');assert.equal(f.$('#writing-material-skip').hidden,false);
  const focus=f.$('#writing-process-next');focus.focus();const focusCount=f.focuses.length,scrollCount=f.scrolls.length;f.$(action).click();await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'3');assert.equal(f.scrolls.length,scrollCount);assert.equal(f.focuses.length,focusCount);assert.equal(document.activeElement,focus);
  f.$('#writing-save').click();const row=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.deepEqual(row.knowledgeFiles,[]);assert.equal(row.workflowStage,3);assert.equal(row.material,'');assert.equal(requests,0);
  f.$('#writing-reference-confirm').click();assert.equal(f.$('.dashboard').dataset.writingStage,'3');assert.match(f.$('#writing-reference-status').textContent,/参考文献/);
 }finally{f.close();}
});

test('skipping optional research materials preserves a short manual explanation rather than deleting it',async()=>{
 const f=fixture();try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','保留可选研究说明');f.$('#writing-generate').click();f.input('#knowledge-ai-input','只分析公开文献，不开展问卷调查。');f.$('#writing-material-skip').click();await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'3');
  f.$('#writing-save').click();const row=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.equal(row.knowledgeFiles.length,1);assert.equal(row.knowledgeFiles[0].text,'只分析公开文献，不开展问卷调查。');assert.equal(f.$('#knowledge-ai-input').value,'只分析公开文献，不开展问卷调查。');
 }finally{f.close();}
});

test('an adopted AI method can continue from optional knowledge while remaining a proposed plan instead of evidence',async()=>{
 const f=fixture();try{
  const method='拟开展：先检索公开文献，再比较已披露的研究方法，不编造调查或实验结果。',block='【研究方法建议（拟开展，AI 生成）】\n'+method+'\n【研究方法建议结束】',row={id:'optional-method-only',tool:'writing',title:'仅采用方法建议的论文',degree:'本科',language:'中文',targetWords:8000,workflowStage:2,workflowUnlockedStage:2,knowledgeFiles:[],methodSuggestion:{text:method,jobId:'method-confirmed',inSupplement:true},writingEditorState:{inputs:{'knowledge-ai-input':block}}};
  localStorage.setItem('paperknow-drafts',JSON.stringify([row]));mountWriting(row.id,undefined,f.ctx);assert.equal(f.$('#knowledge-ai-input').value,block);f.$('#writing-material-confirm').click();await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'3');
  f.$('#writing-save').click();const saved=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.deepEqual(saved.knowledgeFiles,[]);assert.equal(saved.methodSuggestion.text,method);assert.equal(saved.methodSuggestion.inSupplement,true);assert.equal(saved.writingEditorState.inputs['knowledge-ai-input'],block);
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
  assert.equal(f.$('#outline-template-create'),null,'the generic-outline action is no longer offered');
  for(const selector of ['#outline-edit','#writing-version-back','#body-finish','#outline-paste-apply']){assert.ok(f.$(selector),selector);f.$(selector).click();assert.equal(f.$('.dashboard').dataset.writingStage,'2',selector+' must not skip confirmation');assert.equal(f.$('#writing-outline-area').hidden,true);assert.equal(f.$('#writing-body-area').hidden,true);}
  f.$('#writing-save').click();const saved=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.equal(saved.workflowStage,2);assert.equal(saved.workflowUnlockedStage,2);assert.equal(saved.outlineText,row.outlineText);assert.deepEqual(saved.outlineRows,row.outlineRows);assert.deepEqual(saved.bodySections,row.bodySections);
 }finally{f.close();}
});

for(const initialY of [4000,400])test(`confirming a long outline ${initialY>1000?'reveals the next step above the old viewport':'keeps an already visible next step in place'} without losing its outline`,async()=>{
 const f=fixture(),calls=[],scrolls=[],position={y:initialY};
 try{
  f.ctx.session=async()=>({status:'ready',user:{id:'transition-fixture'}});
  f.ctx.api=async(path,data)=>{calls.push({path,data});if(path==='/auth/me')return {user:{id:'transition-fixture'}};if(path==='/capabilities')return {thesis:{ready:false}};if(path.startsWith('/theses/by-key/'))throw Object.assign(Error('not found'),{status:404});if(path==='/theses'&&data)return {item:{id:'transition-paper',version:1,title:data.snapshot.title,profile:data.snapshot.profile,snapshot:data.snapshot,outline:data.snapshot.outline,status:'draft',job:null,chapters:data.snapshot.outline.map(row=>({id:row.id,title:row.title,version:0,status:'pending',text:'',sourceIds:[]}))}};throw Error('Unexpected request '+path);};
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','长提纲切换合成验收');f.$('#writing-generate').click();await confirmThesisResearch();applyThesisOutline();
  f.$('#writing-save').click();const before=JSON.parse(localStorage.getItem('paperknow-drafts'))[0],root=f.$('.dashboard'),heading=f.$('.preview-heading'),win=f.dom.window;
  Object.defineProperties(win,{scrollY:{configurable:true,get:()=>position.y},scrollX:{configurable:true,get:()=>0},innerHeight:{configurable:true,value:800}});
  win.scrollTo=options=>{scrolls.push(options);position.y=options.top??position.y;};
  root.getBoundingClientRect=()=>({top:80-position.y,bottom:5280-position.y,height:5200,left:0,right:1000,width:1000});
  heading.getBoundingClientRect=()=>({top:600-position.y,bottom:640-position.y,height:40,left:0,right:1000,width:1000});
  const focus=document.activeElement;f.$('#outline-confirm').click();await settle();await settle();
  assert.equal(root.dataset.writingStage,'5');assert.equal(f.$('[data-thesis-create]'),null);assert.ok(f.$('[data-thesis-quote]'),'the generation action is directly rendered');assert.equal(f.$('[data-thesis-view-key="information-overview"]').open,false);assert.equal(f.$('#thesis-online-stage').hidden,false);
  const rect=heading.getBoundingClientRect();assert.ok(rect.bottom>0&&rect.top<win.innerHeight,'the next step must be within the viewport instead of above a blank reserved area');
  if(initialY<1000){assert.equal(position.y,initialY);assert.equal(scrolls.length,0,'an already visible next step must not jump');}else{assert.ok(position.y<initialY);assert.ok(scrolls.every(row=>row.behavior==='instant'),'no animated intermediate page jumps');}
  assert.equal(document.activeElement,focus,'revealing the next step does not move focus');
  f.$('#writing-final-save').click();const after=JSON.parse(localStorage.getItem('paperknow-drafts'))[0];assert.deepEqual(after.outlineText.split('\n').map(line=>line.trim()),before.outlineText.split('\n').map(line=>line.trim()));assert.deepEqual(after.outlineRows,before.outlineRows);assert.equal(after.outlineConfirmed,true);assert.equal(after.workflowStage,5);
  assert.equal(calls.filter(row=>row.path==='/theses'&&row.data).length,1,'confirming automatically saves the account record once');assert.ok(calls.every(row=>!/quote|generate/.test(row.path)),'confirming does not bill or generate');assert.equal(after.thesisId,'transition-paper');assert.ok(after.thesisCreateKey);
 }finally{f.close();}
});
