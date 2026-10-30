import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {catalog as writingCatalog} from '../dist/workspace/writing-catalog.mjs';
import {featurePages} from '../src/public-feature-content.mjs';

const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const script=await readFile(new URL('../dist/home-app.js',import.meta.url),'utf8');
const categories=['writing','literature','detection','reduce','aigc','ppt','format','research'];

function documentFor(t){
 const dom=new JSDOM(html,{url:'https://paperknow.cn/'});
 t.after(()=>dom.window.close());
 return dom.window.document;
}

test('commercial homepage preserves an accessible main entry and resolves every internal fragment',t=>{
 const document=documentFor(t),ids=[...document.querySelectorAll('[id]')].map(node=>node.id);
 assert.equal(new Set(ids).size,ids.length,'interactive controls and previews have unique IDs');
 assert.equal(document.querySelectorAll('main').length,1);
 assert.equal(document.querySelectorAll('h1').length,1);
 const main=document.querySelector('main');
 assert.ok(main.id);
 assert.ok(document.querySelector(`a[href="#${main.id}"]`),'keyboard users can skip directly to the main content');
 for(const node of document.querySelectorAll('a[href^="#"],use[href^="#"]')){
  const reference=node.getAttribute('href');
  assert.ok(document.getElementById(reference.slice(1)),`missing in-page destination: ${reference}`);
 }
 for(const button of document.querySelectorAll('button')){
  assert.ok((button.getAttribute('aria-label')||button.textContent).trim(),'every button has an accessible name before JavaScript runs');
 }
});

test('homepage dependencies and media are local files shipped with the site',async t=>{
 const document=documentFor(t);
 const assets=[...document.querySelectorAll('link[rel="stylesheet"][href],link[rel="icon"][href],script[src],img[src]')];
 for(const node of assets){
  const path=node.getAttribute('href')||node.getAttribute('src');
  assert.match(path,/^\/(?!\/)/,'homepage assets should not depend on a third-party origin');
  assert.equal((await stat(new URL('../dist'+path,import.meta.url))).isFile(),true,path);
 }
 for(const image of document.querySelectorAll('img')){
  assert.ok(image.hasAttribute('alt'),'decorative images still declare empty alt text');
  assert.ok(image.width>0&&image.height>0,'image dimensions reserve layout space');
 }
});

test('responsive homepage artwork is shipped locally within a bounded image budget and loads by priority',async t=>{
 const document=documentFor(t),hero=document.querySelector('.hp-hero-art img');
 const supporting=[...document.querySelectorAll('.hp-section-art img,.hp-closing-art img')];
 assert.ok(hero,'the main illustration is present in initial HTML');
 assert.equal(supporting.length,2,'supporting artwork has two distinct page placements');
 assert.equal(hero.getAttribute('fetchpriority'),'high','the visible hero image is prioritized');
 assert.notEqual(hero.getAttribute('loading'),'lazy','the hero is not delayed until lazy loading');
 const paths=new Set();
 for(const image of [hero,...supporting]){
  assert.equal(image.getAttribute('alt'),'','decorative artwork does not replace readable page content');
  assert.equal(image.closest('picture')?.getAttribute('aria-hidden'),'true');
  assert.ok(image.width>0&&image.height>0,'artwork reserves its aspect ratio before loading');
  assert.equal(image.getAttribute('decoding'),'async');
  assert.ok(image.getAttribute('sizes')?.trim(),'responsive candidates have a layout size hint');
  paths.add(image.getAttribute('src'));
  const candidates=image.getAttribute('srcset')?.split(',').map(value=>value.trim());
  assert.ok(candidates?.length>=2,'small screens can choose a smaller asset');
  for(const candidate of candidates){
   const [path,width,...extra]=candidate.split(/\s+/);
   assert.equal(extra.length,0,'each source candidate has one width descriptor');
   assert.match(width,/^[1-9]\d*w$/);
   paths.add(path);
  }
 }
 for(const image of supporting)assert.equal(image.getAttribute('loading'),'lazy','below-fold art is not eagerly downloaded');
 let total=0;
 for(const path of paths){
  assert.match(path,/^\/brand\/homepage\/[a-z0-9-]+\.webp$/,'artwork is a versioned local WebP asset');
  const bytes=await readFile(new URL('../dist'+path,import.meta.url));
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
  assert.ok(bytes.length<=120*1024,`individual artwork should stay lightweight: ${path}`);
  total+=bytes.length;
 }
 assert.ok(total<=350*1024,'all responsive artwork variants combined stay under the delivery budget');
});

test('every homepage capability keeps the corresponding workspace and public explanation reachable',t=>{
 const document=documentFor(t);
 assert.deepEqual([...document.querySelectorAll('[data-feature-tab]')].map(node=>node.dataset.featureTab),categories);
 for(const category of categories){
  const panel=document.querySelector(`[data-feature-panel="${category}"]`);
  assert.ok(panel,category);
  const destination=`/workspace.html#category/${category}`;
  assert.ok(panel.querySelector(`a[href="${destination}"]`),`direct capability entry: ${category}`);
  assert.ok(document.querySelector(`#main-nav a[href="${destination}"]`),`navigation entry: ${category}`);
  const information=featurePages.find(page=>page.category===category);
  assert.ok(information,`published explanation exists: ${category}`);
  assert.ok(panel.querySelector(`a[href="${information.slug}"]`),`public explanation: ${category}`);
  assert.doesNotMatch(panel.textContent,/尚未接入|待接入|尚未开放|待开放/,'released workflows are not described as disconnected placeholders');
  assert.match(panel.textContent,/示意|示例/,'a product preview is distinguishable from an actual user result');
 }
});

test('homepage task shortcuts cover the shipped writing catalog including the topic alias',t=>{
 const document=documentFor(t),flow=document.querySelector('#writing-flow');
 assert.ok(flow);
 for(const [key,label] of writingCatalog){
  const route=key==='idea'?'topic':key;
  const link=flow.querySelector(`a[href="/workspace.html#tool/${route}"]`)||flow.querySelector(`a[href="/workspace.html#tool/${key}"]`);
  assert.ok(link,`missing shipped writing task: ${label}`);
  assert.ok(link.textContent.includes(label),`task label identifies its destination: ${label}`);
 }
 const text=flow.textContent;
 for(const step of ['基础信息','资料补充','参考文献','提纲确认','生成与导出'])assert.ok(text.includes(step),`writing step: ${step}`);
 assert.match(text,/确认|核对/);
});

test('plan cards are previews that retain selection routes without a checkout or embedded payment form',t=>{
 const document=documentFor(t),summary=document.querySelector('[data-home-plan-summary]');
 assert.ok(summary);
 const routes={membership:'plans',credits:'recharge',bundle:'bundles'};
 assert.deepEqual([...summary.querySelectorAll('[data-home-plan]')].map(node=>node.dataset.homePlan),Object.keys(routes));
 for(const [type,route] of Object.entries(routes)){
  assert.ok(summary.querySelector(`[data-home-plan-price="${type}"]`));
  assert.ok(summary.querySelector(`[data-home-plan-detail="${type}"]`));
  assert.equal(summary.querySelector(`[data-home-plan-link="${type}"]`).getAttribute('href'),`/workspace.html#membership/${route}`);
 }
 assert.equal(summary.querySelector('form,input,iframe,button'),null);
 assert.equal(summary.querySelector('a[href*="/pay?"],a[href*="/checkout"],a[href*="/api/orders"]'),null);
 assert.doesNotMatch(summary.textContent,/¥|￥|微信|支付宝/,'static HTML does not invent an amount or promote a payment method');
});

test('FAQ explains evidence limits, voluntary uploads, fees and exports without obsolete launch restrictions',t=>{
 const document=documentFor(t),faq=document.querySelector('.faq-list');
 assert.ok(faq);
 const details=[...faq.querySelectorAll('details')];
 assert.ok(details.length>=6);
 for(const item of details){
  assert.ok(item.querySelector('summary')?.textContent.trim());
  assert.ok(item.querySelector('p')?.textContent.trim());
 }
 const text=faq.textContent;
 assert.match(text,/不会?自动续费/);
 assert.match(text,/提交任务前.*(?:确认|显示).*费用|提交.*前.*确认.*权益/);
 assert.match(text,/私有云端空间/);assert.match(text,/同一账户/);assert.doesNotMatch(text,/本地草稿|部分本地工具|不同环境分别保存/);
 assert.match(text,/学校指定|学校.*数据库/);
 assert.match(text,/导出/);
 assert.doesNotMatch(text,/在线 AI.*尚未开放|AI 生成尚未开放|学术检索尚未开放|付费购买尚未开放|未开放的解锁流程/);
 for(const path of ['/features/','/guides/','/help/','/privacy/','/terms/','/contact/','/about/'])assert.ok(document.querySelector(`a[href="${path}"]`),path);
});

test('all sample actions open a labeled preview and preserve their actual task destination',async t=>{
 const dom=new JSDOM(html,{url:'https://paperknow.cn/',runScripts:'outside-only'}),window=dom.window,document=window.document;
 t.after(()=>window.close());
 window.matchMedia=media=>({media,matches:true,addEventListener(){},removeEventListener(){}});
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
 window.fetch=async path=>({ok:path!=='/api/auth/me',status:path==='/api/auth/me'?401:200,json:async()=>path==='/api/desktop/releases'?{version:'0.1.0',releases:[]}:path==='/api/payments/options'?{enabled:false,products:[]}: {}});
 window.eval(script);
 await new Promise(resolve=>setTimeout(resolve,0));
 const samples={outline:['.mini-outline','/workspace.html#category/writing'],report:['.mini-comparison','/workspace.html#category/detection'],revision:['.mini-revision','/workspace.html#category/reduce']};
 for(const [key,[preview,route]] of Object.entries(samples)){
  const action=document.querySelector(`[data-example="${key}"]`);
  assert.ok(action,key);
  action.focus();action.click();
  assert.equal(document.querySelector('#home-dialog').open,true);
  assert.match(document.querySelector('#home-dialog-title').textContent,/示例/);
  const body=document.querySelector('#home-dialog-body');
  assert.ok(body.querySelector(preview),`actual preview cloned for ${key}`);
  assert.ok(body.querySelector(`a[href="${route}"]`));
  assert.match(body.textContent,/示例|当前未|不是一次实际检测结果/);
  document.querySelector('#dialog-close').click();
  assert.equal(document.querySelector('#home-dialog').open,false);
  assert.equal(document.activeElement,action,'closing a preview returns focus to its trigger');
 }
});

test('V1 homepage follows the released reading, detection, presentation, format and cloud workflows',t=>{
 const document=documentFor(t),body=document.body;
 assert.equal(document.querySelector('#hero-writing-start').getAttribute('href'),'/workspace.html#tool/writing');
 assert.ok(document.querySelector('.hp-v1-quick-start a[href="/workspace.html#tool/proposal"]'));
 assert.match(document.querySelector('[data-feature-panel="literature"]').textContent,/批量上传 PDF/);
 assert.ok(document.querySelector('.hp-v1-reading-split .hp-v1-pdf-page'));assert.ok(document.querySelector('.hp-v1-reader-assistant'));
 assert.ok(document.querySelector('[data-feature-panel="detection"] a[href="/workspace.html#category/detection?view=combined"]'));
 const ppt=document.querySelector('[data-feature-panel="ppt"]');assert.match(ppt.textContent,/网页.*预览|预览.*网页/);assert.doesNotMatch(ppt.textContent,/确认大纲|先确认内容结构/);
 const format=document.querySelector('[data-feature-panel="format"]');assert.match(format.textContent,/格式模板/);assert.match(format.textContent,/文稿原文/);assert.match(format.textContent,/DOCX/);
 assert.equal(document.querySelector('.hp-plans-section').id,'plans');assert.notEqual(document.querySelector('#download').closest('.hp-plans-section'),document.querySelector('#plans'));
 assert.ok(document.querySelector('#plans a[href="/workspace.html#membership/pricing"]'));
 assert.doesNotMatch(body.textContent,/本地草稿保存在|部分本地工具|分别保存在各自设备|科研主题视觉示意/);
});
function runtimeHome(t,data,{releases=[],user=null}={}){
 const dom=new JSDOM(html,{url:'https://paperknow.cn/',runScripts:'outside-only'}),w=dom.window,calls=[];t.after(()=>w.close());
 w.matchMedia=media=>({media,matches:true,addEventListener(){},removeEventListener(){}});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async(path,options={})=>{calls.push([path,options]);return {ok:path!=='/api/auth/me'||!!user,status:path==='/api/auth/me'&&!user?401:200,json:async()=>path==='/api/payments/options'?data:path==='/api/desktop/releases'?{releases}:path==='/api/auth/me'?{user}:{account:true,tools:{ready:true},writing:{ready:true},thesis:{ready:true}}};};w.eval(script);
 return {w,doc:w.document,calls,ready:async()=>{for(let n=0;n<5;n++)await new Promise(r=>setImmediate(r));}};
}
const publishedHomePricing=()=>({enabled:true,products:[
 {id:'reading-v1',title:'研读会员',status:'active',purchasable:true,currency:'CNY',priceCents:2990,durationDays:30,entitlementType:'membership',membershipItems:[{key:'light-ai',quantity:60},{key:'translation-pages',quantity:20}]},
 {id:'credits-200',title:'200 科研积分',status:'active',purchasable:true,currency:'CNY',priceCents:2000,entitlementType:'credits',creditAmount:200},
 {id:'bundle-rewrite',title:'查重优化套餐',status:'active',purchasable:true,currency:'CNY',priceCents:5900,durationDays:180,entitlementType:'bundle'}],
 billing:{services:[{key:'agent',mode:'paid',creditCost:1,available:true}]},toolBilling:{services:[{key:'thesis-bachelor',effectiveMode:'paid',effectiveCreditCost:1234,available:true},{key:'detection-similarity',effectiveMode:'paid',effectiveCreditCost:99,available:true},{key:'presentation-ai',effectiveMode:'paid',effectiveCreditCost:199,available:true}]}});

test('homepage prices use the exact published service fee and member quota without creating orders or estimating from the generic agent rate',async t=>{
 const f=runtimeHome(t,publishedHomePricing());await f.ready();
 assert.match(f.doc.querySelector('[data-home-service-price="thesis-bachelor"]').textContent,/1,234 积分/);assert.match(f.doc.querySelector('[data-home-service-price="thesis-bachelor"]').textContent,/¥123\.40/);
 assert.match(f.doc.querySelector('[data-home-service-price="presentation-ai"]').textContent,/199 积分/);assert.match(f.doc.querySelector('[data-home-plan-price="membership"]').textContent,/29\.9.*30天/);
 assert.match(f.doc.querySelector('[data-home-plan-detail="membership"]').textContent,/60 次.*20 页/);assert.match(f.doc.querySelector('[data-home-plan-price="bundle"]').textContent,/59.*180天/);
 assert.equal(f.calls.filter(([path])=>path==='/api/payments/options').length,1);assert.equal(f.calls.every(([,options])=>!options.method||options.method==='GET'),true);
});
test('malformed or unavailable paid services cannot appear free and valid fees remain visible while sales are paused',async t=>{
 const data=publishedHomePricing();data.enabled=false;data.toolBilling.services[0].effectiveCreditCost=null;data.toolBilling.services[1].available=false;
 const f=runtimeHome(t,data);await f.ready();assert.match(f.doc.querySelector('[data-home-service-price="thesis-bachelor"]').textContent,/价格待核对/);assert.match(f.doc.querySelector('[data-home-service-price="detection-similarity"]').textContent,/查看当前费用/);assert.match(f.doc.querySelector('[data-home-service-price="presentation-ai"]').textContent,/199 积分/);assert.equal(f.doc.querySelector('[data-home-plan-price="membership"]').textContent,'查看当前方案');
});
test('the published desktop FAQ reflects a unified cloud account rather than separate local drafts',async t=>{
 const release={platform:'macos',arch:'arm64',format:'dmg',version:'1.0.0',bytes:102400,sha256:'a'.repeat(64),fileName:'PaperKnow.dmg',minSystem:'macOS 12',signed:false,downloadUrl:'/api/desktop/download/macos/arm64'};
 const f=runtimeHome(t,publishedHomePricing(),{releases:[release]});await f.ready();const text=f.doc.querySelector('#desktop-faq-status').textContent;assert.match(text,/同一账户.*云端资料/);assert.doesNotMatch(text,/本地草稿|不会自动互相迁移/);assert.match(f.doc.querySelector('#desktop-download-notice').textContent,/尚未签名/);
});
