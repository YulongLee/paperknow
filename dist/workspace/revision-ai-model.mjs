import {revisionReportContextForDocument,revisionReportChangeAllowed} from './revision-report-context.mjs';
import {editParagraph} from './revision-model.mjs';
import {revisionStrategy} from './revision-strategy.mjs';
import {validateRevisionOriginal,validateRevisionProtection} from './revision-protection.mjs';
import {normalizeConfirmedRevisionReport} from './revision-report-model.mjs';
import {revisionComparisonSnapshot} from './revision-comparison-model.mjs';
import {normalizeRevisionProduct} from './revision-product-model.mjs';
const fingerprint=parts=>{let value=2166136261;for(const point of JSON.stringify(parts.map(p=>[p.id,p.suggestion,p.reason,p.comment,p.accepted,p.resolved]))){value=Math.imul(value^point.charCodeAt(0),16777619)>>>0;}return value.toString(16);};
const changed=(original,revised)=>original.replace(/[\s\p{Default_Ignorable_Code_Point}]/gu,'')!==revised.replace(/[\s\p{Default_Ignorable_Code_Point}]/gu,'');
export function revisionAiSnapshot(doc,{scope='current',index=0,paragraphIds=doc?.aiSelection?.paragraphIds}={}){
 if(!doc?.paragraphs?.length)throw Error('请先导入或粘贴原文，创建修改稿。');
 if(!['current','all','selected'].includes(scope))throw Error('请选择当前段落、全部原文或明确勾选的段落。');
 revisionStrategy(doc.mode,doc.plan);
 const product=doc.revisionProduct?normalizeRevisionProduct(doc.revisionProduct,{mode:doc.mode,plan:doc.plan}):null;
 let parts;
 if(scope==='selected'){
  if(doc.aiSelection?.origin==='report')normalizeConfirmedRevisionReport(doc.reportAttachment,doc);
  if(!Array.isArray(paragraphIds)||!paragraphIds.length)throw Error('请先明确勾选要修改的原文段落。');
  if(paragraphIds.some(id=>typeof id!=='string'||!/^[-\p{L}\p{N}_.:]{1,160}$/u.test(id))||new Set(paragraphIds).size!==paragraphIds.length)throw Error('所选段落编号无效或重复，请重新选择。');
  const ids=new Set(paragraphIds);parts=doc.paragraphs.filter(part=>ids.has(part.id));if(parts.length!==ids.size)throw Error('所选原文段落已变化，请重新选择。');
 }else parts=scope==='all'?doc.paragraphs:[doc.paragraphs[index]];
 if(parts.some(p=>!p))throw Error('当前段落已变化，请重新选择。');
 if(parts.length>(product?500:120))throw Error(product?'本次最多处理 500 段，请核对文档分段。':'单次最多 120 段，请改选“当前段落”或缩小选区分次处理，不会遗漏或截断原稿。');
 if(parts.some(p=>p.original.trim().length>3500))throw Error('单段原文超过 3,500 字符，请先按自然段拆分后创建修改稿。');
 for(const part of parts)if(!validateRevisionOriginal(part.original.trim()).valid)throw Error('原文包含不完整的公式结构或无有效文字，请先核对该段原文。');
 const text=parts.map(p=>p.original.trim()).join('\n\n');if(text.length>(product?100000:32000))throw Error(product?'论文正文超过 100,000 字符，请按完整章节提交；不会截断原文。':'整稿超过单次 32,000 字符，请缩小所选段落或按“当前段落”分次处理，不会截断原稿。');
 const requirement=[doc.requirements,doc.plan==='dual'?'同时梳理重复表达与模板化句式，保留真实研究内容。':'',doc.plan==='english'?'保持英文专业术语，输出英文修改稿。':'',...parts.filter(p=>p.comment).map(p=>`${p.id} 待核对意见：${p.comment}`)].filter(Boolean).join('\n');
 const comparison=doc.mode==='rewrite'?revisionComparisonSnapshot(doc,parts):{materials:[]},report=revisionReportContextForDocument(doc,parts);
 if(requirement.length>3000)throw Error('本次修改要求及段落意见合计超过 3,000 字符，请精简后生成；原内容仍保留。');return {title:doc.title,text,requirements:requirement,mode:doc.mode,language:doc.plan==='english'||product&&(text.match(/[A-Za-z]/g)||[]).length>(text.match(/[\u3400-\u9fff]/g)||[]).length*2?'en':'zh-CN',materials:comparison.materials,context:{revisionId:doc.id,plan:doc.plan||'strong',scope,paragraphIds:parts.map(p=>p.id),editFingerprint:fingerprint(parts),...(product?{revisionProduct:product}:{}),...(report?{report}:{}),...(comparison.comparisonContext?{comparison:comparison.comparisonContext}:{})}};
}
export function applyRevisionAiOutput(doc,output,source){
 const ids=source?.context?.paragraphIds;if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||!output||!Array.isArray(output.paragraphs)||output.paragraphs.length!==ids.length)throw Error('修改结果缺少对应段落，不能覆盖当前稿。');
 const parts=ids.map(id=>doc.paragraphs.find(p=>p.id===id));if(parts.some(part=>!part)||parts.map(part=>part.original.trim()).join('\n\n')!==source.text)throw Error('原文已变化，请重新确认修改范围。');
 if(source.context.comparison){const current=revisionComparisonSnapshot(doc,parts);if(JSON.stringify(current.comparisonContext)!==JSON.stringify(source.context.comparison)||JSON.stringify(current.materials)!==JSON.stringify(source.materials))throw Error('对照文章或处理路径已变化，旧候选不能作为当前来源修改结果，请重新确认。');}
 if(source.context.report){const current=revisionReportContextForDocument(doc,parts);if(JSON.stringify(current)!==JSON.stringify(source.context.report))throw Error('报告定位已变化，旧候选不能用于当前报告，请重新确认。');}
 if(source.context.editFingerprint!==undefined&&source.context.editFingerprint!==fingerprint(parts))throw Error('当前段落已有人工编辑或采纳变化，旧候选不能覆盖，请重新确认。');
 // Validate the entire batch before adding any candidate to the document.
 const checked=output.paragraphs.map((part,i)=>{
  const original=parts[i].original.trim();if(part?.id!==ids[i]||part.original!==original||typeof part.revised!=='string'||!part.revised.trim()||part.revised.length>7000)throw Error('修改结果与原稿不一致或超出单段结果上限，请保留原文并重新生成。');
  const action=part.action===undefined&&changed(original,part.revised)?'revise':part.action,reason=part.reason===undefined?'':part.reason;
  if(!['revise','retain'].includes(action)||typeof reason!=='string'||reason.length>600||action==='retain'&&(!reason.trim()||part.revised!==original)||action==='revise'&&!changed(original,part.revised))throw Error('候选的修改或保留状态与理由不完整，请保留原文后重新核对。');
  if(source.context.report&&!revisionReportChangeAllowed(original,part.revised,source.context.report.paragraphs.find(p=>p.paragraphId===ids[i])?.ranges||[]))throw Error(`第 ${i+1} 段候选修改了报告标记以外的内容，原稿已保留。`);
  const protection=validateRevisionProtection(original,part.revised);if(!protection.valid)throw Error(`第 ${i+1} 段候选改变了数字、单位、显式公式或引用的原串与顺序，或删减过多；整批尚未采用。`);
  return{text:part.revised,action,reason:reason.trim(),requiresReview:true,factsVerified:false};
 });
 let next=doc;
 checked.forEach((candidate,i)=>{
  const at=next.paragraphs.findIndex(p=>p.id===ids[i]),part=next.paragraphs[at];
  if(part.accepted||part.suggestion!==part.original){next={...next,paragraphs:next.paragraphs.map((p,j)=>j===at?{...p,aiCandidate:candidate}:p)};return;}
  next=editParagraph(next,at,{suggestion:candidate.text,accepted:false,reason:candidate.reason||'AI 未提供具体修改理由，请对照原文核对。'});
  next={...next,paragraphs:next.paragraphs.map((p,j)=>j===at?{...p,aiAction:candidate.action,aiGeneratedText:candidate.text,aiCandidate:null}:p)};
 });return next;
}
