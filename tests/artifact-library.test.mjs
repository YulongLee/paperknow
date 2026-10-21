import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountArtifactLibrary} from '../dist/workspace/artifact-library.mjs';

const item={id:'file-1',name:'生成文件<测试>.docx',kind:'docx',bytes:123,sha256:'a'.repeat(64),createdAt:'2026-10-18T01:00:00.000Z',status:'ready',version:1};
const flush=()=>new Promise(r=>setImmediate(r));
test('account cloud files page, search and confirmed deletion operate only on the expected owner',async()=>{
 const dom=new JSDOM('<main class="dashboard"><section id="files"></section></main>',{url:'http://localhost/workspace.html#assets'}),root=dom.window.document.querySelector('#files'),requests=[],notices=[];
 let count=11;
 const view=mountArtifactLibrary(root,{session:async()=>({user:{id:'alice'}}),notify:v=>notices.push(v),fetchImpl:async(path,options)=>{requests.push([path,options]);if(path==='/api/projects')return Response.json({items:[]});if(options.method==='POST'){count--;return Response.json({ok:true});}return Response.json({items:[item],total:count,quotaBytes:524288000,usedBytes:123,maxFileBytes:20971520});}});
 try{
  await flush();assert.match(root.textContent,/生成文件<测试>.docx/);assert.equal(root.querySelector('测试'),null);assert.match(requests[0][0],/expectedUserId=alice/);
  root.querySelector('[data-cloud-page="2"]').click();await flush();assert.match(requests.filter(([url])=>url.startsWith('/api/artifacts?')).at(-1)[0],/page=2/);
  root.querySelector('input').value='论文';root.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();assert.match(decodeURIComponent(requests.filter(([url])=>url.startsWith('/api/artifacts?')).at(-1)[0]),/q=论文/);assert.match(requests.filter(([url])=>url.startsWith('/api/artifacts?')).at(-1)[0],/page=1/);
  const previous=requests.length;root.querySelector('[data-cloud-remove]').click();assert.equal(requests.length,previous);assert.match(root.textContent,/删除后无法从云端恢复/);
  root.querySelector('[data-cloud-remove-confirm]').click();await flush();
  const deleted=requests.find(([url,options])=>options.method==='POST');assert.match(deleted[0],/file-1\/delete/);assert.deepEqual(JSON.parse(deleted[1].body),{expectedSha256:item.sha256,expectedUserId:'alice'});assert.match(notices.join(''),/已删除/);
 }finally{view.dispose();dom.window.close();}
});

test('guest and failed account reads never render a false empty success or reuse an old owner',async()=>{
 const dom=new JSDOM('<main class="dashboard"><section id="files"></section></main>'),root=dom.window.document.querySelector('#files');let user=null,calls=0;
 const view=mountArtifactLibrary(root,{session:async()=>({user}),fetchImpl:async()=>{calls++;return Response.json({error:'登录账户已变化'},{status:409});}});
 try{await flush();assert.equal(calls,0);assert.match(root.textContent,/登录后/);user={id:'bob'};await view.refresh();assert.equal(calls,2);assert.match(root.querySelector('[role=alert]').textContent,/账户已变化/);assert.doesNotMatch(root.textContent,/还没有生成文件/);}finally{view.dispose();dom.window.close();}
});

test('a disposed cloud file view cannot paint a late response on another page',async()=>{
 const dom=new JSDOM('<main class="dashboard"><section id="files"></section></main>'),root=dom.window.document.querySelector('#files');let finish;
 const pending=new Promise(r=>finish=r),view=mountArtifactLibrary(root,{session:async()=>({user:{id:'alice'}}),fetchImpl:async()=>{await pending;return Response.json({items:[item],total:1});}});
 try{await flush();view.dispose();root.innerHTML='新页面';finish();await flush();assert.equal(root.textContent,'新页面');}finally{view.dispose();dom.window.close();}
});

test('switching accounts while cloud bytes arrive cannot trigger the old account download',async()=>{
 const dom=new JSDOM('<main class="dashboard"><section id="files"></section></main>'),root=dom.window.document.querySelector('#files'),notices=[];let account='alice';
 const view=mountArtifactLibrary(root,{session:async()=>({user:{id:account}}),notify:value=>notices.push(value),fetchImpl:async(path,options)=>{assert.equal(options.headers['X-PaperKnow-User'],'alice');if(path.includes('/download'))return {ok:true,async blob(){account='bob';return new Blob([new Uint8Array(item.bytes)]);}};return Response.json({items:[item],total:1});}});
 try{await flush();root.querySelector('[data-cloud-download]').click();await flush();await flush();assert.match(notices.join(''),/账户已变化.*停止下载/);assert.doesNotMatch(notices.join(''),/已发起云文件下载/);assert.equal(root.querySelector('[data-cloud-download]'),null);assert.doesNotMatch(root.textContent,/生成文件<测试>/);}finally{view.dispose();dom.window.close();}
});

test('a late list response is not painted after its owner changes',async()=>{
 const dom=new JSDOM('<main class="dashboard"><section id="files"></section></main>'),root=dom.window.document.querySelector('#files');let checks=0;
 const view=mountArtifactLibrary(root,{session:async()=>({user:{id:++checks===1?'alice':'bob'}}),fetchImpl:async()=>Response.json({items:[item],total:1})});
 try{await flush();assert.match(root.textContent,/账户已变化/);assert.equal(root.querySelector('[data-cloud-download]'),null);assert.doesNotMatch(root.textContent,/生成文件<测试>/);}finally{view.dispose();dom.window.close();}
});

test('disposing a download aborts the body stream after response headers have arrived',async()=>{const dom=new JSDOM('<main class="dashboard"><section id="files"></section></main>'),root=dom.window.document.querySelector('#files');let bodySignal;const view=mountArtifactLibrary(root,{session:async()=>({user:{id:'alice'}}),fetchImpl:async(path,options)=>path.includes('/download')?{ok:true,blob:()=>new Promise((resolve,reject)=>{bodySignal=options.signal;bodySignal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true});})}:Response.json({items:[item],total:1})});try{await flush();root.querySelector('[data-cloud-download]').click();await flush();assert.equal(bodySignal.aborted,false);view.dispose();await flush();assert.equal(bodySignal.aborted,true);}finally{view.dispose();dom.window.close();}});

async function manager(t,{request,session=async()=>({user:{id:'alice'}})}={}){
 const dom=new JSDOM('<main class="dashboard"><section id="files"></section></main>',{url:'http://localhost/workspace.html#assets'}),root=dom.window.document.querySelector('#files'),calls=[],notices=[];
 const view=mountArtifactLibrary(root,{session,notify:v=>notices.push(v),fetchImpl:async(path,options)=>{calls.push({path,options,body:options.body&&JSON.parse(options.body)});const custom=await request?.(path,options);if(custom)return custom;if(path==='/api/projects')return Response.json({items:[{id:'project-one',title:'我的研究项目'}]});return Response.json({items:[{...item,projectId:'project-one'}],total:1,storageReady:true,quotaBytes:524288000,usedBytes:123,maxFileBytes:20971520});}});
 t.after(()=>{view.dispose();dom.window.close();});await flush();await flush();return {dom,root,calls,notices,view};
}
function submitForm(dom,form){form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));}
test('cloud file manager filters formats and projects and saves metadata with the displayed version',async t=>{
 const f=await manager(t,{request:async(path)=>path.endsWith('/metadata')?Response.json({item:{...item,version:2}}):null});
 assert.match(f.root.textContent,/我的研究项目/);assert.match(f.root.textContent,/私有存储/);
 const search=f.root.querySelector('.cloud-artifact-search');search.querySelector('[name=kind]').value='pdf';search.querySelector('[name=project]').value='project-one';submitForm(f.dom,search);await flush();await flush();
 const read=f.calls.filter(c=>c.path.startsWith('/api/artifacts?')).at(-1);assert.match(read.path,/kind=pdf/);assert.match(read.path,/projectId=project-one/);
 f.root.querySelector('[data-cloud-edit]').click();const editor=f.root.querySelector('.cloud-artifact-metadata');editor.querySelector('[name=name]').value='研究成果.docx';editor.querySelector('[name=projectId]').value='';submitForm(f.dom,editor);await flush();await flush();
 const mutation=f.calls.find(c=>c.path.endsWith('/metadata'));assert.deepEqual(mutation.body,{version:1,name:'研究成果.docx',projectId:null,expectedUserId:'alice'});assert.equal(mutation.options.headers['X-PaperKnow-User'],'alice');assert.match(f.notices.join(''),/已保存/);
});

test('uploads require a selected file and explicit submit, preserve original bytes and bind the owner',async t=>{
 const f=await manager(t,{request:async(path,options)=>path==='/api/artifacts'&&options.method==='POST'?Response.json({item:{id:'uploaded'}}):null});
 f.dom.window.localStorage.setItem('paperknow-drafts',JSON.stringify([{title:'旧草稿不可自动上传',body:'原始内容'}]));
 f.root.querySelector('[data-cloud-upload-open]').click();assert.equal(f.calls.some(c=>c.body),false);
 const form=f.root.querySelector('.cloud-artifact-upload'),bytes=Uint8Array.from([97,98,99]);Object.defineProperty(form.querySelector('input[type=file]'),'files',{value:[{name:'研究.txt',size:3,arrayBuffer:async()=>bytes.buffer}]});form.querySelector('select').value='project-one';submitForm(f.dom,form);await flush();await flush();
 const uploaded=f.calls.find(c=>c.path==='/api/artifacts'&&c.body);assert.deepEqual(uploaded.body,{name:'研究.txt',data:'YWJj',sourceType:'other',expectedUserId:'alice',projectId:'project-one'});assert.equal(uploaded.options.headers['X-PaperKnow-User'],'alice');assert.match(f.dom.window.localStorage.getItem('paperknow-drafts'),/旧草稿不可自动上传/);assert.equal(f.root.querySelector('.cloud-artifact-upload'),null);
});

test('metadata conflicts preserve the user input and never retry an obsolete version automatically',async t=>{
 const f=await manager(t,{request:async(path)=>path.endsWith('/metadata')?Response.json({error:'文件已被其他页面修改，请刷新后重试',code:'VERSION_CONFLICT'},{status:409}):null});
 f.root.querySelector('[data-cloud-edit]').click();const form=f.root.querySelector('.cloud-artifact-metadata');form.querySelector('input').value='保留本次修改.docx';submitForm(f.dom,form);await flush();await flush();
 assert.equal(form.querySelector('input').value,'保留本次修改.docx');assert.match(form.querySelector('[role=alert]').textContent,/其他页面修改/);assert.equal(f.calls.filter(c=>c.path.endsWith('/metadata')).length,1);assert.equal(form.querySelector('[type=submit]').disabled,false);
});

test('invalid file names and oversize uploads are rejected before sending a mutation',async t=>{
 const f=await manager(t);f.root.querySelector('[data-cloud-edit]').click();let form=f.root.querySelector('.cloud-artifact-metadata');form.querySelector('input').value='错改格式.pdf';submitForm(f.dom,form);await flush();assert.match(form.querySelector('[role=alert]').textContent,/保留 .docx/);
 f.root.querySelector('[data-cloud-upload-open]').click();form=f.root.querySelector('.cloud-artifact-upload');Object.defineProperty(form.querySelector('input[type=file]'),'files',{value:[{name:'太大.pdf',size:20971521}]});submitForm(f.dom,form);await flush();assert.match(form.querySelector('[role=alert]').textContent,/不能超过/);assert.equal(f.calls.some(c=>c.body),false);
});

test('changing accounts while encoding an upload stops before any bytes are submitted',async t=>{
 let account='alice',encode;const encoded=new Promise(r=>encode=r),f=await manager(t,{session:async()=>({user:{id:account}})});
 f.root.querySelector('[data-cloud-upload-open]').click();const form=f.root.querySelector('.cloud-artifact-upload');Object.defineProperty(form.querySelector('input[type=file]'),'files',{value:[{name:'私密.txt',size:3,arrayBuffer:async()=>{await encoded;return new Uint8Array([97,98,99]).buffer;}}]});submitForm(f.dom,form);await flush();account='bob';encode();await flush();await flush();
 assert.equal(f.calls.some(c=>c.body),false);assert.match(f.root.textContent,/账户已变化/);assert.doesNotMatch(f.root.textContent,/生成文件<测试>/);
});
