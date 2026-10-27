import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import 'fake-indexeddb/auto';
test('settings preview stays local until save, failed save stays dirty, reset is staged and routing protects changes',async()=>{const dom=new JSDOM('<main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'http://localhost/workspace.html#settings'});for(const key of ['window','document','localStorage','FormData','location'])globalThis[key]=dom.window[key];document.querySelector('dialog').close=()=>{};let applied=0;const ctx={apply:()=>applied++,notify:()=>{},modal:(_,html)=>{document.querySelector('#workspace-dialog-body').innerHTML=html;}};const m=await import('../dist/workspace/settings.mjs');m.mountSettings(ctx);const radio=document.querySelector('[value="compact"]');radio.checked=true;radio.dispatchEvent(new window.Event('input',{bubbles:true}));assert.equal(document.querySelector('#settings-example').dataset.density,'compact');assert.equal(localStorage.getItem('paperknow-preferences'),null);assert.equal(m.settingsRouteGuard('#home'),false);assert.match(document.querySelector('#workspace-dialog-body').textContent,/保存并离开/);const original=window.Storage.prototype.setItem;window.Storage.prototype.setItem=()=>{throw Error('quota');};document.querySelector('#settings-form').dispatchEvent(new window.Event('submit',{cancelable:true}));assert.equal(m.settingsHasWork(),true);assert.match(document.querySelector('#settings-status').textContent,/失败/);window.Storage.prototype.setItem=original;document.querySelector('#settings-form').dispatchEvent(new window.Event('submit',{cancelable:true}));assert.equal(applied,1);assert.equal(JSON.parse(localStorage.getItem('paperknow-preferences')).density,'compact');assert.equal(m.settingsRouteGuard('#home'),true);document.querySelector('#settings-reset').click();document.querySelector('#confirm-settings-reset').click();assert.equal(m.settingsHasWork(),true);assert.equal(document.querySelector('#settings-example').dataset.density,'comfortable');assert.equal(JSON.parse(localStorage.getItem('paperknow-preferences')).density,'compact');m.clearSettingsWork();dom.window.close();});
test('settings shortcuts and notifications have distinct routes and notification preference saves, resets and protects changes',async()=>{const dom=new JSDOM('<main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'http://localhost/workspace.html#settings/notifications'});for(const key of ['window','document','localStorage','FormData','location'])globalThis[key]=dom.window[key];document.querySelector('dialog').close=()=>{};const ctx={apply:()=>{},notify:()=>{},modal:(_,html)=>document.querySelector('#workspace-dialog-body').innerHTML=html};const m=await import('../dist/workspace/settings.mjs');try{m.mountSettings(ctx,'shortcuts');assert.match(document.querySelector('.settings-main').textContent,/Esc/);assert.equal(document.querySelector('#settings-form'),null);assert.equal(document.querySelector('a[href="#settings/shortcuts"]').getAttribute('aria-current'),'page');m.mountSettings(ctx,'notifications');const checkbox=document.querySelector('#setting-local-activity');assert.equal(checkbox.checked,true);checkbox.checked=false;checkbox.dispatchEvent(new window.Event('input',{bubbles:true}));assert.equal(m.settingsHasWork(),true);assert.equal(localStorage.getItem('paperknow-preferences'),null);document.querySelector('#settings-form').dispatchEvent(new window.Event('submit',{cancelable:true}));assert.equal(JSON.parse(localStorage.getItem('paperknow-preferences')).localActivityEnabled,false);m.mountSettings(ctx,'notifications');assert.equal(document.querySelector('#setting-local-activity').checked,false);document.querySelector('#settings-reset').click();document.querySelector('#confirm-settings-reset').click();assert.equal(document.querySelector('#setting-local-activity').checked,true);assert.equal(m.settingsHasWork(),true);assert.equal(JSON.parse(localStorage.getItem('paperknow-preferences')).localActivityEnabled,false);assert.match(document.querySelector('.settings-main').textContent,/不发送邮件、短信或浏览器推送/);}finally{m.clearSettingsWork();dom.window.close();}});

function settingsEnvironment(){
 const dom=new JSDOM('<main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'http://localhost/workspace.html#settings/data'});
 for(const key of ['window','document','localStorage','FormData','location'])globalThis[key]=dom.window[key];
 return {dom,ctx:{apply:()=>{},notify:()=>{},modal:()=>{},exportBackup:async()=>{},restored:async()=>{}}};
}
test('data and privacy uses one account flow without legacy local backup or restore actions',async()=>{
 const {dom,ctx}=settingsEnvironment(),m=await import('../dist/workspace/settings.mjs');let localExports=0,restores=0;
 try{
  const saved='[{"id":"legacy-kept","name":"历史研究"}]';localStorage.setItem('paperknow-projects',saved);localStorage.setItem('paperknow-preferences','corrupt-preference');ctx.exportBackup=async()=>localExports++;ctx.restored=async()=>restores++;
  for(const route of ['data','privacy']){
   m.mountSettings(ctx,route);
   assert.match(document.querySelector('.settings-main').textContent,/统一账户.*云端管理/);
   assert.equal(document.querySelector('input[type=file],#settings-export,#settings-file,#settings-import-preview'),null);
   assert.doesNotMatch(document.querySelector('.dashboard').textContent,/本地工作空间|本地体验资料|账户与本地资料|从本地备份恢复|导出本地/);
   for(const href of ['#projects','#assets','#tasks','#account','#help'])assert.ok(document.querySelector('.settings-main a[href="'+href+'"]'));
   assert.equal(document.querySelector('a[href*="scope=local"]'),null);assert.equal(document.querySelector('#settings-account-export,.settings-account-export,#settings-account-status'),null);assert.doesNotMatch(document.querySelector('.settings-main').textContent,/资料包|JSON/);
   assert.equal(m.settingsHasWork(),false);assert.equal(localStorage.getItem('paperknow-projects'),saved);assert.equal(localStorage.getItem('paperknow-preferences'),'corrupt-preference');
  }
  assert.equal(localExports,0);assert.equal(restores,0);
 }finally{m.clearSettingsWork();dom.window.close();}
});
test('editing one settings category preserves other windows changes and blocks conflicting or corrupt values',async()=>{
 const {dom,ctx}=settingsEnvironment(),m=await import('../dist/workspace/settings.mjs');
 const change=(selector,value)=>{const field=document.querySelector(selector);if(field.type==='radio')field.checked=true;else field.value=value;field.dispatchEvent(new window.Event('input',{bubbles:true}));};
 const save=()=>document.querySelector('#settings-form').dispatchEvent(new window.Event('submit',{cancelable:true}));
 try{
  localStorage.setItem('paperknow-preferences',JSON.stringify({degree:'本科',major:'教育学',theme:'light',projectView:'list'}));m.mountSettings(ctx,'writing');change('#setting-major','心理学');
  localStorage.setItem('paperknow-preferences',JSON.stringify({degree:'博士',major:'教育学',theme:'dark',projectView:'list'}));save();
  assert.deepEqual(JSON.parse(localStorage.getItem('paperknow-preferences')),{degree:'博士',major:'心理学',theme:'dark',projectView:'list'});
  m.mountSettings(ctx);change('[value="compact"]');localStorage.setItem('paperknow-preferences',JSON.stringify({...JSON.parse(localStorage.getItem('paperknow-preferences')),density:'comfortable',theme:'system'}));save();assert.equal(JSON.parse(localStorage.getItem('paperknow-preferences')).theme,'system');
  m.mountSettings(ctx,'writing');change('#setting-major','数学');localStorage.setItem('paperknow-preferences',JSON.stringify({major:'医学'}));save();assert.match(document.querySelector('#settings-status').textContent,/其他窗口/);assert.equal(JSON.parse(localStorage.getItem('paperknow-preferences')).major,'医学');assert.equal(m.settingsHasWork(),true);
  for(const value of ['invalid','[]','null']){localStorage.setItem('paperknow-preferences',value);m.mountSettings(ctx);change('[value="compact"]');save();assert.equal(localStorage.getItem('paperknow-preferences'),value);assert.match(document.querySelector('#settings-status').textContent,/已停止覆盖/);}
 }finally{m.clearSettingsWork();dom.window.close();}
});

test('a replaced settings page ignores stale reset confirmations',async()=>{
 const {dom,ctx}=settingsEnvironment(),m=await import('../dist/workspace/settings.mjs');
 try{
  ctx.modal=(_,html)=>document.querySelector('#workspace-dialog-body').innerHTML=html;
  m.mountSettings(ctx);document.querySelector('#settings-reset').click();const oldConfirmation=document.querySelector('#confirm-settings-reset');m.mountSettings(ctx,'writing');document.querySelector('#setting-major').value='新页面未保存专业';oldConfirmation.click();assert.equal(document.querySelector('#setting-major').value,'新页面未保存专业');assert.equal(localStorage.getItem('paperknow-preferences'),null);
 }finally{m.clearSettingsWork();dom.window.close();}
});
