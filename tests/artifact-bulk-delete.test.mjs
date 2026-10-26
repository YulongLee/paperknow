import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountArtifactLibrary} from '../dist/workspace/artifact-library.mjs';
const settle=async check=>{for(let i=0;i<1000;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('file operation did not settle');};
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const file=(id,extra={})=>({id,name:'合成文件'+id+'.docx',kind:'docx',bytes:100,sha256:'a'.repeat(64),status:'ready',version:1,createdAt:'2026-10-26T00:00:00Z',...extra});
async function fixture(t,{count=12,originalCount=3,remove,session,firstName}={}){
 const dom=new JSDOM('<main class="dashboard"><section id="files"></section></main>',{url:'http://localhost/workspace.html#assets'}),root=dom.window.document.querySelector('#files'),calls=[],notices=[];
 let account='alice',cloud=Array.from({length:count},(_,i)=>file('f'+i,i===0&&firstName?{name:firstName}:{})),originals=Array.from({length:originalCount},(_,i)=>file('o'+i,{name:'合成材料'+i+'.docx',created_at:'2026-10-26T00:00:00Z'}));
 const view=mountArtifactLibrary(root,{session:session||(async()=>({user:{id:account}})),notify:value=>notices.push(value),fetchImpl:async(path,options)=>{
  const body=options.body&&JSON.parse(options.body);calls.push({path,options,body});
  if(path==='/api/projects')return Response.json({items:[]});
  if(path.startsWith('/api/files?'))return Response.json({items:originals});
  if(path.startsWith('/api/artifacts?')){const query=new URL(path,'http://local').searchParams,p=Number(query.get('page'));return Response.json({items:cloud.slice((p-1)*10,p*10),total:cloud.length,usedBytes:cloud.length*100,quotaBytes:524288000,storageReady:true});}
  if(path.endsWith('/delete')){const id=path.split('/')[3],isOriginal=path.startsWith('/api/files/');assert.equal(options.headers['X-PaperKnow-User'],'alice');assert.equal(body.expectedSha256,'a'.repeat(64));if(!isOriginal)assert.equal(body.expectedUserId,'alice');const result=await remove?.({id,isOriginal,body});if(result)return result;if(isOriginal)originals=originals.filter(row=>row.id!==id);else cloud=cloud.filter(row=>row.id!==id);return Response.json({ok:true,id,deleted:true});}
  throw Error('Unexpected '+path);
 }});
 t.after(()=>{view.dispose();dom.window.close();});await settle(()=>root.querySelector('[data-cloud-file]')||count===0&&root.querySelector('[data-file-bulk]'));
 return {root,dom,calls,notices,view,get cloud(){return cloud;},setAccount:value=>{account=value;},select(id,area='cloud',checked=true){const input=root.querySelector('[data-bulk-select="'+area+'"][value="'+id+'"]');input.checked=checked;input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));},all(area='cloud',checked=true){const input=root.querySelector('[data-bulk-all="'+area+'"]');input.checked=checked;input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));},click(selector){root.querySelector(selector).click();},async originals(){root.querySelector('[data-original-toggle]').click();await settle(()=>root.querySelector('[data-original-file]'));}};
}
const removed=f=>f.calls.filter(row=>row.path.endsWith('/delete'));

test('bulk selection supports partial and all-page state without losing an unsaved rename; confirmation can cancel safely',async t=>{
 const f=await fixture(t);f.click('[data-cloud-edit]');f.root.querySelector('.cloud-artifact-metadata input').value='尚未保存的名称.docx';f.select('f0');assert.equal(f.root.querySelector('[data-bulk-all="cloud"]').indeterminate,true);f.all();assert.equal(f.root.querySelectorAll('[data-bulk-select="cloud"]:checked').length,10);assert.equal(f.root.querySelector('.cloud-artifact-metadata input').value,'尚未保存的名称.docx');f.click('[data-bulk-remove="cloud"]');assert.equal(removed(f).length,0);assert.match(f.root.querySelector('[role=alertdialog]').textContent,/10 个云端文件/);f.click('[data-bulk-cancel]');assert.equal(f.root.querySelector('[role=alertdialog]'),null);assert.equal(removed(f).length,0);f.click('[data-bulk-clear="cloud"]');assert.equal(f.root.querySelectorAll('[data-bulk-select]:checked').length,0);assert.equal(f.root.querySelector('[data-bulk-remove="cloud"]').disabled,true);
});

test('cross-page bulk deletion removes only selected files, refreshes totals and storage, and corrects an emptied last page',async t=>{
 const f=await fixture(t);f.select('f0');f.click('[data-cloud-page="2"]');await settle(()=>f.root.querySelector('[data-cloud-file="f10"]'));f.all();assert.match(f.root.querySelector('[data-file-bulk="cloud"]').textContent,/已选 3 个/);f.click('[data-bulk-remove="cloud"]');assert.match(f.root.querySelector('[role=alertdialog]').textContent,/f0/);f.click('[data-bulk-confirm="cloud"]');await settle(()=>f.root.textContent.includes('已删除 3 个文件。')&&f.root.querySelector('[data-bulk-clear="cloud"]').disabled===true);assert.deepEqual(removed(f).map(row=>row.path.split('/')[3]),['f0','f10','f11']);assert.equal(f.cloud.length,9);assert.match(f.root.querySelector('.cloud-artifact-footer').textContent,/共 9 个文件 · 第 1 \/ 1 页/);assert.match(f.root.querySelector('.cloud-artifact-overview').textContent,/900 B/);assert.equal(f.root.querySelectorAll('[data-bulk-select]:checked').length,0);
});

test('partial delete failures remain selected with their actual reason; retry never repeats successful deletions',async t=>{
 let fail=true;const f=await fixture(t,{count:3,remove:({id})=>id==='f1'&&fail?Response.json({error:'OSS暂不可用，删除待重试'},{status:503}):null});f.all();f.click('[data-bulk-remove="cloud"]');f.click('[data-bulk-confirm="cloud"]');await settle(()=>f.root.textContent.includes('已删除 2 个文件，1 个未删除')&&f.root.querySelector('[data-bulk-select="cloud"]')?.checked);assert.equal(f.root.querySelector('[data-bulk-select="cloud"]').value,'f1');assert.match(f.root.querySelector('.cloud-file-bulk-failures').textContent,/f1.*OSS暂不可用/);assert.equal(removed(f).length,3);fail=false;f.click('[data-bulk-remove="cloud"]');f.click('[data-bulk-confirm="cloud"]');await settle(()=>f.root.textContent.includes('已删除 1 个文件。'));assert.deepEqual(removed(f).map(row=>row.path.split('/')[3]),['f0','f1','f2','f1']);assert.equal(f.cloud.length,0);
});

test('uploaded materials support bulk deletion while in-use template protections retain the blocked original and generated files',async t=>{
 const f=await fixture(t,{count:1,remove:({id,isOriginal})=>isOriginal&&id==='o1'?Response.json({error:'原件正在作为论文导出模板使用，请先更换模板'},{status:409}):null});await f.originals();f.all('original');f.click('[data-bulk-remove="original"]');assert.match(f.root.querySelector('[role=alertdialog]').textContent,/材料原件/);f.click('[data-bulk-confirm="original"]');await settle(()=>f.root.textContent.includes('已删除 2 个文件，1 个未删除')&&f.root.querySelectorAll('[data-original-file]').length===1);assert.equal(f.root.querySelector('[data-original-file]').dataset.originalFile,'o1');assert.equal(f.root.querySelector('[data-bulk-select="original"]').checked,true);assert.match(f.root.querySelector('.cloud-file-bulk-failures').textContent,/更换模板/);assert.equal(f.root.querySelectorAll('[data-cloud-file]').length,1);assert.ok(removed(f).every(row=>row.path.startsWith('/api/files/')));assert.match(f.root.querySelector('.cloud-original-toggle').textContent,/1 份/);
});

test('changing search conditions clears cross-page selections and cannot delete hidden choices',async t=>{
 const f=await fixture(t);f.select('f0');const form=f.root.querySelector('.cloud-artifact-search');form.querySelector('input').value='新条件';form.dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle(()=>f.root.querySelector('[data-bulk-remove="cloud"]'));assert.equal(f.root.querySelector('[data-bulk-remove="cloud"]').disabled,true);assert.equal(removed(f).length,0);
});

test('account switches stop a batch before the next delete and do not expose old selected filenames',async t=>{
 let release,started=false;const gate=new Promise(resolve=>release=resolve),f=await fixture(t,{count:3,remove:async()=>{started=true;await gate;}});f.all();f.click('[data-bulk-remove="cloud"]');f.click('[data-bulk-confirm="cloud"]');await settle(()=>started);assert.equal(f.root.querySelector('[data-bulk-all="cloud"]').disabled,true);assert.match(f.root.textContent,/正在删除 0 \/ 3/);f.setAccount('bob');release();await settle(()=>f.root.textContent.includes('账户已变化'));assert.equal(removed(f).length,1);assert.equal(f.root.querySelector('[data-bulk-select]'),null);assert.doesNotMatch(f.root.textContent,/合成文件/);
});

test('leaving the file manager stops dispatching the rest of a batch and preserves the replacement page',async t=>{
 let release,started=false;const gate=new Promise(resolve=>release=resolve),f=await fixture(t,{count:3,remove:async()=>{started=true;await gate;}});f.all();f.click('[data-bulk-remove="cloud"]');f.click('[data-bulk-confirm="cloud"]');await settle(()=>started);f.view.dispose();f.root.innerHTML='另一个功能';release();await flush();assert.equal(removed(f).length,1);assert.equal(f.root.textContent,'另一个功能');
});

test('selection names are escaped and a different account refresh cannot inherit them',async t=>{
 const f=await fixture(t,{count:1,firstName:'<img src=x onerror=alert(1)>.docx'});f.root.querySelector('[data-bulk-select]').focus();f.select('f0');f.click('[data-bulk-remove="cloud"]');assert.equal(f.root.querySelector('img'),null);assert.match(f.root.querySelector('[role=alertdialog]').textContent,/<img/);f.setAccount('bob');await f.view.refresh({preserveSelection:true});assert.equal(f.root.querySelector('[data-bulk-remove="cloud"]').disabled,true);assert.equal(f.root.querySelector('[data-bulk-select]').checked,false);assert.equal(removed(f).length,0);
});

test('an unconfirmed server reply is never reported as a deleted file and remains available for review',async t=>{
 const f=await fixture(t,{count:2,remove:()=>Response.json({ok:true})});f.all();f.click('[data-bulk-remove="cloud"]');f.click('[data-bulk-confirm="cloud"]');await settle(()=>f.root.textContent.includes('已删除 0 个文件，2 个未删除')&&f.root.querySelectorAll('[data-bulk-select]:checked').length===2);assert.equal(f.cloud.length,2);assert.match(f.root.querySelector('.cloud-file-bulk-failures').textContent,/删除结果无法确认/);
});

test('session service failures stop the batch and release the controls without claiming deletion or losing selection',async t=>{
 let fail=false;const f=await fixture(t,{count:2,session:async()=>{if(fail)throw Error('暂时无法核对登录状态');return{user:{id:'alice'}};}});f.all();f.click('[data-bulk-remove="cloud"]');fail=true;f.click('[data-bulk-confirm="cloud"]');await settle(()=>f.root.textContent.includes('批量删除已停止'));assert.equal(removed(f).length,0);assert.equal(f.root.querySelectorAll('[data-bulk-select]:checked').length,2);assert.equal(f.root.querySelector('[data-bulk-remove="cloud"]').disabled,false);assert.match(f.root.textContent,/暂时无法核对登录状态/);
});
