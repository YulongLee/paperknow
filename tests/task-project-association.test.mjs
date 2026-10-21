import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession} from '../backend/auth.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {startWritingWorker} from '../backend/writing-worker.mjs';
import {startToolRunWorker} from '../backend/tool-run-worker.mjs';
import {startThesisOutlineWorker} from '../backend/thesis-outline-worker.mjs';
import {startThesisMethodWorker} from '../backend/thesis-method-worker.mjs';
import {normalizeWritingSnapshot} from '../backend/writing-model.mjs';
import {normalizeToolRequest} from '../backend/tool-run-model.mjs';
import {thesisHash} from '../backend/thesis-model.mjs';

const runtime={enabled:true,engine:'claude-agent-sdk',baseURL:'https://project-test.example.test',model:'private-project-test',apiKey:'private-test-key',version:'project-test-v1',maxTurns:6,maxOutputTokens:4096,maxCostUsd:.1,timeoutMs:30000};
const writingInput=()=>({kind:'proposal',operation:'draft',snapshot:{title:'数字阅读服务的拟改进路径',profile:{level:'本科',language:'中文',targetWords:200},materials:[],references:[],outline:[{id:'intro',title:'拟开展研究计划',targetWords:200,sections:[]}]}});
const toolInput=()=>({kind:'revision',operation:'rewrite',snapshot:{title:'研究材料表达优化',text:'这是合成验收材料，记录20名参与者的研究计划[1]。',language:'中文'}});
const planningSnapshot=()=>({title:'高校图书馆数字阅读服务优化研究',profile:{level:'本科',targetWords:8000},materials:[],references:[],outline:[]});
const wrapped=body=>({text:JSON.stringify(body),trace:[],usage:{input:100,output:200},costUsd:.001,finishReason:'end_turn'});
function runner({task}){
 if(task.skill==='writing-task')return wrapped({complete:true,text:'拟'.repeat(task.context.unit.targetWords),source_ids:[],missing_evidence:[]});
 if(task.skill==='thesis-outline')return wrapped({complete:true,chapters:[{title:'数字阅读服务研究问题',sections:[{title:'研究背景'},{title:'需求边界'}]},{title:'数字阅读服务研究设计',sections:[{title:'拟开展的服务案例分析'},{title:'拟采用的访谈设计'}]},{title:'数字阅读服务优化框架',sections:[{title:'服务路径与评估方案'}]}]});
 if(task.skill==='thesis-method')return wrapped({complete:true,proposed:true,methods:[{name:'拟采用案例比较法',rationale:'比较现有数字阅读服务的公开资料，界定可改进的服务环节。',steps:['拟确认服务资料的可访问范围','拟按统一维度比较服务入口'],prerequisites:['需确认资料使用范围'],limitations:['公开资料不能代表实际服务成效']}],missingInformation:[],source_ids:[]});
 return wrapped({complete:true,sourceIds:[],paragraphs:task.context.unit.paragraphs.map(row=>({id:row.id,original:row.original,revised:row.original.replace('这是','这份')}))});
}
async function fixture(t){
 const db=database(':memory:'),users={};
 for(const id of ['alice','bob']){db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.test',id,null,'user',new Date().toISOString());users[id]={id,cookie:'pk_session='+createSession(db,id)};}
 const config={getAI:()=>({aiEnabled:false}),getAgentSettings:()=>({...runtime}),agentTaskRunner:runner,writingPollMs:60000,toolPollMs:60000,thesisOutlinePollMs:60000,thesisMethodPollMs:60000};
 const billing=createBillingService(db,config);config.billing=billing;
 const workers={writing:startWritingWorker(db,config),tool:startToolRunWorker(db,config),outline:startThesisOutlineWorker(db,config),method:startThesisMethodWorker(db,config)};
 const api=createAPI(db,{cancel(id){for(const worker of Object.values(workers))worker.cancel(id);}},config),server=http.createServer((req,res)=>void api(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await Promise.all(Object.values(workers).map(worker=>worker.stop()));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 async function request(path,data,user=users.alice,headers={}){const response=await fetch(base+'/api'+path,{method:data===undefined?'GET':'POST',headers:{...(user?{Cookie:user.cookie}:{}),...(data===undefined?{}:{Origin:base,'Content-Type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,value:await response.json()};}
 async function project(title,user=users.alice){const response=await request('/projects',{title,degree:'本科',major:'教育学'},user);assert.equal(response.status,201);return response.value.item.id;}
 function pay(){billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});const order=randomUUID(),at=new Date().toISOString();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,'alice','credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,'alice','credits-200',200,'purchase',at);}
 return{db,users,workers,billing,request,project,pay};
}
const services=[['writing','/writing',writingInput],['tool','/tool-runs',toolInput]];

for(const [name,path,input] of services){
 test(name+' binds quotes, idempotent jobs and delivered results to the chosen account project',async t=>{
  const f=await fixture(t),projectId=await f.project('当前研究'),other=await f.project('其他研究');f.pay();
  const value={...input(),projectId},quote=await f.request(path+'/quote',value);assert.equal(quote.status,200);assert.equal(quote.value.projectId,projectId);
  const independent=await f.request(path+'/quote',input());assert.notEqual(quote.value.inputHash,independent.value.inputHash);
  const moved=await f.request(path+'/quote',{...value,projectId:other});assert.notEqual(quote.value.inputHash,moved.value.inputHash);
  const clientKey=randomUUID(),command={...value,clientKey,billingToken:quote.value.token,consent:true};
  assert.equal((await f.request(path+'/jobs',{...command,projectId:other})).status,409,'changing the project after quoting cannot reserve a task');
  assert.equal(f.billing.balance('alice').held,0);assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
  const created=await f.request(path+'/jobs',command);assert.equal(created.status,202,JSON.stringify(created));assert.equal(created.value.item.projectId,projectId);
  const id=created.value.item.id;assert.equal(f.db.prepare('SELECT project_id FROM jobs WHERE id=?').get(id).project_id,projectId);
  const replay=await f.request(path+'/jobs',{...command,billingToken:'expired'});assert.equal(replay.status,200);assert.equal(replay.value.item.id,id);
  assert.equal((await f.request(path+'/jobs',{...command,projectId:other,billingToken:moved.value.token})).status,409,'the same key cannot move a job to another project');
  assert.equal((await f.request(path+'/jobs/by-key/'+clientKey)).value.item.projectId,projectId);
  assert.equal((await f.request(path+'/jobs/'+id,undefined,f.users.bob)).status,404);
  await f.workers[name].tick();const finished=(await f.request(path+'/jobs/'+id)).value.item;
  assert.equal(finished.status,'completed',JSON.stringify(finished));assert.equal(finished.projectId,projectId);
  const result=(await f.request('/results/'+finished.resultId)).value.item;assert.equal(result.project_id,projectId);
  const detail=(await f.request('/projects/'+projectId)).value;assert.equal(detail.jobs[0].id,id);assert.equal(detail.results[0].id,finished.resultId);
  assert.equal((await f.request('/projects/'+other)).value.jobs.length,0);assert.equal(f.billing.balance('alice').balance,190);assert.equal(f.billing.balance('alice').held,0);
 });

 test(name+' rejects foreign, local-only, malformed and stale-owner project associations before charging',async t=>{
  const f=await fixture(t),foreign=await f.project('乙账户私人项目',f.users.bob),own=await f.project('甲账户项目');f.pay();
  for(const [projectId,status] of [[foreign,404],['browser-local-project',404],[{},400],[1,400]]){
   const value={...input(),projectId};assert.equal((await f.request(path+'/quote',value)).status,status);
   assert.equal((await f.request(path+'/jobs',{...value,clientKey:randomUUID(),consent:true,billingToken:'invalid'})).status,status);
  }
  const response=await f.request(path+'/quote',{...input(),projectId:own},f.users.bob,{'X-PaperKnow-User':'alice'});assert.equal(response.status,409);assert.equal(response.value.code,'ACCOUNT_CHANGED');
  assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);assert.equal(f.billing.balance('alice').held,0);
 });

 test(name+' retains legacy independent hashes and only resumes within the original project',async t=>{
  const f=await fixture(t),projectId=await f.project('可继续的研究'),other=await f.project('不能复制到的研究');f.pay();
  const raw=input(),expected=name==='writing'?thesisHash({kind:raw.kind,operation:raw.operation,snapshot:normalizeWritingSnapshot(raw.snapshot)}):normalizeToolRequest(raw).inputHash;
  for(const project of [undefined,null,'']){const value=project===undefined?raw:{...raw,projectId:project},quote=await f.request(path+'/quote',value);assert.equal(quote.value.inputHash,expected);assert.equal(quote.value.projectId,null);}
  const value={...raw,projectId},quote=await f.request(path+'/quote',value),first=await f.request(path+'/jobs',{...value,clientKey:randomUUID(),consent:true,billingToken:quote.value.token});assert.equal(first.status,202);
  await f.request(path+'/jobs/'+first.value.item.id+'/cancel',{});
  for(const project of [other,null]){const next={...raw,projectId:project},q=await f.request(path+'/quote',next),response=await f.request(path+'/jobs',{...next,clientKey:randomUUID(),consent:true,billingToken:q.value.token,resumeFromJobId:first.value.item.id});assert.equal(response.status,409);}
  const fresh=await f.request(path+'/quote',value),resumed=await f.request(path+'/jobs',{...value,clientKey:randomUUID(),consent:true,billingToken:fresh.value.token,resumeFromJobId:first.value.item.id});assert.equal(resumed.status,202);assert.equal(resumed.value.item.projectId,projectId);
  await f.workers[name].tick();const complete=(await f.request(path+'/jobs/'+resumed.value.item.id)).value.item;assert.equal(complete.status,'completed',JSON.stringify(complete));assert.equal((await f.request('/results/'+complete.resultId)).value.item.project_id,projectId);
 });

 test(name+' revalidates a project deleted after quoting without creating or reserving a job',async t=>{
  const f=await fixture(t),projectId=await f.project('报价后删除的空项目');f.pay();const value={...input(),projectId},quote=await f.request(path+'/quote',value);
  assert.equal((await f.request('/projects/'+projectId+'/delete',{version:0})).status,200);
  const response=await f.request(path+'/jobs',{...value,clientKey:randomUUID(),billingToken:quote.value.token,consent:true});assert.equal(response.status,404);
  assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);assert.equal(f.billing.balance('alice').held,0);
 });
}

for(const [name,path] of [['outline','/theses/outlines'],['method','/theses/methods']])test(name+' planning inherits its account project through idempotency, task reads and the delivered result',async t=>{
 const f=await fixture(t),projectId=await f.project('毕业论文项目'),other=await f.project('另一项研究'),foreign=await f.project('其他账户项目',f.users.bob);f.pay();
 const snapshot=planningSnapshot(),quote=await f.request('/billing/quote',{type:'agent'}),command={snapshot,projectId,clientKey:randomUUID(),consent:true,billingToken:quote.value.token};
 assert.equal((await f.request(path,{...command,projectId:foreign})).status,404);assert.equal((await f.request(path,{...command,projectId:{}})).status,400);
 const created=await f.request(path,command);assert.equal(created.status,202,JSON.stringify(created));assert.equal(created.value.item.projectId,projectId);
 const id=created.value.item.id;assert.equal((await f.request(path,{...command,billingToken:'expired'})).status,200);assert.equal((await f.request(path,{...command,projectId:other})).status,409);
 assert.equal((await f.request(path+'/by-key/'+command.clientKey)).value.item.projectId,projectId);assert.equal((await f.request(path+'/'+id,undefined,f.users.bob)).status,404);
 await f.workers[name].tick();const completed=(await f.request(path+'/'+id)).value.item;assert.equal(completed.status,'completed',JSON.stringify(completed));assert.equal(completed.projectId,projectId);
 assert.equal((await f.request('/results/'+completed.resultId)).value.item.project_id,projectId);
 assert.equal((await f.request('/projects/'+projectId)).value.results[0].id,completed.resultId);assert.equal(f.billing.balance('alice').balance,190);
});
