import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountOnlineThesis,disposeOnlineThesis} from '../dist/workspace/thesis-online.mjs';
import {createCompletionDraft} from '../dist/workspace/thesis-completion-panel.mjs';
import {replaceSimulationPanel} from '../dist/workspace/thesis-simulation-client.mjs';

const settle=async()=>{for(let i=0;i<16;i++)await new Promise(resolve=>setImmediate(resolve));};
async function fixture(t,{saveFailures=0,recovery=false,loseSaveResponse=false,saveGate,priorReview=false}={}){
 disposeOnlineThesis();t.mock.timers.enable({apis:['setTimeout']});
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.test/workspace.html#thesis/paper'});
 for(const key of ['window','document','location','AbortController'])globalThis[key]=dom.window[key];
 const item={id:'paper',version:1,status:'completed',title:'仿真研究',profile:{level:'本科',targetWords:500},snapshot:{title:'仿真研究',profile:{level:'本科',targetWords:500},requirements:{deliveryVersion:1},materials:[],references:[],outline:[{id:'c',title:'仿真结果'}]},chapters:[{id:'c',title:'仿真结果',text:'当前保存的章节。【待补充：模拟结果】',version:1,status:'saved',sourceIds:[]}]};
 let job={id:'sim-1',operation:'simulation',thesisId:'paper',userId:'owner',status:'queued'};
 let signedIn='owner';
 if(recovery)item.simulationRecovery={id:'sim-1',title:'已生成的仿真数据',sampleSize:2,variableCount:2};
 if(priorReview)item.completionReview={required:true,status:'needs_materials',checks:{},missing:['旧检查：缺少模拟数据'],changes:[],issues:[]};
 const calls=[],ctx={session:async()=>({status:'ready',user:{id:signedIn}}),api:async(path,data)=>{calls.push({path,data});
  if(path==='/auth/me')return{user:{id:signedIn}};
  if(path==='/capabilities')return{thesis:{ready:true}};
  if(path==='/theses/paper')return{item:structuredClone(item)};
  if(path==='/theses/paper/completion'){
   if(saveFailures-->0)throw Object.assign(Error('暂时无法保存，请重试'),{status:503});
   assert.deepEqual(Object.keys(data).sort(),['clientKey','simulationRunIds','version']);
   if(saveGate)await saveGate;
   if(!item.snapshot.materials.length){item.snapshot.materials.push({id:'simulation:sim-1',name:'模拟资料',text:'明确披露的模拟数据与参数说明。',confirmed:true,dataKind:'simulation',simulation:{jobId:'sim-1',seed:42,recipe:{sampleSize:2,variables:[{key:'x'},{key:'y'}]}}});item.version++;item.simulationRecovery=null;}
   if(priorReview)item.completionReview={required:true,status:'check_required',basisChanged:true,reportCurrent:false,simulation:{savedCount:1,records:2,usedCount:0,checked:false},checks:{},changes:[],missing:[],issues:[]};
   if(loseSaveResponse){loseSaveResponse=false;throw Error('保存响应暂未收到');}return{item:structuredClone(item)};
  }
  if(path==='/theses/methods/capabilities')return{ready:true,supportsSimulation:true,billingService:'agent',billingServiceKey:'writing-planning'};
  if(path==='/billing/quote')return{token:'isolated-quote'};
  if(path==='/theses/paper/quote')return{type:'agent',source:'credits',token:'writing-quote',creditCost:1000,title:'自动完善',expiresAt:new Date(Date.now()+60000).toISOString(),completion:{chapterTitles:['仿真结果']}};
  if(path==='/theses/paper/generate'){assert.equal(item.snapshot.materials[0]?.simulation?.jobId,'sim-1');assert.equal(data.version,item.version);item.status='queued';item.version++;item.job={id:'writing-1',status:'queued',operation:'completion',totalSections:1,completedSections:0};return{item:structuredClone(item)};}
  if(path==='/theses/methods'||path==='/theses/methods/sim-1')return{item:structuredClone(job)};
  throw Error('Unexpected '+path);
 }},root=dom.window.document.querySelector('main');
 let stop=mountOnlineThesis({id:item.id,container:root,ctx});await stop.ready;
 t.after(()=>{disposeOnlineThesis();dom.window.close();});
 const q=selector=>root.querySelector(selector);
 return{dom,root,q,calls,item,setOwner:id=>signedIn=id,async start(){q('[data-simulation-generate]').click();await settle();assert.ok(q('[role="progressbar"]'));},async complete(){job={...job,status:'completed',output:{origin:'ai_simulation',text:'明确披露的模拟数据与参数说明。',rows:[{},{}]}};t.mock.timers.tick(1800);await settle();assert.ok(q('[data-simulation-preview]'));},async reopen(){stop();stop=mountOnlineThesis({id:item.id,container:root,ctx});await stop.ready;t.mock.timers.tick(1800);await settle();}};
}

test('pending simulation survives leaving and reopening a clean thesis without a second submission or quote',async t=>{
 const f=await fixture(t);await f.start();
 const stored=JSON.parse(f.dom.window.localStorage.getItem('paperknow-thesis-edits-v1:owner:paper'));
 assert.equal(stored?.completion?.simulationJob?.jobId,'sim-1');
 await f.reopen();assert.ok(f.q('[role="progressbar"]'));
 assert.equal(f.calls.filter(row=>row.path==='/theses/methods').length,1);
 assert.equal(f.calls.filter(row=>row.path==='/billing/quote').length,1);
 assert.ok(f.calls.some(row=>row.path==='/theses/methods/sim-1'));
});

test('simulation completion leaves other supplement fields, focus, selection and disclosure state intact',async t=>{
 const f=await fixture(t);await f.start();
 const panel=f.q('[data-thesis-completion]'),field=f.q('[data-completion-reference="text"]'),details=field.closest('details');
 field.value='用户正在补充的真实文献内容。'.repeat(20);field.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));field.focus();field.setSelectionRange(8,15);field.scrollTop=55;
 const cover=f.q('[data-cover-field="author"]').closest('details');cover.open=false;
 await f.complete();
 assert.equal(f.q('[data-thesis-completion]'),panel,'background completion must not replace the form');
 assert.equal(f.q('[data-completion-reference="text"]'),field);
 assert.equal(f.dom.window.document.activeElement,field);assert.equal(field.selectionStart,8);assert.equal(field.selectionEnd,15);assert.equal(field.scrollTop,55);assert.equal(details.open,true);assert.equal(cover.open,false);
 assert.match(f.q('[data-completion-prepare]').textContent,/保存并开始完善检查/);
 assert.match(f.q('[data-thesis-delivery-state]').textContent,/保存并开始完善检查/);
 assert.equal(f.q('#thesis-online-docx').disabled,true,'new simulation material must still pass completion before final delivery');
 assert.equal(f.q('[data-thesis-notice]').textContent,'','completion feedback stays beside the data instead of inserting a banner above the page');
 assert.match(f.q('.thesis-simulation-status').textContent,/已保存到当前论文/);
 assert.equal(f.calls.filter(row=>row.path==='/theses/paper/completion').length,1);
 assert.equal(f.item.snapshot.materials[0].simulation.jobId,'sim-1');
});

test('completed data automatically saves once, survives reload, and permits continuing without another model charge',async t=>{
 const f=await fixture(t);await f.start();await f.complete();
 assert.match(f.q('.thesis-simulation-status').textContent,/已保存到当前论文/);
 assert.equal(f.q('[data-completion-prepare]').disabled,false,'saved simulation must permit the next step');
 assert.doesNotMatch(f.q('[data-thesis-delivery-state]').textContent,/尚未应用|正在生成/);
 await f.reopen();assert.match(f.q('.thesis-simulation-status').textContent,/已保存到当前论文/);
 assert.equal(f.q('[data-completion-prepare]').disabled,false);
 assert.equal(f.calls.filter(row=>row.path==='/theses/paper/completion').length,1);
 assert.equal(f.calls.filter(row=>row.path==='/billing/quote').length,1);
 assert.equal(f.calls.filter(row=>row.path==='/theses/methods').length,1);
 f.q('[data-completion-prepare]').click();await settle();
 assert.equal(f.calls.filter(row=>row.path==='/theses/paper/generate').length,1,'the next click starts writing with the cloud-saved simulation');
 assert.equal(f.calls.find(row=>row.path==='/theses/paper/quote').data.version,2);
});

test('failed free adoption retains the generated data and retries with the same save key without a new AI request',async t=>{
 const f=await fixture(t,{saveFailures:1});await f.start();await f.complete();
 assert.match(f.q('.thesis-simulation-status').textContent,/保存待重试/);
 assert.doesNotMatch(f.q('.thesis-simulation-status').textContent,/已保存到当前论文/);
 assert.equal(f.q('#thesis-online-docx').disabled,true);
 f.q('[data-simulation-save]').click();await settle();
 assert.match(f.q('.thesis-simulation-status').textContent,/已保存到当前论文/);
 const saves=f.calls.filter(row=>row.path==='/theses/paper/completion');assert.equal(saves.length,2);assert.equal(saves[0].data.clientKey,saves[1].data.clientKey);
 assert.equal(f.calls.filter(row=>row.path==='/billing/quote').length,1);assert.equal(f.calls.filter(row=>row.path==='/theses/methods').length,1);
});

test('restoring an existing completed dataset saves it without any AI request or paid quote',async t=>{
 const f=await fixture(t,{recovery:true});assert.ok(f.q('[data-simulation-restore]'));
 f.q('[data-simulation-restore]').click();await settle();
 assert.match(f.q('.thesis-simulation-status').textContent,/已保存到当前论文/);
 assert.equal(f.q('[data-completion-prepare]').disabled,false);
 assert.equal(f.calls.filter(row=>row.path==='/theses/paper/completion').length,1);
 assert.equal(f.calls.filter(row=>row.path==='/billing/quote'||row.path==='/theses/methods').length,0);
});

test('a lost save response recovers from the authoritative cloud material on reopen without a second adoption',async t=>{
 const f=await fixture(t,{loseSaveResponse:true});await f.start();await f.complete();assert.match(f.q('.thesis-simulation-status').textContent,/保存待重试/);assert.equal(f.item.version,2);
 await f.reopen();assert.match(f.q('.thesis-simulation-status').textContent,/已保存到当前论文/);assert.equal(f.calls.filter(row=>row.path==='/theses/paper/completion').length,1);assert.equal(f.calls.filter(row=>row.path==='/billing/quote').length,1);
});

test('changing accounts while free adoption is pending never repaints the old private data or starts writing',async t=>{
 let release;const f=await fixture(t,{saveGate:new Promise(resolve=>release=resolve)});await f.start();await f.complete();assert.match(f.q('.thesis-simulation-status').textContent,/正在保存/);f.setOwner('another');release();await settle();assert.match(f.root.textContent,/账户已切换/);assert.equal(f.q('[data-simulation-preview]'),null);assert.equal(f.calls.some(row=>row.path==='/theses/paper/generate'),false);
});

test('automatic simulation adoption retires the visible old review immediately without replacing author input',async t=>{
 const f=await fixture(t,{priorReview:true}),field=f.q('[data-completion-reference="text"]');await f.start();field.value='作者正在补充的真实摘要';field.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));field.focus();await f.complete();
 assert.equal(f.q('[data-completion-reference="text"]'),field);assert.equal(field.value,'作者正在补充的真实摘要');assert.match(f.q('[data-completion-review]').textContent,/正文待更新|尚未保存/);assert.doesNotMatch(f.q('[data-completion-review]').textContent,/旧检查：缺少模拟数据/);assert.match(f.q('[role="region"].thesis-completion-requests').getAttribute('aria-label'),/正文待更新/);assert.match(f.q('[data-completion-prepare]').textContent,/保存并开始完善检查/);assert.equal(f.calls.filter(row=>row.path==='/theses/paper/completion').length,1);
});

test('final download follows supplement and cover inputs while draft download stays in its own module',async t=>{
 const f=await fixture(t),delivery=f.q('[data-thesis-delivery]'),exportArea=delivery.closest('.thesis-export'),completion=f.q('[data-thesis-completion-host]');
 assert.ok(delivery);assert.equal(exportArea.lastElementChild,delivery);
 assert.ok(completion.compareDocumentPosition(delivery)&f.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
 assert.equal(f.root.querySelectorAll('#thesis-online-docx').length,1);assert.equal(f.root.querySelectorAll('#thesis-online-draft').length,1);
 assert.ok(delivery.contains(f.q('#thesis-online-docx')));assert.equal(delivery.contains(f.q('#thesis-online-draft')),false);assert.equal(f.q('#thesis-online-draft').closest('[data-thesis-writing-panel]').dataset.thesisWritingPanel,'draft');assert.ok(delivery.contains(f.q('[data-thesis-export-status]')));
 assert.equal(f.q('[data-completion-recheck]'),null,'do not repeat final export within the supplement form');
});

test('simulation status updates do not reserve a viewport of blank space inside the small data panel',()=>{
 const dom=new JSDOM('<main class="dashboard"><div data-thesis-simulation-host></div></main>'),host=dom.window.document.querySelector('[data-thesis-simulation-host]'),draft=createCompletionDraft();
 draft.simulationJob={status:'queued',jobId:'job'};
 replaceSimulationPanel(host,draft,{}, {start(){},cancel(){}});
 assert.equal(host.style.minHeight,'');const panel=host.firstElementChild;
 replaceSimulationPanel(host,draft,{}, {start(){},cancel(){}});
 assert.equal(host.firstElementChild,panel,'an unchanged poll must leave the existing status DOM in place');
 dom.window.close();
});
