import {confirmThesisMaterials,confirmThesisResearch,completeThesisDraft} from './helpers/thesis-flow.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';
import {assessThesisEvidence} from '../dist/workspace/thesis-evidence.mjs';

const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(){
 const dom=new JSDOM('<aside class="sidebar"></aside><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.cn/workspace.html#tool/writing'});
 for(const key of ['window','document','localStorage','FormData','location','AbortController'])globalThis[key]=dom.window[key];
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{};document.querySelector('dialog').close=()=>{};
 const ctx={notify(){},session:async()=>({status:'guest',user:null})};
 const $=selector=>document.querySelector(selector),input=(selector,value)=>{$(selector).value=value;$(selector).dispatchEvent(new window.Event('input',{bubbles:true}));};
 const selectFile=(selector,file)=>{Object.defineProperty($(selector),'files',{configurable:true,value:[file]});$(selector).dispatchEvent(new window.Event('change',{bubbles:true}));};
 return {dom,ctx,$,input,selectFile,save(){assert.equal(flushEditorDraft(),true);return JSON.parse(localStorage.getItem('paperknow-drafts'))[0];},close(){clearEditor();dom.window.close();}};
}
const bootstrap=fixture();
const {mountWriting}=await import('../dist/workspace/writing.mjs');
const {clearEditor,flushEditorDraft}=await import('../dist/workspace/edit-guard.mjs');
bootstrap.close();

for(const source of ['model','uploaded','pasted'])test(`returning through Step 2 preserves the ${source} outline, allocation and existing body`,async()=>{
 const f=fixture();let confirmations=0;f.dom.window.confirm=()=>{confirmations++;return true;};
 try{
  const outline='第一章 专属研究结构\n1.1 专属研究对象',row={id:'existing',tool:'writing',title:'现有研究主题',targetWords:8000,workflowStage:2,writingResume:true,outlineText:outline,outlineSource:source,outlineFileName:source==='uploaded'?'本人提纲.txt':'',outlineRows:[{id:'c1',title:'第一章 专属研究结构',level:1,words:0},{id:'s1',title:'1.1 专属研究对象',level:2,words:8000}],bodySections:[{id:'c1',title:'第一章 专属研究结构',text:'已经保存的章节正文。'}]};
  Object.assign(row,completeThesisDraft(row));localStorage.setItem('paperknow-drafts',JSON.stringify([row]));mountWriting(row.id,undefined,f.ctx);
  f.$('#writing-material-confirm').click();await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'3');assert.equal(confirmations,0,'ordinary continuation is not a replacement operation');
  let saved=f.save();assert.equal(saved.outlineText,outline);assert.equal(saved.outlineSource,source);assert.deepEqual(saved.outlineRows,row.outlineRows);assert.deepEqual(saved.bodySections,row.bodySections);assert.equal(saved.outlineFileName,row.outlineFileName);
  f.$('#writing-reference-confirm').click();await settle();assert.match(f.$('#outline-paper .outline-row-title').value,/专属研究结构/);saved=f.save();assert.equal(saved.outlineRows[1].words,8000);
 }finally{f.close();}
});

test('Step 2 confirmation records the latest user supplement without promoting the separate AI proposal to evidence',async()=>{
 const f=fixture();
 try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','真实案例研究');f.$('#writing-generate').click();
  f.input('#knowledge-ai-input','本人的真实研究对象和资料范围');f.$('#writing-material-confirm').click();await settle();
  let saved=f.save();assert.equal(saved.knowledgeFiles.length,1);assert.equal(saved.knowledgeFiles[0].text,'本人的真实研究对象和资料范围');
  const snapshot=thesisSnapshotFromDraft({...saved,outlineRows:[{id:'c1',title:'研究设计',level:1,words:8000}],methodSuggestion:{text:'拟开展访谈，尚未取得数据',jobId:'ai-plan'}});
  assert.equal(snapshot.materials[0].text,'本人的真实研究对象和资料范围');assert.equal(snapshot.requirements.researchPlan.status,'proposed');assert.ok(snapshot.materials.every(row=>!row.text.includes('拟开展访谈')));
  f.$('[data-writing-step="2"]').click();f.input('#knowledge-ai-input','用户更新后的真实研究说明');f.$('#writing-material-confirm').click();await settle();saved=f.save();assert.equal(saved.knowledgeFiles.length,1);assert.equal(saved.knowledgeFiles[0].text,'用户更新后的真实研究说明');
 }finally{f.close();}
});

function materialDraft(){return {id:'materials',tool:'writing',title:'研究资料删除验收',workflowStage:2,writingResume:true,targetWords:8000,material:'上传的独立资料\n\n之前记录的本人研究说明',fileName:'研究材料.txt',knowledgeFiles:[{id:'upload',name:'研究材料.txt',purpose:'已有草稿',text:'上传的独立资料',state:'parsed',kind:'file'},{id:'note',name:'用户研究说明',purpose:'研究背景与方法',text:'之前记录的本人研究说明',state:'edited',kind:'ai'}],methodSuggestion:{text:'拟开展但尚未实施的访谈方案',jobId:'plan-only'}};}

for(const action of ['remove','clear'])test(`Step 2 ${action} permanently removes the user explanation while preserving uploaded evidence and the separate AI proposal`,async()=>{
 const f=fixture();
 try{
  const row=materialDraft();localStorage.setItem('paperknow-drafts',JSON.stringify([row]));mountWriting(row.id,undefined,f.ctx);
  assert.equal(f.$('#knowledge-ai-input').value,'之前记录的本人研究说明','legacy recorded explanations initially populate the editor');
  if(action==='remove')f.$('[data-knowledge-action="remove"][data-knowledge-id="note"]').click();else f.input('#knowledge-ai-input','');
  assert.equal(f.$('#knowledge-ai-input').value,'','rendering must not refill an explicitly removed or cleared explanation');
  f.$('#writing-material-confirm').click();await settle();let saved=f.save();
  assert.deepEqual(saved.knowledgeFiles,row.knowledgeFiles.filter(item=>item.kind==='file'));assert.equal(saved.material,'上传的独立资料');assert.deepEqual(saved.methodSuggestion,row.methodSuggestion);
  const snapshot=thesisSnapshotFromDraft({...saved,outlineRows:[{id:'c1',title:'研究设计',level:1,words:8000}]});assert.deepEqual(snapshot.materials.map(item=>item.text),['上传的独立资料']);assert.equal(snapshot.requirements.researchPlan.text,row.methodSuggestion.text);assert.equal(snapshot.requirements.researchPlan.status,'proposed');
  f.$('[data-writing-step="2"]').click();assert.equal(f.$('#knowledge-ai-input').value,'');saved=f.save();clearEditor();mountWriting(saved.id,undefined,f.ctx);assert.equal(f.$('#knowledge-ai-input').value,'');assert.doesNotMatch(f.$('#writing-material-summary').textContent,/之前记录的本人研究说明/);
 }finally{f.close();}
});

test('a saved empty explanation stays empty on restoration until confirmation removes its earlier recorded version',async()=>{
 const f=fixture();
 try{
  const row={...materialDraft(),writingEditorState:{inputs:{'knowledge-ai-input':''}}};localStorage.setItem('paperknow-drafts',JSON.stringify([row]));mountWriting(row.id,undefined,f.ctx);
  assert.equal(f.$('#knowledge-ai-input').value,'');f.$('#writing-material-confirm').click();await settle();assert.deepEqual(f.save().knowledgeFiles,row.knowledgeFiles.filter(item=>item.kind==='file'));
 }finally{f.close();}
});

test('removing an uploaded document preserves the recorded user explanation and independent AI proposal',async()=>{
 const f=fixture();
 try{
  const row=materialDraft();localStorage.setItem('paperknow-drafts',JSON.stringify([row]));mountWriting(row.id,undefined,f.ctx);f.$('[data-knowledge-action="remove"][data-knowledge-id="upload"]').click();
  assert.equal(f.$('#knowledge-ai-input').value,'之前记录的本人研究说明');f.$('#writing-material-confirm').click();await settle();const saved=f.save();assert.equal(saved.knowledgeFiles.length,1);assert.equal(saved.knowledgeFiles[0].id,'note');assert.equal(saved.knowledgeFiles[0].text,'之前记录的本人研究说明');assert.deepEqual(saved.methodSuggestion,row.methodSuggestion);
 }finally{f.close();}
});

for(const action of ['remove','clear'])test(`Step 2 ${action} of its only recorded explanation does not resurrect it as a legacy material`,async()=>{
 const f=fixture();
 try{
  const base=materialDraft(),row={...base,material:base.knowledgeFiles[1].text,fileName:'',knowledgeFiles:base.knowledgeFiles.filter(item=>item.kind==='ai')};localStorage.setItem('paperknow-drafts',JSON.stringify([row]));mountWriting(row.id,undefined,f.ctx);
  if(action==='remove')f.$('[data-knowledge-action="remove"][data-knowledge-id="note"]').click();else f.input('#knowledge-ai-input','');
  f.$('#writing-material-confirm').click();await settle();const saved=f.save();assert.deepEqual(saved.knowledgeFiles,[]);assert.equal(saved.material,'');assert.deepEqual(saved.methodSuggestion,row.methodSuggestion);assert.deepEqual(thesisSnapshotFromDraft({...saved,outlineRows:[{id:'c1',title:'研究设计',level:1,words:8000}]}).materials,[]);
 }finally{f.close();}
});

test('the optional knowledge skip advances and records entered supplement without creating a generation or paid request',async()=>{
 const f=fixture(),calls=[];f.ctx.api=async(path,data)=>{calls.push({path,data});throw Error('Skipping optional materials must not call a model or paid service');};
 try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','跳过可选研究资料');f.$('#writing-generate').click();const explanation='这里只比较公开的研究方法';f.input('#knowledge-ai-input',explanation);assert.equal(f.$('#writing-material-skip').hidden,false);f.$('#writing-material-skip').click();await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'3');
  const saved=f.save();assert.equal(saved.knowledgeFiles.length,1);assert.equal(saved.knowledgeFiles[0].text,explanation);assert.equal(saved.writingEditorState.inputs['knowledge-ai-input'],explanation);assert.equal(saved.workflowUnlockedStage,3);assert.deepEqual(calls,[]);
  const snapshot=thesisSnapshotFromDraft({...saved,outlineRows:[{id:'c1',title:'研究设计',level:1,words:8000}]});assert.equal(snapshot.materials[0].text,explanation);assert.equal(assessThesisEvidence(snapshot).ready,false,'a short optional explanation cannot pass source validation before generation');
 }finally{f.close();}
});

test('a reference file finishing after switching drafts never changes the replacement editor or its saved references',async()=>{
 const f=fixture();let resolve;
 try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','先前论文');f.$('#writing-generate').click();confirmThesisMaterials();
  const pending=new Promise(done=>{resolve=done;});f.selectFile('#writing-reference-file',{name:'old-references.json',size:100,text:()=>pending});
  clearEditor();localStorage.removeItem('paperknow-drafts');location.hash='tool/writing?new=replacement';mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','新的论文');
  resolve(JSON.stringify([{id:'old-ref',title:'不应进入新论文的文献',authors:'Old Author',year:'2025'}]));await settle();
  assert.equal(f.$('#writing-title').value,'新的论文');assert.doesNotMatch(f.$('#writing-reference-list').textContent,/不应进入新论文/);assert.equal(f.$('#writing-reference-status').textContent,'');assert.deepEqual(f.save().writingReferences,[]);
 }finally{f.close();}
});

test('text outline import succeeds and an import finishing after a draft switch cannot replace the new outline',async()=>{
 const f=fixture();let resolve;
 try{
  mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','文本提纲导入');f.$('#writing-generate').click();await confirmThesisResearch();
  f.selectFile('#outline-file',{name:'my-outline.txt',size:100,text:async()=>'第一章 文本导入的专属结构\n1.1 真实研究对象'});await settle();assert.match(f.$('#outline-paper .outline-row-title').value,/文本导入的专属结构/);
  const pending=new Promise(done=>{resolve=done;});f.selectFile('#outline-file',{name:'old-outline.txt',size:100,text:()=>pending});
  clearEditor();localStorage.removeItem('paperknow-drafts');location.hash='tool/writing?new=other';mountWriting(undefined,undefined,f.ctx);f.input('#writing-title','新的独立论文');
  resolve('第一章 不能跨论文覆盖\n1.1 先前论文的内容');await settle();
  assert.equal(f.$('#writing-title').value,'新的独立论文');assert.doesNotMatch(f.$('#outline-paper').textContent,/不能跨论文覆盖/);assert.equal(f.$('#outline-builder-status').textContent,'请选择 AI 生成专属提纲或上传已有提纲。');assert.equal(f.save().outlineText,'');
 }finally{f.close();}
});
