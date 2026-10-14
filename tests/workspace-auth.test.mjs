import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {esc,icon} from '../dist/workspace/ui.mjs';

const source=(await readFile(new URL('../dist/workspace/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const keys={profile:'paperknow-local-profile',preferences:'paperknow-preferences',drafts:'paperknow-drafts',projects:'paperknow-projects',tasks:'paperknow-local-tasks'};
const response=(status,user)=>({status,ok:status>=200&&status<300,json:async()=>({user})});
const signedIn={id:'researcher-1',name:'服务账户',email:null,phone:'+8613800000000',phoneVerifiedAt:'2026-10-15T00:00:00Z',hasPassword:false};

async function fixture(fetcher){
 const dom=new JSDOM('<div id="app"></div>',{url:'https://paperknow.cn/workspace.html#account',runScripts:'outside-only'});
 const timers=new Set();const setTimer=(callback,delay)=>{const timer=setTimeout(()=>{timers.delete(timer);callback();},delay);timers.add(timer);return timer;};
 const storage=dom.window.localStorage;
 storage.setItem(keys.profile,JSON.stringify({name:'本地昵称',degree:'硕士',major:'教育学'}));
 storage.setItem(keys.drafts,JSON.stringify([{id:'draft-one',title:'未上传的研究草稿'}]));
 const read=(key,fallback)=>JSON.parse(storage.getItem(key)||'null')??fallback;
 Object.assign(dom.window,{fetch:fetcher,AbortController,setTimeout:setTimer,clearTimeout:timer=>{timers.delete(timer);clearTimeout(timer);},matchMedia:()=>({matches:false}),scrollTo:()=>{},requestAnimationFrame:()=>{},keys,esc,icon,
  preferences:()=>({degree:'本科',...read(keys.preferences,{})}),profile:()=>({name:'研究者',...read(keys.profile,{})}),read,list:key=>read(key,[]),write:(key,value)=>storage.setItem(key,JSON.stringify(value)),projects:()=>read(keys.projects,[]),repository:{all:async()=>[]},formatDate:()=>'',mountNavigation:()=>({close(){}}),
  clearEditor:()=>{},clearHelpWork:()=>{},clearSettingsWork:()=>{},clearMoreWork:()=>{},trackDialogForm:()=>()=>{},retainWritingCatalog:()=>{},isCurrentRouteChange:()=>false,
 });
 await vm.runInContext('(async()=>{'+source+'\nglobalThis.workspaceAuthTest={loadWorkspaceSession,workspaceServiceFetch,signOutWorkspace,renderAccount,authHref};})()',dom.getInternalVMContext());
 return {dom,document:dom.window.document,storage,api:dom.window.workspaceAuthTest,close(){timers.forEach(clearTimeout);dom.window.close();}};
}

test('phone account identity stays separate from browser preferences and password actions return to the current route',async()=>{
 const seen=[];const f=await fixture(async(path,options)=>{seen.push(path);assert.equal(options.credentials,'same-origin');return response(200,signedIn);});
 try{
  await f.api.loadWorkspaceSession();
  assert.equal(f.document.querySelector('.hub-profile-name').textContent,'服务账户');
  assert.match(f.document.querySelector('#workspace-account-session').textContent,/\+8613800000000/);
  assert.equal(f.document.querySelector('#profile-name').value,'本地昵称');
  assert.match(f.document.querySelector('#account-security').textContent,/已验证/);
  const reset=f.document.querySelector('#account-security a');
  assert.equal(reset.textContent.trim(),'设置密码');
  assert.equal(new URL(reset.href).searchParams.get('next'),'/workspace.html#account');
  assert.equal(new URL(reset.href).searchParams.get('mode'),'reset');
  f.document.querySelector('#profile-name').value='新的本地昵称';
  f.document.querySelector('#profile-form').dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(JSON.parse(f.storage.getItem(keys.profile)).name,'新的本地昵称');
  assert.equal(f.document.querySelector('.hub-profile-name').textContent,'服务账户');
  assert.deepEqual(seen,['/api/auth/me']);
 }finally{f.close();}
});

test('guest links preserve the current workspace location and local data is available before auth resolves',async()=>{
 let resolve;let calls=0;
 const f=await fixture(()=>{calls++;return new Promise(done=>resolve=done);});
 try{
  assert.equal(f.document.querySelector('#profile-name').value,'本地昵称');
  f.document.querySelector('#profile-name').value='尚未保存的修改';
  const shared=f.api.workspaceServiceFetch('/api/auth/me',{});
  resolve(response(401));await shared;
  assert.equal(calls,1);
  assert.equal(f.document.querySelector('#profile-name').value,'尚未保存的修改');
  assert.equal(f.document.querySelector('.hub-profile-name').textContent,'未登录');
  f.dom.window.history.replaceState(null,'','/workspace.html?preview=1#category/literature?view=reading');
  f.document.querySelector('[data-account-menu]').click();
  const links=[...f.document.querySelectorAll('#account-menu a')].filter(link=>link.pathname==='/auth.html');
  assert.equal(links.length,2);
  assert.deepEqual(links.map(link=>new URL(link.href).searchParams.get('mode')),['login','register']);
  links.forEach(link=>assert.equal(new URL(link.href).searchParams.get('next'),'/workspace.html?preview=1#category/literature?view=reading'));
  assert.match(f.storage.getItem(keys.drafts),/未上传的研究草稿/);
 }finally{f.close();}
});

test('connection failures stay recoverable without claiming the account is connected or clearing local content',async()=>{
 let available=false;
 const f=await fixture(async()=>{if(!available)throw new Error('offline');return response(200,signedIn);});
 try{
  await f.api.loadWorkspaceSession();
  assert.match(f.document.querySelector('#workspace-account-session').textContent,/暂时无法连接账户/);
  assert.ok(f.document.querySelector('[data-session-retry]'));
  assert.equal(f.document.querySelector('#profile-major').value,'教育学');
  available=true;await f.api.loadWorkspaceSession(true);
  assert.equal(f.document.querySelector('.hub-profile-name').textContent,'服务账户');
  assert.match(f.storage.getItem(keys.drafts),/未上传的研究草稿/);
 }finally{f.close();}
});

test('logout preserves the local workspace and late session responses cannot restore a signed-out account',async()=>{
 let resolve;let requests=0;let logoutFails=true;
 const f=await fixture(async(path,options)=>{
  if(path==='/api/auth/logout'){assert.equal(options.method,'POST');assert.equal(options.body,'{}');return response(logoutFails?503:200);}
  if(++requests===1)return response(200,signedIn);
  return new Promise(done=>resolve=done);
 });
 try{
  await f.api.loadWorkspaceSession();const localBefore=f.storage.getItem(keys.drafts);
  await f.api.signOutWorkspace();
  assert.equal(f.document.querySelector('.hub-profile-name').textContent,'服务账户');
  assert.match(f.document.querySelector('#hub-toast').textContent,/暂时无法退出/);
  const pending=f.api.loadWorkspaceSession(true);logoutFails=false;
  await f.api.signOutWorkspace();resolve(response(200,signedIn));await pending;
  assert.equal(f.document.querySelector('.hub-profile-name').textContent,'未登录');
  assert.equal(f.storage.getItem(keys.drafts),localBefore);
  assert.equal(JSON.parse(f.storage.getItem(keys.profile)).name,'本地昵称');
  assert.equal(f.document.querySelector('[data-session-logout]'),null);
 }finally{f.close();}
});
