import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from '../server.mjs';
import {createSession} from '../backend/auth.mjs';

async function fixture(t,{disk=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'pk-credit-code-')),path=disk?join(dir,'test.sqlite'):':memory:',app=createServer({dbPath:path,config:{paymentConfigKey:randomBytes(32).toString('base64')}});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port,seed=(id,role='user')=>{app.db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,id,role,new Date().toISOString());return{id,cookie:'pk_session='+createSession(app.db,id)};},admin=seed('code-admin','admin'),user=seed('code-owner'),other=seed('code-other');
 const request=async(url,{data,actor=user,headers={}}={})=>{const response=await fetch(base+'/api'+url,{method:data===undefined?'GET':'POST',headers:{...(actor?{Cookie:actor.cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json',Origin:base}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});return{status:response.status,value:await response.json()};};
 const issue=async()=>{const result=await request('/admin/credit-codes',{actor:admin,data:{commandId:randomUUID(),name:'隔离接口活动',creditAmount:500,quantity:4,expiresAt:new Date(Date.now()+86400000).toISOString()}});assert.equal(result.status,200);const exported=await request('/admin/credit-codes/'+result.value.batch.id+'/export',{actor:admin,data:{status:'all'}});assert.equal(exported.status,200);return{batch:result.value.batch,codes:exported.value.csv.split('\r\n').slice(1,-1).map(line=>line.split(',')[0].slice(1,-1))};};
 t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});return{...app,path,base,admin,user,other,request,issue};
}
test('HTTP administration requires a current admin and users can redeem only into the bound account',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/admin/credit-codes',{actor:null})).status,401);assert.equal((await f.request('/admin/credit-codes')).status,403);
 const {batch,codes}=await f.issue();assert.equal((await f.request('/admin/credit-codes/'+batch.id+'/export',{data:{status:'all'}})).status,403);
 assert.equal((await f.request('/credits/redeem',{data:{code:'A'.repeat(5000)}})).status,413);
 assert.equal((await f.request('/credits/redeem',{actor:null,data:{code:codes[0]}})).status,401);
 assert.equal((await f.request('/credits/redeem',{data:{code:codes[0]},headers:{Origin:'https://untrusted.invalid'}})).status,403);
 assert.equal((await f.request('/credits/redeem',{actor:f.other,data:{code:codes[0]},headers:{'X-PaperKnow-User':f.user.id}})).status,409);
 const result=await f.request('/credits/redeem',{data:{code:codes[0]},headers:{'X-PaperKnow-User':f.user.id}});assert.equal(result.status,200);assert.equal(result.value.credits.available,500);
 assert.equal((await f.request('/credits/redeem',{data:{code:codes[0]}})).value.alreadyRedeemed,true);
 assert.equal((await f.request('/credits/redeem',{actor:f.other,data:{code:codes[0]}})).status,409);
 const mine=await f.request('/credits/redemptions?page=1&pageSize=5'),theirs=await f.request('/credits/redemptions',{actor:f.other});assert.equal(mine.value.total,1);assert.equal(theirs.value.total,0);assert.equal(theirs.value.credits.balance,0);assert.ok(!JSON.stringify(mine.value).includes(codes[0]));
 const usage=await f.request('/payments/entitlements');assert.equal(usage.value.credits.balance,500);assert.equal(usage.value.credits.ledger[0].kind,'redeem');
 assert.equal(f.db.prepare('SELECT count(*) n FROM orders').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_orders').get().n,0);
});
test('simultaneous HTTP redemptions and revocation leave a single consistent outcome',async t=>{
 const f=await fixture(t),{batch,codes}=await f.issue();const results=await Promise.all([f.request('/credits/redeem',{data:{code:codes[0]}}),f.request('/credits/redeem',{actor:f.other,data:{code:codes[0]}})]);assert.deepEqual(results.map(row=>row.status).sort(),[200,409]);assert.equal(f.db.prepare('SELECT count(*) n FROM credit_code_redemptions').get().n,1);
 const row=(await f.request('/admin/credit-codes/'+batch.id,{actor:f.admin})).value.items[1];const race=await Promise.all([f.request('/credits/redeem',{data:{code:codes[1]}}),f.request('/admin/credit-code-items/'+row.id+'/revoke',{actor:f.admin,data:{commandId:randomUUID(),version:row.version,reason:'并发作废测试'}})]);assert.equal(race.filter(row=>row.status===200).length,1);const count=f.db.prepare('SELECT count(*) n FROM credit_code_redemptions WHERE code_id=?').get(row.id).n;assert.equal(count,race[0].status===200?1:0);
});
test('two independent worker connections cannot double-spend the same code',async t=>{
 const f=await fixture(t,{disk:true}),{codes}=await f.issue(),workers=[f.user,f.other].map(user=>new Worker(new URL('./fixtures/credit-code-race.mjs',import.meta.url),{workerData:{path:f.path,userId:user.id,code:codes[0]}}));
 t.after(async()=>{await Promise.all(workers.map(worker=>worker.terminate()));});
 const message=(worker,predicate)=>new Promise((resolve,reject)=>{const onError=error=>{worker.off('message',receive);reject(error);},receive=row=>{if(row?.fixture==='credit-code-race'&&predicate(row)){worker.off('message',receive);worker.off('error',onError);resolve(row);}};worker.on('message',receive);worker.once('error',onError);});await Promise.all(workers.map(worker=>message(worker,row=>row.ready===true)));const promises=workers.map(worker=>message(worker,row=>Number.isInteger(row.status)));workers.forEach(worker=>worker.postMessage('redeem'));const results=await Promise.all(promises);assert.deepEqual(results.map(row=>row.status).sort(),[200,409]);assert.equal(f.db.prepare('SELECT count(*) n FROM credit_code_redemptions').get().n,1);assert.equal(f.db.prepare('SELECT sum(amount) n FROM credit_code_redemptions').get().n,500);
});
