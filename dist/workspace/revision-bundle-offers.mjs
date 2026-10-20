import {esc,icon} from './ui.mjs';
import {withStableView} from './view-stability.mjs';

// These identities preserve the owner's original catalogue. Pricing and usable
// quotas are read only from the current server catalogue, never from previews.
const plans=Object.freeze([
 Object.freeze({id:'bundle-rewrite',title:'强力查降套餐',tone:'blue',symbol:'pen',focus:'重复表达整理',description:'规划围绕重复表达整理、逐段改写与复核组织服务。'}),
 Object.freeze({id:'bundle-reduce',title:'超值降 AI 套餐',tone:'violet',symbol:'book',focus:'自然学术表达',description:'规划围绕句式调整、表达精修与逐段审核组织服务。'}),
 Object.freeze({id:'bundle-dual',title:'AIGC+重复率双降套餐',tone:'teal',symbol:'grid',focus:'组合修改与复核',description:'规划兼顾重复表达与语言自然度的组合修改服务。'})
]);
const mounts=new WeakMap();
const stateCopy={loading:'正在核对商品',unpublished:'尚未上架',unavailable:'暂不可购买',failed:'商品信息暂未取得'};
const hintCopy={loading:'实际价格、服务次数与有效期待核对。',unpublished:'服务项、次数、有效期和售价发布后再开放购买。',unavailable:'当前服务暂不可购买，请等待后台完成商品配置。',failed:'当前仅展示原有方案，不展示售价或付款入口。'};
function placeholder(plan,state='loading'){
 return `<span class="revision-bundle-status" data-revision-bundle-state="${state}">${stateCopy[state]}</span><h3>${esc(plan.title)}</h3><p class="revision-bundle-description">${esc(plan.description)}</p><div class="revision-bundle-detail"><span class="revision-bundle-focus">${esc(plan.focus)} · 方案规划</span><p>${hintCopy[state]}</p></div><div class="revision-bundle-actions"><button class="btn secondary" type="button" data-revision-bundle-details="${plan.id}">查看方案 ${icon('arrow',14)}</button><small>未发布前不提供付款入口</small></div>`;
}
export function revisionBundleOffersMarkup(kind='reduce'){
 const context=kind==='membership'?'membership':kind==='aigc'?'aigc':'reduce';
 return `<section class="revision-bundle-offers" data-revision-bundle-offers data-revision-bundle-context="${context}" aria-label="查降专项套餐"><header class="revision-bundle-heading"><div><span class="revision-bundle-eyebrow">PAPERKNOW BUNDLES</span><h2>查降专项套餐</h2><p>在会员与用量中统一选择，按已发布的服务与次数购买。</p></div><span class="revision-bundle-catalogue-status" data-revision-bundle-catalogue-status role="status">正在核对商品与权益</span></header><div class="revision-bundle-grid">${plans.map(plan=>`<article class="revision-bundle-card revision-bundle-${plan.tone}" data-revision-bundle="${plan.id}" data-revision-bundle-id="${plan.id}"><span class="revision-bundle-art" aria-hidden="true">${icon(plan.symbol,27)}<i></i><i></i></span><div class="revision-bundle-card-content" data-revision-bundle-content>${placeholder(plan)}</div></article>`).join('')}</div><footer class="revision-bundle-footer"><p>未上架方案不开放购买；实际服务以发布的商品说明为准。</p><div><a href="#membership/recharge">按次使用，购买积分 ${icon('arrow',13)}</a><a href="#membership?scope=account">查看已购权益 ${icon('arrow',13)}</a></div></footer></section>`;
}
const nonempty=(value,max)=>typeof value==='string'&&Boolean(value.trim())&&value.length<=max;
function publishedProduct(plan,products){
 const matches=products.filter(product=>product?.id===plan.id);
 if(matches.length!==1)return null;
 const product=matches[0],entitlement=product.entitlement;
 const type=entitlement?.type??product.entitlementType,days=entitlement?.durationDays??product.durationDays,items=product.bundleItems??entitlement?.bundleItems;
 if(product.status!=='active'||product.purchasable!==true||product.currency!=='CNY'||type!=='bundle'||product.entitlementType!==undefined&&product.entitlementType!=='bundle'||!Number.isSafeInteger(product.priceCents)||product.priceCents<1||product.priceCents>10000000||!Number.isSafeInteger(days)||days<1||days>366||product.durationDays!==undefined&&product.durationDays!==days||!nonempty(product.title,80)||!nonempty(product.description,1000))return null;
 if(!Array.isArray(items)||items.length<1||items.length>20||items.some(item=>!item||typeof item.key!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(item.key)||items.filter(other=>other?.key===item.key).length!==1||!nonempty(item.title,80)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100000))return null;
 // Conflicting copies of the entitlement must not be resolved in the UI's favour.
 if(product.bundleItems!==undefined&&entitlement?.bundleItems!==undefined&&JSON.stringify(product.bundleItems)!==JSON.stringify(entitlement.bundleItems))return null;
 return {id:plan.id,title:product.title,description:product.description,priceCents:product.priceCents,durationDays:days,items:items.map(item=>({key:item.key,title:item.title,quantity:item.quantity}))};
}
function liveMarkup(product){
 const price=(product.priceCents/100).toFixed(2).replace(/\.00$/,'');
 return `<span class="revision-bundle-status" data-revision-bundle-state="published">已上架</span><h3>${esc(product.title)}</h3><p class="revision-bundle-description">${esc(product.description)}</p><div class="revision-bundle-detail"><div class="revision-bundle-price"><strong>¥${price}</strong><span>/ 套 · ${product.durationDays} 天</span></div><ul class="revision-bundle-quotas" aria-label="套餐服务次数">${product.items.map(item=>`<li><span>${esc(item.title)}</span><b>× ${item.quantity} 次</b></li>`).join('')}</ul></div><div class="revision-bundle-actions"><a class="btn primary" data-revision-bundle-checkout="${product.id}" href="#membership/pay?product=${encodeURIComponent(product.id)}">确认购买 ${icon('arrow',14)}</a><small>进入收银台核对金额与支付方式</small></div>`;
}
export function mountRevisionBundleOffers({container,signal,modal,timeoutMs=12000,fetchOptions}={}){
 const root=container?.matches?.('[data-revision-bundle-offers]')?container:container?.querySelector?.('[data-revision-bundle-offers]');
 if(!root)return {dispose(){}};
 mounts.get(root)?.dispose();
 const doc=root.ownerDocument,win=doc.defaultView,route=win?.location.hash;
 const controller=new (win?.AbortController||globalThis.AbortController)();
 let disposed=false,completed=false,timedOut=false,timer=null;
 const states=new Map(plans.map(plan=>[plan.id,'loading']));
 const current=()=>!disposed&&!timedOut&&!signal?.aborted&&root.isConnected&&root.ownerDocument===doc&&win?.document===doc&&win.location.hash===route&&mounts.get(root)===owner;
 const update=callback=>withStableView(root.closest('.dashboard')||root,callback);
 function paint(plan,state,product){
  states.set(plan.id,state);
  const card=root.querySelector(`[data-revision-bundle-id="${plan.id}"]`),content=card?.querySelector('[data-revision-bundle-content]');
  if(!content)return;
  card.classList.toggle('is-published',state==='published');
  if(state==='published')card.dataset.bundleProduct=plan.id;else delete card.dataset.bundleProduct;
  content.innerHTML=product?liveMarkup(product):placeholder(plan,state);
 }
 function paintAll(state){update(()=>{for(const plan of plans)paint(plan,state);root.querySelector('[data-revision-bundle-catalogue-status]').textContent=state==='failed'?'商品信息暂未取得 · 可继续按次使用':'正在核对商品与权益';});}
 function dispose(){
  if(disposed)return;disposed=true;controller.abort();if(timer!==null)win.clearTimeout(timer);signal?.removeEventListener('abort',dispose);win?.removeEventListener('hashchange',onRoute);root.removeEventListener('click',onClick);if(mounts.get(root)===owner)mounts.delete(root);
 }
 const owner={dispose};mounts.set(root,owner);
 const onRoute=()=>{if(win.location.hash!==route)dispose();};
 function onClick(event){
  const button=event.target.closest?.('[data-revision-bundle-details]');
  if(!button||!root.contains(button)||disposed)return;
  const plan=plans.find(item=>item.id===button.dataset.revisionBundleDetails);if(!plan||typeof modal!=='function')return;
  modal(plan.title,`<div class="revision-bundle-plan-dialog"><p><b>${esc(stateCopy[states.get(plan.id)]||'方案规划')}</b></p><p>${esc(plan.description)}</p><p>这是套餐规划，实际服务、次数、有效期与价格尚未发布或暂未取得。当前不创建订单、不扣款，也不发放套餐权益。</p><p>数据库查重、自动复测与检测分数不因展示此方案而开放。</p><a class="btn secondary" href="#membership/recharge">查看现有科研积分</a></div>`);
 }
 root.addEventListener('click',onClick);win?.addEventListener('hashchange',onRoute);signal?.addEventListener('abort',dispose,{once:true});
 if(signal?.aborted||!root.isConnected){dispose();return owner;}
 // A fresh mount discards a previous catalogue snapshot before reading again.
 paintAll('loading');
 const delay=Number.isFinite(timeoutMs)&&timeoutMs>0?Math.min(timeoutMs,60000):12000;
 timer=win.setTimeout(()=>{if(!current()||completed)return;paintAll('failed');timedOut=true;controller.abort();},delay);
 const fetcher=fetchOptions??win?.fetch?.bind(win);
 Promise.resolve().then(()=>{if(!current())return null;if(typeof fetcher!=='function')throw Error('Catalogue unavailable');return fetcher('/api/payments/options',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'},signal:controller.signal});}).then(async response=>{
  if(!current()||!response)return;
  if(!response.ok)throw Error('Catalogue unavailable');
  const options=await response.json();if(!current())return;
  if(!options||!Array.isArray(options.products)||!Array.isArray(options.channels))throw Error('Invalid catalogue');
  update(()=>{
   let published=0;
   for(const plan of plans){const product=publishedProduct(plan,options.products),raw=options.products.filter(item=>item?.id===plan.id);const state=product?'published':raw.some(item=>item?.status==='active')?'unavailable':'unpublished';paint(plan,state,product);if(product)published++;}
   root.querySelector('[data-revision-bundle-catalogue-status]').textContent=published?`${published} 个套餐已上架 · 以收银台再次核验为准`:'原有套餐方案仍在 · 当前尚无可购买商品';
  });completed=true;
 }).catch(()=>{if(current()){paintAll('failed');completed=true;}}).finally(()=>{if(timer!==null)win.clearTimeout(timer);});
 return owner;
}
