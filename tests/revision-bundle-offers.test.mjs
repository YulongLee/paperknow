import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {revisionBundleOffersMarkup,mountRevisionBundleOffers,revisionBundlePlans} from '../dist/workspace/revision-bundle-offers.mjs';
import {bundlePreviewCard} from '../dist/workspace/commerce-bundle-card.mjs';

const ids=['bundle-rewrite','bundle-reduce','bundle-dual'];
const settle=async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));};
const product=(id='bundle-dual',overrides={})=>({id,title:'已发布的组合修改套餐',description:'实际发布的表达修改服务，分项次数独立使用。',status:'active',purchasable:true,currency:'CNY',priceCents:2188,durationDays:60,entitlementType:'bundle',bundleItems:[{key:'revision-dual',title:'综合表达修改',quantity:8}],entitlement:{type:'bundle',durationDays:60},...overrides});
const catalogue=(products=[])=>({enabled:true,channels:[{provider:'wechat',ready:true}],products});
const response=options=>({ok:true,json:async()=>options});
function setup(kind='reduce'){
 const dom=new JSDOM(`<main class="dashboard">${revisionBundleOffersMarkup(kind)}<form><textarea id="preserved">用户手工正文</textarea><button type="button" class="selected" id="strategy">用户选中的策略</button></form></main>`,{url:`https://paperknow.cn/workspace.html#category/${kind}`});
 const w=dom.window,root=w.document.querySelector('[data-revision-bundle-offers]');
 const requests=[];w.fetch=async(url,request)=>{requests.push({url,...request});return response(catalogue());};
 w.scrollTo=()=>{};
 return {dom,w,root,requests,close:()=>dom.window.close()};
}
const noPayment=root=>{assert.equal(root.querySelector('[data-revision-bundle-checkout]'),null);assert.equal(root.querySelector('a[href*="membership/pay"]'),null);assert.doesNotMatch(root.textContent,/¥|￥|99 元|129 元|159 元|旗舰版查重 ×|AIGC 检测 ×/);};

test('the specialist catalogue preserves three original names without coupling to a modification form',()=>{
 for(const kind of ['reduce','aigc','membership','invalid']){
  const s=setup(kind);try{
   assert.deepEqual([...s.root.querySelectorAll('[data-revision-bundle]')].map(card=>card.dataset.revisionBundle),ids);
   assert.deepEqual([...s.root.querySelectorAll('h3')].map(node=>node.textContent),['强力查降套餐','超值降 AI 套餐','AIGC+重复率双降套餐']);
   assert.equal(s.root.dataset.revisionBundleContext,kind==='membership'?'membership':kind==='aigc'?'aigc':'reduce');
   assert.equal(s.root.querySelectorAll('[data-revision-bundle-state="loading"]').length,3);noPayment(s.root);
   assert.ok(s.root.querySelector('a[href="#membership?scope=account"]'));
   assert.match(s.root.querySelector('h2').textContent,/查降专项套餐/);assert.doesNotMatch(s.root.textContent,/下方修改方案/);
   assert.ok(s.root.querySelector('a[href="#membership/recharge"]'));
   assert.ok([...s.root.querySelectorAll('button')].every(button=>button.type==='button'));
  }finally{s.close();}
 }
});

test('empty server catalogue labels the retained bundle cards unpublished without prices or checkout',async()=>{
 const s=setup();try{
  const mounted=mountRevisionBundleOffers({container:s.root});await settle();
  assert.equal(s.root.querySelectorAll('[data-revision-bundle-state="unpublished"]').length,3);noPayment(s.root);
  assert.match(s.root.querySelector('[role="status"]').textContent,/原有套餐方案仍在/);
  assert.deepEqual(s.requests.map(({url,method,credentials,cache})=>({url,method,credentials,cache})),[{url:'/api/payments/options',method:'GET',credentials:'same-origin',cache:'no-store'}]);
  mounted.dispose();
 }finally{s.close();}
});

test('one exact deliverable SKU upgrades only its card with actual amount, period, service count and neutral checkout',async()=>{
 const s=setup('aigc');try{
  s.w.localStorage.setItem('paperknow-drafts','[{"id":"kept"}]');
  s.w.fetch=async(url,request)=>{s.requests.push({url,...request});return response(catalogue([product(),product('unrelated-bundle',{priceCents:900})]));};
  const textarea=s.w.document.querySelector('textarea');textarea.focus();textarea.setSelectionRange(3,5);
  const mounted=mountRevisionBundleOffers({container:s.root});await settle();
  const card=s.root.querySelector('[data-revision-bundle="bundle-dual"]');
  assert.equal(card.querySelector('h3').textContent,'已发布的组合修改套餐');
  assert.match(card.textContent,/¥21\.88/);assert.match(card.textContent,/60 天/);assert.match(card.textContent,/综合表达修改\s*× 8/);
  assert.equal(card.querySelector('a').getAttribute('href'),'#membership/pay?product=bundle-dual');
  assert.equal(s.root.querySelectorAll('[data-revision-bundle-state="published"]').length,1);
  assert.equal(s.root.querySelectorAll('[data-revision-bundle-state="unpublished"]').length,2);
  assert.doesNotMatch(s.root.textContent,/微信|支付宝|二维码|支付已就绪/);
  assert.equal(s.w.document.querySelector('textarea'),textarea);assert.equal(textarea.value,'用户手工正文');assert.equal(s.w.document.activeElement,textarea);assert.equal(textarea.selectionStart,3);
  assert.equal(s.w.document.querySelector('#strategy').className,'selected');
  assert.equal(s.w.localStorage.length,1);assert.equal(s.w.localStorage.getItem('paperknow-drafts'),'[{"id":"kept"}]');assert.equal(s.requests.length,1);mounted.dispose();
 }finally{s.close();}
});

test('published nested frozen entitlements are accepted while channel choice stays at checkout',async()=>{
 const s=setup();try{
  const p=product('bundle-rewrite',{bundleItems:undefined,durationDays:undefined,entitlement:{type:'bundle',durationDays:45,bundleItems:[{key:'revision-reduce',title:'重复表达整理',quantity:3}]}});
  const options=catalogue([p]);options.enabled=false;options.channels.forEach(channel=>channel.ready=false);
  const mounted=mountRevisionBundleOffers({container:s.root,fetchOptions:async()=>response(options)});await settle();
  const card=s.root.querySelector('[data-revision-bundle="bundle-rewrite"]');assert.match(card.textContent,/45 天/);assert.match(card.textContent,/重复表达整理\s*× 3/);
  assert.equal(card.querySelector('a').getAttribute('href'),'#membership/pay?product=bundle-rewrite');assert.doesNotMatch(s.root.textContent,/微信|支付宝|渠道已开通/);mounted.dispose();
 }finally{s.close();}
});

test('invalid, duplicated, unpublished or undeliverable offers cannot inherit prices or purchase routes',async()=>{
 const invalid=[
  {status:'preview'},{purchasable:false},{purchasable:undefined},{purchasable:'true'},{currency:'USD'},
  {priceCents:0},{priceCents:1.5},{priceCents:10000001},{durationDays:0},{durationDays:367},
  {durationDays:45},{entitlementType:'membership'},{entitlement:{type:'membership',durationDays:60}},
  {title:''},{title:' '.repeat(4)},{title:'长'.repeat(81)},{description:''},{description:'长'.repeat(1001)},
  {bundleItems:[]},{bundleItems:[{key:'revision-dual',title:'额度',quantity:0}]},
  {bundleItems:[{key:'revision-dual',title:'额度',quantity:1.5}]},{bundleItems:[{key:'revision-dual',title:'额度',quantity:100001}]},
  {bundleItems:[{key:'UPPER',title:'额度',quantity:1}]},{bundleItems:[{key:'revision-dual',title:'',quantity:1}]},
  {bundleItems:[{key:'revision-dual',title:'额度1',quantity:1},{key:'revision-dual',title:'额度2',quantity:1}]},
  {entitlement:{type:'bundle',durationDays:60,bundleItems:[{key:'review',title:'冲突额度',quantity:1}]}}
 ];
 for(const override of invalid){
  const s=setup();try{
   const mounted=mountRevisionBundleOffers({container:s.root,fetchOptions:async()=>response(catalogue([product('bundle-dual',override),product('some-other-sku')]))});await settle();noPayment(s.root);assert.equal(s.root.querySelectorAll('[data-revision-bundle]').length,3);mounted.dispose();
  }finally{s.close();}
 }
 const s=setup();try{
  const mounted=mountRevisionBundleOffers({container:s.root,fetchOptions:async()=>response(catalogue([product(),product('bundle-dual',{status:'preview'})]))});await settle();noPayment(s.root);mounted.dispose();
 }finally{s.close();}
});

test('catalogue text is escaped in shared cards and never becomes arbitrary markup or a redirect',async()=>{
 const s=setup();try{
  const p=product('bundle-reduce',{title:'套餐 <img src=x onerror=alert(1)>',description:'<script>执行代码</script> & 真实说明',bundleItems:[{key:'revision-aigc',title:'额度 <svg onload=alert(1)>',quantity:5}]});
  const mounted=mountRevisionBundleOffers({container:s.root,fetchOptions:async()=>response(catalogue([p]))});await settle();
  const card=s.root.querySelector('[data-revision-bundle="bundle-reduce"]');assert.equal(card.querySelector('h3').textContent,p.title);assert.match(card.textContent,/<script>执行代码<\/script>/);assert.match(card.textContent,/<svg onload=alert\(1\)>/);
  assert.equal(card.querySelector('script,img,[onload],[onerror]'),null);assert.equal(card.querySelector('a').getAttribute('href'),'#membership/pay?product=bundle-reduce');mounted.dispose();
 }finally{s.close();}
});

test('unpublished specialist cards use the shared detail route rather than a separate modal or a payment action',async()=>{
 const s=setup('membership');try{
  let calls=0;const mounted=mountRevisionBundleOffers({container:s.root,modal:()=>calls++});await settle();
  const links=[...s.root.querySelectorAll('[data-revision-bundle] a.btn')];
  assert.deepEqual(links.map(link=>link.getAttribute('href')),['#membership/checkout?kind=bundle&plan=rewrite&quantity=1','#membership/checkout?kind=bundle&plan=reduce&quantity=1','#membership/checkout?kind=bundle&plan=dual&quantity=1']);
  assert.ok(links.every(link=>link.textContent.includes('查看套餐详情')));assert.equal(s.root.querySelector('button[data-revision-bundle-details]'),null);assert.equal(calls,0);assert.equal(s.requests.length,1);assert.equal(s.w.localStorage.length,0);noPayment(s.root);mounted.dispose();
 }finally{s.close();}
});

test('network and malformed catalogue failures keep three cards with an honest unavailable-information state',async()=>{
 const cases=[async()=>{throw Error('Offline');},async()=>({ok:false}),async()=>response({products:[]}),async()=>response({products:'bad',channels:[]}),async()=>({ok:true,json:async()=>{throw Error('Invalid JSON');}})];
 for(const fetchOptions of cases){const s=setup();try{const mounted=mountRevisionBundleOffers({container:s.root,fetchOptions});await settle();assert.equal(s.root.querySelectorAll('[data-revision-bundle-state="failed"]').length,3);assert.match(s.root.querySelector('[role="status"]').textContent,/商品信息暂未取得/);noPayment(s.root);mounted.dispose();}finally{s.close();}}
});

test('dispose aborts and prevents a late catalogue from repainting a new route',async()=>{
 const s=setup();try{
  let finish,requestSignal;const mounted=mountRevisionBundleOffers({container:s.root,fetchOptions:async(_url,request)=>{requestSignal=request.signal;return new Promise(resolve=>finish=resolve);}});await settle();
  mounted.dispose();mounted.dispose();s.w.document.querySelector('.dashboard').innerHTML='<h1>新的个人服务页面</h1>';finish(response(catalogue([product()])));await settle();assert.equal(requestSignal.aborted,true);assert.equal(s.w.document.querySelector('.dashboard').textContent,'新的个人服务页面');
 }finally{s.close();}
});

test('navigation away and back cannot revive an older request even if abort is ignored',async()=>{
 const s=setup();try{
  let finish,requestSignal;const mounted=mountRevisionBundleOffers({container:s.root,fetchOptions:async(_url,request)=>{requestSignal=request.signal;return new Promise(resolve=>finish=resolve);}});await settle();
  s.w.history.replaceState(null,'','#assets');s.w.dispatchEvent(new s.w.HashChangeEvent('hashchange'));
  s.w.history.replaceState(null,'','#category/reduce');s.w.dispatchEvent(new s.w.HashChangeEvent('hashchange'));
  finish(response(catalogue([product()])));await settle();assert.equal(requestSignal.aborted,true);noPayment(s.root);mounted.dispose();
 }finally{s.close();}
});

test('a new mount of the same root replaces the previous request and owns the published result',async()=>{
 const s=setup();try{
  let oldFinish,newFinish,oldSignal;const oldMount=mountRevisionBundleOffers({container:s.root,fetchOptions:async(_url,request)=>{oldSignal=request.signal;return new Promise(resolve=>oldFinish=resolve);}});await settle();
  const nextMount=mountRevisionBundleOffers({container:s.root,fetchOptions:async()=>new Promise(resolve=>newFinish=resolve)});await settle();assert.equal(oldSignal.aborted,true);
  newFinish(response(catalogue([product('bundle-reduce',{title:'新请求商品'})])));await settle();oldFinish(response(catalogue([product('bundle-dual',{title:'旧请求商品'})])));await settle();
  assert.match(s.root.textContent,/新请求商品/);assert.doesNotMatch(s.root.textContent,/旧请求商品/);assert.equal(s.root.querySelectorAll('[data-revision-bundle-state="published"]').length,1);oldMount.dispose();nextMount.dispose();
 }finally{s.close();}
});

test('replacing an entire specialist article preserves focus on its matching shared offer without touching a neighbouring form',async()=>{
 const s=setup('membership');try{
  let finish;const mounted=mountRevisionBundleOffers({container:s.root,fetchOptions:async()=>new Promise(resolve=>finish=resolve)});await settle();
  const original=s.root.querySelector('[data-commerce-offer="bundle:bundle-dual"]');original.focus();assert.equal(s.w.document.activeElement,original);
  finish(response(catalogue([product()])));await settle();
  const updated=s.root.querySelector('[data-commerce-offer="bundle:bundle-dual"]');assert.notEqual(updated,original);assert.equal(s.w.document.activeElement,updated);assert.equal(updated.getAttribute('href'),'#membership/pay?product=bundle-dual');assert.equal(s.w.document.querySelector('textarea').value,'用户手工正文');mounted.dispose();
 }finally{s.close();}
});

test('external abort and detached roots prevent late JSON results from exposing checkout',async()=>{
 for(const mode of ['abort','detached']){
  const s=setup();try{
   const controller=new AbortController();let finishJson,requestSignal;const mounted=mountRevisionBundleOffers({container:s.root,signal:controller.signal,fetchOptions:async(_url,request)=>{requestSignal=request.signal;return {ok:true,json:()=>new Promise(resolve=>finishJson=resolve)};}});await settle();
   if(mode==='abort')controller.abort();else s.root.remove();
   finishJson(catalogue([product()]));await settle();noPayment(s.root);if(mode==='abort')assert.equal(requestSignal.aborted,true);mounted.dispose();
  }finally{s.close();}
 }
});

test('timeout is bounded, aborts the read and prevents late success from overwriting failure',async()=>{
 const s=setup();try{
  let timeout,finish,requestSignal,seenDelay;
  s.w.setTimeout=(callback,delay)=>{timeout=callback;seenDelay=delay;return 712;};s.w.clearTimeout=()=>{};
  const mounted=mountRevisionBundleOffers({container:s.root,timeoutMs:25,fetchOptions:async(_url,request)=>{requestSignal=request.signal;return new Promise(resolve=>finish=resolve);}});await settle();assert.equal(seenDelay,25);timeout();
  assert.equal(requestSignal.aborted,true);assert.equal(s.root.querySelectorAll('[data-revision-bundle-state="failed"]').length,3);finish(response(catalogue([product()])));await settle();noPayment(s.root);assert.equal(s.root.querySelectorAll('[data-revision-bundle-state="failed"]').length,3);mounted.dispose();
 }finally{s.close();}
});

test('an already aborted view starts no catalogue read and an absent root is a safe no-op',async()=>{
 const s=setup();try{
  const controller=new AbortController();controller.abort();const mounted=mountRevisionBundleOffers({container:s.root,signal:controller.signal});await settle();assert.equal(s.requests.length,0);noPayment(s.root);mounted.dispose();assert.doesNotThrow(()=>mountRevisionBundleOffers().dispose());
 }finally{s.close();}
});

test('specialist and research bundles use the same card structure, grid classes and responsive purchase styles',async()=>{
 const s=setup('membership');try{
  const rendererRoot=s.w.document.createElement('div');rendererRoot.innerHTML=bundlePreviewCard({id:'reading',name:'文献研读套餐',audience:'研读资料',features:['文献解读'],description:'科研辅助规划',priceCents:990,price:9.9,durationDays:90,totalUses:1});
  const researchCard=rendererRoot.querySelector('article'),specialCard=s.root.querySelector('[data-revision-bundle]');
  for(const card of [researchCard,specialCard]){
   assert.ok(card.classList.contains('purchase-plan'));assert.ok(card.classList.contains('commerce-center-plan'));assert.ok(card.classList.contains('commerce-center-plan-bundle'));
   for(const selector of ['.commerce-center-plan-cover','.purchase-plan-top','.purchase-status','.purchase-price','.commerce-center-plan-body','.commerce-center-feature-label','ul','.btn.full','.commerce-center-plan-footnote'])assert.ok(card.querySelector(selector),selector);
  }
  assert.ok(s.root.classList.contains('commerce-center-section'));assert.ok(s.root.querySelector('.purchase-plans.commerce-center-plan-grid'));
  assert.equal(s.root.querySelector('.revision-bundle-card,.revision-bundle-card-content,.revision-bundle-art,.revision-bundle-price'),null);
  const css=await readFile(new URL('../dist/workspace/commerce-center.css',import.meta.url),'utf8');assert.match(css,/commerce-center-plan-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);assert.match(css,/@(?:media|container)[\s\S]*commerce-center-plan-grid[\s\S]*grid-template-columns:minmax\(0,1fr\)/);
  assert.ok(Object.isFrozen(revisionBundlePlans));assert.deepEqual(revisionBundlePlans.map(plan=>plan.id),['rewrite','reduce','dual']);
  assert.ok(revisionBundlePlans.every(plan=>plan.features.length&&Object.isFrozen(plan.features)&&!('price' in plan)&&!('priceCents' in plan)));
  assert.doesNotMatch(revisionBundlePlans.flatMap(plan=>plan.features).join(' '),/旗舰版查重|AIGC 检测|自动复测|保证|\d+ 次/);
 }finally{s.close();}
});
