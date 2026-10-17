import {isOutlineReferenceChapter} from './outline-word-budget.mjs';

export const outlineChapters=['第一章　绪论','　1.1 研究背景与意义','　1.2 研究问题与研究目标','第二章　文献综述与理论基础','　2.1 相关研究进展','　2.2 理论基础','第三章　研究设计','　3.1 研究方法与研究对象','　3.2 数据来源与分析思路','第四章　结果与讨论（依据实际研究填写）','第五章　结论与展望','参考文献（填写真实来源）'];
export function buildOutline(v){return [v.title,`${v.mode} · ${v.degree} · ${v.major||'学科待填写'}`,'',...outlineChapters,v.language?'写作语言：'+v.language:'','',v.targetWords?'目标字数：'+v.targetWords+' 字':'',v.method?'研究方法：'+v.method:'',v.requirements?'研究要求：'+v.requirements:'','本地结构模板：请依据真实研究完善；未调用 AI 或分析参考材料。'].filter(Boolean).join('\n');}
export function reconcileSections(outline,previous=[]){const titles=[...new Set(outline.split('\n').map(l=>l.trim()).filter(l=>/^(?:第[^\s]{1,12}章|Chapter\s+(?:[IVXLCDM]+|\d+)\b)/i.test(l)||/^(?:参考文献|References|Bibliography)/i.test(l)))];if(!titles.length)titles.push('正文');const next=titles.map(title=>{const old=previous.find(s=>s.title===title);return {id:old?.id||crypto.randomUUID(),title,text:old?.text||'',retained:false};});return [...next,...previous.filter(s=>!titles.includes(s.title)&&s.text.trim()).map(s=>({...s,retained:true}))];}
export function composeBody(v,sections){return [v.title,`${v.mode} · ${v.degree} · ${v.major||'学科待填写'}`,...sections.filter(s=>s.text.trim()).flatMap(s=>['',s.title,s.text])].join('\n');}

// This is the explicitly confirmed local draft, not a claim that sources were verified.
export function thesisSnapshotFromDraft(draft={}){
 const clean=value=>String(value??'').trim();
 const sourceIds=(rows,prefix)=>{const used=new Map();return rows.map((row,index)=>{const raw=clean(row.id)||`item-${index+1}`,safe=raw.replace(/[^\p{L}\p{N}_.:-]/gu,'_').slice(0,65);let hash=2166136261;for(const char of raw)hash=Math.imul(hash^char.codePointAt(0),16777619);const base=`${prefix}:${safe}-${(hash>>>0).toString(16)}`,count=(used.get(base)||0)+1;used.set(base,count);return {...row,id:base+(count>1?'-'+count:'')};});};
 const level=clean(draft.degree)==='科研人员'?'研究工作者':clean(draft.degree)||'本科';
 const targetWords=clean(draft.targetWords)===''?8000:Number(draft.targetWords);
 if(!Number.isSafeInteger(targetWords)||targetWords<500||targetWords>80000)throw Error('在线论文目标字数须为 500–80,000 字，请返回基础信息调整。');
 const outline=[];
 for(const row of draft.outlineRows||[]){
  const entry={id:clean(row.id),title:clean(row.title),targetWords:Math.max(0,Number(row.words)||0),...(isOutlineReferenceChapter(row)?{kind:'references'}:{})};
  if(!entry.title)throw Error('提纲中还有空标题，请返回提纲确认步骤。');
  if(Number(row.level)===2&&outline.length)(outline.at(-1).sections??=[]).push(entry);else outline.push(entry);
 }
 for(const chapter of outline)if(chapter.sections?.length&&!chapter.targetWords)chapter.targetWords=chapter.sections.reduce((sum,section)=>sum+section.targetWords,0);
 if(!outline.length)throw Error('请先确认至少一个论文章节。');
 if(outline.length>30||outline.reduce((n,c)=>n+(c.sections?.length||1),0)>120)throw Error('在线论文最多支持 30 章、120 个写作单元，请调整提纲。');
 const materials=sourceIds((draft.knowledgeFiles||[]).filter(row=>clean(row.text)),'material').map(row=>({id:row.id,name:clean(row.name)||'研究资料',text:clean(row.text),purpose:clean(row.purpose)||'研究背景',confirmed:true}));
 if(!materials.length&&clean(draft.material))materials.push({id:'material:local-material',name:clean(draft.fileName)||'研究说明',text:clean(draft.material),purpose:clean(draft.materialPurpose)||'研究背景',confirmed:true});
 const references=sourceIds(draft.writingReferences||[],'reference').map(row=>({id:row.id,title:clean(row.title),authors:clean(row.authors),year:/^\d{4}$/.test(clean(row.year))?clean(row.year):'',doi:clean(row.doi),url:clean(row.url),text:clean(row.text),sourceLabel:clean(row.sourceLabel)||clean(row.source)||'用户导入，未核验来源',confirmed:true}));
 if([...materials,...references].reduce((n,row)=>n+row.text.length,0)>100000)throw Error('选中资料正文超过 100,000 字符，请减少材料后再保存。');
 // An edited AI method proposal stays a plan, never a confirmed source of research facts.
 const methodSuggestion=draft.methodSuggestion&&typeof draft.methodSuggestion==='object'?draft.methodSuggestion:{},researchPlanText=clean(methodSuggestion.text);
 if(researchPlanText.length>12000)throw Error('拟采用的方法建议最多 12,000 字符，请精简后再保存。');
 const researchPlan=researchPlanText?{text:researchPlanText,origin:'ai',status:'proposed',jobId:clean(methodSuggestion.jobId)}:null;
 return {title:clean(draft.title),profile:{level,discipline:clean(draft.discipline)||clean(draft.major),major:clean(draft.major),direction:clean(draft.direction),method:clean(draft.method),researchQuestion:clean(draft.researchQuestion),language:draft.language==='英文'?'English':'中文',targetWords},requirements:{institution:clean(draft.institution),supervisor:clean(draft.supervisor),format:clean(draft.formatTemplateName),...(['text','rich'].includes(draft.formula)?{contentMode:draft.formula}:{}),...(researchPlan?{researchPlan}:{})},materials,references,outline,bodySections:(draft.bodySections||[]).filter(section=>clean(section.text)).map(section=>({id:clean(section.id),title:clean(section.title),text:String(section.text)}))};
}
