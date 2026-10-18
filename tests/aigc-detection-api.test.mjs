import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
import {createSession} from '../backend/auth.mjs';

async function fixture(t,overrides={}){
 const calls=[],client={ready:true,async detect(content){calls.push(content);return{label:'ugc',confidence:98,requestId:'private-aigc-request'};},...overrides.client};
 const app=createServer({dbPath:':memory:',config:{aigcDetectionEnabled:true,moderationAccessKeyId:'unit-aigc-id',moderationAccessKeySecret:'unit-aigc-secret',aigcDetectionClient:client,...overrides.config}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port,users={};for(const id of ['alice','bob']){app.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());users[id]={id,cookie:'pk_session='+createSession(app.db,id)};}
 t.after(()=>app.close());
 async function request(path,input,user=users.alice,headers={}){const result=await fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',headers:{...(user?{Cookie:user.cookie}:{}),...(input===undefined?{}:{Origin:base,'Content-Type':'application/json'}),...headers},body:input===undefined?undefined:JSON.stringify(input)});return{status:result.status,value:await result.json(),headers:result.headers};}
 const submit=(extra={},user=users.alice,headers={})=>request('/aigc-detections',{text:'合成接口验收文本。'.repeat(50),consent:true,expectedUserId:user?.id,idempotencyKey:crypto.randomUUID(),...extra},user,headers);
 async function wait(id,user){for(let n=0;n<100;n++){const item=await request('/aigc-detections/'+id,undefined,user);if(item.value.status!=='running')return item;await new Promise(resolve=>setTimeout(resolve,1));}assert.fail('did not settle');}
 return{...app,calls,users,base,request,submit,wait};
}

test('public capabilities expose independent bounded service state, never credentials or provider internals',async t=>{
 const f=await fixture(t),r=await f.request('/capabilities',undefined,null);assert.equal(r.status,200);assert.equal(r.value.aigcDetection.ready,true);assert.equal(r.value.aigcDetection.maxCharacters,50000);assert.equal(r.value.aigcDetection.maxPartCharacters,5000);assert.equal(r.value.aigcDetection.pointsCharged,false);assert.equal(r.value.detection.external,false);assert.doesNotMatch(JSON.stringify(r.value),/unit-aigc|moderationAccess|aliyuncs|private-aigc/);assert.equal(r.headers.get('cache-control'),'no-store');
 const off=await fixture(t,{config:{aigcDetectionEnabled:false}});assert.equal((await off.request('/capabilities',undefined,null)).value.aigcDetection.ready,false);assert.equal((await off.submit()).status,503);assert.equal(off.calls.length,0);
});

test('auth, same-origin, account and explicit consent boundaries precede any paid API call',async t=>{
 const f=await fixture(t);assert.equal((await f.submit({},null)).status,401);assert.equal((await f.submit({},f.users.alice,{Origin:'https://attacker.invalid'})).status,403);assert.equal((await f.submit({},f.users.alice,{Origin:''})).status,403);assert.equal((await f.submit({expectedUserId:'bob'})).status,409);assert.equal((await f.submit({consent:false})).status,400);assert.equal((await f.submit({unsupported:'raw-token'})).status,400);assert.equal(f.calls.length,0);
});

test('HTTP creates asynchronous owner-scoped record, supports reload history and prevents same-text/key rebilling',async t=>{
 const f=await fixture(t),key=crypto.randomUUID(),first=await f.submit({idempotencyKey:key});assert.equal(first.status,202);assert.equal(first.value.status,'running');
 const result=await f.wait(first.value.id);assert.equal(result.value.status,'completed');assert.equal(result.value.verdict,'ugc');assert.equal(result.value.parts[0].confidence,98);assert.equal(result.value.conclusive,true);assert.doesNotMatch(JSON.stringify(result.value),/private-aigc|unit-aigc|provider|model|API Token|request_ids/);
 assert.equal((await f.request('/aigc-detections/'+first.value.id,undefined,f.users.bob)).status,404);assert.equal((await f.request('/aigc-detections/'+first.value.id,undefined,null)).status,401);
 const history=await f.request('/aigc-detections');assert.equal(history.value.items[0].id,first.value.id);assert.deepEqual((await f.request('/aigc-detections',undefined,f.users.bob)).value.items,[]);
 assert.equal((await f.submit({idempotencyKey:key})).value.id,first.value.id);assert.equal((await f.submit()).value.id,first.value.id);assert.equal(f.calls.length,1);assert.equal((await f.submit({idempotencyKey:key,text:'changed text'})).status,409);
 assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);
});

test('ambiguous provider failure becomes safe failed record; identical text is never automatically repeated',async t=>{
 let calls=0;const f=await fixture(t,{client:{async detect(){calls++;throw new Error('AccessKey unit-aigc-secret private server stack');}}});const submitted=await f.submit(),failed=await f.wait(submitted.value.id);assert.equal(failed.value.status,'failed');assert.equal(failed.value.conclusive,false);assert.equal(failed.value.verdict,'undetermined');assert.doesNotMatch(JSON.stringify(failed.value),/AccessKey|unit-aigc|private server|stack/);assert.equal((await f.submit()).value.id,failed.value.id);assert.equal(calls,1);
});
