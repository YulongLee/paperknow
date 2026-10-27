import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAigcDetectionClient,aigcDetectionConfigured,aigcDetectionLimits,prepareAigcText,normalizeAigcResponse} from '../backend/aigc-detection-client.mjs';
import {createAigcDetectionService} from '../backend/aigc-detection-service.mjs';
import {environmentConfig} from '../backend/config.mjs';

const configured={aigcDetectionEnabled:true,moderationAccessKeyId:'unit-aigc-id',moderationAccessKeySecret:'unit-aigc-secret'};
const response=(label='aigc',confidence=96)=>({statusCode:200,body:{Code:200,Data:{Result:[{Label:label,Confidence:confidence}],RiskLevel:'none'},RequestId:'private-aigc-trace'}});
const safe=code=>error=>{assert.equal(error.code,code);assert.equal(error.aigcDetectionSafe,true);assert.doesNotMatch(error.message,/AccessKey|unit-aigc|aliyun|private|aigc-trace/);return true;};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,options={}){
 const db=options.db||new DatabaseSync(':memory:');if(!options.db){db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES('alice'),('bob'),('carol');");t.after(()=>db.close());}
 const calls=[],client={ready:true,async detect(content,options){calls.push({content,options});return{label:'aigc',confidence:96,requestId:'private-aigc-trace'};},...options.client};
 const config={...configured,...options.config},service=createAigcDetectionService(db,config,{client});
 const submit=(extra={},user={id:'alice'})=>service.handle({path:'/api/aigc-detections',method:'POST',user,readBody:async()=>({text:'合成研究方法测试文本。'.repeat(100),consent:true,expectedUserId:user?.id,idempotencyKey:crypto.randomUUID(),...extra})});
 const get=(id,user={id:'alice'})=>service.handle({path:'/api/aigc-detections/'+id,method:'GET',user});
 return{db,config,service,client,calls,submit,get,async completed(extra={},user){const pending=await submit(extra,user);await service.waitForIdle();return get(pending.value.id,user);}};
}

test('independent explicit switch/credentials and tight bounded budgets determine readiness',async()=>{
 for(const config of [{},{aigcDetectionEnabled:true},{...configured,aigcDetectionEnabled:'1'},{...configured,moderationAccessKeySecret:'space secret'},{...configured,moderationEndpoint:'https://attacker.invalid'},{...configured,moderationEndpoint:'green-cip.cn-shanghai.aliyuncs.com.evil.invalid'},{...configured,moderationRegion:'cn-hangzhou'},{...configured,aigcDetectionGlobalDailyCalls:201},{...configured,aigcDetectionUserDailyLimit:0},{...configured,aigcDetectionTimeoutMs:Infinity},{aigcDetectionEnabled:true,smsAccessKeyId:'unit-aigc-id',smsAccessKeySecret:'unit-aigc-secret'}]){
  assert.equal(aigcDetectionConfigured(config),false);const client=createAigcDetectionClient(config,{client:{callApi(){assert.fail('must not call');}}});assert.equal(client.ready,false);await assert.rejects(client.detect('test'),safe('aigc_detection_not_configured'));
 }
 assert.equal(aigcDetectionConfigured({...configured,moderationEnabled:false}),true);
 assert.equal(aigcDetectionLimits({...configured,aigcDetectionGlobalDailyCalls:2}).globalDailyCalls,2);
 const env=environmentConfig({PK_AIGC_DETECTION_ENABLED:'1',PK_MODERATION_ACCESS_KEY_ID:'unit-aigc-id',PK_MODERATION_ACCESS_KEY_SECRET:'unit-aigc-secret'});assert.equal(aigcDetectionConfigured(env),true);
 assert.equal(environmentConfig({PK_MODERATION_ENABLED:'1'}).aigcDetectionEnabled,false);
 assert.equal(aigcDetectionConfigured({...env,...environmentConfig({PK_AIGC_DETECTION_ENABLED:'1',PK_AIGC_DETECTION_USER_DAILY_LIMIT:'nonsense'})}),false);
});

test('uses the exact official API contract, fixed HTTPS endpoint and no retries',async()=>{
 const calls=[],client=createAigcDetectionClient(configured,{client:{async callApi(params,request,runtime){calls.push({params,request,runtime});return response('ugc',98);}}});
 assert.deepEqual(await client.detect('合成测试文本',{dataId:'pk-test-1'}),{label:'ugc',confidence:98,requestId:'private-aigc-trace'});
 const call=calls[0];assert.equal(call.params.action,'TextModerationPlus');assert.equal(call.params.version,'2022-03-02');assert.equal(call.params.protocol,'HTTPS');assert.equal(call.params.method,'POST');assert.equal(call.params.style,'RPC');assert.equal(call.params.reqBodyType,'formData');assert.equal(call.request.body.Service,'text_aigc_detector');assert.deepEqual(JSON.parse(call.request.body.ServiceParameters),{content:'合成测试文本',dataId:'pk-test-1'});assert.equal(call.runtime.autoretry,false);assert.equal(call.runtime.maxAttempts,1);assert.equal(call.runtime.ignoreSSL,false);
 await assert.rejects(client.detect('字'.repeat(5001)),safe('aigc_detection_input_invalid'));assert.equal(calls.length,1);
});

test('chunks all submitted text with exact Unicode offsets and reserves all billed units up front',()=>{
 const text='研究'.repeat(2500)+'🙂'.repeat(2501),prepared=prepareAigcText(text);
 assert.equal(prepared.characters,7501);assert.equal(prepared.parts.map(part=>part.content).join(''),text);assert.ok(prepared.parts.every(part=>part.content.length<=5000));assert.deepEqual(prepared.parts.map(part=>[part.start,part.end]),[[0,5000],[5000,7500],[7500,7501]]);assert.equal(prepared.calls,1);assert.equal(prepared.billingUnits,5);
 for(const value of ['',null,'   ','\u0000abc','\ud800','x'.repeat(50001)])assert.throws(()=>prepareAigcText(value));
 const whitespace=prepareAigcText(' '.repeat(5000)+'abc');assert.equal(whitespace.calls,1);assert.equal(whitespace.parts.length,2);assert.equal(whitespace.billingUnits,1);
});

test('only valid explicit labels and confidence conclude; never invert confidence or trust RiskLevel',()=>{
 assert.equal(normalizeAigcResponse(response('ugc',98)).confidence,98);
 const inconclusive=response();inconclusive.body.Data.Result=[{Label:'nonLabel'}];assert.deepEqual(normalizeAigcResponse(inconclusive),{label:'undetermined',confidence:null,requestId:'private-aigc-trace'});
 for(const result of [[],[{Label:'ugc'}],[{Label:'ugc',Confidence:'98'}],[{Label:'ugc',Confidence:-1}],[{Label:'ugc',Confidence:101}],[{Label:'aigc',Confidence:NaN}],[{Label:'aigc',Confidence:90},{Label:'ugc',Confidence:10}],[{Label:'futureLabel',Confidence:99}]]){
  const r=response();r.body.Data.Result=result;assert.throws(()=>normalizeAigcResponse(r),error=>{assert.equal(error.status,502);return safe('aigc_detection_unavailable')(error);});
 }
 const risk=response('ugc',98);risk.body.Data.RiskLevel='high';assert.equal(normalizeAigcResponse(risk).label,'ugc');
 for(const value of [{statusCode:500,body:response().body},{statusCode:200,body:{Code:408,Message:'unit-aigc-secret'}},{statusCode:200,body:{Code:200,Data:null}}])assert.throws(()=>normalizeAigcResponse(value),safe('aigc_detection_unavailable'));
});

test('returned DataId must match the exact partition and billing diagnostics stay internal',async t=>{
 const good=response();good.body.Data.DataId='pk-right';assert.equal(normalizeAigcResponse(good,{expectedDataId:'pk-right'}).label,'aigc');
 for(const dataId of ['pk-wrong',null,1,{}]){const bad=response();bad.body.Data.DataId=dataId;assert.throws(()=>normalizeAigcResponse(bad,{expectedDataId:'pk-right'}),error=>{assert.equal(error.aigcRequestId,'private-aigc-trace');return safe('aigc_detection_unavailable')(error);});}
 const mismatched=createAigcDetectionClient(configured,{client:{async callApi(){return good;}}});await assert.rejects(mismatched.detect('text',{dataId:'pk-wrong'}),safe('aigc_detection_unavailable'));
 const billedClient=createAigcDetectionClient(configured,{client:{async callApi(){const value=response();value.body.Code=408;return value;}}}),f=fixture(t,{client:billedClient});
 const item=(await f.completed()).value;assert.equal(item.status,'failed');assert.equal(item.conclusive,false);assert.doesNotMatch(JSON.stringify(item),/private-aigc-trace|request_ids|requestId/);
 const row=f.db.prepare('SELECT * FROM aigc_detections').get();assert.equal(row.reserved_calls,1);assert.equal(row.attempted_parts,1);assert.deepEqual(JSON.parse(row.request_ids),['private-aigc-trace']);
});

test('timeouts mask upstream diagnostics and retain transport slots without paid retry',async()=>{
 const pending=[];let calls=0;const client=createAigcDetectionClient({...configured,aigcDetectionTimeoutMs:5},{client:{callApi(){calls++;return calls<=2?new Promise(resolve=>pending.push(resolve)):Promise.resolve(response('ugc',98));}}});
 await assert.rejects(client.detect('test1'),safe('aigc_detection_timeout'));await assert.rejects(client.detect('test2'),safe('aigc_detection_timeout'));await assert.rejects(client.detect('test3'),safe('aigc_detection_busy'));assert.equal(calls,2);for(const resolve of pending)resolve(response());await tick();
 const fail=createAigcDetectionClient(configured,{client:{async callApi(){throw Error('AccessKey unit-aigc-secret private');}}});await assert.rejects(fail.detect('test'),safe('aigc_detection_unavailable'));
});

test('admission requires authenticated current account, consent, valid fields and enabled configuration',async t=>{
 const f=fixture(t);await assert.rejects(f.submit({},null),{status:401});
 for(const [extra,status]of [[{consent:false},400],[{expectedUserId:'bob'},409],[{idempotencyKey:'short'},400],[{text:''},400],[{fileURL:'https://attacker.invalid'},400],[{text:'x'.repeat(50001)},413]])await assert.rejects(f.submit(extra),{status});
 assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM aigc_detections').get().n,0);
 const disabled=fixture(t,{config:{aigcDetectionEnabled:false}});await assert.rejects(disabled.submit(),{status:503});
 const cap=f.service.capabilities();assert.equal(cap.ready,true);assert.equal(cap.pointsCharged,false);assert.equal(cap.userDailyLimit,10);assert.doesNotMatch(JSON.stringify(cap),/unit-aigc|AccessKey|aliyun/);
});

test('async result preserves labels and offsets, owners and duplicate submissions coalesce durably without text storage',async t=>{
 const f=fixture(t),key=crypto.randomUUID(),one=await f.submit({idempotencyKey:key,text:'A'.repeat(5001)});assert.equal(one.status,202);assert.equal(one.value.status,'running');await f.service.waitForIdle();
 const result=(await f.get(one.value.id)).value;assert.equal(result.status,'completed');assert.equal(result.verdict,'aigc');assert.equal(result.conclusive,true);assert.equal(result.completedParts,2);assert.equal(result.parts.length,2);assert.equal(f.calls.length,2);assert.deepEqual(result.counts,{aigc:2,ugc:0,undetermined:0});assert.doesNotMatch(JSON.stringify(result),/private-aigc|provider|RequestId|probability|percentage|AI率/);
 assert.equal((await f.submit({idempotencyKey:key,text:'A'.repeat(5001)})).value.id,result.id);const alias=crypto.randomUUID();assert.equal((await f.submit({idempotencyKey:alias,text:'A'.repeat(5001)})).value.id,result.id);assert.equal(f.calls.length,2);
 await assert.rejects(f.submit({idempotencyKey:alias,text:'different'}),{status:409});await assert.rejects(f.get(result.id,{id:'bob'}),{status:404});
 const other=fixture(t,{db:f.db,client:{detect(){assert.fail('never replay');}}});assert.equal((await other.submit({text:'A'.repeat(5001)})).value.id,result.id);
 const rows=f.db.prepare('SELECT * FROM aigc_detections').all();assert.doesNotMatch(JSON.stringify(rows),/AAAAA|content|text|A{20}/);assert.equal(rows[0].reserved_calls,2);assert.equal(rows[0].reserved_billing_units,6);
 const list=await f.service.handle({path:'/api/aigc-detections',method:'GET',user:{id:'bob'}});assert.deepEqual(list.value,{items:[]});
});

test('unknown segment yields no whole-document conclusion and mixed known labels never become an averaged percentage',async t=>{
 const known=fixture(t,{client:{async detect(content){return{label:content[0]==='A'?'aigc':'ugc',confidence:content[0]==='A'?99:98};}}});
 const mixed=(await known.completed({text:'A'.repeat(5000)+'B'.repeat(100)})).value;assert.equal(mixed.verdict,'mixed');assert.equal(mixed.conclusive,true);assert.deepEqual(mixed.parts.map(row=>row.confidence),[99,98]);
 const unknown=fixture(t,{client:{async detect(){return{label:'undetermined',confidence:null};}}});const item=(await unknown.completed()).value;assert.equal(item.status,'failed');assert.equal(item.verdict,'undetermined');assert.equal(item.conclusive,false);assert.equal(item.parts[0].confidence,null);assert.equal(item.completedParts,1);assert.match(item.error,/未取得有效鉴别结论/);
});

test('long-text budgets preflight entire task before any call and survive restart/failure',async t=>{
 const f=fixture(t,{config:{aigcDetectionGlobalDailyCalls:1}});await assert.rejects(f.submit({text:'x'.repeat(5001)}),{status:429});assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM aigc_detections').get().n,0);
 const units=fixture(t,{config:{aigcDetectionGlobalDailyBillingUnits:1}});await assert.rejects(units.submit({text:'x'.repeat(1001)}),{status:429});assert.equal(units.calls.length,0);
 const user=fixture(t,{config:{aigcDetectionUserDailyLimit:1},client:{async detect(){throw Error('unit-aigc-secret');}}});const failed=(await user.completed()).value;assert.equal(failed.status,'failed');assert.doesNotMatch(failed.error,/unit-aigc|secret/);const restart=fixture(t,{db:user.db,config:{aigcDetectionUserDailyLimit:1},client:{detect(){assert.fail('never replay');}}});assert.equal((await restart.submit()).value.id,failed.id);await assert.rejects(restart.submit({text:'new text'}),{status:429});
});

test('parallel submissions coalesce, per-owner/global concurrency is bounded and partial failure stops later calls',async t=>{
 const pending=[];const f=fixture(t,{client:{detect(){return new Promise(resolve=>pending.push(resolve));}}});const first=await f.submit(),duplicate=await f.submit();assert.equal(first.value.id,duplicate.value.id);assert.equal(duplicate.value.cached,true);assert.equal(pending.length,1);
 await assert.rejects(f.submit({text:'other'}),{status:409});await f.submit({text:'bob text'},{id:'bob'});await assert.rejects(f.submit({text:'carol text'},{id:'carol'}),{status:429});for(const resolve of pending)resolve({label:'ugc',confidence:98});await f.service.waitForIdle();
 let n=0;const partial=fixture(t,{client:{async detect(){if(++n===2)throw Error('private-error');return{label:'aigc',confidence:96};}}});const failed=(await partial.completed({text:'x'.repeat(11000)})).value;assert.equal(n,2);assert.equal(failed.status,'failed');assert.equal(failed.completedParts,1);assert.equal(failed.conclusive,false);assert.equal(failed.verdict,'undetermined');assert.equal(partial.db.prepare('SELECT attempted_parts FROM aigc_detections').get().attempted_parts,2);
});

test('stale interrupted rows fail safely and no GET or new key resubmits plaintext',async t=>{
 const f=fixture(t),done=(await f.completed()).value;f.db.prepare("UPDATE aigc_detections SET status='running',updated_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(done.id);const restored=(await f.get(done.id)).value;assert.equal(restored.status,'failed');assert.equal((await f.submit()).value.id,done.id);assert.equal(f.calls.length,1);
});

test('stale DB rows do not release actual SDK slots or apply late verdicts to failed work',async t=>{
 const pending=[];let calls=0;const client=createAigcDetectionClient(configured,{client:{callApi(){calls++;return calls<=2?new Promise(resolve=>pending.push(resolve)):Promise.resolve(response('ugc',98));}}}),f=fixture(t,{client});
 const first=await f.submit({text:'x'.repeat(11000)});f.db.prepare("UPDATE aigc_detections SET updated_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(first.value.id);assert.equal((await f.get(first.value.id)).value.status,'failed');
 await f.submit({text:'second text'},{id:'bob'});const third=await f.submit({text:'third text'},{id:'carol'});await tick();assert.equal(calls,2);assert.equal((await f.get(third.value.id,{id:'carol'})).value.status,'running');
 for(const resolve of pending)resolve(response('ugc',98));await f.service.waitForIdle();const stale=(await f.get(first.value.id)).value;assert.equal(stale.status,'failed');assert.equal(stale.completedParts,0);assert.equal(stale.conclusive,false);assert.equal(calls,4);assert.equal((await f.get(third.value.id,{id:'carol'})).value.status,'completed');
});
