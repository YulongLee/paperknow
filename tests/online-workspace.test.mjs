import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {esc,icon} from '../dist/workspace/ui.mjs';
import {feedbackKey,normalizeFeedback} from '../dist/workspace/help-model.mjs';
const personalCode=(await readFile(new URL('../dist/workspace/online-personal-services.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const code=(await readFile(new URL('../dist/workspace/online-workspace.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const now='2026-10-15T00:00:00Z';
async function settle(check){for(let i=0;i<80;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,4));}throw Error('UI did not settle');}
async function fixture(t,{guest=false,ai=true,agent=true,view='projects',params='',request}={}){
 const dom=new JSDOM('<div id="app"><aside id="existing-sidebar">现有导航</aside><main class="dashboard"><div id="online"></div></main></div>',{url:'https://paperknow.cn/workspace.html#projects?scope=account',runScripts:'outside-only'}),w=dom.window;
 t.after(()=>{w.onlineTest.disposeOnlineWorkspace();w.close();});
 w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.URL.createObjectURL=()=>'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push(this.download);};
 w.localStorage.setItem('paperknow-drafts','[{"title":"本地未上传成果"}]');
 const calls=[],navigations=[],downloads=[],notices=[];let saved=[],projects=[{id:'p1',title:'账户研究项目',degree:'本科',major:'教育学',updated_at:now}],files=[{id:'f1',name:'账户原件.txt',bytes:30,project_id:'p1'}],jobs=[{id:'pending',type:'parse',status:'queued',attempt:0,created_at:now},{id:'failed',type:'agent',status:'failed',attempt:1,created_at:now,error:'测试任务失败'}];
 w.esc=esc;w.icon=icon;w.feedbackKey=feedbackKey;w.normalizeFeedback=normalizeFeedback;w.keys={drafts:'paperknow-drafts'};w.list=key=>JSON.parse(w.localStorage.getItem(key)||'[]');w.eval(personalCode+'\nwindow.renderOnlinePersonal=renderOnlinePersonal;');
 w.fetch=async(path,options={})=>{const body=options.body?JSON.parse(options.body):undefined;calls.push({path,body,options});if(request){const custom=await request(path,options);if(custom)return custom;}
  let status=200,value={};
  if(path==='/api/capabilities')value={ai,agent,aiProvider:'test-provider',storage:'local'};
  else if(path==='/api/auth/me'){status=guest?401:200;value=guest?{error:'请登录'}:{user:{id:'u1',name:'测试账户',email:'person@example.invalid'}};}
  else if(path==='/api/projects'){if(body){projects.push({...body,id:'p2',updated_at:now});value={id:'p2'};}else value={items:projects};}
  else if(path==='/api/files'){if(body){files.push({...body,id:'f2',bytes:3});value={id:'f2'};}else value={items:files};}
  else if(path==='/api/jobs'){if(body){jobs.push({id:'new',type:body.type,status:'queued',attempt:0,created_at:now});value={id:'new'};}else value={items:jobs};}
  else if(/^\/api\/jobs\/.+\/(cancel|retry)$/.test(path)){const [,id,action]=path.match(/\/jobs\/([^/]+)\/([^/]+)$/);jobs=jobs.map(job=>job.id===id?{...job,status:action==='cancel'?'cancelled':'queued'}:job);}
  else if(path==='/api/results')value={items:[{id:'r1',type:'polish',title:'账户修改成果',created_at:now}]};
  else if(path==='/api/results/r1')value={item:{id:'r1',type:'polish',title:'账户修改成果',body:{original:'真实原文',suggestion:'原始建议',model:'test-model'}}};
  else if(path==='/api/results/r1/revisions'){if(body){saved.unshift({id:'v'+saved.length,body:body.text,created_at:now});value={id:'v1'};}else value={items:saved};}
  else if(path==='/api/workspace/drafts')value={items:[]};
  else if(path==='/api/workspace/summary')value={counts:{projects:projects.length,files:files.length,drafts:0,results:1},storage:{},usage:{records:1,inputTokens:12,outputTokens:0}};
  else if(path==='/api/usage')value={items:[{model:'test-model',input_tokens:12,output_tokens:null,created_at:now}]};
  else if(path==='/api/feedback')value={items:[{body:'此前已保存反馈',created_at:now}]};
  else if(path==='/api/products'||path==='/api/payments/entitlements')value={items:[]};
  else throw Error('Unexpected API '+path);
  return {ok:status<400,status,json:async()=>JSON.parse(JSON.stringify(value))};
 };
 w.eval(code+'\nwindow.onlineTest={mountOnlineWorkspace,disposeOnlineWorkspace,onlineWorkspaceRouteGuard,onlineWorkspaceHasWork,onlineWorkspaceConfirmLeave,onlineWorkspaceSessionChanged};');
 const ctx={navigate:hash=>navigations.push(hash),notify:message=>notices.push(message)};
 await w.onlineTest.mountOnlineWorkspace(w.document.querySelector('#online'),view,ctx,new w.URLSearchParams(params));
 return {w,doc:w.document,calls,navigations,downloads,notices,saved,ctx};
}
function input(f,id,value){const element=f.doc.querySelector(id);element.value=value;element.dispatchEvent(new f.w.Event('input',{bubbles:true}));}
function submit(f,selector){const form=f.doc.querySelector(selector);form.dispatchEvent(new f.w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:form.querySelector('button:not([type=button])')}));}

test('account content requires login while retaining the existing workspace shell and local drafts',async t=>{
 const f=await fixture(t,{guest:true});
 assert.match(f.doc.querySelector('#online').textContent,/登录后查看账户内容/);
 assert.equal(f.doc.querySelector('#existing-sidebar').textContent,'现有导航');
 assert.equal(f.calls.some(call=>['/api/projects','/api/jobs','/api/files','/api/results'].includes(call.path)),false);
 assert.match(f.w.localStorage.getItem('paperknow-drafts'),/本地未上传成果/);
 const link=new URL(f.doc.querySelector('#online a').href);assert.equal(link.searchParams.get('next'),'/workspace.html#projects?scope=account');
 assert.equal(f.doc.querySelector('#online nav'),null);
});

test('account project creation and file upload use real APIs and route parsing tasks into the same workspace',async t=>{
 const f=await fixture(t);const file={name:'paper.txt',size:3,lastModified:1,arrayBuffer:async()=>new TextEncoder().encode('abc').buffer};
 Object.defineProperty(f.doc.querySelector('#upload-file'),'files',{value:[file]});
 input(f,'#project-title','新增账户项目');submit(f,'#project-form');
 await settle(()=>f.doc.querySelector('#view').textContent.includes('新增账户项目'));
 const projectCall=f.calls.find(call=>call.path==='/api/projects'&&call.body);assert.equal(projectCall.body.title,'新增账户项目');
 assert.equal(f.doc.querySelector('#upload-file').files[0],file,'saving a project must retain the selected paper file');
 f.doc.querySelector('#upload-project').value='p1';submit(f,'#upload-form');
 await settle(()=>f.navigations.length>0);
 assert.deepEqual(f.navigations,['#tasks?scope=account']);
 assert.equal(f.calls.find(call=>call.path==='/api/files'&&call.body).body.data,'YWJj');
 const parse=f.calls.find(call=>call.path==='/api/jobs'&&call.body);assert.equal(parse.body.type,'parse');assert.equal(parse.body.projectId,'p1');assert.equal(parse.body.fileId,'f2');assert.ok(parse.body.idempotencyKey);
 assert.match(f.w.localStorage.getItem('paperknow-drafts'),/本地未上传成果/);
});

test('task input is protected on navigation and unavailable AI stays disabled after material comparison',async t=>{
 const f=await fixture(t,{view:'tasks',ai:false});input(f,'#task-text','还没有提交的正文');
 assert.equal(f.w.onlineTest.onlineWorkspaceRouteGuard('#projects?scope=local'),false);assert.equal(f.doc.querySelector('#online-confirm').open,true);
 f.doc.querySelector('#online-confirm').dispatchEvent(new f.w.Event('cancel',{cancelable:true}));assert.equal(f.doc.querySelector('#task-text').value,'还没有提交的正文');
 const select=f.doc.querySelector('#task-type');select.value='compare';select.dispatchEvent(new f.w.Event('change'));input(f,'#source-title','实际对照来源');input(f,'#source-text','实际来源内容');submit(f,'#task-form');
 await settle(()=>f.calls.some(call=>call.path==='/api/jobs'&&call.body));await settle(()=>f.doc.querySelector('#task-text').value==='');
 assert.equal(f.doc.querySelector('#task-submit').disabled,false);assert.equal(f.doc.querySelector('#task-text').maxLength,8000);assert.equal(f.w.onlineTest.onlineWorkspaceHasWork(),false);
 const job=f.calls.find(call=>call.path==='/api/jobs'&&call.body);assert.equal(job.body.sources[0].title,'实际对照来源');
});

test('account jobs cancel immediately and require explicit retry confirmation',async t=>{
 const f=await fixture(t,{view:'tasks'});f.doc.querySelector('[data-job="pending"]').click();await settle(()=>f.doc.querySelector('.tag.cancelled'));
 assert.ok(f.calls.some(call=>call.path==='/api/jobs/pending/cancel'));
 f.doc.querySelector('[data-job="failed"]').click();assert.equal(f.doc.querySelector('#online-confirm').open,true);f.doc.querySelector('#online-confirm-no').click();await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(f.calls.some(call=>call.path==='/api/jobs/failed/retry'),false);
 f.doc.querySelector('[data-job="failed"]').click();f.doc.querySelector('#online-confirm-yes').click();await settle(()=>f.calls.some(call=>call.path==='/api/jobs/failed/retry'));
 assert.match(f.doc.querySelector('#job-list').textContent,/科研智能助手/);
});

test('account results preview, editing, saved versions and export preserve original model content',async t=>{
 const f=await fixture(t,{view:'results',params:'result=r1'});assert.equal(f.doc.querySelector('#revision-text').value,'原始建议');assert.equal(f.w.onlineTest.onlineWorkspaceHasWork(),false);
 input(f,'#revision-text','人工核对后的编辑稿');assert.equal(f.w.onlineTest.onlineWorkspaceHasWork(),true);submit(f,'#revision-form');
 await settle(()=>f.saved.length===1);await settle(()=>f.notices.includes('新版本已保存'));
 assert.equal(f.doc.querySelector('#revision-text').value,'人工核对后的编辑稿');assert.equal(f.saved[0].body,'人工核对后的编辑稿');assert.match(f.doc.querySelector('.compare pre').textContent,/真实原文/);assert.equal(f.w.onlineTest.onlineWorkspaceHasWork(),false);
 f.doc.querySelector('#export-result').click();assert.deepEqual(f.downloads,['PaperKnow成果.txt']);
});

test('agent submission uses selected account materials and distinct task route',async t=>{
 const f=await fixture(t,{view:'agent'});input(f,'#agent-text','整理这份研究材料');f.doc.querySelector('#agent-materials option').selected=true;submit(f,'#agent-form');await settle(()=>f.calls.some(call=>call.path==='/api/jobs'&&call.body));
 const job=f.calls.find(call=>call.path==='/api/jobs'&&call.body);assert.equal(job.body.type,'agent');assert.deepEqual(job.body.fileIds,['f1']);assert.ok(f.doc.querySelector('.account-task-modes a.active').href.endsWith('#tasks?scope=account&view=agent'));
});

test('late data from a disposed account page cannot replace a newer page',async t=>{
 let resolveUsage;const f=await fixture(t,{request:async path=>path==='/api/usage'?new Promise(resolve=>resolveUsage=resolve):undefined});
 const root=f.doc.querySelector('#online');const stale=f.w.onlineTest.mountOnlineWorkspace(root,'usage',f.ctx);await settle(()=>resolveUsage);
 await f.w.onlineTest.mountOnlineWorkspace(root,'help',f.ctx);assert.ok(f.doc.querySelector('#feedback-form'));
 resolveUsage({ok:true,status:200,json:async()=>({items:[]})});await stale;
 assert.ok(f.doc.querySelector('#feedback-form'));assert.match(f.doc.querySelector('#view').textContent,/此前已保存反馈/);
});

test('usage and feedback stay attached to the signed-in account without inventing quotas',async t=>{
 const f=await fixture(t,{view:'usage'});assert.match(f.doc.querySelector('#view').textContent,/12/);assert.match(f.doc.querySelector('#view').textContent,/未知/);
 await f.w.onlineTest.mountOnlineWorkspace(f.doc.querySelector('#online'),'help',f.ctx);input(f,'#feedback','请完善上传提示');submit(f,'#feedback-form');await settle(()=>f.notices.some(n=>n.startsWith('反馈已提交')));
 assert.equal(f.calls.find(call=>call.path==='/api/feedback'&&call.body).body.text,'请完善上传提示');
 assert.equal(f.calls.some(call=>call.path.startsWith('/api/admin')),false);
});

test('purchased membership shows escaped order snapshots with active, scheduled and expired states',async t=>{
 const today=Date.now(),stamp=offset=>new Date(today+offset*86400000).toISOString();
 const items=[
  {order_id:'paid-current',title:'已购标题 <img src=x onerror=alert(1)>',description:'购买时的说明 <script>alert(1)</script>',starts_at:stamp(-1),expires_at:stamp(3)},
  {order_id:'paid-scheduled',title:'排队中的已购服务',description:'当前权益结束后生效。',starts_at:stamp(4),expires_at:stamp(11)},
  {order_id:'paid/expired',title:'历史已购服务',description:'已到期的真实购买记录。',starts_at:stamp(-14),expires_at:stamp(-7)}
 ];
 const f=await fixture(t,{view:'membership',request:async path=>path==='/api/payments/entitlements'?{ok:true,status:200,json:async()=>({items})}:undefined});
 const cards=[...f.doc.querySelectorAll('#view article.account-entitlement')];assert.equal(cards.length,3);
 assert.equal(cards[0].querySelector('b').textContent,items[0].title);assert.equal(cards[0].querySelector('img'),null);assert.equal(cards[0].querySelector('script'),null);assert.equal(cards[0].querySelector('p').textContent,items[0].description);
 assert.deepEqual(cards.map(card=>card.querySelector('.tag').textContent),['有效','待生效','已到期']);
 assert.equal(f.doc.querySelector('a[href*="membership/pay"]'),null);
 assert.ok(f.doc.querySelector('a[href="#account?view=usage"]'));assert.equal(f.doc.querySelector('a[href*="membership/pay"]'),null);
 assert.equal(f.calls.some(call=>call.path==='/api/products'),false);assert.match(f.w.localStorage.getItem('paperknow-drafts'),/本地未上传成果/);
});

test('empty purchased membership uses actual account counts without encouraging a payment',async t=>{
 const f=await fixture(t,{view:'membership'});assert.match(f.doc.querySelector('#view').textContent,/暂无已生效的会员权益/);assert.equal(f.doc.querySelectorAll('.account-entitlement').length,0);assert.equal(f.doc.querySelector('a[href*="membership/pay"]'),null);assert.equal(f.calls.filter(call=>call.path==='/api/payments/entitlements').length,1);assert.equal(f.calls.some(call=>call.body),false);
});


test('account drafts are opened by account id while local copies upload only after an explicit user submission',async t=>{
 const cloud=[{id:'cloud1',title:'账户提纲',tool:'writing',version:3,project_id:'p1',updated_at:now}];
 const f=await fixture(t,{view:'results',request:async(path,options)=>path==='/api/workspace/drafts'?{ok:true,status:200,json:async()=>options.body?{item:{id:'cloud-created'}}:{items:cloud}}:undefined});
 assert.ok(f.doc.querySelector('a[href="#account-draft/cloud1"]'));assert.equal(f.calls.some(c=>c.body),false);
 f.w.localStorage.setItem('paperknow-drafts',JSON.stringify([{id:'local1',title:'仅上传这一份',tool:'writing',text:'真实用户输入',exportUnlocked:true},{id:'local2',title:'另一份不上传',tool:'writing',text:'私人材料'}]));f.doc.querySelector('#import-local-draft').click();assert.equal(f.calls.some(c=>c.body),false);f.doc.querySelector('#draft-import-id').value='local1';f.doc.querySelector('#draft-import-project').value='p1';submit(f,'#draft-import-form');await settle(()=>f.w.location.hash==='#account-draft/cloud-created');const sent=f.calls.find(c=>c.path==='/api/workspace/drafts'&&c.body);assert.equal(sent.body.projectId,'p1');assert.equal(sent.body.payload.text,'真实用户输入');assert.equal(sent.body.payload.exportUnlocked,undefined);assert.doesNotMatch(JSON.stringify(sent.body),/私人材料/);assert.match(f.w.localStorage.getItem('paperknow-drafts'),/私人材料/);
});

test('an expired session with a non-JSON response clears account content instead of leaving private data on screen',async t=>{
 const f=await fixture(t,{view:'results',request:async path=>path==='/api/workspace/drafts'?{ok:false,status:401,json:async()=>{throw Error('HTML response');}}:undefined});assert.match(f.doc.querySelector('#view').textContent,/登录后查看账户内容/);assert.equal(f.doc.querySelector('[data-result]'),null);assert.equal(f.doc.querySelector('#import-local-draft'),null);
});

test('retrying a failed parse submission reuses the already uploaded original file',async t=>{
 let submissions=0;const f=await fixture(t,{request:async(path,options)=>path==='/api/jobs'&&options.body&&++submissions===1?{ok:false,status:503,json:async()=>({error:'解析暂时不可用'})}:undefined});const file={name:'retry.txt',size:3,lastModified:1,arrayBuffer:async()=>new TextEncoder().encode('abc').buffer};Object.defineProperty(f.doc.querySelector('#upload-file'),'files',{value:[file]});submit(f,'#upload-form');await settle(()=>f.notices.includes('解析暂时不可用'));submit(f,'#upload-form');await settle(()=>f.navigations.length>0);assert.equal(f.calls.filter(c=>c.path==='/api/files'&&c.body).length,1);assert.equal(f.calls.filter(c=>c.path==='/api/jobs'&&c.body).length,2);
});
