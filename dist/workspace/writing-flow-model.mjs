import {writingStandardBrief} from './writing-standard.mjs';
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
const flowLevel=value=>flowText(value)==='科研人员'?'研究工作者':flowText(value)||'本科';
const flowLanguage=value=>/^(?:英文|英语|english)$/i.test(flowText(value))?'English':flowText(value)||'中文';
export const journalTiers=['普通','中文核心','SCI'];
export const articleResearchTypes=['不限','定量','定性','混合','理论','应用','案例','比较','实验'];
export const ideaAdvancedFields=[['workExperience','工作经历',200],['workLocation','学习 / 工作地点',200],['researchObjective','研究目标',2000],['researchQuestion','研究问题',100],['researchMethod','拟采用方法',1000],['expectedOutputs','预期成果',100],['supervisorMajor','导师专业',100],['supervisorPublicationDirection','导师发表方向',100],['supervisorResearchField','导师研究领域',100]];
export function flowWordSuggestions(kind,data={}){
 kind=writingFlowKind(kind);if(kind==='proposal')return[5000];if(kind==='summary')return[({专科:5000,本科:5000,硕士:10000,博士:15000})[flowLevel(data.level)]||10000];
 if(kind==='article')return data.journalTier==='SCI'?[8000,15000]:data.journalTier==='中文核心'?[8000,15000]:[3000,8000];
 if(kind==='course')return[5000,10000];if(kind==='practice')return[3000,5000];if(kind==='quick')return[10000,15000];return[1000,2000,3000];
}
export function flowDefaultWords(kind,data={}){return writingFlowKind(kind)==='article'&&data.journalTier==='SCI'?15000:flowWordSuggestions(kind,data)[0];}
export function flowWordState(kind,data={}){
 const raw=flowText(data.targetWords),automatic=data.targetWordsMode==='suggested'&&Number(raw)===flowDefaultWords(kind,data);
 if(data.targetWordsMode==='manual')return{targetWords:data.targetWords,targetWordsMode:'manual'};
 return raw===''||automatic?{targetWords:flowDefaultWords(kind,data),targetWordsMode:'suggested'}:{targetWords:data.targetWords,targetWordsMode:'manual'};
}
function flowExtraInstructions(kind,data){
 const lines=[];
 if(kind==='article'&&(data.journalTier!==undefined||data.researchType!==undefined)){
  const tier=data.journalTier??'普通',type=data.researchType??'不限';if(!journalTiers.includes(tier)||!articleResearchTypes.includes(type))throw Error('请选择支持的期刊层次与研究类型。');
  lines.push('期刊层次：'+tier,'研究类型：'+type,'以上仅用于写作定位，不代表符合期刊要求或保证投稿、录用与发表。');
 }
 if(kind==='idea'){
  if(data.academicPurpose&&!['学位','职称','发表'].includes(data.academicPurpose))throw Error('请选择支持的选题用途。');
  if(data.academicPurpose)lines.push('选题用途：'+data.academicPurpose);
  for(const [key,label,max]of ideaAdvancedFields){const value=flowText(data[key]);if(value.length>max)throw Error(`${label}最多 ${max.toLocaleString('zh-CN')} 字符。`);if(value)lines.push(label+'：'+value);}
  if(lines.length)lines.push('上述经历、目标、问题与导师信息仅用于拟选题条件，不代表研究已实施或成果已验证。');
 }
 return lines;
}
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
 const targetWords=Number(data.targetWords===undefined?flowDefaultWords(kind,data):data.targetWords);if(!Number.isSafeInteger(targetWords)||targetWords<200||targetWords>20000)throw Error('本次写作目标须为 200–20,000 的整数字数。');
 const materials=(data.materials||[]).filter(row=>flowText(row.text)).map(row=>({id:row.id,name:row.name,text:flowText(row.text),confirmed:true}));
 if(flowText(data.notes))materials.push({id:'user-notes',name:kind==='practice'?'用户实践记录':'用户补充说明',text:flowText(data.notes),confirmed:true});
 const references=(data.references||[]).map(row=>({...row,confirmed:true}));
 const instructions=[flowText(data.instructions),...[writingStandardBrief(kind,data)].filter(Boolean),...flowExtraInstructions(kind,data),data.keywords?'关键词：'+data.keywords:'',data.practiceUnit?'实践单位：'+data.practiceUnit:'',data.practicePosition?'实践岗位：'+data.practicePosition:'',data.practiceStart?'开始日期：'+data.practiceStart:'',data.practiceEnd?'结束日期：'+data.practiceEnd:'',data.reportType?'报告类型：'+data.reportType:'',data.journal?'目标期刊 / 课程：'+data.journal:''].filter(Boolean).join('\n');
 if(instructions.length>12000)throw Error('写作要求和可选研究信息合计最多 12,000 字符，请精简后再生成。');
 return {title,profile:{level:flowLevel(data.level),major:flowText(data.major),language:flowLanguage(data.language),targetWords},requirements:{instructions,...(data.outputCount!==undefined?{outputCount:Number(data.outputCount)}:{}),...(data.scalePoints!==undefined?{scalePoints:Number(data.scalePoints)}:{}),...(flowText(data.researchPlan)?{researchPlan:{text:flowText(data.researchPlan),origin:'ai',status:'proposed'}}:{})},materials,references,outline:flowAllocate(flowOutlineRows(data.outline||[]),targetWords),abstract:flowText(data.abstract)};
}
export function migrateWritingFlow(kind,old={}){
 const spec=writingFlowSpec(kind),saved=old.writingFlow;
 if(saved&&saved.version===1){const value={...structuredClone(saved),level:flowLevel(saved.level),language:flowLanguage(saved.language)};return{...value,...flowWordState(kind,value)};}
 const note=old.writingEditorState?.inputs?.['knowledge-ai-input']??'';
 const fresh=!old.id&&!old.title&&old.targetWords===undefined,value={version:1,stage:0,title:old.title||'',level:flowLevel(old.degree),major:old.major||'',language:flowLanguage(old.language),targetWords:old.targetWords,notes:note,instructions:old.requirements||'',materials:(old.knowledgeFiles||[]).filter(row=>row.kind!=='ai'),references:old.writingReferences||[],outline:flowOutlineRows(old.outlineRows?.length?old.outlineRows:old.outlineText||''),outlineConfirmed:!!old.outlineConfirmed,body:old.bodySections?.filter(row=>row.text?.trim()).map(row=>row.title+'\n'+row.text).join('\n\n')||(['body','export','completed'].includes(old.stage)?old.text||'':''),abstract:'',jobs:{},versions:[],completed:[],...(fresh&&writingFlowKind(kind)==='article'?{journalTier:'普通',researchType:'不限'}:{}),...(fresh&&writingFlowKind(kind)==='idea'?{academicPurpose:'学位'}:{}),...(spec?{}:{})};return{...value,...flowWordState(kind,value)};
}
