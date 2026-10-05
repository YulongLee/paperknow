export const projectTypes=['毕业论文','课程论文','科研课题','期刊论文','其他研究'];
export const projectStages=[['topic','选题'],['proposal','开题'],['writing','写作'],['revision','修改'],['detection','检测'],['defense','答辩']];
export function projectSummary(project,assets){
 const related=assets.filter(a=>a.projectId===project.id).sort((a,b)=>b.stamp-a.stamp),counts={};
 for(const a of related){const label=a.type==='report'?'报告':a.tool==='ppt'?(a.data?.presentation?.slides?.length?'演示文稿':'PPT 提纲'):['reading','summary','search','translation'].includes(a.tool)?'文献笔记':a.tool==='proposal'?'开题提纲':a.tool==='writing'?(a.data?.stage==='draft'?'草稿':'大纲'):a.kind||'其他成果';counts[label]=(counts[label]||0)+1;}
 return {related,counts,latest:related[0],activity:Math.max(Date.parse(project.updatedAt)||0,...related.map(a=>a.stamp||0))};
}
export function selectProjects(projects,assets,{status='all',query='',sort='activity'}={}){
 const q=query.trim().toLocaleLowerCase();return projects.filter(p=>(status==='all'||(status==='archived'?p.status==='archived':p.status!=='archived'))&&[p.name,p.description,p.major].some(v=>String(v||'').toLocaleLowerCase().includes(q))).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'zh-CN'):sort==='created'?(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0):projectSummary(b,assets).activity-projectSummary(a,assets).activity);
}
