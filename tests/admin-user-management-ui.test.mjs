import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createAdminPage} from '../dist/admin.mjs';

const html=await readFile(new URL('../dist/admin.html',import.meta.url),'utf8');
const actor={id:'admin-manager',name:'账户管理验收',email:'manager@example.test',role:'admin'};
const memberExpiry=new Date(Date.now()+90*86400000).toISOString();
const target={id:'user-managed',name:'手机用户 <img src=x onerror=unsafe()>',email:null,phone:'13800138000',role:'user',status:'active',version:1,created_at:'2026-10-20T00:00:00.000Z',project_count:2,job_count:3};
const detail=()=>({
 user:{...target},
 credits:{balance:500,held:50,available:450,ledger:[]},
 memberships:[
  {id:'paid-order-1',origin:'payment',productId:'basic',title:'已购买基础会员',startsAt:'2026-10-20T00:00:00.000Z',expiresAt:memberExpiry,status:'active',items:[]},
  {id:'admin-grant-1',origin:'admin',productId:'basic',title:'后台赠送基础会员',startsAt:'2026-10-20T00:00:00.000Z',expiresAt:memberExpiry,status:'active',items:[]},
 ],
 membershipProducts:[{id:'basic',title:'基础会员',durationDays:30,membershipItems:[{key:'polish',title:'学术润色',quantity:5}]}],history:[],
});
const list=rows=>({items:rows,total:rows.length,page:1,pageSize:20});
async function settle(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('User management UI did not settle');}
async function fixture(t,{state=detail(),handler}={}){
 const dom=new JSDOM(html,{url:'https://paperknow.cn/admin.html#users',pretendToBeVisual:true}),win=dom.window,doc=win.document,calls=[],navigations=[];
 win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};win.HTMLDialogElement.prototype.close=function(){this.open=false;};
 win.fetch=async(url,init={})=>{
  const body=init.body===undefined?undefined:JSON.parse(init.body),call={url,method:init.method||'GET',body};calls.push(call);
  let response=await handler?.(call,init);
  if(!response){
   if(url==='/api/auth/me')response={body:{user:actor}};
   else if(url.startsWith('/api/admin/users?'))response={body:list([{...state.user,project_count:2,job_count:3}])};
   else if(url==='/api/admin/users/'+state.user.id+'/manage')response={body:structuredClone(state)};
   else if(body!==undefined)throw Error('Unexpected user mutation '+url);
   else response={body:list([])};
  }
  const status=response.status||200;return {ok:status>=200&&status<300,status,json:async()=>response.body};
 };
 const app=createAdminPage(doc,{navigate:url=>navigations.push(url),pollIntervalMs:60000});await app.ready;
 t.after(()=>{app.destroy();win.close();});
 const $=selector=>doc.querySelector(selector),fill=(selector,value)=>{const field=$(selector);assert.ok(field,'Missing '+selector);field.value=value;field.dispatchEvent(new win.Event('input',{bubbles:true}));},change=(selector,value)=>{fill(selector,value);$(selector).dispatchEvent(new win.Event('change',{bubbles:true}));},click=selector=>{assert.ok($(selector),'Missing '+selector);$(selector).click();},submit=selector=>{assert.ok($(selector),'Missing '+selector);$(selector).dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));};
 return {app,win,doc,$,fill,change,click,submit,calls,navigations,state,async open(){click('[data-user-manage]');await settle(()=>!!$('#user-credit-form'));},posts:()=>calls.filter(call=>call.method==='POST')};
}
function credit(ui,{direction='add',amount='200',reason='客服核验后的积分补偿'}={}){ui.change('#user-credit-direction',direction);ui.fill('#user-credit-amount',amount);ui.fill('#user-credit-reason',reason);ui.submit('#user-credit-form');}
function confirm(ui){assert.ok(ui.$('[data-user-confirm]'),'Missing review confirmation');ui.click('[data-user-confirm]');}

test('user management opens a read-only account summary and treats identity and history as inert text',async t=>{
 const state=detail();state.history=[{id:'history-1',action:'credits.adjust',reason:'<script>unsafe()</script>',createdAt:'2026-10-21T01:00:00.000Z'}];
 const ui=await fixture(t,{state});await ui.open();
 assert.equal(ui.$('#admin-dialog').open,true);assert.match(ui.$('#dialog-body').textContent,/13800138000/);assert.match(ui.$('#dialog-body').textContent,/500/);assert.match(ui.$('#dialog-body').textContent,/50/);assert.match(ui.$('#dialog-body').textContent,/450/);
 assert.match(ui.$('#dialog-body').textContent,/已购买基础会员/);assert.match(ui.$('#dialog-body').textContent,/后台赠送基础会员/);
 assert.equal(ui.$('#dialog-body img'),null);assert.equal(ui.$('#dialog-body script'),null);assert.equal(ui.posts().length,0);
});

test('credit adjustment only posts after review, suppresses double clicks and displays the returned account version',async t=>{
 let finish;const state=detail(),ui=await fixture(t,{state,handler:call=>call.url.endsWith('/credits')?new Promise(resolve=>{finish=resolve;}):undefined});await ui.open();credit(ui);
 assert.equal(ui.posts().length,0);assert.match(ui.$('#dialog-body').textContent,/200/);confirm(ui);confirm(ui);await settle(()=>!!finish);
 assert.equal(ui.posts().length,1);const sent=ui.posts()[0];assert.equal(sent.url,'/api/admin/users/user-managed/credits');assert.equal(sent.body.version,1);assert.equal(sent.body.delta,200);assert.equal(sent.body.reason,'客服核验后的积分补偿');assert.ok(typeof sent.body.commandId==='string'&&sent.body.commandId.length>=16);
 const updated=detail();updated.user.version=2;updated.credits={balance:700,held:50,available:650,ledger:[]};finish({body:updated});await settle(()=>!!ui.$('#user-credit-form')&&ui.$('#dialog-body').textContent.includes('700'));
 credit(ui,{amount:'10',reason:'再次调整'});confirm(ui);await settle(()=>ui.posts().length===2);assert.equal(ui.posts()[1].body.version,2);assert.notEqual(ui.posts()[1].body.commandId,sent.body.commandId);
 finish({body:{...updated,user:{...updated.user,version:3}}});
});

test('credit subtraction cannot consume held credits or accept an empty reason',async t=>{
 const ui=await fixture(t);await ui.open();credit(ui,{direction:'subtract',amount:'451'});assert.equal(ui.posts().length,0);assert.equal(ui.$('[data-user-confirm]'),null);assert.match(ui.$('#dialog-body').textContent,/可用|不足|450/);
 credit(ui,{direction:'subtract',amount:'10',reason:''});assert.equal(ui.posts().length,0);assert.equal(ui.$('[data-user-confirm]'),null);
 credit(ui,{direction:'subtract',amount:'10',reason:'重复发放冲正'});assert.equal(ui.posts().length,0);assert.ok(ui.$('[data-user-confirm]'));ui.click('[data-user-cancel-review]');assert.equal(ui.posts().length,0);assert.ok(ui.$('#user-credit-form'));
});

test('a cancelled credit review never mutates the user and a confirmed subtraction sends a signed negative amount',async t=>{
 const state=detail(),ui=await fixture(t,{state,handler:call=>call.url.endsWith('/credits')?{body:{...state,user:{...state.user,version:2},credits:{balance:490,held:50,available:440,ledger:[]}}}:undefined});await ui.open();credit(ui,{direction:'subtract',amount:'10',reason:'重复发放冲正'});confirm(ui);await settle(()=>ui.posts().length===1&&!!ui.$('#user-credit-form'));
 assert.equal(ui.posts()[0].body.delta,-10);assert.equal(ui.posts()[0].body.reason,'重复发放冲正');
});

test('membership grants and paid or admin expiry changes use independent reviewed management commands',async t=>{
 const state=detail(),posts=[];const ui=await fixture(t,{state,handler:call=>{if(call.url.endsWith('/membership')){posts.push(call);state.user.version++;return {body:structuredClone(state)};}}});await ui.open();
 ui.change('#user-member-action','grant');ui.change('#user-member-product','basic');const expiry=new Date(Date.now()+60*86400000);const local=new Date(expiry.getTime()-expiry.getTimezoneOffset()*60000).toISOString().slice(0,16);ui.fill('#user-member-expiry',local);ui.fill('#user-member-reason','活动赠送会员');ui.submit('#user-membership-form');assert.equal(ui.posts().length,0);confirm(ui);await settle(()=>posts.length===1&&!!ui.$('#user-membership-form')&&!ui.$('[data-user-confirm]'));
 assert.equal(posts[0].body.action,'grant');assert.equal(posts[0].body.productId,'basic');assert.equal(posts[0].body.reason,'活动赠送会员');assert.equal(Date.parse(posts[0].body.expiresAt),new Date(local).getTime());
 ui.change('#user-member-action','update');assert.ok(ui.$('#user-member-grant option[value="paid-order-1"]'));ui.change('#user-member-grant','paid-order-1');ui.fill('#user-member-expiry',local);ui.fill('#user-member-reason','延长补偿有效期');ui.submit('#user-membership-form');assert.equal(posts.length,1);confirm(ui);await settle(()=>posts.length===2&&!!ui.$('#user-membership-form')&&!ui.$('[data-user-confirm]'));assert.equal(posts[1].body.action,'update');assert.equal(posts[1].body.grantId,'paid-order-1');assert.equal(posts[1].body.version,2);assert.deepEqual(Object.keys(posts[1].body).sort(),['action','commandId','expiresAt','grantId','reason','version'].sort());
 ui.change('#user-member-action','revoke');assert.ok(ui.$('#user-member-grant option[value="paid-order-1"]'));ui.change('#user-member-grant','admin-grant-1');ui.fill('#user-member-reason','撤销误赠权益');ui.submit('#user-membership-form');confirm(ui);await settle(()=>posts.length===3);assert.equal(posts[2].body.action,'revoke');assert.equal(posts[2].body.grantId,'admin-grant-1');
});

test('ban and unban are explicit reviewed actions with a fresh version and visible updated status',async t=>{
 const state=detail(),ui=await fixture(t,{state,handler:call=>{if(call.url.endsWith('/status')){state.user={...state.user,status:call.body.status,version:state.user.version+1};return {body:structuredClone(state)};}}});await ui.open();
 ui.change('#user-status-value','banned');ui.fill('#user-status-reason','违规使用，人工核查后封禁');ui.submit('#user-status-form');assert.equal(ui.posts().length,0);confirm(ui);await settle(()=>ui.posts().length===1&&!!ui.$('#user-status-form')&&!ui.$('[data-user-confirm]'));assert.equal(ui.posts()[0].body.status,'banned');assert.equal(ui.posts()[0].body.version,1);assert.match(ui.$('#dialog-body').textContent,/封禁/);
 ui.change('#user-status-value','active');ui.fill('#user-status-reason','申诉核查完成，恢复使用');ui.submit('#user-status-form');confirm(ui);await settle(()=>ui.posts().length===2);assert.equal(ui.posts()[1].body.status,'active');assert.equal(ui.posts()[1].body.version,2);
});

test('the administrator cannot review a ban against an admin account or the current operator',async t=>{
 const state=detail();state.user={...state.user,id:actor.id,role:'admin'};const ui=await fixture(t,{state});await ui.open();
 const form=ui.$('#user-status-form');if(form){ui.change('#user-status-value','banned');ui.fill('#user-status-reason','不应提交');ui.submit('#user-status-form');}
 assert.equal(ui.$('[data-user-confirm]'),null);assert.equal(ui.posts().length,0);assert.match(ui.$('#dialog-body').textContent,/管理员|自己|当前/);
});

test('a version conflict displays a refresh instruction and never automatically resubmits the adjustment',async t=>{
 const ui=await fixture(t,{handler:call=>call.url.endsWith('/credits')?{status:409,body:{error:'用户状态已变化，请刷新后重新确认'}}:undefined});await ui.open();credit(ui);confirm(ui);await settle(()=>ui.$('#dialog-body').textContent.includes('用户状态已变化'));
 assert.equal(ui.posts().length,1);assert.match(ui.$('#dialog-body').textContent,/刷新/);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(ui.posts().length,1);
});

test('an ambiguous network failure keeps the same reviewed command for a manual retry',async t=>{
 let attempts=0;const state=detail(),ui=await fixture(t,{handler:call=>{if(call.url.endsWith('/credits')){if(++attempts===1)throw new TypeError('connection closed');return {body:{...state,user:{...state.user,version:2},credits:{balance:700,held:50,available:650,ledger:[]}}};}}});await ui.open();credit(ui);confirm(ui);await settle(()=>attempts===1&&ui.$('[data-user-confirm]')&&!ui.$('[data-user-confirm]').disabled);const first=ui.posts()[0];confirm(ui);await settle(()=>attempts===2&&!!ui.$('#user-credit-form'));assert.deepEqual(ui.posts()[1].body,first.body);
});

test('permission loss while saving closes private user data instead of rendering a stale account summary',async t=>{
 const ui=await fixture(t,{handler:call=>call.url.endsWith('/credits')?{status:403,body:{error:'权限已撤销'}}:undefined});await ui.open();credit(ui);confirm(ui);await settle(()=>ui.$('#admin-app').hidden);
 assert.equal(ui.$('#admin-dialog').open,false);assert.equal(ui.$('#dialog-body').textContent,'');assert.equal(ui.$('#admin-content').textContent,'');assert.equal(ui.posts().length,1);assert.match(ui.$('#access-title').textContent,/没有管理权限/);
});

test('closing the account dialog prevents its late detail response from reopening private controls',async t=>{
 let finish;const state=detail(),ui=await fixture(t,{handler:call=>call.url.endsWith('/manage')?new Promise(resolve=>{finish=resolve;}):undefined});ui.click('[data-user-manage]');await settle(()=>!!finish);ui.click('#dialog-close');finish({body:state});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(ui.$('#admin-dialog').open,false);assert.equal(ui.$('#user-credit-form'),null);assert.equal(ui.posts().length,0);
});

test('closing a pending adjustment prevents its late response from reopening or overwriting the dialog',async t=>{
 let finish;const ui=await fixture(t,{handler:call=>call.url.endsWith('/credits')?new Promise(resolve=>{finish=resolve;}):undefined});await ui.open();credit(ui);confirm(ui);await settle(()=>!!finish);ui.click('#dialog-close');const updated=detail();updated.user.version=2;updated.credits.balance=700;finish({body:updated});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(ui.$('#admin-dialog').open,false);assert.equal(ui.$('#dialog-body').textContent,'');assert.equal(ui.posts().length,1);
});
