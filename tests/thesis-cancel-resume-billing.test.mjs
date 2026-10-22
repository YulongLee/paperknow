import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {createThesisService} from '../backend/thesis-service.mjs';
import {startThesisWorker} from '../backend/thesis-worker.mjs';

const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://fixture.example.invalid',model:'fixture',apiKey:'synthetic-only',version:'attempt-race-fixture',maxTurns:12,maxOutputTokens:4096,maxCostUsd:.5,timeoutMs:30000};
const snapshot={title:'合成验收：论文取消与恢复',profile:{level:'本科',language:'中文',targetWords:500},materials:[],references:[],outline:[{id:'a',title:'研究背景',targetWords:250},{id:'b',title:'研究设计',targetWords:250}]};
const section=(task,word='新',usage={input:100,output:300})=>({text:JSON.stringify({complete:true,draft:true,text:word.repeat(task.context.unit.targetWords-20)+'【待核对：来源与实际研究信息】',source_ids:[],missing_evidence:['请核对实际研究资料']}),usage,costUsd:.01,trace:[]});
const review=(usage={input:17,output:19})=>({text:JSON.stringify({complete:true,findings:[],limitations:['合成审校，不代表研究事实核验']}),usage,costUsd:.01,trace:[]});
const lateError=()=>Object.assign(new Error('synthetic late provider rejection'),{status:502,code:'provider_error',usage:{input:7777,output:8888},costUsd:.01,agentTrace:[{status:'denied',tool:'stale_tool'}]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function fixture(t,{quality=false,runner}={}){
 const db=database(':memory:'),user={id:randomUUID()},at=new Date().toISOString(),workers=[],requests=[];
 db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user.id,'隔离的恢复计费验收','user',at);
 const config={thesisContinuousEnabled:true,writingQualityEnabled:quality,thesisPollMs:60000,getAgentSettings:()=>({...settings}),citationVerifier:{verify:async()=>({items:[],summary:{},limitations:[],requests:0})},agentTaskRunner:async args=>args.task.skill==='writing-review'?review():section(args.task)};
 const billing=createBillingService(db,config);config.billing=billing;billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});
 const order=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,user.id,'credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,user.id,'credits-200',200,'purchase',at);
 const service=createThesisService(db,config),api=async(path,data)=>(await service.handle({path,method:data?'POST':'GET',user,readBody:async()=>data})).value;
 const get=id=>service.get(id,user),create=async()=>(await api('/api/theses',{snapshot,clientKey:randomUUID()})).item;
 async function submit(item,action='generate'){const quote=await api('/api/theses/'+item.id+'/quote',{version:item.version,action});return (await api('/api/theses/'+item.id+'/'+action,{version:item.version,clientKey:randomUUID(),consent:true,billingToken:quote.token})).item;}
 async function resume(id){await api('/api/theses/'+id+'/cancel',{version:get(id).version});return submit(get(id),'resume');}
 function start(){const worker=startThesisWorker(db,config);workers.push(worker);config.cancelThesisRun=id=>worker.cancel(id);return worker;}
 function hold(args){const request={...deferred(),args};requests.push(request);return request;}
 const holds=id=>db.prepare('SELECT attempt,status,credits FROM billing_reservations WHERE job_id=? ORDER BY attempt').all(id).map(row=>({...row}));
 const state=(id,runId)=>({run:{...db.prepare('SELECT * FROM thesis_runs WHERE id=?').get(runId)},job:{...db.prepare('SELECT * FROM jobs WHERE id=?').get(runId)},thesis:{...db.prepare('SELECT * FROM theses WHERE id=?').get(id)},checkpoints:db.prepare('SELECT * FROM thesis_checkpoints WHERE run_id=? ORDER BY position').all(runId).map(row=>({...row})),chapters:db.prepare('SELECT * FROM thesis_chapter_versions WHERE run_id=? ORDER BY chapter_id,version').all(runId).map(row=>({...row})),reviews:db.prepare('SELECT * FROM thesis_review_checkpoints WHERE run_id=? ORDER BY attempt,unit_id').all(runId).map(row=>({...row}))});
 if(runner)config.agentTaskRunner=args=>runner(args,{hold});
 t.after(async()=>{for(const request of requests)request.reject(Object.assign(new Error('fixture cleanup'),{code:'cancelled',status:499}));for(const worker of workers)await worker.stop();db.close();});
 return {db,user,config,billing,api,get,create,submit,resume,start,hold,holds,state};
}

for(const outcome of ['reject','success'])test('a late section '+outcome+' cannot mutate a newly queued resume or release its new credit hold',async t=>{
 let entered;const ready=new Promise(resolve=>entered=resolve);let old;
 const f=fixture(t,{runner:(args,{hold})=>{if(!old){old=hold(args);entered();return old.promise;}return section(args.task);}}),item=await f.submit(await f.create()),worker=f.start(),pending=worker.tick();await ready;
 const resumed=await f.resume(item.id),before=f.state(item.id,item.job.id);assert.equal(resumed.job.attempt,2);assert.equal(resumed.status,'queued');assert.deepEqual(f.holds(item.job.id),[{attempt:1,status:'released',credits:10},{attempt:2,status:'held',credits:10}]);
 old.args.onStage('stale_stage');if(outcome==='reject')old.reject(lateError());else old.resolve(section(old.args.task,'旧',{input:7777,output:8888}));await pending;
 assert.deepEqual(f.state(item.id,item.job.id),before);assert.deepEqual(f.holds(item.job.id),[{attempt:1,status:'released',credits:10},{attempt:2,status:'held',credits:10}]);assert.equal(f.billing.balance(f.user.id).held,10);
 await worker.tick();const done=f.get(item.id);assert.equal(done.status,'completed');assert.equal(done.job.attempt,2);assert.ok(done.chapters.every(chapter=>chapter.text.startsWith('新')));assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.billing.balance(f.user.id).held,0);
 assert.deepEqual(f.holds(item.job.id),[{attempt:1,status:'released',credits:10},{attempt:2,status:'settled',credits:10}]);assert.equal(f.db.prepare('SELECT input_tokens FROM thesis_runs WHERE id=?').get(item.job.id).input_tokens,200);assert.equal(f.db.prepare('SELECT count(*) n FROM results WHERE job_id=?').get(item.job.id).n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts WHERE job_id=?').get(item.job.id).n,2);
});

for(const outcome of ['reject','success'])test('a late section '+outcome+' cannot mutate another worker executing the resumed attempt',async t=>{
 let firstEntered,secondEntered;const firstReady=new Promise(resolve=>firstEntered=resolve),secondReady=new Promise(resolve=>secondEntered=resolve);let old,current,calls=0;
 const f=fixture(t,{runner:(args,{hold})=>{calls++;if(calls===1){old=hold(args);firstEntered();return old.promise;}if(calls===2){current=hold(args);secondEntered();return current.promise;}return section(args.task);}}),item=await f.submit(await f.create()),first=f.start(),pending=first.tick();await firstReady;await f.resume(item.id);
 const next=f.start(),resuming=next.tick();await secondReady;const before=f.state(item.id,item.job.id);assert.equal(before.run.status,'running');assert.equal(before.run.attempt,2);
 old.args.onStage('stale_stage');if(outcome==='reject')old.reject(lateError());else old.resolve(section(old.args.task,'旧',{input:7777,output:8888}));await pending;
 assert.deepEqual(f.state(item.id,item.job.id),before);assert.equal(f.holds(item.job.id)[1].status,'held');current.resolve(section(current.args.task));await resuming;
 assert.equal(f.get(item.id).status,'completed');assert.ok(f.get(item.id).chapters.every(chapter=>chapter.text.startsWith('新')));assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.holds(item.job.id)[1].status,'settled');assert.equal(f.db.prepare('SELECT input_tokens FROM thesis_runs WHERE id=?').get(item.job.id).input_tokens,200);
});

for(const outcome of ['reject','success'])test('a late quality-review '+outcome+' cannot write usage, review cache, result or settlement into the next attempt',async t=>{
 let entered;const ready=new Promise(resolve=>entered=resolve);let old;
 const f=fixture(t,{quality:true,runner:(args,{hold})=>{if(args.task.skill!=='writing-review')return section(args.task);if(!old){old=hold(args);entered();return old.promise;}return review();}}),item=await f.submit(await f.create()),worker=f.start(),pending=worker.tick();await ready;await f.resume(item.id);const before=f.state(item.id,item.job.id);
 assert.equal(before.run.attempt,2);assert.equal(before.checkpoints.filter(row=>row.status==='completed').length,2);old.args.onStage('stale_review');if(outcome==='reject')old.reject(lateError());else old.resolve(review({input:7777,output:8888}));await pending;
 assert.deepEqual(f.state(item.id,item.job.id),before);assert.equal(f.holds(item.job.id)[1].status,'held');await worker.tick();const done=f.get(item.id);assert.equal(done.status,'completed');assert.equal(done.quality.status,'completed');assert.equal(f.holds(item.job.id)[1].status,'settled');assert.equal(f.billing.balance(f.user.id).balance,190);
 assert.equal(f.db.prepare('SELECT input_tokens FROM thesis_runs WHERE id=?').get(item.job.id).input_tokens,217);assert.deepEqual(f.db.prepare('SELECT attempt FROM thesis_review_checkpoints WHERE run_id=?').all(item.job.id).map(row=>row.attempt),[2]);assert.equal(f.db.prepare('SELECT count(*) n FROM results WHERE job_id=?').get(item.job.id).n,1);
});

test('stopping an obsolete worker cannot requeue or fail a freshly resumed queued attempt in catch or finally',async t=>{
 let entered;const ready=new Promise(resolve=>entered=resolve);let old;
 const f=fixture(t,{runner:(args,{hold})=>{if(!old){old=hold(args);entered();return old.promise;}return section(args.task);}}),item=await f.submit(await f.create()),first=f.start(),pending=first.tick();await ready;await f.resume(item.id);const before=f.state(item.id,item.job.id),stopping=first.stop();old.reject(lateError());await stopping;await pending;
 assert.deepEqual(f.state(item.id,item.job.id),before);assert.equal(f.holds(item.job.id)[1].status,'held');await f.start().tick();assert.equal(f.get(item.id).status,'completed');assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.holds(item.job.id)[1].status,'settled');
});

test('normal maintenance still resumes the same continuous attempt and settles its original purchase once',async t=>{
 let entered,calls=0;const ready=new Promise(resolve=>entered=resolve);
 const f=fixture(t,{runner:async args=>{calls++;if(calls===2){entered();await new Promise((resolve,reject)=>args.signal.addEventListener('abort',()=>reject(Object.assign(new Error('synthetic maintenance'),{code:'cancelled',status:499})),{once:true}));}return section(args.task);}}),item=await f.submit(await f.create()),first=f.start(),pending=first.tick();await ready;await first.stop();await pending;
 const state=f.get(item.id);assert.equal(state.status,'queued');assert.equal(state.job.attempt,1);assert.equal(state.job.completedSections,1);assert.deepEqual(f.holds(item.job.id),[{attempt:1,status:'held',credits:10}]);await f.start().tick();
 assert.equal(f.get(item.id).status,'completed');assert.equal(f.get(item.id).job.attempt,1);assert.equal(calls,3);assert.equal(f.billing.balance(f.user.id).balance,190);assert.deepEqual(f.holds(item.job.id),[{attempt:1,status:'settled',credits:10}]);assert.equal(f.db.prepare('SELECT count(*) n FROM model_attempts WHERE job_id=?').get(item.job.id).n,1);
});
