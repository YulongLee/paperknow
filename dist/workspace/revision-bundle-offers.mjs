import {icon} from './ui.mjs';
import {bundlePreviewCard,publishedBundleCard} from './commerce-bundle-card.mjs';
import {withStableView} from './view-stability.mjs';
import {specialistRevisionOffers} from './specialist-commercial-offers.mjs';

// The owner-approved reference prices and service counts are display-only.
// Only a validated published server product can expose payment and usable quotas.
export const revisionBundlePlans=Object.freeze(specialistRevisionOffers.map(offer=>Object.freeze({id:offer.id.replace(/^bundle-/,''),name:offer.title,priceCents:offer.priceCents,durationDays:offer.durationDays,totalUses:offer.totalUses,audience:offer.audience,description:offer.description,featured:offer.featured,features:Object.freeze(offer.bundleItems.map(item=>`${item.title} × ${item.quantity} 次`))})));
const mounts=new WeakMap();
const sku=plan=>'bundle-'+plan.id;
const cardAttributes=plan=>({'data-revision-bundle':sku(plan),'data-revision-bundle-id':sku(plan)});
const placeholder=(plan,state='loading')=>bundlePreviewCard(plan,{state,attributes:cardAttributes(plan)});
export function revisionBundleOffersMarkup(kind='membership',{plans=revisionBundlePlans,family='detect'}={}){
 const context=kind==='membership'?'membership':kind==='aigc'?'aigc':'reduce',writing=family==='writing',title=writing?'写作套餐':'查降套餐',description=writing?'按学位组合论文、报告、修改与答辩服务。':'按需组合来源比对、文本鉴别与学术表达修改。';
 return `<section class="commerce-center-section" data-revision-bundle-offers data-revision-bundle-context="${context}" data-revision-bundle-family="${writing?'writing':'detect'}" aria-label="${title}" data-specialist-panel="${writing?'writing':'detect'}"><div class="purchase-section-head commerce-center-section-title"><div><span class="commerce-center-eyebrow">RESEARCH BUNDLES</span><h2>${title}</h2><p>${description}</p></div><span class="commerce-center-unit-note" data-revision-bundle-catalogue-status role="status">正在核对商品与权益</span></div><div class="purchase-plans commerce-center-plan-grid ${writing?'commerce-writing-plans':''}" data-revision-bundle-grid>${plans.map(plan=>placeholder(plan)).join('')}</div><p class="commerce-center-fineprint">付款前核对服务次数与有效期，价格和权益以收银台确认内容为准。</p><div class="actions"><a href="#membership/recharge">按次使用，购买积分 ${icon('arrow',13)}</a><a href="#membership?scope=account">查看已购权益 ${icon('arrow',13)}</a></div></section>`;
}
const nonempty=(value,max)=>typeof value==='string'&&Boolean(value.trim())&&value.length<=max;
function publishedProduct(plan,products){
 const matches=products.filter(product=>product?.id===sku(plan));
 if(matches.length!==1)return null;
 const product=matches[0],entitlement=product.entitlement;
 const type=entitlement?.type??product.entitlementType,days=entitlement?.durationDays??product.durationDays,items=product.bundleItems??entitlement?.bundleItems;
 if(product.status!=='active'||product.purchasable!==true||product.currency!=='CNY'||type!=='bundle'||product.entitlementType!==undefined&&product.entitlementType!=='bundle'||!Number.isSafeInteger(product.priceCents)||product.priceCents<1||product.priceCents>10000000||!Number.isSafeInteger(days)||days<1||days>366||product.durationDays!==undefined&&product.durationDays!==days||!nonempty(product.title,80)||!nonempty(product.description,1000))return null;
 if(!Array.isArray(items)||items.length<1||items.length>20||items.some(item=>!item||typeof item.key!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(item.key)||items.filter(other=>other?.key===item.key).length!==1||!nonempty(item.title,80)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100000))return null;
 // Conflicting copies of the entitlement must not be resolved in the UI's favour.
 if(product.bundleItems!==undefined&&entitlement?.bundleItems!==undefined&&JSON.stringify(product.bundleItems)!==JSON.stringify(entitlement.bundleItems))return null;
 return {id:sku(plan),title:product.title,description:product.description,priceCents:product.priceCents,durationDays:days,bundleItems:items.map(item=>({key:item.key,title:item.title,quantity:item.quantity}))};
}
export function mountRevisionBundleOffers({container,signal,timeoutMs=12000,fetchOptions,plans=revisionBundlePlans}={}){
 const root=container?.matches?.('[data-revision-bundle-offers]')?container:container?.querySelector?.('[data-revision-bundle-offers]');
 if(!root)return {dispose(){}};
 mounts.get(root)?.dispose();
 const doc=root.ownerDocument,win=doc.defaultView,route=win?.location.hash;
 const controller=new (win?.AbortController||globalThis.AbortController)();
 let disposed=false,completed=false,timedOut=false,timer=null;
 const current=()=>!disposed&&!timedOut&&!signal?.aborted&&root.isConnected&&root.ownerDocument===doc&&win?.document===doc&&win.location.hash===route&&mounts.get(root)===owner;
 const update=callback=>withStableView(root.closest('.dashboard')||root,callback);
 function paint(plan,state,product){
  const card=root.querySelector(`[data-revision-bundle-id="${sku(plan)}"]`);
  if(!card)return;
  card.outerHTML=product?publishedBundleCard(product,plan,{attributes:cardAttributes(plan)}):placeholder(plan,state);
 }
 function paintAll(state){update(()=>{for(const plan of plans)paint(plan,state);root.querySelector('[data-revision-bundle-catalogue-status]').textContent=state==='failed'?'商品信息暂未取得 · 可继续按次使用':'正在核对商品与权益';});}
 function dispose(){
  if(disposed)return;disposed=true;controller.abort();if(timer!==null)win.clearTimeout(timer);signal?.removeEventListener('abort',dispose);win?.removeEventListener('hashchange',onRoute);if(mounts.get(root)===owner)mounts.delete(root);
 }
 const owner={dispose};mounts.set(root,owner);
 const onRoute=()=>{if(win.location.hash!==route)dispose();};
 win?.addEventListener('hashchange',onRoute);signal?.addEventListener('abort',dispose,{once:true});
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
   for(const plan of plans){const product=publishedProduct(plan,options.products),raw=options.products.filter(item=>item?.id===sku(plan));const state=product?'published':raw.some(item=>item?.status==='active')?'unavailable':'unpublished';paint(plan,state,product);if(product)published++;}
   root.querySelector('[data-revision-bundle-catalogue-status]').textContent=published?`${published} 个套餐已上架 · 以收银台再次核验为准`:'原有套餐方案仍在 · 当前尚无可购买商品';
  });completed=true;
 }).catch(()=>{if(current()){paintAll('failed');completed=true;}}).finally(()=>{if(timer!==null)win.clearTimeout(timer);});
 return owner;
}
