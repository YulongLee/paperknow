import {publicDraftCopy} from '../dist/workspace/public-draft.mjs';
import {withStableView,resetStableView,keepsWorkspacePosition,installStableDisclosures} from '../dist/workspace/view-stability.mjs';
import {membershipPurchaseTiles} from '../dist/workspace/membership-summary.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {esc,icon} from '../dist/workspace/ui.mjs';
import {thesisEditorPresentation,restoreThesisEditorText} from '../dist/workspace/thesis-editor-presentation.mjs';
import {presentThesisDocument} from '../dist/workspace/thesis-document.mjs';
import {feedbackKey,normalizeFeedback} from '../dist/workspace/help-model.mjs';
import {supportContactsMarkup,bindSupportContacts} from '../dist/workspace/support-contacts.mjs';
const personalCode=(await readFile(new URL('../dist/workspace/online-personal-services.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const code=(await readFile(new URL('../dist/workspace/online-workspace.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const now='2026-10-15T00:00:00Z';
async function settle(check){for(let i=0;i<80;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,4));}throw Error('UI did not settle');}
async function fixture(t,{guest=false,ai=true,agent=true,view='projects',params='',request,pollTimers=false}={}){
 const dom=new JSDOM('<div id="app"><aside id="existing-sidebar">现有导航</aside><main class="dashboard"><div id="online"></div></main></div>',{url:'https://paperknow.cn/workspace.html#projects?scope=account',runScripts:'outside-only'}),w=dom.window;
 t.after(()=>{w.onlineTest.disposeOnlineWorkspace();w.close();});
 const scheduledPolls=[],pollWarnings=[];if(pollTimers){const originalSetTimeout=w.setTimeout.bind(w);w.setTimeout=(callback,delay,...args)=>{if(delay===5000){scheduledPolls.push(()=>callback(...args));return 900000+scheduledPolls.length;}return originalSetTimeout(callback,delay,...args);};Object.defineProperty(w.document,'hidden',{configurable:true,value:false});w.console.warn=(...args)=>pollWarnings.push(args);}
 w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const exportBodies=[];const OriginalBlob=w.Blob;w.Blob=class extends OriginalBlob{constructor(parts,options){super(parts,options);this.testContent=parts.join('');}};w.URL.createObjectURL=blob=>{exportBodies.push(blob.testContent);return 'blob:test';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push(this.download);};
 w.localStorage.setItem('paperknow-drafts','[{"title":"本地未上传成果"}]');
 w.download=async(name,content)=>{exportBodies.push(content);downloads.push(name);return {message:'已保存到账户云文件并发起下载。'};};
 const calls=[],navigations=[],downloads=[],notices=[];let saved=[],projects=[{id:'p1',title:'账户研究项目',degree:'本科',major:'教育学',updated_at:now}],files=[{id:'f1',name:'账户原件.txt',bytes:30,project_id:'p1'}],jobs=[{id:'pending',type:'parse',status:'queued',attempt:0,created_at:now},{id:'failed',type:'agent',status:'failed',attempt:1,created_at:now,error:'测试任务失败'}];
 Object.assign(w,{withStableView,resetStableView,keepsWorkspacePosition,installStableDisclosures,thesisEditorPresentation,restoreThesisEditorText,presentThesisDocument});w.publicDraftCopy=publicDraftCopy;w.membershipPurchaseTiles=membershipPurchaseTiles;w.supportContactsMarkup=supportContactsMarkup;w.bindSupportContacts=bindSupportContacts;w.esc=esc;w.icon=icon;w.feedbackKey=feedbackKey;w.normalizeFeedback=normalizeFeedback;w.keys={drafts:'paperknow-drafts'};w.list=key=>JSON.parse(w.localStorage.getItem(key)||'[]');w.eval(personalCode+'\nwindow.renderOnlinePersonal=renderOnlinePersonal;');
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
 return {w,doc:w.document,calls,navigations,downloads,notices,saved,ctx,exportBodies,scheduledPolls,pollWarnings};
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
 assert.deepEqual(f.navigations,['#tasks?scope=account&project=p1']);
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
 const f=await fixture(t,{view:'results',params:'result=r1'});assert.equal(f.doc.querySelector('#revision-text').value,'原始建议');assert.doesNotMatch(f.doc.querySelector('#result-detail').textContent,/test-model|模型/);assert.match(f.doc.querySelector('#result-detail').textContent,/AI 生成内容/);assert.equal(f.w.onlineTest.onlineWorkspaceHasWork(),false);
 input(f,'#revision-text','人工核对后的编辑稿');assert.equal(f.w.onlineTest.onlineWorkspaceHasWork(),true);submit(f,'#revision-form');
 await settle(()=>f.saved.length===1);await settle(()=>f.notices.includes('新版本已保存'));
 assert.equal(f.doc.querySelector('#revision-text').value,'人工核对后的编辑稿');assert.equal(f.saved[0].body,'人工核对后的编辑稿');assert.match(f.doc.querySelector('.compare pre').textContent,/真实原文/);assert.equal(f.w.onlineTest.onlineWorkspaceHasWork(),false);
 f.doc.querySelector('#export-result').click();assert.deepEqual(f.downloads,['PaperKnow成果.txt']);
});

test('generated thesis outlines open and export safely without requesting unsupported revisions',async t=>{
 const outline='1. 数字阅读服务研究背景\n1.1 用户需求 <script>alert(1)</script>';
 const item={id:'outline-result',type:'thesis_outline',title:'主题专属论文提纲',created_at:now,body:{text:outline,model:'configured-model'}};
 const f=await fixture(t,{view:'results',params:'result=outline-result',request:async path=>path==='/api/results'?{ok:true,status:200,json:async()=>({items:[item]})}:path==='/api/results/outline-result'?{ok:true,status:200,json:async()=>({item})}:undefined});
 assert.equal(f.doc.querySelector('#result-detail pre').textContent,outline);
 assert.equal(f.doc.querySelector('#result-detail script'),null);
 assert.doesNotMatch(f.doc.querySelector('#result-detail').textContent,/configured-model|后台配置模型/);assert.match(f.doc.querySelector('#result-detail').textContent,/AI 生成提纲/);
 assert.ok(f.doc.querySelector('#result-detail a[href="#tool/writing"]'));
 assert.equal(f.doc.querySelector('#revision-form'),null);
 assert.equal(f.calls.some(call=>call.path.endsWith('/revisions')),false);
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
 f.w.localStorage.setItem('paperknow-drafts',JSON.stringify([{id:'local1',title:'仅上传这一份',tool:'writing',text:'真实用户输入',exportUnlocked:true},{id:'local2',title:'另一份不上传',tool:'writing',text:'私人材料'}]));f.doc.querySelector('#import-local-draft').click();await settle(()=>f.doc.querySelector('#draft-import-id'));assert.equal(f.calls.some(c=>c.body),false);f.doc.querySelector('#draft-import-id').value='local1';f.doc.querySelector('#draft-import-project').value='p1';submit(f,'#draft-import-form');await settle(()=>f.w.location.hash==='#account-draft/cloud-created');const sent=f.calls.find(c=>c.path==='/api/workspace/drafts'&&c.body);assert.equal(sent.body.projectId,'p1');assert.equal(sent.body.payload.text,'真实用户输入');assert.equal(sent.body.payload.exportUnlocked,undefined);assert.doesNotMatch(JSON.stringify(sent.body),/私人材料/);assert.match(f.w.localStorage.getItem('paperknow-drafts'),/私人材料/);
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

test('result management preserves unsaved edits when changing panels or deleting another draft is declined',async t=>{
 const cloud=[{id:'cloud1',title:'保留的账户草稿',tool:'writing',version:2,project_id:'p1',updated_at:now}];
 const f=await fixture(t,{view:'results',request:async(path,options)=>path==='/api/workspace/drafts'&&!options.body?{ok:true,status:200,json:async()=>({items:cloud})}:undefined});
 f.doc.querySelector('[data-result="r1"]').click();await settle(()=>f.doc.querySelector('#revision-text'));input(f,'#revision-text','尚未保存的研究修改');
 for(const selector of ['#import-local-draft','[data-draft-project="cloud1"]','[data-result-organize="r1"]','[data-draft-delete="cloud1"]']){
  f.doc.querySelector(selector).click();await settle(()=>f.doc.querySelector('#online-confirm').open);assert.equal(f.doc.querySelector('#revision-text').value,'尚未保存的研究修改');f.doc.querySelector('#online-confirm-no').click();await settle(()=>!f.doc.querySelector('#online-confirm').open);
 }
 assert.equal(f.calls.some(call=>call.path.includes('/delete')||call.body),false);
 f.doc.querySelector('[data-draft-project="cloud1"]').click();await settle(()=>f.doc.querySelector('#online-confirm').open);f.doc.querySelector('#online-confirm-yes').click();await settle(()=>f.doc.querySelector('#draft-organize'));assert.equal(f.doc.querySelector('#revision-form'),null);input(f,'#draft-title','草稿名称修改尚未保存');
 f.doc.querySelector('[data-result-organize="r1"]').click();await settle(()=>f.doc.querySelector('#online-confirm').open);f.doc.querySelector('#online-confirm-no').click();assert.equal(f.doc.querySelector('#draft-title').value,'草稿名称修改尚未保存');
});

test('account project scope keeps original files, result counts and task metrics aligned to that project',async t=>{
 const projects=[{id:'p1',title:'当前研究',status:'active',stage:'detection',version:1},{id:'p2',title:'其他研究',status:'active',version:1}],files=[{id:'f1',name:'当前原件.txt',project_id:'p1',bytes:5,sha256:'a'.repeat(64)},{id:'f2',name:'其他原件.txt',project_id:'p2',bytes:7,sha256:'b'.repeat(64)}],jobs=[{id:'j1',type:'parse',project_id:'p1',status:'queued',attempt:1,created_at:now},{id:'j2',type:'parse',project_id:'p2',status:'queued',attempt:1,created_at:now}],results=[{id:'r1',type:'parse',title:'当前成果',project_id:'p1',created_at:now},{id:'r2',type:'parse',title:'其他成果',project_id:'p2',created_at:now}];
 const request=async(path,options)=>!options.body&&({'/api/projects':projects,'/api/files':files,'/api/jobs':jobs,'/api/results':results}[path])?{ok:true,status:200,json:async()=>({items:({'/api/projects':projects,'/api/files':files,'/api/jobs':jobs,'/api/results':results}[path])})}:undefined;
 const f=await fixture(t,{params:'project=p1',request});assert.match(f.doc.querySelector('.account-originals').textContent,/当前原件/);assert.doesNotMatch(f.doc.querySelector('.account-originals').textContent,/其他原件/);assert.equal(f.doc.querySelector('[data-management-stat="已保存原件"]').textContent,'1');assert.match(f.doc.querySelector('.account-project-card').textContent,/检测/);
 await f.w.onlineTest.mountOnlineWorkspace(f.doc.querySelector('#online'),'tasks',f.ctx,new f.w.URLSearchParams('project=p1'));assert.equal(f.doc.querySelector('[data-management-stat="处理中 / 排队"]').textContent,'1');assert.equal(f.doc.querySelectorAll('.account-job-row').length,1);
 await f.w.onlineTest.mountOnlineWorkspace(f.doc.querySelector('#online'),'results',f.ctx,new f.w.URLSearchParams('project=p1'));assert.equal(f.doc.querySelector('[data-management-stat="处理成果"]').textContent,'1');assert.match(f.doc.querySelector('.management-assets-search').textContent,/1 份内容/);assert.doesNotMatch(f.doc.querySelector('.management-result-rows').textContent,/其他成果/);
});

test('unknown account project shows an accurate missing-project state without selecting an invalid upload destination',async t=>{
 const f=await fixture(t,{params:'project=missing'});assert.match(f.doc.querySelector('#account-project-detail').textContent,/未找到这个账户项目/);assert.equal(f.doc.querySelector('#upload-project').value,'');assert.equal(f.doc.querySelector('#account-file-upload').open,false);
});

test('account tasks can find cancelled records by project or ID without discarding current material',async t=>{
 const jobs=[{id:'j-cancel',type:'parse',status:'cancelled',project_id:'p1',attempt:1,created_at:now},{id:'j-done',type:'compare',status:'completed',attempt:1,created_at:now}];
 const f=await fixture(t,{view:'tasks',request:async path=>path==='/api/jobs'?{ok:true,status:200,json:async()=>({items:jobs})}:undefined});input(f,'#task-text','仍然保留的任务材料');f.doc.querySelector('[data-account-job-filter="cancelled"]').click();input(f,'#account-job-query','账户研究');assert.equal(f.doc.querySelectorAll('.account-job-row').length,1);input(f,'#account-job-query','j-done');assert.equal(f.doc.querySelectorAll('.account-job-row').length,0);f.doc.querySelector('[data-account-job-filter="all"]').click();assert.equal(f.doc.querySelectorAll('.account-job-row').length,1);assert.equal(f.doc.querySelector('#task-text').value,'仍然保留的任务材料');assert.match(f.doc.querySelector('.management-list-range').textContent,/最近 100 条任务/);assert.equal(f.calls.some(call=>call.body),false);
});

test('uncertain parse submission reuses both saved original and idempotency key',async t=>{
 let attempts=0;const f=await fixture(t,{request:async(path,options)=>path==='/api/jobs'&&options.body&&++attempts===1?{ok:false,status:503,json:async()=>({error:'连接已中断'})}:undefined});const file={name:'same.txt',size:3,lastModified:1,arrayBuffer:async()=>new TextEncoder().encode('abc').buffer};Object.defineProperty(f.doc.querySelector('#upload-file'),'files',{value:[file]});submit(f,'#upload-form');await settle(()=>f.notices.includes('连接已中断'));submit(f,'#upload-form');await settle(()=>attempts===2);const calls=f.calls.filter(call=>call.path==='/api/jobs'&&call.body);assert.equal(calls[0].body.idempotencyKey,calls[1].body.idempotencyKey);assert.equal(f.calls.filter(call=>call.path==='/api/files'&&call.body).length,1);
});

test('deleting an original requires explicit confirmation and a matching file fingerprint, preserving records on failure',async t=>{
 const files=[{id:'f/1',name:'应保留的原件.txt',project_id:'p1',bytes:5,sha256:'a'.repeat(64)}];let deleted=false;
 const f=await fixture(t,{request:async(path,options)=>path==='/api/files'&&!options.body?{ok:true,status:200,json:async()=>({items:deleted?[]:files})}:path==='/api/files/f%2F1/delete'?{ok:false,status:409,json:async()=>({error:'原件仍被任务使用'})}:undefined});
 assert.equal(f.calls.some(call=>call.body),false);f.doc.querySelector('[data-account-file-delete]').click();await settle(()=>f.doc.querySelector('#online-confirm').open);assert.match(f.doc.querySelector('#online-confirm-message').textContent,/已经生成的成果与草稿会保留/);f.doc.querySelector('#online-confirm-no').click();await settle(()=>!f.doc.querySelector('#online-confirm').open);assert.equal(f.calls.some(call=>call.path.endsWith('/delete')),false);
 f.doc.querySelector('[data-account-file-delete]').click();await settle(()=>f.doc.querySelector('#online-confirm').open);f.doc.querySelector('#online-confirm-yes').click();await settle(()=>f.notices.includes('原件仍被任务使用'));assert.equal(f.calls.find(call=>call.path.endsWith('/delete')).body.expectedSha256,'a'.repeat(64));assert.match(f.doc.querySelector('.account-originals').textContent,/应保留的原件/);
});

test('pending original deletion offers a retry without exposing download or inclusion in a new agent task',async t=>{
 const files=[{id:'f1',name:'正在删除的原件.txt',bytes:9,sha256:'a'.repeat(64),deletionStatus:'pending'}];let removed=false;const request=async(path,options)=>path==='/api/files'&&!options.body?{ok:true,status:200,json:async()=>({items:removed?[]:files})}:path==='/api/files/f1/delete'?(removed=true,{ok:true,status:200,json:async()=>({ok:true})}):undefined;
 const f=await fixture(t,{request});assert.match(f.doc.querySelector('.account-originals').textContent,/删除未完成，可重试/);assert.equal(f.doc.querySelector('.account-originals a[href*="download"]'),null);f.doc.querySelector('[data-account-file-delete]').click();await settle(()=>f.doc.querySelector('#online-confirm').open);f.doc.querySelector('#online-confirm-yes').click();await settle(()=>f.notices.includes('原件已删除，已生成成果仍保留。'));assert.equal(f.doc.querySelector('[data-account-file-delete]'),null);
 removed=false;await f.w.onlineTest.mountOnlineWorkspace(f.doc.querySelector('#online'),'agent',f.ctx);assert.equal(f.doc.querySelectorAll('#agent-materials option').length,0);
});

test('refreshing an edited project resets editing identity so a later new project cannot overwrite the old one',async t=>{
 const f=await fixture(t);f.doc.querySelector('[data-account-project-edit="p1"]').click();await settle(()=>f.doc.querySelector('#project-edit-note').textContent.includes('正在编辑'));input(f,'#project-title','放弃的项目修改');f.doc.querySelector('.account-refresh').click();await settle(()=>f.doc.querySelector('#online-confirm').open);f.doc.querySelector('#online-confirm-yes').click();await settle(()=>f.notices.includes('已读取最新账户内容'));assert.equal(f.doc.querySelector('#project-title').value,'');input(f,'#project-title','真正的新项目');submit(f,'#project-form');await settle(()=>f.notices.includes('项目已保存'));assert.equal(f.calls.some(call=>call.path==='/api/projects/p1'&&call.body),false);assert.equal(f.calls.find(call=>call.path==='/api/projects'&&call.body).body.title,'真正的新项目');
});

test('legacy provider metadata never appears in AI task forms or usage rows',async t=>{
 const f=await fixture(t,{view:'tasks'});assert.match(f.doc.querySelector('#task-note').textContent,/AI 服务处理/);assert.doesNotMatch(f.doc.querySelector('#online').textContent,/test-provider|test-model/);
 const agent=await fixture(t,{view:'agent'});assert.match(agent.doc.querySelector('#agent-form').textContent,/AI 服务处理/);assert.doesNotMatch(agent.doc.querySelector('#online').textContent,/test-provider|test-model/);
 const usage=await fixture(t,{view:'usage'});assert.match(usage.doc.querySelector('#online').textContent,/AI 服务调用明细/);assert.doesNotMatch(usage.doc.querySelector('#online').textContent,/test-provider|test-model|未返回模型名/);assert.match(usage.doc.querySelector('#online').textContent,/12/);assert.match(usage.doc.querySelector('#online').textContent,/未知/);
});

test('AI result previews omit model engine and raw tool identities but retain research text and material evidence',async t=>{
 const item={id:'private-agent-result',type:'agent',title:'研究任务成果',body:{model:'private-model',engine:'codex_sdk',provider:'private-provider',original:'研究说明：采用回归模型分析',suggestion:'用户研究主题可涉及 OpenAI 的公开研究。',materials:[{name:'真实材料名称'}],trace:[{tool:'read_material',status:'completed',server:'claude-code'},{tool:'private-engine-tool',status:'provider-private-status'}]}};
 const f=await fixture(t,{view:'results',params:'result=private-agent-result',request:async path=>path==='/api/results'?{ok:true,status:200,json:async()=>({items:[item]})}:path==='/api/results/private-agent-result'?{ok:true,status:200,json:async()=>({item})}:path==='/api/results/private-agent-result/revisions'?{ok:true,status:200,json:async()=>({items:[]})}:undefined});
 const text=f.doc.querySelector('#result-detail').textContent;assert.doesNotMatch(text,/private-model|codex_sdk|private-provider|claude-code|private-engine-tool|provider-private-status/);assert.match(text,/AI 生成内容/);assert.match(text,/真实材料名称/);assert.match(text,/读取资料正文 · 已完成/);assert.match(text,/资料处理 · 已记录/);assert.equal(f.doc.querySelector('#revision-text').value,item.body.suggestion);assert.match(text,/采用回归模型分析/);
});

test('AI method results use a neutral origin label without losing the proposed-method notice',async t=>{
 const item={id:'method-private-result',type:'thesis_method',title:'研究方法建议',body:{model:'private-model',engine:'codex_sdk',text:'拟开展：文献分析与回归模型比较。'}};
 const f=await fixture(t,{view:'results',params:'result=method-private-result',request:async path=>path==='/api/results'?{ok:true,status:200,json:async()=>({items:[item]})}:path==='/api/results/method-private-result'?{ok:true,status:200,json:async()=>({item})}:undefined});
 const text=f.doc.querySelector('#result-detail').textContent;assert.doesNotMatch(text,/private-model|codex_sdk/);assert.match(text,/AI 生成方法建议/);assert.match(text,/拟开展方案/);assert.equal(f.doc.querySelector('#result-detail pre').textContent,item.body.text);
});

test('writing jobs have concrete task labels and return links, expose cancellation but never generic retry',async t=>{
 const writingJobs=[{id:'writing-failed',type:'writing',writing_kind:'proposal',writing_operation:'draft',status:'failed',attempt:1,created_at:now,error:'写作未完成，已保留草稿'},{id:'writing-running',type:'writing',writing_kind:'summary',writing_operation:'outline',status:'running',attempt:1,created_at:now},{id:'writing-legacy',type:'writing',writing_kind:'<script>',writing_operation:'unknown',status:'failed',attempt:1,created_at:now}];
 const f=await fixture(t,{view:'tasks',request:async path=>path==='/api/jobs'?{ok:true,status:200,json:async()=>({items:writingJobs})}:undefined});
 const rows=[...f.doc.querySelectorAll('.account-job-row')];assert.equal(rows.length,3);assert.match(rows[0].querySelector('.account-job-title').textContent,/开题报告 · 正文生成/);assert.match(rows[1].querySelector('.account-job-title').textContent,/文献综述 · 提纲生成/);assert.equal(rows[0].querySelector('[data-action=retry]'),null);assert.ok(rows[0].querySelector('a[href="#tool/proposal"]'));assert.ok(rows[1].querySelector('[data-action=cancel]'));assert.ok(rows[1].querySelector('a[href="#tool/summary"]'));assert.ok(rows[2].querySelector('a[href="#category/writing"]'));assert.equal(f.doc.querySelector('#job-list script'),null);
 input(f,'#account-job-query','开题报告');assert.equal(f.doc.querySelectorAll('.account-job-row').length,1);assert.equal(f.calls.some(call=>/writing-failed\/retry/.test(call.path)),false);
});

test('writing result editing preserves canonical citation bindings and original text while exporting a readable traceable document',async t=>{
 const original='基于合成研究材料讨论服务入口。[source:material-private-id]结合文献比较。[source:reference-long-id]旧引用待核对。[source:missing-legacy-id]';
 const item={id:'writing-result',type:'writing',title:'开题报告合成验收稿',created_at:now,body:{text:original,kind:'proposal',operation:'draft',writingJobId:'writing-task',model:'must-not-show-model',sourceIds:['material-private-id','reference-long-id','missing-legacy-id'],sourceSnapshot:{materials:[{id:'material-private-id',name:'合成服务观察材料',confirmed:true}],references:[{id:'reference-long-id',title:'Reading services <script>bad()</script>',authors:'合成作者',year:'2026',doi:'10.1234/synthetic',url:'https://research.example.test/paper',confirmed:true}]}}};
 const revisions=[];const f=await fixture(t,{view:'results',params:'result=writing-result',request:async(path,options)=>path==='/api/results'?{ok:true,status:200,json:async()=>({items:[item]})}:path==='/api/results/writing-result'?{ok:true,status:200,json:async()=>({item})}:path==='/api/results/writing-result/revisions'?{ok:true,status:200,json:async()=>{if(options.body){revisions.unshift({id:'revision-'+revisions.length,body:JSON.parse(options.body).text,created_at:now});return{id:revisions[0].id};}return{items:revisions};}}:undefined});
 const editor=f.doc.querySelector('#revision-text');assert.ok(editor);assert.match(editor.value,/〔材料1〕.*〔文献1〕.*〔待核对来源1〕/);assert.doesNotMatch(editor.value,/\[source:|undefined/);assert.match(f.doc.querySelector('#result-detail').textContent,/合成服务观察材料/);assert.ok(f.doc.querySelector('#result-detail a[href="#tool/proposal"]'));assert.equal(f.doc.querySelector('#result-detail script'),null);assert.doesNotMatch(f.doc.querySelector('#result-detail').textContent,/must-not-show-model/);
 input(f,'#revision-text',editor.value+'\n人工复核；手工编号 [1] 不应被改写。');submit(f,'#revision-form');await settle(()=>revisions.length===1);await settle(()=>f.notices.includes('新版本已保存'));assert.equal(revisions[0].body,original+'\n人工复核；手工编号 [1] 不应被改写。');assert.equal(item.body.text,original);assert.doesNotMatch(f.doc.querySelector('#revision-text').value,/\[source:/);assert.match(f.doc.querySelector('#result-detail').textContent,/已保存版本/);
 f.doc.querySelector('#export-result').click();const text=f.exportBodies.at(-1);assert.match(text,/\[材料1\].*\[1\].*\[来源待核对\]/);assert.match(text,/合成服务观察材料/);assert.match(text,/10.1234\/synthetic/);assert.match(text,/引用核对提示/);assert.doesNotMatch(text,/\[source:|material-private-id|reference-long-id|missing-legacy-id|undefined/);
 f.doc.querySelector('#original-suggestion').click();await settle(()=>f.doc.querySelector('#online-confirm').open);f.doc.querySelector('#online-confirm-yes').click();await settle(()=>!f.doc.querySelector('#revision-text').value.includes('人工复核'));assert.equal(item.body.text,original);assert.equal(revisions.length,1);
});

test('legacy writing results without a source snapshot remain editable and unknown citations are explicitly marked',async t=>{
 const item={id:'legacy-writing',type:'writing',title:'旧写作结果',created_at:now,body:{kind:'quick',operation:'draft',text:'旧正文[source:opaque-id]',sourceIds:['opaque-id']}};
 const f=await fixture(t,{view:'results',params:'result=legacy-writing',request:async path=>path==='/api/results'?{ok:true,status:200,json:async()=>({items:[item]})}:path==='/api/results/legacy-writing'?{ok:true,status:200,json:async()=>({item})}:path==='/api/results/legacy-writing/revisions'?{ok:true,status:200,json:async()=>({items:[]})}:undefined});
 assert.equal(f.doc.querySelector('#revision-text').value,'旧正文〔待核对来源1〕');assert.match(f.doc.querySelector('#result-detail').textContent,/来源待核对|未匹配/);input(f,'#revision-text','旧正文〔待核对来源1〕 新引用〔文献2〕');assert.match(f.doc.querySelector('#writing-result-citation-note').textContent,/没有匹配/);f.doc.querySelector('#export-result').click();assert.match(f.exportBodies.at(-1),/来源待核对/);assert.match(f.exportBodies.at(-1),/未关联来源标记待核对：〔文献2〕/);assert.doesNotMatch(f.exportBodies.at(-1),/opaque-id|\[source:/);
});

test('task polling safely diagnoses silent render errors, avoids repeating toast spam and recovers on the next valid response',async t=>{let reads=0;const f=await fixture(t,{view:'tasks',pollTimers:true,request:async path=>{if(path!=='/api/jobs')return;reads++;if(reads===2||reads===3)return{ok:true,status:200,json:async()=>({items:[null]})};return{ok:true,status:200,json:async()=>({items:[{id:'writing-live',type:'writing',writing_kind:'course',writing_operation:'draft',status:'completed',attempt:1,created_at:now}]})};}});assert.equal(f.scheduledPolls.length,1);await f.scheduledPolls[0]();assert.equal(f.pollWarnings.length,1);assert.equal(f.pollWarnings[0][0],'任务列表更新未完成');assert.equal(f.pollWarnings[0][1].name,'TypeError');assert.match(f.pollWarnings[0][1].message,/Cannot read properties/);assert.deepEqual(Object.keys(f.pollWarnings[0][1]).sort(),['message','name','status']);const count=f.notices.length;await f.scheduledPolls[1]();assert.equal(f.notices.length,count,'same ongoing failure does not keep showing a global toast');await f.scheduledPolls[2]();assert.match(f.doc.querySelector('#job-list').textContent,/课程作业 · 正文生成/);assert.equal(f.doc.querySelector('#online-notice').textContent,'');});
test('a detached or replaced account task panel cannot poll again or show a stale toast on another page',async t=>{let reads=0;const f=await fixture(t,{view:'tasks',pollTimers:true,request:async path=>{if(path==='/api/jobs'){reads++;return{ok:true,status:200,json:async()=>({items:[]})};}}});const count=f.notices.length,scheduled=f.scheduledPolls.length;f.doc.querySelector('#online').innerHTML='<section id="replacement-feature">另一个功能页面</section>';await f.scheduledPolls[0]();assert.equal(reads,1);assert.equal(f.notices.length,count);assert.equal(f.scheduledPolls.length,scheduled);assert.ok(f.doc.querySelector('#replacement-feature'));});
test('poll diagnostics never log API error bodies, source text, model identities, credentials or runtime endpoints',async t=>{let reads=0;const secret='private-model secret-key https://private-provider.example.test source-user-text';const f=await fixture(t,{view:'tasks',pollTimers:true,request:async path=>{if(path!=='/api/jobs')return;if(++reads===1)return{ok:true,status:200,json:async()=>({items:[]})};return{ok:false,status:503,json:async()=>({error:secret})};}});await f.scheduledPolls[0]();assert.equal(f.pollWarnings.length,1);assert.equal(f.pollWarnings[0][1].status,503);assert.doesNotMatch(JSON.stringify(f.pollWarnings),/private-model|secret-key|private-provider|source-user-text/);});
async function writingSourceResultFixture(t,item){const revisions=[];const f=await fixture(t,{view:'results',params:'result='+item.id,request:async(path,options)=>path==='/api/results'?{ok:true,status:200,json:async()=>({items:[item]})}:path==='/api/results/'+item.id?{ok:true,status:200,json:async()=>({item})}:path==='/api/results/'+item.id+'/revisions'?{ok:true,status:200,json:async()=>{if(options.body){revisions.unshift({id:'revision-'+revisions.length,body:JSON.parse(options.body).text,created_at:now});return{id:revisions[0].id};}return{items:revisions};}}:undefined});return{...f,revisions};}
test('declared generated sources stay visible and exported when the generated draft contains no inline citation markers',async t=>{const text='本稿基于提供的合成材料整理实践过程，仅用于功能验收。',item={id:'writing-no-inline',type:'writing',title:'实践报告合成稿',created_at:now,body:{kind:'practice',operation:'draft',text,sourceIds:['used-material','used-reference'],sourceSnapshot:{materials:[{id:'used-material',name:'已实际读取的合成实践材料',confirmed:true}],references:[{id:'used-reference',title:'合成阅读支持文献',authors:'测试作者',year:'2026',doi:'10.1234/retained',confirmed:true}]}}};const f=await writingSourceResultFixture(t,item);assert.equal(f.doc.querySelector('#revision-text').value,text,'declaration does not fabricate inline citations');assert.match(f.doc.querySelector('#result-detail').textContent,/生成时已声明来源.*已实际读取的合成实践材料/);assert.match(f.doc.querySelector('#result-detail').textContent,/合成阅读支持文献/);input(f,'#revision-text',text+' 人工核对后保存。');submit(f,'#revision-form');await settle(()=>f.revisions.length===1);await settle(()=>f.notices.includes('新版本已保存'));f.doc.querySelector('#export-result').click();const exported=f.exportBodies.at(-1);assert.match(exported,/研究材料来源/);assert.match(exported,/已实际读取的合成实践材料/);assert.match(exported,/已使用的参考文献/);assert.match(exported,/10.1234\/retained/);assert.deepEqual(item.body.sourceIds,['used-material','used-reference']);assert.equal(item.body.text,text);assert.doesNotMatch(exported,/used-material|used-reference|\[source:/);});
test('removing an original inline marker in a new revision does not discard its generated source inventory',async t=>{const original='原始论证来自确认材料。[source:original-material]',item={id:'writing-removed-inline',type:'writing',title:'开题报告来源恢复',created_at:now,body:{kind:'proposal',operation:'draft',text:original,sourceIds:[],sourceSnapshot:{materials:[{id:'original-material',name:'原始实际使用的合成材料',confirmed:true}],references:[]}}};const f=await writingSourceResultFixture(t,item);assert.match(f.doc.querySelector('#revision-text').value,/〔材料1〕/);input(f,'#revision-text','用户删掉行内标记后的编辑稿。');submit(f,'#revision-form');await settle(()=>f.revisions.length===1);await settle(()=>f.notices.includes('新版本已保存'));assert.equal(f.revisions[0].body,'用户删掉行内标记后的编辑稿。');assert.match(f.doc.querySelector('#result-detail').textContent,/生成时已声明来源.*原始实际使用的合成材料/);f.doc.querySelector('#export-result').click();assert.match(f.exportBodies.at(-1),/原始实际使用的合成材料/);assert.match(f.exportBodies.at(-1),/研究材料来源/);assert.equal(item.body.text,original);assert.deepEqual(item.body.sourceIds,[]);});

test('web similarity tasks return to their owned report and never offer generic resubmission or editor exports',async t=>{
 const job={id:'web-1',type:'web_similarity',status:'completed',created_at:now,result_id:'web-result-1'};
 const request=async(path,options={})=>{if(path==='/api/jobs')return {ok:true,status:200,json:async()=>({items:[job]})};if(path==='/api/results')return {ok:true,status:200,json:async()=>({items:[{id:'web-result-1',type:'web_similarity',title:'公开来源核对',created_at:now}]})};if(path==='/api/results/web-result-1')return {ok:true,status:200,json:async()=>({item:{id:'web-result-1',job_id:'web-1',type:'web_similarity',title:'公开来源核对',body:{webSimilarityId:'web-1',characters:120,ratio:0,scope:'public-web-sources'}}})};return null;};
 const f=await fixture(t,{view:'tasks',request});assert.match(f.doc.querySelector('#job-list').textContent,/联网来源查重/);assert.ok([...f.doc.querySelectorAll('a')].some(a=>a.getAttribute('href')==='#category/detection?view=web&report=web-1'));assert.equal(f.doc.querySelector('[data-action="retry"]'),null);
 await f.w.onlineTest.mountOnlineWorkspace(f.doc.querySelector('#online'),'results',f.ctx,new f.w.URLSearchParams('result=web-result-1'));const detail=f.doc.querySelector('#result-detail');assert.match(detail.textContent,/仅展示本次任务摘要/);assert.match(detail.textContent,/不等于不存在重复/);assert.equal(detail.querySelector('#revision-text'),null);assert.equal(detail.querySelector('#export-result').hidden,true);assert.ok([...detail.querySelectorAll('a')].some(a=>a.getAttribute('href')==='#category/detection?view=web&report=web-1'));assert.equal(f.calls.some(call=>call.path.includes('web-result-1/revisions')),false);
});
