import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {catalog as writingCatalog} from '../dist/workspace/writing-catalog.mjs';
import {featurePages} from '../src/public-feature-content.mjs';

const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const script=await readFile(new URL('../dist/home-app.js',import.meta.url),'utf8');
const categories=['writing','literature','reduce','aigc','detection','ppt','format','research'];

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
 for(const step of ['基础信息','资料补充','参考文献','提纲确认','生成版本'])assert.ok(text.includes(step),`writing step: ${step}`);
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
 assert.match(text,/不自动续费/);
 assert.match(text,/提交任务前.*确认.*费用|提交.*前.*确认.*权益/);
 assert.match(text,/不会因登录自动上传/);
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
