import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderOnlinePersonal,onlineUsageSummary,publicFeedbackStatus,personalServiceState} from '../dist/workspace/online-personal-services.mjs';
import {feedbackKey} from '../dist/workspace/help-model.mjs';
import {membershipPurchaseTiles} from '../dist/workspace/membership-summary.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function setup(api,hash='#help?scope=account'){
 const dom=new JSDOM('<main id="view"></main>',{url:'http://localhost/workspace.html'+hash});
 for(const key of ['window','document','location','localStorage'])globalThis[key]=dom.window[key];
 let pending,remembered=0;const notices=[];
 const ctx={target:document.querySelector('#view'),api,notify:text=>notices.push(text),submit:(event,fn)=>{event.preventDefault();pending=Promise.resolve().then(fn).catch(error=>notices.push(error.message));},rememberForms:()=>remembered++,esc:escape,date:value=>value||'—',icon:()=>'', $:selector=>document.querySelector(selector)};
 return {dom,ctx,notices,remembered:()=>remembered,async submit(){document.querySelector('#feedback-form').dispatchEvent(new window.Event('submit',{cancelable:true}));await pending;},async click(selector){document.querySelector(selector).click();await pending;}};
}
test('usage separates account cumulative totals, recent unknown tokens and storage from billing',async()=>{
 const env=setup(async path=>path==='/usage'?{items:[{model:'real-model',input_tokens:5,output_tokens:null,created_at:'2026-10-15'}]}:{usage:{records:120,inputTokens:2000,outputTokens:1000},storage:{fileBytes:1048576,draftBytes:0,maxAccountFileBytes:52428800,maxAccountDraftBytes:52428800}});
 try{assert.equal(await renderOnlinePersonal('usage',env.ctx),true);const text=env.ctx.target.textContent;assert.doesNotMatch(text,/real-model|未返回模型名/);assert.match(text,/AI 服务调用明细/);assert.match(text,/120/);assert.match(text,/2,000/);assert.match(text,/未知/);assert.match(text,/50.00 MB/);assert.match(text,/当前未启用积分扣减/);assert.equal(env.ctx.target.querySelector('a[href*="membership/pay"]'),null);assert.deepEqual(onlineUsageSummary([{input_tokens:3,output_tokens:2},{input_tokens:null,output_tokens:4}]),{records:2,inputTokens:3,outputTokens:6,unknownRecords:1});}finally{env.dom.window.close();}
});
test('account membership uses actual service state and existing entitlements without starting purchase',async()=>{
 const calls=[],env=setup(async(path,data)=>{calls.push([path,data]);return path==='/capabilities'?{ai:true,agent:false,payment:true}:path==='/payments/entitlements'?{items:[{type:'membership',title:'真实已有权益',description:'<img src=x>',starts_at:'2020-01-01',expires_at:'2099-01-01'}]}:{counts:{projects:2,drafts:3,results:4,files:5}};},'#membership?scope=account');
 try{await renderOnlinePersonal('membership',env.ctx);assert.match(env.ctx.target.textContent,/真实已有权益/);assert.match(env.ctx.target.textContent,/学术润色已开放/);assert.match(env.ctx.target.textContent,/科研智能助手未配置/);assert.equal(env.ctx.target.querySelector('img[src="x"]'),null);assert.equal(env.ctx.target.querySelector('a[href*="membership/pay"]'),null);assert.equal(calls.every(([,data])=>data===undefined),true);assert.match(env.ctx.target.textContent,/本地草稿不会自动上传/);}finally{env.dom.window.close();}
});
test('account credits and ledger come from server records and escape titles without changing local content',async()=>{
 const env=setup(async path=>path==='/payments/entitlements'?{items:[],credits:{balance:700,ledger:[{orderId:'order/one',title:'<img src=x>',amount:500,createdAt:'2026-10-16'}]}}:path==='/capabilities'?{payment:false,ai:false}:{counts:{projects:99}},'#membership?scope=account');
 try{
  localStorage.setItem('paperknow-drafts','[{"title":"private local draft"}]');
  await renderOnlinePersonal('membership',env.ctx);
  const credit=document.querySelector('.member-purchase-credits');
  assert.equal(credit.querySelector('h2').textContent,'700');
  assert.equal(document.querySelector('.member-credit-increase').textContent,'+500');
  assert.match(document.querySelector('.member-credit-ledger').textContent,/<img src=x>/);
  assert.equal(document.querySelector('img[src="x"]'),null);
  assert.ok(document.querySelector('a[href="#membership/pay?order=order%2Fone"]'));
  assert.match(localStorage.getItem('paperknow-drafts'),/private local draft/);
  assert.match(env.ctx.target.textContent,/未完成付款不入账/);
 }finally{env.dom.window.close();}
});

test('missing credit data stays unknown rather than fabricated zero balance',async()=>{
 const env=setup(async path=>path==='/payments/entitlements'?{items:[]}:path==='/capabilities'?{}:{counts:{}},'#membership?scope=account');
 try{await renderOnlinePersonal('membership',env.ctx);assert.equal(document.querySelector('.member-purchase-credits h2').textContent,'—');assert.match(document.querySelector('.member-credit-ledger').textContent,/积分记录暂不可用/);}finally{env.dom.window.close();}
});

test('account packages are independent paid records with escaped titles, bought quantities and no consumption claims',async()=>{
 const calls=[],bundles=[{orderId:'paid/package-1',productId:'bundle-real',title:'已购套餐 <img src=x>',description:'购买时说明 <script>private</script>',startsAt:'2020-01-01',expiresAt:'2099-01-01',items:[{key:'review',title:'文献研读 <img src=x>',quantity:3},{key:'invalid',title:'待核对项目',quantity:-1}]}];
 const env=setup(async(path,data)=>{calls.push([path,data]);return path==='/payments/entitlements'?{items:[{type:'bundle',title:'不能当作会员',starts_at:'2020-01-01',expires_at:'2099-01-01'}],bundles,credits:{balance:200,ledger:[]}}:path==='/capabilities'?{}:{counts:{}};},'#membership?scope=account');
 try{localStorage.setItem('paperknow-drafts','[{"title":"私人草稿不变"}]');await renderOnlinePersonal('membership',env.ctx);const section=document.querySelector('.member-bundle-records'),record=section.querySelector('.member-bundle-record');assert.equal(record.querySelector('h3').textContent,bundles[0].title);assert.equal(record.querySelector('.member-bundle-description').textContent,bundles[0].description);assert.match(record.textContent,/生效时间2020-01-01/);assert.match(record.textContent,/到期时间2099-01-01/);assert.match(record.textContent,/文献研读 <img src=x>包含 3 次/);assert.match(record.textContent,/待核对项目包含 — 次/);assert.match(section.textContent,/实际已用与预占次数/);assert.match(section.textContent,/预占 — · 剩余 —/);assert.equal(document.querySelector('img[src="x"]'),null);assert.equal(document.querySelector('script'),null);assert.equal(document.querySelectorAll('.account-entitlement').length,0);assert.equal(document.querySelector('.member-purchase-member h2').textContent,'免费使用');assert.equal(document.querySelector('.member-purchase-bundles h2').textContent,'1 份已购套餐');assert.ok(record.querySelector('a[href="#membership/pay?order=paid%2Fpackage-1"]'));assert.ok(calls.every(([,data])=>data===undefined));assert.match(localStorage.getItem('paperknow-drafts'),/私人草稿不变/);}finally{env.dom.window.close();}
});

test('membership tile ignores bundle and credit entitlement rows even when they expire later',()=>{
 const env=setup(async()=>({}));try{env.ctx.target.innerHTML=membershipPurchaseTiles({account:true,items:[{type:'bundle',title:'套餐不是会员',starts_at:'2020-01-01',expires_at:'2199-01-01'},{type:'credits',title:'积分不是会员',starts_at:'2020-01-01',expires_at:'2199-01-01'},{type:'membership',title:'真实会员 <b>标题</b>',starts_at:'2020-01-01',expires_at:'2099-01-01'}],bundles:[{orderId:'real-order'}]});assert.equal(document.querySelector('.member-purchase-member h2').textContent,'真实会员 <b>标题</b>');assert.equal(document.querySelector('.member-purchase-member h2 b'),null);assert.equal(document.querySelector('.member-purchase-bundles h2').textContent,'1 份已购套餐');}finally{env.dom.window.close();}
});

test('empty account packages show no invented services or purchased counts',async()=>{
 const env=setup(async path=>path==='/payments/entitlements'?{items:[],bundles:[]}:path==='/capabilities'?{}:{counts:{}},'#membership?scope=account');try{await renderOnlinePersonal('membership',env.ctx);assert.match(document.querySelector('.member-bundle-records').textContent,/暂无已购套餐/);assert.equal(document.querySelectorAll('.member-bundle-record').length,0);assert.equal(document.querySelector('.member-purchase-bundles h2').textContent,'0 份已购套餐');assert.equal(document.querySelector('.member-bundle-records a[href*="membership/pay"]'),null);assert.equal(localStorage.length,0);}finally{env.dom.window.close();}
});

test('feedback shows only public status, escapes research text and refresh preserves unsubmitted input',async()=>{
 let reads=0;const env=setup(async()=>({items:[{id:'f-1',category:'功能问题',body:'<script>研究问题</script>',status:++reads===1?'processing':'resolved',created_at:'2026-10-15',updated_at:'2026-10-16',note:'不应公开的后台备注'}]}));
 try{await renderOnlinePersonal('help',env.ctx);assert.match(env.ctx.target.textContent,/处理中/);assert.doesNotMatch(env.ctx.target.textContent,/不应公开/);assert.equal(env.ctx.target.querySelector('script'),null);document.querySelector('#feedback').value='尚未提交的输入';await env.click('#feedback-refresh');assert.equal(document.querySelector('#feedback').value,'尚未提交的输入');assert.match(document.querySelector('#feedback-records').textContent,/已处理/);assert.equal(publicFeedbackStatus('invalid'),'待处理');}finally{env.dom.window.close();}
});
test('account support copies the configured WeChat without sending feedback or changing unsent input',async()=>{
 const calls=[],copied=[],env=setup(async(path,data)=>{calls.push([path,data]);return {items:[]};});
 try{
  Object.defineProperty(env.dom.window.navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied.push(text);}}});
  await renderOnlinePersonal('help',env.ctx);
  document.querySelector('#feedback').value='这段问题仍未提交';
  document.querySelector('#feedback-category').value='体验建议';
  const support=document.querySelector('.personal-feedback-support'),button=support.querySelector('[data-copy-support-wechat]');
  assert.equal(support.querySelector('a').getAttribute('href'),'mailto:contact@oneshowailab.com');
  assert.equal(button.type,'button');assert.equal(button.closest('form'),null);
  assert.match(support.textContent,/OneShowAILab/);assert.match(support.textContent,/在微信中搜索并添加/);
  assert.equal(support.querySelector('a[href^="weixin:"]'),null);
  await button.onclick();
  assert.deepEqual(copied,['OneShowAILab']);assert.match(support.querySelector('[role="status"]').textContent,/微信号已复制/);
  assert.equal(document.querySelector('#feedback').value,'这段问题仍未提交');assert.equal(document.querySelector('#feedback-category').value,'体验建议');
  assert.equal(calls.length,1);assert.equal(calls[0][1],undefined);assert.equal(env.remembered(),0);assert.equal(localStorage.length,0);
 }finally{env.dom.window.close();}
});
test('account support reports clipboard denial and absence accurately with a manual WeChat fallback',async()=>{
 const env=setup(async()=>({items:[]}));
 try{
  await renderOnlinePersonal('help',env.ctx);document.querySelector('#feedback').value='复制失败也保留输入';
  const button=document.querySelector('[data-copy-support-wechat]'),status=document.querySelector('[data-support-copy-status]');
  Object.defineProperty(env.dom.window.navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}});
  await button.onclick();assert.match(status.textContent,/复制未成功，请手动复制微信号：OneShowAILab/);assert.doesNotMatch(status.textContent,/已复制/);assert.equal(button.disabled,false);
  Object.defineProperty(env.dom.window.navigator,'clipboard',{configurable:true,value:undefined});
  await button.onclick();assert.match(status.textContent,/手动复制微信号：OneShowAILab/);assert.equal(document.querySelector('#feedback').value,'复制失败也保留输入');assert.equal(env.remembered(),0);
 }finally{env.dom.window.close();}
});
test('successful feedback remains confirmed when status refresh fails and never resubmits automatically',async()=>{
 const calls=[],item={id:'f-real',category:'功能问题',body:'保存不成功，需要检查',status:'open',created_at:'2026-10-15'};
 const env=setup(async(path,data)=>{calls.push([path,data]);if(data)return {id:item.id,item};if(calls.length>1)throw Error('offline');return {items:[]};});
 try{await renderOnlinePersonal('help',env.ctx);document.querySelector('#feedback').value=item.body;await env.submit();assert.match(document.querySelector('#feedback-submit-status').textContent,/反馈已提交，编号 f-real/);assert.match(document.querySelector('#feedback-records').textContent,/保存不成功/);assert.match(document.querySelector('#feedback-list-status').textContent,/暂时无法刷新/);assert.equal(document.querySelector('#feedback').value,'');assert.equal(env.remembered(),1);assert.equal(calls.filter(([,data])=>data).length,1);}finally{env.dom.window.close();}
});
test('failed feedback keeps input and draft carry requires explicit route and a second submit',async()=>{
 let posts=0;const env=setup(async(path,data)=>{if(data){posts++;throw Error('暂时无法提交');}return {items:[]};},'#help?scope=account&draft=local');
 try{localStorage.setItem(feedbackKey,JSON.stringify({type:'体验建议',feature:'设置与备份',content:'明确选择的本地反馈草稿'}));await renderOnlinePersonal('help',env.ctx);assert.equal(posts,0);assert.equal(document.querySelector('#feedback').value,'明确选择的本地反馈草稿');assert.equal(document.querySelector('#feedback-category').value,'体验建议');await env.submit();assert.equal(posts,1);assert.equal(document.querySelector('#feedback').value,'明确选择的本地反馈草稿');assert.equal(env.remembered(),0);assert.match(localStorage.getItem(feedbackKey),/本地反馈草稿/);assert.match(env.notices.join(''),/暂时无法提交/);}finally{env.dom.window.close();}
});
test('local feedback is never read into account without explicit draft route',async()=>{
 const env=setup(async()=>({items:[]}));try{localStorage.setItem(feedbackKey,JSON.stringify({content:'其他使用者留在浏览器的反馈'}));await renderOnlinePersonal('help',env.ctx);assert.equal(document.querySelector('#feedback').value,'');assert.equal(await renderOnlinePersonal('projects',env.ctx),false);}finally{env.dom.window.close();}
});
test('feedback input is frozen only during save and restored after failure',async()=>{
 let rejectSave;const env=setup(async(path,data)=>data?new Promise((_,reject)=>{rejectSave=reject;}):{items:[]});
 try{await renderOnlinePersonal('help',env.ctx);document.querySelector('#feedback').value='发送中的反馈';const saving=env.submit();await Promise.resolve();await Promise.resolve();assert.equal(document.querySelector('#feedback').disabled,true);assert.equal(document.querySelector('#feedback-category').disabled,true);rejectSave(Error('暂时无法保存'));await saving;assert.equal(document.querySelector('#feedback').disabled,false);assert.equal(document.querySelector('#feedback-category').disabled,false);assert.equal(document.querySelector('#feedback').value,'发送中的反馈');}finally{env.dom.window.close();}
});
test('expired account sessions propagate to the workspace login handler without rendering private content',async()=>{
 const expired=Object.assign(Error('登录已过期'),{status:401}),env=setup(async()=>{throw expired;});
 try{await assert.rejects(renderOnlinePersonal('membership',env.ctx),error=>error.status===401);assert.equal(env.ctx.target.textContent,'');}finally{env.dom.window.close();}
});

test('membership shows authoritative credit balance, availability, holds and releases without inventing returned credits',async()=>{
 const ledger=[{id:'r1',kind:'reserve',title:'学术润色',amount:0,heldDelta:12,jobId:'job-1',createdAt:'2026-10-16'},{id:'r2',kind:'release',title:'学术润色',amount:0,heldDelta:-12,jobId:'job-1',createdAt:'2026-10-16'},{id:'s1',kind:'settle',title:'导师意见修改',amount:-8,heldDelta:-8,jobId:'job-2',createdAt:'2026-10-16'}];
 const env=setup(async path=>path==='/payments/entitlements'?{items:[],credits:{balance:192,available:180,held:12,ledger},billing:{reservations:[{jobId:'job-1',type:'polish',source:'credits',creditCost:12,status:'released',updatedAt:'2026-10-16'},{jobId:'job-2',type:'review',source:'credits',creditCost:8,status:'settled',updatedAt:'2026-10-16'}]}}:path==='/capabilities'?{}:{counts:{}},'#membership?scope=account');
 try{await renderOnlinePersonal('membership',env.ctx);const text=document.querySelector('.member-credit-ledger').textContent;assert.match(text,/账户余额192/);assert.match(text,/当前可用180/);assert.match(text,/任务预占12/);const amounts=[...document.querySelectorAll('.member-credit-ledger tbody tr td:nth-child(2)')].map(element=>element.textContent);assert.deepEqual(amounts,['0预占 +12','0预占 -12','-8预占 -8']);assert.doesNotMatch(text,/\+12预占 -12/);assert.match(document.querySelector('.member-billing-activity').textContent,/已释放/);assert.match(document.querySelector('.member-billing-activity').textContent,/已结算/);assert.equal(document.querySelector('.member-credit-decrease').textContent,'-8预占 -8');}finally{env.dom.window.close();}
});

test('real membership and bundle quotas show used held and remaining with account-only service actions',async()=>{
 const membershipUsage=[{key:'polish',title:'会员润色 <img src=x>',quantity:5,used:2,held:1,remaining:2}],bundleUsage=[{key:'agent',title:'智能研究任务',quantity:3,used:1,held:0,remaining:2}];
 const env=setup(async path=>path==='/payments/entitlements'?{items:[{order_id:'member-live',type:'membership',title:'已购会员',starts_at:'2020-01-01',expires_at:'2099-01-01',usage:membershipUsage}],bundles:[{orderId:'bundle-live',title:'真实已购套餐',startsAt:'2020-01-01',expiresAt:'2099-01-01',items:[{key:'agent',title:'原始购买内容',quantity:3}]}],billing:{membershipUsage:{'member-live':membershipUsage},bundleUsage:{'bundle-live':bundleUsage},reservations:[]}}:path==='/capabilities'?{ai:true,agent:true}:{counts:{}},'#membership?scope=account');
 try{await renderOnlinePersonal('membership',env.ctx);assert.match(document.querySelector('.account-entitlement').textContent,/包含 5 次 · 已用 2 · 预占 1 · 剩余 2/);assert.match(document.querySelector('.member-bundle-record').textContent,/包含 3 次 · 已用 1 · 预占 0 · 剩余 2/);assert.ok([...document.querySelectorAll('.account-entitlement a')].some(link=>link.getAttribute('href')==='#tool/polish'));assert.ok([...document.querySelectorAll('.member-bundle-record a')].some(link=>link.getAttribute('href')==='#tool/agent'));assert.equal(document.querySelector('img[src="x"]'),null);assert.doesNotMatch(env.ctx.target.textContent,/消费扣减尚未接入|当前积分消耗服务尚未开放/);}finally{env.dom.window.close();}
});

test('usage state reflects billing enabled while keeping token counts separate from actual settlement history',async()=>{
 const env=setup(async path=>path==='/usage'?{items:[],billingEnabled:true,billing:{reservations:[{type:'agent',source:'membership',creditCost:0,status:'held',createdAt:'2026-10-16'}]}}:{usage:{records:0,inputTokens:0,outputTokens:0},storage:{}});
 try{await renderOnlinePersonal('usage',env.ctx);assert.match(env.ctx.target.textContent,/已启用费用核验/);assert.match(env.ctx.target.textContent,/Token 用量不直接等于积分费用/);assert.doesNotMatch(env.ctx.target.textContent,/当前未启用积分扣减/);const activity=document.querySelector('.member-billing-activity');assert.match(activity.textContent,/科研智能助手会员次数1 次预占中/);assert.ok(activity.querySelector('a[href="#tasks?scope=account"]'));}finally{env.dom.window.close();}
});


test('paused and unavailable services do not appear ready or expose a use action for purchased quotas',async()=>{
 const capabilities={ai:true,agent:true,billing:{services:[{key:'polish',mode:'disabled',available:true},{key:'review',mode:'paid',available:true},{key:'agent',mode:'free',available:false}]}};
 const env=setup(async path=>path==='/payments/entitlements'?{items:[{order_id:'member-1',type:'membership',title:'已有会员',starts_at:'2020-01-01',expires_at:'2099-01-01',usage:[{key:'polish',title:'学术润色',quantity:3,used:0,held:0,remaining:3},{key:'review',title:'导师意见修改',quantity:2,used:0,held:0,remaining:2}]}],bundles:[{orderId:'bundle-1',title:'已有套餐',startsAt:'2020-01-01',expiresAt:'2099-01-01',items:[{key:'agent',title:'智能助手',quantity:1,used:0,held:0,remaining:1}]}]}:path==='/capabilities'?capabilities:{counts:{}},'#membership?scope=account');
 try{await renderOnlinePersonal('membership',env.ctx);assert.match(env.ctx.target.textContent,/学术润色已暂停/);assert.match(env.ctx.target.textContent,/导师意见修改已开放/);assert.match(env.ctx.target.textContent,/科研智能助手待配置/);const links=[...document.querySelectorAll('.member-quota-rows a')].map(link=>link.getAttribute('href'));assert.deepEqual(links,['#tool/review']);assert.match(document.querySelector('.member-bundle-record').textContent,/剩余 1/);assert.equal(document.querySelectorAll('.member-bundle-record .member-quota-rows a').length,0);}finally{env.dom.window.close();}
});


test('account summary distinguishes spendable credits from held credits without inventing availability',()=>{
 const env=setup(async()=>({}));try{
  env.ctx.target.innerHTML=membershipPurchaseTiles({account:true,credits:{balance:200,available:180,held:20},items:[{type:'membership',title:'真实会员',starts_at:'2020-01-01',expires_at:'2099-01-01'}]});
  const tile=document.querySelector('.member-purchase-credits');assert.equal(tile.querySelector('h2').textContent,'180');assert.match(tile.textContent,/可用科研积分/);assert.match(tile.querySelector('p').textContent,/账户余额 200 · 任务预占 20/);assert.match(document.querySelector('.member-purchase-member p').textContent,/2099/);
  env.ctx.target.innerHTML=membershipPurchaseTiles({account:true,credits:{balance:200,held:20}});assert.equal(document.querySelector('.member-purchase-credits h2').textContent,'200');assert.match(document.querySelector('.member-purchase-credits').textContent,/可用额与预占额待核对/);assert.doesNotMatch(document.querySelector('.member-purchase-credits .member-purchase-kicker').textContent,/可用科研积分/);assert.equal(localStorage.length,0);
 }finally{env.dom.window.close();}
});

test('feedback list failures keep the real submit form and support available without claiming the list is empty',async()=>{
 let reads=0,posts=0;const item={id:'recover-1',category:'使用咨询',body:'记录读取失败时仍需提供反馈入口',created_at:'2026-10-16',status:'open'};
 const env=setup(async(_,data)=>{if(data){posts++;return {id:item.id,item};}if(++reads===1)throw Error('offline');return {items:[item]};});
 try{await renderOnlinePersonal('help',env.ctx);assert.ok(document.querySelector('#feedback-form'));assert.match(document.querySelector('#feedback-records').textContent,/暂时无法读取/);assert.doesNotMatch(document.querySelector('#feedback-records').textContent,/还没有提交过反馈/);assert.match(document.querySelector('.personal-feedback-support').textContent,/OneShowAILab/);document.querySelector('#feedback').value=item.body;await env.submit();assert.equal(posts,1);assert.match(document.querySelector('#feedback-records').textContent,/记录读取失败时仍需提供反馈入口/);assert.match(document.querySelector('#feedback-submit-status').textContent,/已提交/);}finally{env.dom.window.close();}
});

test('a stale feedback refresh cannot erase a newly confirmed submission',async()=>{
 let reads=0,finishRefresh;const item={id:'new-1',category:'功能问题',body:'新的反馈应当保留',created_at:'2026-10-16',status:'open'};
 const env=setup(async(_,data)=>{if(data)return {id:item.id,item};if(++reads===2)return new Promise(resolve=>{finishRefresh=resolve;});return {items:reads===1?[]:[item]};});
 try{await renderOnlinePersonal('help',env.ctx);document.querySelector('#feedback').value=item.body;const refreshing=env.click('#feedback-refresh');await Promise.resolve();await Promise.resolve();assert.equal(document.querySelector('#feedback-refresh').disabled,true);const saving=env.submit();await Promise.resolve();await Promise.resolve();assert.match(document.querySelector('#feedback-records').textContent,/新的反馈应当保留/);finishRefresh({items:[]});await Promise.all([refreshing,saving]);assert.match(document.querySelector('#feedback-records').textContent,/新的反馈应当保留/);assert.equal(document.querySelectorAll('.account-feedback-record').length,1);assert.equal(reads,3);}finally{env.dom.window.close();}
});

test('runtime-backed writing and item quotas remain usable when the legacy generic agent flag is off',async()=>{
 const quota=key=>({key,title:key,quantity:2,used:0,held:0,remaining:2});
 const rules=[{key:'literature-read',title:'文献解读',effectiveMode:'paid',effectiveCreditCost:10,available:true},{key:'presentation-thesis',title:'毕业 PPT',effectiveMode:'disabled',available:true}];
 const env=setup(async path=>path==='/payments/entitlements'?{items:[{order_id:'m',type:'membership',title:'真实会员',starts_at:'2020-01-01',expires_at:'2099-01-01',usage:[quota('agent'),quota('literature-read'),quota('presentation-thesis')]}]}:path==='/capabilities'?{ai:false,agent:false,thesis:{ready:true},tools:{ready:true},billing:{services:[{key:'agent',mode:'paid',available:true}]}}:path==='/payments/options'?{toolBilling:{services:rules}}:{counts:{}},'#membership?scope=account');
 try{await renderOnlinePersonal('membership',env.ctx);assert.match(env.ctx.target.textContent,/AI 写作与科研工具已开放/);assert.match(env.ctx.target.textContent,/毕业 PPT已暂停/);const links=[...document.querySelectorAll('.member-quota-rows a')].map(node=>node.getAttribute('href'));assert.deepEqual(links,['#category/writing','#category/literature?view=reading']);assert.equal(document.querySelector('a[href*="view=agent"]'),null);assert.equal(document.querySelector('a[href="#literature/reading"]'),null);}finally{env.dom.window.close();}
});

test('missing token measurements never become a claimed zero consumption total',async()=>{
 const env=setup(async path=>path==='/usage'?{items:[{input_tokens:null,output_tokens:null,created_at:'2026-10-19'}]}:{usage:{records:1,inputTokens:0,outputTokens:0,unknownRecords:1},storage:{}});
 try{await renderOnlinePersonal('usage',env.ctx);const metric=[...document.querySelectorAll('.account-personal-metric')].find(node=>node.textContent.includes('Token 用量'));assert.equal(metric.querySelector('h2').textContent,'未知');assert.match(metric.textContent,/不代表实际全部消耗/);assert.deepEqual(onlineUsageSummary([{input_tokens:null,output_tokens:null}]),{records:1,inputTokens:null,outputTokens:null,unknownRecords:1});}finally{env.dom.window.close();}
});

test('partial known token totals are marked partial while a confirmed empty account may show zero',async()=>{
 for(const partial of [true,false]){const env=setup(async path=>path==='/usage'?{items:partial?[{input_tokens:25,output_tokens:null}]:[]}:{usage:{records:partial?1:0,inputTokens:partial?25:0,outputTokens:0,unknownRecords:partial?1:0},storage:{}});try{await renderOnlinePersonal('usage',env.ctx);const metric=[...document.querySelectorAll('.account-personal-metric')].find(node=>node.textContent.includes('Token 用量'));assert.equal(metric.querySelector('h2').textContent,partial?'25（已知部分）':'0');}finally{env.dom.window.close();}}
});

test('credit and task tables keep all records but size their scroll window to the first five measured rows',async()=>{
 const ledger=Array.from({length:7},(_,i)=>({title:'积分记录 '+i,amount:-10,kind:'settle',createdAt:'2026-10-19'})),reservations=Array.from({length:7},(_,i)=>({title:'任务 '+i,type:'agent',source:'credits',creditCost:10,status:'settled'}));
 const env=setup(async path=>path==='/payments/entitlements'?{items:[],credits:{balance:100,available:100,held:0,ledger},billing:{reservations}}:path==='/capabilities'?{}:{counts:{}},'#membership?scope=account');let measure,disconnected=false;const disposers=[];
 try{env.dom.window.ResizeObserver=class{constructor(callback){measure=callback;}observe(){}disconnect(){disconnected=true;}};env.ctx.onDispose=dispose=>disposers.push(dispose);await renderOnlinePersonal('membership',env.ctx);const lists=[...document.querySelectorAll('.member-record-scroll')];assert.equal(lists.length,2);for(const list of lists){const table=list.querySelector('table');assert.equal(table.tBodies[0].rows.length,7);table.getBoundingClientRect=()=>({top:40});table.tBodies[0].rows[4].getBoundingClientRect=()=>({bottom:260});Object.defineProperty(list,'offsetHeight',{value:12});Object.defineProperty(list,'clientHeight',{value:10});assert.equal(list.getAttribute('tabindex'),'0');}measure();for(const list of lists)assert.equal(list.style.maxHeight,'222px');disposers.forEach(dispose=>dispose());assert.equal(disconnected,true);}finally{env.dom.window.close();}
});

test('malformed local feedback is preserved and reported instead of silently imported as an empty draft',async()=>{
 for(const raw of ['[]','null','{"content":55}','{"content":"'+('字'.repeat(3001))+'"}']){const env=setup(async()=>({items:[]}),'#help?scope=account&draft=local');try{localStorage.setItem(feedbackKey,raw);await renderOnlinePersonal('help',env.ctx);assert.equal(document.querySelector('#feedback').value,'');assert.match(document.querySelector('#feedback-submit-status').textContent,/草稿暂时无法读取/);assert.equal(localStorage.getItem(feedbackKey),raw);assert.equal(env.remembered(),0);}finally{env.dom.window.close();}}
});

test('an explicit account-change feedback error is propagated rather than shown as a transient list failure',async()=>{
 const error=Object.assign(Error('account changed'),{status:409,code:'ACCOUNT_CHANGED'}),env=setup(async()=>{throw error;});try{await assert.rejects(renderOnlinePersonal('help',env.ctx),value=>value.code==='ACCOUNT_CHANGED');assert.equal(document.querySelector('#feedback-form'),null);}finally{env.dom.window.close();}
});


const degreeQuotaRoutes=['junior','bachelor','master','doctor'].flatMap(level=>[['thesis','writing'],['proposal','proposal'],['taskbook','taskbook'],['literature-review','summary']].map(([service,tool])=>({key:service+'-'+level,href:'#tool/'+tool+'?level='+level+'&new=package-'+service+'-'+level,runtime:service==='thesis'?'thesis':'writing'})));
test('all sixteen degree quotas require their own real runtime and exact service rule',()=>{
 assert.equal(degreeQuotaRoutes.length,16);assert.equal(new Set(degreeQuotaRoutes.map(item=>item.key)).size,16);
 for(const item of degreeQuotaRoutes){
  const rule={key:item.key,effectiveMode:'paid',available:true},cap={ai:true,agent:true,tools:{ready:true},thesis:{ready:true},writing:{ready:true},toolBilling:{services:[rule]}};
  assert.deepEqual(personalServiceState(cap,item.key),{ready:true,label:'已开放'});
  assert.equal(personalServiceState({...cap,[item.runtime]:{ready:false}},item.key).ready,false);
  assert.equal(personalServiceState({...cap,toolBilling:{services:[{...rule,effectiveMode:'disabled'}]}},item.key).label,'已暂停');
  assert.equal(personalServiceState({...cap,toolBilling:{services:[{...rule,available:false}]}},item.key).ready,false);
  assert.equal(personalServiceState({...cap,toolBilling:{services:[]}},item.key).ready,false);
 }
});

test('purchased degree and detection quotas link to all exact services only when ready with available quota',async()=>{
 const routes=[...degreeQuotaRoutes,{key:'detection-similarity',href:'#category/detection?view=web',runtime:'webSimilarity'},{key:'detection-aigc',href:'#category/aigc?view=detection',runtime:'aigcDetection'}],items=routes.map(item=>({key:item.key,title:item.key,quantity:2,used:0,held:0,remaining:2}));
 for(const scenario of ['ready','runtime-off','paused','unavailable','exhausted','expired','future']){
  const capabilities={ai:false,agent:false,tools:{ready:false},...Object.fromEntries(['thesis','writing','webSimilarity','aigcDetection'].map(key=>[key,{ready:scenario!=='runtime-off'}])),toolBilling:{services:routes.map(item=>({key:item.key,effectiveMode:scenario==='paused'?'disabled':item.key.startsWith('detection-')?'free':'paid',available:scenario!=='unavailable'}))}};
  const bundle={orderId:'degree-quota-'+scenario,title:'已购真实学位与检测服务',startsAt:scenario==='future'?'2098-01-01':'2020-01-01',expiresAt:scenario==='expired'?'2021-01-01':'2099-01-01',items:items.map(item=>({...item,remaining:scenario==='exhausted'?0:2}))},calls=[];
  const env=setup(async(path,data)=>{calls.push({path,data});return path==='/payments/entitlements'?{items:[],bundles:[bundle]}:path==='/capabilities'?capabilities:path==='/payments/options'?{toolBilling:capabilities.toolBilling}:{counts:{}};},'#membership?scope=account');
  try{await renderOnlinePersonal('membership',env.ctx);const links=[...document.querySelectorAll('.member-bundle-record .member-quota-rows a')].map(link=>link.getAttribute('href'));assert.deepEqual(links,scenario==='ready'?routes.map(item=>item.href):[],scenario);assert.equal(document.querySelectorAll('.member-bundle-record .member-quota-rows li').length,18);assert.ok(calls.every(call=>call.data===undefined));assert.equal(localStorage.length,0);}finally{env.dom.window.close();}
 }
});


test('purchased polish and review allowances open their actual modern editor when only the Agent runtime is ready',async()=>{
 const cap={ai:false,tools:{ready:true},billing:{services:['polish','review'].map(key=>({key,mode:'paid',available:true}))}};
 const env=setup(async path=>path==='/payments/entitlements'?{items:[{order_id:'modern-member',type:'membership',title:'研究会员',starts_at:'2020-01-01',expires_at:'2099-01-01',usage:['polish','review'].map(key=>({key,title:key,quantity:2,used:0,held:0,remaining:2}))}],bundles:[]}:path==='/capabilities'?cap:{counts:{}},'#membership?scope=account');
 try{await renderOnlinePersonal('membership',env.ctx);const links=[...document.querySelectorAll('.member-quota-rows a')].map(link=>link.getAttribute('href'));assert.deepEqual(links,['#tool/polish','#tool/review']);}finally{env.dom.window.close();}
});
