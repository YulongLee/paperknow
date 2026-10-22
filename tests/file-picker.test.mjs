import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {acceptedStoredFile,openStoredFilePicker,installStoredFilePickers} from '../dist/workspace/file-picker.mjs';
import {storedFileSource,bindStoredFile,reuseStoredOriginal} from '../dist/workspace/file-selection.mjs';
import {createWorkspaceDocumentImporter} from '../dist/workspace/document-import.mjs';
import {uploadThesisTemplate} from '../dist/workspace/thesis-template.mjs';

const bytes=Buffer.from('已保存的测试资料'),sha=createHash('sha256').update(bytes).digest('hex');
const row={id:'stored-1',name:'研究资料.txt',kind:'txt',bytes:bytes.length,sha256:sha,status:'ready'};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(check){
 const deadline=performance.now()+5000;
 // Crypto work may finish after many otherwise idle event-loop turns.
 while(performance.now()<deadline){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}
 if(check())return;
 throw Error('UI did not settle');
}
async function fixture(t,{accept='.txt',handle,select=true,requestTimeout}={}){
 const dom=new JSDOM(`<main><label>上传<input id="file" type="file" accept="${accept}"></label></main>`,{url:'http://localhost/workspace.html#tool/proposal'}),w=dom.window,calls=[],selected=[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});w.File=globalThis.File;
 let owner='alice';const fetchImpl=async(path,options={})=>{calls.push({path,options});const custom=await handle?.(path,options);if(custom)return custom;if(path==='/api/auth/me')return Response.json({user:{id:owner}});if(path==='/api/files')return Response.json({items:[row,{...row,id:'pending',name:'删除中.txt',deletionStatus:'pending'},{...row,id:'wrong',name:'数据.csv',kind:'csv'}]});if(path.startsWith('/api/artifacts?'))return Response.json({items:[{...row,id:'generated',name:'生成稿.txt'},{...row,id:'failed',name:'未保存.txt',status:'failed'}]});if(path.includes('/download'))return new Response(bytes);throw Error('Unexpected '+path);};
 const input=w.document.querySelector('#file'),picker=openStoredFilePicker({input,fetchImpl,requestTimeout,...(select?{onSelect:file=>selected.push(file)}:{})});t.after(()=>{picker.close();dom.window.close();});await settle(()=>w.document.querySelector('[data-picker-key]'));return {dom,w,input,picker,calls,selected,setOwner:value=>{owner=value;}};
}
test('accepted formats follow the receiving control, including spreadsheet and image MIME aliases',()=>{
 for(const [kind,accept,expected] of [['docx','.pdf,.docx',true],['pdf','.docx',false],['xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',true],['jpeg','image/*',true],['zip','image/*',false]])assert.equal(acceptedStoredFile({kind},accept),expected);
});
test('picker filters incompatible, deleting and unfinished files, verifies bytes and passes provenance without a processing POST',async t=>{
 const f=await fixture(t);assert.equal(f.w.document.querySelectorAll('[data-picker-key]').length,2);assert.doesNotMatch(f.w.document.querySelector('dialog').textContent,/删除中|未保存|数据.csv/);
 f.w.document.querySelector('[data-picker-key="original:stored-1"]').click();await settle(()=>f.selected.length===1);assert.equal(await f.selected[0].text(),bytes.toString());assert.deepEqual(storedFileSource(f.selected[0]),{ownerId:'alice',sourceType:'original',id:'stored-1',sha256:sha});assert.equal(f.w.document.querySelector('dialog'),null);assert.equal(f.calls.some(call=>call.options.method==='POST'),false);
 assert.ok(f.calls.filter(call=>call.path!=='/api/auth/me').every(call=>call.options.headers['X-PaperKnow-User']==='alice'));
});
test('all files merges the same named content across original and cloud storage while each source remains selectable',async t=>{
 const f=await fixture(t,{handle:path=>path.startsWith('/api/artifacts?')?Response.json({items:[{...row,id:'copied-artifact'}]}):null});assert.equal(f.w.document.querySelectorAll('[data-picker-key]').length,1);assert.equal(f.w.document.querySelector('[data-picker-key]').dataset.pickerKey,'original:stored-1');f.w.document.querySelector('[data-picker-source="artifact"]').click();assert.equal(f.w.document.querySelector('[data-picker-key]').dataset.pickerKey,'artifact:copied-artifact');
});
test('search resets pagination and source filter keeps original vs generated files distinct',async t=>{
 let pages=0;const f=await fixture(t,{handle:path=>path.startsWith('/api/artifacts?')?Response.json({items:[{...row,id:'g'+(++pages),name:'生成稿'+pages+'.txt'}],nextCursor:pages===1?'cursor-one':null}):null});
 f.w.document.querySelector('[data-picker-more]').click();await settle(()=>f.w.document.querySelectorAll('[data-picker-key]').length===3);assert.match(f.calls.filter(call=>call.path.startsWith('/api/artifacts?')).at(-1).path,/cursor=cursor-one/);
 f.w.document.querySelector('[data-picker-source="original"]').click();assert.equal(f.w.document.querySelectorAll('[data-picker-key]').length,1);f.w.document.querySelector('[data-picker-source="all"]').click();f.w.document.querySelector('input[type=search]').value='研究';f.w.document.querySelector('form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await settle(()=>f.calls.filter(call=>call.path.startsWith('/api/artifacts?')).length===3);await flush();const url=f.calls.filter(call=>call.path.startsWith('/api/artifacts?')).at(-1).path;assert.ok(!url.includes('cursor='));assert.match(decodeURIComponent(url),/q=研究/);
});
test('an account change while file bytes arrive clears the previous owner list and never delivers the file',async t=>{
 let release,started;const gate=new Promise(resolve=>release=resolve),begin=new Promise(resolve=>started=resolve);const f=await fixture(t,{handle:async path=>{if(path.includes('/download')){started();await gate;return new Response(bytes);}}});f.w.document.querySelector('[data-picker-key]').click();await begin;f.setOwner('bob');release();await settle(()=>f.w.document.querySelector('[role=alert]'));assert.match(f.w.document.querySelector('[role=alert]').textContent,/账户已变化/);assert.equal(f.selected.length,0);assert.equal(f.w.document.querySelectorAll('[data-picker-key]').length,0);
});
test('real API ACCOUNT_CHANGED responses clear stale owner rows before a feature receives bytes',async t=>{
 let switched=false;const f=await fixture(t,{handle:(path,options)=>switched&&options.headers?.['X-PaperKnow-User']==='alice'?Response.json({error:'登录账户已变化',code:'ACCOUNT_CHANGED'},{status:409}):null});switched=true;f.w.document.querySelector('[data-picker-key]').click();await settle(()=>f.w.document.querySelector('[role=alert]'));assert.equal(f.w.document.querySelectorAll('[data-picker-key]').length,0);assert.equal(f.selected.length,0);assert.equal(f.calls.some(call=>call.path.includes('/download')),false);
});
test('a cloud read timeout restores selectable rows and shows a retryable error',async t=>{
 const f=await fixture(t,{requestTimeout:10,handle:async(path,options)=>{if(path.includes('/download'))return await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('abort'),{name:'AbortError'}))));}});f.w.document.querySelector('[data-picker-key]').click();await new Promise(resolve=>setTimeout(resolve,25));await settle(()=>/超时/.test(f.w.document.querySelector('.stored-file-status')?.textContent||''));assert.equal(f.w.document.querySelector('[data-picker-key]').disabled,false);assert.equal(f.selected.length,0);
});
test('hash mismatch cannot reach a feature; navigation closes and aborts in-flight cloud reads',async t=>{
 const f=await fixture(t,{handle:path=>path.includes('/download')?new Response(Buffer.alloc(bytes.length,65)):null});f.w.document.querySelector('[data-picker-key]').click();await settle(()=>/完整性/.test(f.w.document.querySelector('.stored-file-status')?.textContent||''));assert.equal(f.selected.length,0);
 let signal;const g=await fixture(t,{handle:async(path,options)=>{if(path.includes('/download')){signal=options.signal;await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('abort'),{name:'AbortError'}))));}}});g.w.document.querySelector('[data-picker-key]').click();await settle(()=>signal);g.w.location.hash='#home';await settle(()=>!g.w.document.querySelector('dialog'));assert.equal(signal.aborted,true);assert.equal(g.selected.length,0);
});
test('global installer adds one independent button per upload purpose and excludes management and backup uploads',async()=>{
 const dom=new JSDOM('<main id="app"><label>上传<input id="normal" type="file" accept=".docx"></label><input id="wf-file" type="file" hidden accept=".txt"><button data-wf-upload="material">资料</button><button data-wf-upload="outline">提纲</button><input id="cloud-upload-file" type="file" accept=".pdf"><input id="upload-file" type="file" accept=".pdf"><input id="settings-file" type="file" accept=".json"></main>'),root=dom.window.document.querySelector('main'),view=installStoredFilePickers(root);
 try{assert.equal(root.querySelectorAll('.stored-file-trigger').length,3);assert.equal(root.querySelector('label .stored-file-trigger'),null);root.append(dom.window.document.createElement('div'));await flush();assert.equal(root.querySelectorAll('.stored-file-trigger').length,3);}finally{view.dispose();dom.window.close();}
});
test('stored origin is held in a WeakMap and account validation precedes reuse; synthetic File properties cannot forge it',async()=>{
 const file={name:'资料.txt',sourceId:'fake'},calls=[];assert.equal(storedFileSource(file),null);assert.equal(await reuseStoredOriginal(file,{api:()=>assert.fail()}),null);bindStoredFile(file,{ownerId:'alice',sourceType:'original',id:'original-1',sha256:sha});await assert.rejects(reuseStoredOriginal(file,{api:()=>assert.fail(),expectedUserId:'bob'}),/账户已变化/);
 assert.deepEqual(await reuseStoredOriginal(file,{expectedUserId:'alice',projectId:'p1',api:async(path,body)=>{calls.push({path,body});return{id:'original-1'};}}),{id:'original-1'});assert.deepEqual(calls,[{path:'/files/reuse',body:{expectedUserId:'alice',sourceType:'original',sourceId:'original-1',expectedSha256:sha,projectId:'p1'}}]);
});
test('PDF selected from cloud reuses its original id without uploading a base64 copy',async()=>{
 const file=bindStoredFile({name:'文献.pdf',size:4},{ownerId:'alice',sourceType:'original',id:'saved-pdf',sha256:sha}),calls=[];
 const extract=createWorkspaceDocumentImporter({confirmImpl:message=>{assert.match(message,/无需重新上传/);return true;},fetchImpl:async(path,options)=>{calls.push({path,body:options.body&&JSON.parse(options.body)});if(path==='/api/auth/me')return Response.json({user:{id:'alice'}});if(path==='/api/capabilities')return Response.json({documentParsing:{ready:true}});if(path==='/api/files/reuse')return Response.json({id:'saved-pdf'});if(path==='/api/document-parses')return Response.json({id:'parse-1'});if(path==='/api/document-parses/parse-1')return Response.json({status:'completed',result:{text:'真实解析文本',pages:1}});throw Error('Unexpected '+path);}});
 const value=await extract(file);assert.equal(value.originalFileId,'saved-pdf');assert.equal(calls.some(call=>call.path==='/api/files'),false);assert.equal(calls.find(call=>call.path==='/api/document-parses').body.fileId,'saved-pdf');
});
test('DOCX template from file manager is still inspected and reuses the original without upload',async()=>{
 const bytes=Uint8Array.from([80,75,1,2]),file=bindStoredFile(new File([bytes],'学校模板.docx'),{ownerId:'alice',sourceType:'artifact',id:'cloud-template',sha256:sha}),calls=[];
 const value=await uploadThesisTemplate(file,{expectedUserId:'alice',api:async(path,body)=>{calls.push({path,body});return{id:'template-original'};},inspectTemplate:async value=>{assert.deepEqual(value,bytes);return{version:1,recognized:['body']};}});assert.equal(value.source.fileId,'template-original');assert.deepEqual(calls.map(call=>call.path),['/files/reuse']);
});


test('upload purposes may name their cloud action with inert text while retaining the receiving control and format',async()=>{
 const dom=new JSDOM('<main><label>样例<input id="sample" type="file" accept=".docx" aria-label="导入DOCX样例"></label><label>恢复<input id="rules" type="file" accept=".json,application/json"></label><label>普通上传<input id="plain" type="file" accept=".txt"></label></main>'),root=dom.window.document.querySelector('main');
 const sample=root.querySelector('#sample'),rules=root.querySelector('#rules'),custom='<img src=x onerror=alert(1)>从文件管理选择样例';
 sample.setAttribute('data-file-library-label',custom);rules.setAttribute('data-file-library-label','从文件管理恢复规则');
 const view=installStoredFilePickers(root);
 try{
  const buttons=[...root.querySelectorAll('.stored-file-trigger')];assert.equal(buttons.length,3);
  assert.equal(buttons[0].textContent,custom);assert.equal(buttons[0].getAttribute('aria-label'),custom);assert.equal(buttons[0].querySelector('img'),null);
  assert.equal(buttons[1].textContent,'从文件管理恢复规则');assert.equal(buttons[2].textContent,'从文件管理选择');
  assert.equal(root.querySelector('#sample'),sample);assert.equal(sample.accept,'.docx');assert.equal(rules.accept,'.json,application/json');assert.equal(sample.files.length,0);assert.equal(root.querySelector('label .stored-file-trigger'),null);
  // Re-inserting the same upload control must not produce another action.
  root.append(sample.closest('label'));await flush();assert.equal(root.querySelectorAll('.stored-file-trigger').length,3);
  assert.equal(sample.accept,'.docx');assert.equal(sample.files.length,0);
 }finally{view.dispose();dom.window.close();}
});
