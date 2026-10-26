import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {accountDestination} from '../dist/account-routes.mjs';
const html=await readFile(new URL('../dist/service.html',import.meta.url),'utf8');
const code=(await readFile(new URL('../dist/service.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
function redirected(url){const dom=new JSDOM(html,{url,runScripts:'outside-only',virtualConsole:new VirtualConsole()});dom.window.accountDestination=accountDestination;dom.window.eval(code);const target=new URL(dom.window.document.querySelector('#workspace-redirect').href);dom.window.close();return target;}
test('saved service links enter the corresponding page within the main workspace',()=>{
 for(const [view,hash] of [['projects','#projects?scope=account'],['tasks','#tasks?scope=account'],['agent','#tool/agent'],['results','#assets?scope=account'],['usage','#account?view=usage'],['membership','#membership?scope=account'],['help','#help?scope=account']]){
  const url=redirected('https://paperknow.cn/service.html?view='+view);assert.equal(url.pathname,'/workspace.html');assert.equal(url.hash,hash);
 }
 const admin=redirected('https://paperknow.cn/service.html?view=admin');assert.equal(admin.pathname,'/admin.html');
});
test('old registration links preserve the destination while using the unified login page',()=>{
 const url=redirected('https://paperknow.cn/service.html?auth=register&view=projects');assert.equal(url.pathname,'/auth.html');assert.equal(url.searchParams.get('mode'),'register');assert.equal(url.searchParams.get('next'),'/workspace.html#projects?scope=account');
});
test('legacy service document contains no second workspace or account management controls',()=>{
 assert.doesNotMatch(html,/服务工作台|id="logout"|id="app"|<nav/);assert.doesNotMatch(code,/\/api\/admin|fetch\(/);
});
