import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const code=await readFile(new URL('../dist/home-app.js',import.meta.url),'utf8');
async function page(t,user,prepare){const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.localStorage.setItem('paperknow-local-profile',JSON.stringify({name:'过期本地昵称'}));w.fetch=async path=>{if(user==='offline')throw new Error('offline');return {ok:path!='/api/auth/me'||!!user,status:user?200:401,json:async()=>path==='/api/auth/me'?{user}:{ai:false}};};prepare?.(w);w.eval(code);for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,1));return w.document;}
test('guest homepage ignores local nickname and offers real registration plus local tools',async t=>{const d=await page(t,null);assert.equal(d.querySelector('#account-button').textContent,'登录');assert.equal(d.querySelector('#account-button').classList.contains('is-signed-in'),false);assert.equal(d.querySelector('#header-start').getAttribute('href'),'/auth.html?mode=register');assert.equal(d.querySelector('#header-start').textContent.trim(),'注册并开始');assert.ok(d.querySelector('a[href="/workspace.html#category/writing"]'));assert.equal(d.querySelectorAll('#status-button').length,1);});
test('authenticated homepage safely renders actual account name and shows admin entry only for administrator',async t=>{const name='管理员<script>';const d=await page(t,{name,email:'a@example.invalid',role:'admin'});const account=d.querySelector('#account-button');assert.equal(account.classList.contains('is-signed-in'),true);assert.equal(account.querySelector('.home-account-name').textContent,name);assert.equal(account.querySelector('.home-account-avatar').textContent,'管');assert.equal(account.title,name);assert.equal(account.getAttribute('aria-label'),`打开 ${name} 的账户`);assert.equal(account.querySelector('script'),null);assert.equal(d.querySelector('#header-start').getAttribute('href'),'/workspace.html#home');assert.equal(d.querySelector('#header-start').textContent.trim(),'进入工作台');account.click();assert.ok(d.querySelector('a[href="/admin.html"]'));assert.equal(d.querySelector('#home-dialog-body script'),null);assert.ok(d.querySelector('#home-dialog-body').textContent.includes(name));});
test('account display truncates text while preserving full identity and email or phone fallback',async t=>{const name='Researcher<img src=x onerror=alert(1)>';const d=await page(t,{name,email:'u@example.invalid',role:'user'});const account=d.querySelector('#account-button');assert.equal(account.querySelector('.home-account-name').textContent,Array.from(name).slice(0,16).join(''));assert.equal(account.title,name);assert.equal(account.querySelector('img'),null);const email=await page(t,{email:'person@example.invalid',role:'user'});assert.equal(email.querySelector('.home-account-avatar').textContent,'P');assert.equal(email.querySelector('.home-account-name').textContent,'person@example.i');const phone=await page(t,{phone:'13800138000',role:'user'});assert.equal(phone.querySelector('.home-account-name').textContent,'13800138000');});
test('ordinary user cannot see admin link; offline homepage retains usable local links',async t=>{const d=await page(t,{name:'用户',email:'u@example.invalid',role:'user'});d.querySelector('#account-button').click();assert.equal(d.querySelector('a[href="/admin.html"]'),null);const offline=await page(t,'offline');assert.equal(offline.querySelector('#account-button').textContent,'登录');assert.ok(offline.querySelector('a[href="/workspace.html#home"]'));});

test('navigation indicator follows pointer and keyboard focus, restores the current page, and repositions after layout changes',async t=>{
 let finishFonts;
 const metrics={navLeft:100,homeLeft:120,homeWidth:28,writingLeft:200,writingWidth:56};
 const d=await page(t,null,w=>{
  const nav=w.document.querySelector('#main-nav');
  nav.getBoundingClientRect=()=>({left:metrics.navLeft,width:800});
  nav.scrollLeft=12;
  for(const link of nav.querySelectorAll('a')){
   const isHome=link.getAttribute('href')==='/';
   const rect=()=>({left:isHome?metrics.homeLeft:metrics.writingLeft,width:isHome?metrics.homeWidth:metrics.writingWidth});
   link.getBoundingClientRect=rect;
   const label=link.querySelector('.nav-link-label');
   if(label)label.getBoundingClientRect=rect;
  }
  Object.defineProperty(w.document,'fonts',{value:{ready:new Promise(resolve=>{finishFonts=resolve;})}});
 });
 const w=d.defaultView,nav=d.querySelector('#main-nav');
 const home=nav.querySelector('a[href="/"]'),writing=nav.querySelector('[data-research-category="writing"]');
 assert.ok(home,'homepage remains the actual current page');
 assert.equal(nav.style.getPropertyValue('--nav-line-x'),'32px');
 assert.equal(nav.style.getPropertyValue('--nav-line-width'),'28px');
 writing.dispatchEvent(new w.Event('pointerover',{bubbles:true}));
 assert.equal(nav.style.getPropertyValue('--nav-line-x'),'112px');
 assert.equal(nav.style.getPropertyValue('--nav-line-width'),'56px');
 assert.equal(home.getAttribute('aria-current'),'page');
 assert.equal(writing.getAttribute('aria-current'),null);
 nav.dispatchEvent(new w.Event('pointerleave'));
 assert.equal(nav.style.getPropertyValue('--nav-line-x'),'32px');
 writing.focus();
 assert.equal(nav.style.getPropertyValue('--nav-line-x'),'112px');
 metrics.writingLeft=215;
 metrics.writingWidth=60;
 w.dispatchEvent(new w.Event('resize'));
 assert.equal(nav.style.getPropertyValue('--nav-line-x'),'127px');
 assert.equal(nav.style.getPropertyValue('--nav-line-width'),'60px');
 metrics.writingWidth=64;
 finishFonts();await Promise.resolve();
 assert.equal(nav.style.getPropertyValue('--nav-line-width'),'64px');
 d.querySelector('#account-button').focus();
 assert.equal(nav.style.getPropertyValue('--nav-line-x'),'32px');
 assert.equal(nav.style.getPropertyValue('--nav-line-width'),'28px');
});

test('scroll styling changes at the header threshold without measuring layout and mobile menu retains keyboard dismissal',async t=>{
 let measurements=0;
 const d=await page(t,null,w=>{
  const prototype=w.HTMLElement.prototype;
  prototype.getBoundingClientRect=()=>{measurements++;return {left:0,width:40};};
 });
 const w=d.defaultView,header=d.querySelector('.product-header');
 const initialMeasurements=measurements;
 assert.equal(header.classList.contains('is-scrolled'),false);
 Object.defineProperty(w,'scrollY',{value:9,writable:true});
 w.dispatchEvent(new w.Event('scroll'));
 assert.equal(header.classList.contains('is-scrolled'),true);
 w.scrollY=8;w.dispatchEvent(new w.Event('scroll'));
 assert.equal(header.classList.contains('is-scrolled'),false);
 assert.equal(measurements,initialMeasurements,'scroll handling does not measure layout');
 const menu=d.querySelector('#mobile-menu'),nav=d.querySelector('#main-nav');
 menu.click();
 assert.equal(menu.getAttribute('aria-expanded'),'true');
 assert.equal(nav.classList.contains('mobile-open'),true);
 d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(menu.getAttribute('aria-expanded'),'false');
 assert.equal(nav.classList.contains('mobile-open'),false);
 assert.equal(d.activeElement,menu);
});
