import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createThesisSimulationController,simulationPanelHTML,bindSimulationPanel,mergeThesisSupplements,synchronizeSimulationState,completionHasUnsavedInputs} from '../dist/workspace/thesis-simulation-client.mjs';
import {createCompletionDraft,completionPayload,completionDraftRecord,restoreCompletionDraft} from '../dist/workspace/thesis-completion-panel.mjs';

function fixture(t,{handle}={}){
 const dom=new JSDOM('<main><div id="panel"></div></main>',{url:'https://paperknow.test'}),root=dom.window.document.querySelector('#panel'),draft=createCompletionDraft(),item={id:'paper',version:1},calls=[];let timer=null,alive=true,completed=0,job={id:'sim-1',operation:'simulation',thesisId:'paper',userId:'owner',status:'queued'};
 const api=async(path,data)=>{calls.push({path,data});const value=await handle?.(path,data);if(value)return value;if(path==='/theses/methods/capabilities')return{ready:true,supportsSimulation:true,billingService:'agent',billingServiceKey:'writing-planning'};if(path==='/billing/quote')return{token:'priced-token'};if(path==='/theses/methods')return{item:structuredClone(job)};if(path.endsWith('/cancel')){job.status='cancelled';return{item:structuredClone(job)};}if(path==='/theses/methods/sim-1')return{item:structuredClone(job)};throw Error('Unexpected '+path);};
 const render=()=>{root.innerHTML=simulationPanelHTML(draft);bindSimulationPanel(root,controller);},controller=createThesisSimulationController({api,owner:async()=>{},getItem:()=>item,getDraft:()=>draft,getUserId:()=>'owner',isCurrent:()=>alive,persist:()=>{},render,onCompleted:()=>{completed++;render();},setTimer:fn=>{timer=fn;return 1;},clearTimer:()=>{timer=null;}});render();t.after(()=>{alive=false;controller.dispose();dom.window.close();});
 return{dom,root,draft,item,calls,controller,get completed(){return completed;},setJob:value=>job=value,async poll(){const run=timer;assert.ok(run);run();for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));},dispose(){alive=false;controller.dispose();}};
}
test('one click submits exactly once and visibly waits; completion adds a marked source without replacing actual results',async t=>{
 const f=fixture(t);f.draft.supplement='作者已经提供的真实研究记录。';const one=f.controller.start(),two=f.controller.start();await Promise.all([one,two]);assert.equal(f.calls.filter(row=>row.path==='/theses/methods').length,1);assert.match(f.root.textContent,/正在排队/);assert.ok(f.root.querySelector('[role="progressbar"]'));assert.equal(f.root.querySelector('input[type="checkbox"]'),null);assert.deepEqual(f.calls.find(row=>row.path==='/billing/quote').data,{type:'agent',serviceKey:'writing-planning'});
 f.setJob({id:'sim-1',operation:'simulation',thesisId:'paper',userId:'owner',status:'completed',output:{origin:'ai_simulation',text:'AI模拟数据，非实测。参数与种子均保留。',rows:[{},{}]}});await f.poll();assert.deepEqual(f.draft.simulationRunIds,['sim-1']);assert.equal(f.draft.supplement,'作者已经提供的真实研究记录。');assert.equal(f.draft.dirty,true);assert.equal(f.completed,1);assert.ok(f.root.querySelector('textarea').readOnly);assert.match(f.root.textContent,/模拟数据 · 非实测/);const payload=completionPayload(f.draft,1);assert.deepEqual(payload.simulationRunIds,['sim-1']);assert.equal(payload.supplement,f.draft.supplement);assert.deepEqual(restoreCompletionDraft(completionDraftRecord(f.draft)).simulationRunIds,['sim-1']);
});
test('changed research versions cannot silently adopt late simulation results',async t=>{
 const f=fixture(t);await f.controller.start();f.item.version=2;f.setJob({id:'sim-1',operation:'simulation',thesisId:'paper',userId:'owner',status:'completed',output:{origin:'ai_simulation',text:'模拟记录',rows:[{}]}});await f.poll();assert.equal(f.draft.simulationJob.status,'failed');assert.deepEqual(f.draft.simulationRunIds,[]);assert.match(f.root.textContent,/论文信息已更新/);
});
test('cancelled jobs and another account response cannot add simulated data',async t=>{
 const f=fixture(t);await f.controller.start();await f.controller.cancel();assert.equal(f.draft.simulationJob.status,'cancelled');assert.deepEqual(f.draft.simulationRunIds,[]);f.setJob({id:'sim-1',operation:'simulation',thesisId:'paper',userId:'owner',status:'queued'});await f.controller.start();f.setJob({id:'sim-1',operation:'simulation',thesisId:'paper',userId:'other',status:'completed',output:{origin:'ai_simulation',text:'OTHER_PRIVATE_DATA',rows:[{}]}});await f.poll();assert.deepEqual(f.draft.simulationRunIds,[]);assert.doesNotMatch(f.root.textContent,/OTHER_PRIVATE_DATA/);
});
test('restored pending commands recover by their original key without submitting or quoting again',async t=>{
 const f=fixture(t,{handle:async path=>path.startsWith('/theses/methods/by-key/')?{item:{id:'sim-1',operation:'simulation',thesisId:'paper',userId:'owner',status:'queued'}}:null});f.draft.simulationJob={status:'recovering',clientKey:'existing-simulation-key',thesisId:'paper',version:1,jobId:null,error:'',text:''};f.controller.resume();await f.poll();assert.equal(f.draft.simulationJob.jobId,'sim-1');assert.equal(f.calls.filter(row=>row.path==='/billing/quote'||row.path==='/theses/methods').length,0);
});
test('disposed pages do not adopt a late response and service errors show their actual reason without a confirmation dialog',async t=>{
 let release;const wait=new Promise(resolve=>release=resolve),f=fixture(t,{handle:async path=>path==='/theses/methods'?wait:null}),running=f.controller.start();for(let i=0;i<12&&!f.calls.some(row=>row.path==='/theses/methods');i++)await new Promise(resolve=>setImmediate(resolve));f.dispose();release({item:{id:'sim-1',operation:'simulation',thesisId:'paper',userId:'owner',status:'completed',output:{origin:'ai_simulation',text:'模拟数据',rows:[{}]}}});await running;assert.deepEqual(f.draft.simulationRunIds,[]);
 const unavailable=fixture(t,{handle:async path=>path==='/billing/quote'?Promise.reject(Object.assign(Error('积分不足'),{status:402})):null});await unavailable.controller.start();assert.equal(unavailable.draft.simulationJob.status,'failed');assert.match(unavailable.root.textContent,/积分不足/);assert.equal(unavailable.calls.some(row=>row.path==='/theses/methods'),false);
});

test('wizard synchronization retains exact cloud supplement provenance while honoring ordinary source edits',()=>{
 const simulation={id:'simulation:one',dataKind:'simulation',text:'完整模拟数据',simulation:{jobId:'one',seed:42,generatorVersion:1,recipe:{sampleSize:60,variables:[{key:'x'}]}}},note={id:'evidence',purpose:'研究证据补充',text:'作者真实记录'},ack={id:'ack',purpose:'致谢事实',text:'作者确认的致谢'},reference={id:'r',sourceLabel:'作者终稿补充文献',text:'真实摘要'},account={materials:[simulation,note,ack,{id:'removed',text:'普通旧资料'}],references:[reference],requirements:{deliveryVersion:1}},incoming={materials:[{id:simulation.id,text:'失去元数据的旧副本'},{id:'new',text:'本次新资料'}],references:[],requirements:{language:'中文'}};
 const before=structuredClone({account,incoming}),merged=mergeThesisSupplements(incoming,account);
 assert.deepEqual(merged.materials,[simulation,incoming.materials[1],note,ack]);assert.deepEqual(merged.references,[reference]);assert.deepEqual(merged.requirements,{language:'中文',deliveryVersion:1});assert.deepEqual({account,incoming},before);
});

test('cloud-confirmed simulation clears only its own pending input and never clears unfinished author inputs',()=>{
 const draft=createCompletionDraft(),material={dataKind:'simulation',text:'完整云端数据',simulation:{jobId:'one',recipe:{sampleSize:60,variables:[{key:'x'},{key:'y'}]}}};draft.simulationJob={jobId:'one',status:'completed',adoptionStatus:'saving'};draft.simulationRunIds=['one'];draft.reference.title='尚未加入的文献';draft.dirty=true;
 synchronizeSimulationState(draft,{id:'paper',version:2,snapshot:{materials:[material]}});
 assert.equal(draft.simulationJob.adoptionStatus,'saved');assert.equal(draft.simulationJob.sampleSize,60);assert.equal(draft.simulationJob.variableCount,2);assert.deepEqual(draft.simulationRunIds,[]);assert.equal(draft.dirty,true);assert.equal(completionHasUnsavedInputs(draft),true);
 synchronizeSimulationState(draft,{id:'paper',version:3,snapshot:{materials:[]}});assert.equal(draft.simulationJob.adoptionStatus,'missing');assert.match(simulationPanelHTML(draft),/保存模拟资料并继续/);
});

test('completing another simulation appends its ID without losing earlier unadopted results or polling a completed job',async t=>{
 const f=fixture(t);f.draft.simulationRunIds=['earlier'];await f.controller.start();f.setJob({id:'sim-1',operation:'simulation',thesisId:'paper',userId:'owner',status:'completed',output:{origin:'ai_simulation',text:'模拟记录',rows:[{}],recipe:{variables:[{key:'x'},{key:'y'}]}}});await f.poll();assert.deepEqual(f.draft.simulationRunIds,['earlier','sim-1']);assert.equal(f.draft.simulationJob.variableCount,2);const reads=f.calls.length;f.controller.resume();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,reads);
});
