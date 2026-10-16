import {membershipPurchaseTiles} from '../dist/workspace/membership-summary.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {esc,icon} from '../dist/workspace/ui.mjs';
import {feedbackKey,normalizeFeedback} from '../dist/workspace/help-model.mjs';
import {supportContactsMarkup,bindSupportContacts} from '../dist/workspace/support-contacts.mjs';
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
 w.membershipPurchaseTiles=membershipPurchaseTiles;w.supportContactsMarkup=supportContactsMarkup;w.bindSupportContacts=bindSupportContacts;w.esc=esc;w.icon=icon;w.feedbackKey=feedbackKey;w.normalizeFeedback=normalizeFeedback;w.keys={drafts:'paperknow-drafts'};w.list=key=>JSON.parse(w.localStorage.getItem(key)||'[]');w.eval(personalCode+'\nwindow.renderOnlinePersonal=renderOnlinePersonal;');
 w.fetch=async(path,options={})=>{const body=options.body?JSON.parse(options.body):undefined;calls.push({path,body,options});if(request){const custom=await request(path,options);if(custom)return custom;}
  let status=200,value={};
  if(path==='/api/capabilities')value={ai,agent,aiProvider:'test-provider',storage:'local'};
  else if(path==='/api/billing/quote')value={token:'quote-for-'+body.type,type:body.type,title:({polish:'学术润色',review:'导师意见修改',agent:'科研智能助手'})[body.type],source:'free',creditCost:0,expiresAt:new Date(Date.now()+60000).toISOString(),policyVersion:1};
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
 f.doc.querySelector('[data-job="failed"]').click();await settle(()=>f.doc.querySelector('#online-confirm').open);assert.equal(f.doc.querySelector('#online-confirm').open,true);f.doc.querySelector('#online-confirm-no').click();await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(f.calls.some(call=>call.path==='/api/jobs/failed/retry'),false);
 f.doc.querySelector('[data-job="failed"]').click();await settle(()=>f.doc.querySelector('#online-confirm').open);f.doc.querySelector('#online-confirm-yes').click();await settle(()=>f.calls.some(call=>call.path==='/api/jobs/failed/retry'));
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
 const f=await fixture(t,{view:'agent'});input(f,'#agent-text','整理这份研究材料');f.doc.querySelector('#agent-materials option').selected=true;submit(f,'#agent-form');await settle(()=>f.doc.querySelector('#online-confirm').open);f.doc.querySelector('#online-confirm-yes').click();await settle(()=>f.calls.some(call=>call.path==='/api/jobs'&&call.body));
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
  {type:'membership',order_id:'paid-current',title:'已购标题 <img src=x onerror=alert(1)>',description:'购买时的说明 <script>alert(1)</script>',starts_at:stamp(-1),expires_at:stamp(3)},
  {type:'membership',order_id:'paid-scheduled',title:'排队中的已购服务',description:'当前权益结束后生效。',starts_at:stamp(4),expires_at:stamp(11)},
  {type:'membership',order_id:'paid/expired',title:'历史已购服务',description:'已到期的真实购买记录。',starts_at:stamp(-14),expires_at:stamp(-7)}
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
 const f=await fixture(t,{view:'membership'});assert.match(f.doc.querySelector('#view').textContent,/暂无已生效的会员权益/);assert.equal(f.doc.querySelectorAll('.account-entitlement').length,0);assert.equal(f.doc.querySelector('a[href*="membership/pay"]'),null);assert.equal(f.calls.filter(call=>call.path==='/api/payments/entitlements').length,1);assert.equal(f.calls.some(call=>call.body&&call.path!=='/api/billing/quote'),false);
});

test('account workspace displays paid bundle snapshots separately with active, scheduled and expired periods',async t=>{
 const today=Date.now(),stamp=offset=>new Date(today+offset*86400000).toISOString();
 const bundles=[{orderId:'bundle/current',productId:'bundle-one',title:'真实套餐 <img src=x>',description:'套餐快照 <script>x</script>',startsAt:stamp(-1),expiresAt:stamp(3),items:[{key:'detection',title:'已购检测',quantity:2}]},{orderId:'bundle-future',productId:'bundle-two',title:'待生效套餐',description:'后续服务',startsAt:stamp(4),expiresAt:stamp(10),items:[{key:'ppt',title:'答辩 PPT',quantity:1}]},{orderId:'bundle-old',productId:'bundle-one',title:'到期记录',description:'历史购买',startsAt:stamp(-14),expiresAt:stamp(-7),items:[{key:'detection',title:'已购检测',quantity:2}]}];
 const f=await fixture(t,{view:'membership',request:async path=>path==='/api/payments/entitlements'?{ok:true,status:200,json:async()=>({items:[{type:'bundle',title:'不能成为会员',starts_at:stamp(-1),expires_at:stamp(999)}],bundles})}:undefined});
 const cards=[...f.doc.querySelectorAll('.member-bundle-record')];assert.equal(cards.length,3);assert.deepEqual(cards.map(card=>card.querySelector('.tag').textContent),['有效','待生效','已到期']);assert.equal(cards[0].querySelector('h3').textContent,bundles[0].title);assert.equal(cards[0].querySelector('.member-bundle-description').textContent,bundles[0].description);assert.match(cards[0].textContent,/已购检测包含 2 次/);assert.equal(cards[0].querySelector('img'),null);assert.equal(cards[0].querySelector('script'),null);assert.ok(cards[0].querySelector('a[href="#membership/pay?order=bundle%2Fcurrent"]'));assert.equal(f.doc.querySelector('.member-purchase-member h2').textContent,'免费使用');assert.equal(f.doc.querySelector('.member-purchase-bundles h2').textContent,'3 份已购套餐');assert.equal(f.doc.querySelectorAll('.account-entitlement').length,0);assert.match(f.doc.querySelector('.member-bundle-records').textContent,/实际已用与预占次数/);assert.equal(f.calls.some(call=>call.body),false);assert.match(f.w.localStorage.getItem('paperknow-drafts'),/本地未上传成果/);
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

test('account project search and status filters combine without changing saved projects or unsaved form input',async t=>{
 const projects=[{id:'p1',title:'人工智能课堂反馈',description:'教育学研究',status:'active',version:1,updated_at:now},{id:'p2',title:'已归档的课堂观察',description:'历史材料',status:'archived',version:2,updated_at:now}];
 const f=await fixture(t,{request:async(path,options)=>path==='/api/projects'&&!options.body?{ok:true,status:200,json:async()=>({items:projects})}:undefined});
 const visible=()=>[...f.doc.querySelectorAll('.account-project-card')].filter(card=>!card.hidden).map(card=>card.querySelector('h2').textContent);
 input(f,'#project-title','尚未提交的项目');
 input(f,'#account-project-query','课堂');assert.deepEqual(visible(),projects.map(project=>project.title));
 const status=f.doc.querySelector('#account-project-status');status.value='archived';status.dispatchEvent(new f.w.Event('change'));assert.deepEqual(visible(),['已归档的课堂观察']);
 input(f,'#account-project-query','教育学');assert.deepEqual(visible(),[]);assert.equal(f.doc.querySelector('#account-project-detail>.management-search-empty').hidden,false);
 status.value='active';status.dispatchEvent(new f.w.Event('change'));assert.deepEqual(visible(),['人工智能课堂反馈']);
 assert.equal(f.doc.querySelector('#project-title').value,'尚未提交的项目');assert.equal(f.calls.some(call=>call.body),false);
 assert.ok(f.doc.querySelector('#project-create-reset'));assert.ok(f.doc.querySelector('[data-account-project-edit="p1"]'));
});

test('account task status filtering preserves current form input and keeps retry confirmation attached to its real task',async t=>{
 const f=await fixture(t,{view:'tasks',ai:false});input(f,'#task-text','尚未提交的论文正文');
 f.doc.querySelector('[data-account-job-filter="failed"]').click();
 assert.equal(f.doc.querySelector('[data-account-job-filter="failed"]').getAttribute('aria-pressed'),'true');
 assert.equal(f.doc.querySelectorAll('.account-job-row').length,1);assert.equal(f.doc.querySelector('[data-job="pending"]'),null);assert.ok(f.doc.querySelector('[data-job="failed"]'));
 assert.equal(f.doc.querySelector('[data-job="failed"]').disabled,true);f.doc.querySelector('[data-job="failed"]').click();assert.equal(f.doc.querySelector('#online-confirm').open,false);
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.calls.some(call=>call.path==='/api/jobs/failed/retry'),false);
 f.doc.querySelector('[data-account-job-filter="completed"]').click();assert.equal(f.doc.querySelectorAll('.account-job-row').length,0);assert.match(f.doc.querySelector('#job-list').textContent,/当前筛选下没有任务/);
 f.doc.querySelector('[data-account-job-filter="all"]').click();assert.equal(f.doc.querySelectorAll('.account-job-row').length,2);
 assert.equal(f.doc.querySelector('#task-text').value,'尚未提交的论文正文');assert.equal(f.calls.some(call=>call.body&&call.path!=='/api/billing/quote'),false);
});

function billingResponse(type,{source='credits',creditCost=12,expiresAt=new Date(Date.now()+60000).toISOString(),...rest}={}){return {ok:true,status:200,json:async()=>({token:'confirmed-'+type,type,title:({polish:'学术润色',review:'导师意见修改',agent:'科研智能助手'})[type],source,creditCost,expiresAt,policyVersion:2,...rest})};}

test('AI task quote is confirmed before submit and the confirmed token travels with the original material',async t=>{
 const f=await fixture(t,{view:'tasks',request:async(path,options)=>path==='/api/billing/quote'?billingResponse(JSON.parse(options.body).type):undefined});
 input(f,'#task-text','用户主动选择的正文');submit(f,'#task-form');await settle(()=>f.doc.querySelector('#online-confirm').open);
 assert.match(f.doc.querySelector('#online-confirm-message').textContent,/本次使用 12 科研积分/);
 assert.equal(f.calls.some(call=>call.path==='/api/jobs'&&call.body),false);
 assert.equal(f.w.onlineTest.onlineWorkspaceRouteGuard('#projects?scope=local'),false);
 f.doc.querySelector('#online-confirm-yes').click();await settle(()=>f.calls.some(call=>call.path==='/api/jobs'&&call.body));
 const post=f.calls.find(call=>call.path==='/api/jobs'&&call.body);assert.equal(post.body.billingQuote,'confirmed-polish');assert.equal(post.body.text,'用户主动选择的正文');assert.equal(post.body.type,'polish');
});

test('cancelled quote retains form input and does not create an AI task or spend anything',async t=>{
 const f=await fixture(t,{view:'tasks',request:async path=>path==='/api/billing/quote'?billingResponse('polish'):undefined});
 input(f,'#task-text','取消后仍保留的原文');submit(f,'#task-form');await settle(()=>f.doc.querySelector('#online-confirm').open);f.doc.querySelector('#online-confirm-no').click();await settle(()=>!f.doc.querySelector('#task-submit').disabled);
 assert.equal(f.calls.some(call=>call.path==='/api/jobs'&&call.body),false);assert.equal(f.doc.querySelector('#task-text').value,'取消后仍保留的原文');
});

test('unavailable quote never bypasses cost confirmation and leaves user material available for retry',async t=>{
 const f=await fixture(t,{view:'tasks',request:async path=>path==='/api/billing/quote'?{ok:false,status:409,json:async()=>({error:'可用积分不足'})}:undefined});
 input(f,'#task-text','保留研究材料');submit(f,'#task-form');await settle(()=>f.notices.includes('可用积分不足'));
 assert.equal(f.doc.querySelector('#online-confirm').open,false);assert.equal(f.calls.some(call=>call.path==='/api/jobs'&&call.body),false);assert.equal(f.doc.querySelector('#task-text').value,'保留研究材料');
});

test('a task quote that expires while its confirmation is open must not be submitted',async t=>{
 let expiry;const f=await fixture(t,{view:'tasks',request:async path=>path==='/api/billing/quote'?billingResponse('polish',{expiresAt:expiry=new Date(Date.now()+90).toISOString()}):undefined});
 input(f,'#task-text','等待确认的正文');submit(f,'#task-form');await settle(()=>f.doc.querySelector('#online-confirm').open);await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(expiry)-Date.now())+15));f.doc.querySelector('#online-confirm-yes').click();await settle(()=>f.notices.some(message=>message.includes('报价已过期')));
 assert.equal(f.calls.some(call=>call.path==='/api/jobs'&&call.body),false);
});

test('AI retry obtains a fresh quote for the real job type and uses its explicitly confirmed entitlement',async t=>{
 const f=await fixture(t,{view:'tasks',request:async(path,options)=>path==='/api/billing/quote'?billingResponse(JSON.parse(options.body).type,{source:'bundle',creditCost:0,sourceOrderId:'paid-bundle'}):undefined});
 f.doc.querySelector('[data-job="failed"]').click();await settle(()=>f.doc.querySelector('#online-confirm').open);assert.match(f.doc.querySelector('#online-confirm-message').textContent,/本次使用套餐权益 1 次/);assert.match(f.doc.querySelector('#online-confirm-message').textContent,/本次重试将按新报价结算/);assert.equal(f.calls.find(call=>call.path==='/api/billing/quote').body.type,'agent');assert.equal(f.calls.some(call=>call.path==='/api/jobs/failed/retry'),false);
 f.doc.querySelector('#online-confirm-yes').click();await settle(()=>f.calls.some(call=>call.path==='/api/jobs/failed/retry'));assert.equal(f.calls.find(call=>call.path==='/api/jobs/failed/retry').body.billingQuote,'confirmed-agent');
});

test('invalid or mismatched cost quotes are rejected without offering confirmation',async t=>{
 const f=await fixture(t,{view:'agent',request:async path=>path==='/api/billing/quote'?billingResponse('polish',{creditCost:-2}):undefined});
 input(f,'#agent-text','整理研究任务');submit(f,'#agent-form');await settle(()=>f.notices.some(message=>message.includes('无法核对')));assert.equal(f.doc.querySelector('#online-confirm').open,false);assert.equal(f.calls.some(call=>call.path==='/api/jobs'&&call.body),false);
});


test('uncertain AI submission retries the same material with the same server idempotency key',async t=>{
 let posts=0;const f=await fixture(t,{view:'tasks',request:async(path,options)=>path==='/api/billing/quote'?billingResponse('polish'):path==='/api/jobs'&&options.body&&++posts===1?{ok:false,status:503,json:async()=>({error:'连接中断，请重试'})}:undefined});
 input(f,'#task-text','只应创建一次的研究任务');submit(f,'#task-form');await settle(()=>f.doc.querySelector('#online-confirm').open);f.doc.querySelector('#online-confirm-yes').click();await settle(()=>f.notices.includes('连接中断，请重试'));
 submit(f,'#task-form');await settle(()=>f.doc.querySelector('#online-confirm').open);f.doc.querySelector('#online-confirm-yes').click();await settle(()=>posts===2);const requests=f.calls.filter(call=>call.path==='/api/jobs'&&call.body);assert.equal(requests.length,2);assert.equal(requests[0].body.idempotencyKey,requests[1].body.idempotencyKey);assert.equal(requests[0].body.text,requests[1].body.text);
});


test('member review action opens the matching task type and confirms the review quote',async t=>{
 const stamp=offset=>new Date(Date.now()+offset*86400000).toISOString();
 const entitlements={items:[{order_id:'member-review',type:'membership',title:'研究会员',starts_at:stamp(-1),expires_at:stamp(7),usage:[{key:'review',title:'导师意见修改',quantity:3,used:0,held:0,remaining:3}]}],bundles:[]};
 const f=await fixture(t,{view:'membership',request:async(path,options)=>path==='/api/payments/entitlements'?{ok:true,status:200,json:async()=>entitlements}:path==='/api/billing/quote'?billingResponse(JSON.parse(options.body).type,{source:'membership',creditCost:0}):undefined});
 const serviceLink=f.doc.querySelector('.account-entitlement .member-quota-rows a');assert.equal(serviceLink.getAttribute('href'),'#tasks?scope=account&type=review');const url=new URL(serviceLink.href),params=new f.w.URLSearchParams(url.hash.split('?')[1]);
 await f.w.onlineTest.mountOnlineWorkspace(f.doc.querySelector('#online'),'tasks',f.ctx,params);assert.equal(f.doc.querySelector('#task-type').value,'review');assert.equal(f.doc.querySelector('#sources-form').hidden,true);
 input(f,'#task-text','根据导师意见整理这份论文');submit(f,'#task-form');await settle(()=>f.doc.querySelector('#online-confirm').open);assert.equal(f.calls.find(call=>call.path==='/api/billing/quote').body.type,'review');assert.match(f.doc.querySelector('#online-confirm-message').textContent,/导师意见修改/);f.doc.querySelector('#online-confirm-yes').click();await settle(()=>f.calls.some(call=>call.path==='/api/jobs'&&call.body));assert.equal(f.calls.find(call=>call.path==='/api/jobs'&&call.body).body.type,'review');
});

test('task deep links cannot select disabled AI or misroute agent into the text modification form',async t=>{
 const f=await fixture(t,{view:'tasks',params:'type=review',ai:false});assert.equal(f.doc.querySelector('#task-type').value,'compare');assert.equal(f.doc.querySelector('#task-submit').disabled,false);
 await f.w.onlineTest.mountOnlineWorkspace(f.doc.querySelector('#online'),'tasks',f.ctx,new f.w.URLSearchParams('type=agent'));assert.equal(f.doc.querySelector('#task-type').value,'compare');assert.equal(f.doc.querySelector('#agent-form'),null);
});


test('paused billing service cannot submit or retry despite a configured AI model while other service stays available',async t=>{
 const capabilities={ai:true,agent:true,aiProvider:'test-provider',billing:{services:[{key:'polish',mode:'disabled',available:true},{key:'review',mode:'paid',creditCost:8,available:true},{key:'agent',mode:'disabled',available:false}]}};
 const f=await fixture(t,{view:'tasks',params:'type=polish',request:async path=>path==='/api/capabilities'?{ok:true,status:200,json:async()=>capabilities}:undefined});
 assert.equal(f.doc.querySelector('#task-type').value,'polish');assert.equal(f.doc.querySelector('#task-submit').disabled,true);assert.match(f.doc.querySelector('#task-note').textContent,/已暂停/);assert.equal(f.doc.querySelector('[data-job="failed"]').disabled,true);
 input(f,'#task-text','服务暂停期间的研究材料');submit(f,'#task-form');await settle(()=>f.notices.some(message=>message.includes('已暂停')));assert.equal(f.doc.querySelector('#task-submit').disabled,true);assert.equal(f.calls.some(call=>call.path==='/api/billing/quote'),false);assert.equal(f.calls.some(call=>call.path==='/api/jobs'&&call.body),false);
 const select=f.doc.querySelector('#task-type');select.value='review';select.dispatchEvent(new f.w.Event('change'));assert.equal(f.doc.querySelector('#task-submit').disabled,false);
 await f.w.onlineTest.mountOnlineWorkspace(f.doc.querySelector('#online'),'agent',f.ctx);assert.equal(f.doc.querySelector('#agent-submit').disabled,true);assert.equal(f.doc.querySelector('#agent-submit').textContent,'已暂停');
});

test('a configured model does not make an unavailable billing service ready',async t=>{
 const f=await fixture(t,{view:'tasks',request:async path=>path==='/api/capabilities'?{ok:true,status:200,json:async()=>({ai:true,agent:true,billing:{services:[{key:'polish',mode:'free',available:false},{key:'review',mode:'paid',available:true},{key:'agent',mode:'paid',available:false}]}})}:undefined});
 assert.equal(f.doc.querySelector('#task-submit').disabled,true);assert.match(f.doc.querySelector('#task-note').textContent,/完成服务配置/);await f.w.onlineTest.mountOnlineWorkspace(f.doc.querySelector('#online'),'agent',f.ctx);assert.equal(f.doc.querySelector('#agent-submit').disabled,true);assert.equal(f.doc.querySelector('#agent-submit').textContent,'待配置');
});
