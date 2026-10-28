import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountWritingJobPanel} from '../dist/workspace/writing-job-panel.mjs';
import {beginDraftScope,endDraftScope} from '../dist/workspace/state.mjs';
import {projectReference} from '../dist/workspace/project-directory.mjs';

const snapshot=()=>({title:'账户项目写作验收',profile:{level:'本科',targetWords:1000},materials:[],references:[],outline:[]});
const until=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.ok(check(),'写作任务界面未达到预期状态');};
function fixture(t,{projectRef='',initialState={},beforeApi=async()=>{},getQuote=()=>({type:'agent',source:'credits',creditCost:10,title:'文章写作',token:'test-quote',expiresAt:new Date(Date.now()+60000).toISOString()})}={}){
 const dom=new JSDOM('<main class="dashboard"><div id="job"></div></main>',{url:'https://paperknow.cn/workspace.html#tool/article'}),container=dom.window.document.querySelector('#job'),calls=[],instances=[];let ref=projectRef,ownerId='alice',record={id:'writing-1',kind:'article',operation:'draft',status:'completed',output:{text:'待核对的写作结果',sourceIds:[]}};
 const api=async(path,data)=>{calls.push({path,data:data===undefined?undefined:structuredClone(data)});await beforeApi(path,data);if(path==='/auth/me')return {user:{id:ownerId}};if(path==='/writing/capabilities')return {ready:true};if(path==='/writing/quote')return {inputHash:'fixture-input-hash',...getQuote()};if(path==='/writing/jobs')return {item:{inputHash:'fixture-input-hash',...record,projectId:data.projectId||null}};if(path==='/writing/jobs/writing-1')return {item:{inputHash:'fixture-input-hash',...record}};if(path==='/writing/jobs/writing-1/cancel')return {item:{...record,status:'cancelled'}};throw Error('测试不允许的请求 '+path);};
 const mount=state=>{const panel=mountWritingJobPanel({container,ctx:{api},kind:'article',operation:'draft',getSnapshot:snapshot,getProjectRef:()=>ref,initialState:state});instances.push(panel);return panel;},panel=mount(initialState);
 t.after(()=>{instances.forEach(panel=>panel.dispose());dom.window.close();});return {dom,container,calls,panel,mount,setRef:value=>{ref=value;},setOwner:value=>{ownerId=value;},setRecord:value=>{record=value;},consent(){const input=container.querySelector('[data-wj-consent]');assert.ok(input);input.checked=true;input.dispatchEvent(new dom.window.Event('change'));},click:selector=>{const node=container.querySelector(selector);assert.ok(node,selector);node.click();}};
}
function capturePolls(f){
 const win=f.dom.window,nativeTimeout=win.setTimeout.bind(win),nativeClear=win.clearTimeout.bind(win),pending=new Map();let id=0;
 win.setTimeout=(fn,delay,...args)=>{if(delay!==2500)return nativeTimeout(fn,delay,...args);const next=--id;pending.set(next,fn);return next;};
 win.clearTimeout=value=>{if(!pending.delete(value)&&value>=0)nativeClear(value);};
 return {pending,run(){const entry=pending.entries().next().value;assert.ok(entry,'expected an automatic status-read timer');pending.delete(entry[0]);entry[1]();}};
}

test('continuous recovery keeps its progress view and does not ask for another purchase',async t=>{
 const f=fixture(t),polls=capturePolls(f);f.setRecord({id:'writing-1',operation:'draft',kind:'article',status:'running',continuous:true,stage:'auto_recovering',completedUnits:5,totalUnits:8,recovery:{automaticRetries:1}});await f.panel.generate();assert.match(f.container.querySelector('[data-wj-stage]').textContent,/正在自动恢复.*已自动恢复 1 次/);assert.equal(f.container.querySelector('[data-wj-units]').textContent,'5 / 8 个单元');const progress=f.container.querySelector('.wf-job-progress');f.setRecord({id:'writing-1',operation:'draft',kind:'article',status:'running',continuous:true,stage:'agent_running',completedUnits:6,totalUnits:8,recovery:{automaticRetries:2}});polls.run();await until(()=>f.container.querySelector('[data-wj-units]').textContent==='6 / 8 个单元');assert.equal(f.container.querySelector('.wf-job-progress'),progress);assert.match(f.container.querySelector('[data-wj-stage]').textContent,/已自动恢复 2 次/);assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,1);assert.equal(f.calls.filter(row=>row.path==='/writing/quote').length,1);
});

test('an explicit generation click after a partial failure quotes and resumes the saved job in one action',async t=>{
 const f=fixture(t);f.setRecord({id:'writing-1',kind:'article',operation:'draft',status:'failed',completedUnits:5,totalUnits:8,error:'旧任务达到执行上限'});await f.panel.generate();const state=f.panel.getState();assert.equal(f.container.querySelector('[data-wj-units]').textContent,'5 / 8 个单元');f.panel.dispose();const restored=f.mount(state);await restored.generate();const posts=f.calls.filter(row=>row.path==='/writing/jobs');assert.equal(posts.length,2);assert.equal(posts[1].data.resumeFromJobId,'writing-1');assert.equal(f.container.querySelector('[data-wj-start]'),null);
});

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

test('writing generation keeps the fee and start visible while explanation is closed by default',async t=>{
 const f=fixture(t);await f.panel.open();const disclosure=f.container.querySelector('[data-wj-disclosure]'),start=f.container.querySelector('[data-wj-start]'),cost=f.container.querySelector('.wf-charge > strong');
 assert.ok(disclosure);assert.equal(disclosure.open,false);assert.match(cost.textContent,/10 科研积分/);assert.equal(cost.closest('details'),null);assert.equal(start.closest('details'),null);assert.equal(start.disabled,false);assert.equal(f.container.querySelector('[data-wj-consent]').closest('details'),disclosure);assert.equal(f.container.querySelector('[data-wj-consent]').checked,true);assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,0);
 const toggle=disclosure.querySelector('summary');assert.match(toggle.textContent,/费用与资料说明/);assert.equal(toggle.tabIndex,0);toggle.click();assert.equal(disclosure.open,true);assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,0);
});

test('writing explanation remains open when a cancelled confirmation is re-rendered and a fresh quote starts collapsed',async t=>{
 const f=fixture(t);await f.panel.open();f.click('[data-wj-disclosure-toggle]');const toggle=f.container.querySelector('[data-wj-disclosure-toggle]');toggle.focus();const input=f.container.querySelector('[data-wj-consent]');input.checked=false;input.dispatchEvent(new f.dom.window.Event('change'));
 f.container.querySelector('[data-wj-start]').dispatchEvent(new f.dom.window.MouseEvent('click',{bubbles:true}));await until(()=>!!f.container.querySelector('[role="alert"]'));assert.equal(f.container.querySelector('[data-wj-disclosure]').open,true);assert.equal(f.container.querySelector('[data-wj-consent]').checked,false);assert.equal(f.container.querySelector('[data-wj-start]').disabled,true);assert.equal(f.dom.window.document.activeElement,f.container.querySelector('[data-wj-disclosure-toggle]'));assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);
 f.click('[data-wj-new]');await until(()=>f.calls.filter(row=>row.path==='/writing/quote').length===2&&!f.container.querySelector('[data-wj-start]').disabled);assert.equal(f.container.querySelector('[data-wj-disclosure]').open,false);assert.equal(f.container.querySelector('[data-wj-consent]').checked,true);assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);
});

test('automatic writing status reads preserve active controls, focus and the scrollable waiting window',async t=>{
 let hold=null;const snap=snapshot(),f=fixture(t,{initialState:{itemId:'writing-1',ownerId:'alice',snapshot:snap,contextKey:JSON.stringify(snap)},beforeApi:async path=>{if(hold&&path==='/writing/jobs/writing-1')await hold;}}),win=f.dom.window;
 let poll;const nativeTimeout=win.setTimeout.bind(win),nativeClear=win.clearTimeout.bind(win);win.setTimeout=(fn,delay,...args)=>delay===2500?(poll=fn,-1):nativeTimeout(fn,delay,...args);win.clearTimeout=id=>{if(id!==-1)nativeClear(id);};
 f.setRecord({id:'writing-1',operation:'draft',status:'running',completedUnits:1,totalUnits:3,stage:'verifying_citations'});await f.panel.open();
 const section=f.container.firstElementChild,waiting=f.container.querySelector('[data-wj-result-window]'),stop=f.container.querySelector('[data-wj-cancel]'),summary=f.container.querySelector('[data-writing-quality-summary]');
 waiting.scrollTop=37;summary.focus();f.container.querySelector('[data-writing-quality-panel]').open=true;
 let release;hold=new Promise(resolve=>{release=resolve;});f.setRecord({id:'writing-1',operation:'draft',status:'running',completedUnits:2,totalUnits:3,stage:'checking_consistency'});poll();await until(()=>f.calls.filter(row=>row.path==='/writing/jobs/writing-1').length===2);
 assert.equal(f.container.firstElementChild,section);assert.equal(f.container.querySelector('[data-wj-cancel]'),stop);assert.equal(stop.disabled,false);assert.equal(win.document.activeElement,summary);
 release();await until(()=>/2 \/ 3/.test(f.container.querySelector('[data-wj-units]').textContent));
 assert.equal(f.container.firstElementChild,section);assert.equal(f.container.querySelector('[data-wj-result-window]'),waiting);assert.equal(waiting.scrollTop,37);assert.equal(win.document.activeElement,summary);assert.equal(f.container.querySelector('[data-writing-quality-panel]').open,true);assert.match(f.container.querySelector('[data-wj-stage]').textContent,/检查正文一致性/);assert.match(waiting.textContent,/自动更新，无需重复点击/);assert.equal(waiting.getAttribute('aria-busy'),'true');assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);
});

test('writing submission immediately shows waiting feedback, blocks duplicate clicks and retains task recovery on a lost response',async t=>{
 let release,submitting=false;const pending=new Promise(resolve=>{release=resolve;}),f=fixture(t,{beforeApi:async path=>{if(path==='/writing/jobs'){submitting=true;await pending;throw Error('连接中断，响应暂未确认');}}});
 await f.panel.open();const button=f.container.querySelector('[data-wj-start]');button.click();
 assert.match(f.container.querySelector('[data-wj-result-window]').textContent,/正在提交生成任务/);assert.equal(f.container.querySelector('[data-wj-start]').disabled,true);f.container.querySelector('[data-wj-start]').click();
 await until(()=>submitting);assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,1);release();await until(()=>!!f.container.querySelector('[role="alert"]'));
 assert.match(f.container.textContent,/连接中断/);assert.ok(f.container.querySelector('[data-wj-recover]'));assert.equal(f.container.querySelector('[data-wj-result-window]').getAttribute('aria-busy'),'false');assert.ok(f.panel.getState().commandKey);assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,1);
});

test('a stop requested during an automatic writing status read executes after that read instead of being discarded',async t=>{
 let hold=null,release;const snap=snapshot(),f=fixture(t,{initialState:{itemId:'writing-1',ownerId:'alice',snapshot:snap,contextKey:JSON.stringify(snap)},beforeApi:async path=>{if(hold&&path==='/writing/jobs/writing-1')await hold;}}),win=f.dom.window;
 let poll;const nativeTimeout=win.setTimeout.bind(win),nativeClear=win.clearTimeout.bind(win);win.setTimeout=(fn,delay,...args)=>delay===2500?(poll=fn,-1):nativeTimeout(fn,delay,...args);win.clearTimeout=id=>{if(id!==-1)nativeClear(id);};
 f.setRecord({id:'writing-1',operation:'draft',status:'running',completedUnits:0,totalUnits:3});await f.panel.open();hold=new Promise(resolve=>{release=resolve;});poll();await until(()=>f.calls.filter(row=>row.path==='/writing/jobs/writing-1').length===2);
 f.click('[data-wj-cancel]');assert.equal(f.calls.some(row=>row.path.endsWith('/cancel')),false);release();await until(()=>/已停止/.test(f.container.textContent));assert.equal(f.calls.filter(row=>row.path.endsWith('/cancel')).length,1);assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);
});

for(const failingPath of ['/auth/me','/writing/jobs/writing-1'])test('interrupted automatic '+failingPath+' reads retain the last state and retry without submitting or replacing the active view',async t=>{
 let failures=0;const snap=snapshot(),f=fixture(t,{initialState:{itemId:'writing-1',ownerId:'alice',snapshot:snap,contextKey:JSON.stringify(snap)},beforeApi:async path=>{if(path===failingPath&&failures){failures--;throw Error('暂时连接失败');}}}),polls=capturePolls(f);
 f.setRecord({id:'writing-1',operation:'draft',status:'running',completedUnits:1,totalUnits:3,stage:'checking_consistency'});await f.panel.open();
 const section=f.container.firstElementChild,window=f.container.querySelector('[data-wj-result-window]'),stop=f.container.querySelector('[data-wj-cancel]'),summary=f.container.querySelector('[data-writing-quality-summary]');window.scrollTop=31;summary.focus();f.container.querySelector('[data-writing-quality-panel]').open=true;
 for(let attempt=0;attempt<2;attempt++){
  failures=1;polls.run();await until(()=>failures===0&&polls.pending.size===1&&!f.container.querySelector('[data-wj-sync-status]').hidden);
  assert.equal(f.container.firstElementChild,section);assert.equal(f.container.querySelector('[data-wj-result-window]'),window);assert.equal(f.container.querySelector('[data-wj-cancel]'),stop);assert.equal(stop.disabled,false);assert.equal(window.scrollTop,31);assert.equal(f.dom.window.document.activeElement,summary);assert.equal(f.container.querySelector('[data-writing-quality-panel]').open,true);assert.match(f.container.querySelector('[data-wj-progress-status]').textContent,/上次状态：正在生成/);assert.match(f.container.querySelector('[data-wj-sync-status]').textContent,/同步暂时中断.*自动重试.*不会重复生成或扣费/);assert.match(f.container.querySelector('[data-wj-wait-title]').textContent,/恢复任务进度/);assert.doesNotMatch(f.container.querySelector('[data-wj-wait-message]').textContent,/任务正在后台处理/);assert.equal(f.container.querySelector('[data-wj-units]').textContent,'1 / 3 个单元');assert.equal(f.container.querySelector('[data-wj-apply]'),null);assert.equal(f.panel.getState().itemId,'writing-1');
 }
 f.setRecord({id:'writing-1',operation:'draft',status:'running',completedUnits:2,totalUnits:3,stage:'reviewing_manuscript'});polls.run();await until(()=>f.container.querySelector('[data-wj-sync-status]').hidden&&/2 \/ 3/.test(f.container.querySelector('[data-wj-units]').textContent));
 assert.equal(f.container.firstElementChild,section);assert.equal(f.container.querySelector('[data-wj-result-window]'),window);assert.equal(f.container.querySelector('[data-wj-progress-status]').textContent,'正在生成');assert.match(f.container.querySelector('[data-wj-stage]').textContent,/审校全文/);assert.match(f.container.querySelector('[data-wj-wait-message]').textContent,/进度会自动更新/);assert.equal(polls.pending.size,1);
 f.setRecord({id:'writing-1',operation:'draft',status:'completed',output:{text:'服务器已完成的实际结果',sourceIds:[]}});polls.run();await until(()=>!!f.container.querySelector('[data-wj-apply]'));assert.equal(polls.pending.size,0);assert.match(f.container.querySelector('#writing-job-preview').value,/服务器已完成的实际结果/);assert.equal(f.calls.some(row=>['/writing/jobs','/writing/quote','/billing/quote'].includes(row.path)),false);
});

test('disposing an interrupted writing poll removes its retry and an in-flight late failure cannot recreate it',async t=>{
 let rejectRead,hold=false;const pending=new Promise((resolve,reject)=>{rejectRead=reject;}),snap=snapshot(),f=fixture(t,{initialState:{itemId:'writing-1',ownerId:'alice',snapshot:snap,contextKey:JSON.stringify(snap)},beforeApi:path=>hold&&path==='/writing/jobs/writing-1'?pending:undefined}),polls=capturePolls(f);
 f.setRecord({id:'writing-1',operation:'draft',status:'running',completedUnits:1,totalUnits:3});await f.panel.open();hold=true;polls.run();await until(()=>f.calls.filter(row=>row.path==='/writing/jobs/writing-1').length===2);const section=f.container.firstElementChild;f.panel.dispose();rejectRead(Error('late failure after disposal'));await new Promise(resolve=>setImmediate(resolve));assert.equal(polls.pending.size,0);assert.equal(f.container.firstElementChild,section);assert.equal(f.container.querySelector('[data-wj-sync-status]').hidden,true);assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);
});

test('disposing a writing panel clears an already scheduled retry after a status-read failure',async t=>{
 let fail=false;const snap=snapshot(),f=fixture(t,{initialState:{itemId:'writing-1',ownerId:'alice',snapshot:snap,contextKey:JSON.stringify(snap)},beforeApi:async path=>{if(fail&&path==='/writing/jobs/writing-1')throw Error('temporary status read failure');}}),polls=capturePolls(f);
 f.setRecord({id:'writing-1',operation:'outline',status:'queued',completedUnits:0,totalUnits:1});await f.panel.open();fail=true;polls.run();await until(()=>polls.pending.size===1&&!f.container.querySelector('[data-wj-sync-status]').hidden);assert.match(f.container.querySelector('[data-wj-progress-status]').textContent,/上次状态：正在排队/);f.panel.dispose();assert.equal(polls.pending.size,0);assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);
});

for(const mode of ['expired','switched'])test('automatic writing retries stop and hide the previous task after the account is '+mode,async t=>{
 let expired=false;const snap=snapshot(),f=fixture(t,{initialState:{itemId:'writing-1',ownerId:'alice',snapshot:snap,contextKey:JSON.stringify(snap)},beforeApi:async path=>{if(path==='/auth/me'&&expired)throw Object.assign(Error('expired'),{status:401});}}),polls=capturePolls(f);
 f.setRecord({id:'writing-1',operation:'draft',status:'running',completedUnits:1,totalUnits:3});await f.panel.open();if(mode==='expired')expired=true;else f.setOwner('bob');polls.run();await until(()=>!!f.container.querySelector('[role="alert"]'));assert.equal(polls.pending.size,0);assert.equal(f.container.querySelector('[data-wj-progress-status]'),null);assert.equal(f.container.querySelector('[data-wj-sync-status]'),null);assert.equal(f.container.querySelector('[data-wj-apply]'),null);assert.match(f.container.textContent,mode==='expired'?/请先登录后再生成/:/登录账户已变化/);assert.equal(f.calls.filter(row=>row.path==='/writing/jobs/writing-1').length,1);assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);
});

for(const status of [408,429,500,503])test('automatic writing status reads retry transient HTTP '+status+' without charging or recreating the task',async t=>{
 let fail=false;const snap=snapshot(),f=fixture(t,{initialState:{itemId:'writing-1',ownerId:'alice',snapshot:snap,contextKey:JSON.stringify(snap)},beforeApi:async path=>{if(fail&&path==='/writing/jobs/writing-1')throw Object.assign(Error('temporary '+status),{status});}}),polls=capturePolls(f);
 f.setRecord({id:'writing-1',operation:'draft',status:'running',completedUnits:1,totalUnits:3});await f.panel.open();const section=f.container.firstElementChild;fail=true;polls.run();await until(()=>polls.pending.size===1&&!f.container.querySelector('[data-wj-sync-status]').hidden);assert.equal(f.container.firstElementChild,section);assert.match(f.container.querySelector('[data-wj-progress-status]').textContent,/上次状态：正在生成/);assert.equal(f.panel.getState().itemId,'writing-1');fail=false;polls.run();await until(()=>f.container.querySelector('[data-wj-sync-status]').hidden);assert.equal(polls.pending.size,1);assert.equal(f.calls.some(row=>['/writing/jobs','/writing/quote'].includes(row.path)),false);
});

for(const [status,commandKey] of [[403,undefined],[404,'original-writing-command'],[422,'another-original-command']])test('permanent automatic writing read HTTP '+status+' pauses and only offers retrieval of the original task',async t=>{
 let fail=false;const snap=snapshot(),initialState={itemId:'writing-1',ownerId:'alice',snapshot:snap,contextKey:JSON.stringify(snap),...(commandKey?{commandKey}:{})},failure='原任务读取被拒绝（'+status+'）',f=fixture(t,{initialState,beforeApi:async path=>{if(fail&&path==='/writing/jobs/writing-1')throw Object.assign(Error(failure),{status});}}),polls=capturePolls(f);
 f.setRecord({id:'writing-1',operation:'draft',status:'running',completedUnits:1,totalUnits:3});await f.panel.open();fail=true;polls.run();await until(()=>!!f.container.querySelector('[role="alert"]'));assert.equal(f.container.querySelector('[role="alert"]').textContent,failure);assert.equal(polls.pending.size,0);assert.equal(f.container.querySelector('.generation-wait-spinner'),null);assert.equal(f.container.querySelector('[data-wj-progress-status]'),null);assert.equal(f.container.querySelector('[data-wj-new]'),null);assert.equal(f.container.querySelector('[data-wj-start]'),null);assert.equal(f.container.querySelector('[data-wj-apply]'),null);assert.match(f.container.querySelector('[data-wj-wait-message]').textContent,/自动读取已暂停.*不会重新生成或扣费/);assert.equal(f.panel.getState().itemId,'writing-1');assert.equal(f.panel.getState().commandKey,commandKey);const recover=f.container.querySelector('[data-wj-recover]');assert.ok(recover);assert.equal(recover.textContent,'读取原任务状态');
 // An explicit read may fail again, but it cannot silently resume polling or quote a new task.
 const beforeReads=f.calls.filter(row=>row.path==='/writing/jobs/writing-1').length;recover.click();await until(()=>f.calls.filter(row=>row.path==='/writing/jobs/writing-1').length===beforeReads+1&&!f.container.querySelector('[data-wj-recover]').disabled);assert.equal(polls.pending.size,0);assert.equal(f.container.querySelector('[data-wj-new]'),null);assert.equal(f.panel.getState().commandKey,commandKey);
 fail=false;f.setRecord({id:'writing-1',operation:'draft',status:'running',completedUnits:2,totalUnits:3});f.click('[data-wj-recover]');await until(()=>!!f.container.querySelector('[data-wj-progress-status]'));assert.equal(f.container.querySelector('[data-wj-progress-status]').textContent,'正在生成');assert.equal(f.container.querySelector('[role="alert"]'),null);assert.equal(polls.pending.size,1);assert.equal(f.panel.getState().itemId,'writing-1');assert.equal(f.panel.getState().commandKey,commandKey);assert.equal(f.calls.some(row=>['/writing/jobs','/writing/quote','/billing/quote'].includes(row.path)),false);
});

test('recovery-only panels preserve completed preview and same-context adoption without new quote or resume actions',async t=>{
 const snap=snapshot(),f=fixture(t,{initialState:{itemId:'writing-1',ownerId:'alice',snapshot:snap,contextKey:JSON.stringify(snap)}});await f.panel.open({recoverOnly:true});assert.match(f.container.querySelector('#writing-job-preview').value,/待核对的写作结果/);assert.equal(f.container.querySelector('[data-wj-apply]').disabled,false);for(const selector of ['[data-wj-new]','[data-wj-start]','[data-wj-consent]','[data-wj-resume]'])assert.equal(f.container.querySelector(selector),null);assert.equal(f.calls.some(row=>row.path==='/writing/quote'||row.path==='/writing/jobs'),false);f.click('[data-wj-apply]');await until(()=>/已采用/.test(f.container.textContent));assert.equal(f.calls.some(row=>row.path==='/writing/quote'||row.path==='/writing/jobs'),false);
});

test('recovery-only command lookups never quote when the original task is missing and authentication retry stays in recovery mode',async t=>{
 let failAuth=true;const f=fixture(t,{initialState:{commandKey:'not-yet-found',ownerId:'alice'},beforeApi:async path=>{if(path==='/auth/me'&&failAuth)throw Error('账户连接暂不可用');if(path==='/writing/jobs/by-key/not-yet-found')throw Object.assign(Error('任务不存在'),{status:404});}});await f.panel.open({recoverOnly:true});assert.ok(f.container.querySelector('[data-wj-auth-retry]'));failAuth=false;f.click('[data-wj-auth-retry]');await until(()=>/尚未找到原任务/.test(f.container.textContent));assert.equal(f.panel.getState().commandKey,'not-yet-found');assert.ok(f.container.querySelector('[data-wj-recover]'));assert.equal(f.container.querySelector('[data-wj-new]'),null);f.click('[data-wj-recover]');await until(()=>f.calls.filter(row=>row.path==='/writing/jobs/by-key/not-yet-found').length===2);assert.equal(f.calls.some(row=>row.path==='/writing/quote'||row.path==='/writing/jobs'),false);
});

test('recovery-only mode blocks detached new-generation and resume handlers from a previously opened normal panel',async t=>{
 const snap=snapshot(),f=fixture(t,{initialState:{itemId:'writing-1',ownerId:'alice',snapshot:snap,contextKey:JSON.stringify(snap)}});f.setRecord({id:'writing-1',kind:'article',operation:'draft',status:'failed',completedUnits:1,totalUnits:2,output:null});await f.panel.open();const newButton=f.container.querySelector('[data-wj-new]'),resumeButton=f.container.querySelector('[data-wj-resume]');assert.ok(newButton);assert.ok(resumeButton);await f.panel.open({recoverOnly:true});assert.equal(f.container.querySelector('[data-wj-new]'),null);assert.equal(f.container.querySelector('[data-wj-resume]'),null);for(const button of [newButton,resumeButton]){button.click();await until(()=>/仅查看原任务/.test(f.container.textContent));}assert.equal(f.panel.getState().itemId,'writing-1');assert.equal(f.calls.some(row=>row.path==='/writing/quote'||row.path==='/writing/jobs'),false);
});

test('recovery-only opening without a saved identifier ends authentication loading and never prepares a new request',async t=>{
 const f=fixture(t);await f.panel.open({recoverOnly:true});assert.match(f.container.textContent,/未找到已提交任务标识/);assert.equal(f.container.querySelector('[data-wj-auth-loading]'),null);assert.equal(f.container.querySelector('[data-wj-new]'),null);assert.equal(f.calls.some(row=>row.path==='/writing/quote'||row.path==='/writing/jobs'),false);
});

test('single-unit outline repair keeps a visible waiting bar and updates stages without replacing the panel',async t=>{
 const snap=snapshot(),f=fixture(t,{initialState:{itemId:'writing-1',ownerId:'alice',snapshot:snap,contextKey:JSON.stringify(snap)}}),polls=capturePolls(f);f.setRecord({id:'writing-1',operation:'outline',status:'running',stage:'checking_outline',completedUnits:0,totalUnits:1});await f.panel.open();const section=f.container.firstElementChild,bar=f.container.querySelector('[data-wj-progressbar]'),fill=f.container.querySelector('[data-wj-progress-fill]');assert.match(f.container.querySelector('[data-wj-stage]').textContent,/正在检查提纲/);assert.ok(bar.classList.contains('is-indeterminate'));assert.equal(bar.hasAttribute('aria-valuenow'),false);assert.equal(fill.style.width,'30%');
 f.setRecord({id:'writing-1',operation:'outline',status:'running',stage:'repairing_outline',completedUnits:0,totalUnits:1});polls.run();await until(()=>/正在自动完善提纲/.test(f.container.querySelector('[data-wj-stage]').textContent));assert.equal(f.container.firstElementChild,section);assert.equal(f.container.querySelector('[data-wj-progressbar]'),bar);assert.equal(f.container.querySelector('[data-wj-start]'),null);assert.equal(f.calls.some(row=>row.path==='/writing/jobs'),false);
 f.setRecord({id:'writing-1',operation:'outline',status:'completed',stage:'completed',completedUnits:1,totalUnits:1,output:{text:'已完成的合成提纲',sourceIds:[]}});polls.run();await until(()=>!!f.container.querySelector('[data-wj-apply]'));assert.equal(f.container.querySelector('[data-wj-progressbar]').classList.contains('is-indeterminate'),false);assert.equal(f.container.querySelector('[data-wj-progress-fill]').style.width,'100%');assert.equal(polls.pending.size,0);
});

for(const source of ['credits','bundle','membership','free'])test('direct wj generation submits once using '+source+' and exposes no fee confirmation',async t=>{
 const f=fixture(t,{getQuote:()=>({type:'agent',source,creditCost:source==='credits'?10:0,title:'测试用量',token:'direct-token',expiresAt:new Date(Date.now()+60000).toISOString()})});
 await f.panel.generate();const posts=f.calls.filter(row=>row.path==='/writing/jobs');assert.equal(posts.length,1);assert.equal(posts[0].data.billingToken,'direct-token');assert.equal(posts[0].data.consent,true);assert.ok(posts[0].data.clientKey);assert.equal(f.container.querySelector('[data-wj-consent]'),null);assert.equal(f.container.querySelector('[data-wj-start]'),null);
});
test('direct wj generation immediately waits and blocks repeat clicks while checking usage',async t=>{
 let release;const wait=new Promise(resolve=>release=resolve),f=fixture(t,{beforeApi:async path=>{if(path==='/writing/quote')await wait;}});
 const first=f.panel.generate();await until(()=>f.panel.busy());assert.equal(f.container.querySelector('[data-wj-result-window]').getAttribute('aria-busy'),'true');await f.panel.generate();release();await first;assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,1);
});
test('direct wj generation displays specific billing errors without reopening a confirmation',async t=>{
 const f=fixture(t,{beforeApi:async path=>{if(path==='/writing/jobs')throw Object.assign(Error('积分不足，本次需要 10 积分'),{status:402});}});await f.panel.generate();assert.match(f.container.querySelector('[role="alert"]').textContent,/积分不足.*10/);assert.equal(f.container.querySelector('[data-wj-start]'),null);assert.ok(f.panel.getState().commandKey);
});
test('direct wj generation reuses an active recovered task without requesting or reserving another job',async t=>{
 const f=fixture(t);f.setRecord({id:'writing-1',operation:'draft',kind:'article',status:'running',totalUnits:3,completedUnits:1});await f.panel.generate();await f.panel.generate();assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,1);assert.equal(f.calls.filter(row=>row.path==='/writing/quote').length,1);
});

test('a stale continuation marker cannot trap a new article request after a rejected submission',async t=>{
 const snap=snapshot(),key='pending-rejected-article',f=fixture(t,{initialState:{ownerId:'alice',commandKey:key,resumeFromJobId:'writing-1',snapshot:snap,contextKey:JSON.stringify(snap)},getQuote:()=>({type:'agent',source:'credits',creditCost:10,title:'当前文章',token:'new-content-token',expiresAt:new Date(Date.now()+60000).toISOString(),inputHash:'new-content-hash'}),beforeApi:async path=>{if(path.startsWith('/writing/jobs/by-key/'))throw Object.assign(Error('未提交的任务'),{status:404});}});
 f.setRecord({id:'writing-1',kind:'article',operation:'draft',status:'failed',completedUnits:2,totalUnits:8,inputHash:'old-content-hash'});
 await f.panel.generate();const posts=f.calls.filter(row=>row.path==='/writing/jobs');assert.equal(posts.length,1);assert.equal(posts[0].data.resumeFromJobId,undefined);assert.equal(posts[0].data.clientKey,key);assert.equal(f.panel.getState().resumeFromJobId,undefined);
});

test('automatic article recovery uses canonical quote hashes and starts fresh when normalized requirements changed',async t=>{
 const snap=snapshot(),f=fixture(t,{initialState:{ownerId:'alice',itemId:'writing-1',commandKey:'old-article-command',snapshot:snap,contextKey:JSON.stringify(snap)},getQuote:()=>({type:'agent',source:'bundle',creditCost:0,title:'当前文章',token:'new-canonical-token',expiresAt:new Date(Date.now()+60000).toISOString(),inputHash:'updated-canonical-hash'})});
 f.setRecord({id:'writing-1',kind:'article',operation:'draft',status:'failed',completedUnits:2,totalUnits:8,inputHash:'original-canonical-hash'});await f.panel.generate();
 const posts=f.calls.filter(row=>row.path==='/writing/jobs');assert.equal(posts.length,1);assert.equal(posts[0].data.resumeFromJobId,undefined);assert.notEqual(posts[0].data.clientKey,'old-article-command');assert.equal(f.calls.some(row=>row.path.endsWith('/cancel')),false);
});

test('explicit continuation stops before submission when canonical content changed and explains how to generate a new manuscript',async t=>{
 const snap=snapshot(),f=fixture(t,{initialState:{ownerId:'alice',itemId:'writing-1',snapshot:snap,contextKey:JSON.stringify(snap)},getQuote:()=>({type:'agent',source:'credits',creditCost:10,title:'当前文章',token:'changed-content-token',expiresAt:new Date(Date.now()+60000).toISOString(),inputHash:'changed-hash'})});
 f.setRecord({id:'writing-1',kind:'article',operation:'draft',status:'failed',completedUnits:2,totalUnits:8,inputHash:'old-hash'});await f.panel.open();f.click('[data-wj-resume]');
 await until(()=>!!f.container.querySelector('[role="alert"]'));assert.match(f.container.querySelector('[role="alert"]').textContent,/资料或要求已更新.*原稿已保留/);assert.equal(f.calls.filter(row=>row.path==='/writing/jobs').length,0);assert.equal(f.panel.getState().resumeFromJobId,undefined);
});

test('uncertain continuation submissions retain both the idempotency key and a valid origin across network retries',async t=>{
 let fail=true;const snap=snapshot(),key='uncertain-continuation',f=fixture(t,{initialState:{ownerId:'alice',commandKey:key,resumeFromJobId:'writing-1',snapshot:snap,contextKey:JSON.stringify(snap)},beforeApi:async path=>{if(path.startsWith('/writing/jobs/by-key/'))throw Object.assign(Error('正在确认原请求'),{status:404});if(path==='/writing/jobs'&&fail){fail=false;throw Error('提交响应暂时丢失');}}});
 f.setRecord({id:'writing-1',kind:'article',operation:'draft',status:'failed',completedUnits:2,totalUnits:8});await f.panel.generate();await f.panel.generate();const posts=f.calls.filter(row=>row.path==='/writing/jobs');assert.equal(posts.length,2);assert.ok(posts.every(row=>row.data.clientKey===key&&row.data.resumeFromJobId==='writing-1'));
});

test('an active task from another writing feature cannot block or become the origin of a new article',async t=>{
 const snap=snapshot(),f=fixture(t,{initialState:{ownerId:'alice',itemId:'writing-1',commandKey:'proposal-command',snapshot:snap,contextKey:JSON.stringify(snap)}});f.setRecord({id:'writing-1',kind:'proposal',operation:'draft',status:'running',completedUnits:1,totalUnits:3});await f.panel.generate();
 const posts=f.calls.filter(row=>row.path==='/writing/jobs');assert.equal(posts.length,1);assert.equal(posts[0].data.kind,'article');assert.equal(posts[0].data.resumeFromJobId,undefined);assert.notEqual(posts[0].data.clientKey,'proposal-command');assert.equal(f.calls.some(row=>row.path.endsWith('/cancel')),false);
});

test('different article content can start independently while the previous article is still running',async t=>{
 const old={...snapshot(),title:'之前正在生成的文章'},f=fixture(t,{initialState:{ownerId:'alice',itemId:'writing-1',commandKey:'running-old-article',snapshot:old,contextKey:JSON.stringify(old)}});f.setRecord({id:'writing-1',kind:'article',operation:'draft',status:'running',completedUnits:1,totalUnits:3});await f.panel.generate();
 const posts=f.calls.filter(row=>row.path==='/writing/jobs');assert.equal(posts.length,1);assert.equal(posts[0].data.snapshot.title,snapshot().title);assert.equal(posts[0].data.resumeFromJobId,undefined);assert.notEqual(posts[0].data.clientKey,'running-old-article');assert.equal(f.calls.some(row=>row.path.endsWith('/cancel')),false);
});

test('discarding an incompatible legacy continuation also requotes the newly selected project scope',async t=>{
 const snap=snapshot(),f=fixture(t,{initialState:{ownerId:'alice',itemId:'writing-1',commandKey:'legacy-project-command',projectId:'old-project',snapshot:snap,contextKey:JSON.stringify(snap)},getQuote:()=>({type:'agent',source:'credits',creditCost:10,title:'当前文章',token:'current-project-token',expiresAt:new Date(Date.now()+60000).toISOString(),inputHash:'new-hash'})});
 f.setRecord({id:'writing-1',projectId:'old-project',kind:'article',operation:'draft',status:'failed',completedUnits:2,totalUnits:8,inputHash:'old-hash'});await f.panel.generate();
 const quotes=f.calls.filter(row=>row.path==='/writing/quote'),post=f.calls.find(row=>row.path==='/writing/jobs');assert.equal(quotes.length,2);assert.equal(quotes[0].data.projectId,'old-project');assert.equal(quotes[1].data.projectId,undefined);assert.equal(post.data.projectId,undefined);assert.equal(post.data.resumeFromJobId,undefined);
});

test('a cancelled task is never implicitly resumed by the ordinary generation action',async t=>{
 const snap=snapshot(),f=fixture(t,{initialState:{ownerId:'alice',itemId:'writing-1',commandKey:'cancelled-original',snapshot:snap,contextKey:JSON.stringify(snap)}});f.setRecord({id:'writing-1',kind:'article',operation:'draft',status:'cancelled',completedUnits:2,totalUnits:8});await f.panel.generate();const post=f.calls.find(row=>row.path==='/writing/jobs');assert.ok(post);assert.equal(post.data.resumeFromJobId,undefined);assert.notEqual(post.data.clientKey,'cancelled-original');
});
