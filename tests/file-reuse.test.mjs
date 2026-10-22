import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {database} from '../backend/database.mjs';
import {createSession} from '../backend/auth.mjs';
import {createAPI} from '../backend/api.mjs';
import {createFileService} from '../backend/file-service.mjs';
import {createArtifactService} from '../backend/artifact-service.mjs';
import {createStorage} from '../backend/storage.mjs';

const MiB=1024*1024;
const settings={ossBucket:'test-bucket',ossEndpoint:'https://oss-cn-shanghai.aliyuncs.com',ossRegion:'cn-shanghai',ossPrefix:'paperknow/',ossAccessKeyId:'id',ossAccessKeySecret:'secret'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const rejected=(promise,status)=>assert.rejects(promise,error=>error.status===status);
function fixture(t,overrides={}){
 const db=database(':memory:'),objects=new Map(),calls={put:0,get:0,delete:0};
 for(const id of ['alice','bob'])db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());
 const client={async put(key,buffer){calls.put++;objects.set(key,Buffer.from(buffer));},async get(key){calls.get++;return {content:objects.get(key)};},async delete(key){calls.delete++;objects.delete(key);},...overrides};
 const storage=createStorage(settings,client),config={storage,requireRemoteStorage:true},artifacts=createArtifactService(db,config),files=createFileService(db,config);
 t.after(()=>db.close());
 const call=(service,path,input,user='alice')=>service({path,method:input===undefined?'GET':'POST',user:{id:user},readBody:async()=>input,query:new URLSearchParams()});
 const uploadOriginal=(name='材料.txt',content='研究资料')=>call(files,'/api/files',{name,data:Buffer.from(content).toString('base64'),expectedUserId:'alice'});
 const uploadArtifact=(input={})=>call(artifacts,'/api/artifacts',{name:'研究成果.txt',data:Buffer.from('研究成果正文').toString('base64'),sourceType:'writing',expectedUserId:'alice',...input});
 const reuse=(item,input={},user='alice',service=files)=>call(service,'/api/files/reuse',{sourceType:'artifact',sourceId:item.id,expectedSha256:item.sha256,expectedUserId:user,...input},user);
 return {db,objects,calls,client,storage,config,artifacts,files,call,uploadOriginal,uploadArtifact,reuse};
}

test('original reuse returns the owned source without upload or changing its project',async t=>{
 const f=fixture(t),uploaded=await f.uploadOriginal(),row=f.db.prepare('SELECT * FROM files WHERE id=?').get(uploaded.value.id),puts=f.calls.put;
 const res=await f.reuse(row,{sourceType:'original'});
 assert.equal(res.value.id,row.id);assert.equal(res.value.reused,true);assert.equal(res.value.sha256,row.sha256);assert.equal(f.calls.put,puts);
 assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,1);
 const noStorage=createFileService(f.db,{requireRemoteStorage:true});assert.equal((await f.reuse(row,{sourceType:'original'},'alice',noStorage)).value.id,row.id);
});

test('reuse requires an exact owner, source digest, supported fields and usable original',async t=>{
 const f=fixture(t),uploaded=await f.uploadOriginal(),row=f.db.prepare('SELECT * FROM files WHERE id=?').get(uploaded.value.id);
 await rejected(f.reuse(row,{sourceType:'original',expectedUserId:'bob'}),409);
 await rejected(f.reuse(row,{sourceType:'original'},'bob'),404);
 await rejected(f.reuse(row,{sourceType:'original',expectedSha256:'a'.repeat(64)}),409);
 for(const input of [{expectedSha256:'invalid'},{expectedUserId:undefined},{sourceId:'../other'},{sourceType:'remote'},{data:'not-accepted'},{projectId:'not-owned'}])await rejected(f.reuse(row,{sourceType:'original',...input}),input.projectId?404:400);
 const at=new Date().toISOString();f.db.prepare("INSERT INTO workspace_file_deletions VALUES(?,?,?,'pending',?,?)").run(row.id,'alice',row.sha256,at,at);
 await rejected(f.reuse(row,{sourceType:'original'}),409);assert.equal(f.calls.get,0);
});

test('artifact reuse copies on server into a separate original and repeated reuse is idempotent',async t=>{
 const f=fixture(t),artifact=(await f.uploadArtifact()).value.item,one=await f.reuse(artifact),two=await f.reuse(artifact);
 assert.equal(one.status,201);assert.equal(two.value.id,one.value.id);assert.equal(one.value.reused,true);assert.notEqual(one.value.id,artifact.id);
 assert.equal(f.calls.put,2);assert.equal(f.objects.size,2);assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,1);
 const original=f.db.prepare('SELECT * FROM files WHERE id=?').get(one.value.id),source=f.db.prepare('SELECT * FROM artifacts WHERE id=?').get(artifact.id);
 assert.equal(original.storage_key,`paperknow/users/alice/originals/${one.value.id}.txt`);assert.notEqual(original.storage_key,source.storage_key);assert.equal(original.body.length,0);assert.equal(original.sha256,source.sha256);
 await f.call(f.files,`/api/files/${original.id}/delete`,{expectedSha256:original.sha256});
 assert.equal(f.objects.has(source.storage_key),true);const downloadable=await f.call(f.artifacts,artifact.downloadUrl);assert.equal(downloadable.body.toString(),'研究成果正文');downloadable.release();
});

test('concurrent reuse by independent service instances coalesces one private copy',async t=>{
 const f=fixture(t),artifact=(await f.uploadArtifact()).value.item,started=deferred(),finish=deferred(),read=f.storage.readArtifact.bind(f.storage);let reads=0;
 f.storage.readArtifact=async row=>{reads++;started.resolve();await finish.promise;return read(row);};
 const first=f.reuse(artifact),secondService=createFileService(f.db,f.config);await started.promise;
 const second=f.reuse(artifact,{},'alice',secondService);finish.resolve();const results=await Promise.all([first,second]);
 assert.equal(results[0].value.id,results[1].value.id);assert.equal(reads,1);assert.equal(f.calls.put,2);assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_file_uploads').get().n,0);
});

test('cross-owner, pending, unpublished and oversize artifacts fail before storage read',async t=>{
 const f=fixture(t),artifact=(await f.uploadArtifact()).value.item,initialReads=f.calls.get;
 await rejected(f.reuse(artifact,{},'bob'),404);await rejected(f.reuse(artifact,{expectedSha256:'a'.repeat(64)}),409);
 for(const status of ['uploading','deleting','failed']){f.db.prepare('UPDATE artifacts SET status=? WHERE id=?').run(status,artifact.id);await rejected(f.reuse(artifact),409);}
 f.db.prepare("UPDATE artifacts SET status='ready',bytes=? WHERE id=?").run(2*MiB+1,artifact.id);await rejected(f.reuse(artifact),413);
 f.db.exec('CREATE TABLE tool_runs(id TEXT,user_id TEXT,operation TEXT,status TEXT)');
 f.db.prepare("INSERT INTO tool_runs VALUES('not-complete','alice','ppt','running')").run();
 f.db.prepare("UPDATE artifacts SET bytes=?,source_type='presentation',source_id='not-complete' WHERE id=?").run(artifact.bytes,artifact.id);await rejected(f.reuse(artifact),409);
 assert.equal(f.calls.get,initialReads);assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,0);
});

test('corrupt source bytes are rejected and deletion during an asynchronous copy cannot publish an original',async t=>{
 const f=fixture(t),artifact=(await f.uploadArtifact()).value.item,row=f.db.prepare('SELECT * FROM artifacts WHERE id=?').get(artifact.id),correct=f.objects.get(row.storage_key);
 f.objects.set(row.storage_key,Buffer.from('bad'));await rejected(f.reuse(artifact),503);assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,0);
 f.objects.set(row.storage_key,correct);const started=deferred(),finish=deferred(),put=f.client.put;
 f.client.put=async(key,buffer)=>{await put(key,buffer);if(key.includes('/originals/')){started.resolve();await finish.promise;}};
 const pending=f.reuse(artifact);await started.promise;f.db.prepare("UPDATE artifacts SET status='deleted' WHERE id=?").run(artifact.id);finish.resolve();await rejected(pending,404);
 assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_file_uploads').get().n,0);assert.equal([...f.objects.keys()].some(key=>key.includes('/originals/')),false);
});

test('artifact reuse obeys original quota, releases reservations and does not fall back to local storage',async t=>{
 const f=fixture(t),artifact=(await f.uploadArtifact()).value.item;
 f.db.prepare('INSERT INTO files(id,user_id,name,kind,bytes,sha256,body,created_at) VALUES(?,?,?,?,?,?,?,?)').run('full','alice','满额.txt','txt',50*MiB,'x'.repeat(64),Buffer.from('x'),new Date().toISOString());
 await rejected(f.reuse(artifact),409);assert.equal(f.calls.put,1);assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_file_uploads').get().n,0);
 const noStorage=createFileService(f.db,{requireRemoteStorage:true});await rejected(f.reuse(artifact,{},'alice',noStorage),503);
});

test('reusing an existing original preserves its project while artifact copies remain scoped to the selected project',async t=>{
 const f=fixture(t),at=new Date().toISOString();for(const id of ['source-project','task-project'])f.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run(id,'alice',id,'本科','专业',at,at);
 const original=(await f.uploadOriginal()).value;f.db.prepare('UPDATE files SET project_id=? WHERE id=?').run('source-project',original.id);
 const row=f.db.prepare('SELECT * FROM files WHERE id=?').get(original.id);assert.equal((await f.reuse(row,{sourceType:'original',projectId:'task-project'})).value.id,row.id);
 assert.equal(f.db.prepare('SELECT project_id FROM files WHERE id=?').get(row.id).project_id,'source-project');
 const artifact=(await f.uploadArtifact()).value.item,one=await f.reuse(artifact,{projectId:'task-project'}),two=await f.reuse(artifact,{projectId:'task-project'});
 assert.equal(one.value.id,two.value.id);assert.equal(f.db.prepare('SELECT project_id FROM files WHERE id=?').get(one.value.id).project_id,'task-project');
});

test('HTTP reuse adapter requires login and same-origin and cannot act on another session owner',async t=>{
 const f=fixture(t),artifact=(await f.uploadArtifact()).value.item,api=createAPI(f.db,{cancel(){}},{...f.config,getAI:()=>({enabled:false})}),server=http.createServer((req,res)=>void api(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port,cookies={alice:'pk_session='+createSession(f.db,'alice'),bob:'pk_session='+createSession(f.db,'bob')},payload={sourceType:'artifact',sourceId:artifact.id,expectedSha256:artifact.sha256,expectedUserId:'alice'};
 const request=async({cookie=cookies.alice,origin=base,owner='alice'}={})=>fetch(base+'/api/files/reuse',{method:'POST',headers:{...(cookie?{Cookie:cookie}:{}),Origin:origin,'Content-Type':'application/json','X-PaperKnow-User':owner},body:JSON.stringify(payload)});
 assert.equal((await request({cookie:null})).status,401);assert.equal((await request({origin:'https://foreign.invalid'})).status,403);
 assert.equal((await request({cookie:cookies.bob})).status,409);const good=await request();assert.equal(good.status,201);const saved=await good.json();assert.equal(typeof saved.id,'string');assert.equal(saved.reused,true);
 assert.equal((await request()).status,200);assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,1);
});
