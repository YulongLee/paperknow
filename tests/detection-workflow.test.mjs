import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDetectionWorkflow} from '../dist/workspace/detection-workflow.mjs';
import {mountAigcDetection} from '../dist/workspace/aigc-detection.mjs';
import {mountWebSimilarity} from '../dist/workspace/web-similarity.mjs';

const text='本研究讨论课程教学反馈与学习过程的关系，保留真实研究材料、样本记录和分析方法，并核对文献引用与原始数据。所有检测结果均应结合实际正文和研究背景理解。';
const flush=async()=>{for(let i=0;i<24;i++)await new Promise(resolve=>setImmediate(resolve));};
const response=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>({ownerId:'owner-1',...value})});
async function fixture(t,kind,{importDocument}={}){
 const ai=kind==='aigc',prefix=ai?'aigc':'web',base=ai?'/api/aigc-detections':'/api/web-similarity',dom=new JSDOM('<main class="dashboard"><div id="host"></div></main>',{url:'https://paperknow.test/workspace.html#category/detection'}),doc=dom.window.document,calls=[];
 let state=ai?'running':'queued',reportFails=false,owner='owner-1';
 const cap={ready:true,pointsCharged:true,creditCost:500,pricingVersion:11,bundleUsageSupported:true,maxCharacters:20000,maxPartCharacters:5000,userDailyLimit:10};
 const item=()=>ai?{id:'task-1',status:state==='queued'?'running':state,characters:Array.from(text).length,partCount:1,completedParts:state==='completed'?1:0,reportAvailable:state==='completed',parts:state==='completed'?[{index:0,start:0,end:Array.from(text).length,characters:Array.from(text).length,label:'ugc',confidence:90}]:[],verdict:'ugc'}:{id:'task-1',status:state,stage:state,title:'检测合成论文',characters:Array.from(text).length};
 const report={id:'report-1',mode:'web',title:'检测合成论文',ratio:0,totalChars:Array.from(text).length,similarChars:0,sourceCount:0,sections:[{id:'s1',title:'正文',included:true,paragraphs:[{id:'p1',text,matches:[]}]}],sources:[],web:{fetchedSources:1,totalParagraphs:1,sampledParagraphs:1,searchComplete:true}};
 const fetchImpl=async(url,init={})=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,body});
  if(url==='/api/auth/me')return response({user:{id:owner}});
  if(url==='/api/capabilities')return response({[ai?'aigcDetection':'webSimilarity']:cap});
  if(url===base&&!body)return response({items:[]});
  if(url===base&&body)return response(ai?item():{item:item()},202);
  if(url===base+'/task-1')return response(ai?item():{item:item()});
  if(url===base+'/task-1/report')return reportFails?response({error:'not ready'},503):response(ai?{item:item(),text}:{report});
  throw Error('Unexpected route: '+url);
 };
 const panel=(ai?mountAigcDetection:mountWebSimilarity)({container:doc.querySelector('#host'),fetchImpl,importDocument,uuid:()=> 'stable-key',pollInterval:600000}),$=selector=>doc.querySelector(selector);
 t.after(()=>{panel.dispose();dom.window.close();});await panel.ready;
 return {dom,doc,panel,$,calls,prefix,base,setState:value=>state=value,setReportFails:value=>reportFails=value,setOwner:value=>owner=value,input(value){const node=$(`[data-${prefix}-text]`);node.value=value;node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));},phase:()=>$('[data-detection-workflow]').dataset.phase,posts:()=>calls.filter(row=>row.body)};
}

for(const kind of ['similarity','aigc']){
 test(kind+' guides prepare, import and review without submitting or replacing existing controls',async t=>{
  let release;const f=await fixture(t,kind,{importDocument:()=>new Promise(resolve=>release=resolve)}),input=f.$(`[data-${f.prefix}-text]`),root=f.$('[data-detection-workflow]');
  assert.equal(root.querySelectorAll('[data-workflow-step]').length,4);assert.equal(f.phase(),'prepare');assert.equal(f.$('[data-workflow-step="report"]').disabled,true);
  const file=f.$(`[data-${f.prefix}-file]`);Object.defineProperty(file,'files',{configurable:true,value:[{name:'合成论文.docx',size:128}]});file.dispatchEvent(new f.dom.window.Event('change'));await flush();assert.equal(f.phase(),'importing');
  release({text});await flush();assert.equal(f.phase(),'review');assert.equal(input.value,text);assert.equal(f.$(`[data-${f.prefix}-text]`),input);
  let scrolls=0;input.scrollIntoView=()=>scrolls++;f.$('[data-workflow-step="review"]').click();assert.equal(scrolls,1);assert.equal(f.doc.activeElement,input);assert.equal(f.posts().length,0);
  assert.match(f.$('[data-workflow-hint]').textContent,/核对/);assert.equal(f.$('[data-workflow-step="processing"]').disabled,true);
 });
 test(kind+' follows one paid submission through stable progress, report completion and a new manuscript',async t=>{
  const f=await fixture(t,kind);f.input(text);const root=f.$('[data-detection-workflow]'),buttons=[...root.querySelectorAll('button')],input=f.$(`[data-${f.prefix}-text]`);
  f.$(`[data-${f.prefix}-start]`).click();f.$(`[data-${f.prefix}-start]`).click();await flush();
  assert.ok(['queued','running'].includes(f.phase()));assert.equal(root.dataset.currentStep,'3');assert.equal(f.$('[data-workflow-step="report"]').disabled,true);assert.equal(f.posts().length,1);assert.equal(f.posts()[0].body.expectedCreditCost,500);assert.equal(f.posts()[0].body.pricingVersion,11);
  f.setState('running');f.$(`[data-${f.prefix}-refresh]`).click();await flush();assert.equal(f.phase(),'running');assert.deepEqual([...root.querySelectorAll('button')],buttons);assert.equal(f.$(`[data-${f.prefix}-text]`),input);
  f.setState('completed');f.$(`[data-${f.prefix}-refresh]`).click();await flush();assert.equal(f.phase(),'complete');assert.equal(root.dataset.currentStep,'4');assert.equal(f.$('[data-workflow-step="report"]').disabled,false);
  let reportScrolls=0;f.$(`[data-${f.prefix}-result]`).scrollIntoView=()=>reportScrolls++;f.$('[data-workflow-step="report"]').click();assert.equal(reportScrolls,1);assert.equal(f.posts().length,1);
  f.input(text+'新加入的研究说明。');assert.equal(f.phase(),'review');assert.match(f.$('[data-workflow-hint]').textContent,/正文已更新.*尚未/);assert.equal(f.$('[data-workflow-step="report"]').disabled,false);assert.equal(f.posts().length,1);
 });
 test(kind+' never marks a missing report or failed task complete, and report retry does not create another charge',async t=>{
  const f=await fixture(t,kind);f.input(text);f.$(`[data-${f.prefix}-start]`).click();await flush();f.setState('completed');f.setReportFails(true);f.$(`[data-${f.prefix}-refresh]`).click();await flush();
  assert.equal(f.phase(),'report_pending');assert.equal(f.$('[data-workflow-step="report"]').disabled,true);assert.equal(f.$('[data-detection-workflow]').dataset.currentStep,'3');
  f.setReportFails(false);f.$(`[data-${f.prefix}-refresh]`).click();await flush();assert.equal(f.phase(),'complete');assert.equal(f.posts().length,1);
  f.setState('failed');f.$(`[data-${f.prefix}-refresh]`).click();await flush();assert.equal(f.phase(),'failed');assert.equal(f.$('[data-workflow-step="report"]').disabled,true);assert.match(f.$('[data-workflow-hint]').textContent,/未完成/);assert.equal(f.posts().length,1);
 });
}
test('workflow navigation and updates keep DOM identity, disclose no content and stop after disposal',()=>{
 const dom=new JSDOM('<div id="host"></div><textarea id="text">私有研究正文</textarea>'),host=dom.window.document.querySelector('#host'),input=dom.window.document.querySelector('#text'),workflow=createDetectionWorkflow(host,{targets:{review:()=>input}});
 try{workflow.update({phase:'review',hasText:true,valid:true});const button=host.querySelector('[data-workflow-step="review"]');button.click();assert.equal(dom.window.document.activeElement,input);assert.doesNotMatch(host.textContent,/私有研究正文/);workflow.update({phase:'running',hasText:true,valid:true,hasTask:true});assert.equal(host.querySelector('[data-workflow-step="review"]'),button);workflow.dispose();workflow.update({phase:'complete',hasReport:true});assert.equal(host.querySelector('[data-detection-workflow]').dataset.phase,'running');}
 finally{workflow.dispose();dom.window.close();}
});
