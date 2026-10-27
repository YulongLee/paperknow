const writingNames={writing:'毕业论文',proposal:'开题报告',summary:'文献综述',taskbook:'任务书',article:'期刊文章',course:'课程作业',practice:'实践报告',idea:'课题思路',topic:'课题思路',questionnaire:'问卷设计',analysis:'数据分析',quick:'快速写作'};
const writingOperations={method:'方法建议',outline:'提纲生成',draft:'正文生成',abstract:'摘要生成',ideas:'题目及研究思路',questionnaire:'问卷草稿'};
const toolNames={image:'AI 科研绘图',read:'文献解读',answer:'原文问答',translate:'文献翻译',rewrite:'学术表达优化',ppt:'演示文稿创作',chart:'图表配置',diagram:'科研结构示意图',formula:'公式辅助',format:'格式建议'};
const jobNames={document_translation:'整篇文档翻译',document_parse:'PDF 云解析',parse:'正文解析',polish:'学术润色',review:'导师意见修改',web_similarity:'联网来源查重',aigc_detection:'AI 文本鉴别',compare:'材料查重',agent:'科研智能助手',thesis:'毕业论文撰写',thesis_outline:'论文提纲生成',thesis_method:'研究方法建议'};
export function workspaceJobLabel(row){
 if(row?.type==='writing')return[writingNames[row.writing_kind||row.kind]||'AI 写作',writingOperations[row.writing_operation||row.operation]||'写作任务'].join(' · ');
 if(row?.type==='tool_run')return toolNames[row.tool_operation||row.operation]||'科研工具任务';
 return jobNames[row?.type]||'研究任务';
}
export const workspaceJobActive=row=>['preparing','queued','running'].includes(typeof row==='string'?row:row?.status);
export const workspaceJobStatusLabel=status=>({draft:'草稿',partial:'部分完成',preparing:'保存中',queued:'排队中',running:'处理中',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断',needs_materials:'待补充资料',budget_exceeded:'额度不足'})[status]||'状态待核对';
export function workspaceJobHref(row){
 const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
 if(row?.type==='aigc_detection'&&safe(row.id))return'#category/detection?view=ai&report='+encodeURIComponent(row.id);
 if(row?.type==='web_similarity'&&safe(row.id))return'#category/detection?view=web&report='+encodeURIComponent(row.id);
 if(row?.type==='thesis'&&safe(row.thesis_id))return'#thesis/'+encodeURIComponent(row.thesis_id);
 if(row?.type==='tool_run'&&(row.tool_operation==='ppt'||row.operation==='ppt'||row.tool_kind==='presentation'||row.kind==='presentation')&&safe(row.id))return'#tool/ppt?job='+encodeURIComponent(row.id);
 if(row?.status==='completed'&&safe(row.result_id))return'#assets?scope=account&result='+encodeURIComponent(row.result_id);
 if(['thesis','thesis_outline','thesis_method'].includes(row?.type))return'#tool/writing';
 if(row?.type==='writing')return writingNames[row.writing_kind||row.kind]?'#tool/'+(row.writing_kind||row.kind):'#category/writing';
 if(['polish','review','agent'].includes(row?.type))return'#tool/'+row.type;
 if(row?.type==='compare')return'#category/detection';
 if(row?.type==='document_translation')return'#tool/translation';
 if(row?.type==='document_parse'||row?.type==='parse')return'#projects?scope=account';
 if(row?.type==='tool_run'){
  if(row.tool_operation==='ppt'||row.operation==='ppt'||row.tool_kind==='presentation'||row.kind==='presentation')return'#tool/ppt'+(safe(row.id)?'?job='+encodeURIComponent(row.id):'');
  return({literature:'#category/literature',revision:'#category/reduce',format:'#category/format',research:'#category/research'})[row.tool_kind||row.kind]||'#category/research';
 }
 return'#tasks?scope=account';
}
