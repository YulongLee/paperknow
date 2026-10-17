export const writingFlowSpecs=Object.freeze({
 proposal:{title:'开题报告',steps:['基础信息填写','精准知识补充','确定参考文献','确定开题提纲','确认生成版本'],panels:['basic','materials','references','outline','result'],outline:['选题背景与研究意义','研究目标与内容','拟采用的方法与技术路线','研究计划与预期成果']},
 summary:{title:'文献综述',steps:['基础信息填写','确定参考文献','确定综述提纲','确认生成版本'],panels:['basic','references','outline','result'],outline:['综述范围与检索方法','主要研究主题与证据比较','研究局限与未来方向']},
 taskbook:{title:'任务书',steps:['基础信息填写','确定参考文献','确定任务书提纲','确认生成版本'],panels:['basic','references','outline','result'],outline:['任务背景与目标','主要任务与技术要求','进度安排与交付成果']},
 article:{title:'期刊文章',steps:['基础信息填写','精准知识补充','确定参考文献','确定期刊提纲','确认生成版本'],panels:['basic','materials','references','outline','result'],outline:['研究背景与问题','研究依据与方法','讨论、局限与结论']},
 course:{title:'课程作业',steps:['基础信息填写','精准知识补充','确定参考文献','确定课程提纲','确认生成版本'],panels:['basic','materials','references','outline','result'],outline:['任务理解与问题界定','资料与案例分析','讨论与学习总结']},
 practice:{title:'实践报告',steps:['基础信息填写','生成实践报告'],panels:['basic','result'],outline:['实践目标与实际过程','实践观察、反思与改进']},
 idea:{title:'课题思路',steps:['基础信息填写','获得题目及研究思路'],panels:['basic','ideas'],outline:[]},
 quick:{title:'快速写作',steps:['输入标题 / 关键字','生成摘要','生成提纲','生成文章'],panels:['basic','abstract','outline','result'],outline:['主题与背景','内容展开','讨论与结语']}
});
export const writingFlowKind=kind=>kind==='topic'?'idea':kind;
export function writingFlowSpec(kind){return writingFlowSpecs[writingFlowKind(kind)];}
export const flowText=value=>String(value??'').trim();
export function flowOutlineRows(input){
 const rows=Array.isArray(input)?input:flowText(input).split(/\r?\n/).map(title=>({title}));
 return rows.filter(row=>flowText(row?.title??row)).slice(0,30).map((row,index)=>({id:flowText(row?.id)||'section-'+(index+1),title:flowText(row?.title??row).replace(/^\s*(?:\d+[.、．]|[-*])\s*/,''),targetWords:Math.max(0,Math.round(Number(row?.targetWords??row?.words)||0)),...(row?.kind==='references'?{kind:'references'}:{})}));
}
export function flowAllocate(rows,target){
 const body=rows.filter(row=>row.kind!=='references'&&!/^(?:参考文献|参考资料|references|bibliography)/i.test(row.title)),total=body.reduce((n,row)=>n+(row.targetWords||1),0);let used=0;
 const raw=body.map((row,index)=>{const exact=(row.targetWords||1)/total*target,words=Math.floor(exact);used+=words;return {index,words,fraction:exact-words};});
 [...raw].sort((a,b)=>b.fraction-a.fraction||a.index-b.index).slice(0,target-used).forEach(row=>row.words++);
 const map=new Map(body.map((row,index)=>[row.id,raw[index].words]));
 return rows.map(row=>({...row,targetWords:map.get(row.id)||0}));
}
export function writingFlowSnapshot(kind,data){
 kind=writingFlowKind(kind);const spec=writingFlowSpec(kind);if(!spec)throw Error('没有找到该写作功能。');
 const title=flowText(data.title);if(title.length<2||title.length>200)throw Error('请填写 2–200 字的题目或研究方向。');
 const targetWords=Number(data.targetWords||1000);if(!Number.isSafeInteger(targetWords)||targetWords<200||targetWords>20000)throw Error('本次写作目标须为 200–20,000 的整数字数。');
 const materials=(data.materials||[]).filter(row=>flowText(row.text)).map(row=>({id:row.id,name:row.name,text:flowText(row.text),confirmed:true}));
 if(flowText(data.notes))materials.push({id:'user-notes',name:kind==='practice'?'用户实践记录':'用户补充说明',text:flowText(data.notes),confirmed:true});
 const references=(data.references||[]).map(row=>({...row,confirmed:true}));
 const instructions=[flowText(data.instructions),data.keywords?'关键词：'+data.keywords:'',data.practiceUnit?'实践单位：'+data.practiceUnit:'',data.practicePosition?'实践岗位：'+data.practicePosition:'',data.practiceStart?'开始日期：'+data.practiceStart:'',data.practiceEnd?'结束日期：'+data.practiceEnd:'',data.reportType?'报告类型：'+data.reportType:'',data.journal?'目标期刊 / 课程：'+data.journal:''].filter(Boolean).join('\n');
 return {title,profile:{level:data.level||'本科',major:flowText(data.major),language:data.language||'中文',targetWords},requirements:{instructions,...(flowText(data.researchPlan)?{researchPlan:{text:flowText(data.researchPlan),origin:'ai',status:'proposed'}}:{})},materials,references,outline:flowAllocate(flowOutlineRows(data.outline||[]),targetWords),abstract:flowText(data.abstract)};
}
export function migrateWritingFlow(kind,old={}){
 const spec=writingFlowSpec(kind),saved=old.writingFlow;
 if(saved&&saved.version===1)return structuredClone(saved);
 const note=old.writingEditorState?.inputs?.['knowledge-ai-input']??'';
 return {version:1,stage:0,title:old.title||'',level:old.degree||'本科',major:old.major||'',language:old.language||'中文',targetWords:Number(old.targetWords)||1000,notes:note,instructions:old.requirements||'',materials:(old.knowledgeFiles||[]).filter(row=>row.kind!=='ai'),references:old.writingReferences||[],outline:flowOutlineRows(old.outlineRows?.length?old.outlineRows:old.outlineText||''),outlineConfirmed:!!old.outlineConfirmed,body:old.bodySections?.filter(row=>row.text?.trim()).map(row=>row.title+'\n'+row.text).join('\n\n')||(['body','export','completed'].includes(old.stage)?old.text||'':''),abstract:'',jobs:{},versions:[],completed:[],...(spec?{}:{})};
}
