import {normalizeAigcResult} from './aigc-detection-model.mjs';
import {normalize,countChars,subtractRanges} from '../precheck/engine.mjs';
import {mergeReportMarks} from './revision-marked-html.mjs';
const fail=message=>{throw Error(message);},id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
function utf16Map(text){const points=[0];let n=0;for(const char of text){n+=char.length;points.push(n);}return points;}
function rangeValid(range,length){return Array.isArray(range)&&range.length===2&&range.every(Number.isSafeInteger)&&range[0]>=0&&range[1]>range[0]&&range[1]<=length;}
export function revisionInputFromAigcReport(value){
 const item=normalizeAigcResult(value?.item),text=value?.text;if(!item.fullyCompleted||typeof text!=='string'||Array.from(text).length!==item.characters||text.length>100000)fail('AI检测原文或完整结果无法核对，请读取原报告后重试。');
 const points=utf16Map(text),ranges=[];let at=0;
 for(const part of item.parts){if(part.start!==at||!rangeValid([part.start,part.end],points.length-1)||part.end-part.start!==part.characters)fail('AI报告位置与原文不一致，请重新读取原报告。');at=part.end;if(part.label==='aigc'&&!part.skipped)ranges.push({start:points[part.start],end:points[part.end]});}
 if(at!==item.characters)fail('AI报告正文不完整，请重新读取原报告。');
 return{source:'paperknow',kind:'aigc',format:'paste',text,originalText:text,title:value.title||item.title||'论文表达修改',explicitExcerpts:mergeReportMarks(text,ranges),markedOnly:true,markState:ranges.length?'marked':'none',fileName:(item.title||'论文')+'-AI检测报告'};
}
export function revisionInputFromSimilarityReport(report){
 if(!report||report.complete!==true||report.mode!=='web'||!Array.isArray(report.sections)||!Array.isArray(report.sources))fail('请选择完整的账户重复率检测报告。');
 const sources=new Map(report.sources.map(s=>[s.id,s])),ranges=[];let text='';
 for(const section of report.sections){if(section.title&&!(section.id==='section-0'&&section.title==='正文概述'))text+=section.title+'\n\n';
  for(const paragraph of section.paragraphs||[]){if(typeof paragraph.text!=='string'||!Array.isArray(paragraph.matches))fail('重复率报告正文不完整，请读取原报告。');const at=text.length,points=utf16Map(paragraph.text);text+=paragraph.text+'\n\n';if(!section.included)continue;
   for(const match of paragraph.matches){const source=sources.get(match.sourceId),other=source&&Array.from(source.text||'');if(!source||!rangeValid(match.range,points.length-1)||!rangeValid(match.sourceRange,other.length))fail('重复率报告的来源或位置无法核对。');const own=paragraph.text.slice(points[match.range[0]],points[match.range[1]]),compared=other.slice(...match.sourceRange).join('');if(countChars(own)<16||normalize(own).chars.join('')!==normalize(compared).chars.join(''))fail('报告标记与相似来源不一致，请重新读取原报告。');const exclusions=match.excludedRanges||[];if(!Array.isArray(exclusions)||exclusions.some(r=>!rangeValid(r,points.length-1)))fail('报告引用排除位置无法核对，请重新读取原报告。');for(const [start,end]of subtractRanges([match.range],exclusions))ranges.push({start:at+points[start],end:at+points[end]});}
  }
 }
 if(!text.trim()||text.length>100000)fail('报告原文为空或超过100,000字符，请按章节处理。');
 return{source:'paperknow',kind:'similarity',format:'paste',text,originalText:text,title:report.title||'重复表达修改',explicitExcerpts:mergeReportMarks(text,ranges),markedOnly:true,markState:ranges.length?'marked':'none',fileName:(report.title||'论文')+'-重复率报告'};
}
export async function listOwnedRevisionReports(api,kind,isCurrent=()=>true){
 const before=await api('/auth/me');if(!isCurrent()||!before.user?.id)fail('请先登录，再选择账户检测报告。');const response=await api(kind==='aigc'?'/aigc-detections':'/web-similarity'),after=await api('/auth/me');
 if(!isCurrent()||after.user?.id!==before.user.id||response.ownerId&&response.ownerId!==before.user.id)fail('账户已变化，未载入检测报告。');
 return{ownerId:before.user.id,items:(response.items||[]).filter(item=>id(item.id)&&item.status==='completed').map(item=>({id:item.id,title:String(item.title||'检测报告').slice(0,200),createdAt:item.createdAt,available:item.reportAvailable!==false}))};
}
export async function loadOwnedRevisionReport(api,kind,reportId,ownerId,isCurrent=()=>true){
 if(!id(reportId))fail('报告编号无效。');const before=await api('/auth/me');if(!isCurrent()||!before.user?.id||ownerId&&before.user.id!==ownerId)fail('账户已变化，未载入检测报告。');
 const response=await api((kind==='aigc'?'/aigc-detections/':'/web-similarity/')+encodeURIComponent(reportId)+'/report'),after=await api('/auth/me');if(!isCurrent()||after.user?.id!==before.user.id||response.ownerId&&response.ownerId!==before.user.id)fail('账户已变化，未载入检测报告。');
 if(kind==='aigc'){if(response.item?.id!==reportId)fail('返回的AI报告与所选报告不一致。');return{...revisionInputFromAigcReport(response),ownerId:before.user.id};}if(response.report?.id!==reportId)fail('返回的重复率报告与所选报告不一致。');return{...revisionInputFromSimilarityReport(response.report),ownerId:before.user.id};
}
