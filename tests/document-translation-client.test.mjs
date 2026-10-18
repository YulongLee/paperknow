import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createDocumentTranslationClient,checkedTranslationURL} from '../backend/document-translation-client.mjs';

const config={documentTranslationAccessKeyId:'unit-key-id',documentTranslationAccessKeySecret:'unit-secret'};
const url='https://unit-bucket.oss-cn-hangzhou.aliyuncs.com/source.pdf?Signature=opaque';
const input={fileURL:url,sourceLanguage:'en',targetLanguage:'zh',clientToken:'request-123'};
const clientOf=callApi=>createDocumentTranslationClient(config,{client:{callApi}});
test('translation RPC uses fixed TLS endpoint semantics, POST create and GET query with SDK retries disabled',async()=>{
 const calls=[],client=clientOf(async(params,request,runtime)=>{calls.push({params,request,runtime});return{statusCode:200,body:params.action==='CreateDocTranslateTask'?{TaskId:'task-123',Status:'ready'}:{TaskId:'task-123',Status:'translated',PageCount:2,TranslateFileUrl:url.replace('source.pdf','translated.docx')}};});
 assert.deepEqual(await client.create(input),{taskId:'task-123',state:'ready'});const polled=await client.poll('task-123');assert.equal(polled.state,'translated');assert.equal(polled.pageCount,2);assert.match(polled.downloadURL,/translated.docx/);
 assert.equal(calls[0].params.method,'POST');assert.equal(calls[0].params.version,'2018-10-12');assert.equal(calls[0].request.body.ClientToken,'request-123');assert.equal(calls[0].request.body.FileUrl,url);assert.equal(calls[1].params.method,'GET');assert.equal(calls[1].request.query.TaskId,'task-123');assert.equal(calls[0].runtime.autoretry,false);assert.equal(calls[0].runtime.maxAttempts,1);
});
test('creation rejects URLs, unsupported languages and same-language translation before an upstream call',async()=>{
 let calls=0;const client=clientOf(()=>{calls++;});for(const extra of [{fileURL:'http://127.0.0.1/a.pdf'},{fileURL:'https://evil.example/file.pdf'},{fileURL:'https://unit-bucket.oss-cn-hangzhou.aliyuncs.com.evil.example/a.pdf'},{targetLanguage:'en'},{sourceLanguage:'auto'},{clientToken:'bad token'}])await assert.rejects(()=>client.create({...input,...extra}));assert.equal(calls,0);
});
test('response validation rejects unknown tasks and states, and raw provider errors never leak',async()=>{
 await assert.rejects(()=>clientOf(async()=>({statusCode:200,body:{TaskId:'another',Status:'translated',TranslateFileUrl:url}})).poll('task-123'),/安全校验/);
 await assert.rejects(()=>clientOf(async()=>({statusCode:200,body:{TaskId:'task-123',Status:'translated',TranslateFileUrl:'https://127.0.0.1/private'}})).poll('task-123'),/安全校验/);
 await assert.rejects(()=>clientOf(async()=>{throw Object.assign(Error('AKSECRET URLSignature upstream diagnostics'),{code:'AccessDenied'});}).create(input),error=>error.documentTranslationSafe&&!/AKSECRET|URLSignature|diagnostics/.test(error.message));
});
test('download URL allowlist rejects credentials, redirects-to-other-sites and insecure hosts; legacy known OSS URLs upgrade to TLS',()=>{
 for(const value of ['https://127.0.0.1/a','https://a.oss-cn-hangzhou.aliyuncs.com:444/a','https://user:pass@a.oss-cn-hangzhou.aliyuncs.com/a','https://a.oss-cn-hangzhou.aliyuncs.com/a#x','http://evil.example/a','https://aliyuncs.com/a'])assert.throws(()=>checkedTranslationURL(value));
 assert.equal(checkedTranslationURL(url.replace('https:','http:')).protocol,'https:');assert.throws(()=>checkedTranslationURL(url.replace('https:','http:'),{original:true}));
});
test('result download blocks private DNS and pins a public resolution, with no auth header or redirect following',async()=>{
 let requests=0;const invalid=createDocumentTranslationClient(config,{lookupImpl:async()=>[{address:'127.0.0.1',family:4}],requestImpl:()=>{requests++;}});await assert.rejects(()=>invalid.downloadResult(url),/安全校验/);assert.equal(requests,0);
 const download=createDocumentTranslationClient(config,{lookupImpl:async()=>[{address:'8.8.8.8',family:4}],requestImpl:(options,callback)=>{requests++;assert.equal(options.protocol,'https:');assert.equal(options.headers.Authorization,undefined);options.lookup(options.hostname,{},(error,address)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');});const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=Readable.from([Buffer.from('PKsynthetic-result')]);res.statusCode=200;res.headers={};callback(res);});return req;}});
 assert.equal((await download.downloadResult(url)).toString(),'PKsynthetic-result');assert.equal(requests,1);
});
test('download refuses redirects, oversized streams and non-DOCX signatures',async()=>{
 for(const response of [{status:302,body:Buffer.from('redirect')},{status:200,body:Buffer.from('not a document')},{status:200,declared:String(21*1024*1024),body:Buffer.from('PKsmall')}]){
  const client=createDocumentTranslationClient(config,{lookupImpl:async()=>[{address:'8.8.8.8',family:4}],requestImpl:(_options,callback)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=Readable.from([response.body]);res.statusCode=response.status;res.headers=response.declared?{'content-length':response.declared}:{};callback(res);});return req;}});await assert.rejects(()=>client.downloadResult(url),error=>error.documentTranslationSafe===true);
 }
});
