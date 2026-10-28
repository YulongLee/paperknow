import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createWritingService} from '../backend/writing-service.mjs';
import {startWritingWorker} from '../backend/writing-worker.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {environmentConfig} from '../backend/config.mjs';

const runtime={enabled:true,engine:'claude-agent-sdk',baseURL:'https://synthetic.example.test',model:'synthetic',apiKey:'synthetic-only',version:'concurrent-v1',maxTurns:12,maxOutputTokens:4096,maxCostUsd:.5,timeoutMs:30000};
const output=()=>({text:JSON.stringify({complete:true,text:'拟'.repeat(200),source_ids:[],missing_evidence:[]}),usage:{input:1000,output:300},costUsd:.01,trace:[]});
const until=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setImmediate(resolve));}assert.ok(check(),'并发任务未达到预期状态');};
function fixture(t,extra={}){
 const db=database(':memory:'),at=new Date().toISOString();
 for(const id of ['alice','bob'])db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,'合成并发账户','user',at);
 const config={writingPollMs:60000,writingQualityEnabled:false,getAgentSettings:()=>({...runtime}),agentTaskRunner:async()=>output(),...extra},billing=createBillingService(db,config);config.billing=billing;
 billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});
 for(const id of ['alice','bob']){const order=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,id,'credits-500','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,id,'credits-500',500,'purchase',at);}
 const service=createWritingService(db,config),workers=[];
 const api=async(path,body,user='alice')=>(await service.handle({path:'/api/writing'+path,method:body?'POST':'GET',user:{id:user},readBody:async()=>body})).value;
 const submit=async(title,user='alice',kind='article')=>{const snapshot={title,profile:{level:'本科',language:'中文',targetWords:200},materials:[],references:[],outline:[{id:'body',title:'方案设计',targetWords:200,sections:[]}]},quote=await api('/quote',{kind,operation:'draft',snapshot},user);return(await api('/jobs',{kind,operation:'draft',snapshot,billingToken:quote.token,clientKey:randomUUID(),consent:true},user)).item;};
 const start=()=>{const worker=startWritingWorker(db,config);workers.push(worker);config.cancelWriting=id=>worker.cancel(id);return worker;};
 t.after(async()=>{for(const worker of workers)await worker.stop();db.close();});return {db,config,billing,api,submit,start,get:(id,user='alice')=>service.get(id,{id:user})};
}
function blockedRunner(){
 const gates=new Map(),calls=[];let active=0,peak=0;
 const run=({task,signal})=>new Promise((resolve,reject)=>{
  const title=task.context.title;calls.push(title);active++;peak=Math.max(peak,active);let done=false;
  const finish=(error)=>{if(done)return;done=true;active--;signal.removeEventListener('abort',abort);error?reject(error):resolve(output());};
  const abort=()=>finish(Object.assign(Error('Synthetic stop'),{status:499,code:'aborted',usage:{input:100,output:20},costUsd:.001}));
  signal.addEventListener('abort',abort,{once:true});gates.set(title,()=>finish());if(signal.aborted)abort();
 });
 return {run,calls,gates,get active(){return active;},get peak(){return peak;},release(title){assert.ok(gates.has(title));gates.get(title)();}};
}

test('three writing jobs execute concurrently, refill a free slot and settle each owner exactly once',async t=>{
 const runner=blockedRunner(),f=fixture(t,{agentTaskRunner:runner.run}),items=[];
 for(const title of ['article-a','article-b','proposal-c'])items.push(await f.submit(title,'alice',title==='proposal-c'?'proposal':'article'));
 const bob=await f.submit('course-d','bob','course'),worker=f.start(),first=worker.tick();await until(()=>runner.active===3);
 assert.equal(runner.peak,3);assert.equal(f.get(bob.id,'bob').status,'queued');assert.equal(f.billing.balance('alice').held,30);
 assert.equal(f.db.prepare("SELECT count(*) n FROM writing_runs WHERE status='running'").get().n,3);await worker.tick();assert.equal(runner.calls.length,3,'A busy poll cannot duplicate a running task');
 runner.release('article-a');await until(()=>f.get(items[0].id).status==='completed');const next=worker.tick();await until(()=>runner.calls.includes('course-d'));
 assert.equal(runner.peak,3);runner.release('article-b');runner.release('proposal-c');runner.release('course-d');await Promise.all([first,next]);
 assert.ok(items.every(item=>f.get(item.id).status==='completed'));assert.equal(f.get(bob.id,'bob').status,'completed');assert.equal(new Set(runner.calls).size,4);
 assert.equal(f.billing.balance('alice').balance,470);assert.equal(f.billing.balance('bob').balance,490);assert.equal(f.billing.balance('alice').held,0);
 assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,4);assert.equal(f.db.prepare('SELECT count(DISTINCT job_id) n FROM results').get().n,4);
 for(const row of f.db.prepare('SELECT r.user_id owner,r.body,w.user_id expected_owner,w.kind,w.snapshot FROM results r JOIN writing_runs w ON r.job_id=w.id').all()){const body=JSON.parse(row.body);assert.equal(row.owner,row.expected_owner);assert.equal(body.kind,row.kind);assert.equal(body.sourceSnapshot.title,JSON.parse(row.snapshot).title);}
});

test('cancelling one parallel writing job leaves the other two running and refunds only that job',async t=>{
 const runner=blockedRunner(),f=fixture(t,{agentTaskRunner:runner.run}),items=[];for(const title of ['cancel-a','keep-b','keep-c'])items.push(await f.submit(title));
 const worker=f.start(),pending=worker.tick();await until(()=>runner.active===3);await f.api('/jobs/'+items[0].id+'/cancel',{});await until(()=>runner.active===2);
 assert.equal(f.get(items[0].id).status,'cancelled');assert.ok(items.slice(1).every(item=>f.get(item.id).status==='running'));assert.equal(f.billing.balance('alice').held,20);
 runner.release('keep-b');runner.release('keep-c');await pending;assert.equal(f.billing.balance('alice').balance,480);assert.equal(f.billing.balance('alice').held,0);
 assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,2);assert.equal(f.db.prepare('SELECT count(*) n FROM results WHERE job_id=?').get(items[0].id).n,0);
});

test('maintenance stop drains all parallel executions and restarts their original jobs without a second reservation',async t=>{
 const runner=blockedRunner(),f=fixture(t,{writingContinuousEnabled:true,agentTaskRunner:runner.run}),items=[];for(const title of ['recover-a','recover-b','recover-c'])items.push(await f.submit(title));
 const worker=f.start(),pending=worker.tick();await until(()=>runner.active===3);await worker.stop();await pending;
 assert.equal(runner.active,0);assert.ok(items.every(item=>f.get(item.id).status==='queued'));assert.equal(f.billing.balance('alice').held,30);
 f.config.agentTaskRunner=async()=>output();const replacement=f.start();await replacement.tick();assert.ok(items.every(item=>f.get(item.id).status==='completed'));
 assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='reserve'").get().n,3);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,3);assert.equal(f.billing.balance('alice').balance,470);
});

test('operator concurrency is bounded and the per-account three-task admission limit remains effective',async t=>{
 const runner=blockedRunner(),f=fixture(t,{writingConcurrency:1,agentTaskRunner:runner.run});for(const title of ['serial-a','serial-b','serial-c'])await f.submit(title);
 await assert.rejects(()=>f.submit('fourth-a'),error=>error.status===429&&/3 个/.test(error.message));const worker=f.start(),pending=worker.tick();await until(()=>runner.active===1);assert.equal(runner.calls.length,1);runner.release('serial-a');await pending;
 assert.equal(environmentConfig({PK_WRITING_CONCURRENCY:'2'}).writingConcurrency,2);assert.equal(environmentConfig({}).writingConcurrency,undefined);
 for(const limit of [0,4,1.5,NaN,'3'])assert.throws(()=>startWritingWorker(f.db,{...f.config,writingConcurrency:limit}),/并发数/);
});
