import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession} from '../backend/auth.mjs';
import {createModelBudget} from '../backend/model-budget.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';

const runtime={enabled:true,engine:'claude-agent-sdk',baseURL:'https://admission.example.test',model:'fixture-model',apiKey:'fixture-only-secret',version:'admission-v1',maxTurns:6,maxOutputTokens:4096,maxCostUsd:.1,timeoutMs:30000};
const writingSnapshot=()=>({title:'【合成验收】数字阅读服务研究计划',profile:{level:'本科',targetWords:200},materials:[],references:[],outline:[{id:'plan',title:'拟开展研究计划',targetWords:200,sections:[]}]});
const services=[
 {name:'writing',quotePath:'/writing/quote',submitPath:'/writing/jobs',runTable:'writing_runs',input:()=>({kind:'proposal',operation:'draft',snapshot:writingSnapshot()}),quoteData:input=>input},
 {name:'tool run',quotePath:'/tool-runs/quote',submitPath:'/tool-runs/jobs',runTable:'tool_runs',input:()=>({kind:'revision',operation:'rewrite',snapshot:{title:'【合成验收】表达调整',text:'这是一份测试使用的合成研究资料，记录了20名参与者，并保留原有引用[1]。'}}),quoteData:input=>input},
 ...['method','outline'].map(kind=>({name:kind,quotePath:'/billing/quote',submitPath:'/theses/'+(kind==='method'?'methods':'outlines'),runTable:'thesis_'+kind+'_runs',input:()=>({snapshot:{...writingSnapshot(),profile:{level:'本科',targetWords:8000},outline:[]}}),quoteData:()=>({type:'agent'})}))
];

// These are admission-only integration tests: no worker or external model starts.
async function fixture(t,extra={}){
 const db=database(':memory:'),users={};
 for(const id of ['alice','bob']){db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.test',id,null,'user',new Date().toISOString());users[id]={id,cookie:'pk_session='+createSession(db,id)};}
 const config={getAI:()=>({aiURL:'https://admission.example.test',aiKey:'fixture-only',aiModel:'fixture-model'}),getAgentSettings:()=>({...runtime}),agentEnabled:true,aiUserDailyLimit:1,aiGlobalDailyLimit:1,...extra};
 const billing=createBillingService(db,config),budget=createModelBudget(db,config);config.billing=billing;config.modelBudget=budget;
 const api=createAPI(db,{cancel(){}},config),server=http.createServer((req,res)=>void api(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 async function request(path,data,user=users.alice){const res=await fetch(base+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Cookie:user.cookie,...(data===undefined?{}:{Origin:base,'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});return{status:res.status,value:await res.json()};}
 function rules(mode){billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode,creditCost:mode==='paid'?10:null}))});}
 function credit(amount=200,user=users.alice){const id=randomUUID(),at=new Date().toISOString();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,user.id,'credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(id,user.id,'credits-200',amount,'purchase',at);}
 function job(type='parse',owner='alice',status='queued'){const id=randomUUID(),at=new Date().toISOString();db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,owner,type,status,status,'{}',id,id,at,at);return id;}
 function exhaustFree(){const id=job('agent','alice','running');db.prepare('UPDATE jobs SET attempt=1 WHERE id=?').run(id);budget.start(id,1);db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(id);assert.equal(budget.summary('alice').remaining,0);}
 const quote=(service,input=service.input(),user=users.alice)=>request(service.quotePath,service.quoteData(input),user);
 const command=(service,token,extra={})=>({...service.input(),clientKey:randomUUID(),consent:true,billingToken:token,...extra});
 return{db,config,billing,budget,users,request,rules,credit,job,exhaustFree,quote,command,count:table=>db.prepare('SELECT count(*) n FROM '+table).get().n};
}

for(const service of services){
 test(service.name+': exhausted trial allowances block free tasks but paid quotes and submissions still work',async t=>{
  const f=await fixture(t);f.exhaustFree();
  const freeQuote=await f.quote(service);
  if(service.quotePath==='/billing/quote')assert.equal((await f.request(service.submitPath,f.command(service,freeQuote.value.token))).status,429);
  else{assert.equal(freeQuote.status,429);assert.equal(f.count('billing_quotes'),0);}
  f.rules('paid');f.credit();const quote=await f.quote(service);assert.equal(quote.status,200,JSON.stringify(quote.value));assert.equal(quote.value.source,'credits');
  const command=f.command(service,quote.value.token),created=await f.request(service.submitPath,command);assert.equal(created.status,202,JSON.stringify(created.value));
  assert.equal(f.billing.balance('alice').held,10);assert.equal(f.budget.summary('alice').used,1);assert.equal(f.count(service.runTable),1);
  const repeated=await f.request(service.submitPath,{...command,billingToken:'expired-or-used'});assert.equal(repeated.status,200);assert.equal(repeated.value.item.id,created.value.item.id);assert.equal(f.count('billing_reservations'),1);
  assert.equal((await f.request(service.submitPath,{...f.command(service,quote.value.token),paid:true})).status,400);
 });

 test(service.name+': paid admission retains concurrency limits and rolls back rejected quotes',async t=>{
  const f=await fixture(t);f.exhaustFree();f.rules('paid');f.credit();const quote=await f.quote(service);assert.equal(quote.status,200);
  for(let i=0;i<3;i++)f.job();const quotesBefore=f.count('billing_quotes');
  assert.equal((await f.request(service.submitPath,f.command(service,quote.value.token))).status,429);
  assert.equal(f.count(service.runTable),0);assert.equal(f.billing.balance('alice').held,0);assert.equal(f.db.prepare('SELECT used FROM billing_quotes WHERE token=?').get(quote.value.token).used,0);
  if(service.quotePath!=='/billing/quote'){assert.equal((await f.quote(service)).status,429);assert.equal(f.count('billing_quotes'),quotesBefore);}
 });

 test(service.name+': paid daily exemption never substitutes for current available credits',async t=>{
  const f=await fixture(t);f.exhaustFree();f.rules('paid');f.credit(20);const quote=await f.quote(service);assert.equal(quote.status,200);
  for(let i=0;i<2;i++){const token=f.billing.quote(f.users.alice,{type:'agent'}).token,id=f.job('agent');f.billing.reserve(f.users.alice,id,1,'agent',token);}
  const jobsBefore=f.count('jobs');assert.equal(f.billing.balance('alice').available,0);
  const denied=await f.request(service.submitPath,f.command(service,quote.value.token));assert.equal(denied.status,402,JSON.stringify(denied.value));
  assert.equal(f.count('jobs'),jobsBefore);assert.equal(f.count(service.runTable),0);assert.equal(f.count('billing_reservations'),2);assert.equal(f.db.prepare('SELECT used FROM billing_quotes WHERE token=?').get(quote.value.token).used,0);
 });
}

for(const service of services.filter(row=>['method','outline'].includes(row.name))){
 test(service.name+': service-specific daily trial cap excludes paid history after returning to free mode',async t=>{
  const f=await fixture(t,{aiUserDailyLimit:10,aiGlobalDailyLimit:20,thesisMethodUserDailyLimit:1,thesisOutlineUserDailyLimit:1});f.rules('paid');f.credit();
  const paid=await f.quote(service),created=await f.request(service.submitPath,f.command(service,paid.value.token));assert.equal(created.status,202);
  assert.equal((await f.request('/jobs/'+created.value.item.id+'/cancel',{})).status,200);f.rules('free');
  const free=await f.quote(service),first=await f.request(service.submitPath,f.command(service,free.value.token));assert.equal(first.status,202,JSON.stringify(first.value));
  await f.request('/jobs/'+first.value.item.id+'/cancel',{});const again=await f.quote(service),denied=await f.request(service.submitPath,f.command(service,again.value.token));assert.equal(denied.status,429);assert.match(denied.value.error,/今日.*提交次数/);
  f.rules('paid');const paidAgain=await f.quote(service);assert.equal((await f.request(service.submitPath,f.command(service,paidAgain.value.token))).status,202);
 });
}

for(const type of ['polish','review','agent'])test('legacy '+type+': paid create and retry bypass exhausted trial allowance with valid fresh charges only',async t=>{
 const f=await fixture(t);f.exhaustFree();f.rules('paid');f.credit();
 const quote=await f.request('/billing/quote',{type}),command={type,text:'合成测试材料中的研究计划描述。',idempotencyKey:randomUUID(),billingQuote:quote.value.token};
 const created=await f.request('/jobs',command);assert.equal(created.status,201,JSON.stringify(created.value));assert.equal((await f.request('/jobs',command)).value.id,created.value.id);assert.equal(f.count('billing_reservations'),1);
 const id=created.value.id;f.db.prepare("UPDATE jobs SET status='running',attempt=1 WHERE id=?").run(id);f.budget.start(id,1);f.db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(id);f.billing.release(id);
 assert.equal((await f.request('/jobs/'+id+'/retry',{billingQuote:quote.value.token})).status,429);
 const fresh=await f.request('/billing/quote',{type});assert.equal((await f.request('/jobs/'+id+'/retry',{billingQuote:fresh.value.token})).status,200);
 assert.deepEqual(f.db.prepare('SELECT attempt,status FROM billing_reservations WHERE job_id=? ORDER BY attempt').all(id).map(row=>({...row})),[{attempt:1,status:'released'},{attempt:2,status:'held'}]);assert.equal(f.billing.balance('alice').held,10);
});
