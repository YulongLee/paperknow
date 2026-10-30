// New-sale V1 tariffs. Published server policies remain authoritative.
export const v1CommercialVersion='2026-10-31-v1';
export const resourceEntitlementKeys=Object.freeze(['light-ai','translation-pages','parse-pages','cloud-mb']);
export const v1ExtraServices=Object.freeze([
 ['detection-combined','重复率＋AI 率联合检测','论文检测',149],
 ['writing-planning','题目、方法与提纲辅助','AI 写作',0],
 ['thesis-long','长篇论文（12,001～30,000 字）','AI 写作',1990],
 ['writing-article','期刊文章','AI 写作',499],['writing-course','课程作业','AI 写作',199],
 ['writing-practice','实践报告','AI 写作',299],['writing-idea','课题思路','AI 写作',49],
 ['writing-questionnaire','问卷设计','AI 写作',99],['writing-analysis','数据分析报告','AI 写作',199],
 ['revision-paragraph','段落表达优化（1,000 字内）','论文修改',19],
 ['revision-targeted','检测报告定向优化','论文修改',299],
 ['presentation-enhanced','增强 PPT（21～30 页）','PPT 创作',299],
 ['literature-document','整篇翻译（20 页以内）','文献研读',99],
 ['literature-document-long','整篇翻译（21～50 页）','文献研读',249]
].map(([key,title,group,creditCost])=>Object.freeze({key,title,group,creditCost})));
export const v1PriceFor=key=>v1ExtraServices.find(s=>s.key===key)?.creditCost??(
 key.startsWith('thesis-')?1000:key.startsWith('proposal-')?199:key.startsWith('taskbook-')?99:key.startsWith('literature-review-')?299:
 ({'literature-read':10,'literature-answer':10,'literature-translate':10,'revision-reduce':199,'revision-aigc':199,'revision-dual':399,
 'presentation-ai':199,'presentation-proposal':199,'presentation-thesis':199,'research-image':49,'research-chart':29,'research-diagram':59,'research-formula':10,'format-advice':199,'detection-similarity':99,'detection-aigc':99})[key]);
export const entitlementUnit=key=>['translation-pages','parse-pages'].includes(key)?'页':key==='cloud-mb'?'MB':'次';
export const entitlementLabel=item=>`${item.title} × ${item.quantity.toLocaleString('zh-CN')} ${entitlementUnit(item.key)}`;
export const v1MemberOffers=Object.freeze([
 {id:'reading-v1',title:'研读会员',priceCents:2990,light:60,pages:20,parse:100,storage:2048},
 {id:'professional-v1',title:'专业会员',priceCents:6990,light:180,pages:50,parse:300,storage:10240}
].map(p=>({...p,currency:'CNY',durationDays:30,entitlementType:'membership',status:'preview',audience:'文献研读与轻量表达修改',
 description:'单次购买，有效期 30 天，不自动续费。轻量 AI 次数由文献问答、总结、片段翻译及局部润色共用；每次选取正文最多 3,000 字符。整篇翻译按实际原文页数扣独立页数额度，不再扣轻量次数；额度不足时按本次积分报价执行。论文、检测、整篇修改、PPT 和排版单独计费。到期后保留文件，可继续下载。',
 membershipItems:[{key:'light-ai',title:'轻量 AI 共用次数',quantity:p.light},{key:'translation-pages',title:'整篇翻译',quantity:p.pages},{key:'parse-pages',title:'PDF 解析',quantity:p.parse},{key:'cloud-mb',title:'云文件容量',quantity:p.storage}]})));
