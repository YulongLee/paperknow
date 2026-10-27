import {normalizeConfirmedRevisionReport,reportSources} from './revision-report-model.mjs';
const fail=message=>{throw Error(message);},plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function normalizeRevisionReportContext(value,paragraphs){
 if(!plain(value)||value.version!==1||!['aigc','similarity'].includes(value.kind)||!Object.hasOwn(reportSources,value.source)||!Array.isArray(value.paragraphs)||!value.paragraphs.length||value.paragraphs.length>120)fail('检测报告定位不完整，请重新核对报告。');
 const map=new Map(paragraphs.map(p=>[p.id,p.original])),seen=new Set();let count=0;
 const rows=value.paragraphs.map(row=>{
  if(!plain(row)||!map.has(row.paragraphId)||seen.has(row.paragraphId)||!Array.isArray(row.ranges)||!row.ranges.length||row.ranges.length>120)fail('报告选区与本次原文段落不一致。');seen.add(row.paragraphId);
  const original=map.get(row.paragraphId),ranges=row.ranges.map(range=>{if(++count>240||!Array.isArray(range)||range.length!==2||!range.every(Number.isSafeInteger)||range[0]<0||range[1]<=range[0]||range[1]>original.length||!original.slice(...range).trim())fail('报告标记位置与原文不一致，请重新定位。');return[...range];}).sort((a,b)=>a[0]-b[0]);
  const merged=[];for(const range of ranges){const previous=merged.at(-1);if(previous&&range[0]<=previous[1])previous[1]=Math.max(previous[1],range[1]);else merged.push(range);}return{paragraphId:row.paragraphId,ranges:merged};
 });
 if(seen.size!==paragraphs.length)fail('按报告修改只能选择报告已定位的段落。');
 return{version:1,kind:value.kind,source:value.source,paragraphs:paragraphs.map(p=>rows.find(row=>row.paragraphId===p.id))};
}
export function revisionReportContextForDocument(doc,parts){
 if(!doc.reportRequired&&doc.aiSelection?.origin!=='report')return null;
 const report=normalizeConfirmedRevisionReport(doc.reportAttachment,doc),kind=report.kind||(doc.mode==='reduce'?'aigc':'similarity');
 const rows=parts.map(part=>{const leading=part.original.indexOf(part.original.trim()),size=part.original.trim().length;return{paragraphId:part.id,ranges:report.evidence.filter(e=>e.paragraphId===part.id).map(e=>[Math.max(0,e.start-leading),Math.min(size,e.end-leading)])};});
 return normalizeRevisionReportContext({version:1,kind,source:report.source,paragraphs:rows},parts.map(p=>({id:p.id,original:p.original.trim()})));
}
// All text outside the reported ranges must remain byte-for-byte in sequence.
// This is an editing boundary, never a claim that the imported report is authentic.
export function revisionReportChangeAllowed(original,revised,ranges=[]){
 if(!ranges.length)return true;
 const prefix=original.slice(0,ranges[0][0]),suffix=original.slice(ranges.at(-1)[1]);
 if(!revised.startsWith(prefix)||!revised.endsWith(suffix)||revised.length<prefix.length+suffix.length)return false;
 let cursor=prefix.length;
 for(let i=1;i<ranges.length;i++){const gap=original.slice(ranges[i-1][1],ranges[i][0]);if(!gap)continue;const at=revised.indexOf(gap,cursor);if(at<0||at+gap.length>revised.length-suffix.length)return false;cursor=at+gap.length;}
 return cursor<=revised.length-suffix.length;
}
