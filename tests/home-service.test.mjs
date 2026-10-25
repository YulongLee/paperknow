import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const code=await readFile(new URL('../dist/home-app.js',import.meta.url),'utf8');
async function page(t,user,prepare){const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;w.matchMedia=query=>({media:query,matches:false,addEventListener(){},removeEventListener(){}});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.localStorage.setItem('paperknow-local-profile',JSON.stringify({name:'过期本地昵称'}));w.fetch=async path=>{if(user==='offline')throw new Error('offline');return {ok:path!='/api/auth/me'||!!user,status:user?200:401,json:async()=>path==='/api/auth/me'?{user}:path==='/api/desktop/releases'?{version:'0.1.0',releases:[]}:{ai:false}};};prepare?.(w);w.eval(code);for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,1));return w.document;}

function carouselEnvironment({reducedMotion=false,compact=false}={}){
 const timers=new Map();
 const mediaQueries=new Map();
 let observer,observed,hidden=false,nextId=0;
 return {
  prepare(w){
   w.matchMedia=query=>{
    const listeners=new Set(),media={media:query,matches:query==='(prefers-reduced-motion: reduce)'?reducedMotion:query==='(max-width: 700px)'?compact:false,addEventListener(type,listener){if(type==='change')listeners.add(listener);},removeEventListener(type,listener){if(type==='change')listeners.delete(listener);}};
    mediaQueries.set(query,{media,listeners});return media;
   };
   Object.defineProperty(w.document,'hidden',{get:()=>hidden,configurable:true});
   const originalSetTimeout=w.setTimeout.bind(w),originalClearTimeout=w.clearTimeout.bind(w);
   w.setTimeout=(callback,delay,...args)=>{if(delay!==5000)return originalSetTimeout(callback,delay,...args);const id={carouselTimer:++nextId};timers.set(id,()=>callback(...args));return id;};
   w.clearTimeout=id=>{if(!timers.delete(id))originalClearTimeout(id);};
   w.IntersectionObserver=class{
    constructor(callback){observer=callback;}
    observe(element){observed=element;}
    disconnect(){}
   };
  },
  enter(ratio=1){assert.ok(observed,'the carousel observes its viewport');observer([{target:observed,isIntersecting:ratio>0,intersectionRatio:ratio}]);},
  setCompact(value){const state=mediaQueries.get('(max-width: 700px)');assert.ok(state,'the carousel watches the mobile breakpoint');state.media.matches=value;state.listeners.forEach(listener=>listener({matches:value,media:state.media.media}));},
  hide(d,value){hidden=value;d.dispatchEvent(new d.defaultView.Event('visibilitychange'));},
  get pending(){return timers.size;},
  get timer(){return [...timers.keys()][0];},
  advance(){assert.equal(timers.size,1,'one rotation is scheduled');const [id,callback]=timers.entries().next().value;timers.delete(id);callback();}
 };
}
test('guest homepage ignores local nickname and offers real registration plus local tools',async t=>{const d=await page(t,null);assert.equal(d.querySelector('#account-button').textContent,'登录');assert.equal(d.querySelector('#account-button').classList.contains('is-signed-in'),false);assert.equal(d.querySelector('#header-start').getAttribute('href'),'/auth.html?mode=register');assert.equal(d.querySelector('#header-start').textContent.trim(),'开始使用');const initial=new JSDOM(html);t.after(()=>initial.window.close());const originalLabels=Array.from(initial.window.document.querySelectorAll('[data-service-start]:not(#header-start)'),a=>a.textContent.trim());assert.deepEqual(Array.from(d.querySelectorAll('[data-service-start]:not(#header-start)'),a=>a.textContent.trim()),originalLabels,'guest CTA copy outside the header keeps its own context');assert.ok(d.querySelector('a[href="/workspace.html#category/writing"]'));assert.equal(d.querySelectorAll('#status-button').length,1);});
test('authenticated homepage safely renders actual account name and shows admin entry only for administrator',async t=>{const name='管理员<script>';const d=await page(t,{name,email:'a@example.invalid',role:'admin'});const account=d.querySelector('#account-button');assert.equal(account.classList.contains('is-signed-in'),true);assert.equal(account.querySelector('.home-account-name').textContent,name);assert.equal(account.querySelector('.home-account-avatar').textContent,'管');assert.equal(account.title,name);assert.equal(account.getAttribute('aria-label'),`打开 ${name} 的账户`);assert.equal(account.querySelector('script'),null);assert.equal(d.querySelector('#header-start').getAttribute('href'),'/workspace.html#home');assert.equal(d.querySelector('#header-start').textContent.trim(),'进入工作台');account.click();assert.ok(d.querySelector('a[href="/admin.html"]'));assert.equal(d.querySelector('#home-dialog-body script'),null);assert.ok(d.querySelector('#home-dialog-body').textContent.includes(name));});
test('account display truncates text while preserving full identity and email or phone fallback',async t=>{const name='Researcher<img src=x onerror=alert(1)>';const d=await page(t,{name,email:'u@example.invalid',role:'user'});const account=d.querySelector('#account-button');assert.equal(account.querySelector('.home-account-name').textContent,Array.from(name).slice(0,16).join(''));assert.equal(account.title,name);assert.equal(account.querySelector('img'),null);const email=await page(t,{email:'person@example.invalid',role:'user'});assert.equal(email.querySelector('.home-account-avatar').textContent,'P');assert.equal(email.querySelector('.home-account-name').textContent,'person@example.i');const phone=await page(t,{phone:'13800138000',role:'user'});assert.equal(phone.querySelector('.home-account-name').textContent,'13800138000');});
test('ordinary user keeps contextual CTA labels and offline homepage retains usable links and the guest header CTA',async t=>{const d=await page(t,{name:'用户',email:'u@example.invalid',role:'user'});const guest=await page(t,null);assert.deepEqual(Array.from(d.querySelectorAll('[data-service-start]:not(#header-start)'),a=>a.textContent.trim()),Array.from(guest.querySelectorAll('[data-service-start]:not(#header-start)'),a=>a.textContent.trim()),'account hydration preserves each section’s action label');assert.ok(Array.from(d.querySelectorAll('[data-service-start]'),a=>a.getAttribute('href')).every(href=>href==='/workspace.html#home'));d.querySelector('#account-button').click();assert.equal(d.querySelector('a[href="/admin.html"]'),null);const offline=await page(t,'offline');assert.equal(offline.querySelector('#account-button').textContent,'登录');assert.equal(offline.querySelector('#header-start').textContent.trim(),'开始使用');assert.equal(offline.querySelector('#header-start').getAttribute('href'),'/auth.html?mode=register');assert.deepEqual(Array.from(offline.querySelectorAll('[data-service-start]'),a=>[a.textContent.trim(),a.getAttribute('href')]),Array.from(guest.querySelectorAll('[data-service-start]'),a=>[a.textContent.trim(),a.getAttribute('href')]));assert.ok(offline.querySelector('a[href="/workspace.html#home"]'));});

test('account hydration completes independently when capability discovery fails or remains pending',async t=>{
 const user={name:'已登录研究员',email:'researcher@example.invalid',role:'user'};
 for(const pending of [false,true]){
  const d=await page(t,user,w=>{const fetch=w.fetch;w.fetch=path=>path==='/api/capabilities'?(pending?new Promise(()=>{}):Promise.reject(new Error('capabilities unavailable'))):fetch(path);});
  assert.equal(d.querySelector('.home-account-name').textContent,user.name);
  assert.equal(d.querySelector('#header-start').getAttribute('href'),'/workspace.html#home');
 }
});

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

test('homepage previews expose all eight workspace capabilities and switch without changing direct destinations',async t=>{
 const d=await page(t,null);
 const tabs=Array.from(d.querySelectorAll('[data-feature-tab]'));
 const keys=['writing','literature','reduce','aigc','detection','ppt','format','research'];
 assert.deepEqual(tabs.map(tab=>tab.dataset.featureTab),keys);
 const panels=Array.from(d.querySelectorAll('[data-feature-panel]'));
 const destinations=panels.map(panel=>panel.querySelector('a[href^="/workspace.html#category/"]')?.getAttribute('href'));
 assert.deepEqual(destinations,keys.map(key=>`/workspace.html#category/${key}`));
 const assertActive=key=>{
  assert.deepEqual(tabs.filter(tab=>tab.getAttribute('aria-selected')==='true').map(tab=>tab.dataset.featureTab),[key]);
  assert.deepEqual(tabs.filter(tab=>tab.tabIndex===0).map(tab=>tab.dataset.featureTab),[key]);
  assert.deepEqual(panels.filter(panel=>!panel.hidden).map(panel=>panel.dataset.featurePanel),[key]);
  const selected=tabs.find(tab=>tab.dataset.featureTab===key);
  assert.equal(selected.getAttribute('aria-controls'),panels.find(panel=>panel.dataset.featurePanel===key).id);
 };
 assertActive('writing');
 for(const tab of tabs){tab.click();assertActive(tab.dataset.featureTab);}
 assert.deepEqual(panels.map(panel=>panel.querySelector('a[href^="/workspace.html#category/"]')?.getAttribute('href')),destinations);
 tabs[0].focus();
 const key=key=>d.activeElement.dispatchEvent(new d.defaultView.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
 key('ArrowLeft');assertActive('research');assert.equal(d.activeElement,tabs[7]);
 key('ArrowRight');assertActive('writing');assert.equal(d.activeElement,tabs[0]);
 key('End');assertActive('research');
 key('Home');assertActive('writing');
});

const releaseFixture=(platform,arch,extra={})=>({platform,arch,version:'0.1.0',fileName:`PaperKnow-0.1.0-${platform}-${arch}.${platform==='macos'?'dmg':'exe'}`,bytes:120*1024*1024,sha256:'a'.repeat(64),downloadUrl:`/api/desktop/download/${platform}/${arch}`,signed:false,minSystem:platform==='macos'?'macOS 13 或更高版本':'Windows 10 或更高版本',format:platform==='macos'?'dmg':'exe',...extra});
const allReleases=()=>[releaseFixture('macos','arm64'),releaseFixture('macos','x64'),releaseFixture('windows','x64')];
const desktopResponse=(w,data)=>{w.fetch=async path=>({ok:path!=='/api/auth/me',status:path==='/api/auth/me'?401:200,json:async()=>path==='/api/desktop/releases'?data:{ai:false}});};

test('homepage keeps sample results and unpublished desktop files clearly identified',async t=>{
 const d=await page(t,null);
 d.querySelector('[data-example="report"]').click();
 assert.match(d.querySelector('#home-dialog-body').textContent,/不是一次实际检测结果/);
 assert.match(d.querySelector('#home-dialog-body').textContent,/本次检索取得的公开网页/);
 assert.match(d.querySelector('#home-dialog-body').textContent,/不包含学校封闭数据库/);
 d.querySelector('#dialog-close').click();
 for(const card of d.querySelectorAll('[data-desktop-card]')){
  assert.equal(card.querySelector('[data-desktop-status]').textContent,'暂未提供');
  assert.equal(card.querySelector('[data-desktop-action] a'),null);
  assert.ok(card.querySelector('[data-desktop-action] button').disabled);
 }
 assert.match(d.querySelector('#desktop-download-notice').textContent,/暂无已发布/);
 assert.ok(d.querySelector('a[href="/workspace.html#home"]'));
 assert.equal(d.querySelector('[data-download-platform]'),null,'old unavailable modal has been removed');
 d.querySelector('#status-button').click();
 assert.match(d.querySelector('#home-dialog-body').textContent,/11 类写作流程/);
 assert.match(d.querySelector('#home-dialog-body').textContent,/OpenAlex、arXiv/);
 assert.match(d.querySelector('#home-dialog-body').textContent,/进入功能确认/);
 assert.doesNotMatch(d.querySelector('#home-dialog-body').textContent,/尚未接入|AI 尚未接入|待开放/);
});

test('homepage describes real feature coverage and only reports service readiness from capability values',async t=>{
 const d=await page(t,null,w=>{const fetch=w.fetch;w.fetch=path=>path==='/api/capabilities'?Promise.resolve({ok:true,json:async()=>({writing:{ready:true},thesis:{ready:false},academicSearch:true,aigcDetection:{ready:true},webSimilarity:{ready:true},tools:{ready:true,presentation:{ready:true},researchImages:{ready:true}},payment:true})}):fetch(path);});
 d.querySelector('#status-button').click();
 const rows=Array.from(d.querySelectorAll('.status-list > div'));
 const status=title=>rows.find(row=>row.querySelector('b').textContent===title).querySelector('.status-tag').textContent;
 assert.equal(status('AI 写作'),'当前可用');
 assert.equal(status('毕业论文五步流程'),'暂不可用');
 assert.equal(status('文献翻译'),'进入功能确认');
 assert.equal(status('联网来源比对'),'当前可用');
 assert.equal(status('会员、积分与套餐'),'当前可用');
 d.querySelector('#dialog-close').click();d.querySelector('#about-button').click();
 assert.match(d.querySelector('#home-dialog-body').textContent,/会员、科研积分与专项套餐/);
 assert.doesNotMatch(d.querySelector('#home-dialog-body').textContent,/尚未开放|尚未接入/);
});

const planFixture=(type,extra={})=>({id:type+'-sample',title:{membership:'基础研究会员',credits:'科研积分包',bundle:'文献研读套餐'}[type],status:'active',purchasable:true,currency:'CNY',priceCents:{membership:1990,credits:1000,bundle:990}[type],entitlementType:type,durationDays:type==='credits'?null:type==='bundle'?90:30,creditAmount:type==='credits'?100:null,...extra});
function withHomePlanResponse(result,calls=[]){return w=>{
 if(!w.document.querySelector('[data-home-plan-summary]')){
  const section=w.document.createElement('section');section.dataset.homePlanSummary='';
  section.innerHTML=['membership','credits','bundle'].map(type=>`<article data-home-plan="${type}"><strong data-home-plan-price="${type}">查看当前方案</strong><small data-home-plan-detail="${type}">以工作台当前商品为准</small><a data-home-plan-link="${type}" href="/workspace.html#membership">查看方案</a></article>`).join('');
  w.document.body.append(section);
 }
 const fetch=w.fetch;w.fetch=async(path,options)=>{calls.push({path,options});if(path!=='/api/payments/options')return fetch(path,options);if(result instanceof Error)throw result;return{ok:result?.ok!==false,json:async()=>result};};
};}

test('homepage prices use the lowest purchasable product in each type and link to plan selection without creating orders',async t=>{
 const calls=[],d=await page(t,null,withHomePlanResponse({enabled:true,channels:[{provider:'wechat',ready:true}],products:[planFixture('membership',{priceCents:9900,durationDays:365}),planFixture('bundle',{priceCents:15900,durationDays:180}),planFixture('credits',{priceCents:5000,creditAmount:500}),planFixture('membership'),planFixture('credits'),planFixture('bundle')]},calls));
 assert.equal(d.querySelector('[data-home-plan-price="membership"]').textContent,'¥19.9 起 / 30天');
 assert.equal(d.querySelector('[data-home-plan-price="credits"]').textContent,'¥10 起');
 assert.equal(d.querySelector('[data-home-plan-price="bundle"]').textContent,'¥9.9 起 / 90天');
 assert.match(d.querySelector('[data-home-plan-detail="credits"]').textContent,/100 科研积分/);
 assert.match(d.querySelector('[data-home-plan-detail="bundle"]').textContent,/文献研读套餐/);
 for(const [type,route] of [['membership','plans'],['credits','recharge'],['bundle','bundles']])assert.equal(d.querySelector(`[data-home-plan-link="${type}"]`).getAttribute('href'),'/workspace.html#membership/'+route);
 assert.equal(calls.filter(call=>call.path==='/api/payments/options').length,1);
 assert.ok(calls.every(call=>!call.options?.body&&(!call.options?.method||call.options.method==='GET')));
 assert.ok(calls.every(call=>!call.path.startsWith('/api/orders')));
 assert.doesNotMatch(d.querySelector('[data-home-plan-summary]').textContent,/微信|支付宝/);
});

test('unavailable or malformed prices keep the original plan copy without inventing a fallback amount',async t=>{
 const invalid=[
  planFixture('membership',{purchasable:false,priceCents:1}),planFixture('membership',{status:'preview'}),planFixture('membership',{currency:'USD'}),planFixture('membership',{priceCents:'1990'}),planFixture('membership',{priceCents:0}),planFixture('membership',{priceCents:1990.1}),planFixture('membership',{durationDays:0}),planFixture('bundle',{durationDays:367}),planFixture('credits',{creditAmount:-1}),planFixture('credits',{purchasable:undefined}),planFixture('credits',{entitlementType:'storage'}),planFixture('credits',{entitlementType:'__proto__'})
 ];
 for(const response of [{enabled:true,products:invalid},{enabled:false,products:[planFixture('membership')]},{enabled:true,products:{}},{ok:false},new Error('offline')]){
  let defaults;
  const prepare=withHomePlanResponse(response),d=await page(t,null,w=>{prepare(w);defaults=Array.from(w.document.querySelectorAll('[data-home-plan-price],[data-home-plan-detail]'),el=>el.textContent);});
  assert.deepEqual(Array.from(d.querySelectorAll('[data-home-plan-price],[data-home-plan-detail]'),el=>el.textContent),defaults);
  assert.doesNotMatch(d.querySelector('[data-home-plan-summary]').textContent,/¥/);
 }
});

test('homepage price product titles render as text and invalid cheaper entries do not hide a valid product',async t=>{
 const d=await page(t,null,withHomePlanResponse({enabled:true,products:[planFixture('bundle',{priceCents:1,purchasable:false}),planFixture('bundle',{title:'研读 <img src=x onerror=alert(1)>',priceCents:990}),planFixture('membership',{priceCents:1,currency:'USD'}),planFixture('membership',{priceCents:1999,durationDays:45})]}));
 assert.equal(d.querySelector('[data-home-plan-price="bundle"]').textContent,'¥9.9 起 / 90天');
 assert.equal(d.querySelector('[data-home-plan-detail] img'),null);
 assert.match(d.querySelector('[data-home-plan-detail="bundle"]').textContent,/<img src=x/);
 assert.equal(d.querySelector('[data-home-plan-price="membership"]').textContent,'¥19.99 起 / 45天');
 assert.equal(d.querySelector('[data-home-plan-price="credits"]').textContent,'查看当前方案');
});

test('homepage credit details avoid repeating quantity titles and preserve distinct product titles safely',async t=>{
 for(const title of ['200 科研积分',' 200 积分 ','200科研积分','2,000 科研积分']){
  const creditAmount=title.includes('2,000')?2000:200;
  const d=await page(t,null,withHomePlanResponse({enabled:true,products:[planFixture('credits',{title,creditAmount})]}));
  assert.equal(d.querySelector('[data-home-plan-detail="credits"]').textContent,`${creditAmount.toLocaleString('zh-CN')} 科研积分`);
 }
 const d=await page(t,null,withHomePlanResponse({enabled:true,products:[planFixture('credits',{title:'研究补给 <img src=x onerror=alert(1)>',creditAmount:200})]}));
 assert.equal(d.querySelector('[data-home-plan-detail="credits"]').textContent,'研究补给 <img src=x onerror=alert(1)> · 200 科研积分');
 assert.equal(d.querySelector('[data-home-plan-detail="credits"] img'),null);
});

test('desktop download cards use published API files, switch Mac architectures, and show honest metadata',async t=>{
 let calls=0;
 const d=await page(t,null,w=>{desktopResponse(w,{version:'0.1.0',releases:allReleases()});const fetch=w.fetch;w.fetch=(path,...rest)=>{if(path==='/api/desktop/releases')calls++;return fetch(path,...rest);};});
 const mac=d.querySelector('[data-desktop-card="macos"]'),windows=d.querySelector('[data-desktop-card="windows"]');
 assert.equal(calls,1);
 assert.equal(mac.querySelector('[data-desktop-status]').textContent,'v0.1.0');
 assert.equal(mac.querySelector('[data-desktop-download]').getAttribute('href'),'/api/desktop/download/macos/arm64');
 assert.equal(windows.querySelector('[data-desktop-download]').getAttribute('href'),'/api/desktop/download/windows/x64');
 assert.match(mac.querySelector('[data-desktop-meta]').textContent,/120.0 MB/);
 assert.match(mac.querySelector('[data-desktop-meta]').textContent,/macOS 13/);
 assert.match(mac.querySelector('code').textContent,new RegExp('a'.repeat(64)));
 assert.match(d.querySelector('#desktop-download-notice').textContent,/尚未签名/);
 assert.match(d.querySelector('#desktop-faq-status').textContent,/v0.1.0 已提供下载/);
 d.querySelector('input[name="desktop-mac-arch"][value="x64"]').click();
 assert.equal(mac.querySelector('[data-desktop-download]').getAttribute('href'),'/api/desktop/download/macos/x64');
 assert.equal(calls,1,'switching hardware does not create a second request');
 assert.equal(mac.getAttribute('aria-busy'),'false');
});

test('desktop release loading and failure never expose fake links, and retry recovers from the same API',async t=>{
 let resolveReleases;
 const d=await page(t,null,w=>{w.fetch=async path=>path==='/api/desktop/releases'?new Promise(resolve=>{resolveReleases=resolve;}):({ok:false,status:401,json:async()=>({})});});
 assert.equal(d.querySelector('[data-desktop-card]').getAttribute('aria-busy'),'true');
 assert.equal(d.querySelector('[data-desktop-download]'),null);
 resolveReleases({ok:false,status:503});
 for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.match(d.querySelector('#desktop-download-notice').textContent,/暂时无法获取/);
 assert.equal(d.querySelector('[data-desktop-download]'),null);
 assert.equal(d.querySelector('#desktop-download-retry').hidden,false);
 desktopResponse(d.defaultView,{version:'0.1.0',releases:[releaseFixture('windows','x64')]});
 d.querySelector('#desktop-download-retry').click();
 for(let i=0;i<5;i++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.ok(d.querySelector('[data-desktop-download="windows/x64"]'));
 assert.equal(d.querySelector('[data-desktop-card="macos"] a'),null);
});

test('desktop downloads reject untrusted paths and malformed release metadata without injecting content',async t=>{
 const malicious=[
  releaseFixture('macos','arm64',{downloadUrl:'https://untrusted.invalid/install.dmg'}),
  releaseFixture('macos','x64',{bytes:0}),
  releaseFixture('windows','x64',{downloadUrl:'javascript:alert(1)'}),
  releaseFixture('windows','arm64'),
  releaseFixture('windows','x64',{sha256:'missing'}),
  releaseFixture('windows','x64',{fileName:'../../malware.exe'})
 ];
 const d=await page(t,null,w=>desktopResponse(w,{version:'0.1.0',releases:malicious}));
 assert.equal(d.querySelector('[data-desktop-download]'),null);
 assert.match(d.querySelector('#desktop-download-notice').textContent,/暂无已发布/);
 const safe=await page(t,null,w=>desktopResponse(w,{version:'0.1.0',releases:[releaseFixture('windows','x64',{minSystem:'<img src=x onerror=alert(1)>'})]}));
 assert.equal(safe.querySelector('[data-desktop-meta] img'),null);
 assert.match(safe.querySelector('[data-desktop-card="windows"] [data-desktop-meta]').textContent,/<img/);
});

test('capability carousel advances in view, wraps after the last capability, and leaves keyboard focus alone',async t=>{
 const clock=carouselEnvironment(),d=await page(t,null,clock.prepare);
 const selected=()=>d.querySelector('[data-feature-tab][aria-selected="true"]').dataset.featureTab;
 assert.equal(clock.pending,0,'offscreen previews do not rotate');
 clock.enter(.1);assert.equal(clock.pending,0,'a small visible sliver is insufficient to start');
 clock.enter(.5);assert.equal(clock.pending,1);
 const focus=d.activeElement;
 clock.advance();assert.equal(selected(),'literature');assert.equal(d.activeElement,focus);
 const previousTimer=clock.timer;
 d.querySelector('[data-feature-tab="research"]').click();
 assert.notEqual(clock.timer,previousTimer,'manual selection starts a fresh reading interval');
 clock.advance();assert.equal(selected(),'writing');assert.equal(d.activeElement,focus);
 for(const panel of d.querySelectorAll('[data-feature-panel]')){
  const active=panel.dataset.featurePanel==='writing';
  assert.equal(panel.hidden,!active);
  assert.equal(panel.getAttribute('aria-hidden'),String(!active));
  assert.equal(panel.inert,!active,'inactive cards cannot retain interactive focus targets');
 }
});

test('capability carousel keeps rotating with the mouse over it after a real pointer focus and click sequence',async t=>{
 const clock=carouselEnvironment(),d=await page(t,null,clock.prepare),w=d.defaultView;
 const section=d.querySelector('#capabilities'),tab=d.querySelector('[data-feature-tab="literature"]');
 const selected=()=>d.querySelector('[data-feature-tab][aria-selected="true"]').dataset.featureTab;
 const pointer=type=>{const event=new w.Event(type,{bubbles:type==='pointerdown'});Object.defineProperty(event,'pointerType',{value:'mouse'});return event;};
 clock.enter();const initialTimer=clock.timer;
 section.dispatchEvent(pointer('pointerenter'));
 assert.equal(clock.timer,initialTimer,'stationary hover does not stop or reset the five second interval');
 tab.dispatchEvent(pointer('pointerdown'));tab.focus();tab.click();
 assert.equal(selected(),'literature');assert.equal(d.activeElement,tab);
 assert.equal(section.dataset.rotation,'running');assert.equal(clock.pending,1);
 const manualTimer=clock.timer;
 assert.notEqual(manualTimer,initialTimer,'a manual click grants a fresh five second interval');
 section.dispatchEvent(pointer('pointerleave'));
 assert.equal(clock.timer,manualTimer,'moving the mouse away does not change the interval');
 clock.advance();assert.equal(selected(),'reduce');assert.equal(d.activeElement,tab,'rotation does not move focus');
 assert.equal(d.querySelector('[data-feature-panel="reduce"]').hidden,false,'the lower preview follows the rotating tab');
 clock.advance();assert.equal(selected(),'aigc');assert.equal(clock.pending,1,'rotation continues beyond a single transition');
 tab.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
 assert.equal(clock.pending,0,'switching to keyboard navigation still pauses rotation');
 assert.equal(d.activeElement,d.querySelector('[data-feature-tab="reduce"]'));
 d.querySelector('#account-button').focus();await Promise.resolve();
 assert.equal(clock.pending,1,'leaving keyboard interaction resumes rotation');
});

test('capability carousel pauses for keyboard focus, preview actions, dialogs, or leaving the page and resumes with a fresh interval',async t=>{
 const clock=carouselEnvironment(),d=await page(t,null,clock.prepare),w=d.defaultView;
 clock.enter();
 let previousTimer=clock.timer;
 const assertPaused=()=>assert.equal(clock.pending,0,'rotation stops during the interruption');
 const assertRestarted=()=>{assert.equal(clock.pending,1);assert.notEqual(clock.timer,previousTimer,'resuming grants another full reading interval');previousTimer=clock.timer;};
 d.querySelector('[data-feature-tab="writing"]').focus();assertPaused();
 d.querySelector('#account-button').focus();await Promise.resolve();assertRestarted();
 const pointer=new w.Event('pointerdown',{bubbles:true});Object.defineProperty(pointer,'pointerType',{value:'mouse'});
 const action=d.querySelector('[data-feature-panel="writing"] button');
 action.dispatchEvent(pointer);action.focus();assertPaused();
 d.querySelector('#account-button').focus();await Promise.resolve();assertRestarted();
 d.querySelector('#about-button').click();await Promise.resolve();assertPaused();
 d.querySelector('#dialog-close').click();await Promise.resolve();assertRestarted();
 clock.hide(d,true);assertPaused();
 clock.hide(d,false);assertRestarted();
 clock.enter(0);assertPaused();
 clock.enter(.5);assertRestarted();
 assert.equal(d.querySelector('[data-feature-tab][aria-selected="true"]').dataset.featureTab,'writing','interruptions never advance a card');
});

test('capability carousel defaults to manual cards for reduced motion',async t=>{
 const reducedClock=carouselEnvironment({reducedMotion:true});
 const reduced=await page(t,null,reducedClock.prepare);reducedClock.enter();
 assert.equal(reducedClock.pending,0,'reduced motion prevents automatic cycling by default');
 reduced.querySelector('[data-feature-tab="ppt"]').click();
 assert.equal(reduced.querySelector('[data-feature-tab][aria-selected="true"]').dataset.featureTab,'ppt');
 assert.equal(reducedClock.pending,0,'manual preview selection remains available without autoplay');
});

test('touch interaction stops capability rotation while keeping manual tab selection available',async t=>{
 const clock=carouselEnvironment(),d=await page(t,null,clock.prepare),w=d.defaultView;
 clock.enter();assert.equal(clock.pending,1);
 const touch=new w.Event('pointerdown',{bubbles:true});Object.defineProperty(touch,'pointerType',{value:'touch'});
 d.querySelector('[data-feature-tab="literature"]').dispatchEvent(touch);
 assert.equal(clock.pending,0,'touch grants uninterrupted reading time');
 d.querySelector('[data-feature-tab="ppt"]').click();
 assert.equal(d.querySelector('[data-feature-tab][aria-selected="true"]').dataset.featureTab,'ppt');
 clock.enter(0);clock.enter();
 assert.equal(clock.pending,0,'scrolling back to the preview does not resume rotation after touch');
});

test('mobile capability previews stay manual and react to the 700px media breakpoint',async t=>{
 const clock=carouselEnvironment({compact:true}),d=await page(t,null,clock.prepare),w=d.defaultView;
 clock.enter();assert.equal(clock.pending,0,'mobile previews never start an automatic timer');
 assert.equal(d.querySelector('#capabilities').dataset.rotation,'paused');
 const ppt=d.querySelector('[data-feature-tab="ppt"]');ppt.click();
 assert.equal(d.querySelector('[data-feature-tab][aria-selected="true"]').dataset.featureTab,'ppt');
 assert.equal(clock.pending,0,'tap selection remains manual');
 ppt.focus();ppt.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
 assert.equal(d.querySelector('[data-feature-tab][aria-selected="true"]').dataset.featureTab,'format');
 assert.equal(d.activeElement,d.querySelector('[data-feature-tab="format"]'));
 d.querySelector('#account-button').focus();await Promise.resolve();
 assert.equal(clock.pending,0,'leaving keyboard focus does not enable mobile autoplay');
 clock.setCompact(false);assert.equal(clock.pending,1,'desktop resumes the existing rotation behavior');
 clock.advance();assert.equal(d.querySelector('[data-feature-tab][aria-selected="true"]').dataset.featureTab,'research');
 clock.setCompact(true);assert.equal(clock.pending,0,'returning to mobile cancels the scheduled desktop rotation');
 assert.equal(d.querySelector('#capabilities').dataset.rotation,'paused');
});

test('media breakpoint changes preserve a manual touch pause on desktop',async t=>{
 const clock=carouselEnvironment(),d=await page(t,null,clock.prepare),w=d.defaultView;
 clock.enter();assert.equal(clock.pending,1);
 const touch=new w.Event('pointerdown',{bubbles:true});Object.defineProperty(touch,'pointerType',{value:'touch'});
 d.querySelector('#capabilities').dispatchEvent(touch);
 clock.setCompact(true);clock.setCompact(false);
 assert.equal(clock.pending,0,'resizing does not override an explicit touch pause');
});
