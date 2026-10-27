import {normalizeRevisionComparison} from './revision-comparison-model.mjs';
import {normalize,countChars,sliceCp,unionRanges} from '../precheck/engine.mjs';
import {publicSourceHref} from '../precheck/source-url.mjs';

const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const controls=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw Error(message);};
function handoffRoute(hash){
 const [route,query='']=String(hash||'').split('?');
 if(route!=='#category/reduce')return null;
 const params=new URLSearchParams(query),web=params.getAll('comparisonReport'),local=params.getAll('localComparisonReport');
 if(web.length+local.length!==1)return null;
 const id=(web.length?web:local)[0];if(!safeId(id))return null;
 return{kind:web.length?'web':'local',id};
}
export function hasRevisionComparisonHandoff(hash=globalThis.location?.hash){return !!handoffRoute(hash);}
function validRange(range,length){return Array.isArray(range)&&range.length===2&&range.every(Number.isSafeInteger)&&range[0]>=0&&range[1]>range[0]&&range[1]<=length;}
const normalized=value=>normalize(value).chars.join('');

/** Copy manuscript and actual source excerpts separately; report scores are never copied. */
export function revisionComparisonInputFromReport(report){
 if(!plain(report)||report.complete!==true||!['web','local'].includes(report.mode)||!Array.isArray(report.sections)||!report.sections.length||report.sections.length>500||!Array.isArray(report.sources)||report.sources.length>100)fail('这份结果不是完整的真实来源报告，请返回查重功能读取原报告；示例报告不能作为论文降重依据。');
 const sourceMap=new Map();
 for(const source of report.sources){
  if(!plain(source)||typeof source.id!=='string'||sourceMap.has(source.id)||typeof source.text!=='string'||source.text.length>500000||controls.test(source.text))fail('报告来源正文不完整，请重新读取原报告。');
  sourceMap.set(source.id,{source,length:Array.from(source.text).length,ranges:[]});
 }
 let paragraphCount=0,matchCount=0;const blocks=[];
 for(const section of report.sections){
  if(!plain(section)||!Array.isArray(section.paragraphs)||typeof section.title!=='string'||section.title.length>500||controls.test(section.title))fail('报告章节或正文不完整，请重新读取原报告。');
  if(!(section.id==='section-0'&&section.title==='正文概述')&&section.title.trim())blocks.push(section.title.trim());
  for(const paragraph of section.paragraphs){
   if(++paragraphCount>500||!plain(paragraph)||typeof paragraph.text!=='string'||!paragraph.text.trim()||paragraph.text.length>20000||controls.test(paragraph.text)||!Array.isArray(paragraph.matches))fail('报告正文段落超出范围或不完整，请按章节处理。');
   blocks.push(paragraph.text);
   if(section.included!==true)continue;
   const length=Array.from(paragraph.text).length;
   for(const match of paragraph.matches){
    if(++matchCount>10000||!plain(match)||!sourceMap.has(match.sourceId))fail('报告命中来源不完整，请重新读取原报告。');
    const entry=sourceMap.get(match.sourceId);
    if(!validRange(match.range,length)||!validRange(match.sourceRange,entry.length))fail('报告命中位置与正文不一致，请重新读取原报告。');
    const own=sliceCp(paragraph.text,...match.range),other=sliceCp(entry.source.text,...match.sourceRange);
    if(countChars(own)<16||normalized(own)!==normalized(other))fail('报告命中片段与来源正文不一致，请重新比对，不能沿用旧定位。');
    entry.ranges.push([Math.max(0,match.sourceRange[0]-200),Math.min(entry.length,match.sourceRange[1]+200)]);
   }
  }
 }
 const text=blocks.join('\n\n');if(!text.trim()||text.length>100000)fail('报告中的论文正文为空或超过 100,000 字符，请按章节导入；不会自动截断。');
 const hits=[...sourceMap.values()].filter(entry=>entry.ranges.length);
 if(!hits.length)fail('本次来源报告没有可定位的文字命中。可直接改写表达，或先添加真实对照文章；不能把未命中当作已完成降重。');
 // A gap in an article must remain a gap. Joining distant windows with blank
 // lines would let the matcher (which ignores whitespace) invent new overlap.
 const sources=[];
 for(const {source,ranges}of hits){
  const title=String(source.title||source.name||'对照文章').replace(/\s+/g,' ').trim().slice(0,180),url=publicSourceHref(source.url||'');
  for(const [index,range]of unionRanges(ranges).entries()){
   if(sources.length>=8)fail('本报告含超过 8 处不连续的来源摘录，请先缩小检测章节或明确选择部分来源，再按来源降重；不会丢弃后续命中。');
   sources.push({id:'report-source-'+(sources.length+1),name:title+' · 来源摘录 '+(index+1),text:sliceCp(source.text,...range),...(url?{url}:{})});
  }
 }
 const comparison=normalizeRevisionComparison({version:1,sources});
 return{title:typeof report.title==='string'&&report.title.trim()?report.title.trim().slice(0,200):'来源报告修改稿',text,comparison};
}

/** Read-only transfer: routes contain only an ID, never manuscript or source text. */
export async function loadRevisionComparisonHandoff(ctx,{windowObject=globalThis.window,isCurrent=()=>true,readLocalReport=async id=>(await import('../precheck/store.mjs')).repository.get('reports',id)}={}){
 const initialHash=windowObject?.location?.hash,route=handoffRoute(initialHash);
 if(!route)fail('请先在论文检测的完整报告中点击“按重复来源降重”，再读取这份结果。');
 const assertCurrent=()=>{if(!isCurrent()||windowObject?.location?.hash!==initialHash)fail('页面或文稿已变化，本次查重结果未载入。');};
 assertCurrent();let report;
 if(route.kind==='web'){
  if(typeof ctx?.api!=='function')fail('暂时无法读取账户查重结果，请重新进入降重功能。');
  let before,response,after;
  try{before=await ctx.api('/auth/me');assertCurrent();if(!before?.user?.id)fail('请登录保存该报告的账户后重试。');response=await ctx.api('/web-similarity/'+encodeURIComponent(route.id)+'/report');assertCurrent();after=await ctx.api('/auth/me');assertCurrent();}
  catch(error){assertCurrent();if(/请登录/.test(error.message||''))throw error;fail('暂时无法读取这份账户查重结果，请返回论文检测读取原任务后重试。');}
  if(after?.user?.id!==before.user.id||response?.ownerId!==before.user.id)fail('登录账户已变化或报告所属账户无法核对，本次结果未载入。');
  report=response.report;
 }else{
  try{report=await readLocalReport(route.id);assertCurrent();}catch{assertCurrent();fail('无法读取这份已保存的材料比对报告，请返回原报告保存后重试。');}
 }
 assertCurrent();const input=revisionComparisonInputFromReport(report);assertCurrent();
 return{...input,originLabel:route.kind==='web'?'PaperKnow 公开来源报告 · 命中上下文摘录':'PaperKnow 材料比对报告 · 命中上下文摘录',reportId:route.id};
}
