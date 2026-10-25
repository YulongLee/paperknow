import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {confirmThesisResearch,completeThesisDraft} from './helpers/thesis-flow.mjs';

const settle=async()=>{for(let attempt=0;attempt<12;attempt++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(t){
 const dom=new JSDOM('<aside class="sidebar"></aside><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.cn/workspace.html#tool/writing?new=outline-source-test'});
 for(const key of ['window','document','localStorage','FormData','location','AbortController'])globalThis[key]=dom.window[key];
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{};dom.window.confirm=()=>true;document.querySelector('dialog').close=()=>{};
 const calls=[],ctx={notify(){},session:async()=>({status:'guest',user:null}),async api(path,data){calls.push({path,data});throw Error('This outline-source test must not call an AI or paid API: '+path);}},$=selector=>document.querySelector(selector);
 const f={dom,ctx,calls,$,input(selector,value){const node=$(selector);assert.ok(node,selector);node.value=value;node.dispatchEvent(new window.Event('input',{bubbles:true}));},file(text,name='synthetic-outline.txt'){const input=$('#outline-file');Object.defineProperty(input,'files',{configurable:true,value:[{name,size:new TextEncoder().encode(text).length,text:async()=>text}]});input.dispatchEvent(new window.Event('change',{bubbles:true}));},save(){assert.equal(flushEditorDraft(),true);const rows=JSON.parse(localStorage.getItem('paperknow-drafts')||'[]');assert.equal(rows.length,1);return rows[0];},close(){clearEditor();dom.window.close();}};
 if(t)t.after(()=>f.close());return f;
}
const bootstrap=fixture();
const {mountWriting}=await import('../dist/workspace/writing.mjs');
const {clearEditor,flushEditorDraft}=await import('../dist/workspace/edit-guard.mjs');
bootstrap.close();

const ownOutline='第一章 合成专属问题界定\n1.1 合成研究对象\n第二章 合成研究设计\n2.1 合成分析步骤';
const prose='这是一段普通研究说明，介绍本研究的背景、已有资料和研究范围。这段正文没有提供章节或小节结构。';
const outlineFields=row=>Object.fromEntries(['outlineText','outlineRows','outlineSource','outlineFileName','outlineAIResult','bodySections','outlineConfirmed'].map(key=>[key,row[key]]));
function savedOutline(source='pasted'){
 return completeThesisDraft({id:'saved-outline-source',tool:'writing',title:'合成专属提纲测试',targetWords:8000,workflowStage:4,workflowUnlockedStage:4,writingResume:true,outlineText:ownOutline,outlineSource:source,outlineConfirmed:false,outlineAIResult:null,outlineFileName:source==='uploaded'?'先前保存的本人提纲.txt':'',...(source==='model'?{outlineAIResult:{jobId:'synthetic-adopted-outline',generatedAt:'2026-10-24T00:00:00.000Z'}}:{}),outlineRows:[{id:'chapter-a',title:'第一章 合成专属问题界定',level:1,words:0},{id:'section-a',title:'1.1 合成研究对象',level:2,words:4000},{id:'chapter-b',title:'第二章 合成研究设计',level:1,words:0},{id:'section-b',title:'2.1 合成分析步骤',level:2,words:4000}],bodySections:[{id:'chapter-a',title:'第一章 合成专属问题界定',text:'这是已经手工保存的合成正文，替换失败时必须保留。'}]});
}
async function newStep4(f){
 mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','合成空白提纲测试');f.$('#writing-generate').click();await confirmThesisResearch();await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'4');
}
function restore(f,row=savedOutline()){
 localStorage.setItem('paperknow-drafts',JSON.stringify([row]));mountWriting(row.id,undefined,f.ctx);assert.equal(f.$('.dashboard').dataset.writingStage,'4');return row;
}

test('a new thesis reaches Step 4 with no generic outline and keeps AI, upload and manual source choices',async t=>{
 const f=fixture(t);await newStep4(f);assert.equal(f.$('#outline-template-create'),null);assert.doesNotMatch(f.$('#writing-outline-area').textContent,/使用通用结构|通用提纲/);for(const id of ['outline-ai-generate','outline-upload-trigger','outline-manual-trigger'])assert.ok(f.$('#'+id),id);assert.equal(f.$('#outline-source-input').value,'');assert.equal(f.$('#outline-paper .outline-row-title'),null);const saved=f.save();assert.equal(saved.outlineText,'');assert.deepEqual(saved.outlineRows,[]);assert.ok(!saved.outlineSource);assert.deepEqual(f.calls,[]);
});

test('saving and remounting an empty Step 4 preserves the empty outline and consistently asks the user to create one',async t=>{
 const f=fixture(t);await newStep4(f);const saved=f.save();assert.equal(saved.outlineText,'');assert.deepEqual(saved.outlineRows,[]);assert.ok(!saved.outlineSource);clearEditor();mountWriting(saved.id,undefined,f.ctx);await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'4');assert.equal(f.$('#outline-source-input').value,'');assert.equal(f.$('#outline-paper .outline-row-title'),null);assert.ok(f.$('[data-outline-empty]'));assert.equal(f.$('#outline-confirm').disabled,true);assert.match(f.$('#outline-builder-status').textContent,/请选择.*创建|创建.*提纲/);assert.doesNotMatch(f.$('#outline-builder-status').textContent,/已有|已导入|已生成|已使用/);assert.equal(f.$('#writing-example-note').hidden,true);assert.equal(f.$('#writing-example-note').textContent,'');assert.doesNotMatch(f.$('.preview-heading').textContent,/示例|通用/);assert.doesNotMatch(f.$('#writing-outline-area').textContent,/使用通用结构|通用提纲|当前展示示例/);const restored=f.save();assert.equal(restored.outlineText,'');assert.deepEqual(restored.outlineRows,[]);assert.ok(!restored.outlineSource);assert.equal(restored.outlineConfirmed,false);assert.deepEqual(f.calls,[]);
});

test('an empty outline cannot confirm Step 4 or bypass its gate by dispatching a click on the disabled action',async t=>{
 const f=fixture(t);await newStep4(f);assert.equal(f.$('#outline-confirm').disabled,true);f.$('#outline-confirm').click();f.$('#outline-confirm').dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'4');const saved=f.save();assert.equal(saved.outlineText,'');assert.deepEqual(saved.outlineRows,[]);assert.equal(saved.outlineConfirmed,false);assert.ok(saved.workflowUnlockedStage<=4);assert.deepEqual(saved.bodySections,[]);assert.deepEqual(f.calls,[]);
});

for(const existing of [false,true])test(`pasting ordinary prose ${existing?'preserves an existing outline and body':'leaves a new outline empty'} instead of synthesizing a generic structure`,async t=>{
 const f=fixture(t);if(existing)restore(f);else await newStep4(f);const before=outlineFields(f.save());f.input('#outline-source-input',prose);f.$('#outline-paste-apply').click();await settle();assert.deepEqual(outlineFields(f.save()),before);assert.match(f.$('#outline-builder-status').textContent,/提纲|章节/);assert.equal(f.$('.dashboard').dataset.writingStage,'4');if(!existing)assert.equal(f.$('#outline-paper .outline-row-title'),null);assert.deepEqual(f.calls,[]);
});

for(const [description,text] of [['blank',' \n\t\n '],['ordinary prose',prose]])test(`a ${description} TXT upload cannot replace a saved outline or its body with a generic structure`,async t=>{
 const f=fixture(t);restore(f,savedOutline('uploaded'));const before=outlineFields(f.save());f.file(text,'不应覆盖的测试文件.txt');await settle();assert.deepEqual(outlineFields(f.save()),before);assert.match(f.$('#outline-builder-status').textContent,/提纲|章节/);assert.equal(f.$('.dashboard').dataset.writingStage,'4');assert.deepEqual(f.calls,[]);
});

test('a real manually entered outline is adopted, editable and restorable without a generic fallback or an AI call',async t=>{
 const f=fixture(t);await newStep4(f);f.$('#outline-manual-trigger').click();assert.equal(document.activeElement,f.$('#outline-source-input'));f.input('#outline-source-input',ownOutline);f.$('#outline-paste-apply').click();assert.equal(document.querySelectorAll('#outline-paper .outline-row-title').length,4);assert.equal(f.$('#outline-confirm').disabled,false);f.input('#outline-paper .outline-row-title','第一章 本人调整后的合成问题界定');let saved=f.save();assert.equal(saved.outlineSource,'pasted');assert.equal(saved.outlineRows[0].title,'第一章 本人调整后的合成问题界定');const rows=structuredClone(saved.outlineRows);clearEditor();mountWriting(saved.id,undefined,f.ctx);assert.equal(f.$('#outline-paper .outline-row-title').value,'第一章 本人调整后的合成问题界定');saved=f.save();assert.deepEqual(saved.outlineRows,rows);assert.deepEqual(f.calls,[]);
});

test('starting a manual chapter from the empty state adds only the requested row and keeps it across restoration',async t=>{
 const f=fixture(t);await newStep4(f);f.$('[data-outline-empty] [data-outline-add="chapter"]').click();assert.equal(document.querySelectorAll('#outline-paper .outline-row-title').length,1);f.input('#outline-paper .outline-row-title','第一章 本人手工建立的专属章节');f.$('[data-outline-auto]').click();const saved=f.save();assert.equal(saved.outlineRows.length,1);assert.equal(saved.outlineRows[0].title,'第一章 本人手工建立的专属章节');assert.equal(saved.outlineRows[0].words,8000);clearEditor();mountWriting(saved.id,undefined,f.ctx);assert.deepEqual(f.save().outlineRows,saved.outlineRows);assert.equal(document.querySelectorAll('#outline-paper .outline-row-title').length,1);assert.deepEqual(f.calls,[]);
});

test('a valid TXT upload creates only its own numbered sections and retains its filename when restored',async t=>{
 const f=fixture(t);await newStep4(f);f.file(ownOutline,'本人合成专属提纲.txt');await settle();let saved=f.save();assert.equal(saved.outlineSource,'uploaded');assert.equal(saved.outlineFileName,'本人合成专属提纲.txt');assert.deepEqual(saved.outlineRows.map(row=>row.title),ownOutline.split('\n'));assert.equal(saved.outlineRows.reduce((sum,row)=>sum+row.words,0),8000);clearEditor();mountWriting(saved.id,undefined,f.ctx);assert.equal(f.$('#outline-paper .outline-row-title').value,'第一章 合成专属问题界定');assert.deepEqual(outlineFields(f.save()),outlineFields(saved));assert.deepEqual(f.calls,[]);
});

test('a plain TXT outline with 1. numbered chapters and no subsections imports and restores without structured AI metadata',async t=>{
 const f=fixture(t);await newStep4(f);const text='1. 本人数字章节的问题界定\n2. 本人数字章节的研究设计';f.file(text,'数字章无子节提纲.txt');await settle();const saved=f.save();assert.equal(saved.outlineSource,'uploaded');assert.equal(saved.outlineFileName,'数字章无子节提纲.txt');assert.deepEqual(saved.outlineRows.map(row=>({title:row.title,level:row.level})),text.split('\n').map(title=>({title,level:1})));assert.equal(saved.outlineRows.reduce((sum,row)=>sum+row.words,0),8000);assert.ok(saved.outlineRows.every(row=>row.words>=20));assert.equal(f.$('#outline-confirm').disabled,false);clearEditor();mountWriting(saved.id,undefined,f.ctx);assert.deepEqual(f.save().outlineRows,saved.outlineRows);assert.equal(document.querySelectorAll('#outline-paper .outline-row-title').length,2);assert.deepEqual(f.calls,[]);
});

test('adopting a synthetic AI outline with numbered chapters and no subsections preserves its own rows and budgets',async t=>{
 const f=fixture(t);await newStep4(f);const user={id:'synthetic-outline-owner'},item={id:'synthetic-numbered-outline',userId:user.id,status:'completed',stage:'completed',output:{text:'1. 专属合成问题\n2. 专属合成设计',chapters:[{id:'own-problem',title:'1. 专属合成问题',targetWords:3200,sections:[]},{id:'own-design',title:'2. 专属合成设计',targetWords:4800,sections:[]}]}};f.ctx.session=async()=>({status:'ready',user});f.ctx.api=async(path,data)=>{f.calls.push({path,data});if(path==='/auth/me')return {user};if(path==='/theses/outlines/capabilities')return {ready:true,billingService:'agent'};if(path==='/billing/quote')return {type:'agent',source:'credits',title:'合成提纲费用',creditCost:10,token:'synthetic-outline-quote',expiresAt:new Date(Date.now()+60000).toISOString()};if(path==='/theses/outlines')return {item};throw Error('Unexpected synthetic outline API: '+path);};
 f.$('#outline-ai-generate').click();await settle();assert.equal(f.$('[data-outline-ai-start]'),null);assert.ok(f.$('[data-outline-ai-apply]'));f.$('[data-outline-ai-apply]').click();await settle();const saved=f.save();assert.equal(saved.outlineSource,'model');assert.deepEqual(saved.outlineRows.map(row=>({id:row.id,title:row.title,level:row.level,words:row.words})),[{id:'own-problem',title:'第一章 专属合成问题',level:1,words:3200},{id:'own-design',title:'第二章 专属合成设计',level:1,words:4800}]);assert.equal(saved.outlineAIResult.jobId,item.id);assert.equal(saved.outlineJobId,null);assert.equal(f.calls.filter(row=>row.path==='/theses/outlines').length,1);assert.equal(f.calls.filter(row=>row.path==='/billing/quote').length,1);clearEditor();mountWriting(saved.id,undefined,f.ctx);assert.deepEqual(f.save().outlineRows,saved.outlineRows);assert.equal(f.calls.filter(row=>row.path==='/theses/outlines').length,1);
});

for(const source of ['pasted','uploaded','model'])test(`restoring an existing ${source} outline keeps its structure, budget, provenance and body editable`,async t=>{
 const f=fixture(t),original=restore(f,savedOutline(source));let saved=f.save();assert.deepEqual(saved.outlineRows,original.outlineRows);assert.equal(saved.outlineSource,source);assert.equal(saved.outlineFileName,original.outlineFileName);assert.deepEqual(saved.bodySections,original.bodySections);assert.deepEqual(saved.outlineAIResult,original.outlineAIResult);f.input('#outline-paper .outline-row-title','第一章 本人继续编辑的专属问题');saved=f.save();assert.equal(saved.outlineRows[0].title,'第一章 本人继续编辑的专属问题');assert.deepEqual(saved.outlineRows.slice(1),original.outlineRows.slice(1));assert.equal(saved.outlineSource,source);assert.deepEqual(saved.bodySections,original.bodySections);clearEditor();mountWriting(saved.id,undefined,f.ctx);assert.equal(f.$('#outline-paper .outline-row-title').value,'第一章 本人继续编辑的专属问题');assert.deepEqual(f.save().bodySections,original.bodySections);assert.deepEqual(f.calls,[]);
});
