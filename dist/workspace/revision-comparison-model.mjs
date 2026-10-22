import {compileSources,compareParagraph,buildReport,countChars,sliceCp} from '../precheck/engine.mjs';
import {publicSourceHref} from '../precheck/source-url.mjs';

export const revisionComparisonLimits=Object.freeze({sources:8,sourceCharacters:12000,totalSourceCharacters:24000,totalTaskCharacters:40000});
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const controls=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const fail=message=>{throw Error(message);};
const keys=(value,allowed)=>Object.keys(value).every(key=>allowed.includes(key));
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(value)&&!['__proto__','prototype','constructor'].includes(value);
const materialId=id=>'comparison:'+id;

/** Other-article text is separate from manuscript text and uploaded reports. */
export function normalizeRevisionComparison(value){
 if(!plain(value)||!keys(value,['version','sources'])||value.version!==1||!Array.isArray(value.sources)||!value.sources.length||value.sources.length>revisionComparisonLimits.sources)fail('请提供 1～8 份实际对照文章或明确节选。');
 const seen=new Set();let total=0;
 const sources=value.sources.map(source=>{
  if(!plain(source)||!keys(source,['id','name','text','url'])||!safeId(source.id)||seen.has(source.id))fail('对照文章编号无效或重复，请重新添加。');seen.add(source.id);
  if(typeof source.name!=='string'||!source.name.trim()||source.name.length>200||controls.test(source.name))fail('请填写不超过 200 字符的对照文章名称。');
  if(typeof source.text!=='string'||source.text.length>revisionComparisonLimits.sourceCharacters||controls.test(source.text)||countChars(source.text.normalize('NFKC'))<16)fail('每份对照正文需至少 16 个有效字符，最多 12,000 字符；不会自动截断。');
  const text=source.text.trim();total+=text.length;if(total>revisionComparisonLimits.totalSourceCharacters)fail('对照正文合计最多 24,000 字符，请减少材料或明确选择节选；不会自动截断。');
  let url;if(source.url!==undefined&&source.url!==''){if(typeof source.url!=='string'||source.url.length>2000||!(url=publicSourceHref(source.url.trim())))fail('对照来源链接需为不含账户凭据或临时令牌的公开 HTTP / HTTPS 地址。');}
  return{id:source.id,name:source.name.trim(),text,...(url?{url}:{})};
 });return{version:1,sources};
}
function documentRows(doc){
 if(!plain(doc)||!Array.isArray(doc.paragraphs)||!doc.paragraphs.length||doc.paragraphs.length>500)fail('请先提供有效的论文原文段落。');
 const seen=new Set();let originalTotal=0,afterTotal=0;
 return doc.paragraphs.map((paragraph,index)=>{
  if(!plain(paragraph)||typeof paragraph.id!=='string'||!/^[-\p{L}\p{N}_.:]{1,160}$/u.test(paragraph.id)||seen.has(paragraph.id)||typeof paragraph.original!=='string'||!paragraph.original.trim()||paragraph.original.length>20000||controls.test(paragraph.original))fail('论文原文段落编号或文本无效。');seen.add(paragraph.id);
  const after=paragraph.accepted?paragraph.suggestion:paragraph.original;if(typeof after!=='string'||!after.trim()||after.length>20000||controls.test(after))fail('已采纳修改稿的段落文本无效。');
  originalTotal+=paragraph.original.length;afterTotal+=after.length;if(originalTotal>100000||afterTotal>100000)fail('本次原稿或已采纳修改稿最多 100,000 字符。');
  return{id:paragraph.id,index,original:paragraph.original,after};
 });
}
function compareRows(rows,sources,compiled,field){
 const paragraphs=rows.map(row=>({id:row.id,text:row[field],sectionId:'revision-body'})),text=paragraphs.map(row=>row.text).join('\n\n'),matches=paragraphs.flatMap(paragraph=>compareParagraph(paragraph,compiled,text));
 // Preserve the revision paragraph IDs and every paragraph; parsing headings
 // again would change the denominator or silently omit source-bearing text.
 return buildReport({title:'同一来源范围的文字比对',text,sections:[{id:'revision-body',title:'论文正文',excluded:false,paragraphs}]},sources,matches,{id:'revision-comparison',mode:'local'});
}
const summary=report=>({ratio:report.ratio,totalChars:report.totalChars,similarChars:report.similarChars,sourceCount:report.sourceCount});

/** Before and accepted-after are each compared with the identical other texts. */
export function compareRevisionDocument(doc){
 if(doc?.comparison===undefined||doc?.comparison===null)return null;
 const {sources}=normalizeRevisionComparison(doc.comparison),rows=documentRows(doc),engineSources=sources.map(source=>({...source,title:source.name})),compiled=compileSources(engineSources),before=compareRows(rows,engineSources,compiled,'original'),after=compareRows(rows,engineSources,compiled,'after'),sourceMap=new Map(sources.map(source=>[source.id,source]));
 const originalRows=before.sections[0].paragraphs,afterRows=after.sections[0].paragraphs;
 return{sources,before:summary(before),after:summary(after),paragraphs:rows.map((row,index)=>({paragraphId:row.id,index,beforeRatio:originalRows[index].ratio,afterRatio:afterRows[index].ratio,matches:originalRows[index].matches.map(match=>{
  const source=sourceMap.get(match.sourceId);return{sourceId:source.id,name:source.name,...(source.url?{url:source.url}:{}),range:[...match.range],sourceRange:[...match.sourceRange],originalExcerpt:sliceCp(row.original,...match.range),sourceExcerpt:sliceCp(source.text,...match.sourceRange)};
 })}))};
}

/** A confirmed comparison submits only actual sources matching selected originals. */
export function revisionComparisonSnapshot(doc,parts){
 if(!doc?.comparison||doc.reductionPath==='direct')return{materials:[],comparisonContext:undefined};
 const comparison=compareRevisionDocument(doc);if(!Array.isArray(parts)||!parts.length)fail('请选择需要按来源修改的原文段落。');
 const rows=new Map(documentRows(doc).map(row=>[row.id,row])),hits=new Map(comparison.paragraphs.map(row=>[row.paragraphId,row])),seen=new Set();
 const paragraphs=parts.map(part=>{
  const row=rows.get(part?.id);if(!row||typeof part.original!=='string'||part.original!==row.original||seen.has(part.id))fail('所选原文段落已变化，请重新核对来源与范围。');seen.add(part.id);
  const sourceIds=[...new Set(hits.get(part.id).matches.map(match=>materialId(match.sourceId)))];if(!sourceIds.length)fail(`第 ${row.index+1} 段未命中当前对照文章，请只选择有实际命中的段落。`);
  return{paragraphId:part.id,sourceIds};
 });
 const used=new Set(paragraphs.flatMap(row=>row.sourceIds)),materials=comparison.sources.filter(source=>used.has(materialId(source.id))).map(source=>({id:materialId(source.id),name:source.name,text:source.text}));
 if(parts.map(row=>row.original.trim()).join('\n\n').length+materials.reduce((total,source)=>total+source.text.length,0)>revisionComparisonLimits.totalTaskCharacters)fail('所选论文与命中来源正文合计超过 40,000 字符，请缩小段落范围或对照材料；不会自动截断。');
 return{materials,comparisonContext:{version:1,paragraphs}};
}

/** Revalidate requested evidence against actual materials at the server boundary. */
export function normalizeRevisionComparisonContext(value,{paragraphs,materials}){
 if(!plain(value)||!keys(value,['version','paragraphs'])||value.version!==1||!Array.isArray(value.paragraphs)||!value.paragraphs.length||value.paragraphs.length>120||value.paragraphs.length!==paragraphs.length)fail('来源比对范围与本次原文段落不一致，请重新确认。');
 const sourceMap=new Map(materials.map(source=>[source.id,source])),used=new Set();
 const checked=value.paragraphs.map((row,index)=>{
  if(!plain(row)||!keys(row,['paragraphId','sourceIds'])||row.paragraphId!==paragraphs[index].id||!Array.isArray(row.sourceIds)||!row.sourceIds.length||row.sourceIds.length>8||new Set(row.sourceIds).size!==row.sourceIds.length)fail('来源比对的段落或材料编号无效，请重新确认。');
  for(const id of row.sourceIds){if(typeof id!=='string'||!id.startsWith('comparison:')||!safeId(id.slice(11))||!sourceMap.has(id))fail('来源比对引用了本次没有提供的对照文章。');used.add(id);}
  return{paragraphId:row.paragraphId,sourceIds:[...row.sourceIds]};
 });
 const actualSources=normalizeRevisionComparison({version:1,sources:[...used].map(id=>{const source=sourceMap.get(id);return{id:id.slice(11),name:source.name,text:source.text};})}).sources;
 const compiled=compileSources(actualSources.map(source=>({...source,title:source.name})));
 for(const [index,row]of checked.entries()){
  const actual=new Set(compareParagraph({id:paragraphs[index].id,text:paragraphs[index].original},compiled).map(match=>materialId(match.sourceId)));
  if(row.sourceIds.length!==actual.size||row.sourceIds.some(id=>!actual.has(id)))fail('对照文章与所选原文的文字命中不一致，原定位可能已变化，请重新比对。');
 }
 if(materials.some(source=>source.id.startsWith('comparison:')&&!used.has(source.id)))fail('有对照材料未关联本次段落，请重新确认修改范围。');
 return{version:1,paragraphs:checked};
}
