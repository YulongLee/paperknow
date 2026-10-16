// These are fixed product identities, never account or document metadata.
// Both the writing entry cards and detail banners use the same canonical key.
const definitions=[
 ['writing','毕业论文','论文与报告','blue','#5377dc','完整论文结构与章节写作','章节框架 · 可编辑草稿','分步写作'],
 ['proposal','开题报告','论文与报告','violet','#8871cc','研究背景、目标与方法梳理','背景目标 · 研究方法框架','开题准备'],
 ['summary','文献综述','论文与报告','teal','#4b9d9a','归纳文献脉络与研究空白','文献脉络 · 综述草稿','文献整理'],
 ['taskbook','任务书','论文与报告','gold','#b6975b','拆解研究任务与时间计划','任务拆解 · 时间计划','研究计划'],
 ['article','期刊文章','论文与报告','cyan','#5c94bf','面向投稿的文章结构整理','文章结构 · 投稿准备草稿','期刊写作'],
 ['course','课程作业','论文与报告','sage','#659f85','按课程要求完成研究作业','课程研究 · 作业框架','课程任务'],
 ['practice','实践报告','论文与报告','coral','#bf8d71','整理实践过程与成果反思','实践记录 · 总结反思草稿','实践总结'],
 ['idea','课题思路','研究准备','amber','#c69c4c','从问题出发形成研究计划','问题梳理 · 可行性计划','选题思路'],
 ['questionnaire','问卷设计','研究准备','lilac','#9b7eb8','设计问题、维度与答题说明','问题维度 · 问卷草稿','问卷准备'],
 ['analysis','数据分析','研究准备','indigo','#6484b8','整理变量、样本与分析计划','变量梳理 · 分析计划','分析规划'],
 ['quick','快速写作','研究准备','rose','#bf7c8d','快速生成可编辑的写作框架','写作提纲 · 可编辑框架','快速起步']
];
const mix=(hex,weight,toward)=>'#'+[1,3,5].map(at=>Math.round(parseInt(hex.slice(at,at+2),16)*weight+toward*(1-weight)).toString(16).padStart(2,'0')).join('');
export const writingFeatureIdentities=Object.freeze(Object.fromEntries(definitions.map(([key,title,group,tone,accent,description,output,tag])=>[key,Object.freeze({
 key,title,group,tone,accent,soft:mix(accent,.1,255),ink:mix(accent,.68,0),art:`/workspace/assets/writing-${key}-v1.webp`,description,output,tag
})])));
export const writingFeatureKeys=Object.freeze(definitions.map(([key])=>key));
export function getWritingFeatureIdentity(id){const key=id==='topic'?'idea':id;return Object.hasOwn(writingFeatureIdentities,key)?writingFeatureIdentities[key]:writingFeatureIdentities.writing;}
export function writingFeatureStyle(id){const feature=getWritingFeatureIdentity(id);return `--task-accent:${feature.accent};--task-soft:${feature.soft};--task-ink:${feature.ink}`;}
