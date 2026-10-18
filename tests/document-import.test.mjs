import {workspaceJobLabel,workspaceJobActive,workspaceJobStatusLabel} from '../dist/workspace/workspace-job-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {createWorkspaceDocumentImporter,importWorkspaceDocument,documentImportContinuesInBackground} from '../dist/workspace/document-import.mjs';
import {withStableView} from '../dist/workspace/view-stability.mjs';
import {esc,icon} from '../dist/workspace/ui.mjs';
import {mountWritingFlow,disposeWritingFlows} from '../dist/workspace/writing-flows.mjs';
import {clearEditor,editorRouteGuard} from '../dist/workspace/edit-guard.mjs';

const pdf=(name='论文.pdf',size=4)=>({name,size,arrayBuffer:async()=>new Uint8Array([37,80,68,70]).buffer});
const response=(value,status=200)=>({ok:status<400,status,json:async()=>value});
function fixture(options={}){
 const calls=[],events=[],confirmations=[];let polls=0;
 const done={id:'parse-1',status:'completed',stage:'completed',progress:100,result:{text:'真实解析正文，含扫描文字。',characters:14,pages:2,fileName:'论文.pdf',warnings:[],artifacts:[]}};
 const fetchImpl=async(url,init)=>{const body=init.body?JSON.parse(init.body):undefined;calls.push({url,init,body});if(options.handle){const value=await options.handle(url,init,body,calls);if(value)return value;}if(url==='/api/auth/me')return response({user:{id:'user-1'}});if(url==='/api/capabilities')return response({documentParsing:{ready:true,maxFileBytes:20971520,maxPages:100,consentRequired:true}});if(url==='/api/files')return response({id:'file-1'});if(url==='/api/document-parses')return response({id:'parse-1'});if(url==='/api/document-parses/parse-1/cancel')return response({status:'cancelled'});if(url==='/api/document-parses/parse-1'){polls++;return response(polls===1?{id:'parse-1',status:'running',stage:'ocr',progress:30}:done);}throw Error('unexpected request '+url);};
 const extract=createWorkspaceDocumentImporter({fetchImpl,extractFileImpl:options.extractFileImpl||(async()=>({text:'本地正文',warnings:[]})),confirmImpl:message=>{confirmations.push(message);return options.consent!==false;},sleepImpl:async(_ms,signal)=>{if(signal?.aborted)throw Object.assign(Error('abort'),{name:'AbortError'});},uuid:()=> 'stable-request-key',...options.config});
 return {extract,calls,events,confirmations,done,progress:event=>events.push(event)};
}

test('TXT and DOCX use the local parser without authentication, uploads or consent',async()=>{
 const f=fixture();for(const name of ['资料.txt','资料.docx'])assert.equal((await f.extract({name,size:10},{onProgress:f.progress})).text,'本地正文');assert.equal(f.calls.length,0);assert.equal(f.confirmations.length,0);assert.deepEqual(f.events.map(e=>e.stage),['local','local']);
});
test('PDF login and explicit cloud consent precede either POST, and include 20MB / 100-page scope',async()=>{
 const f=fixture();const result=await f.extract(pdf(),{onProgress:f.progress,projectId:'project-1'});
 assert.equal(result.text,f.done.result.text);assert.equal(result.documentParseId,'parse-1');assert.match(f.confirmations[0],/20MB、最多 100 页/);assert.match(f.confirmations[0],/上传至你的账户原件/);assert.match(f.confirmations[0],/第三方文档解析服务（MinerU）/);assert.match(f.confirmations[0],/离开页面只停止等待/);assert.match(f.confirmations[0],/上游可能仍在处理/);
 assert.deepEqual(f.calls.slice(0,4).map(c=>c.url),['/api/auth/me','/api/capabilities','/api/files','/api/document-parses']);assert.deepEqual(f.calls[2].body,{name:'论文.pdf',data:'JVBERg==',expectedUserId:'user-1',projectId:'project-1'});assert.deepEqual(f.calls[3].body,{fileId:'file-1',idempotencyKey:'stable-request-key',consent:true,expectedUserId:'user-1'});
 for(const call of f.calls){assert.equal(call.init.credentials,'same-origin');assert.equal(call.init.redirect,'error');}assert.ok(f.events.some(e=>e.stage==='ocr'&&typeof e.cancel==='function'));
});
test('PDF cancellation, logged-out state and disabled capability never upload',async()=>{
 for(const options of [{consent:false},{handle:url=>url==='/api/auth/me'?response({user:null}):null},{handle:url=>url==='/api/capabilities'?response({documentParsing:{ready:false}}):null}]){const f=fixture(options);await assert.rejects(f.extract(pdf()));assert.equal(f.calls.some(c=>c.init.method==='POST'),false);}
});
test('20MB PDF ceiling is checked before authentication and lower advertised ceiling is respected',async()=>{
 const f=fixture();await assert.rejects(f.extract(pdf('大.pdf',20971521)),/20MB/);assert.equal(f.calls.length,0);
 const g=fixture({handle:url=>url==='/api/capabilities'?response({documentParsing:{ready:true,maxFileBytes:1048576,maxPages:100}}):null});await assert.rejects(g.extract(pdf('大.pdf',1048577)),/1MB/);assert.equal(g.calls.some(c=>c.init.method==='POST'),false);
});
test('same File re-entry reuses original, task and request key after a failed POST response',async()=>{
 let submission=0;const f=fixture({handle:url=>{if(url==='/api/document-parses'&&++submission===1)throw Error('connection lost after submission');}}),file=pdf();
 await assert.rejects(f.extract(file),/connection lost/);assert.equal(f.calls.filter(c=>c.url==='/api/document-parses').length,1);assert.equal((await f.extract(file)).text,f.done.result.text);assert.equal(f.calls.filter(c=>c.url==='/api/files').length,1);assert.deepEqual(f.calls.filter(c=>c.url==='/api/document-parses').map(c=>c.body.idempotencyKey),['stable-request-key','stable-request-key']);
 await f.extract(file);assert.equal(f.calls.filter(c=>c.url==='/api/document-parses').length,2);
});
test('polling retries transient network failures only, never repeats upload or parse POST',async()=>{
 let reads=0;const f=fixture({handle:url=>{if(url==='/api/document-parses/parse-1'&&++reads<=2)throw Error('network');}});await f.extract(pdf(),{onProgress:f.progress});assert.equal(f.calls.filter(c=>c.url==='/api/files').length,1);assert.equal(f.calls.filter(c=>c.url==='/api/document-parses').length,1);assert.equal(f.events.filter(e=>e.stage==='reconnecting').length,2);
});
test('concurrent calls for the same File share one consent, original upload and parse submission',async()=>{
 let release,uploadStarted;const waiting=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{uploadStarted=resolve;}),f=fixture({handle:async url=>{if(url==='/api/files'){uploadStarted();await waiting;}}}),file=pdf();const first=f.extract(file);await started;const second=f.extract(file);await new Promise(resolve=>setImmediate(resolve));release();const [a,b]=await Promise.all([first,second]);assert.equal(a.text,b.text);assert.equal(f.confirmations.length,1);assert.equal(f.calls.filter(c=>c.url==='/api/files').length,1);assert.equal(f.calls.filter(c=>c.url==='/api/document-parses').length,1);
});
test('object page progress and each backend stage remain readable',async()=>{
 let index=0;const stages=['reading','recognizing','downloading','saving_wait'],f=fixture({handle:url=>url==='/api/document-parses/parse-1'&&index<stages.length?response({status:'running',stage:stages[index++],progress:{extractedPages:3,totalPages:10}}):null});await f.extract(pdf(),{onProgress:f.progress});for(const stage of stages){const event=f.events.find(e=>e.stage===stage);assert.equal(event.progress,30);assert.match(event.message,/已识别 3 \/ 10 页/);}assert.match(f.events.find(e=>e.stage==='saving_wait').message,/等待成果保存/);
});
test('unavailable OSS result reads instruct later task-center recovery without resubmitting',async()=>{
 const f=fixture({handle:url=>url==='/api/document-parses/parse-1'?response({error:'storage unavailable'},503):null}),file=pdf();await assert.rejects(f.extract(file),/任务中心稍后查看；无需重复提交/);await assert.rejects(f.extract(file),/任务中心稍后查看/);assert.equal(f.calls.filter(c=>c.url==='/api/files').length,1);assert.equal(f.calls.filter(c=>c.url==='/api/document-parses').length,1);
});
test('authorization failures during polling do not retry or cross-submit into a different session',async()=>{
 const f=fixture({handle:url=>url==='/api/document-parses/parse-1'?response({error:'当前账户无法读取此任务'},403):null});await assert.rejects(f.extract(pdf()),/当前账户/);assert.equal(f.calls.filter(c=>c.url==='/api/document-parses/parse-1').length,1);assert.equal(f.calls.filter(c=>c.url==='/api/document-parses').length,1);
});
test('account switches during confirmation or file reading are rejected before uploading into the new owner or submitting parsing',async()=>{
 const f=fixture({handle:(url,_init,body)=>url==='/api/files'?response({error:body.expectedUserId==='user-1'?'登录账户已变化，请重新选择文件':'缺少账户保护'},409):null});await assert.rejects(f.extract(pdf()),/登录账户已变化/);assert.equal(f.calls.find(c=>c.url==='/api/files').body.expectedUserId,'user-1');assert.equal(f.calls.some(c=>c.url==='/api/document-parses'),false);
});
test('leaving the page aborts polling without cancelling the cloud task',async()=>{
 const controller=new AbortController(),f=fixture();await assert.rejects(f.extract(pdf(),{signal:controller.signal,onProgress:event=>{if(event.jobId)controller.abort();}}),{name:'AbortError'});assert.equal(f.calls.some(c=>c.url.endsWith('/cancel')),false);
});
test('explicit cancel sends a single cancel request and surfaces final cancellation',async()=>{
 let cancelled=false;const f=fixture({handle:url=>{if(url.endsWith('/cancel')){cancelled=true;return response({status:'cancelled'});}if(url==='/api/document-parses/parse-1'&&cancelled)return response({status:'cancelled',stage:'cancelled'});}});
 await assert.rejects(f.extract(pdf(),{onProgress:event=>{if(event.cancel){void event.cancel();void event.cancel();}}}),/已停止本站解析任务；上游文档解析服务可能仍在处理/);assert.equal(f.calls.filter(c=>c.url.endsWith('/cancel')).length,1);
});
test('failed, empty, oversized-page and timed-out results cannot silently become imported text',async()=>{
 for(const result of [{status:'failed',error:'文档损坏'},{status:'completed',result:{text:''}},{status:'completed',result:{text:'正文',pages:101}}]){const f=fixture({handle:url=>url==='/api/document-parses/parse-1'?response(result):null});await assert.rejects(f.extract(pdf()));assert.equal(f.calls.filter(c=>c.url==='/api/document-parses').length,1);}
 let time=0;const f=fixture({config:{now:()=>time+=1000,maxWait:500}});await assert.rejects(f.extract(pdf()),/等待已超时/);assert.equal(f.calls.some(c=>c.url.endsWith('/cancel')),false);
});
test('removing a status area aborts browser waiting and removes its cancel action without server cancellation',async()=>{
 const dom=new JSDOM('<main><p id="status"></p></main>',{url:'https://paperknow.cn/workspace.html'}),old={window:globalThis.window,MutationObserver:globalThis.MutationObserver,fetch:globalThis.fetch};globalThis.window=dom.window;globalThis.MutationObserver=dom.window.MutationObserver;dom.window.confirm=()=>true;const calls=[];
 globalThis.fetch=async(url,init)=>{calls.push(url);if(url==='/api/auth/me')return response({user:{id:'u1'}});if(url==='/api/capabilities')return response({documentParsing:{ready:true,maxFileBytes:20971520,maxPages:100}});if(url==='/api/files')return response({id:'f1'});if(url==='/api/document-parses')return response({id:'p1'});return response({id:'p1',status:'running',stage:'ocr',progress:20});};
 try{const target=dom.window.document.getElementById('status');await assert.rejects(importWorkspaceDocument(pdf(),target,{onProgress:event=>{if(event.jobId){assert.match(target.textContent,/取消本站任务/);target.remove();}}}),{name:'AbortError'});assert.equal(calls.some(url=>url.endsWith('/cancel')),false);}finally{Object.assign(globalThis,old);dom.window.close();}
});

async function accountFixture(t,{view='projects',params='',jobs=[],result=null}={}){
 const dom=new JSDOM('<main class="dashboard"><div id="online"></div></main>',{url:'https://paperknow.cn/workspace.html',runScripts:'outside-only'}),w=dom.window,calls=[],navigations=[],exports=[],confirmations=[];
 const previous={window:globalThis.window,document:globalThis.document,MutationObserver:globalThis.MutationObserver,fetch:globalThis.fetch};Object.assign(globalThis,{window:w,document:w.document,MutationObserver:w.MutationObserver});w.confirm=message=>{confirmations.push(message);return true;};w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const parsed={text:'从 OSS 读取的真实解析正文 <script>不是代码</script>',characters:38,fileName:'扫描论文.pdf',pages:4,warnings:['请核对表格'],artifacts:[{id:'a1',name:'扫描论文.md',downloadUrl:'/api/artifacts/a1/download'},{name:'无效外链',downloadUrl:'https://example.invalid/file'}]};
 const fetcher=async(url,init={})=>{const body=init.body?JSON.parse(init.body):undefined;calls.push({url,body});if(url==='/api/capabilities')return response({ai:false,storage:'aliyun_oss',documentParsing:{ready:true,maxFileBytes:20971520,maxPages:100}});if(url==='/api/auth/me')return response({user:{id:'account-user'}});if(url==='/api/projects')return response({items:[{id:'p1',title:'账户项目',updated_at:'2026-10-18T00:00:00Z'}]});if(url==='/api/files')return response(body?{id:'f1'}:{items:[]});if(url==='/api/document-parses')return response({id:'parse-account'});if(url==='/api/document-parses/parse-account')return response(result?{status:'completed',result:parsed}:{status:'running',stage:'recognizing',progress:{extractedPages:2,totalPages:4}});if(url==='/api/jobs')return response({items:jobs});if(url==='/api/results')return response({items:result?[result]:[]});if(url==='/api/results/r1')return response({item:result});if(url==='/api/workspace/drafts'||url==='/api/theses')return response({items:[]});if(url==='/api/workspace/summary')return response({counts:{projects:1,files:0,drafts:0,results:result?1:0},storage:{},usage:{records:0}});throw Error('Unexpected '+url);};
 w.fetch=fetcher;globalThis.fetch=fetcher;Object.assign(w,{workspaceJobLabel,workspaceJobActive,workspaceJobStatusLabel,esc,icon,withStableView,importWorkspaceDocument,documentImportContinuesInBackground,publicDraftCopy:value=>value,list:()=>[],keys:{drafts:'test'},renderOnlinePersonal:async()=>false,download:async(name,text)=>{exports.push({name,text});return{message:'已导出'};}});
 const code=(await readFile(new URL('../dist/workspace/online-workspace.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');w.eval(code+'\nwindow.accountDocumentTest={mountOnlineWorkspace,disposeOnlineWorkspace};');
 await w.accountDocumentTest.mountOnlineWorkspace(w.document.getElementById('online'),view,{navigate:href=>navigations.push(href)},new w.URLSearchParams(params));
 t.after(()=>{w.accountDocumentTest.disposeOnlineWorkspace();Object.assign(globalThis,previous);w.close();});return{w,calls,navigations,exports,confirmations,parsed,setResult:value=>{result=value;},$:selector=>w.document.querySelector(selector)};
}
const settle=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('UI did not settle');};
test('account PDF upload uses the new cloud service and routes the queued task to its project without legacy parse submission',async t=>{
 const f=await accountFixture(t);const file=pdf('扫描论文.pdf',3*1024*1024);Object.defineProperty(f.$('#upload-file'),'files',{value:[file]});f.$('#upload-project').value='p1';f.$('#upload-form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await settle(()=>f.navigations.length>0);assert.deepEqual(f.navigations,['#tasks?scope=account&project=p1']);assert.equal(f.calls.find(c=>c.url==='/api/files'&&c.body).body.projectId,'p1');assert.equal(f.calls.find(c=>c.url==='/api/document-parses').body.expectedUserId,'account-user');assert.equal(f.calls.some(c=>c.url==='/api/jobs'&&c.body),false);assert.match(f.confirmations[0],/MinerU/);assert.match(f.$('#account-document-progress').textContent,/2 \/ 4 页/);f.w.accountDocumentTest.disposeOnlineWorkspace();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.some(c=>c.url.endsWith('/cancel')),false);
});
test('PDF task lists prohibit generic retry, and results fetch OSS-backed text and export it without revision endpoints',async t=>{
 const failed={id:'pdf-failed',type:'document_parse',status:'failed',error:'解析失败',attempt:1,created_at:'2026-10-18T00:00:00Z'},f=await accountFixture(t,{view:'tasks',jobs:[failed]});assert.match(f.$('#job-list').textContent,/PDF 云解析/);assert.equal(f.$('[data-action="retry"]'),null);
 const result={id:'r1',type:'document_parse',title:'PDF 解析成果',created_at:'2026-10-18T00:00:00Z',body:{documentParseId:'parse-account',fileName:'扫描论文.pdf',characters:38,pages:4}};f.setResult(result);await f.w.accountDocumentTest.mountOnlineWorkspace(f.$('#online'),'results',{},new f.w.URLSearchParams('result=r1'));
 assert.match(f.$('#result-detail').textContent,/从 OSS 读取的真实解析正文/);assert.equal(f.$('#result-detail script'),null);assert.ok(f.$('a[href="/api/artifacts/a1/download"]'));assert.equal(f.$('a[href="https://example.invalid/file"]'),null);f.$('#export-result').click();await settle(()=>f.exports.length>0);assert.equal(f.exports[0].text,f.parsed.text);assert.equal(f.calls.some(c=>c.url.includes('/revisions')),false);
});

async function flowPdfFixture(t,{completedText=null}={}){
 const dom=new JSDOM('<main class="dashboard"></main><dialog id="workspace-dialog"></dialog>',{url:'https://paperknow.cn/workspace.html#tool/proposal'}),w=dom.window,calls=[],names=['window','document','MutationObserver','location','localStorage','fetch'],previous=Object.fromEntries(names.map(key=>[key,globalThis[key]]));
 for(const key of names.filter(key=>key!=='fetch'))globalThis[key]=key==='window'?w:w[key];w.confirm=()=>true;
 globalThis.fetch=async(url,init={})=>{calls.push({url,body:init.body?JSON.parse(init.body):undefined});if(url==='/api/auth/me')return response({user:{id:'flow-user'}});if(url==='/api/capabilities')return response({documentParsing:{ready:true,maxFileBytes:20971520,maxPages:100}});if(url==='/api/files')return response({id:'flow-file'});if(url==='/api/document-parses')return response({id:'flow-parse'});if(url==='/api/document-parses/flow-parse')return response(completedText?{id:'flow-parse',status:'completed',stage:'completed',result:{text:completedText,pages:2,warnings:[]}}:{id:'flow-parse',status:'running',stage:'recognizing',progress:{extractedPages:1,totalPages:2}});throw Error('Unexpected '+url);};
 mountWritingFlow({kind:'proposal',ctx:{notify(){}}});const $=selector=>w.document.querySelector(selector);$('#writing-title').value='扫描研究资料验收';$('#writing-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));$('#wf-file').dataset.mode='material';Object.defineProperty($('#wf-file'),'files',{value:[pdf()]});$('#wf-file').dispatchEvent(new w.Event('change',{bubbles:true}));
 t.after(()=>{clearEditor();disposeWritingFlows();$('.dashboard').replaceChildren();Object.assign(globalThis,previous);w.close();});return {w,$,calls};
}
test('a queued PDF can continue in the background while the writing editor saves and leaves normally',async t=>{
 const f=await flowPdfFixture(t);await settle(()=>f.$('[data-document-import-job]'));assert.equal(documentImportContinuesInBackground(f.$('.dashboard')),true);assert.equal(editorRouteGuard('#home'),true);clearEditor();f.$('.dashboard').innerHTML='<p>另一页面</p>';await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.some(c=>c.url.endsWith('/cancel')),false);assert.match(f.$('.dashboard').textContent,/另一页面/);
});
test('cloud OCR does not bypass the writing material character budget or silently replace existing inputs',async t=>{
 const f=await flowPdfFixture(t,{completedText:'文'.repeat(30001)});await settle(()=>/30,000/.test(f.$('[data-wf-error]')?.textContent||''));assert.match(f.$('[data-wf-error]').textContent,/最多 30,000 字符/);assert.equal(f.$('.wf-material-list').children.length,0);assert.equal(f.calls.filter(c=>c.url==='/api/document-parses').length,1);
});
