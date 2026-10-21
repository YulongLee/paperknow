import {beginDraftScope,endDraftScope} from '../dist/workspace/state.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {projectReference,resolveAccountProjectId} from '../dist/workspace/project-directory.mjs';
import {withStableView} from '../dist/workspace/view-stability.mjs';
import {validThesisQuote} from '../dist/workspace/thesis-online.mjs';

const source=(await readFile(new URL('../dist/workspace/writing-outline-generator.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const quote=()=>({type:'agent',source:'credits',title:'智能研究任务',creditCost:10,token:'signed-quote',expiresAt:new Date(Date.now()+60000).toISOString()});
const queued={id:'outline-1',userId:'u1',status:'queued',stage:'queued'};
const completed={...queued,status:'completed',stage:'completed',model:'test-model',output:{text:'第一章 城市通勤研究背景\n1.1 研究问题\n第二章 公共交通与通勤行为\n2.1 分析框架'}};
const settle=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,1));}throw Error('Outline controller did not settle');};
function fixture(t,{guest=false,pendingJobId,pendingContextKey,pendingClientKey,onRequest,onApply,onCommandChange}={}){
 const dom=new JSDOM('<main class="dashboard"><input id="outside-entry" value="既有内容"><section id="panel" hidden></section></main>',{url:'https://paperknow.cn/workspace.html#tool/writing',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,doc=w.document,container=doc.querySelector('#panel');
 let projectRef='';const calls=[],applies=[],jobs=[],commands=[],timers=new Map(),position={y:830};let timerId=0,current=true,user=guest?null:{id:'u1'},brief={title:'城市通勤行为的影响因素研究',profile:{level:'本科',discipline:'交通工程',researchQuestion:'',method:''},materials:[{id:'m1',name:'研究笔记',text:'真实研究说明',confirmed:true}],references:[{id:'r1',title:'参考来源',confirmed:true}],requirements:'采用学校提纲格式',outline:[{title:'原有章节'}],bodySections:[{text:'既有正文'}]},readItem=queued;
 Object.defineProperties(w,{scrollY:{configurable:true,get:()=>position.y},scrollX:{configurable:true,get:()=>0}});w.scrollTo=opts=>{position.y=opts.top;};doc.querySelector('.dashboard').getBoundingClientRect=()=>({top:80-position.y,left:0,width:1200,height:2000,bottom:2080-position.y,right:1200});
 w.setTimeout=(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;};w.clearTimeout=id=>timers.delete(id);
 Object.defineProperty(doc,'hidden',{configurable:true,value:false});w.structuredClone=structuredClone;w.withStableView=withStableView;w.validThesisQuote=validThesisQuote;w.resolveAccountProjectId=resolveAccountProjectId;
 const api=async(path,data,options)=>{calls.push({path,data,options});const custom=onRequest&&await onRequest(path,data,options);if(custom!==undefined)return custom;if(path==='/auth/me')return user?{user}:{status:'guest'};if(path==='/theses/outlines/capabilities')return {ready:true,billingService:'agent'};if(path==='/billing/quote')return quote();if(path==='/theses/outlines')return {item:queued};if(path.startsWith('/theses/outlines/by-key/'))throw Object.assign(new Error('任务尚未创建'),{status:404});if(path==='/theses/outlines/outline-1')return {item:readItem};if(path==='/theses/outlines/outline-1/cancel')return {item:{...queued,status:'cancelled',stage:'cancelled'}};throw Error('Unexpected path '+path);};
 w.eval(source+'\nwindow.outlineTest={mountWritingOutlineGenerator};');
 const options={container,ctx:{api,session:async()=>user?{user}:{status:'guest'}},getSnapshot:()=>structuredClone(brief),getContextKey:()=>JSON.stringify(brief),getProjectRef:()=>projectRef,onApply:async(text,item)=>{applies.push({text,item});return onApply?onApply(text,item):true;},onJobChange:(id,meta)=>jobs.push({id,...meta}),onCommandChange:async(key,meta)=>{commands.push({key,...meta});await onCommandChange?.(key,meta);},pendingJobId,pendingContextKey,pendingClientKey,isCurrent:()=>current};
 const controller=w.outlineTest.mountWritingOutlineGenerator(options);t.after(()=>{controller.dispose();w.close();});
 return {w,doc,container,controller,calls,applies,jobs,commands,timers,position,options,$:selector=>doc.querySelector(selector),setProjectRef:value=>{projectRef=value;},setUser:value=>{user=value;},setCurrent:value=>{current=value;},getBrief:()=>brief,setBrief:value=>{brief=value;},setItem:value=>{readItem=value;},async tick(){const entry=[...timers].find(([,value])=>value.delay===2000);assert.ok(entry,'Missing poll timer');timers.delete(entry[0]);await entry[1].fn();},async charge(){const input=doc.querySelector('[data-outline-ai-consent]');assert.ok(input);assert.equal(input.checked,true);assert.equal(doc.querySelector('[data-outline-ai-start]').disabled,false);doc.querySelector('[data-outline-ai-start]').click();await settle(()=>!controller.busy());}};
}

const click=(f,selector)=>{const node=f.$(selector);assert.ok(node,'Missing '+selector);node.click();};

test('opening quotes the current topic without submitting, defaults to ready consent after a valid quote and strips existing body and outline',async t=>{
 const f=fixture(t);await f.controller.open();assert.equal(f.container.hidden,false);assert.match(f.container.textContent,/城市通勤行为的影响因素研究/);assert.match(f.container.textContent,/10 科研积分/);assert.match(f.container.textContent,/1 份资料/);assert.match(f.container.textContent,/1 篇参考文献/);assert.equal(f.$('[data-outline-ai-consent]').checked,true);assert.equal(f.$('[data-outline-ai-start]').disabled,false);assert.equal(f.$('[data-outline-ai-start]').textContent,'生成提纲');assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,0);await f.charge();const posted=f.calls.find(call=>call.path==='/theses/outlines').data;assert.equal(posted.consent,true);assert.equal(posted.billingToken,'signed-quote');assert.deepEqual(Array.from(posted.snapshot.outline),[]);assert.deepEqual(Array.from(posted.snapshot.bodySections),[]);assert.equal(posted.snapshot.profile.method,'');assert.equal(posted.snapshot.requirements,'采用学校提纲格式');assert.equal(f.applies.length,0);assert.equal(f.jobs.at(-1).id,'outline-1');assert.equal(f.jobs.at(-1).contextKey,JSON.stringify(f.getBrief()));
});

test('queued polling renders a plain escaped preview and only an explicit apply updates the caller',async t=>{
 const f=fixture(t);await f.controller.open();await f.charge();f.setItem({...completed,output:{text:completed.output.text+'\n<script>unsafe()</script>'}});await f.tick();assert.equal(f.$('#writing-outline-ai-result').readOnly,true);assert.match(f.$('#writing-outline-ai-result').value,/<script>unsafe\(\)<\/script>/);assert.equal(f.$('script'),null);assert.equal(f.applies.length,0);assert.equal(f.container.hidden,false);click(f,'[data-outline-ai-apply]');await settle(()=>f.applies.length===1&&f.container.hidden);assert.match(f.applies[0].text,/第一章/);assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,1);assert.equal([...f.timers.values()].filter(timer=>timer.delay===2000).length,0);
});

test('a failed model task shows its actual error without overwriting or inventing a fallback outline',async t=>{
 const f=fixture(t);await f.controller.open();await f.charge();f.setItem({...queued,status:'failed',stage:'failed',error:'模型额度不足，请检查模型配置'});await f.tick();assert.match(f.container.textContent,/模型额度不足，请检查模型配置/);assert.equal(f.$('#writing-outline-ai-result'),null);assert.equal(f.applies.length,0);assert.equal(f.$('[data-outline-ai-apply]'),null);assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,1);assert.equal([...f.timers.values()].filter(timer=>timer.delay===2000).length,0);click(f,'[data-outline-ai-reload]');await settle(()=>!f.controller.busy());assert.equal(f.calls.filter(call=>call.path==='/billing/quote').length,2);assert.equal(f.$('[data-outline-ai-consent]').checked,true);assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,1);
});

test('cancel is owner checked, calls the real cancellation route and preserves the old local outline',async t=>{
 const f=fixture(t);await f.controller.open();await f.charge();click(f,'[data-outline-ai-cancel]');await settle(()=>!f.controller.busy());assert.equal(f.calls.filter(call=>call.path==='/theses/outlines/outline-1/cancel').length,1);assert.match(f.container.textContent,/已停止生成/);assert.equal(f.applies.length,0);assert.equal(f.getBrief().outline[0].title,'原有章节');assert.equal([...f.timers.values()].filter(timer=>timer.delay===2000).length,0);
});

test('restoring a saved running job reads it and polls without a quote or a second paid submission',async t=>{
 const f=fixture(t,{pendingJobId:'outline-1',pendingContextKey:'original-brief'});await f.controller.open();assert.equal(f.calls.some(call=>call.path==='/billing/quote'),false);assert.equal(f.calls.some(call=>call.path==='/theses/outlines'),false);assert.match(f.container.textContent,/未重复提交或扣费/);f.setItem(completed);await f.tick();assert.ok(f.$('#writing-outline-ai-result'));assert.equal(f.$('[data-outline-ai-apply]').disabled,true);assert.match(f.container.textContent,/论文主题或研究资料已有变化/);assert.equal(f.applies.length,0);
});

test('changing the topic after completion blocks apply even through the old enabled handler',async t=>{
 const f=fixture(t);await f.controller.open();await f.charge();f.setItem(completed);await f.tick();f.setBrief({...f.getBrief(),title:'另一个主题'});click(f,'[data-outline-ai-apply]');await new Promise(resolve=>setTimeout(resolve,2));assert.equal(f.applies.length,0);assert.equal(f.container.hidden,false);
});

test('live auth is checked again before apply and a switched account cannot apply the previous result',async t=>{
 const f=fixture(t);await f.controller.open();await f.charge();f.setItem(completed);await f.tick();f.setUser({id:'u2'});click(f,'[data-outline-ai-apply]');await settle(()=>!f.controller.busy());assert.equal(f.applies.length,0);assert.equal(f.$('#writing-outline-ai-result'),null);assert.match(f.container.textContent,/登录账户已变化/);assert.ok(f.$('.writing-outline-ai-login a'));
});

test('ambiguous transport failure retries the exact same command and preserves it when the panel is reopened',async t=>{
 let submissions=0;const f=fixture(t,{onRequest:(path,data)=>{if(path==='/theses/outlines'&&++submissions===1)throw new TypeError('网络连接中断');}});await f.controller.open();await f.charge();assert.match(f.container.textContent,/尚未确认提交结果/);assert.equal(f.$('[data-outline-ai-requote]'),null);const first=f.calls.find(call=>call.path==='/theses/outlines').data;click(f,'[data-outline-ai-close]');await f.controller.open();assert.equal(f.calls.filter(call=>call.path==='/billing/quote').length,2);assert.match(f.container.textContent,/上次任务尚未确认创建/);assert.equal(f.$('[data-outline-ai-consent]').checked,true);const recoveredConsent=f.$('[data-outline-ai-consent]');recoveredConsent.checked=true;recoveredConsent.dispatchEvent(new f.w.Event('change',{bubbles:true}));click(f,'[data-outline-ai-start]');await settle(()=>!f.controller.busy());const submits=f.calls.filter(call=>call.path==='/theses/outlines');assert.equal(submits.length,2);assert.equal(submits[1].data.clientKey,first.clientKey);assert.equal(submits[1].data.billingToken,first.billingToken);assert.deepEqual(submits[1].data.snapshot,first.snapshot);
});

test('disposing aborts outstanding requests and stale completion cannot mutate or apply to a new route',async t=>{
 let finish,signal;const f=fixture(t,{onRequest:(path,_data,options)=>{if(path==='/theses/outlines/capabilities'){signal=options.signal;return new Promise(resolve=>{finish=resolve;});}}});const opening=f.controller.open();await settle(()=>!!finish);const markup=f.container.innerHTML;f.setCurrent(false);f.controller.dispose();assert.equal(signal.aborted,true);await opening;finish({ready:true});await new Promise(resolve=>setTimeout(resolve,1));assert.equal(f.container.innerHTML,markup);assert.equal(f.applies.length,0);assert.equal(f.calls.filter(call=>call.path==='/billing/quote').length,0);assert.equal(f.timers.size,0);
});

test('preview redraw preserves the active textarea caret, internal scroll and live viewport when apply is declined',async t=>{
 const f=fixture(t,{onApply:()=>false});await f.controller.open();await f.charge();f.setItem(completed);await f.tick();const preview=f.$('#writing-outline-ai-result');preview.focus({preventScroll:true});preview.setSelectionRange(5,9,'backward');preview.scrollTop=40;f.position.y=1250;const calls=[],focus=f.w.HTMLElement.prototype.focus;f.w.HTMLElement.prototype.focus=function(options){calls.push(options);return focus.call(this,options);};click(f,'[data-outline-ai-apply]');await settle(()=>!f.controller.busy());const next=f.$('#writing-outline-ai-result');assert.notEqual(next,preview);assert.equal(f.doc.activeElement,next);assert.equal(next.selectionStart,5);assert.equal(next.selectionEnd,9);assert.equal(next.selectionDirection,'backward');assert.equal(next.scrollTop,40);assert.equal(f.position.y,1250);assert.ok(calls.length>0);assert.ok(calls.every(options=>options?.preventScroll===true));assert.equal(f.applies.length,1);assert.equal(f.container.hidden,false);
});

test('the guest login panel preserves local content and never quotes or submits a task',async t=>{
 const f=fixture(t,{guest:true});await f.controller.open();assert.ok(f.$('.writing-outline-ai-login a'));assert.match(f.container.textContent,/已有提纲和当前浏览器草稿会保留/);assert.equal(f.calls.length,0);assert.equal(f.applies.length,0);assert.equal(f.getBrief().outline[0].title,'原有章节');
});

test('a declined replace confirmation keeps the completed preview open and does not generate again',async t=>{
 const f=fixture(t,{onApply:()=>false});await f.controller.open();await f.charge();f.setItem(completed);await f.tick();click(f,'[data-outline-ai-apply]');await settle(()=>!f.controller.busy());assert.equal(f.applies.length,1);assert.equal(f.container.hidden,false);assert.ok(f.$('#writing-outline-ai-result'));assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,1);
});

test('the idempotent command is persisted before submission and a recreated controller finds an acknowledged job before any new quote',async t=>{
 let finish;const f=fixture(t,{onRequest:(path,data)=>{if(path==='/theses/outlines'){assert.equal(f.commands.at(-1).key,data.clientKey);assert.equal(f.commands.at(-1).contextKey,JSON.stringify(f.getBrief()));return new Promise(resolve=>{finish=resolve;});}if(path.startsWith('/theses/outlines/by-key/'))return {item:queued};}});
 await f.controller.open();const input=f.$('[data-outline-ai-consent]');input.checked=true;input.dispatchEvent(new f.w.Event('change',{bubbles:true}));click(f,'[data-outline-ai-start]');await settle(()=>!!finish);const command=f.commands.at(-1);f.controller.dispose();const restored=f.w.outlineTest.mountWritingOutlineGenerator({...f.options,pendingClientKey:command.key,pendingContextKey:command.contextKey});t.after(()=>restored.dispose());await restored.open();assert.match(f.container.textContent,/已找回上次提交的提纲任务/);assert.match(f.container.textContent,/正在排队/);assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,1);assert.equal(f.calls.filter(call=>call.path==='/billing/quote').length,1);assert.equal(f.jobs.at(-1).id,'outline-1');assert.ok(f.calls.some(call=>call.path==='/theses/outlines/by-key/'+encodeURIComponent(command.key)));finish({item:queued});await new Promise(resolve=>setTimeout(resolve,1));assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,1);
});

test('a missing saved command obtains a fresh checked quote and manual retry retains the persisted client key',async t=>{
 const f=fixture(t),key='persisted-before-reload';f.controller.dispose();const restored=f.w.outlineTest.mountWritingOutlineGenerator({...f.options,pendingClientKey:key,pendingContextKey:JSON.stringify(f.getBrief())});t.after(()=>restored.dispose());await restored.open();assert.ok(f.calls.some(call=>call.path==='/theses/outlines/by-key/'+key));assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,0);assert.equal(f.$('[data-outline-ai-consent]').checked,true);assert.equal(f.$('[data-outline-ai-start]').disabled,false);const input=f.$('[data-outline-ai-consent]');input.checked=true;input.dispatchEvent(new f.w.Event('change',{bubbles:true}));click(f,'[data-outline-ai-start]');await settle(()=>!restored.busy());const posted=f.calls.find(call=>call.path==='/theses/outlines').data;assert.equal(posted.clientKey,key);assert.equal(f.commands.at(-1).key,key);assert.equal(f.applies.length,0);
});

test('a pending command for an old topic cannot retry a different payload and explicit new generation receives a new key',async t=>{
 const f=fixture(t),key='old-topic-command',oldContext=JSON.stringify(f.getBrief());f.controller.dispose();f.setBrief({...f.getBrief(),title:'社区养老政策效果研究'});const restored=f.w.outlineTest.mountWritingOutlineGenerator({...f.options,pendingClientKey:key,pendingContextKey:oldContext});t.after(()=>restored.dispose());await restored.open();assert.equal(f.$('[data-outline-ai-start]'),null);assert.match(f.container.textContent,/论文主题或研究资料已有变化/);click(f,'[data-outline-ai-new]');await settle(()=>!restored.busy());assert.equal(f.commands.at(-1).key,null);assert.equal(f.$('[data-outline-ai-consent]').checked,true);const input=f.$('[data-outline-ai-consent]');input.checked=true;input.dispatchEvent(new f.w.Event('change',{bubbles:true}));click(f,'[data-outline-ai-start]');await settle(()=>!restored.busy());const posted=f.calls.find(call=>call.path==='/theses/outlines').data;assert.notEqual(posted.clientKey,key);assert.equal(posted.snapshot.title,'社区养老政策效果研究');assert.equal(f.commands.at(-1).key,posted.clientKey);
});

test('failed command persistence prevents the paid submission instead of risking an unrecoverable task',async t=>{
 const f=fixture(t,{onCommandChange:()=>{throw Error('草稿保存失败，请先备份');}});await f.controller.open();await f.charge();assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,0);assert.match(f.container.textContent,/草稿保存失败，请先备份/);assert.equal(f.applies.length,0);
});

test('legacy outline job metadata is hidden in queued and completed previews without changing research content',async t=>{
 const f=fixture(t);await f.controller.open();await f.charge();f.setItem({...queued,model:'private-model-id',engine:'codex_sdk',provider:'private-provider'});await f.tick();assert.doesNotMatch(f.container.textContent,/private-model-id|codex_sdk|private-provider|使用模型/);assert.match(f.container.textContent,/等待 AI 服务处理/);
 const text='第一章 机器学习模型研究\n1.1 公开研究中的 OpenAI 方法比较';f.setItem({...completed,model:'private-model-id',engine:'codex_sdk',provider:'private-provider',output:{text}});await f.tick();assert.doesNotMatch(f.container.textContent,/private-model-id|codex_sdk|private-provider|使用模型/);assert.equal(f.$('#writing-outline-ai-result').value,text);assert.equal(f.applies.length,0);
});


test('outline generation binds the chosen account project without putting project metadata into the model snapshot',async t=>{
 const f=fixture(t),ref=projectReference('u1','project-a');f.setProjectRef(ref);await f.controller.open();await f.charge();const posted=f.calls.find(call=>call.path==='/theses/outlines').data;assert.equal(posted.projectId,'project-a');assert.equal(posted.snapshot.projectId,undefined);const binding=JSON.parse(f.commands.find(row=>row.key).contextKey);assert.equal(binding.projectRef,ref);assert.equal(binding.contextKey,JSON.stringify(f.getBrief()));
});

test('changing only the outline project invalidates the pending charge',async t=>{
 const f=fixture(t);f.setProjectRef(projectReference('u1','project-a'));await f.controller.open();const input=f.$('[data-outline-ai-consent]');input.checked=true;input.dispatchEvent(new f.w.Event('change',{bubbles:true}));f.setProjectRef(projectReference('u1','project-b'));click(f,'[data-outline-ai-start]');assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,0);assert.match(f.container.textContent,/论文主题或研究资料已变化/);
});

test('outline generation rejects a project owned by another signed-in account before billing or task submission',async t=>{
 const f=fixture(t);f.setProjectRef(projectReference('other-user','project-a'));await f.controller.open();assert.equal(f.calls.some(call=>call.path==='/billing/quote'||call.path==='/theses/outlines'),false);assert.ok(f.$('[role="alert"]'));
});


test('a restored missing outline command keeps its persisted project binding and requires an explicit fresh command after a project change',async t=>{
 const f=fixture(t);f.controller.dispose();const priorRef=projectReference('u1','project-a'),pendingContextKey=JSON.stringify({contextKey:JSON.stringify(f.getBrief()),projectRef:priorRef});f.setProjectRef(projectReference('u1','project-b'));const restored=f.w.outlineTest.mountWritingOutlineGenerator({...f.options,pendingClientKey:'old-project-command',pendingContextKey});t.after(()=>restored.dispose());await restored.open();assert.equal(f.$('[data-outline-ai-start]'),null);assert.equal(f.calls.some(row=>row.path==='/theses/outlines'),false);click(f,'[data-outline-ai-new]');await settle(()=>!restored.busy());const input=f.$('[data-outline-ai-consent]');input.checked=true;input.dispatchEvent(new f.w.Event('change',{bubbles:true}));click(f,'[data-outline-ai-start]');await settle(()=>!restored.busy());const posted=f.calls.find(row=>row.path==='/theses/outlines').data;assert.equal(posted.projectId,'project-b');assert.notEqual(posted.clientKey,'old-project-command');assert.equal(JSON.parse(f.commands.at(-1).contextKey).projectRef,projectReference('u1','project-b'));
});


test('an imported outline result keeps its frozen encoded context while the same account project uses its raw ID',async t=>{
 const f=fixture(t),encoded=projectReference('u1','project-a');f.setProjectRef(encoded);await f.controller.open();await f.charge();const frozenContext=f.jobs.at(-1).contextKey;f.controller.dispose();f.setItem(completed);beginDraftScope({ownerId:'u1',projectRows:[{id:'project-a',title:'Original project'},{id:'project-b',title:'Another project'}]});t.after(endDraftScope);f.setProjectRef('project-a');const restored=f.w.outlineTest.mountWritingOutlineGenerator({...f.options,pendingJobId:'outline-1',pendingContextKey:frozenContext});t.after(()=>restored.dispose());await restored.open();assert.equal(f.$('[data-outline-ai-apply]').disabled,false);assert.equal(f.jobs.at(-1).contextKey,frozenContext);assert.equal(f.calls.filter(row=>row.path==='/billing/quote').length,1);assert.equal(f.calls.filter(row=>row.path==='/theses/outlines').length,1);f.setProjectRef(projectReference('other-user','project-a'));click(f,'[data-outline-ai-apply]');assert.equal(f.applies.length,0);assert.ok(f.$('[data-outline-ai-apply]').disabled);f.setProjectRef('project-b');await restored.open();click(f,'[data-outline-ai-apply]');assert.equal(f.applies.length,0);assert.ok(f.$('[data-outline-ai-apply]').disabled);f.setProjectRef('project-a');await restored.open();click(f,'[data-outline-ai-apply]');await settle(()=>f.applies.length===1);assert.equal(f.calls.filter(row=>row.path==='/theses/outlines').length,1);assert.equal(f.calls.filter(row=>row.path==='/billing/quote').length,1);
});

test('different local outline project refs do not compare equal when neither is an account project',async t=>{
 const f=fixture(t);f.setProjectRef('local-a');await f.controller.open();f.setProjectRef('local-b');const input=f.$('[data-outline-ai-consent]');input.checked=true;input.dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(f.$('[data-outline-ai-start]').disabled,true);assert.equal(f.calls.some(row=>row.path==='/theses/outlines'),false);
});


test('the default checked outline choice can be cancelled and no stale click submits until the user enables it again',async t=>{
 const f=fixture(t);await f.controller.open();const consent=f.$('[data-outline-ai-consent]'),start=f.$('[data-outline-ai-start]');assert.equal(consent.checked,true);assert.equal(start.disabled,false);
 consent.checked=false;consent.dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(start.disabled,true);start.click();start.dispatchEvent(new f.w.Event('click',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,0);
 consent.checked=true;consent.dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(start.disabled,false);start.click();await settle(()=>!f.controller.busy());assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,1);assert.equal(f.calls.find(call=>call.path==='/theses/outlines').data.consent,true);
});

test('an invalid outline quote never enables a checked generation action',async t=>{
 const f=fixture(t,{onRequest:path=>path==='/billing/quote'?{...quote(),expiresAt:new Date(Date.now()-1000).toISOString()}:undefined});await f.controller.open();assert.equal(f.$('[data-outline-ai-consent]'),null);assert.equal(f.$('[data-outline-ai-start]'),null);assert.match(f.$('[role="alert"]').textContent,/费用信息不完整或已过期/);assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,0);
});

test('an invalid fresh outline quote discards the earlier checked quote and its detached submit handler',async t=>{
 let quotes=0;const f=fixture(t,{onRequest:path=>path==='/billing/quote'?++quotes===1?quote():{...quote(),expiresAt:new Date(Date.now()-1000).toISOString()}:undefined});await f.controller.open();const oldStart=f.$('[data-outline-ai-start]');assert.equal(oldStart.disabled,false);click(f,'[data-outline-ai-requote]');await settle(()=>!f.controller.busy());assert.equal(f.$('[data-outline-ai-start]'),null);assert.equal(f.$('[data-outline-ai-consent]'),null);oldStart.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,0);
});

test('a outline quote expiring after it was checked cannot submit a paid job',async t=>{
 const value=quote(),f=fixture(t,{onRequest:path=>path==='/billing/quote'?value:undefined});await f.controller.open();assert.equal(f.$('[data-outline-ai-consent]').checked,true);value.expiresAt=new Date(Date.now()-1000).toISOString();click(f,'[data-outline-ai-start]');await settle(()=>!f.controller.busy());assert.equal(f.calls.filter(call=>call.path==='/theses/outlines').length,0);assert.match(f.$('[role="alert"]').textContent,/费用确认已过期/);
});

test('default outline consent cannot submit changed research content or cross a changed owner',async t=>{
 const changed=fixture(t);await changed.controller.open();changed.setBrief({...changed.getBrief(),title:'更改后的研究主题'});click(changed,'[data-outline-ai-start]');await settle(()=>!changed.controller.busy());assert.equal(changed.calls.filter(call=>call.path==='/theses/outlines').length,0);assert.match(changed.container.textContent,/论文主题或研究资料已变化/);
 const switched=fixture(t);await switched.controller.open();switched.setUser({id:'u2'});click(switched,'[data-outline-ai-start]');await settle(()=>!switched.controller.busy());assert.equal(switched.calls.filter(call=>call.path==='/theses/outlines').length,0);assert.match(switched.container.textContent,/登录账户已变化/);assert.equal(switched.$('[data-outline-ai-start]'),null);
});
