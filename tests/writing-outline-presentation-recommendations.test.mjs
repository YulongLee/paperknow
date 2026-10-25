import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {database} from '../backend/database.mjs';
import {createThesisService} from '../backend/thesis-service.mjs';
import {thesisPlan,thesisAgentTask} from '../backend/thesis-model.mjs';
import {thesisReference,thesisResearchText} from './helpers/thesis-flow.mjs';

const settle=async()=>{for(let i=0;i<14;i++)await new Promise(resolve=>setImmediate(resolve));};
const off=()=>({table:false,image:false,formula:false,code:false});
const flags=selection=>({...off(),...selection});
const controls=(id,key)=>`[data-outline-row-id="${id}"] [data-outline-presentation${key?'="'+key+'"':''}]`;
const outlineText='第一章 研究背景\n1.1 研究背景与问题\n第二章 研究方法与技术路线\n2.1 拟开展的研究流程\n2.2 方案对比与变量定义\n第三章 评价指标与公式\n3.1 指标计算公式\n第四章 核心算法实现与伪代码\n参考文献';
function modelItem({explicit=true,allFalse=false}={}){
 const choose=selection=>explicit?{presentation:allFalse?off():flags(selection)}:{};
 const chapters=[
  {id:'intro',title:'研究背景',targetWords:1000,...choose({table:true,image:true,formula:true,code:true}),sections:[{id:'intro-a',title:'研究背景与问题',targetWords:1000,...choose({})}]},
  {id:'method',title:'研究方法与技术路线',targetWords:2500,sections:[{id:'flow',title:'拟开展的研究流程',targetWords:1500,...choose({image:true})},{id:'comparison',title:'方案对比与变量定义',targetWords:1000,...choose({table:true})}]},
  {id:'metrics',title:'评价指标与公式',targetWords:2000,sections:[{id:'formula',title:'指标计算公式',targetWords:2000,...choose({formula:true})}]},
  {id:'algorithm',title:'核心算法实现与伪代码',targetWords:2500,...choose({code:true}),sections:[]},
  {id:'references',title:'参考文献',kind:'references',targetWords:0,...choose({table:true,image:true,formula:true,code:true}),sections:[]}
 ];
 return {id:'synthetic-outline-recommendations',status:'completed',stage:'completed',output:{text:outlineText,chapters}};
}
function draft(extra={}){
 return {id:'recommendation-draft',tool:'writing',title:'图神经网络课堂反馈模型设计（合成验收）',degree:'本科',major:'计算机科学与技术',language:'中文',targetWords:8000,formula:'text',workflowStage:4,workflowUnlockedStage:4,outlineConfirmed:false,outlineText:'',outlineRows:[],writingReferences:[{...thesisReference}],knowledgeFiles:[{id:'synthetic-notes',name:'合成设计记录',text:thesisResearchText}],bodySections:[],...extra};
}
function fixture(t,{item=modelItem(),initial=draft(),service=null}={}){
 const dom=new JSDOM('<aside class="sidebar"></aside><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.test/workspace.html#tool/writing'});
 for(const key of ['window','document','localStorage','FormData','location','AbortController'])globalThis[key]=dom.window[key];
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{};dom.window.confirm=()=>true;document.querySelector('dialog').close=()=>{};
 const user={id:'outline-recommendation-owner'},calls=[],$=selector=>document.querySelector(selector);
 localStorage.setItem('paperknow-drafts',JSON.stringify([initial]));
 const ctx={notify(){},session:async()=>({status:'ready',user}),modal:(_,html)=>$('#workspace-dialog-body').innerHTML=html,api:async(path,data)=>{
  calls.push({path,data});if(path==='/auth/me')return{user};
  if(path==='/theses/outlines/capabilities')return{ready:true,billingService:'agent'};
  if(path==='/billing/quote')return{type:'agent',source:'credits',title:'合成提纲生成',creditCost:10,token:'synthetic-outline-quote',expiresAt:new Date(Date.now()+300000).toISOString()};
  if(path==='/theses/outlines')return{item:structuredClone({...item,id:item.id+'-'+calls.filter(row=>row.path===path).length})};
  if(path==='/capabilities')return{thesis:{ready:false}};
  if(service){const result=await service.handle({path:'/api'+path,method:data===undefined?'GET':'POST',user,readBody:async()=>data});if(result)return result.value;}
  throw Error('Unexpected synthetic API: '+path);
 }};
 const f={dom,user,calls,ctx,$,initial,input(selector,value,event='input'){
  const node=$(selector);assert.ok(node,selector);if(node.type==='checkbox')node.checked=Boolean(value);else node.value=String(value);node.dispatchEvent(new window.Event(event,{bubbles:true}));
 },save(){assert.equal(flushEditorDraft(),true);const rows=JSON.parse(localStorage.getItem('paperknow-drafts'));assert.equal(rows.length,1);return rows[0];},mount(){mountWriting(initial.id,undefined,ctx);},remount(saved){clearEditor();mountWriting(saved.id,undefined,ctx);},close(){clearEditor();disposeOnlineThesis();dom.window.close();}};
 if(t)t.after(()=>f.close());return f;
}
const bootstrap=fixture();
const {mountWriting}=await import('../dist/workspace/writing.mjs');
const {clearEditor,flushEditorDraft}=await import('../dist/workspace/edit-guard.mjs');
const {disposeOnlineThesis}=await import('../dist/workspace/thesis-online.mjs');
bootstrap.close();

async function adopt(f){
 f.$('#outline-ai-generate').click();await settle();
 assert.equal(f.$('[data-outline-ai-start]'),null);
 const apply=f.$('[data-outline-ai-apply]');assert.ok(apply,'The actual controller must reach a completed preview');assert.equal(apply.disabled,false);apply.click();await settle();
}
const savedFlags=row=>flags(row?.presentation);
const allBoxes=()=>[...document.querySelectorAll('[data-outline-presentation]')];
function chosen(id,key){const box=document.querySelector(controls(id,key));assert.ok(box,`${id}:${key}`);return box.checked;}
function assertNoChoices(){assert.ok(allBoxes().length);assert.ok(allBoxes().every(node=>!node.checked));}

test('adopting a new AI outline preserves model leaf choices, enables rich content and never grants parent or reference inheritance',async t=>{
 const f=fixture(t);f.mount();assert.equal(f.$('#writing-formula').value,'text');assert.equal(f.$('#outline-paper .outline-row-title'),null);
 await adopt(f);const saved=f.save();assert.equal(saved.formula,'rich');assert.equal(saved.writingEditorState.inputs['writing-formula'],'rich');
 for(const [id,key] of [['flow','image'],['comparison','table'],['formula','formula'],['algorithm','code']])assert.equal(chosen(id,key),true);
 assert.deepEqual(savedFlags(saved.outlineRows.find(row=>row.id==='intro-a')),off(),'explicit all-false leaf selection must not inherit the parent');
 for(const id of ['intro','method','metrics','references'])assert.equal(document.querySelectorAll(controls(id)).length,0);
 assert.equal(saved.outlineRows.find(row=>row.id==='references').words,0);assert.equal(savedFlags(saved.outlineRows.find(row=>row.id==='references')).image,false);
 assert.equal(saved.outlineRows.reduce((sum,row)=>sum+row.words,0),8000);assert.equal(f.calls.filter(row=>row.path==='/theses/outlines').length,1);
});

test('an AI result with no presentation fields receives structural recommendations without an extra model call',async t=>{
 const f=fixture(t,{item:modelItem({explicit:false})});f.mount();await adopt(f);const saved=f.save();
 assert.equal(saved.formula,'rich');assert.ok(allBoxes().some(box=>box.checked));
 assert.ok(saved.outlineRows.some(row=>Object.values(row.presentation||{}).some(Boolean)));
 assert.equal(document.querySelectorAll(controls('method')).length,0);assert.equal(document.querySelectorAll(controls('references')).length,0);
 assert.equal(saved.outlineRows.reduce((sum,row)=>sum+row.words,0),8000);assert.equal(f.calls.filter(row=>row.path==='/theses/outlines').length,1);
});

test('explicit model all-false leaves remain all false instead of receiving missing-field fallback',async t=>{
 const f=fixture(t,{item:modelItem({allFalse:true})});f.mount();await adopt(f);assertNoChoices();
 const saved=f.save();for(const id of ['intro-a','flow','comparison','formula','algorithm'])assert.deepEqual(savedFlags(saved.outlineRows.find(row=>row.id===id)),off());
});

test('manual changes survive title and word edits, reorder, stage switching, redistribution and remount without being recommended again',async t=>{
 const f=fixture(t);f.mount();await adopt(f);
 const image=f.$(controls('flow','image'));image.focus();f.input(controls('flow','image'),false,'change');assert.equal(document.activeElement,image);
 f.input(controls('flow','table'),true,'change');f.input('[data-outline-row-id="flow"] .outline-row-title','2.1 算法模型与技术路线');
 f.$('[data-outline-row-id="comparison"] [data-outline-action="up"]').click();
 f.$('[data-writing-step="3"]').click();f.$('[data-writing-step="4"]').click();assert.equal(chosen('flow','image'),false);assert.equal(chosen('flow','table'),true);
 f.input('#writing-target',12000,'change');f.$('[data-outline-auto]').click();
 let saved=f.save();assert.equal(saved.outlinePresentationMode,'manual');assert.equal(saved.outlineRows.reduce((sum,row)=>sum+row.words,0),12000);assert.equal(chosen('flow','image'),false);
 const rowFlags=Object.fromEntries(saved.outlineRows.map(row=>[row.id,savedFlags(row)]));f.remount(saved);await settle();saved=f.save();
 assert.equal(saved.outlinePresentationMode,'manual');assert.deepEqual(Object.fromEntries(saved.outlineRows.map(row=>[row.id,savedFlags(row)])),rowFlags);
 assert.equal(chosen('flow','image'),false);assert.equal(chosen('flow','table'),true);assert.equal(f.calls.filter(row=>row.path==='/theses/outlines').length,1);
});

for(const method of ['button','content-mode'])test(`explicit pure-text choice via ${method} survives a new AI adoption; a deliberate recommendation can enable content again`,async t=>{
 const f=fixture(t);f.mount();await adopt(f);
 if(method==='button')f.$('[data-outline-text-only]').click();else f.input('#writing-formula','text','change');
 assertNoChoices();let saved=f.save();assert.equal(saved.formula,'text');assert.equal(saved.outlinePresentationMode,'text');
 f.remount(saved);await settle();assertNoChoices();await adopt(f);assertNoChoices();saved=f.save();assert.equal(saved.formula,'text');assert.equal(saved.outlinePresentationMode,'text');
 const before={text:saved.outlineText,body:saved.bodySections,versions:saved.versions,words:saved.outlineRows.map(row=>row.words)};
 const recommend=f.$('[data-outline-recommend]');assert.ok(recommend);recommend.click();assert.ok(allBoxes().some(box=>box.checked));saved=f.save();
 assert.equal(saved.formula,'rich');assert.notEqual(saved.outlinePresentationMode,'text');assert.equal(saved.outlineText,before.text);assert.deepEqual(saved.bodySections,before.body);assert.deepEqual(saved.versions,before.versions);assert.deepEqual(saved.outlineRows.map(row=>row.words),before.words);
 assert.equal(f.calls.filter(row=>row.path==='/theses/outlines').length,2,'local recommendations must not call the model');
});

for(const source of ['local','model','uploaded','pasted'])test(`restoring a ${source} legacy outline never automatically changes its absent choices`,async t=>{
 const initial=draft({outlineSource:source,outlineText:'第一章 技术路线\n1.1 研究流程与模型公式\n第二章 算法实现与伪代码',outlineRows:[{id:'old-parent',title:'第一章 技术路线',level:1,words:0},{id:'old-section',title:'1.1 研究流程与模型公式',level:2,words:4000},{id:'old-leaf',title:'第二章 算法实现与伪代码',level:1,words:4000}]});
 const f=fixture(t,{initial});f.mount();assertNoChoices();const saved=f.save();assert.equal(saved.formula,'text');assert.ok(saved.outlineRows.every(row=>!row.presentation));assert.equal(f.calls.filter(row=>row.path==='/theses/outlines').length,0);
});

for(const source of ['paste','upload'])test(`a new ${source} outline is not silently assigned AI recommendations`,async t=>{
 const f=fixture(t);f.mount();const text='第一章 技术路线\n1.1 研究流程与模型公式\n第二章 算法实现与伪代码';
 if(source==='paste'){f.input('#outline-source-input',text);f.$('#outline-paste-apply').click();}else{const input=f.$('#outline-file');Object.defineProperty(input,'files',{configurable:true,value:[{name:'synthetic-outline.txt',size:new TextEncoder().encode(text).length,text:async()=>text}]});input.dispatchEvent(new window.Event('change',{bubbles:true}));await settle();}
 assertNoChoices();assert.equal(f.save().formula,'text');assert.equal(f.calls.filter(row=>row.path==='/theses/outlines').length,0);
});

test('recommended AI controls and user corrections reach the actual saved thesis snapshot and current-unit instructions while existing content stays intact',async t=>{
 const db=database(':memory:');db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run('outline-recommendation-owner','合成验收账户','user',new Date().toISOString());t.after(()=>db.close());
 const service=createThesisService(db),retained=[{id:'intro',title:'第一章 研究背景',text:'已保存的合成正文不能因提纲推荐而删除。'}],versions=[{id:'existing-version',text:'已保存的合成历史版本。'}],f=fixture(t,{service,initial:draft({bodySections:retained,versions})});
 f.mount();await adopt(f);f.input(controls('flow','image'),false,'change');f.input(controls('comparison','formula'),true,'change');let saved=f.save();
 assert.deepEqual(saved.bodySections,retained);assert.deepEqual(saved.versions,versions);
 f.$('#outline-confirm').click();await settle();assert.equal(f.$('.dashboard').dataset.writingStage,'5');const create=f.$('[data-thesis-create]');assert.ok(create);create.click();await settle();
 const request=f.calls.find(row=>row.path==='/theses'&&row.data);assert.ok(request,'The real thesis stage must send the configured outline');
 const stored=db.prepare('SELECT id FROM theses').get();assert.ok(stored,f.$('.dashboard').textContent);const item=service.get(stored.id,f.user),plan=thesisPlan(item.snapshot);
 assert.equal(item.snapshot.requirements.contentMode,'rich');
 for(const [id,expected] of [['intro-a',off()],['flow',off()],['comparison',flags({table:true,formula:true})],['formula',flags({formula:true})],['algorithm',flags({code:true})]]){
  const units=plan.filter(unit=>unit.sectionId===id);assert.ok(units.length,id);for(const unit of units)assert.deepEqual(thesisAgentTask(item.snapshot,unit,[]).context.unit.presentation,expected);
 }
 assert.ok(plan.every(unit=>unit.chapterId!=='references'));saved=f.save();assert.ok(saved.bodySections.some(row=>row.id==='intro'&&row.text===retained[0].text));assert.deepEqual(saved.versions,versions);
 assert.equal(f.calls.filter(row=>row.path==='/billing/quote').length,1,'confirmation and local preference changes must not buy another generation');
});
