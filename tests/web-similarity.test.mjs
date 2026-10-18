import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../backend/database.mjs';
import {digest} from '../backend/auth.mjs';
import {createWebSimilarityService,webSimilarityCapabilities} from '../backend/web-similarity-service.mjs';
import {startWebSimilarityWorker} from '../backend/web-similarity-worker.mjs';
import {planWebQueries,webSimilarityInput,webSimilarityDay} from '../backend/web-similarity-model.mjs';
import {parseDocument} from '../dist/precheck/engine.mjs';
const paragraph='数字化研究需要保留可核对的原始材料，并通过清晰的文字记录研究过程，使分析结论建立在真实证据与可复现的方法之上。';
const text=paragraph+'\n\n对于访谈研究而言，研究者应明确样本范围与访谈对象，在获得同意后记录相关内容，并对所收集的材料进行匿名处理与系统分析。\n\n问卷调查需要预先检验题目含义与量表质量，说明数据清理规则，并根据真实样本进行分析，不得补造受访人数或显著性结果。';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function fixture(t,overrides={}){
 const db=database(':memory:'),objects=new Map(),calls=[];
 for(const id of ['alice','bob'])db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());
 const storage={provider:'aliyun_oss',bucket:'unit-private',prefix:'paperknow/',async putArtifact(id,user,kind,buffer){const key=`paperknow/users/${user}/exports/${id}.${kind}`;objects.set(key,Buffer.from(buffer));return key;},async readArtifact(row){const data=objects.get(row.storage_key);if(!data)throw Error('private-storage-error');return Buffer.from(data);},async removeArtifact(row){objects.delete(row.storage_key);}};
 const config={webSimilarityEnabled:true,aiURL:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',aiKey:'unit-private-key',storage,
  webSimilaritySearch:{async search(excerpt){calls.push(excerpt);return{searched:true,sources:[{url:'https://public.example.org/paper',title:'实际来源'}],usage:{inputTokens:10,outputTokens:2,totalTokens:12,searchCalls:1}};}},
  webSimilaritySourceReader:async()=>({url:'https://public.example.org/paper',title:'实际来源',text:paragraph,kind:'web',contentHash:digest(paragraph),fetchedAt:new Date().toISOString()}),...overrides};
 const service=createWebSimilarityService(db,config),worker=startWebSimilarityWorker(db,config);config.cancelWebSimilarity=id=>worker.cancel(id);
 t.after(async()=>{await worker.stop();db.close();});
 const request=(suffix='',input,user='alice',method=input===undefined?'GET':'POST')=>service.handle({path:'/api/web-similarity'+suffix,method,user:{id:user},readBody:async()=>input});
 const submit=(input={},user='alice')=>request('',{text,title:'合成流程测试',consent:true,expectedUserId:user,idempotencyKey:crypto.randomUUID(),...input},user);
 const job=id=>db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
 return{db,config,objects,calls,service,worker,request,submit,job};
}
async function rejected(promise,status){await assert.rejects(promise,e=>e.status===status);}

test('search sampling is deterministic, Unicode-safe and explicitly bounded, not every paragraph searched',()=>{
 const parsed=parseDocument((text+'\n\n').repeat(5),'测试'),a=planWebQueries(parsed),b=planWebQueries(parsed);
 assert.deepEqual(a,b);assert.ok(a.queries.length<=3);assert.ok(a.sampledParagraphs<=3);assert.equal(a.totalParagraphs,15);
 assert.ok(a.queries.every(x=>Array.from(x.excerpt).length<=100));
 assert.deepEqual(webSimilarityDay(Date.parse('2026-10-18T17:00:00Z')),{start:'2026-10-18T16:00:00.000Z',end:'2026-10-19T16:00:00.000Z'});
 const unicode=webSimilarityInput({text:paragraph+'😀',title:'测试',consent:true,expectedUserId:'alice',idempotencyKey:'test-1234'},{id:'alice'});assert.ok(unicode.text.endsWith('😀'));
 assert.throws(()=>webSimilarityInput({text:'短文',title:'x',consent:true,expectedUserId:'alice',idempotencyKey:'test-1234'},{id:'alice'}),/40/);
});

test('configuration, expected account, consent and input limits precede remote calls or stored input',async t=>{
 const f=await fixture(t);assert.equal(webSimilarityCapabilities(f.config).ready,true);assert.equal(f.service.capabilities().pointsCharged,false);
 await rejected(f.submit({expectedUserId:'bob'}),409);await rejected(f.submit({consent:false}),400);await rejected(f.submit({text:paragraph.repeat(500)}),400);await rejected(f.submit({extra:'not-supported'}),400);
 f.config.webSimilarityEnabled=false;await rejected(f.submit(),503);assert.equal(f.calls.length,0);assert.equal(f.objects.size,0);
});

test('queued input and completed reports use private artifacts; ratio comes only from real fetched text',async t=>{
 const f=await fixture(t),first=await f.submit(),id=first.value.item.id;
 assert.equal(first.status,202);assert.equal(first.value.item.status,'queued');assert.equal(f.objects.size,1);assert.equal(f.calls.length,0);
 assert.equal(f.job(id).input,'{}');assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM web_similarity_runs').get()),/数字化研究/);
 await f.worker.tick();assert.equal(f.job(id).status,'completed');assert.ok(f.calls.length>=1&&f.calls.length<=3);
 const {report}=((await f.request('/'+id+'/report')).value);assert.equal(report.mode,'web');assert.equal(report.scope,'public-web-sources');assert.equal(report.sources.length,1);assert.ok(report.similarChars>0);assert.ok(report.ratio>0&&report.ratio<1);
 assert.ok(report.sections.flatMap(s=>s.paragraphs).some(p=>p.ranges.length));assert.equal(report.web.fetchedSources,1);assert.match(report.web.limitations.join(''),/不是逐句穷尽|未覆盖学校封闭/);
 assert.equal(f.objects.size,2);assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE status='ready'").get().n,2);
 const result=f.db.prepare('SELECT body FROM results WHERE job_id=?').get(id);assert.doesNotMatch(result.body,/数字化研究|unit-private-key/);
 const history=await f.request();assert.equal(history.value.items[0].id,id);assert.doesNotMatch(JSON.stringify(history),/unit-private-key|qwen|dashscope|input_artifact|searchCalls/);
 await rejected(f.request('/'+id+'/report',undefined,'bob'),404);assert.deepEqual((await f.request('',undefined,'bob')).value.items,[]);
});

test('idempotency and same-input duplicate requests do not resubmit searches or create extra private files',async t=>{
 const f=await fixture(t),key=crypto.randomUUID(),first=await f.submit({idempotencyKey:key}),id=first.value.item.id;
 assert.equal((await f.submit({idempotencyKey:key})).value.item.id,id);assert.equal((await f.submit()).value.item.id,id);assert.equal(f.objects.size,1);
 await rejected(f.submit({idempotencyKey:key,title:'变更标题'}),409);
 await f.worker.tick();const calls=f.calls.length;assert.equal((await f.submit()).value.item.id,id);await f.worker.tick();assert.equal(f.calls.length,calls);
});

test('unavailable source bodies and generated-only URLs never turn into a zero-percent success',async t=>{
 const f=await fixture(t,{webSimilaritySourceReader:async()=>{throw Error('secret upstream diagnostic');}}),id=(await f.submit()).value.item.id;await f.worker.tick();
 assert.equal(f.job(id).status,'failed');assert.match(f.job(id).error,/未取得可比对原文/);assert.doesNotMatch(f.job(id).error,/secret|upstream/);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.objects.size,0);
 await rejected(f.request('/'+id+'/report'),409);
 const empty=await fixture(t,{webSimilaritySearch:{async search(){return{searched:false,sources:[],usage:{}};}}}),second=(await empty.submit()).value.item.id;await empty.worker.tick();assert.equal(empty.job(second).status,'failed');assert.match(empty.job(second).error,/不能据此生成 0%/);
});

test('partial source failures publish explicit limited coverage without using the failed text in the denominator or hits',async t=>{
 const f=await fixture(t,{webSimilaritySearch:{async search(){return{searched:true,sources:[{url:'https://public.example.org/ok',title:'可读'},{url:'https://public.example.org/unavailable',title:'不可读'}],usage:{}};}},webSimilaritySourceReader:async url=>{if(url.endsWith('unavailable'))throw Error('blocked');return{url,title:'真实原文',text:paragraph,contentHash:digest(paragraph),fetchedAt:new Date().toISOString()};}}),id=(await f.submit()).value.item.id;
 await f.worker.tick();const report=(await f.request('/'+id+'/report')).value.report;assert.equal(report.web.fetchedSources,1);assert.equal(report.web.failedSources,1);assert.equal(report.web.searchComplete,false);assert.match(report.web.limitations.join(''),/来源范围受限/);assert.equal(report.sources.length,1);
});

test('cancellation while a search is in flight does not publish late results or replay the unknown request',async t=>{
 const begun=deferred(),resume=deferred();let calls=0;
 const f=await fixture(t,{webSimilaritySearch:{async search(){calls++;begun.resolve();await resume.promise;return{searched:true,sources:[{url:'https://public.example.org/paper',title:'来源'}],usage:{}};}}}),id=(await f.submit()).value.item.id;
 const pending=f.worker.tick();await begun.promise;await f.request('/'+id+'/cancel',{expectedUserId:'alice'});resume.resolve();await pending;await f.worker.tick();assert.equal(f.job(id).status,'cancelled');assert.equal(calls,1);assert.equal(f.objects.size,0);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);
});

test('an interrupted running task becomes visibly failed on restart without repeating billable searches',async t=>{
 const f=await fixture(t),id=(await f.submit()).value.item.id;await f.worker.stop();f.db.prepare("UPDATE jobs SET status='running',stage='searching' WHERE id=?").run(id);
 const next=startWebSimilarityWorker(f.db,f.config);t.after(()=>next.stop());await next.tick();assert.equal(f.job(id).status,'failed');assert.match(f.job(id).error,/未自动重复/);assert.equal(f.calls.length,0);
});

test('daily admission bounds persist even for failed tasks and content integrity failures make no remote call',async t=>{
 const f=await fixture(t),first=(await f.submit()).value.item.id,input=f.db.prepare('SELECT input_artifact_id FROM web_similarity_runs WHERE id=?').get(first),file=f.db.prepare('SELECT * FROM artifacts WHERE id=?').get(input.input_artifact_id);f.objects.set(file.storage_key,Buffer.from('corrupt'));
 await f.worker.tick();assert.equal(f.job(first).status,'failed');assert.equal(f.calls.length,0);
 for(let i=0;i<2;i++){const id=(await f.submit({title:'不同输入'+i})).value.item.id;await f.worker.tick();assert.equal(f.job(id).status,'completed');}
 await rejected(f.submit({title:'第四份'}),429);
});

test('ambiguous failed OSS input remains indexed for cleanup; a fresh explicit retry is allowed before any search attempt',async t=>{
 const f=await fixture(t),originalPut=f.config.storage.putArtifact,originalRemove=f.config.storage.removeArtifact;
 f.config.storage.putArtifact=async(...args)=>{await originalPut(...args);throw Error('put-confirmation-lost');};f.config.storage.removeArtifact=async()=>{throw Error('delete-unavailable');};
 const key=crypto.randomUUID(),first=(await f.submit({idempotencyKey:key})).value.item;
 assert.equal(first.status,'failed');assert.equal(f.objects.size,1);assert.equal(JSON.parse(f.db.prepare('SELECT created_artifacts FROM web_similarity_runs WHERE id=?').get(first.id).created_artifacts).length,1);assert.equal(f.calls.length,0);
 f.config.storage.putArtifact=originalPut;f.config.storage.removeArtifact=originalRemove;
 f.db.prepare('UPDATE web_similarity_runs SET updated_at=? WHERE id=?').run(new Date(Date.now()-120000).toISOString(),first.id);await f.worker.tick();assert.equal(f.objects.size,0);
 assert.equal((await f.submit({idempotencyKey:key})).value.item.id,first.id);
 const next=(await f.submit()).value.item;assert.notEqual(next.id,first.id);assert.equal(next.status,'queued');await f.worker.tick();assert.equal(f.job(next.id).status,'completed');
});

test('report reads share two storage slots and rejected readers do not trigger OSS downloads',async t=>{
 const f=await fixture(t),id=(await f.submit()).value.item.id;await f.worker.tick();
 const read=f.config.storage.readArtifact,resume=deferred(),started=deferred();let count=0;
 f.config.storage.readArtifact=async row=>{if(++count===2)started.resolve();await resume.promise;return read(row);};
 const a=f.request('/'+id+'/report'),b=f.request('/'+id+'/report');await started.promise;await rejected(f.request('/'+id+'/report'),429);assert.equal(count,2);resume.resolve();assert.equal((await a).value.report.id,id);assert.equal((await b).value.report.id,id);
});
