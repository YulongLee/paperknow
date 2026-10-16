import {esc,icon} from './ui.mjs';

export function membershipPurchaseTiles({account=false,credits,items=[],bundles=[]}={}){
 const active=(Array.isArray(items)?items:[]).filter(item=>item&&(item.type||item.entitlementType)==='membership'&&Date.parse(item.starts_at)<=Date.now()&&Date.parse(item.expires_at)>Date.now()).sort((a,b)=>Date.parse(b.expires_at)-Date.parse(a.expires_at));
 const purchasedBundles=Array.isArray(bundles)?bundles.filter(bundle=>bundle&&typeof bundle.orderId==='string'&&bundle.orderId):[];
 const number=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString('zh-CN'):'—';
 const hasAvailable=Number.isSafeInteger(credits?.available)&&credits.available>=0,balance=number(credits?.balance),available=number(credits?.available),held=number(credits?.held);
 const latestExpiry=active.length?new Date(active[0].expires_at).toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}):'';
 const tiles=[
  {key:'member',label:account?'当前会员':'持续研究',title:account?(active[0]?.title||'免费使用'):'会员订阅',description:account?(active.length?`当前权益至 ${latestExpiry}；包含服务与剩余次数见下方记录。`:'尚无已生效会员，免费工具仍可使用。'):'按研究阶段选择等级，查看适合你的组合权益。',link:'#membership/plans',action:'查看会员方案',icon:'diamond'},
  {key:'credits',label:account?(hasAvailable?'可用科研积分':'账户科研积分'):'按需使用',title:account?(hasAvailable?available:balance):'200 / 500 / 1000',description:account?(hasAvailable?`账户余额 ${balance} · 任务预占 ${held}。充值与消费明细见下方。`:'可用额与预占额待核对，请查看下方积分明细。'):'选择积分档位，核对金额与支付方式。',link:'#membership/recharge',action:'购买科研积分',icon:'plus'},
  {key:'bundles',label:account?'账户已购套餐':'阶段任务',title:account?`${purchasedBundles.length} 份已购套餐`:'写作与查降套餐',description:account?'剩余次数、处理中预占与有效期见下方记录。':'围绕论文任务组合服务，按项查看商品说明。',link:'#membership/bundles',action:'查看专项套餐',icon:'grid'}
 ];
 return `<section class="member-purchase-overview" aria-label="会员、积分与套餐">${tiles.map(t=>`<article class="member-purchase-tile member-purchase-${t.key}"><img src="/workspace/assets/commerce-${t.key}-v2.webp" alt="" aria-hidden="true" width="240" height="120"><span class="member-purchase-kicker">${icon(t.icon,15)}${esc(t.label)}</span><h2>${esc(t.title)}</h2><p>${esc(t.description)}</p><a href="${t.link}">${t.action}${icon('arrow',16)}</a></article>`).join('')}</section>`;
}
