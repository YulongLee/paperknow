import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {esc,icon} from '../dist/workspace/ui.mjs';
import {toolBanner} from '../dist/workspace/tool-banner.mjs';

const source=(await readFile(new URL('../dist/workspace/payment.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const products=[{id:'credits-100',title:'100 研究币',priceCents:1000,currency:'CNY',description:'用于已开放的账户服务。',entitlement:{type:'credits',quantity:100}},{id:'credits-300',title:'300 研究币',priceCents:2500,currency:'CNY',description:'以正式商品说明为准。',entitlement:{type:'credits',quantity:300}}];
const channels=[{provider:'wechat',label:'微信支付',ready:true},{provider:'alipay',label:'支付宝',ready:true}];
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
 const f=await fixture(t,{catalogue:{enabled:true,channels,products:[]}});assert.match(f.doc.body.textContent,/可购服务正在准备中/);assert.match(f.doc.body.textContent,/当前不会创建付款订单/);assert.equal(f.doc.querySelector('[data-payment-create]'),null);assert.equal(f.calls.some(call=>call.body),false);
});

test('unconfigured channels never enable checkout and no arbitrary price is accepted',async t=>{
 const f=await fixture(t,{catalogue:{enabled:false,channels:channels.map(channel=>({...channel,ready:false})),products}});assert.equal(f.doc.querySelector('[data-payment-create]').disabled,true);assert.equal(f.doc.querySelectorAll('[data-payment-provider]:disabled').length,2);assert.match(f.doc.body.textContent,/暂未开放收款/);assert.equal(f.calls.some(call=>call.body),false);
});

test('checkout preserves selected Alipay and displays server credit quantity and price',async t=>{
 const credit={id:'credits-200',title:'200 科研积分',priceCents:2000,currency:'CNY',description:'科研积分充值',entitlementType:'credits',creditAmount:200,entitlement:{type:'credits',creditAmount:200}};
 const f=await fixture(t,{initialProductId:'credits-200',preferredProvider:'alipay',catalogue:{enabled:true,channels,products:[credit]}});
 assert.equal(f.doc.querySelector('[data-payment-provider="alipay"]').getAttribute('aria-pressed'),'true');
 assert.match(f.doc.querySelector('.payment-summary').textContent,/200 科研积分/);
 assert.match(f.doc.querySelector('.payment-total').textContent,/¥20.00/);
 assert.equal(f.calls.some(call=>call.body),false);
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
 const f=await fixture(t);click(f,'[data-payment-provider="alipay"]');click(f,'[data-payment-product="credits-300"]');assert.equal(f.doc.querySelector('[data-payment-provider="alipay"]').getAttribute('aria-pressed'),'true');click(f,'[data-payment-create]');await settle(()=>f.doc.querySelector('[data-payment-qr] img'));const request=f.calls.find(call=>call.body?.productId);assert.equal(request.body.provider,'alipay');assert.equal(request.body.productId,'credits-300');assert.match(f.doc.querySelector('.payment-scan-instruction').textContent,/支付宝/);
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
