// User-confirmed package prices and quotas. Actual checkout is always backed by
// the published server catalogue and its immutable order snapshot.
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
export const specialistBundleDurationDays=180;
export const specialistLaunchVersion='2026-10-31-paid-v1';
const degreeNames={junior:'专科',bachelor:'本科',master:'硕士',doctor:'博士'};
const validDuration=value=>{if(!Number.isSafeInteger(value)||value<1||value>366)throw new Error('套餐有效期应为 1～366 天的整数');return value;};
const item=(key,title,quantity)=>({key,title,quantity});
function offer({id,title,priceCents,durationDays,group,audience,featured=false,bundleItems}){
 const common=`单次购买，${durationDays} 天内使用所列服务的总次数，各项次数独立，不自动续费。成功结算，失败或取消释放预占。`;
 const scope=group==='detect'?'来源比对使用 PaperKnow 本次取得的公开来源，不包含知网、维普或万方等封闭数据库；AI 文本鉴别仅供参考。':'毕业论文、任务书、开题报告与文献综述按本套餐所列学位使用；在线修改用于已有正文的学术表达修改。';
 return freeze({id,title,priceCents,currency:'CNY',durationDays,group,audience,featured,status:'preview',entitlementType:'bundle',totalUses:bundleItems.reduce((sum,value)=>sum+value.quantity,0),description:common+scope,bundleItems});
}
export function specialistOffersForDuration(durationDays=specialistBundleDurationDays){
 validDuration(durationDays);
 const revisions=[
  ['rewrite','查重优化套餐',5900,'revision-reduce','一键强力降重','围绕已有正文，整理重复表达'],
  ['reduce','AI 表达优化套餐',7900,'revision-aigc','一键降 AIGC','完善自然、连贯的学术表达'],
  ['dual','双向优化套餐',9900,'revision-dual','AIGC+重复率双降','兼顾重复表达与语言自然度']
 ].map(([id,title,priceCents,key,service,audience])=>offer({id:'bundle-'+id,title,priceCents,durationDays,group:'detect',audience,featured:id==='reduce',bundleItems:[item('detection-similarity','PaperKnow 来源比对',2),item('detection-aigc','AI 文本鉴别',2),item('polish','修改建议与表达修改',2),item(key,service,2)]}));
 const writing=[['junior',12900,5],['bachelor',16900,7],['master',26900,10],['doctor',39900,15]].map(([degree,priceCents,changes])=>{
  const name=degreeNames[degree];return offer({id:'bundle-'+degree,title:(degree==='doctor'?'博士研究辅助套餐':name+'写作套餐'),priceCents,durationDays,group:'writing',audience:'适合'+name+'阶段的论文与答辩准备',featured:degree==='bachelor',bundleItems:[item('thesis-'+degree,'毕业论文-'+name,1),item('presentation-proposal','开题 PPT',1),item('polish','在线修改',changes),item('taskbook-'+degree,'任务书-'+name,1),item('proposal-'+degree,'开题报告-'+name,1),item('literature-review-'+degree,'文献综述-'+name,1),item('presentation-thesis','答辩 PPT 基础版',1)]});
 });
 return freeze([...revisions,...writing]);
}
export const specialistBundleOffers=specialistOffersForDuration();
export const specialistRevisionOffers=freeze(specialistBundleOffers.filter(offer=>offer.group==='detect'));
export const specialistWritingOffers=freeze(specialistBundleOffers.filter(offer=>offer.group==='writing'));
