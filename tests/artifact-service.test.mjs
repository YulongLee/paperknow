import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../backend/database.mjs';
import {digest} from '../backend/auth.mjs';
import {createArtifactService} from '../backend/artifact-service.mjs';
import {createStorage} from '../backend/storage.mjs';
import {Readable} from 'node:stream';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const settings={ossBucket:'test-bucket',ossEndpoint:'https://oss-cn-shanghai.aliyuncs.com',ossRegion:'cn-shanghai',ossPrefix:'paperknow/',ossAccessKeyId:'id',ossAccessKeySecret:'secret'};
function fixture(t,config={},clientChanges={}){
 const db=database(':memory:'),objects=new Map(),calls={put:0,get:0,delete:0};
 for(const id of ['alice','bob'])db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());
 const client={async put(key,buffer){calls.put++;objects.set(key,Buffer.from(buffer));},async get(key){calls.get++;return {content:objects.get(key)};},async delete(key){calls.delete++;objects.delete(key);},...clientChanges};
 const storage=createStorage(settings,client),handle=createArtifactService(db,{storage,...config});
 t.after(()=>db.close());
 const request=(path='/api/artifacts',input,user='alice',query={})=>handle({path,method:input===undefined?'GET':'POST',user:user?{id:user}:null,query:new URLSearchParams(query),readBody:async()=>input});
 const upload=(input={},user)=>request('/api/artifacts',{name:'研究成果.txt',data:Buffer.from('research output').toString('base64'),sourceType:'writing',...input},user);
 return {db,objects,client,calls,storage,handle,request,upload};
}
const rejected=(promise,status)=>assert.rejects(promise,error=>error.status===status);

test('exports store bytes only in private OSS, preserve metadata and enforce owner-only attachment downloads',async t=>{
 const f=fixture(t),response=await f.upload(),item=response.value.item;
 assert.equal(response.status,201);assert.equal(item.status,'ready');assert.equal(item.bytes,15);
 const row=f.db.prepare('SELECT * FROM artifacts WHERE id=?').get(item.id);
 assert.equal(row.storage_key,`paperknow/users/alice/exports/${item.id}.txt`);assert.equal(row.sha256,digest(Buffer.from('research output')));
 assert.equal(Object.keys(row).some(k=>['body','data','content'].includes(k)),false);assert.equal(f.objects.size,1);
 const read=await f.request(item.downloadUrl);assert.equal(read.body.toString(),'research output');assert.match(read.headers['Content-Disposition'],/^attachment;/);assert.equal(read.headers['X-Content-Type-Options'],'nosniff');assert.match(read.headers['Content-Security-Policy'],/sandbox/);
 read.release();
 await rejected(f.request(item.downloadUrl,undefined,'bob'),404);await rejected(f.request('/api/artifacts',undefined,null),401);
 assert.equal((await f.request('/api/artifacts',undefined,'bob')).value.items.length,0);
});

test('same owner/content/kind is idempotent while another user has a separate private object',async t=>{
 const f=fixture(t),first=await f.upload(),second=await f.upload({name:'重新导出.txt'});
 assert.equal(second.value.item.id,first.value.item.id);assert.equal(second.value.deduplicated,true);assert.equal(f.calls.put,1);
 const other=await f.upload({},'bob');assert.notEqual(other.value.item.id,first.value.item.id);assert.equal(f.calls.put,2);
 assert.equal((await f.request('/api/artifacts')).value.usage.bytes,15);
});

test('unconfigured storage fails closed without a local binary or successful artifact record',async t=>{
 const f=fixture(t,{storage:null});await rejected(f.upload(),503);
 assert.equal(f.db.prepare('SELECT count(*) n FROM artifacts').get().n,0);
 const list=(await f.request('/api/artifacts')).value;assert.equal(list.storage.ready,false);assert.equal(list.items.length,0);
});

test('file inputs are bounded and canonical; names, kinds, signatures and hashes are checked before OSS',async t=>{
 const f=fixture(t,{artifactLimits:{maxFileBytes:32}});
 for(const input of [{name:'../a.txt'},{name:'x\r\ny.txt'},{name:'x.exe'},{name:'x.pdf'},{name:'x.pptx'},{name:'x.png'},{name:'x.jpg'},{data:'AB=='},{data:'a==='},{sha256:'0'.repeat(64)},{sourceType:'system'},{sourceId:'a\n'}])await rejected(f.upload(input),400);
 await rejected(f.upload({data:Buffer.alloc(33).toString('base64')}),413);assert.equal(f.calls.put,0);
 const pdf=await f.upload({name:'论文.pdf',data:Buffer.from('%PDF-example').toString('base64')});assert.equal(pdf.status,201);
});

test('HTML and SVG exports can only be downloaded as sandboxed attachments',async t=>{
 const f=fixture(t),r=await f.upload({name:'报告.html',data:Buffer.from('<script>alert(1)</script>').toString('base64')});
 const read=await f.request(r.value.item.downloadUrl);assert.equal(read.headers['Content-Type'],'application/octet-stream');assert.match(read.headers['Content-Disposition'],/^attachment/);
 read.release();
});

test('cross-window account changes are rejected and project ownership is verified',async t=>{
 const f=fixture(t);f.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run('bob-project','bob','项目','本科','专业',new Date().toISOString(),new Date().toISOString());
 await rejected(f.upload({expectedUserId:'bob'}),409);await rejected(f.upload({projectId:'bob-project'}),404);assert.equal(f.calls.put,0);
 const item=(await f.upload({expectedUserId:'alice'})).value.item;
 await rejected(f.request(item.downloadUrl,undefined,'bob',{expectedUserId:'alice'}),409);
 await rejected(f.request('/api/artifacts/'+item.id+'/delete',{expectedSha256:item.sha256,expectedUserId:'bob'}),409);
});

test('account quota is reserved before OSS I/O and simultaneous uploads cannot oversubscribe',async t=>{
 const start=deferred(),finish=deferred(),f=fixture(t,{artifactLimits:{maxAccountBytes:20}},{async put(key,buffer){start.resolve();await finish.promise;f.objects.set(key,Buffer.from(buffer));}});
 const first=f.upload();await start.promise;
 try{await rejected(f.upload({data:Buffer.from('different output').toString('base64')}),409);assert.equal(f.db.prepare("SELECT sum(bytes) n FROM artifacts WHERE status='uploading'").get().n,15);}finally{finish.resolve();}
 assert.equal((await first).status,201);
});

test('upload admission allows only two in-flight bodies and releases slots when body parsing fails',async t=>{
 const f=fixture(t),finish=deferred();let bodies=0;
 const input={name:'a.txt',data:Buffer.from('a').toString('base64')};
 const run=()=>f.handle({path:'/api/artifacts',method:'POST',user:{id:'alice'},readBody:async()=>{bodies++;await finish.promise;throw Object.assign(new Error('invalid'),{status:400});}});
 const first=run(),second=run();await rejected(run(),429);assert.equal(bodies,2);finish.resolve();await rejected(first,400);await rejected(second,400);
 assert.equal((await f.upload(input)).status,201);
});

test('ambiguous upload failure is compensated; failed compensation remains visible and retryable',async t=>{
 let deletesFail=true;const f=fixture(t,{}, {async put(){throw new Error('secret-provider-trace');},async delete(){if(deletesFail)throw new Error('secret-delete-trace');}});
 await rejected(f.upload(),503);const list=(await f.request('/api/artifacts')).value;
 assert.equal(list.items.length,1);assert.equal(list.items[0].status,'failed');assert.equal(list.items[0].downloadUrl,null);
 const row=f.db.prepare('SELECT * FROM artifacts').get();assert.equal(row.last_error,'成果保存待重试');assert.equal(JSON.stringify(list).includes('secret'),false);
 deletesFail=false;assert.equal((await f.request(`/api/artifacts/${row.id}/delete`,{expectedSha256:row.sha256})).value.deleted,true);
 assert.equal((await f.request('/api/artifacts')).value.items.length,0);
});

test('compensation keeps its upload lease so a retry cannot race with object deletion',async t=>{
 const cleanup=deferred(),finish=deferred(),f=fixture(t,{}, {async put(){throw new Error('ambiguous');},async delete(){cleanup.resolve();await finish.promise;}});
 const first=f.upload();await cleanup.promise;try{await rejected(f.upload(),409);}finally{finish.resolve();}
 await rejected(first,503);assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE status!='deleted'").get().n,0);
});

test('failed metadata finalization removes uploaded bytes rather than claiming success',async t=>{
 const f=fixture(t);f.db.exec("CREATE TRIGGER reject_artifact_ready BEFORE UPDATE ON artifacts WHEN NEW.status='ready' BEGIN SELECT RAISE(ABORT,'test-write-failure'); END");
 await rejected(f.upload(),503);assert.equal(f.objects.size,0);assert.equal(f.db.prepare('SELECT status FROM artifacts').get().status,'deleted');
});

test('deletion requires content confirmation, preserves failed cleanup, and is idempotent after completion',async t=>{
 const f=fixture(t),item=(await f.upload()).value.item,path=`/api/artifacts/${item.id}/delete`;let failDelete=true;
 f.client.delete=async key=>{if(failDelete)throw new Error('private detail');f.objects.delete(key);};
 await rejected(f.request(path,{expectedSha256:'0'.repeat(64)}),409);await rejected(f.request(path,{expectedSha256:item.sha256},'bob'),404);
 await rejected(f.request(path,{expectedSha256:item.sha256}),503);assert.equal((await f.request('/api/artifacts')).value.items[0].status,'deleting');await rejected(f.request(item.downloadUrl),409);
 failDelete=false;assert.equal((await f.request(path,{expectedSha256:item.sha256})).value.deleted,true);assert.equal((await f.request(path,{expectedSha256:item.sha256})).value.deleted,true);
 await rejected(f.request(item.downloadUrl),404);assert.equal((await f.request('/api/artifacts')).value.usage.bytes,0);
});

test('corrupt or mismatched OSS content is never delivered',async t=>{
 const f=fixture(t),item=(await f.upload()).value.item,key=f.db.prepare('SELECT storage_key FROM artifacts').get().storage_key;
 f.objects.set(key,Buffer.from('changed output!'));await rejected(f.request(item.downloadUrl),503);
});

test('download admission bounds simultaneous object reads and retains slots until HTTP consumption completes',async t=>{
 const f=fixture(t),item=(await f.upload()).value.item,finish=deferred(),started=deferred();let reads=0;
 f.client.get=async key=>{if(++reads===2)started.resolve();await finish.promise;return {content:f.objects.get(key)};};
 const first=f.request(item.downloadUrl),second=f.request(item.downloadUrl);await started.promise;try{await rejected(f.request(item.downloadUrl),429);assert.equal(reads,2);}finally{finish.resolve();}
 const firstResponse=await first,secondResponse=await second;assert.equal(firstResponse.body.length,15);assert.equal(secondResponse.body.length,15);
 // Both reads finished, but slow HTTP consumers still retain the two Buffers.
 await rejected(f.request(item.downloadUrl),429);assert.equal(reads,2);
 firstResponse.release();firstResponse.release();const thirdResponse=await f.request(item.downloadUrl);assert.equal(thirdResponse.body.length,15);
 // Duplicate finish/close events may release the same response only once.
 await rejected(f.request(item.downloadUrl),429);secondResponse.release();thirdResponse.release();
 const finalResponse=await f.request(item.downloadUrl);assert.equal(finalResponse.body.length,15);finalResponse.release();
});

test('failed reads release their admission slot immediately without an HTTP response',async t=>{
 const f=fixture(t),item=(await f.upload()).value.item;let unavailable=true;
 f.client.get=async key=>{if(unavailable)throw new Error('unavailable');return {content:f.objects.get(key)};};
 for(let i=0;i<4;i++)await rejected(f.request(item.downloadUrl),503);
 unavailable=false;const response=await f.request(item.downloadUrl);assert.equal(response.body.length,15);response.release();
});

test('pagination is stable, supports numbered library pages, and treats wildcard search literally',async t=>{
 let tick=0;const f=fixture(t,{artifactNow:()=>Date.UTC(2026,0,1,0,0,tick++)});
 for(const [name,data,type] of [['a%_one.txt','one','writing'],['b_two.txt','two','research'],['c_three.txt','three','research']])await f.upload({name,data:Buffer.from(data).toString('base64'),sourceType:type});
 const first=(await f.request('/api/artifacts',undefined,'alice',{limit:'2'})).value,next=(await f.request('/api/artifacts',undefined,'alice',{limit:'2',cursor:first.nextCursor})).value;
 assert.equal(first.items.length,2);assert.equal(next.items.length,1);assert.equal(new Set([...first.items,...next.items].map(i=>i.id)).size,3);
 const page=(await f.request('/api/artifacts',undefined,'alice',{page:'2',pageSize:'1'})).value;assert.equal(page.total,3);assert.equal(page.page,2);assert.equal(page.items.length,1);assert.equal(page.storage.ready,true);assert.equal(page.items[0].created_at,page.items[0].createdAt);
 assert.equal((await f.request('/api/artifacts',undefined,'alice',{q:'%_'})).value.total,1);
 assert.equal((await f.request('/api/artifacts',undefined,'alice',{sourceType:'research'})).value.items.length,2);
 for(const query of [{limit:'101'},{page:'0'},{pageSize:'51'},{cursor:'invalid'},{q:'x'.repeat(121)}])await rejected(f.request('/api/artifacts',undefined,'alice',query),400);
});

test('an expired upload can resume but its older lease must not erase the newer ready object',async t=>{
 let now=Date.UTC(2026,0,1),puts=0;const oldFinish=deferred(),started=deferred(),f=fixture(t,{artifactNow:()=>now},{async put(key,buffer){if(++puts===1){started.resolve();await oldFinish.promise;}f.objects.set(key,Buffer.from(buffer));}});
 const first=f.upload();await started.promise;now+=180000;const second=await f.upload();assert.equal(second.status,201);oldFinish.resolve();await rejected(first,409);
 assert.equal(f.objects.size,1);const read=await f.request(second.value.item.downloadUrl);assert.equal(read.body.toString(),'research output');read.release();
});

test('storage validates exact project/user/object keys before read and removal',async()=>{
 let calls=0;const store=createStorage(settings,{async get(){calls++;},async delete(){calls++;}}),row={id:'a',user_id:'alice',kind:'txt',bytes:1,sha256:digest(Buffer.from('a')),storage_bucket:'test-bucket',storage_key:'paperknow/users/alice/exports/a.txt'};
 for(const change of [{id:'b'},{user_id:'bob'},{kind:'../txt'},{storage_key:row.storage_key+'/other'},{storage_bucket:'foreign'}]){await assert.rejects(store.readArtifact({...row,...change}),/不匹配/);await assert.rejects(store.removeArtifact({...row,...change}),/不匹配/);}
 await assert.rejects(store.putArtifact('a','../alice','txt',Buffer.from('a'),row.sha256),/不匹配/);assert.equal(calls,0);
});

test('OSS stream reads stop at the recorded byte bound instead of buffering a larger object',async()=>{
 const streams=[],row={id:'a',user_id:'alice',kind:'txt',bytes:1,sha256:digest(Buffer.from('a')),storage_bucket:'test-bucket',storage_key:'paperknow/users/alice/exports/a.txt'};
 let oversized=false;const store=createStorage(settings,{async getStream(){const stream=Readable.from(oversized?[Buffer.from('a'),Buffer.alloc(1024)]:[Buffer.from('a')]);streams.push(stream);return {stream};}});
 assert.equal((await store.readArtifact(row)).toString(),'a');oversized=true;await assert.rejects(store.readArtifact(row),/读取失败/);assert.equal(streams[1].destroyed,true);
 await assert.rejects(store.readArtifact({...row,bytes:21*1024*1024}),/完整性/);assert.equal(streams.length,2);
});

test('health probes use a separate private project key, verify readback and clean up without leaking details',async()=>{
 const objects=new Map(),keys=[];let broken=false;const store=createStorage(settings,{async put(key,buffer,options){assert.equal(options.headers['x-oss-object-acl'],'private');keys.push(key);objects.set(key,buffer);if(broken)throw new Error('secret-access-key');},async get(key){return {content:objects.get(key)};},async delete(key){objects.delete(key);}});
 assert.equal(store.healthStatus().ok,null);const success=await store.health();assert.equal(success.ok,true);assert.ok(success.lastSuccessAt);assert.equal(objects.size,0);assert.match(keys[0],/^paperknow\/_health\/[a-f0-9-]+\.txt$/);
 broken=true;const failed=await store.health();assert.equal(failed.ok,false);assert.equal(failed.lastSuccessAt,success.lastSuccessAt);assert.equal(JSON.stringify(failed).includes('secret'),false);assert.equal(objects.size,0);
});
