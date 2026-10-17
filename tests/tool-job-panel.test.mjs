import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountToolJobPanel} from '../dist/workspace/tool-job-panel.mjs';

const originalSnapshot=()=>({title:'【合成验收】科研方法演示',text:'',requirements:'介绍研究问题与证据边界',language:'中文',mode:'ai',materials:[],context:{pages:6}});
const quote=()=>({type:'agent',source:'credits',title:'演示文稿创作',token:'fixture-quote',creditCost:10,expiresAt:new Date(Date.now()+60000).toISOString()});
const completedJob=(id='job-alice')=>({id,kind:'presentation',operation:'ppt',status:'completed',completedUnits:1,totalUnits:1,output:{text:'仅属于原账户的合成验收内容',slides:[],sourceIds:[]}});
const until=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.ok(check(),'异步界面未达到预期状态');};
function fixture(t,{initialState={},onApply=()=>{},initialJob=completedJob(),initialOwner='alice',kind='presentation',operation='ppt'}={}){
 const dom=new JSDOM('<main class="dashboard"><div id="job"></div></main>',{url:'https://paperknow.cn/workspace.html#category/ppt'}),w=dom.window,container=w.document.querySelector('#job');
 let ownerId=initialOwner,snapshot=originalSnapshot(),job=structuredClone(initialJob),applies=0;const requests=[],states=[],instances=[];
 const api=async(path,data)=>{requests.push({path,data:data===undefined?undefined:structuredClone(data),ownerId});
  if(path==='/auth/me'){if(!ownerId)throw Object.assign(Error('登录已失效'),{status:401});return {user:{id:ownerId}};}
  if(path==='/tool-runs/capabilities')return {ready:true};
  if(path==='/tool-runs/quote')return quote();
  if(path==='/tool-runs/jobs'){job={...job,id:'job-'+ownerId};return {item:structuredClone(job)};}
  if(path.startsWith('/tool-runs/jobs/by-key/'))throw Object.assign(Error('尚无任务'),{status:404});
  if(path==='/tool-runs/jobs/'+job.id){if(!job.id.endsWith(ownerId))throw Object.assign(Error('任务不存在'),{status:404});return {item:structuredClone(job)};}
  throw Error('测试不允许的请求 '+path);
 };
 const options={container,kind,operation,getSnapshot:()=>snapshot,ctx:{api},onStateChange:state=>states.push(structuredClone(state)),onApply:async(output,item)=>{applies++;return onApply(output,item);}};
 const mount=state=>{const panel=mountToolJobPanel({...options,initialState:state});instances.push(panel);return panel;};const panel=mount(initialState);
 t.after(()=>{for(const instance of instances)instance.dispose();w.close();});
 const stateFor=(value=originalSnapshot(),id='job-alice',owner='alice')=>({snapshot:structuredClone(value),contextKey:JSON.stringify(value),ownerId:owner,itemId:id,commandKey:'old-command-key'});
 return {w,container,requests,states,panel,mount,stateFor,applies:()=>applies,setOwner:value=>{ownerId=value;},setSnapshot:value=>{snapshot=value;},setJob:value=>{job=structuredClone(value);},getSnapshot:()=>snapshot,
 click:selector=>{const button=container.querySelector(selector);assert.ok(button,'未找到控件 '+selector);button.click();},consent:()=>{const input=container.querySelector('[data-tj-consent]');assert.ok(input);input.checked=true;input.dispatchEvent(new w.Event('change',{bubbles:true}));}};
}

test('tool fee preview, consent selection and closing do not submit work before explicit start',async t=>{
 const f=fixture(t);await f.panel.open();assert.match(f.container.textContent,/10 科研积分/);assert.equal(f.container.querySelector('[data-tj-start]').disabled,true);assert.equal(f.requests.filter(r=>r.path==='/tool-runs/jobs').length,0);
 f.consent();assert.equal(f.container.querySelector('[data-tj-start]').disabled,false);assert.equal(f.requests.filter(r=>r.path==='/tool-runs/jobs').length,0);f.click('[data-tj-close]');assert.equal(f.container.hidden,true);assert.equal(f.requests.filter(r=>r.path==='/tool-runs/jobs').length,0);
 await f.panel.open();f.consent();f.click('[data-tj-start]');await until(()=>!!f.container.querySelector('[data-tj-apply]'));const starts=f.requests.filter(r=>r.path==='/tool-runs/jobs');assert.equal(starts.length,1);assert.equal(starts[0].data.consent,true);assert.equal(starts[0].data.billingToken,'fixture-quote');assert.deepEqual(starts[0].data.snapshot,f.getSnapshot());
});

test('complete getState restores the original task without another quote, reservation or job submission',async t=>{
 const f=fixture(t,{initialJob:{...completedJob(),status:'running',output:null,completedUnits:0}});await f.panel.open();f.consent();f.click('[data-tj-start]');await until(()=>f.panel.getState().itemId==='job-alice');const saved=structuredClone(f.panel.getState());assert.deepEqual(saved.snapshot,f.getSnapshot());assert.equal(saved.contextKey,JSON.stringify(f.getSnapshot()));assert.equal(saved.ownerId,'alice');assert.ok(saved.commandKey);assert.equal(saved.itemId,'job-alice');
 f.panel.dispose();f.setJob(completedJob());const restored=f.mount(saved);await restored.open();assert.equal(f.container.querySelector('[data-tj-preview]').value,'仅属于原账户的合成验收内容');assert.equal(restored.getState().itemId,'job-alice');assert.deepEqual(restored.getState().snapshot,saved.snapshot);assert.equal(f.requests.filter(r=>r.path==='/tool-runs/jobs').length,1);assert.equal(f.requests.filter(r=>r.path==='/tool-runs/quote').length,1);assert.ok(f.requests.some(r=>r.path==='/tool-runs/jobs/job-alice'));
});

test('switching accounts hides old output and requires explicit fresh task confirmation under the new owner',async t=>{
 const f=fixture(t);const first=f.mount(f.stateFor());await first.open();assert.match(f.container.querySelector('[data-tj-preview]').value,/仅属于原账户/);const oldReads=f.requests.filter(r=>r.path==='/tool-runs/jobs/job-alice').length;
 f.setOwner('bob');f.setSnapshot({...originalSnapshot(),title:'当前账户的新演示'});await first.refresh();assert.equal(f.container.querySelector('[data-tj-preview]'),null);assert.doesNotMatch(f.container.textContent,/仅属于原账户的合成验收内容/);assert.ok(f.container.querySelector('[data-tj-change-owner]'));assert.equal(f.requests.filter(r=>r.path==='/tool-runs/jobs/job-alice').length,oldReads);
 f.click('[data-tj-change-owner]');await until(()=>!!f.container.querySelector('[data-tj-consent]'));const fresh=first.getState();assert.equal(fresh.ownerId,'bob');assert.equal(fresh.itemId,null);assert.notEqual(fresh.commandKey,'old-command-key');assert.equal(fresh.appliedJobId,undefined);assert.equal(fresh.snapshot.title,'当前账户的新演示');assert.equal(f.requests.filter(r=>r.path==='/tool-runs/jobs').length,0);
 f.consent();f.click('[data-tj-start]');await until(()=>first.getState().itemId==='job-bob');const submitted=f.requests.filter(r=>r.path==='/tool-runs/jobs');assert.equal(submitted.length,1);assert.equal(submitted[0].ownerId,'bob');assert.equal(submitted[0].data.resumeFromJobId,undefined);assert.equal(submitted[0].data.snapshot.title,'当前账户的新演示');
});

test('a restored task from another owner is never fetched or displayed before explicit account reset',async t=>{
 const f=fixture(t,{initialOwner:'bob'}),restored=f.mount(f.stateFor());await restored.open();assert.equal(f.requests.filter(r=>r.path==='/tool-runs/jobs/job-alice').length,0);assert.equal(f.container.querySelector('[data-tj-preview]'),null);assert.equal(f.container.querySelector('[data-tj-start]'),null);assert.ok(f.container.querySelector('[data-tj-change-owner]'));
});

test('snapshot drift prevents both creating a stale job and adopting an old completed result',async t=>{
 const f=fixture(t);await f.panel.open();f.consent();f.setSnapshot({...originalSnapshot(),requirements:'已修改的汇报重点'});f.click('[data-tj-start]');await until(()=>/确认当前资料/.test(f.container.querySelector('[role="alert"]')?.textContent||''));assert.equal(f.requests.filter(r=>r.path==='/tool-runs/jobs').length,0);
 f.panel.dispose();const restored=f.mount(f.stateFor(originalSnapshot()));await restored.open();assert.equal(f.container.querySelector('[data-tj-apply]').disabled,true);assert.match(f.container.textContent,/输入已有修改/);assert.equal(f.applies(),0);
 f.setSnapshot(originalSnapshot());await restored.refresh();assert.equal(f.container.querySelector('[data-tj-apply]').disabled,false);f.setSnapshot({...originalSnapshot(),title:'尚未重绘的新题目'});f.click('[data-tj-apply]');await until(()=>/资料已有变化/.test(f.container.querySelector('[role="alert"]')?.textContent||''));assert.equal(f.applies(),0);assert.equal(restored.getState().appliedJobId,undefined);
});

test('app adoption state is persisted before a synchronous dispose and redraw can mount a replacement panel',async t=>{
 let f,current,replacement;f=fixture(t,{onApply:async()=>{const snapshot=current.getState();assert.equal(snapshot.appliedJobId,'job-alice');assert.equal(f.states.at(-1).appliedJobId,'job-alice');current.dispose();f.container.innerHTML='';replacement=f.mount(snapshot);await replacement.open();}});current=f.mount(f.stateFor());await current.open();f.click('[data-tj-apply]');await until(()=>!!replacement&&f.container.querySelector('[data-tj-apply]')?.textContent.includes('已采用'));assert.equal(f.applies(),1);assert.equal(replacement.getState().appliedJobId,'job-alice');assert.equal(f.container.querySelector('[data-tj-apply]').disabled,true);f.click('[data-tj-apply]');assert.equal(f.applies(),1);assert.equal(f.requests.filter(r=>r.path==='/tool-runs/jobs').length,0);
});

test('failed adoption rolls back persisted appliedJobId and permits a deliberate retry without another charge',async t=>{
 let fail=true;const f=fixture(t,{onApply:()=>{if(fail)throw Error('目标编辑器未能导入');}}),panel=f.mount(f.stateFor());await panel.open();f.click('[data-tj-apply]');await until(()=>/目标编辑器未能导入/.test(f.container.querySelector('[role="alert"]')?.textContent||''));assert.equal(f.applies(),1);assert.equal(panel.getState().appliedJobId,undefined);assert.equal(f.states.at(-1).appliedJobId,undefined);assert.ok(f.states.some(s=>s.appliedJobId==='job-alice'));assert.equal(f.container.querySelector('[data-tj-apply]').disabled,false);assert.ok(f.container.querySelector('[data-tj-preview]'));
 fail=false;f.click('[data-tj-apply]');await until(()=>panel.getState().appliedJobId==='job-alice'&&f.container.querySelector('[data-tj-apply]')?.textContent.includes('已采用'));assert.equal(f.applies(),2);assert.equal(f.requests.filter(r=>r.path==='/tool-runs/jobs').length,0);assert.equal(f.requests.filter(r=>r.path==='/tool-runs/quote').length,0);
});


test('inputChanged immediately revokes stale consent and disables start without requesting another quote',async t=>{
 const f=fixture(t);await f.panel.open();f.consent();const before=f.requests.length;assert.equal(f.container.querySelector('[data-tj-start]').disabled,false);f.setSnapshot({...originalSnapshot(),requirements:'报价后修改的用户资料'});f.panel.inputChanged();assert.equal(f.requests.length,before);assert.equal(f.container.querySelector('[data-tj-start]').disabled,true);assert.equal(f.container.querySelector('[data-tj-consent]').checked,false);assert.match(f.container.textContent,/输入已有修改/);f.setSnapshot(originalSnapshot());f.panel.inputChanged();assert.equal(f.requests.length,before);assert.equal(f.container.querySelector('[data-tj-start]').disabled,true);assert.equal(f.requests.filter(r=>r.path==='/tool-runs/jobs').length,0);
});


test('format suggestions are fully readable before adoption without modifying the document',async t=>{
 const job={...completedJob(),kind:'format',operation:'format',output:{text:'格式复核建议',suggestions:[{location:'段落 1',issue:'字号为 10.5 pt',action:'改为 16 pt'},{location:'第 1 节',issue:'上边距为 2.54 cm',action:'改为 2.5 cm'}]}};
 const f=fixture(t,{kind:'format',operation:'format',initialJob:job});const panel=f.mount(f.stateFor());await panel.open();
 const preview=f.container.querySelector('[data-tj-preview]').value;assert.match(preview,/段落 1[\s\S]*10\.5 pt[\s\S]*16 pt/);assert.match(preview,/第 1 节[\s\S]*2\.54 cm[\s\S]*2\.5 cm/);assert.equal(f.applies(),0);assert.equal(f.requests.filter(r=>r.path==='/tool-runs/jobs').length,0);
});
