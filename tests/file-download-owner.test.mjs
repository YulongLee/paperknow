import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession,digest} from '../backend/auth.mjs';
import {createFileService} from '../backend/file-service.mjs';

async function fixture(t){
 const db=database(':memory:'),reads=[],bytes=Buffer.from('Owned synthetic original'),storage={provider:'aliyun_oss',read:async row=>{reads.push(row.user_id+':'+row.id);return bytes;}},api=createAPI(db,{cancel(){}},{storage,getAI:()=>({aiEnabled:false})}),server=http.createServer((req,res)=>void api(req,res));
 const cookies={};for(const id of ['owner-alice','owner-bob']){db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,id,'user',new Date().toISOString());cookies[id]='pk_session='+createSession(db,id);db.prepare('INSERT INTO files(id,user_id,name,kind,bytes,sha256,body,created_at,storage_provider,storage_key,storage_bucket) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id+'-file',id,id+'.txt','txt',bytes.length,digest(bytes),Buffer.alloc(0),new Date().toISOString(),'aliyun_oss','paperknow/users/'+id+'/originals/file.txt','synthetic-bucket');}
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 return{db,reads,bytes,storage,cookies,get:async(path,user='owner-alice')=>{const response=await fetch(base+'/api'+path,{headers:user?{Cookie:cookies[user]}:{}});return{status:response.status,headers:response.headers,text:await response.text()};}};
}

test('real API forwards expected owner and blocks a download after the current session switches accounts',async t=>{
 const f=await fixture(t),verified=await f.get('/auth/me');assert.equal(JSON.parse(verified.text).user.id,'owner-alice');
 const correct=await f.get('/files/owner-alice-file/download?expectedUserId=owner-alice');assert.equal(correct.status,200);assert.equal(correct.text,f.bytes.toString());assert.equal(correct.headers.get('cache-control'),'no-store');assert.equal(correct.headers.get('x-content-type-options'),'nosniff');assert.equal(f.reads.length,1);
 // The retained link was created while Alice was signed in, but the browser now
 // supplies Bob's real session. The fixed expected owner must remain binding.
 const switched=await f.get('/auth/me','owner-bob');assert.equal(JSON.parse(switched.text).user.id,'owner-bob');
 for(const file of ['owner-alice-file','owner-bob-file','nonexistent']){const response=await f.get('/files/'+file+'/download?expectedUserId=owner-alice','owner-bob');assert.equal(response.status,409);assert.match(response.text,/登录账户已变化/);assert.doesNotMatch(response.text,/Owned synthetic original/);}
 assert.equal(f.reads.length,1,'mismatch rejects before reading any local/OSS bytes');
 const bobOwn=await f.get('/files/owner-bob-file/download?expectedUserId=owner-bob','owner-bob');assert.equal(bobOwn.status,200);assert.equal(f.reads.length,2);
});

test('expected owner is only an extra guard and never grants access to another user file',async t=>{
 const f=await fixture(t);
 const notOwner=await f.get('/files/owner-alice-file/download?expectedUserId=owner-bob','owner-bob');assert.equal(notOwner.status,404);assert.equal(f.reads.length,0);
 assert.equal((await f.get('/files/owner-alice-file/download','owner-bob')).status,404);assert.equal((await f.get('/files/owner-alice-file/download?expectedUserId=owner-alice',null)).status,401);assert.equal(f.reads.length,0);
 const old=await f.get('/files/owner-alice-file/download');assert.equal(old.status,200);assert.equal(old.text,f.bytes.toString());assert.equal(f.reads.length,1);
});

test('invalid and repeated download owner parameters fail 400 before any original read',async t=>{
 const f=await fixture(t);
 for(const query of ['expectedUserId=','expectedUserId=%20owner-alice','expectedUserId=owner-alice%0A','expectedUserId=owner%2Falice','expectedUserId='+('x'.repeat(161)),'expectedUserId=owner-alice&expectedUserId=owner-alice','expectedUserId=owner-alice&expectedUserId=owner-bob']){const r=await f.get('/files/owner-alice-file/download?'+query);assert.equal(r.status,400,query);assert.doesNotMatch(r.text,/Owned synthetic original/);}
 assert.equal(f.reads.length,0);
});

test('legacy direct service calls remain compatible and owner query does not alter other file operations',async t=>{
 const f=await fixture(t),service=createFileService(f.db,{storage:f.storage});
 const legacy=await service({path:'/api/files/owner-alice-file/download',method:'GET',user:{id:'owner-alice'}});assert.equal(legacy.body.toString(),f.bytes.toString());
 const list=await service({path:'/api/files',method:'GET',user:{id:'owner-alice'},query:new URLSearchParams({expectedUserId:'owner-bob'})});assert.deepEqual(list.value.items.map(x=>x.id),['owner-alice-file']);
 await assert.rejects(()=>service({path:'/api/files/owner-alice-file/download',method:'GET',user:{id:'owner-alice'},query:{expectedUserId:'owner-alice'}}),{status:400});
});
