import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {withStableView} from '../dist/workspace/view-stability.mjs';
import {validThesisQuote} from '../dist/workspace/thesis-online.mjs';

const sources=Object.fromEntries(await Promise.all(['method','outline'].map(async kind=>[kind,(await readFile(new URL(`../dist/workspace/writing-${kind}-generator.mjs`,import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'')])));
const settle=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,1));}throw Error('Generation recovery did not settle');};
const charge=()=>({type:'agent',source:'credits',title:'智能研究任务',creditCost:10,token:'recovered-quote',expiresAt:new Date(Date.now()+60000).toISOString()});

function fixture(t,kind,{sessionFailure=false,pendingJobId=null,pendingClientKey=null,pendingPreview=null}={}){
 const dom=new JSDOM('<main class="dashboard"><textarea id="manual">用户已有说明，不应被覆盖</textarea><section id="panel" hidden></section></main>',{url:'https://paperknow.cn/workspace.html#tool/writing',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,doc=w.document,container=doc.querySelector('#panel'),route=`/theses/${kind==='method'?'methods':'outlines'}`,prefix=`data-${kind}-ai-`;
 const brief={title:'网络恢复后的真实论文主题',profile:{level:'本科'},materials:[],references:[],requirements:'保留用户原有要求',outline:[{title:'用户原有提纲'}],bodySections:[]},contextKey=JSON.stringify(brief);
 const calls=[],commands=[],previews=[],applied=[],timers=new Map();let online=false,user={id:'u1'},sessionCalls=0,timer=0;
 w.structuredClone=structuredClone;w.withStableView=withStableView;w.validThesisQuote=validThesisQuote;w.scrollTo=()=>{};
 w.setTimeout=(fn,delay)=>{const id=++timer;timers.set(id,{fn,delay});return id;};w.clearTimeout=id=>timers.delete(id);
 const item={id:'saved-job',userId:'u1',status:'completed',stage:'completed',output:{text:kind==='method'?'服务端方法建议':'第一章 研究背景\n1.1 研究问题'}};
 const api=async(path,data)=>{
  calls.push({path,data});if(!online)throw new TypeError('网络连接已中断');
  if(path==='/auth/me')return {user};
  if(path===route+'/capabilities')return {ready:true};
  if(path==='/billing/quote')return charge();
  if(path===route+'/saved-job'||path===route+'/by-key/saved-command')return {item};
  if(path===route)return {item:{...item,id:'submitted-job',userId:user.id,status:'queued',stage:'queued',output:undefined}};
  throw Error('Unexpected recovery path '+path);
 };
 w.eval(sources[kind]+`\nwindow.mountGenerator=mountWriting${kind==='method'?'Method':'Outline'}Generator;`);
 const controller=w.mountGenerator({container,ctx:{api,session:async()=>{sessionCalls++;if(sessionFailure)throw new TypeError('初次会话读取失败');return {user};}},getSnapshot:()=>structuredClone(brief),getContextKey:()=>contextKey,pendingJobId,pendingClientKey,pendingContextKey:pendingJobId||pendingClientKey?contextKey:null,pendingPreview,onApply:(text)=>{applied.push(text);},onCommandChange:(key,meta)=>commands.push({key,...meta}),onPreviewChange:preview=>previews.push(preview)});
 t.after(()=>{controller.dispose();w.close();});
 const $=suffix=>container.querySelector(`[${prefix}${suffix}]`);
 return {controller,container,calls,commands,previews,applied,doc,w,brief,item,route,$,get sessionCalls(){return sessionCalls;},setOnline:value=>{online=value;},setUser:value=>{user=value;},async reload(){const node=$('reload');assert.ok(node,'Recovery needs a reload action');node.click();await settle(()=>!controller.busy());},async submit(){const consent=$('consent');assert.ok(consent);consent.checked=true;consent.dispatchEvent(new w.Event('change',{bubbles:true}));$('start').click();await settle(()=>!controller.busy());}};
}

for(const kind of ['method','outline']){
 test(`${kind}: an unavailable initial session recovers through fresh authentication without repeated cached errors or a charged submission`,async t=>{
  const f=fixture(t,kind,{sessionFailure:true});await f.controller.open();assert.match(f.container.textContent,/初次会话读取失败/);
  f.setOnline(true);await f.reload();
  assert.equal(f.sessionCalls,1,'The failed cached session must not be reused');
  assert.match(f.container.textContent,/10 科研积分/);assert.doesNotMatch(f.container.textContent,/登录账户已变化|初次会话读取失败/);
  assert.equal(f.$('consent').checked,false);assert.equal(f.$('start').disabled,true);
  assert.equal(f.calls.filter(call=>call.path===f.route).length,0);assert.equal(f.commands.length,0);assert.equal(f.applied.length,0);
  assert.equal(f.doc.querySelector('#manual').value,'用户已有说明，不应被覆盖');assert.equal(f.brief.outline[0].title,'用户原有提纲');
 });

 test(`${kind}: a failed live authentication recovers for the same account and still requires explicit paid consent`,async t=>{
  const f=fixture(t,kind);await f.controller.open();assert.match(f.container.textContent,/网络连接已中断/);
  f.setOnline(true);await f.reload();assert.match(f.container.textContent,/10 科研积分/);assert.doesNotMatch(f.container.textContent,/登录账户已变化/);
  assert.equal(f.$('consent').checked,false);assert.equal(f.calls.filter(call=>call.path===f.route).length,0);
  await f.submit();assert.equal(f.calls.filter(call=>call.path===f.route).length,1);assert.equal(f.commands.length,1);assert.equal(f.applied.length,0);
 });

 test(`${kind}: network recovery resumes the saved command and edited preview without a new quote or submission`,async t=>{
  const edited='用户编辑且尚未应用的方法建议';
  const f=fixture(t,kind,{sessionFailure:true,pendingClientKey:'saved-command',pendingPreview:kind==='method'?{jobId:'saved-job',text:edited}:null});
  await f.controller.open();f.setOnline(true);await f.reload();
  assert.ok(f.calls.some(call=>call.path===f.route+'/by-key/saved-command'));
  assert.equal(f.calls.filter(call=>call.path==='/billing/quote'||call.path===f.route).length,0);
  assert.equal(f.commands.length,0);assert.equal(f.applied.length,0);
  const preview=f.container.querySelector(`#writing-${kind}-ai-result`);assert.ok(preview);assert.equal(preview.value,kind==='method'?edited:f.item.output.text);
  assert.equal(f.doc.querySelector('#manual').value,'用户已有说明，不应被覆盖');
 });

 test(`${kind}: a genuinely changed account remains blocked across recovery and can only resume after the original account returns`,async t=>{
  const f=fixture(t,kind,{pendingJobId:'saved-job'});await f.controller.open();
  f.setOnline(true);f.setUser({id:'u2'});await f.reload();
  assert.match(f.container.textContent,/登录账户已变化/);assert.equal(f.container.querySelector(`#writing-${kind}-ai-result`),null);
  assert.equal(f.calls.filter(call=>call.path===f.route+'/saved-job'||call.path==='/billing/quote'||call.path===f.route).length,0);
  await f.reload();assert.match(f.container.textContent,/登录账户已变化/);
  assert.equal(f.calls.filter(call=>call.path===f.route+'/saved-job'||call.path==='/billing/quote'||call.path===f.route).length,0);
  f.setUser({id:'u1'});await f.reload();assert.ok(f.container.querySelector(`#writing-${kind}-ai-result`));
  assert.equal(f.calls.filter(call=>call.path===f.route+'/saved-job').length,1);assert.equal(f.commands.length,0);assert.equal(f.applied.length,0);
 });
}
