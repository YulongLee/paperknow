import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession} from '../backend/auth.mjs';
import {configuredAIIdentityValues,publicAIError,publicAIResponse} from '../backend/public-ai-metadata.mjs';

const runtime={enabled:true,engine:'claude-agent-sdk',baseURL:'https://private-runtime.example.test',model:'private-research-v4',apiKey:'synthetic-secret',version:'private-settings-version',maxTurns:3,maxOutputTokens:4096,maxCostUsd:.1,timeoutMs:30000};
const userText='论文比较 GPT-4、Claude 与统计模型；provider 和 model 是用户数据字段。';
async function fixture(t){
 const db=database(':memory:'),users={};
 for(const role of ['user','admin']){db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(role,role+'@example.test',role,null,role,new Date().toISOString());users[role]={id:role,cookie:'pk_session='+createSession(db,role)};}
 const config={getAI:()=>({aiEnabled:true,aiURL:'https://private-provider.example.test/v1/chat/completions',aiKey:'synthetic-only-key',aiModel:'private-research-v4'}),getAgentSettings:()=>({...runtime}),agentEnabled:true};
 const api=createAPI(db,{cancel(){}},config),server=http.createServer((req,res)=>void api(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 async function request(path,data,user=users.user){const response=await fetch(base+'/api'+path,{method:data===undefined?'GET':'POST',headers:{...(user?{Cookie:user.cookie}:{}),...(data===undefined?{}:{Origin:base,'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,value:await response.json()};}
 function job(id='generated',user='user',extra={}){const at=new Date().toISOString();db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,error,result_id,attempt,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,user,'agent','completed','completed','{}',null,null,1,id,'hash',at,at);if(extra.error)db.prepare("UPDATE jobs SET status='failed',error=? WHERE id=?").run(extra.error,id);return id;}
 function result(id='result',owner='user'){const at=new Date().toISOString();job('job-'+id,owner);const body={original:userText,suggestion:userText,model:runtime.model,engine:runtime.engine,settingsVersion:runtime.version,provider:'private-provider.example.test',references:[{title:userText,provider:'crossref'}],trace:[{type:'tool',server:'private-sdk-server',tool:'read_material',status:'completed',materialId:'source-1',model:runtime.model}]};db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run(id,owner,null,'job-'+id,'agent',userText,JSON.stringify(body),at);return body;}
 return{db,users,request,job,result};
}
test('public projections hide routing fields without modifying text, source providers or the internal object',()=>{
 const input={item:{id:'r',type:'agent',body:{model:'private-model',engine:'private-engine',settingsVersion:'v',original:userText,suggestion:userText,sources:[{provider:'user_provided',text:userText}],trace:[{tool:'read_material',status:'completed',server:'internal',model:'private-model',materialId:'s'}]}}};
 const before=structuredClone(input),projected=publicAIResponse('/api/results/r',input);
 assert.equal(projected.item.body.model,undefined);assert.equal(projected.item.body.engine,undefined);assert.equal(projected.item.body.settingsVersion,undefined);
 assert.equal(projected.item.body.original,userText);assert.equal(projected.item.body.suggestion,userText);assert.equal(projected.item.body.sources[0].provider,'user_provided');
 assert.deepEqual(projected.item.body.trace,[{tool:'read_material',status:'completed',materialId:'s'}]);assert.deepEqual(input,before);
});
test('model configuration is retained only behind an authorized admin route, never a role flag alone',()=>{
 const input={aiProvider:'hidden',agentEngine:'hidden',item:{model:'private-model',settingsVersion:'v'}};
 assert.equal(publicAIResponse('/api/admin/settings',input,{authorizedAdmin:true}),input);
 assert.equal(publicAIResponse('/api/capabilities',input,{authorizedAdmin:true}).aiProvider,undefined);
 assert.notEqual(publicAIResponse('/api/admin/settings',input),input);
});
test('legacy result envelopes omit deployment addresses while preserving research source URLs',()=>{
 const body={baseURL:'https://private.example.test',baseUrl:'https://private.example.test',endpoint:'https://private.example.test/chat',apiURL:'https://private.example.test',aiURL:'https://private.example.test',text:userText,data:{baseURL:'https://research.example.test',model:'research model'}};
 const result=publicAIResponse('/api/results/r',{item:{body}}).item.body;
 for(const key of ['baseURL','baseUrl','endpoint','apiURL','aiURL'])assert.equal(result[key],undefined);
 assert.deepEqual(result.data,body.data);assert.equal(result.text,userText);assert.equal(body.baseURL,'https://private.example.test');
});
test('customer errors remove runtime brands and configuration diagnostics while keeping actionable business errors',()=>{
 for(const error of ['Claude Agent SDK failure','Model.AccessDenied for private-research-v4','请先在后台保存并测试 Agent 配置','OpenAI API key not found','Anthropic sdk network error','模型接口配置有误'])assert.doesNotMatch(publicAIError(error),/Claude|Agent|SDK|Model.AccessDenied|private-research|OpenAI|Anthropic|模型/);
 assert.equal(publicAIError('积分不足，请先充值'),'积分不足，请先充值');assert.equal(publicAIError('用户取消了任务，已保留完成章节'),'用户取消了任务，已保留完成章节');
});
test('locally configured custom identities are hidden only inside service diagnostics, without a model or network call',async()=>{
 let reads=0;const identities=await configuredAIIdentityValues({getAI:()=>({aiModel:'custom-production-variant',aiURL:'https://bespoke-route.example.test/chat'}),getAgentSettings:async()=>{reads++;return{model:'custom-agent-variant',baseURL:'https://bespoke-agent.example.test',engine:'custom-executor'};},agentTaskRunner(){throw Error('must not dispatch');}});
 assert.equal(reads,1);for(const identity of ['custom-production-variant','bespoke-route.example.test','custom-agent-variant','bespoke-agent.example.test','custom-executor'])assert.ok(identities.includes(identity));
 const publicValue=publicAIResponse('/api/jobs',{items:[{status:'failed',error:'custom-agent-variant not available at bespoke-agent.example.test'}]},{identityValues:identities});assert.doesNotMatch(publicValue.items[0].error,/custom-agent|bespoke-agent/);
 assert.equal(publicAIResponse('/api/results/r',{item:{body:{suggestion:'研究对象 custom-agent-variant'}}},{identityValues:identities}).item.body.suggestion,'研究对象 custom-agent-variant');
});
test('disabled capability explanations never copy arbitrary internal configuration diagnostics',()=>{
 const capability={ready:false,reason:'unrecognized-private-variant disabled on opaque-hostname',billingService:'agent'};
 assert.doesNotMatch(publicAIResponse('/api/theses/methods/capabilities',capability).reason,/private-variant|opaque-hostname/);
 assert.doesNotMatch(publicAIResponse('/api/capabilities',{thesis:capability,thesisOutline:capability,thesisMethod:capability}).thesisOutline.reason,/private-variant|opaque-hostname/);
});
test('public capability endpoint omits provider host and runtime even for an authenticated administrator',async t=>{
 const f=await fixture(t);
 for(const user of [null,f.users.user,f.users.admin]){const response=await f.request('/capabilities',undefined,user);assert.equal(response.status,200);assert.equal(response.value.ai,true);assert.equal(response.value.thesis.ready,true);assert.equal(response.value.aiProvider,undefined);assert.equal(response.value.agentEngine,undefined);assert.doesNotMatch(JSON.stringify(response.value),/private-research|private-provider|claude-agent-sdk/);}
 const settings=await f.request('/admin/settings',undefined,f.users.admin);assert.equal(settings.status,200);assert.equal(settings.value.ai.model,'private-research-v4');assert.equal(settings.value.ai.provider,'private-provider.example.test');
 assert.equal((await f.request('/admin/settings')).status,403);
});
test('customer usage omits model and provider but preserves token totals, charges and administrator audit access',async t=>{
 const f=await fixture(t);f.job();const at=new Date().toISOString();f.db.prepare('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)').run('usage','user','generated',runtime.engine,runtime.model,34,56,1,at);
 const usage=(await f.request('/usage')).value;assert.equal(usage.items[0].model,undefined);assert.equal(usage.items[0].provider,undefined);assert.equal(usage.items[0].input_tokens,34);assert.equal(usage.items[0].output_tokens,56);assert.equal(usage.items[0].billable,1);
 const admin=(await f.request('/admin/usage',undefined,f.users.admin)).value;assert.equal(admin.items[0].model,runtime.model);assert.equal(admin.items[0].provider,runtime.engine);assert.equal(f.db.prepare('SELECT model FROM usage').get().model,runtime.model);
});
test('result reads, reassignment and revisions preserve manuscript text but never return execution metadata',async t=>{
 const f=await fixture(t),internal=f.result();let result=(await f.request('/results/result')).value.item;
 assert.equal(result.body.model,undefined);assert.equal(result.body.engine,undefined);assert.equal(result.body.settingsVersion,undefined);assert.equal(result.body.original,userText);assert.equal(result.body.references[0].provider,'crossref');assert.equal(result.body.trace[0].server,undefined);
 result=(await f.request('/results/result',{title:'重新命名'})).value.item;assert.equal(result.body.model,undefined);assert.equal(result.body.suggestion,userText);
 assert.equal((await f.request('/results/result/revisions',{text:userText})).status,201);assert.equal((await f.request('/results/result/revisions')).value.items[0].body,userText);
 assert.deepEqual(JSON.parse(f.db.prepare('SELECT body FROM results WHERE id=?').get('result').body),internal);
});
test('project detail also sanitizes legacy job diagnostics without changing the stored error',async t=>{
 const f=await fixture(t),project=(await f.request('/projects',{title:'研究项目'})).value.item,error='The private-research-v4 route private-provider.example.test rejected this task';
 f.job('project-job','user',{error});f.db.prepare('UPDATE jobs SET project_id=? WHERE id=?').run(project.id,'project-job');
 const detail=(await f.request('/projects/'+project.id)).value;assert.equal(detail.jobs.length,1);assert.doesNotMatch(detail.jobs[0].error,/private-research|private-provider/);assert.equal(f.db.prepare('SELECT error FROM jobs WHERE id=?').get('project-job').error,error);
});
test('outline and method creation, recovery and failure reads hide saved runtime versions without changing their stored pins',async t=>{
 const f=await fixture(t);
 for(const kind of ['outlines','methods']){
  const key=randomUUID(),quote=(await f.request('/billing/quote',{type:'agent'})).value.token;
  const create=await f.request('/theses/'+kind,{snapshot:{title:'大学生阅读行为研究',profile:{level:'本科',targetWords:8000},materials:[],references:[],outline:[]},clientKey:key,consent:true,billingToken:quote});
  assert.equal(create.status,202,JSON.stringify(create.value));const id=create.value.item.id;assert.equal(create.value.item.model,undefined);assert.equal(create.value.item.settingsVersion,undefined);
  const table=kind==='outlines'?'thesis_outline_runs':'thesis_method_runs';assert.equal(f.db.prepare('SELECT settings_version FROM '+table+' WHERE id=?').get(id).settings_version,runtime.version);assert.equal(JSON.parse(f.db.prepare('SELECT settings_meta FROM '+table+' WHERE id=?').get(id).settings_meta).model,runtime.model);
  f.db.prepare('UPDATE '+table+" SET status='failed',error=? WHERE id=?").run('Claude Agent SDK failed: Model.AccessDenied',id);
  for(const suffix of [id,'by-key/'+key]){const item=(await f.request('/theses/'+kind+'/'+suffix)).value.item;assert.equal(item.model,undefined);assert.equal(item.settingsVersion,undefined);assert.doesNotMatch(item.error,/Claude|SDK|AccessDenied/);}
 }
});
test('thesis detail projects job and chapter diagnostics without altering research content',async t=>{
 const f=await fixture(t),snapshot={title:'GPT-4 与统计模型比较研究',profile:{level:'本科',targetWords:500},materials:[],references:[],outline:[{id:'chapter-1',title:'统计模型',targetWords:500}],bodySections:[{id:'chapter-1',text:userText}]};
 const created=await f.request('/theses',{snapshot,clientKey:randomUUID()});assert.equal(created.status,201,JSON.stringify(created.value));const item=created.value.item,stored=f.db.prepare('SELECT * FROM theses WHERE id=?').get(item.id),at=new Date().toISOString();f.job('thesis-run');
 f.db.prepare('INSERT INTO thesis_runs(id,thesis_id,user_id,snapshot,snapshot_hash,plan,settings_version,settings_meta,status,stage,error,created_at,updated_at,provider_calls) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('thesis-run',item.id,'user',stored.snapshot,stored.snapshot_hash,'[]',runtime.version,JSON.stringify({model:runtime.model,engine:runtime.engine}),'failed','failed','Model.AccessDenied on private-research-v4',at,at,3);
 f.db.prepare("UPDATE theses SET current_run_id='thesis-run',status='failed' WHERE id=?").run(item.id);
 const read=(await f.request('/theses/'+item.id)).value.item;assert.equal(read.job.settingsVersion,undefined);assert.equal(read.job.providerCalls,undefined);assert.doesNotMatch(read.job.error,/AccessDenied|private-research/);assert.equal(read.chapters[0].text,userText);assert.equal(read.profile.targetWords,500);assert.equal(read.outline[0].title,'统计模型');
});
test('account exports remove legacy metadata from result and draft envelopes but retain nested user data and manuscript',async t=>{
 const f=await fixture(t);f.result();f.job('failed','user',{error:'The private-research-v4 service on private-provider.example.test is not available'});
 const payload={text:userText,model:'user-defined-statistical-model',custom:{model:'user-entered',provider:'user-entered'},outlineAIResult:{jobId:'old-outline',model:runtime.model,engine:runtime.engine,generatedAt:'old'},methodSuggestion:{text:userText,model:runtime.model,jobId:'old-method'}};
 const draft=await f.request('/workspace/drafts',{title:'草稿',tool:'writing',payload});assert.equal(draft.status,201);assert.equal(draft.value.item.payload.outlineAIResult.model,undefined);assert.equal(draft.value.item.payload.methodSuggestion.text,userText);assert.equal(draft.value.item.payload.model,undefined);
 const archive=(await f.request('/account/export')).value;assert.equal(archive.results[0].body.model,undefined);assert.equal(archive.results[0].body.suggestion,userText);assert.equal(archive.drafts[0].payload.methodSuggestion.model,undefined);assert.equal(archive.drafts[0].payload.custom.model,'user-entered');assert.doesNotMatch(archive.jobs.find(row=>row.id==='failed').error,/Claude|private-research/);
 assert.equal(JSON.parse(f.db.prepare('SELECT payload FROM workspace_drafts').get().payload).methodSuggestion.model,runtime.model);
});
test('payment and bibliography provider identifiers remain intact and unrelated user data is not recursively filtered',()=>{
 const payment={channels:[{provider:'wechat'},{provider:'alipay'}],item:{provider:'wechat',model:'user reference'}};
 assert.deepEqual(publicAIResponse('/api/payments/options',payment),payment);assert.deepEqual(publicAIResponse('/api/orders/order',payment),payment);
 const archive={thesisSections:[{id:'section',model:'private',engine:'private',text:userText,trace:[{tool:'read_material',status:'completed',materialId:'source',server:'hidden'}]}],feedback:[{body:userText}],theses:[{snapshot:{references:[{provider:'crossref',title:userText}],profile:{method:userText}}}]};
 const publicArchive=publicAIResponse('/api/account/export',archive);assert.equal(publicArchive.thesisSections[0].model,undefined);assert.equal(publicArchive.thesisSections[0].engine,undefined);assert.equal(publicArchive.thesisSections[0].text,userText);assert.deepEqual(publicArchive.feedback,archive.feedback);assert.deepEqual(publicArchive.theses,archive.theses);
});
