import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileBytes} from '../dist/workspace/file-bytes.mjs';

test('native reads share one byte snapshot and a method-specific read failure can use FileReader',async()=>{
 let calls=0,fallbacks=0;
 class Reader{readAsArrayBuffer(){fallbacks++;this.result=new Uint8Array([37,80,68,70]).buffer;queueMicrotask(()=>this.onload());}}
 const file={arrayBuffer:async()=>{calls++;throw Object.assign(Error('native failure'),{name:'NotReadableError'});}};
 const [a,b]=await Promise.all([readFileBytes(file,{FileReaderImpl:Reader}),readFileBytes(file,{FileReaderImpl:Reader})]);
 assert.deepEqual([...a],[37,80,68,70]);assert.equal(a,b);assert.equal(calls,1);assert.equal(fallbacks,1);
});
test('failed handles are evicted, security errors are not retried and empty bytes cannot upload',async()=>{
 let calls=0,fallbacks=0;class Reader{constructor(){fallbacks++;}}
 const file={arrayBuffer:async()=>{if(++calls===1)throw Object.assign(Error('permission revoked'),{name:'SecurityError'});return new Uint8Array([1]).buffer;}};
 await assert.rejects(readFileBytes(file,{FileReaderImpl:Reader}),{code:'LOCAL_FILE_UNREADABLE'});assert.equal(fallbacks,0);assert.deepEqual([...await readFileBytes(file)],[1]);
 await assert.rejects(readFileBytes({arrayBuffer:async()=>new ArrayBuffer(0)}),/内容为空/);
 await assert.rejects(readFileBytes({arrayBuffer:async()=>new ArrayBuffer(5)},{maxBytes:4}),/超过/);
});
test('leaving during a local read stops its caller and a separate waiting caller can still use the snapshot',async()=>{
 let release;const controller=new AbortController(),file={arrayBuffer:()=>new Promise(resolve=>release=resolve)};
 const cancelled=readFileBytes(file,{signal:controller.signal}),other=readFileBytes(file);controller.abort();await assert.rejects(cancelled,{name:'AbortError'});release(new Uint8Array([1,2]).buffer);assert.deepEqual([...await other],[1,2]);
});


test('a TXT import and original save reuse the same native read instead of reopening its file handle',async()=>{
 const {createWorkspaceDocumentImporter}=await import('../dist/workspace/document-import.mjs');
 const {saveLiteratureOriginal}=await import('../dist/workspace/literature-upload.mjs');
 const file=new File(['Source text for reuse.'],'source.txt'),native=file.arrayBuffer.bind(file);let reads=0;file.arrayBuffer=()=>{if(++reads>1)throw Object.assign(Error('expired'),{name:'NotReadableError'});return native();};
 const extract=createWorkspaceDocumentImporter({fetchImpl:async()=>{throw Error('No service needed for TXT');}});assert.equal((await extract(file)).text,'Source text for reuse.');
 const calls=[];await saveLiteratureOriginal(file,{fetchImpl:async(url,init)=>{calls.push({url,body:init.body&&JSON.parse(init.body)});return Response.json(url==='/api/files'?{id:'saved'}:{user:{id:'owner'}});}});
 assert.equal(reads,1);assert.equal(Buffer.from(calls.find(c=>c.url==='/api/files').body.data,'base64').toString(),'Source text for reuse.');
});
