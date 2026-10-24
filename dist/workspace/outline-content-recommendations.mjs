import {isOutlineReferenceChapter} from './outline-word-budget.mjs';

const flags=['table','image','formula','code'];
const empty=()=>Object.fromEntries(flags.map(key=>[key,false]));
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'?value.trim().toLowerCase():'';
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:0;
const normalize=value=>Object.fromEntries(flags.map(key=>[key,record(value)&&value[key]===true]));
function copy(value,seen=new Map()){
 if(value===null||typeof value!=='object')return value;
 if(seen.has(value))return seen.get(value);
 if(value instanceof Date)return new Date(value.getTime());
 const result=Array.isArray(value)?[]:{};seen.set(value,result);
 for(const [key,entry]of Object.entries(value))Object.defineProperty(result,key,{value:copy(entry,seen),writable:true,enumerable:true,configurable:true});
 return result;
}
function title(value){
 return text(value).replace(/^(?:第\s*[一二三四五六七八九十百零〇\d]+\s*[章节篇部]\s*[、.．:：\-]?\s*|chapter\s+[\divxlcdm]+\s*[.:：\-]?\s*|\d+(?:[.．]\d+)*\s*[、.．:：)）\-]\s*|\d+(?:\.\d+)*\s+)/i,'').trim();
}
const frontMatter=value=>/^(?:摘要|abstract\b|关键词|key\s*words?\b|目录|table\s+of\s+contents\b|contents\b|致谢|acknowledg(?:e)?ments?\b)/i.test(value);
const introductory=value=>/绪论|引言|导论|序言|研究背景|选题背景|研究意义|结论|结语|总结|展望|\b(?:introduction|background|conclusions?|outlook|acknowledgments?)\b/i.test(value);
const computational=/计算机|软件|编程|程序(?:设计|开发)|算法|机器学习|深度学习|人工智能|数据科学|数据挖掘|图像处理|自然语言处理|\b(?:computer|software|programming|algorithm|machine\s+learning|deep\s+learning|data\s+science|python|javascript|typescript|matlab|pytorch|tensorflow)\b/i;
const quantitative=/数学|统计|计量|量化|定量|概率|回归|机器学习|深度学习|数据科学|计算机|人工智能|\b(?:mathematical|statistics?|econometric|quantitative|probability|regression|machine\s+learning|data\s+science|optimization)\b/i;
const tableStrong=/对比|比较|变量|参数|分类|概念(?:界定|定义)|术语|特征|指标(?:体系|定义|说明|列表)|评价(?:标准|维度|体系)|评估(?:标准|指标)|维度|样本(?:描述|特征)|数据(?:描述|统计|分析|结果|清洗|预处理)|结果(?:分析|比较|汇总)|实验(?:结果|分析)|研究(?:计划|进度)|\b(?:comparison|comparative|variables?|parameters?|classification|definitions?|features?|criteria|indicators?|metrics?|descriptive\s+statistics|results?\s+analys\w*|dataset)\b/i;
const tablePrimary=/对比|比较|变量|概念(?:界定|定义)|结果(?:分析|比较|汇总)|实验(?:结果|分析)|\b(?:comparison|comparative|variables?|results?\s+analys\w*)\b/i;
const imageStrong=/技术路线|流程|系统(?:架构|结构)|总体架构|体系架构|架构|框架(?:设计|构建|结构)|机制|作用路径|因果(?:关系|路径)|人物关系|概念(?:关系|模型)|关系(?:模型|结构|网络)|叙事结构|\b(?:workflow|flowchart|pipeline|architecture|framework|mechanism|causal|conceptual\s+(?:model|relationship)|relationship\s+(?:model|network))\b/i;
const imageMethod=/研究(?:设计|方法)|方法(?:设计|步骤)|实验设计|试验设计|系统设计|总体设计|\b(?:methodology|research\s+design|experimental\s+design|system\s+design)\b/i;
const formulaStrong=/公式|方程|(?:损失|目标|概率|数学|优化)函数|函数(?:计算|推导|表达式)|数学(?:模型|推导|表达)|模型推导|定量(?:模型|分析)|量化模型|指标(?:计算|推导)|回归(?:模型|分析)|统计(?:模型|检验|推断)|概率(?:模型|分布)|相关(?:系数|分析)|\b(?:equations?|formulas?|derivation|loss\s+function|objective\s+function|mathematical\s+model|quantitative\s+model|regression|statistical\s+(?:model|test))\b/i;
const codeExplicit=/伪代码|程序实现|代码(?:示例|片段|实现|编写|生成|清单)|(?:示例|实现|编写|生成)(?:程序)?代码|\b(?:source\s*code|code\s+(?:example|snippet|implementation)|pseudocode)\b/i;
const codeWork=/算法|实现|预处理|数据清洗|训练(?:流程|实现)?|仿真(?:实现|程序)|\b(?:algorithm|implementation|preprocess\w*|data\s+cleaning|training)\b/i;

function scores(leaf,parent,context){
 const own=title(leaf.title),above=title(parent?.title),domain=context+' '+own+' '+above,result={};
 if(tablePrimary.test(own))result.table=10;
 else if(tableStrong.test(own))result.table=8;
 else if(tableStrong.test(above)&&/方法|设计|步骤|对象|定义|\b(?:methods?|design|steps?|definition)\b/i.test(own))result.table=4;
 if(imageStrong.test(own))result.image=10;
 else if(imageMethod.test(own))result.image=7;
 else if(imageStrong.test(above)&&/步骤|结构|关系|组织|设计|\b(?:steps?|structure|relations?|design)\b/i.test(own))result.image=4;
 if(formulaStrong.test(own))result.formula=12;
 else if(quantitative.test(domain)&&/函数|模型(?:构建|建立|设计|定义|训练)|指标(?:定义|设计)|性能(?:评估|评价)|\b(?:functions?|model\s+(?:design|development|training)|metric\s+definition)\b/i.test(own))result.formula=6;
 if(codeExplicit.test(own))result.code=12;
 else if(computational.test(domain)&&(codeWork.test(own)||/代码|\bcode\b/i.test(own)))result.code=10;
 return result;
}
function limits(count,target){
 const scale=target<=1500?0:target<=5000?1:target<=15000?2:3;
 return {table:Math.min(8,Math.max(1,Math.ceil(count/3)),[1,3,5,8][scale]),image:Math.min(4,Math.max(1,Math.ceil(count/5)),[1,2,3,4][scale]),formula:Math.min(6,Math.max(1,Math.ceil(count/3)),[1,2,3,6][scale]),code:Math.min(4,Math.max(1,Math.ceil(count/4)),[1,2,3,4][scale])};
}

// Recommendations only grant permission for an appropriate element. They do
// not create evidence, require an element, render a picture or execute code.
// Call on explicit outline adoption/assignment, never during render or restore.
export function applyOutlinePresentationRecommendations(chapters,snapshot={}){
 const result=copy(Array.isArray(chapters)?chapters:[]),leaves=[];
 for(const chapter of result){
  if(!record(chapter))continue;
  const children=Array.isArray(chapter.sections)?chapter.sections:[],reference=isOutlineReferenceChapter(chapter);
  if(children.length||reference)chapter.presentation=empty();
  if(children.length){for(const section of children)if(record(section))leaves.push({leaf:section,parent:chapter,reference:reference||isOutlineReferenceChapter(section)});}
  else leaves.push({leaf:chapter,parent:null,reference});
 }
 const profile=record(snapshot?.profile)?snapshot.profile:{},context=[snapshot?.title,profile.discipline,profile.major,profile.method].map(text).join(' '),bodyLeaves=leaves.filter(row=>!row.reference),target=positive(profile.targetWords)||bodyLeaves.reduce((sum,{leaf})=>sum+positive(leaf.targetWords),0)||8000;
 const existing=empty(),eligible=[];
 for(const key of flags)existing[key]=0;
 for(const entry of leaves){
  const {leaf,reference}=entry,provided=leaf.presentation!==undefined;
  if(reference){leaf.presentation=empty();continue;}
  if(provided){leaf.presentation=normalize(leaf.presentation);for(const key of flags)if(leaf.presentation[key])existing[key]++;continue;}
  leaf.presentation=empty();
  const own=title(leaf.title),words=positive(leaf.targetWords)||target/Math.max(1,bodyLeaves.length);
  if(!own||frontMatter(own)||introductory(own)||words<250)continue;
  eligible.push({...entry,words,scores:scores(leaf,entry.parent,context)});
 }
 const caps=limits(eligible.length,target),assigned=new Map(),candidates=eligible.flatMap((entry,index)=>flags.filter(key=>entry.scores[key]).map(key=>({entry,index,key,score:entry.scores[key]})));
 candidates.sort((a,b)=>b.score-a.score||a.index-b.index||flags.indexOf(a.key)-flags.indexOf(b.key));
 for(const {entry,key}of candidates){
  const perLeaf=entry.words<500?1:2,count=assigned.get(entry.leaf)||0;
  if(existing[key]>=caps[key]||count>=perLeaf)continue;
  entry.leaf.presentation[key]=true;existing[key]++;assigned.set(entry.leaf,count+1);
 }
 return result;
}
