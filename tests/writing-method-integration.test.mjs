import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

function setup(){const dom=new JSDOM('<aside class="sidebar"></aside><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'http://localhost/workspace.html#tool/writing'});for(const k of ['window','document','localStorage','FormData','location','AbortController'])globalThis[k]=dom.window[k];dom.window.HTMLElement.prototype.scrollIntoView=()=>{};document.querySelector('dialog').close=()=>{};return {dom,ctx:{notify:()=>{},modal:(_,html)=>document.querySelector('#workspace-dialog-body').innerHTML=html}};}
setup();
const {mountWriting}=await import('../dist/workspace/writing.mjs');
const {thesisSnapshotFromDraft}=await import('../dist/workspace/writing-model.mjs');
const {assessThesisEvidence}=await import('../dist/workspace/thesis-evidence.mjs');
const {clearEditor,flushEditorDraft}=await import('../dist/workspace/edit-guard.mjs');
const {beginDraftScope,endDraftScope,list,keys}=await import('../dist/workspace/state.mjs');
const $=selector=>document.querySelector(selector);
const input=(selector,value)=>{$(selector).value=value;$(selector).dispatchEvent(new window.Event('input',{bubbles:true}));};
const settle=async()=>{for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));};
const methodBlock=text=>`【研究方法建议（拟开展，AI 生成）】\n${text}\n【研究方法建议结束】`;
const methodBlockCount=text=>(text.match(/【研究方法建议（拟开展，AI 生成）】/g)||[]).length;
const planSnapshot=row=>thesisSnapshotFromDraft({...row,outlineRows:[{id:"confirmed-chapter",title:"研究方法",level:1,words:8000}]});
const completed={id:'method-integration-1',status:'completed',stage:'completed',userId:'method-user',model:'configured-model',output:{text:'拟开展：结合研究题目，先进行文献分析，再选择案例比较；需补充真实资料并与导师确认。'}};
function fixture(t,{stored,queued=false}={}){const f=setup(),calls=[];if(stored)localStorage.setItem('paperknow-drafts',JSON.stringify([stored]));f.dom.window.confirm=()=>true;f.ctx.session=async()=>({status:'ready',user:{id:'method-user'}});f.ctx.api=async(path,data)=>{calls.push({path,data});if(path==='/auth/me')return {user:{id:'method-user'}};if(path==='/theses/methods/capabilities'||path==='/theses/outlines/capabilities')return {ready:true,billingService:'agent'};if(path==='/billing/quote')return {type:'agent',source:'credits',title:'研究建议',token:'test-quote',creditCost:10,expiresAt:new Date(Date.now()+300000).toISOString()};if(path==='/theses/methods'||path==='/theses/methods/'+completed.id)return {item:queued?{...completed,status:'queued',stage:'queued',output:undefined}:completed};if(path==='/theses/outlines')return {item:{id:'outline-integration-1',status:'queued',stage:'queued',userId:'method-user'}};throw Error('Unexpected '+path);};t.after(()=>{clearEditor();endDraftScope();f.dom.window.close();});return {...f,calls,saved:()=>JSON.parse(localStorage.getItem('paperknow-drafts')||'[]')[0],mount:()=>{mountWriting(undefined,undefined,f.ctx);if(!stored){input('#writing-title','数字化学习反馈机制研究');$('#writing-generate').click();}},async open(){ $('#knowledge-method-generate').click();await settle();},async generate(){await this.open();},async apply(){ $('[data-method-ai-apply]').click();await settle();}};}

test('AI method button directly generates with a blank supplement while preserving manual input',async t=>{const f=fixture(t);f.mount();assert.equal($('#knowledge-ai-input').value,'');await f.open();assert.equal($('[data-method-ai-consent]'),null);assert.equal($('[data-method-ai-start]'),null);assert.equal(f.calls.filter(c=>c.path==='/theses/methods').length,1);$('[data-method-ai-close]').click();input('#knowledge-ai-input','老师要求分析真实案例，尚未确定具体研究方法。');await f.open();assert.equal($('#knowledge-ai-input').value,'老师要求分析真实案例，尚未确定具体研究方法。');assert.equal(f.calls.filter(c=>c.path==='/theses/methods').length,1,'reopening an unapplied preview only reads the saved result');});

test('adopted AI method fills the supplement without replacing user evidence or promoting the proposed plan',async t=>{const f=fixture(t);f.mount();input('#knowledge-ai-input','本人的真实研究背景');$('#knowledge-ai-generate').click();await f.generate();assert.equal(f.saved().methodSuggestion,null);assert.equal($('#knowledge-method-draft').hidden,true);await f.apply();const row=f.saved(),snapshot=planSnapshot(row);assert.equal($('#writing-method-ai-panel').hidden,true);assert.equal($('#knowledge-method-input').value,completed.output.text);assert.equal(row.methodJobId,null);assert.equal(row.methodCommandKey,null);assert.equal(row.methodPreview,null);assert.equal(snapshot.requirements.researchPlan.origin,'ai');assert.equal(snapshot.requirements.researchPlan.status,'proposed');assert.equal(snapshot.requirements.researchPlan.text,completed.output.text);assert.equal(snapshot.materials.length,1);assert.equal(snapshot.materials[0].text,'本人的真实研究背景');assert.ok(snapshot.materials.every(material=>!material.text.includes(completed.output.text)));assert.equal($('#knowledge-ai-input').value,'本人的真实研究背景\n\n'+methodBlock(completed.output.text));assert.equal(methodBlockCount($('#knowledge-ai-input').value),1);});

test('editing the adopted method inside the supplement persists and reopens exactly once without another generation',async t=>{
 const f=fixture(t);f.mount();input('#knowledge-ai-input','用户保留的研究背景');$('#knowledge-ai-generate').click();await f.generate();await f.apply();
 const edited='拟开展：改为文献分析；访谈仅在满足实际条件后开展。',supplement='用户保留的研究背景\n\n'+methodBlock(edited);
 input('#knowledge-ai-input',supplement);assert.equal(flushEditorDraft(),true);clearEditor();mountWriting(undefined,undefined,f.ctx);
 assert.equal($('#knowledge-ai-input').value,supplement);assert.equal(methodBlockCount($('#knowledge-ai-input').value),1);assert.equal(f.saved().methodSuggestion.text,edited);
 const snapshot=planSnapshot(f.saved());assert.equal(snapshot.requirements.researchPlan.text,edited);assert.equal(snapshot.materials[0].text,'用户保留的研究背景');assert.equal(f.saved().methodSuggestion.model,undefined);assert.doesNotMatch(JSON.stringify(f.saved().methodSuggestion),/configured-model/);
 assert.equal(f.calls.filter(c=>c.path==='/theses/methods').length,1);assert.equal(f.calls.filter(c=>c.path==='/billing/quote').length,1);
});

test('unapplied editable preview survives refresh and restoration does not quote or submit again',async t=>{const f=fixture(t);f.mount();await f.generate();input('#writing-method-ai-result','用户调整后的拟开展方法，尚未采用。');const saved=f.saved();assert.equal(saved.methodPreview.text,'用户调整后的拟开展方法，尚未采用。');assert.equal(saved.methodSuggestion,null);clearEditor();mountWriting(undefined,undefined,f.ctx);await f.open();assert.equal($('#writing-method-ai-result').value,'用户调整后的拟开展方法，尚未采用。');assert.equal($('#knowledge-method-draft').hidden,true);assert.equal(f.calls.filter(c=>c.path==='/theses/methods').length,1);assert.equal(f.calls.filter(c=>c.path==='/billing/quote').length,1);});

test('removing the method clears only the proposed plan and preserves user explanation and real materials',async t=>{const f=fixture(t);f.mount();input('#knowledge-ai-input','用户真实研究说明');$('#knowledge-ai-generate').click();await f.generate();await f.apply();$('#knowledge-method-remove').click();assert.equal($('#knowledge-method-draft').hidden,true);assert.equal(f.saved().methodSuggestion,null);const snapshot=planSnapshot(f.saved());assert.equal(snapshot.requirements.researchPlan,undefined);assert.equal(snapshot.materials[0].text,'用户真实研究说明');assert.equal($('#knowledge-ai-input').value,'用户真实研究说明');clearEditor();mountWriting(undefined,undefined,f.ctx);assert.equal($('#knowledge-method-draft').hidden,true);assert.equal(f.saved().knowledgeFiles[0].text,'用户真实研究说明');});

test('changing the thesis topic after generation prevents applying a stale method suggestion',async t=>{const f=fixture(t);f.mount();await f.generate();input('#writing-title','另一个完全不同的论文主题');$('[data-method-ai-apply]').click();await settle();assert.equal(f.saved().methodSuggestion,null);assert.equal($('#knowledge-method-draft').hidden,true);assert.match($('#writing-method-ai-panel').textContent,/论文主题或研究资料已变化/);assert.equal(f.calls.filter(c=>c.path==='/theses/methods').length,1);});

test('restored running method job reuses the persisted id and cannot submit a second charged task',async t=>{const f=fixture(t,{queued:true});f.mount();await f.generate();assert.equal(f.saved().methodJobId,completed.id);assert.ok(f.saved().methodCommandKey);clearEditor();mountWriting(undefined,undefined,f.ctx);await f.open();assert.match($('#writing-method-ai-panel').textContent,/正在排队/);assert.equal($('[data-method-ai-start]'),null);assert.equal(f.calls.filter(c=>c.path==='/theses/methods').length,1);assert.equal(f.calls.filter(c=>c.path==='/billing/quote').length,1);assert.equal(f.calls.filter(c=>c.path==='/theses/methods/'+completed.id).length,1);});

test('legacy manual supplements still record and persist freely without contacting AI',async t=>{const f=fixture(t,{stored:{id:'legacy-method-free',tool:'writing',title:'旧研究草稿',writingResume:true,workflowStage:2,method:'已确定的文献分析',knowledgeFiles:[{id:'real',name:'既有资料',text:'已有真实资料正文',kind:'file',state:'confirmed'}]}});f.mount();assert.equal($('#writing-method').value,'已确定的文献分析');input('#knowledge-ai-input','补充的真实研究说明');$('#knowledge-ai-generate').click();assert.equal(flushEditorDraft(),true);assert.equal(f.saved().knowledgeFiles.length,2);assert.equal(f.saved().methodSuggestion,null);assert.equal(f.calls.length,0);assert.equal(f.saved().method,'已确定的文献分析');clearEditor();mountWriting(undefined,undefined,f.ctx);assert.equal($('#knowledge-ai-input').value,'补充的真实研究说明');assert.equal($('#knowledge-method-draft').hidden,true);});

test('account draft method editing remains scoped and never overwrites another local draft',async t=>{const local={id:'local-separate',tool:'writing',title:'独立本地资料',methodSuggestion:{text:'本地方案'}};const f=fixture(t,{stored:local});beginDraftScope({drafts:[{id:'account-draft',tool:'writing',title:'账户草稿',workflowStage:2,methodSuggestion:{text:'账户拟开展方法',jobId:'old-job'}}]});mountWriting('account-draft',undefined,f.ctx);assert.equal($('#knowledge-method-input').value,'账户拟开展方法');input('#knowledge-method-input','账户独立修改的拟开展方法');$('#writing-save').click();assert.equal(list(keys.drafts)[0].methodSuggestion.text,'账户独立修改的拟开展方法');assert.deepEqual(JSON.parse(localStorage.getItem('paperknow-drafts')),[local]);assert.equal(f.calls.length,0);});

test('a scoped method task with no active durable account editor cannot submit a charged job',async t=>{const f=fixture(t);beginDraftScope({drafts:[{id:'orphan-account-scope',tool:'writing',title:'缺少账户保存桥的草稿',workflowStage:2}]});mountWriting('orphan-account-scope',undefined,f.ctx);await f.generate();assert.equal(f.calls.filter(call=>call.path==='/theses/methods').length,0);assert.match($('#writing-method-ai-panel').textContent,/任务标识未能保存/);assert.equal(list(keys.drafts)[0].methodSuggestion,null);assert.equal(localStorage.getItem('paperknow-drafts'),null);});


test('a generated method fills an empty supplement but does not count as research evidence',async t=>{
 const f=fixture(t);f.mount();await f.generate();await f.apply();
 assert.equal($('#knowledge-ai-input').value,methodBlock(completed.output.text));
 const snapshot=planSnapshot(f.saved());assert.equal(snapshot.requirements.researchPlan.text,completed.output.text);assert.equal(snapshot.materials.length,0);assert.equal(assessThesisEvidence(snapshot).ready,false);assert.equal(assessThesisEvidence(snapshot).characters,0);
 $('#knowledge-ai-generate').click();assert.equal(flushEditorDraft(),true);assert.equal(planSnapshot(f.saved()).materials.length,0);
});

test('adopting a newer method replaces only the marked method and keeps surrounding explanation',async t=>{
 const f=fixture(t);f.mount();input('#knowledge-ai-input','用户原有的真实说明');$('#knowledge-ai-generate').click();await f.generate();await f.apply();
 input('#knowledge-ai-input',$('#knowledge-ai-input').value+'\n\n补充的实际研究限制');
 await f.generate();const replacement='拟开展：采用公开文献比较，具体资料范围待核对。';input('#writing-method-ai-result',replacement);await f.apply();
 const text=$('#knowledge-ai-input').value;assert.equal(methodBlockCount(text),1);assert.match(text,/用户原有的真实说明/);assert.match(text,/补充的实际研究限制/);assert.ok(text.includes(methodBlock(replacement)));assert.ok(!text.includes(completed.output.text));assert.equal(f.saved().methodSuggestion.text,replacement);
 assert.equal(f.calls.filter(c=>c.path==='/theses/methods').length,2);
});

test('an existing separate method can explicitly fill the supplement once with real notes preserved',async t=>{
 const userText='旧草稿中保存的用户研究说明',f=fixture(t,{stored:{id:'legacy-adopted-method',tool:'writing',title:'既有论文草稿',writingResume:true,workflowStage:2,knowledgeFiles:[{id:'user-note',name:'用户研究说明',kind:'ai',text:userText,state:'edited'}],methodSuggestion:{text:completed.output.text,jobId:completed.id}}});
 f.mount();assert.equal($('#knowledge-ai-input').value,userText);$('#knowledge-method-use').click();await settle();assert.equal($('#knowledge-ai-input').value,userText+'\n\n'+methodBlock(completed.output.text));$('#knowledge-method-use').click();await settle();assert.equal(flushEditorDraft(),true);clearEditor();mountWriting(undefined,undefined,f.ctx);
 assert.equal(methodBlockCount($('#knowledge-ai-input').value),1);assert.equal(planSnapshot(f.saved()).materials[0].text,userText);assert.equal(f.calls.length,0);
});

test('failed adoption persistence restores the supplement and plan while keeping the completed preview available',async t=>{
 const f=fixture(t);f.mount();input('#knowledge-ai-input','本来已经记录的研究说明');$('#knowledge-ai-generate').click();await f.generate();
 const before=$('#knowledge-ai-input').value,original=f.dom.window.Storage.prototype.setItem;
 f.dom.window.Storage.prototype.setItem=function(key,value){if(key==='paperknow-drafts')throw new Error('测试存储失败');return original.call(this,key,value);};
 try{await f.apply();assert.equal($('#knowledge-ai-input').value,before);assert.equal($('#writing-method-ai-panel').hidden,false);assert.ok($('#writing-method-ai-result'));assert.equal($('#writing-method-ai-result').value,completed.output.text);assert.equal(f.saved().methodSuggestion,null);assert.match($('#writing-method-ai-panel').textContent,/尚未保存|保存失败/);}
 finally{f.dom.window.Storage.prototype.setItem=original;}
 assert.equal(f.calls.filter(c=>c.path==='/theses/methods').length,1);
});


for(const [name,damaged] of [
 ['an incomplete method block',text=>text.replace('【研究方法建议结束】','')],
 ['duplicate method blocks',text=>text+'\n\n'+text]
])test(name+' preserves the raw editor, blocks confirmation and never becomes evidence',async t=>{
 const f=fixture(t);f.mount();await f.generate();await f.apply();const raw=damaged($('#knowledge-ai-input').value);
 input('#knowledge-ai-input',raw);$('#knowledge-ai-generate').click();assert.match($('#knowledge-ai-status').textContent,/标记不完整或重复/);assert.equal($('#knowledge-ai-input').value,raw);
 $('#writing-material-confirm').click();assert.match($('#writing-step-error').textContent,/标记不完整或重复/);assert.equal($('#knowledge-ai-input').value,raw);
 assert.equal(flushEditorDraft(),true);const row=f.saved(),snapshot=planSnapshot(row);assert.equal(snapshot.materials.length,0);assert.equal(assessThesisEvidence(snapshot).characters,0);assert.equal(snapshot.requirements.researchPlan.text,completed.output.text);
 clearEditor();mountWriting(undefined,undefined,f.ctx);assert.equal($('#knowledge-ai-input').value,raw);assert.equal(f.calls.filter(c=>c.path==='/theses/methods').length,1);
});
