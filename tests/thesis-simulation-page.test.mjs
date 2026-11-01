import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountOnlineThesis,disposeOnlineThesis} from '../dist/workspace/thesis-online.mjs';
import {createCompletionDraft} from '../dist/workspace/thesis-completion-panel.mjs';
import {replaceSimulationPanel} from '../dist/workspace/thesis-simulation-client.mjs';

const settle=async()=>{for(let i=0;i<16;i++)await new Promise(resolve=>setImmediate(resolve));};
async function fixture(t){
 disposeOnlineThesis();t.mock.timers.enable({apis:['setTimeout']});
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.test/workspace.html#thesis/paper'});
 for(const key of ['window','document','location','AbortController'])globalThis[key]=dom.window[key];
 const item={id:'paper',version:1,status:'completed',title:'仿真研究',profile:{level:'本科',targetWords:500},snapshot:{title:'仿真研究',profile:{level:'本科',targetWords:500},requirements:{deliveryVersion:1},materials:[],references:[],outline:[{id:'c',title:'仿真结果'}]},chapters:[{id:'c',title:'仿真结果',text:'当前保存的章节。【待补充：模拟结果】',version:1,status:'saved',sourceIds:[]}]};
 let job={id:'sim-1',operation:'simulation',thesisId:'paper',userId:'owner',status:'queued'};
 const calls=[],ctx={session:async()=>({status:'ready',user:{id:'owner'}}),api:async(path,data)=>{calls.push({path,data});
  if(path==='/auth/me')return{user:{id:'owner'}};
  if(path==='/capabilities')return{thesis:{ready:true}};
  if(path==='/theses/paper')return{item:structuredClone(item)};
  if(path==='/theses/methods/capabilities')return{ready:true,supportsSimulation:true,billingService:'agent',billingServiceKey:'writing-planning'};
  if(path==='/billing/quote')return{token:'isolated-quote'};
  if(path==='/theses/methods'||path==='/theses/methods/sim-1')return{item:structuredClone(job)};
  throw Error('Unexpected '+path);
 }},root=dom.window.document.querySelector('main');
 let stop=mountOnlineThesis({id:item.id,container:root,ctx});await stop.ready;
 t.after(()=>{disposeOnlineThesis();dom.window.close();});
 const q=selector=>root.querySelector(selector);
 return{dom,root,q,calls,async start(){q('[data-simulation-generate]').click();await settle();assert.ok(q('[role="progressbar"]'));},async complete(){job={...job,status:'completed',output:{origin:'ai_simulation',text:'明确披露的模拟数据与参数说明。',rows:[{},{}]}};t.mock.timers.tick(1800);await settle();assert.ok(q('[data-simulation-preview]'));},async reopen(){stop();stop=mountOnlineThesis({id:item.id,container:root,ctx});await stop.ready;t.mock.timers.tick(1800);await settle();}};
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
 const cover=f.q('[data-completion-cover="author"]').closest('details');cover.open=false;
 await f.complete();
 assert.equal(f.q('[data-thesis-completion]'),panel,'background completion must not replace the form');
 assert.equal(f.q('[data-completion-reference="text"]'),field);
 assert.equal(f.dom.window.document.activeElement,field);assert.equal(field.selectionStart,8);assert.equal(field.selectionEnd,15);assert.equal(field.scrollTop,55);assert.equal(details.open,true);assert.equal(cover.open,false);
 assert.match(f.q('[data-completion-prepare]').textContent,/保存材料/);
 assert.match(f.q('[data-thesis-delivery-state]').textContent,/保存材料并自动完善/);
 assert.equal(f.q('#thesis-online-docx').disabled,true,'new simulation material must still pass completion before final delivery');
 assert.equal(f.q('[data-thesis-notice]').textContent,'','completion feedback stays beside the data instead of inserting a banner above the page');
});

test('the sole draft and final download controls follow all supplement and cover inputs',async t=>{
 const f=await fixture(t),exportArea=f.q('.thesis-export'),completion=f.q('[data-thesis-completion-host]'),delivery=f.q('[data-thesis-delivery]');
 assert.ok(delivery);assert.equal(exportArea.lastElementChild,delivery);
 assert.ok(completion.compareDocumentPosition(delivery)&f.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
 assert.equal(f.root.querySelectorAll('#thesis-online-docx').length,1);assert.equal(f.root.querySelectorAll('#thesis-online-draft').length,1);
 assert.ok(delivery.contains(f.q('#thesis-online-docx')));assert.ok(delivery.contains(f.q('[data-thesis-export-status]')));
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
