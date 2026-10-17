// Launch reference data shared by the catalogue and purchase pages. The server's
// published catalogue remains the authority for payment amounts and fulfilment.
const freeze=value=>{if(value&&typeof value==='object'){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
export const commercialLaunchVersion='2026-10-18-v1';
const titles={'literature-read':'文献解读','literature-answer':'原文问答','literature-translate':'文献翻译',polish:'学术润色',review:'导师意见修改','format-advice':'格式建议','presentation-ai':'AI PPT','presentation-proposal':'开题 PPT','presentation-thesis':'毕业 PPT'};
const offer=({id,title,priceCents,durationDays,items,audience,featured=false,entitlementType})=>{
 const services=items.map(([key,quantity])=>({key,title:titles[key],quantity}));
 return freeze({id,title,priceCents,currency:'CNY',durationDays,status:'preview',entitlementType,audience,featured,totalUses:services.reduce((sum,item)=>sum+item.quantity,0),description:`单次购买，${durationDays} 天内使用所列服务的总次数，不按月重置，不自动续费。整篇论文生成、通用智能助手及正式数据库检测不在本方案内。提交前确认，成功扣减；失败或取消释放预占。`,[entitlementType==='membership'?'membershipItems':'bundleItems']:services});
};
export const commercialMemberOffers=freeze([
 offer({id:'basic',title:'轻享会员',priceCents:1990,durationDays:30,entitlementType:'membership',audience:'适合轻量阅读与论文表达修改',items:[['literature-read',6],['literature-answer',12],['literature-translate',4],['polish',6],['review',2]]}),
 offer({id:'advanced',title:'进阶会员',priceCents:3990,durationDays:30,entitlementType:'membership',audience:'适合持续研读与阶段性修改',featured:true,items:[['literature-read',12],['literature-answer',24],['literature-translate',8],['polish',10],['review',6],['format-advice',5]]}),
 offer({id:'premium',title:'专业会员',priceCents:6990,durationDays:30,entitlementType:'membership',audience:'适合研读、修改与研究汇报准备',items:[['literature-read',20],['literature-answer',40],['literature-translate',12],['polish',18],['review',10],['format-advice',8],['presentation-ai',4],['presentation-proposal',4],['presentation-thesis',4]]})
]);
export const commercialBundleOffers=freeze([
 offer({id:'bundle-reading',title:'文献研读套餐',priceCents:990,durationDays:90,entitlementType:'bundle',audience:'集中解读、问答与翻译文献',items:[['literature-read',4],['literature-answer',6],['literature-translate',2]]}),
 offer({id:'bundle-polishing',title:'论文润色套餐',priceCents:1990,durationDays:90,entitlementType:'bundle',audience:'围绕已有正文完成表达和格式修改',featured:true,items:[['polish',12],['review',8],['format-advice',5]]}),
 offer({id:'bundle-presentation',title:'科研演示套餐',priceCents:2990,durationDays:90,entitlementType:'bundle',audience:'按研究阶段准备演示与汇报',items:[['presentation-ai',1],['presentation-proposal',1],['presentation-thesis',1],['polish',10],['review',5],['format-advice',10]]})
]);
export const commercialOffers=freeze([...commercialMemberOffers,...commercialBundleOffers]);
// Recommendations only. Seeding products never changes an administrator's tool prices.
export const commercialToolPricingPresets=freeze(['presentation-ai','presentation-proposal','presentation-thesis'].map(key=>({key,title:titles[key],mode:'paid',creditCost:50})));
