import {planV1Commerce,applyV1Commerce} from '../backend/v1-commercial-launch.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import JSZip from 'jszip';
import {database} from '../backend/database.mjs';
import {digest} from '../backend/auth.mjs';
import {createArtifactService} from '../backend/artifact-service.mjs';
import {createDocumentTranslationService,documentTranslationCapabilities} from '../backend/document-translation-service.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {startDocumentTranslationWorker} from '../backend/document-translation-worker.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const rejected=(promise,status)=>assert.rejects(promise,error=>error.status===status);
async function docx(text='Synthetic translated document.'){const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');zip.file('word/document.xml','<w:document><w:body><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>');return zip.generateAsync({type:'nodebuffer'});}
async function fixture(t,overrides={}){
 const db=database(':memory:'),objects=new Map(),calls={create:0,poll:0,download:0,sign:0,put:0,delete:0},pdf=await PDFDocument.create();pdf.addPage();pdf.addPage();const source=Buffer.from(await pdf.save()),translated=await docx();
 for(const id of ['alice','bob'])db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());
 const storage={provider:'aliyun_oss',bucket:'unit-bucket',prefix:'paperknow/',async read(file){return Buffer.from(objects.get(file.storage_key));},async signedOriginalURL(file,seconds){calls.sign++;assert.equal(seconds,600);return'https://unit-bucket.oss-cn-hangzhou.aliyuncs.com/'+file.storage_key+'?Signature=private';},async putArtifact(id,user,kind,buffer){calls.put++;const key=`paperknow/users/${user}/exports/${id}.${kind}`;objects.set(key,Buffer.from(buffer));return key;},async readArtifact(file){return Buffer.from(objects.get(file.storage_key));},async removeArtifact(file){calls.delete++;objects.delete(file.storage_key);},...overrides.storage};
 const client={async create(input){calls.create++;assert.equal(input.sourceLanguage,'en');assert.equal(input.targetLanguage,'zh');assert.match(input.fileURL,/Signature=private/);return{taskId:'remote-'+input.clientToken,state:'ready'};},async poll(id){calls.poll++;assert.match(id,/^remote-/);return{state:'translated',pageCount:2,downloadURL:'private-result'};},async downloadResult(){calls.download++;return translated;},...overrides.client};
 const config={documentTranslationEnabled:true,documentTranslationAccessKeyId:'unit-key-id',documentTranslationAccessKeySecret:'unit-key-secret',documentTranslationClient:client,documentTranslationTickMs:60000,documentTranslationPollDelayMs:0,documentTranslationPageCount:async()=>2,storage,...overrides.config};
 const service=createDocumentTranslationService(db,config),worker=startDocumentTranslationWorker(db,config);t.after(async()=>{await worker.stop();db.close();});
 function upload(bytes=source,kind='pdf',user='alice'){
  const id=randomUUID(),key=`paperknow/users/${user}/originals/${id}.${kind}`;objects.set(key,Buffer.from(bytes));db.prepare("INSERT INTO files(id,user_id,project_id,name,kind,bytes,sha256,body,created_at,storage_provider,storage_bucket,storage_key) VALUES(?,?,NULL,?,?,?,?,?,?, 'aliyun_oss',?,?)").run(id,user,'合成测试.'+kind,kind,bytes.length,digest(bytes),Buffer.alloc(0),new Date().toISOString(),storage.bucket,key);return id;
 }
 const request=(path,input,user='alice')=>service.handle({path:'/api/document-translations'+path,method:input===undefined?'GET':'POST',user:user?{id:user}:null,readBody:async()=>input});
 const submit=async(fileId,extra={},user='alice')=>{const input={fileId,sourceLanguage:'en',targetLanguage:'zh',consent:true,idempotencyKey:randomUUID(),expectedUserId:user,...extra},quote=await request('/quote',{fileId:input.fileId,sourceLanguage:input.sourceLanguage,targetLanguage:input.targetLanguage,expectedUserId:input.expectedUserId},user);return request('',{...input,...(quote.value.token?{billingToken:quote.value.token}:{})},user);};
 const job=id=>db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
 return{db,objects,calls,source,translated,config,storage,client,worker,service,upload,request,submit,job,tick:()=>worker.tick()};
}

test('document translation requires login, explicit consent, current owner, supported language and owned private original',async t=>{
 const f=await fixture(t),file=f.upload();
 await rejected(f.request('',{},null),401);await rejected(f.submit(file,{},'bob'),404);await rejected(f.submit(file,{consent:false}),400);await rejected(f.submit(file,{expectedUserId:'bob'}),409);
 await rejected(f.submit(file,{fileURL:'http://127.0.0.1/a.pdf'}),400);await rejected(f.submit(file,{targetLanguage:'en'}),400);await rejected(f.submit(file,{sourceLanguage:'auto'}),400);await rejected(f.submit(file,{targetLanguage:'ja'}),400);await rejected(f.request('',[]),400);
 const text=f.upload(Buffer.from('plain'),'txt');await rejected(f.submit(text),400);
 f.db.prepare("UPDATE files SET storage_provider='local_server_sqlite' WHERE id=?").run(file);await rejected(f.submit(file),409);assert.equal(f.calls.create,0);
 const cap=documentTranslationCapabilities(f.config);assert.equal(cap.ready,true);assert.equal(cap.outputFormat,'docx');assert.equal(cap.pointsCharged,true);assert.equal(cap.billingService,'literature-read');assert.doesNotMatch(JSON.stringify(cap),/unit-key|Signature|aliyuncs/);
});

test('creation is idempotent, active duplicate merges, summaries are owner-only and contain no provider ID or URL',async t=>{
 const f=await fixture(t),file=f.upload(),key=randomUUID();const first=await f.submit(file,{idempotencyKey:key}),same=await f.submit(file,{idempotencyKey:key}),active=await f.submit(file);
 assert.equal(first.status,201);assert.equal(same.status,200);assert.equal(same.value.id,first.value.id);assert.equal(active.value.id,first.value.id);
 await rejected(f.submit(file,{idempotencyKey:key,sourceLanguage:'zh',targetLanguage:'en'}),409);
 await rejected(f.request('/'+first.value.id,undefined,'bob'),404);assert.deepEqual((await f.request('',undefined,'bob')).value.items,[]);
 const own=(await f.request('')).value.items;assert.equal(own.length,1);assert.equal(own[0].sourceLanguage,'en');assert.equal(own[0].fileName,'合成测试.pdf');assert.doesNotMatch(JSON.stringify(own),/provider_task|Signature|unit-key/);
 await rejected(f.submit(f.upload()),409);
});

test('a translated document creates private OSS output, an owned task result and a safe attachment with no SQLite binary',async t=>{
 const f=await fixture(t),file=f.upload(),id=(await f.submit(file)).value.id;await f.tick();assert.equal(f.job(id).status,'running');assert.equal(f.calls.create,1);await f.tick();assert.equal(f.job(id).status,'completed');
 const got=(await f.request('/'+id)).value;assert.equal(got.result.artifacts.length,1);assert.equal(got.result.artifacts[0].kind,'docx');assert.match(got.result.artifacts[0].downloadUrl,/^\/api\/artifacts\//);assert.equal(got.pageCount,2);
 const result=f.db.prepare('SELECT * FROM results WHERE job_id=?').get(id);assert.equal(result.type,'document_translation');assert.equal(JSON.parse(result.body).documentTranslationId,id);assert.doesNotMatch(result.body,/Synthetic|Signature|private-result/);
 assert.equal(f.objects.size,2);assert.equal(f.db.prepare('SELECT length(body) n FROM files WHERE id=?').get(file).n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM usage').get().n,0);
 const artifacts=createArtifactService(f.db,f.config),path=got.result.artifacts[0].downloadUrl;
 const download=await artifacts({path,method:'GET',user:{id:'alice'},query:new URLSearchParams()});assert.equal(digest(download.body),digest(f.translated));assert.match(download.headers['Content-Disposition'],/^attachment/);download.release();
 await rejected(artifacts({path,method:'GET',user:{id:'bob'},query:new URLSearchParams()}),404);
});

test('missing configuration fails closed before creating jobs, without disabling viewing existing task records',async t=>{
 const f=await fixture(t,{config:{documentTranslationEnabled:false}}),file=f.upload();await rejected(f.submit(file),503);assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);assert.equal((await f.request('')).value.items.length,0);
});

test('integrity, size, page and DOCX decompression limits are enforced before provider submission',async t=>{
 const f=await fixture(t,{config:{documentTranslationPageCount:async()=>101}}),file=f.upload(),id=(await f.submit(file)).value.id;await f.tick();assert.equal(f.job(id).status,'failed');assert.match(f.job(id).error,/100页/);assert.equal(f.calls.create,0);
 f.config.documentTranslationPageCount=async()=>2;const next=(await f.submit(file)).value.id,row=f.db.prepare('SELECT * FROM files WHERE id=?').get(file);f.objects.set(row.storage_key,Buffer.from('corrupt'));await f.tick();assert.equal(f.job(next).status,'failed');assert.equal(f.calls.sign,0);
 const invalid=f.upload(Buffer.from('PKinvalid'),'docx'),third=(await f.submit(invalid)).value.id;await f.tick();assert.equal(f.job(third).status,'failed');assert.equal(f.calls.create,0);
});

test('DOCX input is translated and its estimated billable pages are reserved before a remote create',async t=>{
 const f=await fixture(t),file=f.upload(await docx('A'.repeat(4001)),'docx'),id=(await f.submit(file)).value.id;await f.tick();assert.equal(f.calls.create,1);assert.equal(f.db.prepare('SELECT expected_pages FROM document_translation_runs WHERE id=?').get(id).expected_pages,3);await f.tick();assert.equal(f.job(id).status,'completed');
});

test('DOCX character and forged decompression declarations are rejected before remote cost',async t=>{
 const f=await fixture(t),large=f.upload(await docx('A'.repeat(100001)),'docx'),first=(await f.submit(large)).value.id;await f.tick();assert.equal(f.job(first).status,'failed');assert.match(f.job(first).error,/100,000字符/);assert.equal(f.calls.create,0);
 const forged=Buffer.from(await docx('short text'));let central=-1;for(let at=0;at<forged.length-46;at++)if(forged.readUInt32LE(at)===0x02014b50){central=at;break;}assert.ok(central>=0);forged.writeUInt32LE(0,central+24);
 const bad=f.upload(forged,'docx'),next=(await f.submit(bad)).value.id;await f.tick();assert.equal(f.job(next).status,'failed');assert.equal(f.calls.create,0);assert.equal(f.calls.sign,0);
});

test('free translation page budget rejects the next submission before signing or create, even after a successful earlier task',async t=>{
 const f=await fixture(t,{config:{documentTranslationPageCount:async()=>100}}),file=f.upload(),first=(await f.submit(file)).value.id;await f.tick();await f.tick();assert.equal(f.job(first).status,'completed');const next=(await f.submit(f.upload())).value.id;await f.tick();assert.equal(f.job(next).status,'failed');assert.match(f.job(next).error,/页数额度/);assert.equal(f.calls.create,1);assert.equal(f.calls.sign,1);
});

test('unknown create outcome is never replayed and provider credential errors are never exposed',async t=>{
 let creates=0;const f=await fixture(t,{client:{async create(){creates++;throw Error('secret-key private-file-url');}}}),file=f.upload(),id=(await f.submit(file)).value.id;await f.tick();await f.tick();assert.equal(creates,1);assert.equal(f.job(id).status,'failed');assert.doesNotMatch(f.job(id).error,/secret|private-file/);assert.equal(f.db.prepare('SELECT provider_state FROM document_translation_runs WHERE id=?').get(id).provider_state,'submitting');
});

test('known remote task resumes after worker restart without replaying create; unknown submission boundary fails closed',async t=>{
 const f=await fixture(t),file=f.upload(),id=(await f.submit(file)).value.id;await f.tick();await f.worker.stop();const resumed=startDocumentTranslationWorker(f.db,f.config);t.after(()=>resumed.stop());await resumed.tick();assert.equal(f.job(id).status,'completed');assert.equal(f.calls.create,1);
 await resumed.stop();const next=(await f.submit(f.upload())).value.id;f.db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(next);f.db.prepare("UPDATE document_translation_runs SET provider_state='submitting' WHERE id=?").run(next);const restart=startDocumentTranslationWorker(f.db,f.config);t.after(()=>restart.stop());assert.equal(f.job(next).stage,'submission_unconfirmed');await restart.tick();assert.equal(f.calls.create,1);assert.match(f.job(next).error,/未自动重复/);
});

test('read-only transient errors recover against the same task and provider error payload is never returned',async t=>{
 let attempt=0;const f=await fixture(t,{client:{async poll(){if(++attempt===1)throw Object.assign(Error('暂时不可用'),{documentTranslationSafe:true,code:'document_translation_unavailable'});return{state:'translated',pageCount:2,downloadURL:'private-result'};}}}),file=f.upload(),id=(await f.submit(file)).value.id;await f.tick();await f.tick();assert.equal(f.job(id).status,'running');assert.equal(f.job(id).stage,'reconnecting');f.db.prepare('UPDATE document_translation_runs SET next_poll_at=NULL WHERE id=?').run(id);await f.tick();assert.equal(f.job(id).status,'completed');assert.equal(f.calls.create,1);
});

test('cancellation during create persists an acknowledged task but never publishes result or starts another create',async t=>{
 const begun=deferred(),resume=deferred();const f=await fixture(t,{client:{async create({clientToken}){begun.resolve();await resume.promise;return{taskId:'remote-'+clientToken,state:'ready'};}}}),file=f.upload(),id=(await f.submit(file)).value.id;
 f.config.cancelDocumentTranslation=value=>f.worker.cancel(value);const work=f.tick();await begun.promise;await f.request('/'+id+'/cancel',{});resume.resolve();await work;await f.tick();assert.equal(f.job(id).status,'cancelled');assert.ok(f.db.prepare('SELECT provider_task_id FROM document_translation_runs WHERE id=?').get(id).provider_task_id);assert.equal(f.calls.poll,0);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.objects.size,1);
});

test('cancel during a private OSS result write compensates only newly-created files and keeps originals',async t=>{
 const begun=deferred(),resume=deferred(),objects=new Map();const f=await fixture(t,{storage:{async read(file){return f.objects.get(file.storage_key);},async putArtifact(id,user,kind,bytes){const key=`paperknow/users/${user}/exports/${id}.${kind}`;objects.set(key,Buffer.from(bytes));begun.resolve();await resume.promise;return key;},async removeArtifact(row){objects.delete(row.storage_key);}}}),file=f.upload(),id=(await f.submit(file)).value.id;f.config.cancelDocumentTranslation=value=>f.worker.cancel(value);
 await f.tick();const work=f.tick();await begun.promise;await f.request('/'+id+'/cancel',{});resume.resolve();await work;assert.equal(f.job(id).status,'cancelled');assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);assert.equal(f.db.prepare("SELECT count(*) n FROM artifacts WHERE status='ready'").get().n,0);assert.equal(objects.size,0);assert.equal(f.objects.size,1);
});

test('malformed provider DOCX or private OSS failure never publishes a completed result',async t=>{
 const f=await fixture(t,{client:{async downloadResult(){return Buffer.from('PKnot-a-document');}}}),file=f.upload(),id=(await f.submit(file)).value.id;await f.tick();await f.tick();assert.equal(f.job(id).status,'failed');assert.equal(f.calls.put,0);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);
 const next=(await f.submit(file)).value.id;f.client.downloadResult=async()=>f.translated;f.storage.putArtifact=async()=>{throw Error('private-secret');};await f.tick();await f.tick();assert.equal(f.job(next).status,'failed');assert.doesNotMatch(f.job(next).error,/private-secret/);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);
});

test('daily admission stays bounded when tasks are cancelled before remote work',async t=>{
 const f=await fixture(t),file=f.upload();for(let i=0;i<3;i++){const id=(await f.submit(file)).value.id;await f.request('/'+id+'/cancel',{});}await rejected(f.submit(file),429);assert.equal(f.calls.create,0);
});

function paidReading(f,amount=100){
 const billing=createBillingService(f.db,f.config);billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:25}))});
 const at=new Date().toISOString(),id=randomUUID();f.db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(id,'alice','credits-200','paid',at);f.db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(id,'alice','credits-200',amount,'purchase',at);return billing;
}
test('paid whole-document translation holds one unified fee, settles once and reopens its completed output free',async t=>{
 const f=await fixture(t),billing=paidReading(f),file=f.upload(),key=randomUUID(),id=(await f.submit(file,{idempotencyKey:key})).value.id;
 assert.deepEqual({...billing.balance('alice'),ledger:[]},{balance:100,held:25,available:75,ledger:[]});
 assert.equal((await f.submit(file,{idempotencyKey:key})).value.id,id);assert.equal((await f.submit(file)).value.id,id);await f.tick();await f.tick();await f.tick();assert.equal(f.job(id).status,'completed');assert.equal(billing.balance('alice').balance,75);assert.equal(billing.balance('alice').held,0);
 const cached=await f.request('/quote',{fileId:file,sourceLanguage:'en',targetLanguage:'zh',expectedUserId:'alice'});assert.equal(cached.value.existingJobId,id);assert.equal((await f.submit(file)).value.id,id);assert.equal(f.calls.create,1);assert.equal(billing.balance('alice').ledger.filter(e=>e.kind==='settle').length,1);assert.equal(billing.balance('alice').ledger.find(e=>e.kind==='settle').title,'文献研读');
});
test('translation quote binds owner and exact file; missing or exhausted funds never start a paid provider call',async t=>{
 const f=await fixture(t),billing=paidReading(f,25),file=f.upload(),other=f.upload();const input={fileId:file,sourceLanguage:'en',targetLanguage:'zh',expectedUserId:'alice',consent:true,idempotencyKey:randomUUID()};
 await rejected(f.request('',input),409);const q=(await f.request('/quote',{fileId:file,sourceLanguage:'en',targetLanguage:'zh',expectedUserId:'alice'})).value;
 await rejected(f.request('',{...input,fileId:other,billingToken:q.token}),409);await rejected(f.request('',{...input,expectedUserId:'bob',billingToken:q.token},'bob'),404);
 const id=(await f.request('',{...input,billingToken:q.token})).value.id;await rejected(f.submit(other),402);assert.equal(f.calls.create,0);assert.equal(billing.balance('alice').held,25);await f.request('/'+id+'/cancel',{});assert.equal(billing.balance('alice').held,0);assert.equal(billing.balance('alice').balance,25);
 const retry=(await f.submit(other)).value.id;await f.tick();await f.tick();assert.equal(f.job(retry).status,'completed');assert.equal(billing.balance('alice').balance,0);await rejected(f.submit(f.upload()),402);assert.equal(f.calls.create,1);
});
test('failed paid translations and uncertain submission after restart release their holds without charging',async t=>{
 const f=await fixture(t,{client:{async create(){throw Error('unknown create outcome');}}}),billing=paidReading(f),id=(await f.submit(f.upload())).value.id;await f.tick();assert.equal(f.job(id).status,'failed');assert.equal(billing.balance('alice').balance,100);assert.equal(billing.balance('alice').held,0);
 await f.worker.stop();const next=(await f.submit(f.upload())).value.id;f.db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(next);f.db.prepare("UPDATE document_translation_runs SET provider_state='submitting' WHERE id=?").run(next);const restart=startDocumentTranslationWorker(f.db,f.config);t.after(()=>restart.stop());assert.equal(f.job(next).status,'failed');assert.equal(billing.balance('alice').held,0);assert.equal(billing.balance('alice').balance,100);assert.equal(billing.balance('alice').ledger.filter(e=>e.kind==='release').length,2);
});
test('paid translation actions have no free daily count or page cap and PDF preparation adds no charge',async t=>{
 const f=await fixture(t,{config:{documentTranslationPageCount:async()=>100}}),billing=paidReading(f,200);
 for(let n=0;n<4;n++){const id=(await f.submit(f.upload())).value.id;await f.tick();await f.tick();assert.equal(f.job(id).status,'completed');}
 assert.equal(f.calls.create,4);assert.equal(billing.balance('alice').balance,100);assert.equal(billing.balance('alice').ledger.filter(e=>e.kind==='settle').length,4);
});


test('V1 whole-document price follows verified source pages at 20/21/50 and rejects 51 before a hold or provider call',async t=>{
 for(const [pages,cost] of [[20,99],[21,249],[50,249],[51,null]]){
  const f=await fixture(t,{config:{documentTranslationPageCount:async()=>pages}});applyV1Commerce(f.db,planV1Commerce(f.db).expected);
  f.db.prepare('INSERT INTO admin_credit_adjustments(id,user_id,amount,reason,actor_id,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),'alice',10000,'Synthetic fixture','alice',new Date().toISOString());
  const id=f.upload(),before=f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n;
  const input={fileId:id,sourceLanguage:'en',targetLanguage:'zh',expectedUserId:'alice'};
  if(cost===null)await assert.rejects(f.request('/quote',input),{status:400});
  else {const result=await f.request('/quote',input);assert.equal(result.value.creditCost,cost);assert.equal(result.value.pageCount,pages);}
  assert.equal(f.calls.create,0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,before);
 }
});
