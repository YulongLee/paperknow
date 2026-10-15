import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
let bridge,state,writing,edit;
async function settle(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,3));}throw Error('UI did not settle');}
async function fixture(t,{conflict=false,userChanged=false,gate=null,loadGate=null,onLoading=null}={}){
 const dom=new JSDOM('<aside class="sidebar"></aside><header class="breadcrumb"><strong></strong></header><main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.cn/workspace.html#account-draft/d1'});
 for(const key of ['window','document','localStorage','location','FormData','AbortController','MutationObserver'])globalThis[key]=dom.window[key];
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
 bridge=await import('../dist/workspace/account-draft-editor.mjs');state=await import('../dist/workspace/state.mjs');writing=await import('../dist/workspace/writing.mjs');edit=await import('../dist/workspace/edit-guard.mjs');
 const local=[{id:'local-one',tool:'writing',title:'仅在本地的私人草稿',text:'不会自动上传'}];localStorage.setItem('paperknow-drafts',JSON.stringify(local));
 const item={id:'d1',tool:'writing',title:'账户研究草稿',project_id:'p1',version:2,payload:{title:'账户研究草稿',tool:'writing',text:'第一章 绪论',outlineText:'第一章 绪论',degree:'本科',workflowStage:1,material:'真实参考材料',exportUnlocked:true,html:'<img src=x onerror=alert(1)><p>真实内容</p>'}};
 const calls=[],notices=[];let authCalls=0;
 globalThis.fetch=async(path,options={})=>{const body=options.body?JSON.parse(options.body):undefined;calls.push({path,body});let status=200,value={};if(path==='/api/auth/me')value={user:{id:++authCalls>1&&userChanged?'u2':'u1'}};else if(path==='/api/projects')value={items:[{id:'p1',title:'账户项目'}]};else if(path==='/api/workspace/drafts/d1'&&!body){if(loadGate)await loadGate.promise;value={item};}else if(path==='/api/workspace/drafts/d1'&&body){if(gate)await gate.promise;status=conflict?409:200;value=conflict?{error:'版本已更新'}:{item:{...item,...body,payload:body.payload,version:3}};}else throw Error('Unexpected request '+path);return {ok:status<400,status,json:async()=>value};};
 const ctx={notify:message=>notices.push(message),modal:(_,html)=>{document.querySelector('#workspace-dialog-body').innerHTML=html;document.querySelector('#workspace-dialog').showModal();},mount:d=>writing.mountWriting(d.id,undefined,ctx),saveNative:async()=>{const before=state.draftScopeRevision();document.querySelector('#writing-save').click();return state.draftScopeRevision()>before;}};
 const mounting=bridge.mountAccountDraft('d1',ctx);if(onLoading)await onLoading(bridge);await mounting;t.after(()=>{bridge.disposeAccountDraft();edit.clearEditor();dom.window.close();});
 return {dom,item,calls,notices,local,ctx};
}
function change(f,selector,value){const el=document.querySelector(selector);el.value=value;el.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));}

test('account native writing editor saves back to the original version without touching local drafts or local tasks',async t=>{
 const f=await fixture(t);assert.equal(document.querySelector('#writing-title').value,'账户研究草稿');assert.equal(state.list(state.keys.drafts)[0].exportUnlocked,undefined);assert.equal(document.querySelector('.dashboard img[src=x]'),null);assert.equal(bridge.accountDraftHasWork(),false);
 change(f,'#writing-title','已核对的账户研究标题');document.querySelector('#account-draft-save').click();await settle(()=>f.notices.some(n=>n.includes('版本 3')));
 const save=f.calls.find(c=>c.body);assert.equal(save.path,'/api/workspace/drafts/d1');assert.equal(save.body.version,2);assert.equal(save.body.title,'已核对的账户研究标题');assert.equal(save.body.projectId,'p1');assert.equal(save.body.payload.exportUnlocked,undefined);
 assert.deepEqual(JSON.parse(localStorage.getItem('paperknow-drafts')),f.local);assert.equal(localStorage.getItem('paperknow-local-tasks'),null);assert.equal(bridge.accountDraftHasWork(),false);assert.match(document.querySelector('#account-draft-version').textContent,/3/);
 bridge.disposeAccountDraft();assert.deepEqual(state.list(state.keys.drafts),f.local);
});

test('version conflicts retain typed content and do not overwrite another device or silently fall back to local storage',async t=>{
 const f=await fixture(t,{conflict:true});change(f,'#writing-title','发生冲突时保留的内容');document.querySelector('#account-draft-save').click();await settle(()=>f.notices.some(n=>n.includes('版本冲突'))||document.querySelector('#account-draft-status').textContent.includes('版本冲突'));
 assert.equal(document.querySelector('#writing-title').value,'发生冲突时保留的内容');assert.equal(bridge.accountDraftHasWork(),true);assert.deepEqual(JSON.parse(localStorage.getItem('paperknow-drafts')),f.local);assert.equal(f.calls.filter(c=>c.body).length,1);assert.match(document.querySelector('#account-draft-version').textContent,/2/);
});

test('switching accounts cannot save an existing account editing buffer into the new session',async t=>{
 const f=await fixture(t,{userChanged:true});change(f,'#writing-title','账户一的未保存内容');document.querySelector('#account-draft-save').click();await settle(()=>f.notices.some(n=>n.includes('账户已变化')));
 assert.equal(f.calls.filter(c=>c.body).length,0);assert.equal(bridge.accountDraftHasWork(),true);assert.deepEqual(JSON.parse(localStorage.getItem('paperknow-drafts')),f.local);
 bridge.accountDraftSessionChanged({id:'u2'});assert.equal(state.hasDraftScope(),false);assert.doesNotMatch(document.querySelector('.dashboard').textContent,/账户一的未保存内容/);
});

test('leaving an account draft protects edits and cancelling the leave dialog preserves the editing buffer',async t=>{
 const f=await fixture(t);change(f,'#writing-title','尚未保存的标题');assert.equal(bridge.accountDraftRouteGuard('#assets?scope=local'),false);assert.ok(document.querySelector('#cloud-stay'));document.querySelector('#cloud-stay').click();assert.equal(document.querySelector('#writing-title').value,'尚未保存的标题');assert.equal(bridge.accountDraftHasWork(),true);assert.equal(f.calls.filter(c=>c.body).length,0);
});

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}

test('typing during an account save keeps the new input dirty after the earlier snapshot succeeds',async t=>{
 const gate=deferred(),f=await fixture(t,{gate});change(f,'#writing-title','送出的第一版标题');document.querySelector('#account-draft-save').click();await settle(()=>f.calls.some(c=>c.body));change(f,'#writing-title','请求期间继续编辑的标题');gate.resolve();await settle(()=>f.notices.some(n=>n.includes('新增的修改')));
 assert.equal(document.querySelector('#writing-title').value,'请求期间继续编辑的标题');assert.equal(bridge.accountDraftHasWork(),true);assert.equal(f.calls.find(c=>c.body).body.title,'送出的第一版标题');assert.match(document.querySelector('#account-draft-version').textContent,/3/);
});

test('when an editor creates a replacement draft id, account save sends the newly saved content instead of the old seed',async t=>{
 const f=await fixture(t);f.ctx.saveNative=async()=>{state.write(state.keys.drafts,[{id:'native-new-id',tool:'writing',title:'替换的新文档',text:'新文件的真实内容'},...state.list(state.keys.drafts)]);return true;};change(f,'#writing-title','触发替换');document.querySelector('#account-draft-save').click();await settle(()=>f.notices.some(n=>n.includes('版本 3')));const save=f.calls.find(c=>c.body);assert.equal(save.path,'/api/workspace/drafts/d1');assert.equal(save.body.version,2);assert.equal(save.body.payload.text,'新文件的真实内容');assert.equal(save.body.title,'替换的新文档');assert.deepEqual(JSON.parse(localStorage.getItem('paperknow-drafts')),f.local);
});

test('disposal stops old tool save listeners before a different account editor mounts',async t=>{
 const f=await fixture(t);const research=await import('../dist/workspace/research.mjs'),presentation=await import('../dist/workspace/presentation.mjs');bridge.disposeAccountDraft();edit.clearEditor();research.mountResearch(f.ctx);research.disposeResearch();state.beginDraftScope({drafts:[{id:'ppt-cloud',tool:'ppt',title:'旧版演示文稿',text:'真实旧版提纲'}]});presentation.mountPresentation(f.ctx,'ppt-cloud');t.after(()=>presentation.disposePresentation());assert.equal(presentation.savePresentationDraft(),true);const rows=state.list(state.keys.drafts);assert.equal(rows.length,1);assert.equal(rows[0].tool,'ppt');assert.equal(rows[0].title,'旧版演示文稿');assert.equal(f.notices.some(n=>n.includes('图表和原始数据已保存')),false);
});

test('same-account session resolution during initial loading does not dispose the draft editor',async t=>{
 const loadGate=deferred();await fixture(t,{loadGate,onLoading:async current=>{current.accountDraftSessionChanged({id:'u1'});loadGate.resolve();}});assert.equal(document.querySelector('#writing-title').value,'账户研究草稿');assert.equal(state.hasDraftScope(),true);
});
test('a different session during initial loading prevents the previous account payload from being displayed',async t=>{
 const loadGate=deferred();const f=await fixture(t,{loadGate,onLoading:async current=>{current.accountDraftSessionChanged({id:'u2'});loadGate.resolve();}});assert.equal(document.querySelector('#writing-title'),null);assert.match(document.querySelector('.dashboard').textContent,/登录账户已变化/);assert.equal(state.hasDraftScope(),false);assert.deepEqual(JSON.parse(localStorage.getItem('paperknow-drafts')),f.local);
});
