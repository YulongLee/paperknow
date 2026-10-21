import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountWritingJobPanel} from '../dist/workspace/writing-job-panel.mjs';
import {beginDraftScope,endDraftScope} from '../dist/workspace/state.mjs';
import {projectReference} from '../dist/workspace/project-directory.mjs';

const snapshot=()=>({title:'账户项目写作验收',profile:{level:'本科',targetWords:1000},materials:[],references:[],outline:[]});
const until=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.ok(check(),'写作任务界面未达到预期状态');};
function fixture(t,{projectRef='',initialState={},getQuote=()=>({type:'agent',source:'credits',creditCost:10,title:'文章写作',token:'test-quote',expiresAt:new Date(Date.now()+60000).toISOString()})}={}){
 const dom=new JSDOM('<main class="dashboard"><div id="job"></div></main>',{url:'https://paperknow.cn/workspace.html#tool/article'}),container=dom.window.document.querySelector('#job'),calls=[],instances=[];let ref=projectRef,ownerId='alice',record={id:'writing-1',kind:'article',operation:'draft',status:'completed',output:{text:'待核对的写作结果',sourceIds:[]}};
 const api=async(path,data)=>{calls.push({path,data:data===undefined?undefined:structuredClone(data)});if(path==='/auth/me')return {user:{id:ownerId}};if(path==='/writing/capabilities')return {ready:true};if(path==='/writing/quote')return getQuote();if(path==='/writing/jobs')return {item:{...record,projectId:data.projectId||null}};if(path==='/writing/jobs/writing-1')return {item:record};throw Error('测试不允许的请求 '+path);};
 const mount=state=>{const panel=mountWritingJobPanel({container,ctx:{api},kind:'article',operation:'draft',getSnapshot:snapshot,getProjectRef:()=>ref,initialState:state});instances.push(panel);return panel;},panel=mount(initialState);
 t.after(()=>{instances.forEach(panel=>panel.dispose());dom.window.close();});return {dom,container,calls,panel,mount,setRef:value=>{ref=value;},setOwner:value=>{ownerId=value;},setRecord:value=>{record=value;},consent(){const input=container.querySelector('[data-wj-consent]');assert.ok(input);input.checked=true;input.dispatchEvent(new dom.window.Event('change'));},click:selector=>{const node=container.querySelector(selector);assert.ok(node,selector);node.click();}};
}

test('writing quote and job carry the selected account project separately from the canonical model snapshot',async t=>{
 const ref=projectReference('alice','project-a'),f=fixture(t,{projectRef:ref});await f.panel.open();assert.equal(f.calls.find(row=>row.path==='/writing/quote').data.projectId,'project-a');assert.equal(f.panel.getState().projectRef,ref);f.consent();f.click('[data-wj-start]');await until(()=>f.panel.getState().itemId==='writing-1');const posted=f.calls.find(row=>row.path==='/writing/jobs').data;assert.equal(posted.projectId,'project-a');assert.deepEqual(posted.snapshot,snapshot());
});

test('writing project changes invalidate consent and cannot use an earlier project quote',async t=>{
 const f=fixture(t,{projectRef:projectReference('alice','project-a')});await f.panel.open();f.consent();f.setRef(projectReference('alice','project-b'));f.click('[data-wj-start]');await until(()=>!!f.container.querySelector('[role="alert"]'));assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);assert.match(f.container.textContent,/确认当前信息/);
});

test('restoring a writing task keeps the old project binding and does not submit under a newly selected project',async t=>{
 const f=fixture(t,{projectRef:projectReference('alice','project-a')});await f.panel.open();f.consent();f.click('[data-wj-start]');await until(()=>f.panel.getState().itemId==='writing-1');const saved=structuredClone(f.panel.getState());f.panel.dispose();f.setRef(projectReference('alice','project-b'));const restored=f.mount(saved);await restored.open();assert.equal(restored.getState().projectRef,saved.projectRef);assert.equal(f.calls.filter(row=>row.path==='/writing/quote').length,1);assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,1);assert.equal(f.container.querySelector('[data-wj-apply]').disabled,true);
});

test('writing panels retain the historical context key for independent tasks and reject foreign project refs',async t=>{
 const f=fixture(t);await f.panel.open();assert.equal(f.panel.getState().contextKey,JSON.stringify(snapshot()));assert.equal(f.calls.find(row=>row.path==='/writing/quote').data.projectId,undefined);f.panel.dispose();f.setRef(projectReference('bob','private-project'));const next=f.mount({});await next.open();assert.equal(f.calls.filter(row=>row.path==='/writing/quote').length,1);assert.ok(f.container.querySelector('[role="alert"]'));
});


test('an account draft scope passes its raw project ID only for the verified scope owner',async t=>{
 beginDraftScope({ownerId:'alice',projectRows:[{id:'scope-project',title:'账户论文项目'}]});t.after(endDraftScope);const f=fixture(t,{projectRef:'scope-project'});await f.panel.open();assert.equal(f.calls.find(row=>row.path==='/writing/quote').data.projectId,'scope-project');f.panel.dispose();f.setOwner('bob');const switched=f.mount({});await switched.open();assert.equal(f.calls.filter(row=>row.path==='/writing/quote').length,1);assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);
});

test('resuming a failed writing task keeps its original project, checkpoints and original job identifier',async t=>{
 const ref=projectReference('alice','project-a'),snap=snapshot(),state={ownerId:'alice',projectRef:ref,projectId:'project-a',snapshot:snap,contextKey:JSON.stringify({snapshot:snap,projectRef:ref}),commandKey:'old-writing-command',itemId:'writing-1'},f=fixture(t,{projectRef:ref,initialState:state});f.setRecord({id:'writing-1',projectId:'project-a',kind:'article',operation:'draft',status:'failed',completedUnits:1,totalUnits:2,output:null});await f.panel.open();f.click('[data-wj-resume]');await until(()=>f.calls.some(row=>row.path==='/writing/quote'));assert.equal(f.calls.find(row=>row.path==='/writing/quote').data.projectId,'project-a');f.consent();f.click('[data-wj-start]');await until(()=>f.calls.some(row=>row.path==='/writing/jobs'));const posted=f.calls.find(row=>row.path==='/writing/jobs').data;assert.equal(posted.projectId,'project-a');assert.equal(posted.resumeFromJobId,'writing-1');assert.notEqual(posted.clientKey,'old-writing-command');
});


test('an imported writing job keeps its frozen encoded binding and is adoptable from the same raw account project without a new charge',async t=>{
 const encoded=projectReference('alice','project-a'),f=fixture(t,{projectRef:encoded});await f.panel.open();f.consent();f.click('[data-wj-start]');await until(()=>f.panel.getState().itemId==='writing-1');const frozen=structuredClone(f.panel.getState());f.panel.dispose();beginDraftScope({ownerId:'alice',projectRows:[{id:'project-a',title:'Original project'},{id:'project-b',title:'Another project'}]});t.after(endDraftScope);f.setRef('project-a');const restored=f.mount(frozen);await restored.open();assert.equal(f.container.querySelector('[data-wj-apply]').disabled,false);assert.equal(restored.getState().contextKey,frozen.contextKey);assert.deepEqual(restored.getState().snapshot,frozen.snapshot);assert.equal(restored.getState().projectRef,encoded);assert.equal(f.calls.filter(row=>row.path==='/writing/quote').length,1);assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,1);f.setRef(projectReference('bob','project-a'));await restored.refresh();assert.equal(f.container.querySelector('[data-wj-apply]').disabled,true);f.setRef('project-b');await restored.refresh();assert.equal(f.container.querySelector('[data-wj-apply]').disabled,true);f.setRef('project-a');await restored.refresh();f.click('[data-wj-apply]');await until(()=>/\u5df2\u91c7\u7528/.test(f.container.textContent));assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,1);
});

test('different local writing project refs cannot become equivalent merely because neither resolves to an account project',async t=>{
 const f=fixture(t,{projectRef:'local-a'});await f.panel.open();f.consent();f.setRef('local-b');f.click('[data-wj-start]');await until(()=>!!f.container.querySelector('[role="alert"]'));assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);
});


test('a valid writing quote defaults to selected consent but only the explicit generation click submits a task',async t=>{
 const f=fixture(t);await f.panel.open();
 assert.equal(f.container.querySelector('[data-wj-consent]').checked,true);assert.equal(f.container.querySelector('[data-wj-start]').disabled,false);assert.equal(f.container.querySelector('[data-wj-start]').textContent,'生成正文');assert.match(f.container.textContent,/10 科研积分/);assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,0);
 f.click('[data-wj-close]');assert.equal(f.container.hidden,true);assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,0);
 await f.panel.open();assert.equal(f.container.querySelector('[data-wj-consent]').checked,true);f.click('[data-wj-start]');await until(()=>f.panel.getState().itemId==='writing-1');const submissions=f.calls.filter(row=>row.path==='/writing/jobs');assert.equal(submissions.length,1);assert.equal(submissions[0].data.consent,true);assert.equal(submissions[0].data.billingToken,'test-quote');
});

test('unchecking the default writing consent blocks submission until the user selects it again',async t=>{
 const f=fixture(t);await f.panel.open();const input=f.container.querySelector('[data-wj-consent]');input.checked=false;input.dispatchEvent(new f.dom.window.Event('change'));
 assert.equal(f.container.querySelector('[data-wj-start]').disabled,true);f.click('[data-wj-start]');await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);
 f.consent();assert.equal(f.container.querySelector('[data-wj-start]').disabled,false);f.click('[data-wj-start]');await until(()=>f.panel.getState().itemId==='writing-1');assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,1);
});

test('default writing consent cannot submit an expired quote or follow an unconfirmed account switch',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);const f=fixture(t);await f.panel.open();now+=120000;f.click('[data-wj-start]');await until(()=>!!f.container.querySelector('[role="alert"]'));assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);assert.match(f.container.textContent,/费用已有变化/);
 f.click('[data-wj-new]');await until(()=>f.calls.filter(row=>row.path==='/writing/quote').length===2&&!f.container.querySelector('[data-wj-start]').disabled);f.setOwner('bob');f.click('[data-wj-start]');await until(()=>/账户已变化/.test(f.container.textContent));assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);assert.equal(f.container.querySelector('[data-wj-start]'),null);
});

test('invalid writing fee data never defaults consent to a submit-ready state',async t=>{
 const f=fixture(t,{getQuote:()=>({type:'agent',source:'credits',creditCost:10,title:'不完整报价'})});await f.panel.open();assert.match(f.container.textContent,/费用信息不完整/);assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);assert.equal(f.container.querySelector('[data-wj-consent]')?.checked||false,false);assert.equal(f.container.querySelector('[data-wj-start]')?.disabled??true,true);
});
