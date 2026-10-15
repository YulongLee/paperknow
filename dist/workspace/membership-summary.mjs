import {esc,icon} from './ui.mjs';

export function membershipPurchaseTiles({account=false,credits,items=[],bundles=[]}={}){
 const active=(Array.isArray(items)?items:[]).filter(item=>item&&(item.type||item.entitlementType)==='membership'&&Date.parse(item.starts_at)<=Date.now()&&Date.parse(item.expires_at)>Date.now()).sort((a,b)=>Date.parse(b.expires_at)-Date.parse(a.expires_at));
 const purchasedBundles=Array.isArray(bundles)?bundles.filter(bundle=>bundle&&typeof bundle.orderId==='string'&&bundle.orderId):[];
 const balance=Number.isSafeInteger(credits?.balance)&&credits.balance>=0?credits.balance.toLocaleString('zh-CN'):'—';
 const tiles=[
  {key:'member',label:account?'当前会员':'持续研究',title:account?(active[0]?.title||'免费使用'):'会员订阅',description:account?(active.length?'已生效权益与到期时间见下方记录。':'尚无已生效会员，免费工具仍可使用。'):'按研究阶段选择等级，查看适合你的组合权益。',link:'#membership/plans',action:'查看会员方案',icon:'diamond'},
  {key:'credits',label:account?'账户科研积分':'按需使用',title:account?balance:'200 / 500 / 1000',description:account?'余额与流水来自当前登录账户':'选择积分档位，核对金额与支付方式。',link:'#membership/recharge',action:'购买科研积分',icon:'plus'},
  {key:'bundles',label:account?'账户已购套餐':'阶段任务',title:account?`${purchasedBundles.length} 份已购套餐`:'写作与查降套餐',description:account?'购买次数与有效期见下方记录；尚未接入消费扣减。':'围绕论文任务组合服务，按项查看商品说明。',link:'#membership/bundles',action:'查看专项套餐',icon:'grid'}
 ];
 return `<section class="member-purchase-overview" aria-label="会员、积分与套餐">${tiles.map(t=>`<article class="member-purchase-tile member-purchase-${t.key}"><img src="/workspace/assets/commerce-${t.key}-v2.webp" alt="" aria-hidden="true" width="240" height="120"><span class="member-purchase-kicker">${icon(t.icon,15)}${esc(t.label)}</span><h2>${esc(t.title)}</h2><p>${esc(t.description)}</p><a href="${t.link}">${t.action}${icon('arrow',16)}</a></article>`).join('')}</section>`;
}
