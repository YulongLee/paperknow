export const adminTaskTypes=Object.freeze({parse:'正文解析',polish:'学术润色',review:'意见修改',compare:'材料比对',agent:'科研智能助手',thesis:'毕业论文撰写',thesis_outline:'论文提纲生成',thesis_method:'研究方法建议',writing:'AI写作任务',tool_run:'科研工具任务',document_parse:'PDF文献处理',document_translation:'整篇文档翻译',web_similarity:'论文重复率检测',aigc_detection:'论文AI率检测',detection_combined:'论文联合检测'});
export const adminWritingKinds=Object.freeze({writing:'毕业论文',proposal:'开题报告',summary:'文献综述',taskbook:'任务书',article:'期刊文章',course:'课程作业',practice:'实践报告',idea:'课题思路',questionnaire:'问卷设计',analysis:'数据分析',quick:'历史快速写作'});
export const adminWritingOperations=Object.freeze({method:'方法建议',outline:'提纲生成',draft:'正文生成',abstract:'摘要生成',ideas:'题目与研究思路',questionnaire:'问卷草稿'});
export const adminToolOperations=Object.freeze({read:'文献解读',answer:'原文问答',translate:'文献翻译',rewrite:'学术表达优化',ppt:'PPT创作',chart:'科研图表配置',diagram:'科研结构示意图',formula:'公式辅助',image:'科研绘图',format:'格式排版'});
const lookup=(map,key,fallback)=>Object.hasOwn(map,key)?map[key]:fallback;
export function adminTaskLabel(row={}){
 if(row.type==='writing')return lookup(adminWritingKinds,row.writing_kind,'AI写作')+' · '+lookup(adminWritingOperations,row.writing_operation,'写作任务');
 if(row.type==='tool_run')return lookup(adminToolOperations,row.tool_operation,'科研工具任务');
 return lookup(adminTaskTypes,row.type,'其他任务');
}
export function adminTaskSearch(query){
 const q=String(query).toLowerCase(),matching=map=>Object.keys(map).filter(key=>(key+' '+map[key]).toLowerCase().includes(q));
 return {types:matching(adminTaskTypes),kinds:matching(adminWritingKinds),writingOperations:matching(adminWritingOperations),toolOperations:matching(adminToolOperations)};
}
