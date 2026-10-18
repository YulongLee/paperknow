import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {createModeratedAgentRunner,moderateTextOrFail} from '../backend/moderated-agent.mjs';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {startWorker} from '../backend/worker.mjs';

const secret='fixture-private-credential-not-for-users';
const model='fixture-private-model-not-for-users';
function taskArgs(extra={}){
 return {settings:{apiKey:secret,model,baseURL:'https://private-provider.invalid/v1'},task:{skill:'writing-task',instructions:'服务器配置的写作契约',context:{title:'合成研究题目',requirements:'合成的研究要求'},materials:[{id:'authorized-source',name:'授权资料',text:'本次任务授权的合成资料正文'}]},signal:new AbortController().signal,...extra};
}
function safeError(error,status){
 assert.equal(error.status,status);assert.equal(error.moderationSafe,true);
 assert.doesNotMatch(error.message,new RegExp(secret+'|'+model+'|raw-provider-label|raw-provider-error'));
 assert.equal(error.cause,undefined);return true;
}

test('public Agent checks only selected input and final output, preserving signal and result identity',async()=>{
 const stages=[],checks=[],args=taskArgs({onStage:stage=>stages.push(stage)}),result={text:'通过审核的合成文章',usage:{input:12,output:8}};
 const config={moderationEnabled:true,moderation:{ready:true,async checkText(text,options){checks.push({text,...options});return {allowed:true};}}};
 let received;
 const run=createModeratedAgentRunner(async value=>{received=value;stages.push('runner');return result;},config);
 assert.equal(await run(args),result);assert.equal(received,args);
 assert.deepEqual(stages,['checking_input','runner','checking_output']);
 assert.deepEqual(checks.map(value=>value.kind),['input','output']);
 assert.deepEqual(JSON.parse(checks[0].text),{context:args.task.context,materials:args.task.materials});
 assert.equal(checks[1].text,result.text);assert.ok(checks.every(value=>value.signal===args.signal));
 assert.doesNotMatch(checks[0].text,new RegExp(secret+'|'+model+'|private-provider'));
});

test('disabled moderation preserves existing runner behavior without contacting the service',async()=>{
 let calls=0;const result={text:'兼容旧任务'},args=taskArgs();
 const run=createModeratedAgentRunner(async input=>{assert.equal(input,args);return result;},{moderationEnabled:false,moderation:{ready:true,checkText(){calls++;throw new Error('must not run');}}});
 assert.equal(await run(args),result);assert.equal(calls,0);
 await moderateTextOrFail({},'未启用审核的兼容输入');
});

test('input rejection prevents any model execution and never exposes provider labels',async()=>{
 let runs=0,checks=0;
 const run=createModeratedAgentRunner(async()=>{runs++;return {text:'不得生成'};},{moderationEnabled:true,moderation:{ready:true,async checkText(){checks++;return {allowed:false,label:'raw-provider-label',raw:secret};}}});
 await assert.rejects(run(taskArgs()),error=>{safeError(error,400);assert.equal(error.code,'content_rejected');assert.match(error.message,/任务未执行生成/);return true;});
 assert.equal(runs,0);assert.equal(checks,1);
});

test('output rejection withholds the generated result after one model execution',async()=>{
 let runs=0;const kinds=[],usage={input:17,output:11};
 const run=createModeratedAgentRunner(async()=>{runs++;return {text:'不应发布的生成正文',usage};},{moderationEnabled:true,moderation:{ready:true,async checkText(_text,{kind}){kinds.push(kind);return {allowed:kind==='input'};}}});
 await assert.rejects(run(taskArgs()),error=>{safeError(error,400);assert.equal(error.usage,usage);assert.match(error.message,/结果未保存.*预占权益将释放/);assert.doesNotMatch(error.message,/不应发布的生成正文/);return true;});
 assert.equal(runs,1);assert.deepEqual(kinds,['input','output']);
});

test('missing, failed and unknown moderation responses fail closed with safe errors',async()=>{
 for(const moderation of [undefined,{ready:false,checkText:async()=>({allowed:true})},{ready:true},{ready:true,checkText:async()=>undefined},{ready:true,checkText:async()=>({allowed:'true'})},{ready:true,checkText:async()=>({})},{ready:true,checkText:async()=>{throw new Error('raw-provider-error '+secret+' '+model);}}]){
  let runs=0;
  const run=createModeratedAgentRunner(async()=>{runs++;return {text:'不得生成'};},{moderationEnabled:true,moderation});
  await assert.rejects(run(taskArgs()),error=>safeError(error,503));assert.equal(runs,0);
 }
});

test('output service exceptions fail closed without returning raw model text or credentials',async()=>{
 let runs=0;const usage={input:21,output:13};
 const run=createModeratedAgentRunner(async()=>{runs++;return {text:'未经审核不得发布的正文',usage};},{moderationEnabled:true,moderation:{ready:true,async checkText(_text,{kind}){if(kind==='output')throw new Error('raw-provider-error '+secret+' '+model);return {allowed:true};}}});
 await assert.rejects(run(taskArgs()),error=>{safeError(error,503);assert.equal(error.usage,usage);assert.doesNotMatch(error.message,/未经审核不得发布的正文/);return true;});assert.equal(runs,1);
});

test('empty or malformed Agent results cannot be published when moderation is enabled',async()=>{
 for(const result of [undefined,null,{}, {text:''},{text:'  '},{text:123}]){
  const checks=[];
  const run=createModeratedAgentRunner(async()=>result,{moderationEnabled:true,moderation:{ready:true,async checkText(_text,{kind}){checks.push(kind);return {allowed:true};}}});
  await assert.rejects(run(taskArgs()),error=>safeError(error,503));assert.deepEqual(checks,['input']);
 }
});

test('trusted moderation cancellation and deadline errors preserve safe status',async()=>{
 for(const status of [499,504]){
  const expected=Object.assign(new Error(status===499?'内容审核已取消':'内容审核超时，请稍后重试'),{status,moderationSafe:true});
  let runs=0;
  const run=createModeratedAgentRunner(async()=>{runs++;return {text:'不得生成'};},{moderationEnabled:true,moderation:{ready:true,async checkText(){throw expected;}}});
  await assert.rejects(run(taskArgs()),error=>error===expected&&safeError(error,status));assert.equal(runs,0);
 }
});

// Exercise real durable worker transitions and billing rather than a duplicate of
// the gate implementation. The only model endpoint is an in-process HTTP stub.
async function workerFixture(t,{type='polish',moderation,enabled=true}={}){
 let modelCalls=0,agentCalls=0;
 const modelServer=http.createServer(async(req,res)=>{
  for await(const _part of req){}modelCalls++;
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'合成模型返回的最终正文'}}],usage:{prompt_tokens:10,completion_tokens:8}}));
 });
 await new Promise(resolve=>modelServer.listen(0,'127.0.0.1',resolve));
 const db=database(':memory:'),at=new Date().toISOString(),user={id:'moderation-test-user'};
 let worker;
 t.after(async()=>{await worker?.stop();modelServer.closeAllConnections();await new Promise(resolve=>modelServer.close(resolve));db.close();});
 const config={aiURL:`http://127.0.0.1:${modelServer.address().port}/chat`,aiKey:secret,aiModel:model,agentEnabled:true,moderationEnabled:enabled,moderation,agentRunner:async()=>{agentCalls++;return {body:{original:'合成用户原文',suggestion:'合成模型返回的最终正文',model},usage:{input:10,output:8}};}};
 const billing=createBillingService(db,config);
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user.id,'审核集成测试账户','user',at);
 transaction(()=>billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))}));
 const order=randomUUID(),product='credits-200';
 db.prepare('INSERT INTO payment_config_versions(id,provider,sealed_settings,identity_hash,created_by,created_at) VALUES(?,?,?,?,?,?)').run('moderation-config','wechat','{}','synthetic',user.id,at);
 db.prepare('INSERT INTO orders(id,user_id,product_id,status,created_at) VALUES(?,?,?,?,?)').run(order,user.id,product,'paid',at);
 db.prepare('INSERT INTO payment_orders(order_id,provider,out_trade_no,config_id,amount_cents,title,entitlement,idempotency_key,input_hash,user_id,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(order,'wechat','test-'+order,'moderation-config',2000,'合成积分订单',JSON.stringify({type:'credits',creditAmount:200}),order,order,user.id,new Date(Date.now()+3600000).toISOString(),at);
 db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,user.id,product,200,'purchase',at);
 const id=randomUUID(),input={text:'合成用户原文',requirements:'合成修改要求',fileIds:[]};
 const quote=billing.quote(user,{type});
 transaction(()=>{
  db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,user.id,type,'queued','queued',JSON.stringify(input),id,id,at,at);
  billing.reserve(user,id,1,type,quote.token);
 });
 assert.deepEqual([billing.balance(user.id).balance,billing.balance(user.id).held,billing.balance(user.id).available],[200,10,190]);
 worker=startWorker(db,config);
 return {db,billing,user,id,input,worker,get modelCalls(){return modelCalls;},get agentCalls(){return agentCalls;}};
}
function assertReleased(f){
 const job=f.db.prepare('SELECT * FROM jobs WHERE id=?').get(f.id);
 assert.equal(job.status,'failed');assert.equal(job.result_id,null);
 assert.doesNotMatch(job.error,new RegExp(secret+'|'+model+'|raw-provider-error|raw-provider-label'));
 assert.deepEqual([f.billing.balance(f.user.id).balance,f.billing.balance(f.user.id).held,f.billing.balance(f.user.id).available],[200,0,200]);
 assert.equal(f.db.prepare('SELECT status FROM billing_reservations WHERE job_id=?').get(f.id).status,'released');
 assert.equal(f.db.prepare('SELECT count(*) n FROM results WHERE job_id=?').get(f.id).n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM usage WHERE job_id=?').get(f.id).n,0);
 assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='release'").get().n,1);
 assert.equal(f.db.prepare("SELECT count(*) n FROM billing_events WHERE kind='settle'").get().n,0);
}

for(const type of ['polish','agent']){
 for(const failure of ['input-rejected','output-rejected','input-unavailable','output-unavailable']){
  test(`legacy ${type}: ${failure} withholds results and releases the paid reservation exactly once`,async t=>{
   const checks=[],target=failure.startsWith('input')?'input':'output';
   const f=await workerFixture(t,{type,moderation:{ready:true,async checkText(text,{kind,signal}){checks.push({text,kind,signal});if(kind!==target)return {allowed:true};if(failure.endsWith('unavailable'))throw new Error('raw-provider-error '+secret+' '+model);return {allowed:false,label:'raw-provider-label'};}}});
   await f.worker.tick();assertReleased(f);
   assert.deepEqual(checks.map(check=>check.kind),target==='input'?['input']:['input','output']);
   assert.ok(checks.every(check=>check.signal instanceof AbortSignal));
   assert.doesNotMatch(checks[0].text,new RegExp(secret+'|'+model));
   assert.equal(f.modelCalls+f.agentCalls,target==='input'?0:1);
   // A later idle tick cannot settle or duplicate the release of a failed job.
   await f.worker.tick();assertReleased(f);
  });
 }
 test(`legacy ${type}: disabled moderation retains successful settlement compatibility`,async t=>{
  let checks=0;
  const f=await workerFixture(t,{type,enabled:false,moderation:{ready:true,async checkText(){checks++;throw new Error('must not call disabled moderation');}}});
  await f.worker.tick();assert.equal(checks,0);assert.equal(f.modelCalls+f.agentCalls,1);
  const job=f.db.prepare('SELECT * FROM jobs WHERE id=?').get(f.id);assert.equal(job.status,'completed');assert.ok(job.result_id);
  assert.deepEqual([f.billing.balance(f.user.id).balance,f.billing.balance(f.user.id).held,f.billing.balance(f.user.id).available],[190,0,190]);
  assert.equal(f.db.prepare('SELECT status FROM billing_reservations WHERE job_id=?').get(f.id).status,'settled');
 });
}
