import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {esc,icon} from '../dist/workspace/ui.mjs';
import {toolBanner} from '../dist/workspace/tool-banner.mjs';

const source=(await readFile(new URL('../dist/workspace/payment.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const products=[{id:'credits-100',title:'100 研究币',priceCents:1000,currency:'CNY',description:'用于已开放的账户服务。',entitlement:{type:'credits',quantity:100}},{id:'credits-300',title:'300 研究币',priceCents:2500,currency:'CNY',description:'以正式商品说明为准。',entitlement:{type:'credits',quantity:300}}];
const channels=[{provider:'wechat',label:'微信支付',ready:true},{provider:'alipay',label:'支付宝',ready:true}];
const bundleServices=[{key:'detection',title:'论文检测',quantity:2},{key:'revision',title:'文本修改',quantity:3}];
const bundleProduct={id:'bundle-research',title:'研究服务套餐',priceCents:9900,currency:'CNY',description:'已发布的套餐说明',entitlementType:'bundle',durationDays:30,bundleItems:bundleServices,entitlement:{type:'bundle',durationDays:30,bundleItems:bundleServices}};
const memberProduct={id:'membership-basic',title:'研究会员',priceCents:2900,currency:'CNY',description:'已发布的会员说明',entitlementType:'membership',durationDays:45,entitlement:{type:'membership',durationDays:45}};
const qr='data:image/png;base64,dGVzdA==';
const response=(value,status=200)=>({ok:status<400,status,json:async()=>JSON.parse(JSON.stringify(value))});
async function settle(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}throw new Error('Payment UI did not settle');}
async function fixture(t,{guest=false,catalogue={enabled:true,channels,products},items=[],order:orderOverride={},onRequest,orderId,renderQRCode,initialProductId='credits-100',preferredProvider}={}){
 const dom=new JSDOM('<aside id="preserved">原有导航</aside><main class="dashboard"></main>',{url:'https://paperknow.cn/workspace.html#membership/pay',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 const timers=new Map();let nextTimer=1,clockOffset=0;
 w.setTimeout=(fn,delay)=>{const id=nextTimer++;timers.set(id,{fn,delay});return id;};w.clearTimeout=id=>timers.delete(id);
 const realNow=w.Date.now;w.Date.now=()=>realNow()+clockOffset;
 const calls=[],qrInputs=[],navigations=[],created=[];let cleanups=[];
 const order={id:'o1',outTradeNo:'PK20261015001',title:'100 研究币',amountCents:1000,currency:'CNY',provider:'wechat',status:'pending',qrContent:'weixin://wxpay/bizpayurl?pr=actual-provider-qr',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+15*60*1000).toISOString(),...orderOverride};
 w.esc=esc;w.icon=icon;w.toolBanner=toolBanner;
 w.fetch=async(path,options={})=>{const body=options.body?JSON.parse(options.body):undefined;calls.push({path,options,body});const custom=onRequest&&await onRequest(path,options,body);if(custom)return custom;if(path==='/api/auth/me')return guest?response({error:'请登录'},401):response({user:{id:'u1'}});if(path==='/api/payments/options')return response(catalogue);if(path==='/api/orders'&&!body)return response({items});if(path==='/api/orders'&&body){const item={...order,provider:body.provider};created.push(item);return response({item});}if(path==='/api/orders/o1')return response({item:order});if(path==='/api/orders/o1/query')return response({item:order});throw new Error('Unexpected API '+path);};
 w.eval(source+'\nwindow.paymentTest={renderPaymentCheckout,renderPaymentOrders};');
 const args={productId:initialProductId,orderId,provider:preferredProvider,container:w.document.querySelector('.dashboard'),navigate:href=>navigations.push(href),renderQRCode:async value=>{qrInputs.push(value);return renderQRCode?renderQRCode(value):qr;}};
 const cleanup=await w.paymentTest.renderPaymentCheckout(args);cleanups.push(cleanup);
 t.after(()=>{cleanups.forEach(clean=>clean());w.close();});
 return {w,doc:w.document,calls,qrInputs,navigations,created,order,timers,cleanup,args,async orders(){const clean=await w.paymentTest.renderPaymentOrders(args);cleanups.push(clean);return clean;},async remount(){const clean=await w.paymentTest.renderPaymentCheckout(args);cleanups.push(clean);return clean;},advance(ms){clockOffset+=ms;},async runTimer(delay){const entry=[...timers].find(([,timer])=>timer.delay===delay);if(!entry)return false;timers.delete(entry[0]);await entry[1].fn();await new Promise(resolve=>setTimeout(resolve,3));return true;}};
}
const click=(f,selector)=>{const button=f.doc.querySelector(selector);assert.ok(button,'Missing '+selector);button.click();};

test('guest sees an account login link and cannot create a local or demo order',async t=>{
 const f=await fixture(t,{guest:true});assert.match(f.doc.body.textContent,/登录后查看账户与支付订单/);const link=new URL(f.doc.querySelector('.payment-empty a').href);assert.equal(link.pathname,'/auth.html');assert.equal(link.searchParams.get('next'),'/workspace.html#membership/pay');assert.equal(f.calls.some(call=>call.path==='/api/orders'),false);assert.equal(f.doc.querySelector('#preserved').textContent,'原有导航');assert.equal(f.w.localStorage.length,0);
});

test('empty published catalogue stays closed even when payment channels are ready',async t=>{
 const f=await fixture(t,{catalogue:{enabled:true,channels,products:[]}});assert.match(f.doc.body.textContent,/可购服务正在准备中/);assert.match(f.doc.body.textContent,/当前不会创建付款订单/);assert.equal(f.doc.querySelector('[data-payment-create]'),null);assert.equal(f.doc.querySelector('.payment-channel-preview'),null);assert.doesNotMatch(f.doc.body.textContent,/微信支付|支付宝/);assert.equal(f.calls.some(call=>call.body),false);
});

test('unconfigured channels never enable checkout and no arbitrary price is accepted',async t=>{
 for(const catalogue of [{enabled:false,channels,products},{enabled:true,channels:channels.map(channel=>({...channel,ready:false})),products}]){const f=await fixture(t,{catalogue});assert.equal(f.doc.querySelector('[data-payment-create]'),null);assert.equal(f.doc.querySelectorAll('[data-payment-provider]').length,0);assert.match(f.doc.body.textContent,/当前暂停收款/);assert.doesNotMatch(f.doc.body.textContent,/微信支付|支付宝|暂未开通/);assert.equal(f.calls.some(call=>call.body),false);}
});

test('only the enabled ready supported provider is shown and selected when no preference was supplied',async t=>{
 const available=[{provider:'wechat',ready:false},{provider:'alipay',ready:true},{provider:'unknown',ready:true},null];const f=await fixture(t,{catalogue:{enabled:true,channels:available,products}});assert.deepEqual([...f.doc.querySelectorAll('[data-payment-provider]')].map(button=>button.dataset.paymentProvider),['alipay']);assert.equal(f.doc.querySelector('[data-payment-provider="alipay"]').getAttribute('aria-pressed'),'true');assert.doesNotMatch(f.doc.querySelector('.payment-selection').textContent,/微信支付|暂未开通/);click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));assert.equal(f.calls.find(call=>call.body?.productId).body.provider,'alipay');
});

test('an explicitly closed preferred provider requires choosing an available method instead of switching silently',async t=>{
 const f=await fixture(t,{preferredProvider:'wechat',catalogue:{enabled:true,channels:[{provider:'wechat',ready:false},{provider:'alipay',ready:true}],products}});assert.equal(f.doc.querySelector('[data-payment-provider="wechat"]'),null);assert.equal(f.doc.querySelector('[data-payment-provider][aria-pressed="true"]'),null);assert.equal(f.doc.querySelector('[data-payment-create]').disabled,true);assert.match(f.doc.querySelector('[data-payment-notice]').textContent,/原付款方式当前不可用/);assert.match(f.doc.querySelector('.payment-summary').textContent,/请选择可用方式/);assert.doesNotMatch(f.doc.body.textContent,/微信支付/);await f.doc.querySelector('[data-payment-create]').onclick();assert.equal(f.calls.some(call=>call.body?.productId),false);click(f,'[data-payment-provider="alipay"]');assert.equal(f.doc.querySelector('[data-payment-create]').disabled,false);click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));assert.equal(f.calls.find(call=>call.body?.productId).body.provider,'alipay');
});

test('checkout preserves selected Alipay and displays server credit quantity and price',async t=>{
 const credit={id:'credits-200',title:'200 科研积分',priceCents:2000,currency:'CNY',description:'科研积分充值',entitlementType:'credits',creditAmount:200,entitlement:{type:'credits',creditAmount:200}};
 const f=await fixture(t,{initialProductId:'credits-200',preferredProvider:'alipay',catalogue:{enabled:true,channels,products:[credit]}});
 assert.equal(f.doc.querySelector('[data-payment-provider="alipay"]').getAttribute('aria-pressed'),'true');
 assert.match(f.doc.querySelector('.payment-summary').textContent,/200 科研积分/);
 assert.match(f.doc.querySelector('.payment-total').textContent,/¥20.00/);
 assert.equal(f.calls.some(call=>call.body),false);
});

test('membership and bundle checkout retain real validity and service counts on both payment providers',async t=>{
 for(const product of [memberProduct,bundleProduct])for(const provider of ['wechat','alipay']){
  const f=await fixture(t,{initialProductId:product.id,preferredProvider:provider,catalogue:{enabled:true,channels,products:[product]},order:{title:product.title,amountCents:product.priceCents,entitlementType:product.entitlementType,durationDays:product.durationDays,bundleItems:product.bundleItems}});
  const summary=f.doc.querySelector('.payment-summary');assert.match(summary.textContent,new RegExp(`${product.durationDays} 天`));assert.match(summary.textContent,new RegExp(product.entitlementType==='bundle'?'套餐有效期':'会员有效期'));
  if(product.entitlementType==='bundle'){assert.match(summary.textContent,/论文检测× 2/);assert.match(summary.textContent,/文本修改× 3/);assert.match(summary.textContent,/有效期内总次数/);}
  click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));const request=f.calls.find(call=>call.body?.productId);assert.equal(request.body.productId,product.id);assert.equal(request.body.provider,provider);assert.deepEqual(Object.keys(request.body).sort(),['idempotencyKey','productId','provider']);assert.match(f.doc.querySelector('.payment-order-summary').textContent,new RegExp(`${product.durationDays} 天`));assert.equal(f.w.localStorage.length,0);
 }
});

test('unconfigured channels block membership and bundle order creation even through the handler',async t=>{
 for(const product of [memberProduct,bundleProduct]){const f=await fixture(t,{initialProductId:product.id,catalogue:{enabled:false,channels:channels.map(c=>({...c,ready:false})),products:[product]}});assert.equal(f.doc.querySelector('[data-payment-create]'),null);assert.equal(f.calls.some(call=>call.body),false);assert.equal(f.doc.querySelectorAll('[data-payment-provider]').length,0);assert.match(f.doc.body.textContent,/当前暂停收款/);}
});

test('an existing order keeps its original payment channel and remains queryable after all new purchase methods close',async t=>{
 const f=await fixture(t,{orderId:'o1',catalogue:{enabled:false,channels:channels.map(channel=>({...channel,ready:false})),products},order:{provider:'wechat'}});assert.ok(f.doc.querySelector('[data-payment-qr] img'));assert.match(f.doc.querySelector('.payment-scan-instruction').textContent,/微信支付/);assert.equal(f.doc.querySelectorAll('[data-payment-provider]').length,0);click(f,'[data-payment-query]');await settle(()=>f.doc.querySelector('[data-payment-notice]').textContent.includes('尚未支付'));assert.ok(f.calls.some(call=>call.path==='/api/orders/o1/query'));assert.equal(f.calls.some(call=>call.body?.productId),false);assert.equal(f.w.localStorage.length,0);
});

test('requested membership and bundle checkout show only that SKU while the generic directory retains all choices',async t=>{
 const catalogue={enabled:true,channels,products:[...products,memberProduct,bundleProduct]};
 for(const [product,back] of [[memberProduct,'#membership/plans'],[bundleProduct,'#membership/bundles']]){const f=await fixture(t,{initialProductId:product.id,catalogue});assert.equal(f.doc.querySelectorAll('[data-payment-product]').length,1);assert.equal(f.doc.querySelector('[data-payment-product]').dataset.paymentProduct,product.id);assert.equal(f.doc.querySelector('[data-payment-reselect]').getAttribute('href'),back);assert.equal(f.doc.querySelectorAll('[data-payment-provider]').length,2);assert.equal(f.doc.querySelector('[data-payment-create]').disabled,false);assert.equal(f.calls.some(call=>call.body),false);}
 const directory=await fixture(t,{initialProductId:null,catalogue});assert.equal(directory.doc.querySelectorAll('[data-payment-product]').length,catalogue.products.length);assert.equal(directory.doc.querySelector('[data-payment-reselect]'),null);assert.equal(directory.calls.some(call=>call.body),false);
});

test('paid bundle snapshots show bought counts and lead to account packages without confusing QR expiry',async t=>{
 const f=await fixture(t,{initialProductId:bundleProduct.id,orderId:'o1',catalogue:{enabled:true,channels,products:[bundleProduct]},order:{status:'paid',title:'购买时套餐名称',entitlementType:'bundle',durationDays:30,bundleItems:[{key:'unsafe',title:'项目 <img src=x onerror=alert(1)>',quantity:4}],amountCents:9900}});
 const details=f.doc.querySelector('.payment-order-summary');assert.match(details.textContent,/服务套餐/);assert.match(details.textContent,/套餐有效期30 天/);assert.match(details.textContent,/项目 <img src=x onerror=alert\(1\)>× 4/);assert.equal(details.querySelector('img'),null);assert.doesNotMatch(details.textContent,/二维码有效至/);assert.equal(details.querySelector('a[href="#membership?scope=account"]').textContent,'查看账户已购套餐');assert.equal(f.calls.some(call=>call.body?.productId),false);assert.equal(f.w.localStorage.length,0);
});

test('payment order history labels membership, credits and bundles from server order types',async t=>{
 const items=['membership','credits','bundle'].map((type,i)=>({id:'type-'+i,title:'真实订单',status:'paid',entitlementType:type,amountCents:2000,provider:i%2?'alipay':'wechat',createdAt:new Date().toISOString()}));const f=await fixture(t,{items});await f.orders();assert.deepEqual([...f.doc.querySelectorAll('.payment-history-main p')].map(p=>p.textContent.split(' · ')[0]),['会员订阅','科研积分','服务套餐']);assert.equal(f.calls.some(call=>call.body),false);
});

test('withdrawn requested product never silently switches to a different service',async t=>{
 const f=await fixture(t,{initialProductId:'withdrawn-product'});
 assert.equal(f.doc.querySelector('[data-payment-create]').disabled,true);
 assert.match(f.doc.querySelector('[data-payment-notice]').textContent,/所选商品暂不可购买/);
 assert.equal(f.doc.querySelector('[data-payment-product][aria-pressed="true"]'),null);
 assert.equal(f.calls.some(call=>call.body),false);
});

test('order creation sends only product, provider and idempotency key; server amount drives QR view',async t=>{
 const f=await fixture(t,{order:{amountCents:890}});click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));const request=f.calls.find(call=>call.path==='/api/orders'&&call.body);assert.deepEqual(Object.keys(request.body).sort(),['idempotencyKey','productId','provider']);assert.equal(request.body.productId,'credits-100');assert.equal(request.body.provider,'wechat');assert.match(request.body.idempotencyKey,/^[a-f0-9-]{36}$/);assert.match(f.doc.querySelector('.payment-order-summary').textContent,/¥8.90/);assert.equal(f.qrInputs[0],f.order.qrContent);assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.cache,'no-store');assert.equal(f.w.localStorage.length,0);
});

test('provider and product switches are reflected in the selected server identifiers',async t=>{
 const f=await fixture(t,{initialProductId:null});click(f,'[data-payment-provider="alipay"]');click(f,'[data-payment-product="credits-300"]');assert.equal(f.doc.querySelector('[data-payment-provider="alipay"]').getAttribute('aria-pressed'),'true');click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));const request=f.calls.find(call=>call.body?.productId);assert.equal(request.body.provider,'alipay');assert.equal(request.body.productId,'credits-300');assert.match(f.doc.querySelector('.payment-scan-instruction').textContent,/支付宝/);
});

test('network retry reuses the same idempotency key and ignores double clicks',async t=>{
 let attempts=0;const f=await fixture(t,{onRequest:async(path,options,body)=>{if(path==='/api/orders'&&body&&++attempts===1)throw new Error('网络暂不可用');}});click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-notice]').textContent.includes('网络暂不可用'));click(f,'[data-payment-create]');click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));const requests=f.calls.filter(call=>call.body?.productId);assert.equal(requests.length,2);assert.equal(requests[0].body.idempotencyKey,requests[1].body.idempotencyKey);
});

test('only the provider query response can transition pending payment to paid',async t=>{
 let paid=false;const f=await fixture(t,{onRequest:async path=>path==='/api/orders/o1/query'?response({item:{id:'o1',title:'100 研究币',amountCents:1000,status:paid?'paid':'pending',provider:'wechat',qrContent:'weixin://wxpay/bizpayurl?pr=test',expiresAt:new Date(Date.now()+600000).toISOString()}}):null});click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));assert.equal(f.doc.querySelector('.payment-status').textContent,'待支付');click(f,'[data-payment-query]');await settle(()=>f.doc.querySelector('[data-payment-notice]').textContent.includes('尚未支付'));assert.equal(f.doc.querySelector('.payment-status').textContent,'待支付');paid=true;click(f,'[data-payment-query]');await settle(()=>f.doc.querySelector('.is-paid'));assert.equal(f.doc.querySelector('[data-payment-qr] img'),null);assert.match(f.doc.body.textContent,/付款结果已经服务器核验/);assert.equal([...f.timers.values()].some(timer=>timer.delay===5000),false);
});

test('hidden documents pause polling; resumed documents restart it; cleanup removes all timers',async t=>{
 const f=await fixture(t);click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));assert.equal(await f.runTimer(5000),true);const queries=f.calls.filter(call=>call.path.endsWith('/query')).length;Object.defineProperty(f.doc,'hidden',{value:true,configurable:true});f.doc.dispatchEvent(new f.w.Event('visibilitychange'));assert.equal(await f.runTimer(5000),false);assert.equal(f.calls.filter(call=>call.path.endsWith('/query')).length,queries);Object.defineProperty(f.doc,'hidden',{value:false,configurable:true});f.doc.dispatchEvent(new f.w.Event('visibilitychange'));assert.equal(await f.runTimer(5000),true);f.cleanup();assert.equal(f.timers.size,0);
});

test('closing a payment window preserves server order semantics without fake cancellation',async t=>{
 const f=await fixture(t);click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));click(f,'[data-payment-back]');assert.equal(f.doc.querySelector('[data-payment-qr]'),null);assert.match(f.doc.querySelector('[data-payment-notice]').textContent,/尚未支付的订单仍可/);assert.equal(f.calls.some(call=>/cancel|close/.test(call.path)),false);assert.equal([...f.timers.values()].some(timer=>timer.delay===5000),false);click(f,'[data-payment-provider="alipay"]');click(f,'[data-payment-create]');await settle(()=>f.created.length===2);const requests=f.calls.filter(call=>call.body?.productId);assert.notEqual(requests[0].body.idempotencyKey,requests[1].body.idempotencyKey);
});

test('expired QR is removed locally without fabricating server expiry or success',async t=>{
 const f=await fixture(t,{order:{expiresAt:new Date(Date.now()+4000).toISOString()}});click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));f.advance(5000);await f.runTimer(1000);await settle(()=>f.doc.querySelector('.is-expired'));assert.equal(f.doc.querySelector('[data-payment-qr] img'),null);assert.match(f.doc.body.textContent,/二维码已过期/);assert.equal(f.order.status,'pending');assert.ok(f.doc.querySelector('[data-payment-query]'));assert.equal([...f.timers.values()].some(timer=>timer.delay===5000),false);
});

test('late create results after channel switch cannot overwrite the new selection',async t=>{
 let resolveCreate;const f=await fixture(t,{onRequest:async(path,options,body)=>path==='/api/orders'&&body?new Promise(resolve=>resolveCreate=resolve):null});click(f,'[data-payment-create]');await settle(()=>resolveCreate);const signal=f.calls.find(call=>call.body?.productId).options.signal;click(f,'[data-payment-provider="alipay"]');assert.equal(signal.aborted,true);resolveCreate(response({item:f.order}));await new Promise(resolve=>setTimeout(resolve,4));assert.equal(f.doc.querySelector('[data-payment-qr]'),null);assert.equal(f.doc.querySelector('[data-payment-provider="alipay"]').getAttribute('aria-pressed'),'true');
});

test('late QR generation after close cannot replace the selection or revive polling',async t=>{
 let resolveQR;const f=await fixture(t,{renderQRCode:()=>new Promise(resolve=>resolveQR=resolve)});click(f,'[data-payment-create]');await settle(()=>resolveQR);click(f,'[data-payment-back]');resolveQR(qr);await new Promise(resolve=>setTimeout(resolve,4));assert.ok(f.doc.querySelector('[data-payment-create]'));assert.equal(f.doc.querySelector('[data-payment-qr]'),null);assert.equal([...f.timers.values()].some(timer=>timer.delay===5000),false);
});

test('late QR image cannot replace a server-confirmed paid state',async t=>{
 let resolveQR;const f=await fixture(t,{renderQRCode:()=>new Promise(resolve=>resolveQR=resolve),onRequest:async path=>path.endsWith('/query')?response({item:{id:'o1',title:'100 研究币',amountCents:1000,status:'paid',provider:'wechat',createdAt:new Date().toISOString()}}):null});click(f,'[data-payment-create]');await settle(()=>resolveQR);click(f,'[data-payment-query]');await settle(()=>f.doc.querySelector('.is-paid'));resolveQR(qr);await new Promise(resolve=>setTimeout(resolve,4));assert.equal(f.doc.querySelector('[data-payment-qr] img'),null);assert.ok(f.doc.querySelector('.payment-complete-icon'));assert.equal([...f.timers.values()].some(timer=>timer.delay===5000),false);
});

test('HTML-looking titles and QR content stay data; invalid QR image output is rejected',async t=>{
 const malicious='<img src=x onerror=alert(1)>';const f=await fixture(t,{catalogue:{enabled:true,channels,products:[{...products[0],title:malicious,description:'<script>alert(1)</script>'}]},order:{title:malicious,qrContent:malicious},renderQRCode:async()=>'<svg onload=alert(1)>'});assert.equal(f.doc.querySelector('img'),null);assert.equal(f.doc.querySelector('script'),null);assert.match(f.doc.querySelector('.payment-product-title').textContent,/<img/);click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-notice]')?.textContent.includes('二维码显示失败'));assert.equal(f.doc.querySelector('img'),null);assert.equal(f.doc.querySelector('script'),null);assert.equal(f.qrInputs[0],malicious);
});

test('auth expiry during provider query stops polling and restores login',async t=>{
 const f=await fixture(t,{onRequest:async path=>path.endsWith('/query')?response({error:'登录已过期'},401):null});click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));click(f,'[data-payment-query]');await settle(()=>f.doc.querySelector('.payment-empty a')?.href.includes('/auth.html'));assert.equal([...f.timers.values()].some(timer=>timer.delay===5000),false);assert.equal(f.doc.querySelector('[data-payment-qr]'),null);
});

test('order list uses account records and refreshes; continuing navigates to the saved order',async t=>{
 const f=await fixture(t,{items:[{id:'o1',outTradeNo:'PK2026',status:'pending',title:'真实订单 <b>标题</b>',amountCents:321,provider:'wechat',createdAt:new Date().toISOString()}]});await f.orders();assert.equal(f.doc.querySelectorAll('.payment-history-item').length,1);assert.equal(f.doc.querySelector('.payment-history-main h3 b'),null);assert.equal(f.doc.querySelector('.payment-history-state strong').textContent,'¥3.21');click(f,'[data-payment-order]');assert.deepEqual(f.navigations,['#membership/pay?order=o1']);click(f,'[data-orders-refresh]');await settle(()=>f.calls.filter(call=>call.path==='/api/orders'&&!call.body).length===2);assert.equal(f.calls.some(call=>call.body?.productId),false);
});

test('continuing a pending order reads its existing QR and never creates a duplicate',async t=>{
 const f=await fixture(t,{orderId:'o1'});assert.ok(f.doc.querySelector('[data-payment-qr] img'));assert.ok(f.calls.some(call=>call.path==='/api/orders/o1'));assert.equal(f.calls.some(call=>call.body?.productId),false);assert.equal(f.qrInputs[0],f.order.qrContent);
});

test('hash navigation and replacement mounts abort old requests and polling',async t=>{
 const f=await fixture(t);click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));await f.orders();assert.equal([...f.timers.values()].some(timer=>timer.delay===5000),false);await f.remount();click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));f.w.dispatchEvent(new f.w.HashChangeEvent('hashchange'));assert.equal(f.timers.size,0);
});


test('undeliverable published SKU cannot create an order even if a payment channel is ready',async t=>{
 const product={...products[0],purchasable:false,unavailableReason:'积分消费服务尚未开放，当前暂停充值。'};
 const f=await fixture(t,{initialProductId:product.id,catalogue:{enabled:true,channels,products:[product]}});
 assert.equal(f.doc.querySelector('[data-payment-create]').disabled,true);assert.match(f.doc.querySelector('[data-payment-notice]').textContent,/暂停充值/);
 f.doc.querySelector('[data-payment-create]').disabled=false;click(f,'[data-payment-create]');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls.some(call=>call.body?.productId),false);assert.equal(f.created.length,0);
});

function cashierOrder(overrides={}){
 const item={id:'o1',outTradeNo:'PK20261015001',title:'100 科研积分',provider:'alipay',status:'pending',amountCents:1000,currency:'CNY',qrContent:null,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+15*60*1000).toISOString(),...overrides};
 const url=new URL('https://openapi.alipay.com/gateway.do');
 const chinaTime=value=>new Date(Date.parse(value)+8*3600000).toISOString().slice(0,19).replace('T',' ');
 for(const [key,value]of Object.entries({app_id:'2026101600000001',method:'alipay.trade.page.pay',format:'JSON',charset:'utf-8',sign_type:'RSA2',timestamp:chinaTime(item.createdAt),version:'1.0',notify_url:'https://paperknow.cn/api/payments/notify/alipay',return_url:'https://paperknow.cn/api/payments/return/alipay?order='+encodeURIComponent(item.id),biz_content:JSON.stringify({out_trade_no:item.outTradeNo,product_code:'FAST_INSTANT_TRADE_PAY',total_amount:(item.amountCents/100).toFixed(2),subject:item.title,seller_id:'2088000000000000',time_expire:chinaTime(item.expiresAt)}),sign:Buffer.alloc(256,1).toString('base64')}))url.searchParams.set(key,value);
 return {...item,paymentUrl:url.href};
}

test('Alipay website checkout creates an order before offering an explicit official new-tab cashier action',async t=>{
 const item=cashierOrder();const f=await fixture(t,{preferredProvider:'alipay',order:item});let opens=0;f.w.open=()=>{opens++;};
 assert.match(f.doc.querySelector('[data-payment-create]').textContent,/创建支付宝付款订单/);assert.match(f.doc.querySelector('[data-payment-provider="alipay"]').textContent,/官方收银台/);assert.match(f.doc.querySelector('[data-payment-provider="wechat"]').textContent,/扫码支付/);
 assert.equal(f.calls.some(call=>call.body),false);click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-cashier]'));
 const link=f.doc.querySelector('[data-payment-cashier]');assert.equal(link.href,item.paymentUrl);assert.equal(link.textContent,'前往支付宝收银台');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');assert.equal(opens,0);assert.equal(f.qrInputs.length,0);assert.equal(f.doc.querySelector('[data-payment-qr] img'),null);assert.match(f.doc.querySelector('[data-payment-query]').textContent,/我已完成付款，查询结果/);assert.match(f.doc.querySelector('.payment-cashier-content').textContent,/打开支付宝收银台后付款/);assert.equal(f.doc.querySelector('.payment-status').textContent,'待支付');assert.ok([...f.timers.values()].some(timer=>timer.delay===5000));
});

test('official cashier return parameters never grant payment; only the order query can confirm and remove the handoff',async t=>{
 const item=cashierOrder();let paid=false;const f=await fixture(t,{orderId:'o1',order:item,onRequest:async path=>path==='/api/orders/o1/query'?response({item:{...item,status:paid?'paid':'pending'}}):null});
 f.w.history.replaceState(null,'','/workspace.html#membership/pay?order=o1&trade_status=TRADE_SUCCESS');
 assert.equal(f.doc.querySelector('.payment-status').textContent,'待支付');assert.ok(f.doc.querySelector('[data-payment-cashier]'));
 click(f,'[data-payment-query]');await settle(()=>f.doc.querySelector('[data-payment-notice]').textContent.includes('尚未支付'));assert.ok(f.doc.querySelector('[data-payment-cashier]'));assert.equal(f.doc.querySelector('.is-paid'),null);
 paid=true;click(f,'[data-payment-query]');await settle(()=>f.doc.querySelector('.is-paid'));assert.equal(f.doc.querySelector('[data-payment-cashier]'),null);assert.equal(f.qrInputs.length,0);assert.match(f.doc.body.textContent,/付款结果已经服务器核验/);assert.equal([...f.timers.values()].some(timer=>timer.delay===5000),false);assert.equal(f.w.localStorage.length,0);
});

test('unsafe or mismatched Alipay URLs never become navigable and cannot fall back to a QR',async t=>{
 const item=cashierOrder(),alter=(key,value)=>{const url=new URL(item.paymentUrl);url.searchParams.set(key,value);return url.href;},biz=JSON.parse(new URL(item.paymentUrl).searchParams.get('biz_content'));
 const attacks={
  script:'javascript:alert(1)',html:'<form action="https://evil.example">付款</form>',http:item.paymentUrl.replace('https:','http:'),lookalike:item.paymentUrl.replace('openapi.alipay.com','openapi.alipay.com.evil.example'),userinfo:item.paymentUrl.replace('https://','https://evil@'),fragment:item.paymentUrl+'#fake',wrongPath:item.paymentUrl.replace('/gateway.do?','/gateway.do/else?'),duplicateMethod:item.paymentUrl+'&method=alipay.trade.page.pay',unknownParameter:item.paymentUrl+'&redirect=https%3A%2F%2Fevil.example',wrongMethod:alter('method','alipay.trade.precreate'),wrongSignType:alter('sign_type','RSA'),wrongNotify:alter('notify_url','https://evil.example/notify'),wrongReturn:alter('return_url','https://paperknow.cn/api/payments/return/alipay?order=another'),extraReturn:alter('return_url','https://paperknow.cn/api/payments/return/alipay?order=o1&paid=true'),emptySign:alter('sign',''),duplicateAmount:alter('biz_content',JSON.stringify(biz).replace('"total_amount":"10.00"','"total_amount":"0.01","total_amount":"10.00"')),wrongAmount:alter('biz_content',JSON.stringify({...biz,total_amount:'0.01'})),wrongOrder:alter('biz_content',JSON.stringify({...biz,out_trade_no:'OTHER'})),wrongProduct:alter('biz_content',JSON.stringify({...biz,product_code:'FACE_TO_FACE_PAYMENT'})),wrongExpiry:alter('biz_content',JSON.stringify({...biz,time_expire:'2099-01-01 00:00:00'})),nestedPayload:alter('biz_content',JSON.stringify({...biz,subject:{html:'unsafe'}})),nonString:{url:item.paymentUrl}
 };
 for(const [name,paymentUrl]of Object.entries(attacks)){
  const f=await fixture(t,{orderId:'o1',order:{...item,paymentUrl,qrContent:'https://evil.example/should-not-be-a-qr'}});
  assert.equal(f.doc.querySelector('[data-payment-cashier]'),null,name);assert.equal(f.qrInputs.length,0,name);assert.equal(f.doc.querySelector('form,iframe,script'),null,name);assert.match(f.doc.querySelector('[data-payment-notice]').textContent,/入口校验未通过/,name);assert.equal(f.doc.querySelector('.is-paid'),null,name);assert.ok(f.doc.querySelector('[data-payment-query]'),name);
 }
});

test('historical Alipay scan orders retain their original QR without requiring the new cashier URL',async t=>{
 const f=await fixture(t,{orderId:'o1',order:{provider:'alipay',qrContent:'https://qr.alipay.com/old-confirmed-gateway-order'}});assert.equal(f.doc.querySelector('[data-payment-cashier]'),null);assert.ok(f.doc.querySelector('[data-payment-qr] img'));assert.equal(f.qrInputs[0],'https://qr.alipay.com/old-confirmed-gateway-order');assert.match(f.doc.querySelector('.payment-scan-instruction').textContent,/支付宝扫一扫/);assert.equal(f.calls.some(call=>call.body?.productId),false);
});

test('Alipay handoffs expire locally and a held link cannot be opened after its validity ends',async t=>{
 const item=cashierOrder({expiresAt:new Date(Date.now()+4000).toISOString()}),f=await fixture(t,{orderId:'o1',order:item}),link=f.doc.querySelector('[data-payment-cashier]');assert.ok(link);
 f.advance(5000);const event=new f.w.MouseEvent('click',{cancelable:true,bubbles:true});assert.equal(link.dispatchEvent(event),false);await settle(()=>f.doc.querySelector('.is-expired'));assert.equal(f.doc.querySelector('[data-payment-cashier]'),null);assert.match(f.doc.body.textContent,/付款入口已过期/);assert.ok(f.doc.querySelector('[data-payment-query]'));assert.equal(f.order.status,'pending');assert.equal([...f.timers.values()].some(timer=>timer.delay===5000),false);assert.equal(f.qrInputs.length,0);
});

test('paid and closed Alipay orders cannot expose saved cashier links',async t=>{
 for(const status of ['paid','closed','failed','expired','refunded']){const f=await fixture(t,{orderId:'o1',order:{...cashierOrder(),status}});assert.equal(f.doc.querySelector('[data-payment-cashier]'),null,status);assert.equal(f.qrInputs.length,0,status);assert.equal([...f.timers.values()].some(timer=>timer.delay===5000),false,status);}
});

test('cashier supports valid ten-digit merchant IDs and labels server-expired orders without a QR deadline',async t=>{
 const item=cashierOrder(),url=new URL(item.paymentUrl),biz=JSON.parse(url.searchParams.get('biz_content'));url.searchParams.set('biz_content',JSON.stringify({...biz,seller_id:'2088000000'}));
 const valid=await fixture(t,{orderId:'o1',order:{...item,paymentUrl:url.href}});assert.ok(valid.doc.querySelector('[data-payment-cashier]'));
 const expired=await fixture(t,{orderId:'o1',order:{...item,status:'expired',paymentUrl:null}});assert.equal(expired.doc.querySelector('[data-payment-cashier]'),null);assert.match(expired.doc.body.textContent,/订单已过期/);assert.match(expired.doc.querySelector('.payment-order-summary').textContent,/订单有效至/);assert.doesNotMatch(expired.doc.body.textContent,/二维码有效至/);assert.equal(expired.qrInputs.length,0);
});

test('cashier navigation cleanup disables saved actions and aborts a late order response',async t=>{
 const item=cashierOrder(),f=await fixture(t,{orderId:'o1',order:item}),link=f.doc.querySelector('[data-payment-cashier]');assert.ok(link);f.w.dispatchEvent(new f.w.HashChangeEvent('hashchange'));assert.equal(link.hasAttribute('href'),false);assert.equal(f.timers.size,0);
 let resolveCreate;const delayed=await fixture(t,{preferredProvider:'alipay',order:item,onRequest:async(path,options,body)=>path==='/api/orders'&&body?new Promise(resolve=>resolveCreate=resolve):null});click(delayed,'[data-payment-create]');await settle(()=>resolveCreate);const signal=delayed.calls.find(call=>call.body?.productId).options.signal;click(delayed,'[data-payment-provider="wechat"]');assert.equal(signal.aborted,true);resolveCreate(response({item}));await new Promise(resolve=>setTimeout(resolve,4));assert.equal(delayed.doc.querySelector('[data-payment-cashier]'),null);assert.equal(delayed.doc.querySelector('[data-payment-provider="wechat"]').getAttribute('aria-pressed'),'true');assert.equal(delayed.qrInputs.length,0);assert.equal([...delayed.timers.values()].some(timer=>timer.delay===5000),false);
});

function qrCashierOrder(overrides={}){
 const item=cashierOrder(overrides),url=new URL(item.paymentUrl),biz=JSON.parse(url.searchParams.get('biz_content'));
 url.searchParams.set('biz_content',JSON.stringify({...biz,qr_pay_mode:'4',qrcode_width:'244'}));url.searchParams.set('sign',Buffer.alloc(256,2).toString('base64'));
 return {...item,paymentQrUrl:url.href};
}

test('Alipay embeds its exact official QR view without generating a QR from the gateway URL',async t=>{
 const item=qrCashierOrder(),f=await fixture(t,{preferredProvider:'alipay',order:item});
 assert.match(f.doc.querySelector('[data-payment-notice]').textContent,/官方二维码/);click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-alipay-qr]'));
 const frame=f.doc.querySelector('[data-payment-alipay-qr]');assert.equal(frame.src,item.paymentQrUrl);assert.equal(frame.title,'支付宝官方付款二维码');assert.equal(frame.getAttribute('sandbox'),'allow-scripts allow-same-origin allow-forms');assert.equal(frame.getAttribute('referrerpolicy'),'no-referrer');assert.equal(frame.getAttribute('loading'),'eager');assert.equal(frame.width,'280');assert.equal(frame.height,'280');assert.equal(frame.hasAttribute('allow'),false);assert.equal(frame.hasAttribute('srcdoc'),false);assert.equal(f.doc.querySelector('[data-payment-cashier]').href,item.paymentUrl);assert.equal(f.qrInputs.length,0);assert.equal(f.doc.querySelector('[data-payment-qr] img'),null);assert.match(f.doc.querySelector('.payment-scan-instruction').textContent,/支付宝扫一扫/);assert.equal(f.doc.querySelector('.payment-status').textContent,'待支付');
});

test('an iframe load or forged message cannot confirm Alipay payment and unchanged polling preserves the frame',async t=>{
 const item=qrCashierOrder(),f=await fixture(t,{orderId:'o1',order:item}),frame=f.doc.querySelector('[data-payment-alipay-qr]');
 frame.dispatchEvent(new f.w.Event('load'));f.w.dispatchEvent(new f.w.MessageEvent('message',{origin:'https://openapi.alipay.com',data:{trade_status:'TRADE_SUCCESS',status:'paid',orderId:item.id}}));
 assert.match(f.doc.querySelector('[data-payment-frame-status]').textContent,/如未显示/);assert.equal(f.doc.querySelector('.is-paid'),null);assert.equal(f.calls.some(call=>call.path.endsWith('/query')),false);
 await f.runTimer(5000);assert.equal(f.doc.querySelector('[data-payment-alipay-qr]'),frame);assert.equal(frame.src,item.paymentQrUrl);assert.equal(f.doc.querySelector('.payment-status').textContent,'待支付');assert.equal(f.qrInputs.length,0);
});

test('the official QR loading timeout preserves a usable cashier fallback without changing payment state',async t=>{
 const f=await fixture(t,{orderId:'o1',order:qrCashierOrder()}),frame=f.doc.querySelector('[data-payment-alipay-qr]');await f.runTimer(12000);
 assert.match(f.doc.querySelector('[data-payment-frame-status]').textContent,/加载较慢或被浏览器拦截/);assert.ok(f.doc.querySelector('[data-payment-cashier]').href);assert.equal(f.doc.querySelector('[data-payment-alipay-qr]'),frame);assert.equal(f.doc.querySelector('.payment-status').textContent,'待支付');assert.equal(f.calls.some(call=>call.path.endsWith('/query')),false);
});

test('an official QR frame error removes the frame and leaves the official full cashier action',async t=>{
 const item=qrCashierOrder(),f=await fixture(t,{orderId:'o1',order:item}),frame=f.doc.querySelector('[data-payment-alipay-qr]');frame.dispatchEvent(new f.w.Event('error'));
 assert.equal(frame.hasAttribute('src'),false);assert.equal(frame.isConnected,false);assert.match(f.doc.querySelector('[data-payment-frame-status]').textContent,/暂时无法加载/);assert.equal(f.doc.querySelector('[data-payment-cashier]').href,item.paymentUrl);assert.equal(f.doc.querySelector('.payment-status').textContent,'待支付');assert.equal([...f.timers.values()].some(timer=>timer.delay===12000),false);
});

test('unsafe, mixed-merchant, or mismatched official QR URLs never enter a frame but retain the validated cashier',async t=>{
 const item=qrCashierOrder(),url=new URL(item.paymentQrUrl),biz=JSON.parse(url.searchParams.get('biz_content'));
 const alter=(key,value)=>{const changed=new URL(item.paymentQrUrl);changed.searchParams.set(key,value);return changed.href;},changeBiz=change=>alter('biz_content',JSON.stringify({...biz,...change}));
 const attacks={script:'javascript:alert(1)',html:'<iframe src="https://evil.example"></iframe>',http:item.paymentQrUrl.replace('https:','http:'),lookalike:item.paymentQrUrl.replace('openapi.alipay.com','openapi.alipay.com.evil.example'),userinfo:item.paymentQrUrl.replace('https://','https://evil@'),fragment:item.paymentQrUrl+'#paid',wrongPath:item.paymentQrUrl.replace('/gateway.do?','/other?'),extraParameter:item.paymentQrUrl+'&redirect=https://evil.example',duplicateMethod:item.paymentQrUrl+'&method=alipay.trade.page.pay',wrongMethod:alter('method','alipay.trade.precreate'),differentApp:alter('app_id','2026101600000002'),differentMerchant:changeBiz({seller_id:'2088000000000001'}),differentTitle:changeBiz({subject:'另一份商品'}),differentOrder:changeBiz({out_trade_no:'PKOTHER'}),differentAmount:changeBiz({total_amount:'0.01'}),differentExpiry:changeBiz({time_expire:'2099-01-01 00:00:00'}),differentTimestamp:alter('timestamp','2026-01-01 00:00:00'),wrongNotify:alter('notify_url','https://evil.example/notify'),wrongReturn:alter('return_url','https://paperknow.cn/api/payments/return/alipay?order=other'),wrongMode:changeBiz({qr_pay_mode:'2'}),wrongWidth:changeBiz({qrcode_width:'1000'}),numberMode:changeBiz({qr_pay_mode:4}),numberWidth:changeBiz({qrcode_width:244}),unknownBiz:changeBiz({redirect:'https://evil.example'}),emptySignature:alter('sign',''),nested:changeBiz({subject:{title:item.title}}),duplicateBiz:alter('biz_content',url.searchParams.get('biz_content').replace('"qr_pay_mode":"4"','"qr_pay_mode":"2","qr_pay_mode":"4"')),nonString:{url:item.paymentQrUrl}};
 for(const [name,paymentQrUrl]of Object.entries(attacks)){
  const f=await fixture(t,{orderId:'o1',order:{...item,paymentQrUrl,qrContent:'https://evil.example/should-never-encode'}});assert.equal(f.doc.querySelector('iframe,form,script'),null,name);assert.equal(f.doc.querySelector('[data-payment-cashier]').href,item.paymentUrl,name);assert.match(f.doc.querySelector('[data-payment-notice]').textContent,/二维码暂不可用/,name);assert.equal(f.qrInputs.length,0,name);assert.equal(f.doc.querySelector('.is-paid'),null,name);
 }
});

test('a QR URL without a valid full cashier URL cannot bypass strict payment URL validation',async t=>{
 const item=qrCashierOrder();for(const paymentUrl of [null,undefined,'https://evil.example/pay']){const f=await fixture(t,{orderId:'o1',order:{...item,paymentUrl,qrContent:'https://evil.example/should-never-encode'}});assert.equal(f.doc.querySelector('iframe,[data-payment-cashier]'),null);assert.equal(f.qrInputs.length,0);assert.match(f.doc.querySelector('[data-payment-notice]').textContent,/入口校验未通过/);}
});

test('a server-confirmed Alipay payment removes and disables the official QR frame and its cashier link',async t=>{
 const item=qrCashierOrder(),f=await fixture(t,{orderId:'o1',order:item,onRequest:async path=>path==='/api/orders/o1/query'?response({item:{...item,status:'paid'}}):null}),frame=f.doc.querySelector('[data-payment-alipay-qr]');
 click(f,'[data-payment-query]');await settle(()=>f.doc.querySelector('.is-paid'));assert.equal(frame.hasAttribute('src'),false);assert.equal(frame.isConnected,false);assert.equal(f.doc.querySelector('iframe,[data-payment-cashier]'),null);assert.equal([...f.timers.values()].some(timer=>[5000,12000].includes(timer.delay)),false);assert.equal(f.qrInputs.length,0);
});

test('local expiry, closing, and route cleanup remove the official QR frame source and loading timeout',async t=>{
 for(const action of ['expiry','close','hashchange','cleanup']){
  const item=qrCashierOrder({expiresAt:new Date(Date.now()+4000).toISOString()}),f=await fixture(t,{orderId:'o1',order:item}),frame=f.doc.querySelector('[data-payment-alipay-qr]');assert.ok(frame,action);
  if(action==='expiry'){f.advance(5000);await f.runTimer(1000);await settle(()=>f.doc.querySelector('.is-expired'));}else if(action==='close')click(f,'[data-payment-back]');else if(action==='hashchange')f.w.dispatchEvent(new f.w.HashChangeEvent('hashchange'));else f.cleanup();
  assert.equal(frame.hasAttribute('src'),false,action);assert.equal(frame.isConnected,false,action);assert.equal(f.doc.querySelector('[data-payment-alipay-qr]'),null,action);assert.equal([...f.timers.values()].some(timer=>timer.delay===12000),false,action);frame.dispatchEvent(new f.w.Event('load'));assert.equal(f.doc.querySelector('[data-payment-alipay-qr]'),null,action);
 }
});

test('a saved official QR view is never rendered for paid or other closed server states',async t=>{
 for(const status of ['paid','failed','closed','expired','refunded']){const f=await fixture(t,{orderId:'o1',order:qrCashierOrder({status})});assert.equal(f.doc.querySelector('iframe,[data-payment-cashier]'),null,status);assert.equal(f.qrInputs.length,0,status);assert.equal([...f.timers.values()].some(timer=>timer.delay===12000),false,status);}
});
