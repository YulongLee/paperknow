import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession,digest} from '../backend/auth.mjs';

const MiB=1024*1024;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,storage){
 const db=database(':memory:'),api=createAPI(db,{cancel(){}},{storage,getAI:()=>({enabled:false})}),server=http.createServer((req,res)=>void api(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const cookies={};for(const id of ['alice','bob']){db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());cookies[id]='pk_session='+createSession(db,id);}
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
 const request=async(path,input,user='alice')=>{const response=await fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',headers:{...(user?{Cookie:cookies[user]}:{}),...(input===undefined?{}:{Origin:base,'Content-Type':'application/json'})},body:input===undefined?undefined:JSON.stringify(input)});return {status:response.status,value:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text()};};
 const upload=(input={},user)=>request('/files',{name:'资料.txt',data:Buffer.from('研究原件').toString('base64'),...input},user);
 const seed=(id,{bytes=1,user='alice',project=null,provider='local_server_sqlite',sha='hash'}={})=>db.prepare('INSERT INTO files(id,user_id,project_id,name,kind,bytes,sha256,body,created_at,storage_provider,storage_key,storage_bucket) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,user,project,'资料.txt','txt',bytes,sha,Buffer.from('x'),new Date().toISOString(),provider,provider==='aliyun_oss'?'paperknow/users/'+user+'/originals/'+id+'.txt':null,provider==='aliyun_oss'?'test-bucket':null);
 const job=(id,fileId,status='running')=>db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'alice','parse',status,status,JSON.stringify({fileId}),id,'hash',new Date().toISOString(),new Date().toISOString());
 return {db,request,upload,seed,job};
}

test('parallel OSS uploads reserve account quota before storage I/O and never oversubscribe',async t=>{
 const started=deferred(),finish=deferred();let puts=0;
 const f=await fixture(t,{provider:'aliyun_oss',bucket:'test-bucket',async put(id,u,k){puts++;started.resolve();await finish.promise;return 'paperknow/users/'+u+'/originals/'+id+'.'+k;},async remove(){}});
 f.seed('near-quota',{bytes:49*MiB});
 const one=f.upload({data:Buffer.alloc(MiB,97).toString('base64')});await started.promise;
 try{const two=await f.upload({data:Buffer.alloc(MiB,98).toString('base64')});assert.equal(two.status,409);assert.equal(puts,1);assert.equal(f.db.prepare('SELECT sum(bytes) n FROM workspace_file_uploads').get().n,MiB);}finally{finish.resolve();}
 assert.equal((await one).status,201);assert.equal(f.db.prepare('SELECT sum(bytes) n FROM files').get().n,50*MiB);assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_file_uploads').get().n,0);
});

test('failed uploads release quota, do not save false file records and block project deletion while in flight',async t=>{
 const started=deferred(),finish=deferred();
 const f=await fixture(t,{provider:'aliyun_oss',bucket:'test-bucket',async put(){started.resolve();await finish.promise;throw new Error('模拟存储不可用');}});
 const p=(await f.request('/projects',{title:'原件项目'})).value.item;
 const upload=f.upload({projectId:p.id});await started.promise;
 try{assert.equal((await f.request('/projects/'+p.id+'/delete',{version:0})).status,409);}finally{finish.resolve();}
 assert.equal((await upload).status,500);assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_file_uploads').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,0);
 assert.equal((await f.request('/projects/'+p.id+'/delete',{version:0})).status,200);
});

test('original deletion validates ownership and version, protects active jobs and preserves completed results',async t=>{
 const f=await fixture(t),uploaded=await f.upload(),id=uploaded.value.id,sha=digest(Buffer.from('研究原件'));
 assert.equal((await f.request('/files/'+id+'/delete',{expectedSha256:sha},'bob')).status,404);
 assert.equal((await f.request('/files/'+id+'/delete',{expectedSha256:'wrong'})).status,409);
 f.job('using-original',id);assert.equal((await f.request('/files/'+id+'/delete',{expectedSha256:sha})).status,409);
 f.db.prepare("UPDATE jobs SET status='completed' WHERE id='using-original'").run();
 f.db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run('kept-result','alice',null,'using-original','parse','已保存解析',JSON.stringify({text:'保留的成果正文'}),new Date().toISOString());
 assert.equal((await f.request('/files/'+id+'/delete',{expectedSha256:sha})).status,200);
 assert.equal((await f.request('/files/'+id+'/delete',{expectedSha256:sha})).status,200);
 assert.equal((await f.request('/files/'+id+'/delete',{expectedSha256:sha},'bob')).status,404);
 assert.equal((await f.request('/files/'+id+'/download')).status,404);assert.equal((await f.request('/files')).value.items.length,0);
 assert.equal((await f.request('/results/kept-result')).value.item.body.text,'保留的成果正文');
 assert.equal((await f.request('/workspace/summary')).value.storage.fileBytes,0);
 assert.equal((await f.request('/files/'+id+'/delete',{expectedSha256:sha},null)).status,401);
});

test('an OSS deletion failure retains recoverable pending metadata and blocks parse/download/retry until deletion completes',async t=>{
 let removes=0;const f=await fixture(t,{provider:'aliyun_oss',bucket:'test-bucket',async remove(){if(++removes===1)throw new Error('OSS暂不可用');}});f.seed('remote-original',{provider:'aliyun_oss'});f.job('retry-old-original','remote-original','failed');
 assert.equal((await f.request('/files/remote-original/delete',{expectedSha256:'hash'})).status,500);
 const pending=(await f.request('/files')).value.items[0];assert.equal(pending.deletionStatus,'pending');assert.equal(pending.sha256,'hash');
 assert.equal((await f.request('/files/remote-original/download')).status,409);
 assert.equal((await f.request('/jobs',{type:'parse',fileId:'remote-original',idempotencyKey:'pending-file'})).status,409);
 assert.equal((await f.request('/jobs/retry-old-original/retry',{})).status,409);
 assert.equal(f.db.prepare("SELECT status FROM jobs WHERE id='retry-old-original'").get().status,'failed');
 assert.equal((await f.request('/files/remote-original/delete',{expectedSha256:'hash'})).status,200);assert.equal(removes,2);
 assert.equal((await f.request('/jobs/retry-old-original/retry',{})).status,409);
});

test('simultaneous deletion retries are idempotent even when both remote calls complete',async t=>{
 const started=deferred(),finish=deferred();let removes=0;const f=await fixture(t,{provider:'aliyun_oss',bucket:'test-bucket',async remove(){if(++removes===2)started.resolve();await finish.promise;}});f.seed('same-original',{provider:'aliyun_oss'});
 const requests=[f.request('/files/same-original/delete',{expectedSha256:'hash'}),f.request('/files/same-original/delete',{expectedSha256:'hash'})];await started.promise;finish.resolve();
 assert.deepEqual((await Promise.all(requests)).map(r=>r.status),[200,200]);assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,0);
});
