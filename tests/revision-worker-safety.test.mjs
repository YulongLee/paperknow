import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createToolRunService} from '../backend/tool-run-service.mjs';
import {startToolRunWorker} from '../backend/tool-run-worker.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';

// Controlled worker integration: real quote/start, plan/checkpoints/settlement,
// only an injected local runner. No network listener or provider invocation.
const runtime={enabled:true,engine:'claude-agent-sdk',baseURL:'https://revision.invalid',model:'synthetic-model',apiKey:'not-a-real-key',version:'revision-test',maxTurns:12,maxOutputTokens:4096,maxCostUsd:.1,timeoutMs:30000};
const request=text=>({kind:'revision',operation:'rewrite',snapshot:{title:'Synthetic owned record',text,mode:'rewrite',context:{plan:'strong'}}});
const input=request('This synthetic record contains 20 cases [1] and remains a draft.');
const output=(task,{retain=false,...extra}={})=>({text:JSON.stringify({complete:true,sourceIds:[],paragraphs:task.context.unit.paragraphs.map(row=>({...row,revised:retain?row.original:row.original+' Wording improved.',action:retain?'retain':'revise',reason:retain?'Already sufficiently clear.':'Improve clarity.'}))}),trace:[],usage:{input:10,output:5},costUsd:.001,...extra});
function fixture(t,{settings={},runner,...extra}={}){
 const db=database(':memory:'),user={id:'revision-owner'},at=new Date().toISOString(),calls=[];db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user.id,'Synthetic owner','user',at);
 const config={getAgentSettings:()=>({...runtime,...settings}),toolPollMs:60000,...extra,agentTaskRunner:async args=>{calls.push({unit:args.task.context.unit.id,settings:args.settings});return runner?runner(args,calls):output(args.task);}};
 const billing=createBillingService(db,config);config.billing=billing;billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});const order=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,user.id,'credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,user.id,'credits-200',200,'purchase',at);
 const service=createToolRunService(db,config),worker=startToolRunWorker(db,config),call=(path,data)=>service.handle({path:'/api/tool-runs'+path,method:data===undefined?'GET':'POST',user,readBody:async()=>data});
 const submit=async(value=input,extra={})=>{const quote=await call('/quote',value);return call('/jobs',{...value,clientKey:randomUUID(),consent:true,billingToken:quote.value.token,...extra});};t.after(async()=>{await worker.stop();db.close();});
 return{db,user,billing,worker,service,call,submit,calls,get:id=>service.get(id,user)};
}
test('typed strategy and malformed protected input reject before quote or credit reservation',async t=>{
 const f=fixture(t);for(const value of [{...input,snapshot:{...input.snapshot,mode:'arbitrary'}},{...input,snapshot:{...input.snapshot,context:{plan:'arbitrary'}}},request('Unclosed display $$ x+y.'),request('\u200b\u2060\u00ad\u034f')])await assert.rejects(f.call('/quote',value));
 assert.equal(f.db.prepare('SELECT count(*) n FROM tool_quotes').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);assert.equal(f.calls.length,0);
});
test('minimum valid .01 SDK ceiling dispatches once with the original cap and settles exactly once',async t=>{
 const f=fixture(t,{settings:{maxCostUsd:.01}}),created=await f.submit(),id=created.value.item.id;await f.worker.tick();await f.worker.tick();assert.equal(f.get(id).status,'completed');assert.equal(f.calls.length,1);assert.equal(f.calls[0].settings.maxCostUsd,.01);assert.equal(f.billing.balance(f.user.id).balance,190);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,1);
});
test('remaining SDK budget below .01 stops before another dispatch and preserves the first checkpoint',async t=>{
 const f=fixture(t,{settings:{maxCostUsd:.02},runner:async({task})=>output(task,{costUsd:.01001})}),created=await f.submit(request(['A'.repeat(1200),'B'.repeat(1200)].join('\n\n'))),id=created.value.item.id;await f.worker.tick();assert.equal(f.get(id).status,'failed');assert.match(f.get(id).error,/预算/);assert.equal(f.calls.length,1);assert.equal(f.get(id).completedUnits,1);assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.billing.balance(f.user.id).held,0);
});
test('minimum cap still rejects a response above its budget before checkpoint and charge',async t=>{
 const f=fixture(t,{settings:{maxCostUsd:.01},runner:async({task})=>output(task,{costUsd:.010001})}),created=await f.submit(),id=created.value.item.id;await f.worker.tick();assert.equal(f.calls.length,1);assert.equal(f.get(id).status,'failed');assert.equal(f.get(id).completedUnits,0);assert.equal(f.billing.balance(f.user.id).balance,200);
});
test('all-retain job preserves checkpoints and releases credits without result or successful usage settlement',async t=>{
 const f=fixture(t,{runner:async({task})=>output(task,{retain:true})}),created=await f.submit(),id=created.value.item.id;await f.worker.tick();const job=f.get(id);assert.equal(job.status,'failed');assert.match(job.error,/均未实际修改/);assert.equal(job.completedUnits,1);assert.equal(job.output,null);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,0);assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.billing.balance(f.user.id).held,0);
 const resumed=await f.submit(input,{resumeFromJobId:id});await f.worker.tick();assert.equal(f.get(resumed.value.item.id).status,'failed');assert.equal(f.calls.length,1);assert.equal(f.billing.balance(f.user.id).balance,200);
});
test('invisible formatting-only revisions never create chargeable results',async t=>{
 for(const ignored of ['\u200b','\u2060','\u00ad','\u034f','\ufe0f']){const f=fixture(t,{runner:async({task})=>{const r=output(task),body=JSON.parse(r.text);for(const row of body.paragraphs)row.revised=row.original+ignored;return{...r,text:JSON.stringify(body)};}}),created=await f.submit(),id=created.value.item.id;await f.worker.tick();assert.equal(f.get(id).status,'failed');assert.equal(f.get(id).completedUnits,0);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,0);assert.equal(f.billing.balance(f.user.id).balance,200);}
});
test('retain unit plus changed unit succeeds once with exact source paragraphs, counts and review flags',async t=>{
 const f=fixture(t,{runner:async({task})=>output(task,{retain:task.context.unit.id==='unit-0'})}),created=await f.submit(request(['A'.repeat(1200),'B'.repeat(1200)].join('\n\n'))),id=created.value.item.id;await f.worker.tick();const job=f.get(id);assert.equal(job.status,'completed',JSON.stringify(job));assert.equal(job.output.changedParagraphs,1);assert.equal(job.output.retainedParagraphs,1);assert.equal(job.output.factsVerified,false);assert.equal(job.output.requiresReview,true);assert.deepEqual(job.output.paragraphs.map(row=>row.action),['retain','revise']);assert.equal(f.billing.balance(f.user.id).balance,190);
});
test('protection violation and missing output cannot create checkpoint, settle, or silently retry',async t=>{
 for(const type of ['unit','formula','deleted','invisible-length-padding','missing','unchanged']){
  const f=fixture(t,{runner:async({task})=>{const r=output(task),body=JSON.parse(r.text),row=body.paragraphs[0];if(type==='unit')row.revised=row.revised.replace('mg','g');if(type==='formula')row.revised=row.revised.replace('$x+y=z$','$x-y=z$');if(type==='deleted')row.revised='Short.';if(type==='invisible-length-padding')row.revised='-3 mg $x+y=z$ [1] '+ '\u200b\u034f'.repeat(100);if(type==='missing')body.paragraphs=[];if(type==='unchanged'){row.revised=row.original;delete row.action;delete row.reason;}return{...r,text:JSON.stringify(body)};}}),created=await f.submit(request('This synthetic record reports -3 mg and $x+y=z$ with [1]. The rest is owned illustrative material requiring careful review.')),id=created.value.item.id;
  await f.worker.tick();await f.worker.tick();assert.equal(f.get(id).status,'failed',type);assert.equal(f.get(id).completedUnits,0,type);assert.equal(f.calls.length,1,type);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0,type);assert.equal(f.billing.balance(f.user.id).balance,200,type);
 }
});
test('explicit resume reuses a retained unit and processes only remaining changed units',async t=>{
 let fail=true;const f=fixture(t,{runner:async({task})=>{if(fail&&task.context.unit.id==='unit-1')throw Object.assign(Error('Synthetic interruption'),{usage:{input:2,output:1},costUsd:.001});return output(task,{retain:task.context.unit.id==='unit-0'});}}),value=request(['A'.repeat(1200),'B'.repeat(1200),'C'.repeat(1200)].join('\n\n')),first=await f.submit(value),old=first.value.item.id;await f.worker.tick();assert.equal(f.get(old).completedUnits,1);fail=false;const next=await f.submit(value,{resumeFromJobId:old});await f.worker.tick();const job=f.get(next.value.item.id);assert.equal(job.status,'completed',JSON.stringify(job));assert.deepEqual(f.calls.map(c=>c.unit),['unit-0','unit-1','unit-1','unit-2']);assert.equal(job.output.changedParagraphs,2);assert.equal(job.output.retainedParagraphs,1);assert.equal(f.billing.balance(f.user.id).balance,190);
});
test('corrupt checkpoint identity or protected span stops resume before another provider call',async t=>{
 for(const corrupt of ['position','protected']){
  let fail=true;const f=fixture(t,{runner:async({task})=>{if(fail&&task.context.unit.id==='unit-1')throw Object.assign(Error('Synthetic interruption'),{usage:{input:2,output:1},costUsd:.001});return output(task);}}),value=request(['Synthetic 20 [1] '.padEnd(1200,'A'),'B'.repeat(1200)].join('\n\n')),first=await f.submit(value),old=first.value.item.id;await f.worker.tick();assert.equal(f.get(old).completedUnits,1);
  if(corrupt==='position')f.db.prepare('UPDATE tool_checkpoints SET position=1 WHERE run_id=?').run(old);else{const cp=f.db.prepare('SELECT output FROM tool_checkpoints WHERE run_id=?').get(old),body=JSON.parse(cp.output);body.paragraphs[0].revised=body.paragraphs[0].revised.replace('20','99');f.db.prepare('UPDATE tool_checkpoints SET output=? WHERE run_id=?').run(JSON.stringify(body),old);}
  fail=false;const next=await f.submit(value,{resumeFromJobId:old});await f.worker.tick();assert.equal(f.get(next.value.item.id).status,'failed',corrupt);assert.equal(f.calls.length,2,corrupt);assert.equal(f.billing.balance(f.user.id).balance,200,corrupt);
 }
});
test('unknown usage/cost, cancellation and token limits still fail closed with the new revision contract',async t=>{
 for(const extra of [{usage:null},{costUsd:null},{usage:{input:999,output:2}}]){const f=fixture(t,{toolMaxTokens:1000,runner:async({task})=>output(task,extra)}),created=await f.submit(),id=created.value.item.id;await f.worker.tick();assert.equal(f.get(id).status,'failed');assert.equal(f.get(id).completedUnits,0);assert.equal(f.billing.balance(f.user.id).balance,200);}
 let enter,finish;const entered=new Promise(resolve=>{enter=resolve;}),pending=new Promise(resolve=>{finish=resolve;}),f=fixture(t,{runner:async({task})=>{enter();await pending;return output(task);}}),created=await f.submit(),id=created.value.item.id,tick=f.worker.tick();await entered;f.worker.cancel(id);finish();await tick;assert.equal(f.get(id).status,'cancelled');assert.equal(f.get(id).completedUnits,0);assert.equal(f.billing.balance(f.user.id).balance,200);assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='release'").get().n,1);
});
