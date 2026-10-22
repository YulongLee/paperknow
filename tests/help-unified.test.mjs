import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {renderOnlinePersonal} from '../dist/workspace/online-personal-services.mjs';
import {helpKnowledgeMarkup,bindHelpKnowledge} from '../dist/workspace/help.mjs';
import {supportContactsMarkup,bindSupportContacts} from '../dist/workspace/support-contacts.mjs';
import {esc,icon} from '../dist/workspace/ui.mjs';
import {withStableView} from '../dist/workspace/view-stability.mjs';
import {workspaceJobLabel,workspaceJobStatusLabel,workspaceJobActive} from '../dist/workspace/workspace-job-model.mjs';

const onlineCode=(await readFile(new URL('../dist/workspace/online-workspace.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function settle(check){for(let i=0;i<80;i++){if(check())return;await tick();}throw Error('help UI did not settle');}
async function fixture(t,{guest=false,sessionFailure=false}={}){
 const dom=new JSDOM('<main class="dashboard"><div id="online"></div></main>',{url:'https://paperknow.cn/workspace.html#help',runScripts:'outside-only'}),w=dom.window;
 for(const key of ['window','document','location','localStorage','MutationObserver'])globalThis[key]=w[key];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const calls=[],notices=[];let expired=false,identity=guest?null:{id:'help-owner'},sessionUnavailable=sessionFailure,sessionReads=0,records=[{id:'feedback-1',category:'使用咨询',body:'已有的账户反馈',status:'processing',created_at:'2026-10-23T00:00:00Z'}];
 Object.assign(w,{esc,icon,workspaceJobLabel,workspaceJobStatusLabel,workspaceJobActive,withStableView,renderOnlinePersonal,helpKnowledgeMarkup,bindHelpKnowledge,supportContactsMarkup,bindSupportContacts});
 w.fetch=async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):undefined;calls.push({path,body,options});
  if(path==='/api/auth/me')return {ok:true,status:200,json:async()=>({user:identity})};
  assert.equal(path,'/api/feedback','help must not load unrelated private libraries');
  if(expired)return {ok:false,status:401,json:async()=>({error:'登录已过期'})};
  if(body){const item={id:'feedback-2',category:body.category,body:body.text,status:'open',created_at:'2026-10-23T01:00:00Z'};records=[item,...records];return {ok:true,status:200,json:async()=>({id:item.id,item})};}
  return {ok:true,status:200,json:async()=>({items:records})};
 };
 w.eval(onlineCode+'\nwindow.helpTest={mountOnlineWorkspace,disposeOnlineWorkspace,onlineWorkspaceHasWork,onlineWorkspaceRouteGuard,onlineWorkspaceHref,onlineWorkspaceSessionChanged};');
 t.after(()=>{w.helpTest.disposeOnlineWorkspace();w.close();});
 const ctx={notify:text=>notices.push(text)};
 if(sessionFailure)ctx.session=async()=>{sessionReads++;if(sessionUnavailable)throw Error('session connection failed');return {user:identity};};
 await w.helpTest.mountOnlineWorkspace(w.document.querySelector('#online'),'help',ctx);
 await tick();
 return {w,doc:w.document,calls,notices,expire:()=>{expired=true;},changeIdentity(user){identity=user;w.helpTest.onlineWorkspaceSessionChanged(user);},reconnect(){sessionUnavailable=false;},sessionReads:()=>sessionReads};
}

test('help combines searchable guidance and one account feedback form without a content switch',async t=>{
 const f=await fixture(t),page=f.doc.querySelector('#view');
 assert.equal(page.querySelectorAll('.help-knowledge').length,1);
 assert.equal(page.querySelectorAll('#feedback-form').length,1);
 assert.equal(page.querySelectorAll('.personal-feedback-history').length,1);
 assert.equal(page.querySelectorAll('[aria-label="人工支持"]').length,1);
 assert.equal(page.querySelector('#help-feedback-form'),null);
 assert.equal(page.querySelector('a[href*="scope=local"]'),null);
 assert.equal(f.doc.querySelector('.account-refresh'),null);
 assert.match(page.textContent,/使用指南/);assert.match(page.textContent,/常见问题/);assert.match(page.textContent,/已有的账户反馈/);
 assert.equal(f.w.helpTest.onlineWorkspaceHref('help'),'#help');
 assert.equal(f.calls.filter(call=>call.body).length,0);
 assert.equal(f.calls.find(call=>call.path==='/api/feedback').options.headers['X-PaperKnow-User'],'help-owner');
});

test('search and guide interactions do not send feedback, dirty the page or erase unsent feedback',async t=>{
 const f=await fixture(t),knowledge=f.doc.querySelector('.help-knowledge'),search=knowledge.querySelector('input[type="search"]');
 const form=search.closest('form');assert.ok(form.hasAttribute('data-workspace-transient'));
 search.value='上传';form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
 assert.equal(f.w.helpTest.onlineWorkspaceHasWork(),false);
 assert.equal(f.w.helpTest.onlineWorkspaceRouteGuard('#home'),true);
 assert.match(knowledge.textContent,/上传/);
 const feedback=f.doc.querySelector('#feedback');feedback.value='尚未提交的问题描述';feedback.dispatchEvent(new f.w.Event('input',{bubbles:true}));
 assert.equal(f.w.helpTest.onlineWorkspaceHasWork(),true);
 search.value='备份';form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));
 const article=knowledge.querySelector('[data-help-article]');assert.ok(article);article.click();await tick();
 assert.equal(knowledge.querySelector('[data-help-knowledge-article]').hidden,false);assert.equal(knowledge.querySelector('[data-help-knowledge-article]').open,true);
 assert.equal(f.doc.querySelector('#feedback'),feedback);assert.equal(feedback.value,'尚未提交的问题描述');
 assert.equal(f.calls.filter(call=>call.body).length,0);
 f.doc.querySelector('#feedback-form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));
 await settle(()=>f.doc.querySelector('#feedback-submit-status').textContent.includes('反馈已提交'));
 assert.equal(f.calls.filter(call=>call.body).length,1);assert.equal(f.calls.find(call=>call.body).body.text,'尚未提交的问题描述');
 assert.match(f.doc.querySelector('#feedback-records').textContent,/尚未提交的问题描述/);
 assert.equal(f.w.helpTest.onlineWorkspaceHasWork(),false);
 assert.equal(f.doc.querySelectorAll('.help-knowledge').length,1);
});

test('guest help keeps guidance and support usable while requesting login only for feedback',async t=>{
 const f=await fixture(t,{guest:true}),page=f.doc.querySelector('#view');
 assert.equal(page.querySelectorAll('.help-knowledge').length,1);
 assert.match(page.textContent,/使用指南/);assert.match(page.textContent,/登录后反馈/);
 assert.equal(page.querySelector('#feedback-form'),null);
 assert.equal(page.querySelector('#feedback-records'),null);
 assert.equal(f.calls.some(call=>call.path==='/api/feedback'),false);
 const link=page.querySelector('a[href^="/auth.html"]');assert.equal(new URL(link.href).searchParams.get('next'),'/workspace.html#help');
 assert.ok(page.querySelector('a[href="mailto:contact@oneshowailab.com"]'));
 const knowledge=page.querySelector('.help-knowledge'),form=knowledge.querySelector('form');form.querySelector('input').value='上传';form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));
 assert.match(knowledge.textContent,/上传/);assert.equal(f.calls.length,1);
});

test('expired feedback session removes private records while retaining public help and support',async t=>{
 const f=await fixture(t);assert.match(f.doc.querySelector('#feedback-records').textContent,/已有的账户反馈/);
 f.expire();f.doc.querySelector('#feedback-refresh').click();await settle(()=>f.doc.querySelector('.help-guest-support'));
 assert.equal(f.doc.querySelector('#feedback-records'),null);assert.equal(f.doc.querySelector('#feedback-form'),null);
 assert.doesNotMatch(f.doc.querySelector('#view').textContent,/已有的账户反馈/);
 assert.equal(f.doc.querySelectorAll('.help-knowledge').length,1);assert.match(f.doc.querySelector('#view').textContent,/登录后反馈/);
 assert.equal(f.calls.filter(call=>call.body).length,0);
});


test('help updates from guest to signed-in feedback and removes private records on logout',async t=>{
 const f=await fixture(t,{guest:true});
 assert.equal(f.doc.querySelector('#feedback-form'),null);assert.equal(f.calls.some(call=>call.path==='/api/feedback'),false);
 f.changeIdentity({id:'help-owner'});await settle(()=>f.doc.querySelector('#feedback-form'));
 assert.equal(f.doc.querySelectorAll('.help-knowledge').length,1);assert.equal(f.doc.querySelectorAll('#feedback-form').length,1);
 assert.match(f.doc.querySelector('#feedback-records').textContent,/已有的账户反馈/);
 const privateReads=f.calls.filter(call=>call.path==='/api/feedback');assert.equal(privateReads.length,1);assert.equal(privateReads[0].options.headers['X-PaperKnow-User'],'help-owner');
 f.changeIdentity(null);await settle(()=>f.doc.querySelector('.help-guest-support'));
 assert.equal(f.doc.querySelector('#feedback-form'),null);assert.equal(f.doc.querySelector('#feedback-records'),null);
 assert.doesNotMatch(f.doc.querySelector('#view').textContent,/已有的账户反馈/);assert.match(f.doc.querySelector('#view').textContent,/登录后反馈/);
 assert.equal(f.doc.querySelectorAll('.help-knowledge').length,1);assert.equal(f.calls.filter(call=>call.path==='/api/feedback').length,1);
 assert.equal(f.calls.filter(call=>call.body).length,0);
});

test('initial identity network failure preserves public help and explicit retry recovers feedback',async t=>{
 const f=await fixture(t,{sessionFailure:true});
 assert.equal(f.doc.querySelectorAll('.help-knowledge').length,1);assert.match(f.doc.querySelector('#view').textContent,/反馈服务暂时无法连接/);
 assert.ok(f.doc.querySelector('a[href="mailto:contact@oneshowailab.com"]'));assert.equal(f.doc.querySelector('a[href^="/auth.html"]'),null);
 assert.equal(f.doc.querySelector('#feedback-form'),null);assert.equal(f.calls.length,0);assert.equal(f.sessionReads(),1);
 const retry=f.doc.querySelector('#online-retry');assert.ok(retry);assert.match(retry.textContent,/重新连接/);
 f.reconnect();retry.click();await settle(()=>f.doc.querySelector('#feedback-form'));
 assert.equal(f.sessionReads(),2);assert.equal(f.doc.querySelectorAll('.help-knowledge').length,1);assert.equal(f.doc.querySelector('#online-retry'),null);
 assert.match(f.doc.querySelector('#feedback-records').textContent,/已有的账户反馈/);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/feedback');assert.equal(f.calls[0].options.headers['X-PaperKnow-User'],'help-owner');
 assert.equal(f.calls.filter(call=>call.body).length,0);
});
