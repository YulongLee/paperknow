import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {researchDrawingDraftKey} from '../dist/workspace/research-drawing-studio.mjs';
import {researchSessionKey} from '../dist/workspace/research-delivery-model.mjs';
import {beginDraftScope,endDraftScope,keys} from '../dist/workspace/state.mjs';
import {pngFixture} from './fixtures/research-image.mjs';

const until=async check=>{for(let i=0;i<120;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.ok(check(),'界面未达到预期状态');};
function setup({hash='#category/research',api,fetchImpl}={}){
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.cn/workspace.html'+hash}),w=dom.window,notices=[];
 for(const key of ['window','document','localStorage','FormData','location','AbortController','DOMParser','XMLSerializer'])globalThis[key]=w[key];
 Object.defineProperty(globalThis,'navigator',{value:w.navigator,configurable:true});
 const requests=[],context={notify:value=>notices.push(value),api:api||(async(path,data)=>{requests.push({path,data});if(path==='/auth/me')return {user:{id:'alice'}};if(path==='/tool-runs/jobs')return {items:[]};throw Error('测试不允许的请求 '+path);}),fetchImpl};
 return {dom,w,context,requests,notices,q:selector=>w.document.querySelector(selector),click(selector){const button=this.q(selector);assert.ok(button,selector);button.click();},enter(selector,value){const field=this.q(selector);assert.ok(field,selector);field.value=value;field.dispatchEvent(new w.Event('input',{bubbles:true}));}};
}
setup();
const {mountResearch,disposeResearch,researchRouteGuard,researchHasWork}=await import('../dist/workspace/research.mjs');

test('research defaults to direct AI drawing and retains manual table tools as explicit optional entries',async t=>{
 const f=setup();t.after(()=>{disposeResearch();f.w.close();});await mountResearch(f.context);assert.ok(f.q('[data-rd-prompt]'));assert.equal(f.q('.research-workflow-strip'),null);assert.equal(f.q('.research-table'),null);assert.ok(f.q('[data-mode="data"]'));assert.ok(f.q('[data-mode="structure"]'));await until(()=>f.q('[data-rd-history]').textContent.includes('还没有绘图记录'));
 f.click('[data-mode="data"]');assert.ok(f.q('.research-table'));assert.ok(f.q('[data-action="chart-generate"]'));assert.ok(f.q('.research-workflow-strip'));f.click('[data-mode="pro"]');assert.ok(f.q('[data-rd-prompt]'));assert.equal(f.q('details[data-rd-group="biomedicine"]')!==null,true);assert.equal(f.q('#diagram-nodes'),null);assert.equal(f.q('.research-workflow-strip'),null);
});

test('drawing descriptions survive parent tab changes and re-entry without entering legacy data storage',async t=>{
 const f=setup();t.after(()=>{disposeResearch();f.w.close();});await mountResearch(f.context);await until(()=>f.q('[data-rd-history]').textContent.includes('还没有绘图记录'));f.enter('[data-rd-prompt]','【合成验收】这是一份需要跨标签恢复的研究路线图片描述');f.click('[data-rd-figure="flowchart"]');f.click('[data-mode="pro"]');await until(()=>f.q('[data-rd-history]').textContent.includes('还没有绘图记录'));f.enter('[data-rd-prompt]','【合成验收】专业细胞机制示意图片描述');f.click('[data-rd-figure="cell-mechanism"]');f.click('[data-mode="basic"]');await until(()=>f.q('[data-rd-prompt]').value.includes('跨标签恢复'));assert.equal(f.q('[data-rd-figure="flowchart"]').getAttribute('aria-pressed'),'true');assert.equal(researchRouteGuard(),true);assert.equal(researchHasWork(),false);
 const globalSession=f.w.localStorage.getItem(researchSessionKey);assert.doesNotMatch(globalSession,/跨标签恢复|专业细胞机制/);assert.match(f.w.localStorage.getItem(researchDrawingDraftKey+':basic:alice'),/跨标签恢复/);assert.match(f.w.localStorage.getItem(researchDrawingDraftKey+':professional:alice'),/专业细胞机制/);disposeResearch();await mountResearch(f.context);await until(()=>f.q('[data-rd-prompt]').value.includes('跨标签恢复'));
});

test('a failed drawing auto-save keeps the original parent tab and its typed prompt available for copying',async t=>{
 const f=setup();t.after(()=>{disposeResearch();f.w.close();});await mountResearch(f.context);await until(()=>f.q('[data-rd-history]').textContent.includes('还没有绘图记录'));f.w.Storage.prototype.setItem=function(){throw Error('fixture full');};f.enter('[data-rd-prompt]','需要保留的未保存描述');assert.equal(researchHasWork(),true);assert.equal(researchRouteGuard(),false);f.click('[data-mode="pro"]');assert.equal(f.q('details[data-rd-group]'),null);assert.equal(f.q('[data-rd-prompt]').value,'需要保留的未保存描述');assert.match(f.notices.at(-1),/未能保存草稿/);
});

test('a saved image task deep link chooses the professional studio and reads the private existing image',async t=>{
 const reads=[],file={artifactId:'owned-image',downloadUrl:'/api/artifacts/owned-image/download',fileName:'专业示意图.png',mimeType:'image/png',width:1600,height:900};
 const f=setup({hash:'#category/research?mode=professional&job=job-alice',api:async(path,data)=>{reads.push({path,data});if(path==='/auth/me')return {user:{id:'alice'}};if(path==='/tool-runs/jobs')return {items:[]};if(path==='/tool-runs/jobs/job-alice')return {item:{id:'job-alice',kind:'research',operation:'image',status:'completed',title:'账户专业示意图',output:{image:file}}};throw Error(path);},fetchImpl:async(path,options)=>{reads.push({path,options});return {ok:true,blob:async()=>new Blob([pngFixture(1600,900)],{type:'application/octet-stream'})};}});f.w.URL.createObjectURL=()=> 'blob:https://paperknow.cn/owned-image';f.w.URL.revokeObjectURL=()=>{};t.after(()=>{disposeResearch();f.w.close();});await mountResearch(f.context);await until(()=>!!f.q('[data-rd-generated-image]'));assert.ok(f.q('details[data-rd-group="biomedicine"]'));assert.match(f.q('[data-rd-preview]').textContent,/账户专业示意图/);assert.ok(reads.some(row=>row.path==='/tool-runs/jobs/job-alice'));assert.equal(reads.some(row=>row.path==='/tool-runs/quote'||row.path==='/tool-runs/jobs'&&row.data),false);const binary=reads.find(row=>row.path.startsWith('/api/artifacts/'));assert.equal(binary.options.headers['X-PaperKnow-User'],'alice');
});

test('a prompt typed before initial account confirmation is saved as soon as identity is known',async t=>{
 let release;let first=true;const f=setup({api:async path=>{if(path==='/auth/me'&&first){first=false;return new Promise(resolve=>{release=resolve;});}if(path==='/auth/me')return {user:{id:'alice'}};if(path==='/tool-runs/jobs')return {items:[]};throw Error(path);}});t.after(()=>{disposeResearch();f.w.close();});await mountResearch(f.context);f.enter('[data-rd-prompt]','【合成验收】账户状态返回之前输入的描述');assert.equal(researchRouteGuard(),false);release({user:{id:'alice'}});await until(()=>!!f.w.localStorage.getItem(researchDrawingDraftKey+':basic:alice'));assert.match(f.w.localStorage.getItem(researchDrawingDraftKey+':basic:alice'),/账户状态返回之前/);assert.equal(researchRouteGuard(),true);
});


test('mode changes update the current URL without hash navigation, history growth, state loss or scrolling; reload retains the active formula workbench',async t=>{
 const f=setup({hash:'#category/research?mode=professional&from=review&tag=a&tag=b'});t.after(()=>{disposeResearch();f.w.close();});
 f.w.history.replaceState({retained:'state'},'');const initialLength=f.w.history.length;let hashChanges=0;f.w.addEventListener('hashchange',()=>hashChanges++);Object.defineProperty(f.w,'scrollY',{value:480,writable:true});f.w.scrollTo=()=>assert.fail('切换标签不应滚动窗口');
 await mountResearch(f.context);await until(()=>f.q('[data-rd-history]').textContent.includes('还没有绘图记录'));assert.ok(f.q('[data-rd-group]'));
 f.click('[data-mode="formula"]');await until(()=>!!f.q('[data-fs-editor]'));assert.ok(f.q('[data-fs-editor]'));const query=new URLSearchParams(f.w.location.hash.split('?')[1]);assert.equal(query.get('mode'),'formula');assert.equal(query.get('from'),'review');assert.deepEqual(query.getAll('tag'),['a','b']);assert.equal(f.w.history.length,initialLength);assert.deepEqual(f.w.history.state,{retained:'state'});assert.equal(f.w.scrollY,480);assert.equal(hashChanges,0);
 f.enter('[data-fs-editor]','x=42');disposeResearch();await mountResearch(f.context);assert.equal(f.q('[data-fs-editor]').value,'x=42');assert.equal(f.q('[data-rd-group]'),null);assert.equal(new URLSearchParams(f.w.location.hash.split('?')[1]).get('mode'),'formula');await new Promise(resolve=>setTimeout(resolve,10));assert.equal(hashChanges,0);
});

test('normal tool routes preserve auxiliary query values and canonically recover every explicit research view',async t=>{
 const f=setup({hash:'#tool/research?mode=basic&keep=yes'});t.after(()=>{disposeResearch();f.w.close();});await mountResearch(f.context);await until(()=>f.q('[data-rd-history]').textContent.includes('还没有绘图记录'));
 for(const [button,canonical,selector] of [['pro','professional','[data-rd-group]'],['basic','basic','[data-rd-prompt]'],['data','data','.research-table'],['structure','structure','[data-pro-description]'],['formula','formula','[data-fs-editor]']]){
  f.click('[data-mode="'+button+'"]');await until(()=>!!f.q(selector));assert.ok(f.q(selector),button);assert.equal(new URLSearchParams(f.w.location.hash.split('?')[1]).get('mode'),canonical);assert.equal(new URLSearchParams(f.w.location.hash.split('?')[1]).get('keep'),'yes');assert.match(f.w.location.hash,/^#tool\/research\?/);disposeResearch();await mountResearch(f.context);assert.ok(f.q(selector),'reload '+canonical);if(['basic','pro'].includes(button))await until(()=>f.q('[data-rd-history]').textContent.includes('还没有绘图记录'));
 }
});

test('account-draft editors never replace their owner route or query even when the visible research subtool changes',async t=>{
 const f=setup({hash:'#account-draft/private-formula?mode=professional&owner=alice'}),original=f.w.location.href;t.after(()=>{disposeResearch();endDraftScope();f.w.close();});beginDraftScope({ownerId:'alice',drafts:[{id:'private-formula',tool:'research',formula:'x_A=1',title:'账户公式'}]});await mountResearch(f.context,'private-formula');assert.ok(f.q('[data-fs-editor]'));f.click('[data-mode="data"]');assert.ok(f.q('.research-table'));assert.equal(f.w.location.href,original);assert.equal(f.w.localStorage.getItem(researchSessionKey),null);
 // Even a scoped editor hosted under the ordinary category path must not
 // rewrite an account-owned route or let the URL override its saved content.
 f.w.history.replaceState(null,'','#category/research?mode=professional&keep=private');const scoped=f.w.location.href;disposeResearch();await mountResearch(f.context,'private-formula');assert.ok(f.q('[data-fs-editor]'));f.click('[data-mode="structure"]');assert.equal(f.w.location.href,scoped);
});

test('a failed auto-save preserves both the current workbench and its existing URL mode',async t=>{
 const f=setup({hash:'#category/research?mode=professional&keep=yes'});t.after(()=>{disposeResearch();f.w.close();});await mountResearch(f.context);await until(()=>f.q('[data-rd-history]').textContent.includes('还没有绘图记录'));const original=f.w.location.href;f.w.Storage.prototype.setItem=function(){throw Error('fixture full');};f.enter('[data-rd-prompt]','应当在原页面保留的科研图片描述');f.click('[data-mode="formula"]');assert.ok(f.q('[data-rd-prompt]'));assert.equal(f.q('[data-fs-editor]'),null);assert.equal(f.w.location.href,original);assert.match(f.notices.at(-1),/未能保存草稿/);
});
