import {workspaceJobLabel} from './workspace-job-model.mjs';

// Include in-progress account theses, not only exported final results.
export function accountOverviewItems(data={},toolConfigs={}){
 const theses=data.theses||[],thesisIds=new Set(theses.map(row=>row.id));
 const drafts=(data.drafts||[]).map(row=>({id:row.id,title:row.title,tool:row.tool,kind:toolConfigs[row.tool]?.[0]||'研究草稿',stamp:Date.parse(row.updated_at)||0,url:'#account-draft/'+encodeURIComponent(row.id),projectId:row.project_id,type:'draft'}));
 const papers=theses.map(row=>({id:row.id,title:row.title,tool:'writing',kind:'毕业论文 · '+({draft:'草稿已保存',queued:'排队中',running:'生成中',completed:'已生成',failed:'待继续',cancelled:'已取消',interrupted:'待继续',needs_materials:'待补充资料',budget_exceeded:'待补充额度'}[row.status]||'已保存'),stamp:Date.parse(row.updatedAt)||0,url:'#thesis/'+encodeURIComponent(row.id),projectId:row.projectId,type:'thesis'}));
 const results=(data.results||[]).filter(row=>!row.thesis_id||!thesisIds.has(row.thesis_id)).map(row=>({id:row.id,title:row.title,tool:row.thesis_id?'writing':['compare','web_similarity'].includes(row.type)?'check':row.tool_kind==='presentation'||row.tool_operation==='ppt'?'ppt':row.writing_kind||({parse:'reading',document_parse:'reading',document_translation:'translation'})[row.type]||'rewrite',kind:row.thesis_id?'毕业论文':workspaceJobLabel(row),stamp:Date.parse(row.created_at)||0,url:row.thesis_id?'#thesis/'+encodeURIComponent(row.thesis_id):'#assets?scope=account&result='+encodeURIComponent(row.id),projectId:row.project_id,type:row.thesis_id?'thesis':'report'}));
 return [...drafts,...papers,...results].sort((a,b)=>b.stamp-a.stamp);
}
