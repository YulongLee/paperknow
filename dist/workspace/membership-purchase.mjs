import {esc,icon} from './ui.mjs';
const $=s=>document.querySelector(s);
// Planning information only. Prices, quotas and payment must come from a verified backend before launch.
export const memberPlans=[
 {id:'free',name:'免费体验',tag:'当前可用',description:'先把研究材料整理起来',audience:'适合体验工具与轻量整理',features:['论文大纲与手动写作','文献阅读与研究笔记','自备材料文本比对','本地保存与成果导出'],available:true},
 {id:'standard',name:'标准会员',tag:'方案规划中',description:'支持日常论文与研究任务',audience:'面向专科、本科及日常写作需求',features:['规划：AI 写作与表达辅助','规划：AI 文献研读与翻译','规划：开放学术来源检索','规划：云端保存与多设备同步'],available:false},
 {id:'pro',name:'专业会员',tag:'方案规划中',description:'面向持续、深入的研究工作',audience:'面向硕士、博士及科研人员',features:['规划：标准会员相关能力','规划：更高在线任务额度','规划：长文档与多文献研读','规划：研究项目与版本管理'],available:false}
];
export const memberPeriods=[{id:'month',name:'月度',label:'按月购买'},{id:'year',name:'年度',label:'按年购买'}];
export function purchaseSelection(plan,period){const selected=memberPlans.find(p=>p.id===plan&&!p.available)||memberPlans[1];return {plan:selected,period:memberPeriods.find(p=>p.id===period)||memberPeriods[0],price:null,paymentEnabled:false};}
const comparison=[
 ['本地编辑与保存','可用','保留本地能力','保留本地能力'],
 ['AI 写作、修改与研读','未接入','规划中','规划中'],
 ['开放学术来源检索','未接入','规划中','规划中'],
 ['云端保存与多设备同步','未接入','规划中','规划中'],
 ['在线额度与任务并发','未启用','待公布','待公布'],
 ['套餐价格与有效期','本地体验不收费','待公布','待公布']
];
function periodControls(period){return `<div class="purchase-period" role="group" aria-label="会员购买周期">${memberPeriods.map(p=>`<button type="button" data-member-period="${p.id}" aria-pressed="${period===p.id}" class="${period===p.id?'selected':''}">${p.name}</button>`).join('')}</div>`;}
function rules(){return `<div class="purchase-notice">${icon('info',18)}<p>套餐方案供预览。价格、额度、有效期和售后规则将在正式开放前公布；当前选择套餐不会创建订单、扣款或开通会员。</p></div>`;}
export function mountMemberPlans(periodId='month'){
 const {period}=purchaseSelection('standard',periodId);
 $('.dashboard').innerHTML=`<div class="hub-heading"><div><h1>开通会员</h1><p>为你的论文与科研，选择合适的支持。</p></div><a class="btn secondary" href="#membership">返回会员与用量 ${icon('arrow',16)}</a></div>
 <section class="purchase-hero"><div><span>PAPERKNOW MEMBERSHIP</span><h2>让研究的每一步，都更有支持</h2><p>从日常写作到深入研读，让工具服务于你的研究目标。</p><div class="purchase-hero-tags"><span>写作与修改</span><span>文献与研读</span><span>论文与成果</span></div></div><div class="purchase-hero-icon" aria-hidden="true">${icon('diamond',76)}</div></section>
 <div class="purchase-section-head"><div><h2>选择你的会员方案</h2><p>当前可以使用免费本地功能；在线套餐尚未开放。</p></div>${periodControls(period.id)}</div>
 <div class="purchase-plans">${memberPlans.map(p=>`<article class="purchase-plan ${p.id==='standard'?'featured':''}"><div class="purchase-plan-top"><span class="purchase-plan-icon">${icon(p.id==='free'?'user':p.id==='standard'?'diamond':'book',25)}</span><span class="purchase-status">${p.tag}</span></div><h3>${p.name}</h3><p>${p.description}</p><div class="purchase-price">${p.available?'<b>免费</b><span>本地体验</span>':'<b>价格待公布</b><span>'+period.label+' · 尚未开放</span>'}</div><div class="purchase-audience">${p.audience}</div><ul>${p.features.map(f=>`<li><span aria-hidden="true">✓</span>${f}</li>`).join('')}</ul>${p.available?'<a class="btn secondary full" href="#home">继续免费体验</a>':`<a class="btn ${p.id==='standard'?'primary':'secondary'} full" href="#membership/checkout?plan=${p.id}&period=${period.id}">选择${p.name} ${icon('arrow',16)}</a>`}<small>${p.available?'当前无需付费或绑定支付方式':'查看购买确认；规划权益尚未生效'}</small></article>`).join('')}</div>
 ${rules()}
 <section class="card purchase-comparison"><header><h2>权益对比</h2><span>在线权益以正式公布的方案为准</span></header><div class="purchase-table-wrap"><table><thead><tr><th scope="col">功能与服务</th>${memberPlans.map(p=>`<th scope="col">${p.name}</th>`).join('')}</tr></thead><tbody>${comparison.map(row=>`<tr>${row.map((v,i)=>i?`<td>${v}</td>`:`<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table></div></section>
 <section class="card purchase-faq"><h2>购买前，你可能想了解</h2><details open><summary>现在可以购买或开通会员吗？</summary><p>当前提供套餐和购买确认页面预览。正式账户、价格与支付尚未接入，不收款，不会生成已支付订单或会员权益。</p></details><details><summary>月度和年度有什么区别？</summary><p>用于预览不同购买周期。最终有效期、价格、是否提供优惠及额度重置规则将在开放前公布；目前没有自动续费或扣款。</p></details><details><summary>会员查重是否等同于学校的正式查重？</summary><p>不等同于知网、万方或维普。当前只比对自备材料；未来在线检索的覆盖范围会单独说明，不保证学校检测结果或通过率。</p></details><details><summary>额度、发票与退款在哪里查看？</summary><p>相关规则尚未生效。正式开放时，购买确认页将显示实际价格、额度、有效期、发票与售后规则，订单记录展示真实交易。</p></details></section>
 <div class="purchase-footer"><span>选择前需要帮助？</span><a href="#help">查看帮助与反馈 ${icon('arrow',15)}</a><a href="#orders">订单记录 ${icon('arrow',15)}</a></div>`;
 document.querySelectorAll('[data-member-period]').forEach(b=>b.onclick=()=>{location.hash='#membership/plans?period='+b.dataset.memberPeriod;});
}
export function mountMemberCheckout(planId,periodId){
 const {plan,period}=purchaseSelection(planId,periodId);
 $('.dashboard').innerHTML=`<div class="hub-heading"><div><h1>确认会员方案</h1><p>核对方案与服务范围，了解购买前需要确认的信息。</p></div><a class="btn secondary" href="#membership/plans?period=${period.id}">重新选择套餐 ${icon('arrow',16)}</a></div>
 <nav class="purchase-steps" aria-label="会员购买步骤"><a href="#membership/plans?period=${period.id}"><span>1</span>选择套餐</a><strong aria-current="step"><span>2</span>确认方案</strong><span><i>3</i>支付与开通（待开放）</span></nav>
 <div class="purchase-checkout-grid"><div><section class="card purchase-detail"><div class="purchase-detail-heading"><span class="purchase-plan-icon">${icon('diamond',29)}</span><div><h2>${plan.name}</h2><p>${plan.description}</p></div><span class="purchase-status">方案预览</span></div><div class="purchase-section-head"><h3>购买周期</h3>${periodControls(period.id)}</div><dl class="purchase-summary"><div><dt>已选择方案</dt><dd>${plan.name} · ${period.name}</dd></div><div><dt>会员价格</dt><dd>待公布</dd></div><div><dt>生效时间与有效期</dt><dd>正式开放前公布</dd></div><div><dt>额度与重置规则</dt><dd>正式开放前公布</dd></div><div><dt>自动续费</dt><dd>当前不启用</dd></div></dl><h3>规划权益</h3><ul class="purchase-checkout-features">${plan.features.map(f=>`<li>${icon('shield',16)}${f}</li>`).join('')}</ul><p class="member-caption">以上在线服务尚未接入，不构成当前已开通的权益。</p></section>
 <section class="card purchase-payment"><h2>支付方式</h2><div class="purchase-payment-options"><span>微信支付 <small>待接入</small></span><span>支付宝 <small>待接入</small></span></div><p>当前无法发起支付，也不会要求你提供付款码或支付账户信息。</p></section></div>
 <aside class="card purchase-confirm"><span class="purchase-confirm-label">方案确认</span><h2>${plan.name}</h2><p>${period.name}会员方案预览</p><dl><div><dt>套餐价格</dt><dd>待公布</dd></div><div><dt>优惠与实付金额</dt><dd>待公布</dd></div></dl><div class="purchase-payment-state">${icon('clock',21)}<div><b>支付尚未开放</b><p>价格和权益确定后，才能正式购买。</p></div></div><button class="btn primary full" disabled>暂未开放支付</button><a class="btn secondary full" href="#home">继续使用本地功能</a><p class="purchase-confirm-note">当前未创建订单、未扣款、未开通会员。会员协议、退款与发票规则将在开放前提供。</p><a class="purchase-confirm-help" href="#help">有疑问？查看帮助 ${icon('arrow',14)}</a></aside></div>${rules()}`;
 document.querySelectorAll('[data-member-period]').forEach(b=>b.onclick=()=>{location.hash=`#membership/checkout?plan=${plan.id}&period=${b.dataset.memberPeriod}`;});
}
