import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {PDFDocument} from 'pdf-lib';
import JSZip from 'jszip';
import {createServer} from '../server.mjs';
import {createSession,digest} from '../backend/auth.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{resolve,reject,promise};};
function image(){
 const crc=bytes=>{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let n=0;n<8;n++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const raw=Buffer.concat([Buffer.from(name),data]),prefix=Buffer.alloc(4),suffix=Buffer.alloc(4);prefix.writeUInt32BE(data.length);suffix.writeUInt32BE(crc(raw));return Buffer.concat([prefix,raw,suffix]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(16);header.writeUInt32BE(16,4);header[8]=8;const pixels=Buffer.alloc(17*16,255);for(let i=0;i<16;i++)pixels[i*17]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
async function fixture(t,overrides={}){
 const objects=new Map(),calls={ocr:0,create:0,poll:0,download:0,sign:0,put:0,remove:0};
 const pdf=await PDFDocument.create();pdf.addPage();pdf.addPage();const source=Buffer.from(await pdf.save());
 const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');zip.file('word/document.xml','<w:document><w:body><w:p><w:r><w:t>合成译文，仅用于接口测试。</w:t></w:r></w:p></w:body></w:document>');const translated=await zip.generateAsync({type:'nodebuffer'});
 const ocr={ready:true,async recognize(bytes,mime){calls.ocr++;assert.deepEqual(bytes,image());assert.equal(mime,'image/png');return{latex:'E=mc^2'};},...overrides.ocr};
 const translation={async create(input){calls.create++;assert.match(input.fileURL,/^https:\/\/unit-bucket\.oss-cn-hangzhou\.aliyuncs\.com\/paperknow\/users\/alice\/originals\//);return{taskId:'unit-task-'+input.clientToken,state:'ready'};},async poll(id){calls.poll++;assert.match(id,/^unit-task-/);return{state:'translated',pageCount:2,downloadURL:'unit-private-result'};},async downloadResult(url){calls.download++;assert.equal(url,'unit-private-result');return translated;},...overrides.translation};
 const oss={async put(key,bytes,options){calls.put++;assert.equal(options.headers['x-oss-object-acl'],'private');objects.set(key,Buffer.from(bytes));},async get(key){if(!objects.has(key))throw Error('missing unit object');return{content:Buffer.from(objects.get(key))};},async delete(key){calls.remove++;objects.delete(key);},async signatureUrlV4(method,seconds,_extra,key){calls.sign++;assert.equal(method,'GET');assert.equal(seconds,600);return'https://unit-bucket.oss-cn-hangzhou.aliyuncs.com/'+key+'?unit-signature=private';},...overrides.oss};
 const config={formulaOcrEnabled:true,formulaOcrAccessKeyId:'unit-only-ocr-id',formulaOcrAccessKeySecret:'unit-only-ocr-secret',formulaOcrClient:ocr,documentTranslationEnabled:true,documentTranslationAccessKeyId:'unit-only-translation-id',documentTranslationAccessKeySecret:'unit-only-translation-secret',documentTranslationClient:translation,documentTranslationTickMs:60000,documentTranslationPollDelayMs:0,documentTranslationPageCount:async()=>2,ossClient:oss,ossBucket:'unit-bucket',ossEndpoint:'https://oss-cn-hangzhou.aliyuncs.com',ossRegion:'cn-hangzhou',ossPrefix:'paperknow/',ossAccessKeyId:'unit-only-storage-id',ossAccessKeySecret:'unit-only-storage-secret',...overrides.config};
 const app=createServer({dbPath:':memory:',config});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
 const users={};for(const id of ['alice','bob']){app.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());users[id]={id,cookie:'pk_session='+createSession(app.db,id)};}
 t.after(()=>app.close());
 async function request(path,input,user=users.alice,extra={}){
  const result=await fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',headers:{...(user?{Cookie:user.cookie}:{}),...(input===undefined?{}:{Origin:base,'Content-Type':'application/json'}),...extra.headers},body:input===undefined?undefined:JSON.stringify(input)});
  const type=result.headers.get('content-type')||'',value=type.includes('application/json')?await result.json():Buffer.from(await result.arrayBuffer());return{status:result.status,value,headers:result.headers};
 }
 const upload=async()=>{const r=await request('/files',{name:'合成英文资料.pdf',data:source.toString('base64'),expectedUserId:'alice'});assert.equal(r.status,201);return r.value.id;};
 const submitTranslation=async(fileId,extra={},user=users.alice)=>{const input={fileId,sourceLanguage:'en',targetLanguage:'zh',consent:true,expectedUserId:user?.id,idempotencyKey:crypto.randomUUID(),...extra},q=await request('/document-translations/quote',{fileId:input.fileId,sourceLanguage:input.sourceLanguage,targetLanguage:input.targetLanguage,expectedUserId:input.expectedUserId},user);if(q.status!==200)return q;return request('/document-translations',{...input,...(q.value.token?{billingToken:q.value.token}:{})},user);};
 const submitOcr=(extra={},user=users.alice)=>request('/formula-recognitions',{imageBase64:image().toString('base64'),mime:'image/png',consent:true,expectedUserId:user?.id,idempotencyKey:crypto.randomUUID(),...extra},user);
 const job=id=>app.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
 return{...app,objects,calls,source,translated,users,config,base,request,upload,submitTranslation,submitOcr,job};
}

test('public service capabilities disclose availability and bounds without any provider credentials',async t=>{
 const f=await fixture(t),result=await f.request('/capabilities',undefined,null);assert.equal(result.status,200);
 assert.equal(result.value.formulaOcr.ready,true);assert.equal(result.value.formulaOcr.maxFileBytes,2*1024*1024);assert.equal(result.value.documentTranslation.ready,true);assert.deepEqual(result.value.documentTranslation.formats,['pdf','docx']);assert.equal(result.value.documentTranslation.pointsCharged,true);
 assert.doesNotMatch(JSON.stringify(result.value),/unit-only-|AccessKey|signature|aliyuncs|unit-task/);assert.equal(result.headers.get('cache-control'),'no-store');
 const disabled=await fixture(t,{config:{formulaOcrEnabled:false,documentTranslationEnabled:false}}),cap=await disabled.request('/capabilities',undefined,null);assert.equal(cap.value.formulaOcr.ready,false);assert.equal(cap.value.documentTranslation.ready,false);
});

test('HTTP authentication, same-origin and account checks stop provider calls before upload or recognition',async t=>{
 const f=await fixture(t);assert.equal((await f.submitOcr({},null)).status,401);assert.equal((await f.request('/document-translations',{},null)).status,401);
 assert.equal((await f.submitOcr({consent:false})).status,400);assert.equal((await f.submitOcr({expectedUserId:'bob'})).status,409);
 const hostile=await f.request('/formula-recognitions',{},f.users.alice,{headers:{Origin:'https://attacker.invalid'}});assert.equal(hostile.status,403);
 const oversized=await f.request('/formula-recognitions',{imageBase64:'A'.repeat(3*1024*1024+1)});assert.equal(oversized.status,413);
 const file=await f.upload();assert.equal((await f.submitTranslation(file,{},f.users.bob)).status,404);assert.equal((await f.submitTranslation(file,{consent:false})).status,400);assert.equal((await f.submitTranslation(file,{expectedUserId:'bob'})).status,409);
 assert.equal(f.calls.ocr,0);assert.equal(f.calls.create,0);assert.equal(f.db.prepare('SELECT count(*) n FROM formula_recognitions').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM document_translation_runs').get().n,0);
});

test('formula recognition HTTP result is durable and owner-scoped, retains no source image and never charges credits',async t=>{
 const f=await fixture(t),key=crypto.randomUUID(),first=await f.submitOcr({idempotencyKey:key});assert.equal(first.status,201);assert.equal(first.value.latex,'E=mc^2');
 const repeated=await f.submitOcr({idempotencyKey:key});assert.equal(repeated.status,200);assert.equal(repeated.value.id,first.value.id);assert.equal(f.calls.ocr,1);
 assert.equal((await f.request('/formula-recognitions/'+first.value.id,undefined,f.users.bob)).status,404);assert.equal((await f.request('/formula-recognitions/'+first.value.id,undefined,null)).status,401);
 const own=await f.request('/formula-recognitions/'+first.value.id);assert.equal(own.value.status,'completed');assert.doesNotMatch(JSON.stringify(own.value),/unit-only-|imageBase64|provider|aliyun/);
 assert.equal(f.objects.size,0);assert.equal(f.db.prepare('SELECT count(*) n FROM usage').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);
});

test('translation remains queued for its specialist worker, guards source deletion and completes to an owned private attachment',async t=>{
 const f=await fixture(t),file=await f.upload(),id=(await f.submitTranslation(file)).value.id;
 await new Promise(resolve=>setTimeout(resolve,220));assert.equal(f.job(id).status,'queued');assert.equal(f.calls.create,0);
 assert.equal((await f.request('/files/'+file+'/delete',{expectedSha256:digest(f.source)})).status,409);
 await f.worker.tick();assert.equal(f.job(id).status,'running');assert.equal(f.calls.create,1);assert.equal(f.calls.sign,1);
 assert.equal((await f.request('/jobs/'+id+'/retry',{})).status,409);
 const active=await f.request('/document-translations/'+id);assert.doesNotMatch(JSON.stringify(active.value),/unit-task|unit-private-result|unit-signature|unit-only/);
 assert.equal((await f.request('/document-translations/'+id,undefined,f.users.bob)).status,404);assert.equal((await f.request('/document-translations',undefined,f.users.bob)).value.items.length,0);
 await f.worker.tick();assert.equal(f.job(id).status,'completed');assert.equal(f.calls.poll,1);assert.equal(f.calls.download,1);
 const completed=await f.request('/document-translations/'+id),artifact=completed.value.result.artifacts[0];assert.equal(completed.status,200);assert.equal(artifact.kind,'docx');
 const path=artifact.downloadUrl.replace(/^\/api/,'');const output=await f.request(path);assert.equal(output.status,200);assert.deepEqual(output.value,f.translated);assert.match(output.headers.get('content-disposition'),/^attachment/);assert.match(output.headers.get('content-security-policy'),/sandbox/);
 assert.equal((await f.request(path,undefined,f.users.bob)).status,404);assert.equal((await f.request(path,undefined,null)).status,401);
 assert.equal(f.db.prepare('SELECT length(body) n FROM files WHERE id=?').get(file).n,0);assert.equal(f.objects.size,2);assert.deepEqual({...f.db.prepare('SELECT source,credits,status FROM billing_reservations').get()},{source:'free',credits:0,status:'settled'});
 const remove=await f.request('/files/'+file+'/delete',{expectedSha256:digest(f.source)});assert.equal(remove.status,200);assert.deepEqual((await f.request(path)).value,f.translated);
});

test('cancellation through generic task API reaches specialist worker, discards late output and allows source cleanup',async t=>{
 const entered=deferred();let creates=0;const f=await fixture(t,{translation:{async create(_input,signal){creates++;entered.resolve();await new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('private-call-aborted')),{once:true});});}}});
 const file=await f.upload(),id=(await f.submitTranslation(file)).value.id,work=f.worker.tick();await entered.promise;
 assert.equal((await f.request('/files/'+file+'/delete',{expectedSha256:digest(f.source)})).status,409);
 const cancelled=await f.request('/jobs/'+id+'/cancel',{});assert.equal(cancelled.status,200);await work;
 assert.equal(f.job(id).status,'cancelled');assert.equal((await f.request('/document-translations/'+id)).value.status,'cancelled');assert.equal(creates,1);assert.equal(f.calls.poll,0);assert.equal(f.db.prepare('SELECT count(*) n FROM artifacts').get().n,0);
 assert.equal((await f.request('/jobs/'+id+'/retry',{})).status,409);assert.equal((await f.request('/files/'+file+'/delete',{expectedSha256:digest(f.source)})).status,200);
});

test('raw upstream failures never leak through HTTP and failed provider requests are not retried by generic task actions',async t=>{
 let recognition=0,translation=0;const f=await fixture(t,{ocr:{async recognize(){recognition++;throw Error('unit-only-ocr-secret https://internal.invalid');}},translation:{async create(){translation++;throw Error('unit-only-translation-secret https://private-original.invalid');}}});
 const bad=await f.submitOcr();assert.equal(bad.status,503);assert.equal(bad.value.status,'failed');assert.doesNotMatch(JSON.stringify(bad.value),/unit-only|https:|internal/);assert.equal((await f.submitOcr()).value.id,bad.value.id);assert.equal(recognition,1);
 const file=await f.upload(),id=(await f.submitTranslation(file)).value.id;await f.worker.tick();assert.equal(f.job(id).status,'failed');assert.equal(translation,1);
 const result=await f.request('/document-translations/'+id);assert.doesNotMatch(JSON.stringify(result.value),/unit-only|https:|private-original/);assert.equal((await f.request('/jobs/'+id+'/retry',{})).status,409);await f.worker.tick();assert.equal(translation,1);assert.equal(f.db.prepare('SELECT count(*) n FROM artifacts').get().n,0);
});
