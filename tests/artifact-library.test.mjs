import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountArtifactLibrary} from '../dist/workspace/artifact-library.mjs';

const item={id:'file-1',name:'生成文件<测试>.docx',kind:'docx',bytes:123,sha256:'a'.repeat(64),createdAt:'2026-10-18T01:00:00.000Z',status:'ready'};
const flush=()=>new Promise(r=>setImmediate(r));
test('account cloud files page, search and confirmed deletion operate only on the expected owner',async()=>{
 const dom=new JSDOM('<main class="dashboard"><section id="files"></section></main>',{url:'http://localhost/workspace.html#assets'}),root=dom.window.document.querySelector('#files'),requests=[],notices=[];
 let count=11;
 const view=mountArtifactLibrary(root,{session:async()=>({user:{id:'alice'}}),notify:v=>notices.push(v),fetchImpl:async(path,options)=>{requests.push([path,options]);if(options.method==='POST'){count--;return Response.json({ok:true});}return Response.json({items:[item],total:count,quotaBytes:524288000,usedBytes:123,maxFileBytes:20971520});}});
 try{
  await flush();assert.match(root.textContent,/生成文件<测试>.docx/);assert.equal(root.querySelector('测试'),null);assert.match(requests[0][0],/expectedUserId=alice/);
  root.querySelector('[data-cloud-page="2"]').click();await flush();assert.match(requests.at(-1)[0],/page=2/);
  root.querySelector('input').value='论文';root.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();assert.match(decodeURIComponent(requests.at(-1)[0]),/q=论文/);assert.match(requests.at(-1)[0],/page=1/);
  const previous=requests.length;root.querySelector('[data-cloud-remove]').click();assert.equal(requests.length,previous);assert.match(root.textContent,/删除后无法从云端恢复/);
  root.querySelector('[data-cloud-remove-confirm]').click();await flush();
  const deleted=requests.find(([url,options])=>options.method==='POST');assert.match(deleted[0],/file-1\/delete/);assert.deepEqual(JSON.parse(deleted[1].body),{expectedSha256:item.sha256,expectedUserId:'alice'});assert.match(notices.join(''),/已删除/);
 }finally{view.dispose();dom.window.close();}
});

test('guest and failed account reads never render a false empty success or reuse an old owner',async()=>{
 const dom=new JSDOM('<main class="dashboard"><section id="files"></section></main>'),root=dom.window.document.querySelector('#files');let user=null,calls=0;
 const view=mountArtifactLibrary(root,{session:async()=>({user}),fetchImpl:async()=>{calls++;return Response.json({error:'登录账户已变化'},{status:409});}});
 try{await flush();assert.equal(calls,0);assert.match(root.textContent,/登录后/);user={id:'bob'};await view.refresh();assert.equal(calls,1);assert.match(root.querySelector('[role=alert]').textContent,/账户已变化/);assert.doesNotMatch(root.textContent,/还没有生成文件/);}finally{view.dispose();dom.window.close();}
});

test('a disposed cloud file view cannot paint a late response on another page',async()=>{
 const dom=new JSDOM('<main class="dashboard"><section id="files"></section></main>'),root=dom.window.document.querySelector('#files');let finish;
 const pending=new Promise(r=>finish=r),view=mountArtifactLibrary(root,{session:async()=>({user:{id:'alice'}}),fetchImpl:async()=>{await pending;return Response.json({items:[item],total:1});}});
 try{await flush();view.dispose();root.innerHTML='新页面';finish();await flush();assert.equal(root.textContent,'新页面');}finally{view.dispose();dom.window.close();}
});
