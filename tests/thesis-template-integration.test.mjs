import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createWritingDocx} from '../src/writing-document.js';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
const fixtureBytes=new Uint8Array(await createWritingDocx('学校模板样例\n正文段落使用学校规范。'));
import {mountThesisStage,mountOnlineThesis,disposeOnlineThesis} from '../dist/workspace/thesis-online.mjs';
import {mountWriting} from '../dist/workspace/writing.mjs';
import {clearEditor} from '../dist/workspace/edit-guard.mjs';
import {endDraftScope} from '../dist/workspace/state.mjs';
const waitFor=async check=>{for(let i=0;i<300;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('Expected template mutation was not completed');};
const snapshot={title:'论文模板验证',profile:{level:'本科',major:'教育学',language:'中文',targetWords:8000},requirements:{},materials:[],references:[],outline:[{id:'c1',title:'第一章 绪论',targetWords:8000}]};
const template={version:1,status:'ready',source:{fileId:'old-template',name:'原学校模板.docx',sha256:'a'.repeat(64),size:200},profile:{summary:['正文宋体 12pt'],warnings:[]}};
const initial=()=>({id:'t1',version:3,title:snapshot.title,snapshot:structuredClone(snapshot),profile:snapshot.profile,status:'completed',exportTemplate:structuredClone(template),chapters:[{id:'c1',title:'第一章 绪论',text:'已经保存的论文正文',version:2,status:'saved',sourceIds:[]}]});
function setup(t){const dom=new JSDOM('<aside class="sidebar"></aside><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main>',{url:'https://example.test/workspace.html#tool/writing'});for(const key of ['window','document','location','localStorage','FormData','AbortController'])globalThis[key]=dom.window[key];dom.window.confirm=()=>true;dom.window.HTMLElement.prototype.scrollIntoView=()=>{};t.after(()=>{clearEditor();disposeOnlineThesis();endDraftScope();dom.window.close();});return {dom,q:selector=>document.querySelector(selector)};}
// Template inspection includes byte reads and async parsing; exercise a delayed read without counting event-loop turns.
const file=(name='新学校模板.docx',readDelay=0)=>({name,size:fixtureBytes.length,arrayBuffer:async()=>{if(readDelay)await new Promise(resolve=>setTimeout(resolve,readDelay));return fixtureBytes.buffer;}});
function select(f,selector,value){if(selector.startsWith('#writing-knowledge-template'))openDraftSettings(f);const input=f.q(selector);Object.defineProperty(input,'files',{value:[value],configurable:true});input.dispatchEvent(new window.Event('change',{bubbles:true}));}
function accountFixture(t,{failure=false,record=initial(),bumpDuringUpload=false,externalTemplateDuringUpload=false}={}){const f=setup(t),calls=[],changes=[];let item=structuredClone(record);const ctx={session:async()=>({status:'ready',user:{id:'u1'}}),api:async(path,data)=>{calls.push({path,data});if(path==='/auth/me')return {user:{id:'u1'}};if(path==='/capabilities')return {thesis:{ready:true}};if(path==='/theses/t1'&&!data)return {item:structuredClone(item)};if(path==='/files'){if(bumpDuringUpload)item={...item,version:item.version+1};if(externalTemplateDuringUpload)item={...item,version:item.version+1,exportTemplate:{...template,source:{...template.source,fileId:'external-template',name:'其他页面选中的模板.docx'}}};return {id:'new-template'};}if(path==='/theses'&&data){item={...item,snapshot:data.snapshot,exportTemplate:data.exportTemplateFileId?{...template,source:{...template.source,fileId:data.exportTemplateFileId}}:null};return {item:structuredClone(item)};}if(path==='/theses/t1/export-template'&&data){if(Object.hasOwn(data,'expectedTemplateFileId')&&data.expectedTemplateFileId!==(item.exportTemplate?.source?.fileId||null))throw Object.assign(Error('导出模板已在其他页面更新，请重新读取后核对'),{status:409});if(failure)throw Error('无法识别此 DOCX 的样式');item={...item,version:item.version+1,exportTemplate:data.templateFileId?{...template,source:{...template.source,fileId:data.templateFileId,name:'新学校模板.docx'}}:null};return {item:structuredClone(item)};}if(path==='/theses/t1/export-template')return {version:item.version,exportTemplate:item.exportTemplate};throw Error('Unexpected '+path);}};return {...f,ctx,calls,changes,get item(){return item;}};}
test('new account thesis passes template reference outside the research snapshot without generating or charging',async t=>{const f=accountFixture(t);const stop=mountThesisStage({ctx:f.ctx,container:f.q('.dashboard'),getSnapshot:()=>structuredClone(snapshot),getTemplateFileId:()=>template.source.fileId,onTemplateSaved:value=>f.changes.push(value)});await stop.ready;f.q('[data-thesis-create]').click();await waitFor(()=>/已保存到账户/.test(f.q('[data-thesis-notice]')?.textContent||''));const write=f.calls.find(call=>call.path==='/theses'&&call.data);assert.equal(write.data.exportTemplateFileId,'old-template');assert.deepEqual(write.data.snapshot,snapshot);assert.equal(write.data.snapshot.exportTemplate,undefined);assert.equal(f.calls.some(call=>/quote|generate|resume/.test(call.path)),false);assert.equal(f.q('[data-template-panel]').querySelector('details').open,false);});
test('replacing an account template only calls file upload and independent template mutation, preserving body and research',async t=>{const f=accountFixture(t),before=structuredClone(f.item);const stop=mountThesisStage({id:'t1',ctx:f.ctx,container:f.q('.dashboard'),onTemplateSaved:value=>f.changes.push(value)});await stop.ready;select(f,'[data-template-file]',file());await waitFor(()=>f.changes.at(-1)?.source?.fileId==='new-template'&&f.q('[data-template-choose]')?.disabled===false);const mutation=f.calls.find(call=>call.path==='/theses/t1/export-template'&&call.data);assert.deepEqual(mutation.data,{version:3,templateFileId:'new-template',expectedTemplateFileId:'old-template'});assert.equal(f.item.version,4);assert.deepEqual(f.item.snapshot,before.snapshot);assert.deepEqual(f.item.chapters,before.chapters);assert.match(f.q('[data-template-panel]').textContent,/新学校模板.docx/);assert.equal(f.changes.at(-1).source.fileId,'new-template');assert.equal(f.calls.some(call=>/quote|generate|resume/.test(call.path)),false);});
test('failed association preserves current template and the user can explicitly restore the default without regeneration',async t=>{const f=accountFixture(t,{failure:true});let stop=mountOnlineThesis({id:'t1',ctx:f.ctx,container:f.q('.dashboard')});await stop.ready;select(f,'[data-template-file]',file('新学校模板.docx',40));await waitFor(()=>/无法识别/.test(f.q('[data-thesis-notice]')?.textContent||'')&&f.q('[data-template-choose]')?.disabled===false);assert.match(f.q('[data-template-panel]').textContent,/原学校模板.docx/);assert.match(f.q('[data-thesis-notice]').textContent,/无法识别/);assert.match(f.q('[data-template-status]').textContent,/无法识别此 DOCX 的样式/);assert.equal(f.item.exportTemplate.source.fileId,'old-template');stop();const successful=accountFixture(t);stop=mountOnlineThesis({id:'t1',ctx:successful.ctx,container:successful.q('.dashboard')});await stop.ready;successful.q('[data-template-clear]').click();await waitFor(()=>successful.item.exportTemplate===null&&/通用学位论文模板（默认）/.test(successful.q('[data-template-panel]')?.textContent||'')&&successful.q('[data-template-choose]')?.disabled===false);assert.equal(successful.item.exportTemplate,null);assert.match(successful.q('[data-template-panel]').textContent,/通用学位论文模板（默认）/);assert.deepEqual(successful.calls.find(call=>call.data&&call.path.endsWith('/export-template')).data,{version:3,templateFileId:null,expectedTemplateFileId:'old-template'});assert.equal(successful.calls.some(call=>/quote|generate|resume/.test(call.path)),false);});
function draftFixture(t,{failure=false,stored}={}){const f=setup(t),calls=[];let item=stored?.thesisId?initial():null;if(stored)localStorage.setItem('paperknow-drafts',JSON.stringify([stored]));const ctx={notify(){},session:async()=>({status:'ready',user:{id:'u1'}}),api:async(path,data)=>{calls.push({path,data});if(path==='/auth/me')return {user:{id:'u1'}};if(path==='/capabilities')return {thesis:{ready:true}};if(path==='/files'){if(failure)throw Error('云存储暂时不可用');return {id:'draft-template'};}if(path==='/theses'&&data){item={...initial(),snapshot:structuredClone(data.snapshot),title:data.snapshot.title,exportTemplate:data.exportTemplateFileId?{...template,source:{...template.source,fileId:data.exportTemplateFileId,name:'新学校模板.docx'}}:null};return {item:structuredClone(item)};}if(path==='/theses/t1'&&!data)return {item:structuredClone(item)};if(path==='/theses/t1/export-template'&&data){item={...item,version:item.version+1,exportTemplate:data.templateFileId?{...template,source:{...template.source,fileId:data.templateFileId,name:'新学校模板.docx'}}:null};return {item:structuredClone(item)};}if(path==='/theses/t1/export-template')return {version:item.version,exportTemplate:item.exportTemplate};throw Error('Unexpected '+path);}};mountWriting(undefined,undefined,ctx);return {...f,ctx,calls,saved:()=>JSON.parse(localStorage.getItem('paperknow-drafts')||'[]')[0],get item(){return item;}};}
const draft=()=>({id:'draft1',tool:'writing',title:'学校模板草稿',degree:'本科',major:'教育学',targetWords:8000,targetWordsMode:'custom',writingReferences:[{id:'r1',title:'用于写作的参考文献',confirmed:true}],writingResume:true,workflowStage:2,workflowUnlockedStage:5,outlineText:'第一章 绪论',outlineConfirmed:true,outlineRows:[{id:'c1',title:'第一章 绪论',level:1,words:8000}],formatTemplateName:'旧学校规范.docx',knowledgeFiles:[],exportTemplate:structuredClone(template),exportTemplateSelectionMade:true});
test('draft upload failure retains the previous template and legacy filenames are never claimed as applied styles',async t=>{const f=draftFixture(t,{failure:true,stored:draft()});select(f,'#writing-knowledge-template [data-template-file]',file());await waitFor(()=>/原有模板保持不变/.test(f.q('#writing-status')?.textContent||''));assert.match(f.q('#writing-knowledge-template').textContent,/原学校模板.docx/);assert.match(f.q('#writing-status').textContent,/原有模板保持不变/);assert.equal(f.saved().exportTemplate.source.fileId,'old-template');clearEditor();localStorage.setItem('paperknow-drafts',JSON.stringify([{...draft(),exportTemplate:undefined,exportTemplateSelectionMade:false}]));mountWriting(undefined,undefined,f.ctx);assert.match(f.q('#writing-knowledge-template').textContent,/仅记录了.*文件名/);assert.match(f.q('#writing-knowledge-template').textContent,/通用学位论文模板（默认）/);});

const isVisible=node=>!!node&&!node.closest('[hidden],.is-stage-hidden');
const finalDraft=()=>({...draft(),workflowStage:5,workflowUnlockedStage:5,bodySections:[{id:'c1',title:'第一章 绪论',text:'已经填写的正文内容，不应因格式切换丢失。'}]});
function openDraftSettings(f){if(!isVisible(f.q('#writing-knowledge-template')))f.q('#writing-final-template [data-template-manage],#writing-local-template [data-template-manage]')?.click();assert.ok(isVisible(f.q('#writing-knowledge-template')));}
async function returnFinal(f){f.q('[data-writing-step="5"]').click();await waitFor(()=>f.q('[data-thesis-create]'));}

test('precise knowledge owns the only template chooser and final delivery returns to it before account save',async t=>{
 const f=draftFixture(t,{stored:finalDraft()});await waitFor(()=>f.q('[data-thesis-create]'));
 assert.ok(isVisible(f.q('#writing-final-template')));assert.equal(f.q('#writing-final-template [data-template-file]'),null);
 assert.equal([...document.querySelectorAll('[data-template-panel]')].filter(isVisible).length,0);
 openDraftSettings(f);const host=f.q('#writing-knowledge-template');assert.ok(host.closest('#writing-material-review'));
 assert.equal([...document.querySelectorAll('[data-template-panel]')].filter(isVisible).length,1);
 let chooserClicks=0;host.querySelector('[data-template-file]').click=()=>chooserClicks++;
 host.querySelector('[data-template-choose]').click();assert.equal(chooserClicks,1);
 const before=structuredClone(f.saved());select(f,'#writing-knowledge-template [data-template-file]',file());
 await waitFor(()=>f.saved()?.exportTemplate?.source?.fileId==='draft-template'&&!f.q('#writing-knowledge-template [data-template-choose]').disabled);
 assert.equal(f.saved().outlineConfirmed,true);assert.deepEqual(f.saved().outlineRows,before.outlineRows);assert.deepEqual(f.saved().bodySections,before.bodySections);assert.deepEqual(f.saved().knowledgeFiles,[]);
 assert.match(host.textContent,/新学校模板.docx/);await returnFinal(f);f.q('[data-thesis-create]').click();await waitFor(()=>f.item?.id==='t1'&&f.q('.thesis-export [data-template-summary]'));
 assert.equal(f.calls.find(call=>call.path==='/theses'&&call.data).data.exportTemplateFileId,'draft-template');
 assert.equal([...document.querySelectorAll('[data-template-panel]')].filter(isVisible).length,0);assert.equal(isVisible(f.q('#writing-final-template')),false);
 f.q('.thesis-export [data-template-manage]').click();assert.ok(isVisible(host));assert.equal(f.calls.some(call=>/quote|generate|resume/.test(call.path)),false);
});
test('final draft template replacement, default restore and reopening preserve text, outline and prior saved template',async t=>{
 const f=draftFixture(t,{stored:finalDraft()});await waitFor(()=>f.q('[data-thesis-create]'));
 const before=structuredClone(f.saved());assert.match(f.q('#writing-final-template').textContent,/原学校模板.docx/);
 select(f,'#writing-knowledge-template [data-template-file]',file());await waitFor(()=>f.saved()?.exportTemplate?.source?.fileId==='draft-template'&&!f.q('[data-template-choose]').disabled);
 clearEditor();mountWriting(undefined,undefined,f.ctx);await returnFinal(f);
 assert.match(f.q('#writing-final-template').textContent,/新学校模板.docx/);assert.ok(isVisible(f.q('#writing-final-template')));
 openDraftSettings(f);f.q('#writing-knowledge-template [data-template-clear]').click();await waitFor(()=>f.saved()?.exportTemplate===null&&!f.q('#writing-knowledge-template [data-template-choose]').disabled);
 assert.match(f.q('#writing-final-template').textContent,/通用学位论文模板（默认）/);assert.deepEqual(f.saved().bodySections,before.bodySections);assert.deepEqual(f.saved().outlineRows,before.outlineRows);assert.equal(f.saved().outlineConfirmed,true);
 assert.equal(f.calls.some(call=>/quote|generate|resume/.test(call.path)),false);
});
test('account template replacement tolerates unrelated generation version updates using the original template identity',async t=>{
 const record={...initial(),status:'running'},f=accountFixture(t,{record,bumpDuringUpload:true}),before=structuredClone(f.item);
 const stop=mountThesisStage({id:'t1',ctx:f.ctx,container:f.q('.dashboard'),onTemplateSaved:value=>f.changes.push(value)});await stop.ready;
 select(f,'[data-template-file]',file('新学校模板.docx',30));await waitFor(()=>f.changes.at(-1)?.source?.fileId==='new-template'&&f.q('[data-template-choose]')?.disabled===false);
 const mutation=f.calls.find(call=>call.path.endsWith('/export-template')&&call.data);assert.equal(mutation.data.expectedTemplateFileId,'old-template');assert.equal(mutation.data.templateFileId,'new-template');
 assert.equal(f.item.version,5);assert.deepEqual(f.item.snapshot,before.snapshot);assert.deepEqual(f.item.chapters,before.chapters);assert.equal(f.calls.some(call=>/quote|generate|resume/.test(call.path)),false);
});
test('an account template changed in another page during upload is not overwritten by the stale choice',async t=>{
 const f=accountFixture(t,{externalTemplateDuringUpload:true});const stop=mountThesisStage({id:'t1',ctx:f.ctx,container:f.q('.dashboard')});await stop.ready;
 select(f,'[data-template-file]',file());await waitFor(()=>/模板已|版本已|其他页面/.test(f.q('[data-thesis-notice]')?.textContent||'')&&f.q('[data-template-choose]')?.disabled===false);
 assert.equal(f.item.exportTemplate.source.fileId,'external-template');assert.equal(f.calls.some(call=>/quote|generate|resume/.test(call.path)),false);
});

test('legacy manual writing uses the shared knowledge selector and keeps its body after a format change',async t=>{
 const stored={...finalDraft(),workflowStage:4,workflowUnlockedStage:4,writingEditorState:{manualWriting:true}},f=draftFixture(t,{stored});
 const local=f.q('#writing-local-template');assert.ok(isVisible(local));assert.ok(f.q('#body-docx'));assert.equal(f.q('#body-pdf'),null);assert.equal(f.q('#body-export'),null);assert.equal(local.querySelector('[data-template-file]'),null);
 const before=structuredClone(f.saved());openDraftSettings(f);select(f,'#writing-knowledge-template [data-template-file]',file());await waitFor(()=>f.saved()?.exportTemplate?.source?.fileId==='draft-template'&&!f.q('#writing-knowledge-template [data-template-choose]').disabled);
 assert.match(local.textContent,/新学校模板.docx/);assert.deepEqual(f.saved().bodySections,before.bodySections);assert.deepEqual(f.saved().outlineRows,before.outlineRows);assert.equal(f.calls.some(call=>/quote|generate|resume/.test(call.path)),false);
});
test('failed final-step template upload keeps the currently selected school template and usable chooser',async t=>{
 const f=draftFixture(t,{failure:true,stored:finalDraft()});await waitFor(()=>f.q('[data-thesis-create]'));
 select(f,'#writing-knowledge-template [data-template-file]',file());await waitFor(()=>/原有模板保持不变/.test(f.q('#writing-status')?.textContent||'')&&!f.q('#writing-knowledge-template [data-template-choose]').disabled);
 assert.ok(isVisible(f.q('#writing-knowledge-template')));assert.match(f.q('#writing-final-template').textContent,/原学校模板.docx/);assert.match(f.q('#writing-knowledge-template [data-template-status]').textContent,/原有模板保持不变/);assert.equal(f.saved().exportTemplate.source.fileId,'old-template');assert.equal(f.calls.some(call=>/quote|generate|resume/.test(call.path)),false);
});

test('saving account waits for a pending final template upload and later creates with the newly selected template',async t=>{
 const f=draftFixture(t,{stored:finalDraft()});await waitFor(()=>f.q('[data-thesis-create]'));
 const before=structuredClone(f.saved());let releaseRead,readStarted=false;const readGate=new Promise(resolve=>{releaseRead=resolve;});
 const pendingFile={name:'新学校模板.docx',size:fixtureBytes.length,arrayBuffer:async()=>{readStarted=true;await readGate;return fixtureBytes.buffer;}};
 select(f,'#writing-knowledge-template [data-template-file]',pendingFile);await waitFor(()=>readStarted);
 assert.equal(f.q('#writing-knowledge-template [data-template-choose]').disabled,true);
 await returnFinal(f);f.q('[data-thesis-create]').click();await waitFor(()=>/格式模板正在保存/.test(f.q('[data-thesis-notice]')?.textContent||''));
 assert.equal(f.calls.some(call=>call.path==='/theses'&&call.data),false);
 assert.equal(f.saved().exportTemplate.source.fileId,'old-template');assert.deepEqual(f.saved().bodySections,before.bodySections);assert.deepEqual(f.saved().outlineRows,before.outlineRows);
 releaseRead();await waitFor(()=>f.saved()?.exportTemplate?.source?.fileId==='draft-template'&&!f.q('#writing-knowledge-template [data-template-choose]').disabled);
 f.q('[data-thesis-create]').click();await waitFor(()=>f.item?.id==='t1'&&f.q('.thesis-export [data-template-summary]'));
 const creates=f.calls.filter(call=>call.path==='/theses'&&call.data);assert.equal(creates.length,1);assert.equal(creates[0].data.exportTemplateFileId,'draft-template');assert.equal(f.item.exportTemplate.source.fileId,'draft-template');assert.equal(f.calls.some(call=>/quote|generate|resume/.test(call.path)),false);
});

for(const failure of [false,true])test(`final template chooser immediately names the pending file and settles ${failure?'back to the retained template on failure':'on the saved choice'}`,async t=>{
 const f=draftFixture(t,{failure,stored:finalDraft()});await waitFor(()=>f.q('[data-thesis-create]'));
 let releaseRead;const readGate=new Promise(resolve=>{releaseRead=resolve;});
 const pendingFile={name:'新学校模板.docx',size:fixtureBytes.length,arrayBuffer:async()=>{await readGate;return fixtureBytes.buffer;}};
 try{
  select(f,'#writing-knowledge-template [data-template-file]',pendingFile);
  const panel=f.q('#writing-knowledge-template [data-template-panel]'),status=panel.querySelector('[data-template-status]');
  assert.equal(panel.getAttribute('aria-busy'),'true');
  assert.match(status.textContent,/新学校模板\.docx/);assert.match(status.textContent,/正在|保存|识别/);
  assert.equal(panel.querySelector('[data-template-choose]').disabled,true);
  assert.equal(panel.querySelector('[data-template-file]').disabled,true);
  assert.equal(f.saved().exportTemplate.source.fileId,'old-template');
 }finally{releaseRead();}
 await waitFor(()=>!f.q('#writing-knowledge-template [data-template-choose]').disabled);
 const panel=f.q('#writing-knowledge-template [data-template-panel]'),status=panel.querySelector('[data-template-status]');
 assert.notEqual(panel.getAttribute('aria-busy'),'true');
 assert.doesNotMatch(status.textContent,/正在.*(?:保存|识别)|(?:保存|识别).*中/);
 assert.equal(panel.querySelector('.thesis-template-current strong').textContent,failure?'原学校模板.docx':'新学校模板.docx');
 assert.equal(f.saved().exportTemplate.source.fileId,failure?'old-template':'draft-template');
 assert.match(status.textContent,failure?/原有模板保持不变/:/已保存/);
 assert.equal(f.calls.filter(call=>call.path==='/files').length,1);
 assert.equal(f.calls.some(call=>/quote|generate|resume/.test(call.path)),false);
});

test('account template selection names the pending upload beside the chooser and applies it once',async t=>{
 const f=accountFixture(t),api=f.ctx.api;let releaseUpload,uploadRequests=0;
 const uploadGate=new Promise(resolve=>{releaseUpload=resolve;});
 f.ctx.api=async(path,data)=>{if(path==='/files'){uploadRequests++;await uploadGate;}return api(path,data);};
 const stop=mountThesisStage({id:'t1',ctx:f.ctx,container:f.q('.dashboard'),onTemplateSaved:value=>f.changes.push(value)});await stop.ready;
 try{
  select(f,'[data-template-file]',file());
  let panel=f.q('[data-template-panel]');
  assert.equal(panel.getAttribute('aria-busy'),'true');
  assert.match(panel.querySelector('[data-template-status]').textContent,/新学校模板\.docx/);
  assert.match(panel.querySelector('[data-template-status]').textContent,/正在|保存|识别/);
  await waitFor(()=>uploadRequests===1);
  panel=f.q('[data-template-panel]');assert.equal(panel.querySelector('[data-template-choose]').disabled,true);assert.equal(panel.querySelector('[data-template-file]').disabled,true);
  assert.equal(f.item.exportTemplate.source.fileId,'old-template');
 }finally{releaseUpload();}
 await waitFor(()=>f.changes.at(-1)?.source?.fileId==='new-template'&&!f.q('[data-template-choose]').disabled);
 const panel=f.q('[data-template-panel]');assert.notEqual(panel.getAttribute('aria-busy'),'true');
 assert.equal(panel.querySelector('.thesis-template-current strong').textContent,'新学校模板.docx');
 assert.match(panel.querySelector('[data-template-status]').textContent,/已保存/);
 assert.equal(uploadRequests,1);assert.equal(f.calls.filter(call=>call.path==='/files').length,1);
 assert.equal(f.calls.filter(call=>call.path.endsWith('/export-template')&&call.data).length,1);
 assert.equal(f.calls.some(call=>/quote|generate|resume/.test(call.path)),false);
});

for(const mode of ['final draft','account'])for(const activation of ['showPicker','click fallback','blocked'])test(`${mode} template button uses ${activation} without a silent failure`,async t=>{
 let f,selector;
 if(mode==='account'){
  f=accountFixture(t);const stop=mountThesisStage({id:'t1',ctx:f.ctx,container:f.q('.dashboard')});await stop.ready;selector='[data-template-panel]';
 }else{
  f=draftFixture(t,{stored:finalDraft()});await waitFor(()=>f.q('[data-thesis-create]'));openDraftSettings(f);selector='#writing-knowledge-template [data-template-panel]';
 }
 const panel=f.q(selector),input=panel.querySelector('[data-template-file]');let nativeCalls=0,fallbackCalls=0;
 Object.defineProperty(input,'value',{configurable:true,writable:true,value:'previously-selected-template.docx'});
 Object.defineProperty(input,'showPicker',{configurable:true,value:activation==='click fallback'?undefined:()=>{nativeCalls++;if(activation==='blocked')throw new window.DOMException('File picker denied','SecurityError');}});
 input.click=()=>{fallbackCalls++;if(activation==='blocked')throw new window.DOMException('File picker denied','SecurityError');};
 panel.querySelector('[data-template-choose]').click();
 assert.equal(input.value,'');
 if(activation==='showPicker'){assert.equal(nativeCalls,1);assert.equal(fallbackCalls,0);}
 else if(activation==='click fallback'){assert.equal(nativeCalls,0);assert.equal(fallbackCalls,1);}
 else{
  assert.equal(nativeCalls,1);assert.match(f.q(selector+' [data-template-status]').textContent,/选择|浏览器|文件|模板/);
 }
 assert.notEqual(f.q(selector).getAttribute('aria-busy'),'true');
 assert.equal(f.calls.some(call=>call.path==='/files'||call.path.endsWith('/export-template')&&call.data),false);
 assert.equal(panel.querySelector('.thesis-template-current strong').textContent,'原学校模板.docx');
});

for(const closeEvent of ['cancel','change'])test(`account generation polling leaves an open native template chooser attached and resumes after ${closeEvent}`,async t=>{
 const scheduleTimeout=globalThis.setTimeout;let scheduledPoll;
 globalThis.setTimeout=(callback,delay,...args)=>delay===4000?(scheduledPoll=()=>callback(...args),{syntheticTemplatePoll:true}):scheduleTimeout(callback,delay,...args);
 t.after(()=>{globalThis.setTimeout=scheduleTimeout;});
 const record={...initial(),status:'running',job:{id:'job1',status:'running',stage:'generating_section',completedSections:0,totalSections:1}},f=accountFixture(t,{record}),api=f.ctx.api;
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
 let complete=false,reads=0;
 f.ctx.api=async(path,data)=>{if(path==='/theses/t1'&&!data){reads++;return {item:structuredClone(complete?{...f.item,status:'completed',job:{...f.item.job,status:'completed',completedSections:1}}:f.item)};}return api(path,data);};
 const stop=mountThesisStage({id:'t1',ctx:f.ctx,container:f.q('.dashboard')});await stop.ready;
 const input=f.q('[data-template-file]');input.showPicker=()=>{};f.q('[data-template-choose]').click();
 complete=true;assert.equal(typeof scheduledPoll,'function');await scheduledPoll();
 assert.equal(reads,1,'the generation poll must wait until native file selection closes');
 assert.equal(f.q('[data-template-file]'),input,'the actual input associated with the native dialog must remain connected');
 assert.equal(input.isConnected,true);
 if(closeEvent==='cancel')input.dispatchEvent(new window.Event('cancel',{bubbles:true}));
 else{select(f,'[data-template-file]',file());await waitFor(()=>f.item.exportTemplate.source.fileId==='new-template'&&!f.q('[data-template-choose]').disabled);}
 await scheduledPoll();
 assert.equal(reads,2,'polling resumes after the native chooser closes');
 assert.equal(f.q('[data-template-choose]').disabled,false);
 assert.equal(f.q('.thesis-template-current strong').textContent,closeEvent==='cancel'?'原学校模板.docx':'新学校模板.docx');
 assert.equal(f.calls.filter(call=>call.path==='/files').length,closeEvent==='cancel'?0:1);
 assert.equal(f.calls.filter(call=>call.path.endsWith('/export-template')&&call.data).length,closeEvent==='cancel'?0:1);
});

test('a poll already in flight cannot replace an open chooser or authorize overwriting an unseen template choice',async t=>{
 const scheduleTimeout=globalThis.setTimeout;let scheduledPoll;
 globalThis.setTimeout=(callback,delay,...args)=>delay===4000?(scheduledPoll=()=>callback(...args),{syntheticTemplatePoll:true}):scheduleTimeout(callback,delay,...args);
 t.after(()=>{globalThis.setTimeout=scheduleTimeout;});
 const record={...initial(),status:'running',job:{id:'job1',status:'running',stage:'generating_section',completedSections:0,totalSections:1}},f=accountFixture(t,{record,externalTemplateDuringUpload:true}),api=f.ctx.api;
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
 let holdNextRead=false,readStarted=false,releaseRead,reads=0;const readGate=new Promise(resolve=>{releaseRead=resolve;});
 f.ctx.api=async(path,data)=>{
  if(path==='/theses/t1'&&!data){reads++;if(holdNextRead){holdNextRead=false;readStarted=true;await readGate;return {item:{...structuredClone(f.item),version:4,exportTemplate:{...structuredClone(template),source:{...template.source,fileId:'external-template',name:'其他页面选中的模板.docx'}}}};}}
  return api(path,data);
 };
 const stop=mountThesisStage({id:'t1',ctx:f.ctx,container:f.q('.dashboard')});await stop.ready;
 holdNextRead=true;const inFlight=scheduledPoll();await waitFor(()=>readStarted);
 const input=f.q('[data-template-file]');input.showPicker=()=>{};f.q('[data-template-choose]').click();
 releaseRead();await inFlight;
 assert.equal(f.q('[data-template-file]'),input);assert.equal(input.isConnected,true);
 assert.equal(f.q('.thesis-template-current strong').textContent,'原学校模板.docx');
 select(f,'[data-template-file]',file());
 await waitFor(()=>/其他页面|版本已/.test(f.q('[data-template-status]')?.textContent||'')&&!f.q('[data-template-choose]').disabled);
 const mutation=f.calls.find(call=>call.path.endsWith('/export-template')&&call.data);
 assert.equal(mutation.data.expectedTemplateFileId,'old-template','selection must retain the template identity displayed when the native chooser opened');
 assert.equal(f.item.exportTemplate.source.fileId,'external-template');
 assert.equal(f.q('.thesis-template-current strong').textContent,'其他页面选中的模板.docx');
 assert.equal(f.calls.filter(call=>call.path.endsWith('/export-template')&&call.data).length,1);
 const previousReads=reads;await scheduledPoll();assert.equal(reads,previousReads+1,'normal generation polling resumes after the conflict');
 assert.equal(f.calls.some(call=>/quote|generate|resume/.test(call.path)),false);
});


for(const mode of ['final draft','account'])test(`${mode} can choose a different DOCX immediately after a template validation failure`,async t=>{
 let f,selector;
 if(mode==='account'){f=accountFixture(t);const stop=mountThesisStage({id:'t1',ctx:f.ctx,container:f.q('.dashboard')});await stop.ready;selector='[data-template-panel]';}
 else{f=draftFixture(t,{stored:finalDraft()});await waitFor(()=>f.q('[data-thesis-create]'));openDraftSettings(f);selector='#writing-knowledge-template [data-template-panel]';}
 const original=structuredClone(mode==='account'?f.item:f.saved()),parts=unzipSync(fixtureBytes);
 parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:body>','<w:body><w:p><w:fldSimple w:instr=" INCLUDETEXT &quot;https://example.test/external.docx&quot; "/></w:p>'));
 const invalidBytes=zipSync(parts),invalid={name:'含外部动态字段.docx',size:invalidBytes.length,arrayBuffer:async()=>invalidBytes.buffer};
 select(f,selector+' [data-template-file]',invalid);
 await waitFor(()=>/重新选择其他 DOCX 文件/.test(f.q(selector+' [data-template-status]')?.textContent||'')&&!f.q(selector+' [data-template-choose]').disabled);
 const retained=mode==='account'?f.item:f.saved();assert.equal(retained.exportTemplate.source.fileId,'old-template');
 assert.deepEqual(mode==='account'?retained.chapters:retained.bodySections,mode==='account'?original.chapters:original.bodySections);
 assert.equal(f.calls.filter(call=>call.path==='/files').length,0,'a rejected template is never uploaded');
 const retryInput=f.q(selector+' [data-template-file]');let chooserOpened=0;
 Object.defineProperty(retryInput,'value',{configurable:true,writable:true,value:invalid.name});retryInput.showPicker=()=>{chooserOpened++;};
 f.q(selector+' [data-template-choose]').click();assert.equal(chooserOpened,1);assert.equal(retryInput.value,'','retrying opens a fresh picker rather than retaining the rejected selection');
 select(f,selector+' [data-template-file]',file());
 const expectedId=mode==='account'?'new-template':'draft-template';
 await waitFor(()=>(mode==='account'?f.item:f.saved())?.exportTemplate?.source?.fileId===expectedId&&!f.q(selector+' [data-template-choose]').disabled);
 const applied=mode==='account'?f.item:f.saved();assert.equal(applied.exportTemplate.source.fileId,expectedId);assert.match(f.q(selector+' [data-template-status]').textContent,/已保存/);
 assert.deepEqual(mode==='account'?applied.chapters:applied.bodySections,mode==='account'?original.chapters:original.bodySections);
 assert.equal(f.calls.filter(call=>call.path==='/files').length,1);
 assert.equal(f.calls.filter(call=>call.path.endsWith('/export-template')&&call.data).length,mode==='account'?1:0);
 assert.equal(f.calls.some(call=>/quote|generate|resume/.test(call.path)),false);
});
