import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
import {createSession} from '../backend/auth.mjs';
const text='教育数字化需要明确实施目标和实际资源，逐步建立可访问的学习服务，并记录真实的使用反馈，以便检验建设效果与持续改进路径。';
async function fixture(t,overrides={}){
 const objects=new Map(),calls=[];
 const config={webSimilarityEnabled:true,aiURL:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',aiKey:'unit-private-model-key',ossBucket:'private-test',ossEndpoint:'https://oss-cn-shanghai.aliyuncs.com',ossRegion:'cn-shanghai',ossAccessKeyId:'unit-id',ossAccessKeySecret:'unit-secret',ossClient:{async put(key,value){objects.set(key,Buffer.from(value));},async get(key){return{content:objects.get(key)};},async delete(key){objects.delete(key);}},webSimilaritySearch:{async search(q){calls.push(q);return{searched:true,sources:[{title:'实际来源',url:'https://public.example.org/source'}],usage:{inputTokens:20,outputTokens:2}};}},webSimilaritySourceReader:async()=>({url:'https://public.example.org/source',title:'来源',text,contentHash:'synthetic-test',fetchedAt:new Date().toISOString()}),...overrides};
 const app=createServer({dbPath:':memory:',config});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base='http://127.0.0.1:'+app.server.address().port;
 const users={};for(const id of ['alice','bob']){app.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());users[id]='pk_session='+createSession(app.db,id);}
 async function request(path,input,user='alice',headers={}){const response=await fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',headers:{...(users[user]?{Cookie:users[user]}:{}),...(input===undefined?{}:{Origin:base,'Content-Type':'application/json'}),...headers},body:input===undefined?undefined:JSON.stringify(input)});return{status:response.status,value:await response.json()};}
 const submit=(extra={},user='alice',headers={})=>request('/web-similarity',{text,title:'合成接口测试',consent:true,idempotencyKey:crypto.randomUUID(),expectedUserId:user,...extra},user,headers);
 return{...app,request,submit,calls};
}
test('web checking capabilities, authentication, origin, account and consent boundaries are enforced',async t=>{
 const f=await fixture(t);const cap=await f.request('/capabilities',undefined,null);assert.equal(cap.status,200);assert.equal(cap.value.webSimilarity.ready,true);assert.equal(cap.value.webSimilarity.pointsCharged,false);assert.equal(cap.value.detection.external,false);assert.doesNotMatch(JSON.stringify(cap.value),/unit-secret|unit-private-model-key|dashscope|qwen/);
 assert.equal((await f.submit({},null)).status,401);assert.equal((await f.submit({},'alice',{Origin:'https://attacker.invalid'})).status,403);assert.equal((await f.submit({expectedUserId:'bob'})).status,409);assert.equal((await f.submit({consent:false})).status,400);assert.equal(f.calls.length,0);
});
test('HTTP task and private OSS report survive reload with source evidence and no early artifact publication',async t=>{
 const f=await fixture(t),submitted=await f.submit(),id=submitted.value.item.id;assert.equal(submitted.status,202);assert.equal(submitted.value.ownerId,'alice');
 const input=f.db.prepare('SELECT input_artifact_id FROM web_similarity_runs WHERE id=?').get(id).input_artifact_id;
 assert.equal((await f.request('/artifacts')).value.items.length,0);assert.equal((await f.request('/artifacts/'+input+'/download')).status,409);
 await f.worker.tick();const got=await f.request('/web-similarity/'+id);assert.equal(got.value.item.status,'completed');const report=await f.request('/web-similarity/'+id+'/report');assert.equal(report.status,200);assert.equal(report.value.ownerId,'alice');assert.equal(report.value.report.ratio,1);assert.equal(report.value.report.sources[0].url,'https://public.example.org/source');
 assert.equal((await f.request('/web-similarity/'+id,undefined,'bob')).status,404);assert.equal((await f.request('/web-similarity/'+id+'/report',undefined,'bob')).status,404);assert.equal((await f.request('/web-similarity/'+id+'?expectedUserId=bob')).status,409);
 assert.equal((await f.request('/web-similarity')).value.items[0].id,id);assert.equal((await f.request('/artifacts')).value.items.length,2);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);
});
test('input moderation rejection prevents search calls and never publishes a numeric result',async t=>{
 const f=await fixture(t,{moderationEnabled:true,moderation:{ready:true,async checkText(){return{allowed:false};}}}),id=(await f.submit()).value.item.id;
 await f.worker.tick();assert.equal((await f.request('/web-similarity/'+id)).value.item.status,'failed');assert.equal(f.calls.length,0);assert.equal((await f.request('/web-similarity/'+id+'/report')).status,409);
});
