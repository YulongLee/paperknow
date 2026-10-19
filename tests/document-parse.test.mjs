import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {createServer} from '../server.mjs';
import {createSession,digest} from '../backend/auth.mjs';
import {startDocumentParseWorker} from '../backend/document-parse-worker.mjs';
import {compute} from '../backend/compute.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const parsed=()=>({text:'合成资料：共有24项服务，其中6项支持远程使用。',markdown:'# 合成资料\n\n共有24项服务，其中6项支持远程使用。',pageCount:2,pages:[{pageIndex:0,text:'合成资料：共有24项服务。'},{pageIndex:1,text:'其中6项支持远程使用。'}],layout:{pdf_info:[{page_idx:0},{page_idx:1}]},contentList:[],rawZip:Buffer.from('PKsynthetic-test-archive')});
async function fixture(t,overrides={}){
 const objects=new Map(),calls={create:0,upload:0,poll:0,download:0,put:0,remove:0},pdf=await PDFDocument.create();pdf.addPage();pdf.addPage();const source=Buffer.from(await pdf.save());
 const cloud={async createUpload({dataId}){calls.create++;return{batchId:'batch-'+dataId,uploadURL:'test-upload'};},async upload(_url,_bytes,signal){calls.upload++;if(signal.aborted)throw Error('aborted');},async poll(batch,_signal,{dataId}={}){calls.poll++;assert.equal(batch,'batch-'+dataId);return{state:'done',progress:{extractedPages:2,totalPages:2},zipURL:'test-zip'};},async downloadResult(){calls.download++;return parsed();},...overrides.client};
 const oss={async put(key,buffer,options){calls.put++;assert.equal(options.headers['x-oss-object-acl'],'private');objects.set(key,Buffer.from(buffer));},async get(key){if(!objects.has(key))throw Error('missing');return{content:Buffer.from(objects.get(key))};},async delete(key){calls.remove++;objects.delete(key);},...overrides.oss};
 const config={mineruEnabled:true,mineruToken:'unit-only-mineru-token',documentParseClient:cloud,documentParseTickMs:60000,documentParsePollDelayMs:0,documentPageCount:async()=>2,ossClient:oss,ossBucket:'unit-test',ossEndpoint:'https://oss-cn-shanghai.aliyuncs.com',ossRegion:'cn-shanghai',ossPrefix:'paperknow/',ossAccessKeyId:'unit-id',ossAccessKeySecret:'unit-secret',...overrides.config};
 const app=createServer({dbPath:':memory:',config});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
 const users={};for(const id of ['alice','bob']){app.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());users[id]={id,cookie:'pk_session='+createSession(app.db,id)};}
 t.after(()=>app.close());
 async function request(path,input,user=users.alice){const r=await fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',headers:{...(user?{Cookie:user.cookie}:{}),...(input===undefined?{}:{Origin:base,'Content-Type':'application/json'})},body:input===undefined?undefined:JSON.stringify(input)});return{status:r.status,value:await r.json()};}
 const upload=async(buffer=source)=>{const r=await request('/files',{name:'合成测试.pdf',data:buffer.toString('base64')});assert.equal(r.status,201);return r.value.id;};
 const submit=(fileId,extra={},user=users.alice)=>request('/document-parses',{fileId,expectedUserId:user.id,idempotencyKey:crypto.randomUUID(),consent:true,...extra},user);
 const job=id=>app.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
 return{...app,config,cloud,users,source,objects,calls,request,upload,submit,job,tick:()=>app.worker.tick()};
}

test('cloud PDF admission requires authentication, explicit consent, account match, and an owned private original',async t=>{
 const f=await fixture(t),file=await f.upload();
 assert.equal((await f.request('/document-parses',{},null)).status,401);
 assert.equal((await f.submit(file,{},f.users.bob)).status,404);
 assert.equal((await f.submit(file,{consent:false})).status,400);
 assert.equal((await f.submit(file,{expectedUserId:'bob'})).status,409);
 assert.equal((await f.submit(file,{url:'http://127.0.0.1'})).status,400);
 assert.equal(f.calls.create,0);
 assert.equal((await f.request('/files',{name:'other.pdf',data:f.source.toString('base64'),expectedUserId:'bob'})).status,409);
 assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,1);
 const cap=(await f.request('/capabilities',undefined,null)).value.documentParsing;assert.equal(cap.ready,true);assert.equal(cap.maxFileBytes,20*1024*1024);assert.equal(cap.maxPages,100);
 assert.doesNotMatch(JSON.stringify(cap),/unit-only-mineru-token|mineru.net/);
 f.db.prepare("UPDATE files SET storage_provider='local_server_sqlite' WHERE id=?").run(file);assert.equal((await f.submit(file)).status,409);
});

test('invalid enabled MinerU configuration keeps the server available and rejects new parsing before provider work',async t=>{
 for(const [name,config]of [['blank token',{mineruToken:' '.repeat(20)}],['unsupported base URL',{mineruBaseURL:'https://invalid.example/api/v4'}]])await t.test(name,async t=>{
  const f=await fixture(t,{config:{...config,documentParseClient:undefined}}),file=await f.upload();
  const capabilities=await f.request('/capabilities',undefined,null);assert.equal(capabilities.status,200);assert.equal(capabilities.value.documentParsing.ready,false);assert.match(capabilities.value.documentParsing.reason,/暂未开放/);
  assert.doesNotMatch(JSON.stringify(capabilities.value.documentParsing),/invalid\.example|mineru_configuration/);
  const denied=await f.submit(file);assert.equal(denied.status,503);assert.equal(f.db.prepare('SELECT count(*) n FROM document_parse_runs').get().n,0);
  await f.tick();assert.deepEqual({create:f.calls.create,upload:f.calls.upload,poll:f.calls.poll,download:f.calls.download},{create:0,upload:0,poll:0,download:0});
  assert.equal((await f.request('/files')).value.items.length,1);
 });
});

test('idempotent creation and concurrent deduplication create one task and block deleting an active original',async t=>{
 const f=await fixture(t),file=await f.upload(),key=crypto.randomUUID();
 const one=await f.submit(file,{idempotencyKey:key}),same=await f.submit(file,{idempotencyKey:key}),active=await f.submit(file);
 assert.equal(one.status,201);assert.equal(same.status,200);assert.equal(same.value.id,one.value.id);assert.equal(active.value.id,one.value.id);
 const other=await f.upload();assert.equal((await f.submit(other,{idempotencyKey:key})).status,409);
 assert.equal((await f.request('/files/'+file+'/delete',{expectedSha256:digest(f.source)})).status,409);
 assert.equal((await f.request('/document-parses/'+one.value.id,undefined,f.users.bob)).status,404);
 assert.equal((await f.request('/jobs/'+one.value.id+'/retry',{})).status,409);
 assert.equal(f.db.prepare('SELECT count(*) n FROM document_parse_runs').get().n,1);
});

test('a two-page cloud job stores all final files in private OSS, keeps only indexes in SQLite, and loads owner text',async t=>{
 const f=await fixture(t),file=await f.upload(),id=(await f.submit(file)).value.id;
 await f.tick();assert.equal(f.job(id).status,'running');assert.equal(f.calls.create,1);assert.equal(f.calls.upload,1);
 await f.tick();assert.equal(f.job(id).status,'completed');assert.equal(f.calls.poll,1);assert.equal(f.calls.download,1);
 const r=await f.request('/document-parses/'+id);assert.equal(r.status,200);assert.equal(r.value.result.text,parsed().text);assert.equal(r.value.result.pages,2);assert.equal(r.value.result.artifacts.length,3);
 const result=f.db.prepare('SELECT * FROM results WHERE job_id=?').get(id);assert.equal(result.type,'document_parse');assert.doesNotMatch(result.body,/共有24项|pdf_info/);assert.equal(JSON.parse(result.body).documentParseId,id);
 assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE status='ready'").get().n,3);assert.equal(f.objects.size,4);assert.equal(f.db.prepare('SELECT length(body) n FROM files WHERE id=?').get(file).n,0);
 assert.equal((await f.request('/document-parses/'+id,undefined,f.users.bob)).status,404);
 const original=await f.request('/files/'+file+'/delete',{expectedSha256:digest(f.source)});assert.equal(original.status,200);assert.equal((await f.request('/document-parses/'+id)).value.result.text,parsed().text);
 assert.equal(f.db.prepare('SELECT count(*) n FROM usage').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);
});

test('source page and integrity limits fail before any provider submission',async t=>{
 const f=await fixture(t,{config:{documentPageCount:async()=>101}}),file=await f.upload(),id=(await f.submit(file)).value.id;
 await f.tick();assert.equal(f.job(id).status,'failed');assert.match(f.job(id).error,/100页/);assert.equal(f.calls.create,0);
 f.config.documentPageCount=async()=>2;
 const next=(await f.submit(file)).value.id;const row=f.db.prepare('SELECT * FROM files WHERE id=?').get(file);f.objects.set(row.storage_key,Buffer.from('%PDF-corrupted'));
 await f.tick();assert.equal(f.job(next).status,'failed');assert.equal(f.calls.create,0);
});

test('PDF originals above the old 2MB cap can upload, while non-PDF and account limits remain bounded',async t=>{
 const f=await fixture(t),buffer=Buffer.alloc(3*1024*1024,32);buffer.write('%PDF-');const id=await f.upload(buffer);assert.equal(f.db.prepare('SELECT bytes FROM files WHERE id=?').get(id).bytes,buffer.length);
 const txt=await f.request('/files',{name:'large.txt',data:Buffer.alloc(3*1024*1024,97).toString('base64')});assert.equal(txt.status,413);
});

test('a submission with unknown outcome never automatically creates another remote batch',async t=>{
 const f=await fixture(t,{client:{async createUpload(){throw new Error('provider token and secret URL must never leak');}}}),file=await f.upload(),id=(await f.submit(file)).value.id;
 await f.tick();assert.equal(f.job(id).status,'failed');assert.doesNotMatch(f.job(id).error,/secret|token/);await f.tick();assert.equal(f.calls.upload,0);
 assert.equal((await f.request('/jobs/'+id+'/retry',{})).status,409);
 assert.equal(f.db.prepare('SELECT provider_state FROM document_parse_runs WHERE id=?').get(id).provider_state,'requesting_upload');
});

test('restart resumes a known uploaded batch without replaying a create or upload request',async t=>{
 const f=await fixture(t),file=await f.upload(),id=(await f.submit(file)).value.id;await f.tick();await f.worker.stop();
 const resumed=startDocumentParseWorker(f.db,{...f.config,storage:f.config.storage||{}});await resumed.stop();
 // Use the app-created private storage object through a fresh local seam.
 const storage={provider:'aliyun_oss',bucket:'unit-test',prefix:'paperknow/',async readArtifact(row){return f.objects.get(row.storage_key);},async removeArtifact(row){f.objects.delete(row.storage_key);},async putArtifact(id,user,kind,buffer){const key=`paperknow/users/${user}/exports/${id}.${kind}`;f.objects.set(key,Buffer.from(buffer));return key;},async read(row){return f.objects.get(row.storage_key);}};
 const worker=startDocumentParseWorker(f.db,{...f.config,storage});t.after(()=>worker.stop());await worker.tick();assert.equal(f.job(id).status,'completed');assert.equal(f.calls.create,1);assert.equal(f.calls.upload,1);
});

test('restart fails an unknown acknowledged-submit boundary without exposing details or replaying paid requests',async t=>{
 const f=await fixture(t),file=await f.upload(),id=(await f.submit(file)).value.id;await f.worker.stop();f.db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(id);f.db.prepare("UPDATE document_parse_runs SET provider_state='requesting_upload' WHERE id=?").run(id);
 const worker=startDocumentParseWorker(f.db,f.config);t.after(()=>worker.stop());assert.equal(f.job(id).status,'failed');assert.equal(f.job(id).stage,'submission_unconfirmed');assert.match(f.job(id).error,/未自动重复/);await worker.tick();assert.equal(f.calls.create,0);
});

test('cancelling during provider upload prevents a completed result and preserves the private original',async t=>{
 const begun=deferred();const f=await fixture(t,{client:{async upload(_url,_source,signal){begun.resolve();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));}}}),file=await f.upload(),id=(await f.submit(file)).value.id;
 const work=f.tick();await begun.promise;assert.equal((await f.request('/document-parses/'+id+'/cancel',{})).status,200);await work;
 assert.equal(f.job(id).status,'cancelled');assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,1);assert.equal(f.calls.poll,0);
});

test('missing last pages are never silently marked complete and failure never stores a server blob',async t=>{
 const f=await fixture(t,{client:{async downloadResult(){const p=parsed();return{...p,pageCount:1,pages:p.pages.slice(0,1)};}}}),file=await f.upload(),id=(await f.submit(file)).value.id;await f.tick();await f.tick();assert.equal(f.job(id).status,'failed');assert.match(f.job(id).error,/页数不完整/);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM artifacts').get().n,0);
});

test('daily parsing admission is bounded even when the user cancels before provider work',async t=>{
 const f=await fixture(t),file=await f.upload();for(let i=0;i<10;i++){const created=await f.submit(file);assert.equal(created.status,201);assert.equal((await f.request('/document-parses/'+created.value.id+'/cancel',{})).status,200);}
 const denied=await f.submit(file);assert.equal(denied.status,429);assert.match(denied.value.error,/今日/);assert.equal(f.calls.create,0);
});

test('the bounded metadata worker reads real page counts and rejects corrupt PDFs independently of cloud calls',async()=>{
 const pdf=await PDFDocument.create();pdf.addPage();pdf.addPage();const bytes=Buffer.from(await pdf.save()),signal=new AbortController().signal;assert.deepEqual(await compute('pdfMetadata',{body:bytes},signal),{pages:2});await assert.rejects(()=>compute('pdfMetadata',{body:Buffer.from('%PDF-invalid')},signal));
});


test('transient read-only provider failures retain the same acknowledged batch and recover without another submission',async t=>{
 let fail=true;const f=await fixture(t,{client:{async poll(){if(fail){fail=false;throw Object.assign(Error('temporary'),{mineruSafe:true,code:'mineru_rate_limited'});}return{state:'done',progress:{extractedPages:2,totalPages:2},zipURL:'test-zip'};}}}),file=await f.upload(),id=(await f.submit(file)).value.id;
 await f.tick();await f.tick();assert.equal(f.job(id).status,'running');assert.equal(f.job(id).stage,'reconnecting');assert.equal(f.calls.create,1);f.db.prepare('UPDATE document_parse_runs SET next_poll_at=NULL WHERE id=?').run(id);await f.tick();assert.equal(f.job(id).status,'completed');assert.equal(f.calls.create,1);assert.equal(f.calls.upload,1);
});

test('cancellation during an OSS write removes only new outputs and preserves an existing deduplicated artifact',async t=>{
 const begun=deferred(),resume=deferred();let stored=new Map();
 const f=await fixture(t,{oss:{async put(key,buffer){stored.set(key,Buffer.from(buffer));if(key.includes('/exports/')&&key.endsWith('.json')){begun.resolve();await resume.promise;}},async get(key){return{content:stored.get(key)};},async delete(key){stored.delete(key);}}});
 const prior=await f.request('/artifacts',{name:'existing.md',data:Buffer.from(parsed().markdown).toString('base64'),sourceType:'other',expectedUserId:'alice'});assert.equal(prior.status,201);const existing=prior.value.item.id;
 const file=await f.upload(),id=(await f.submit(file)).value.id;await f.tick();const work=f.tick();await begun.promise;await f.request('/document-parses/'+id+'/cancel',{});resume.resolve();await work;
 assert.equal(f.job(id).status,'cancelled');assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.db.prepare('SELECT status FROM artifacts WHERE id=?').get(existing).status,'ready');assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE status='ready'").get().n,1);assert.equal(stored.size,2);
});

test('OSS failure never marks parsing complete and compensates previous newly saved outputs',async t=>{
 const stored=new Map();const f=await fixture(t,{oss:{async put(key,buffer){if(key.endsWith('.json'))throw Error('private-cloud-error');stored.set(key,Buffer.from(buffer));},async get(key){return{content:stored.get(key)};},async delete(key){stored.delete(key);}}});
 const file=await f.upload(),id=(await f.submit(file)).value.id;await f.tick();await f.tick();assert.equal(f.job(id).status,'failed');assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE status='ready'").get().n,0);assert.equal(stored.size,1);assert.doesNotMatch(f.job(id).error,/private-cloud/);
});
