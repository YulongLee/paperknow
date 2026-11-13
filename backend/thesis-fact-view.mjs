import {completionManuscriptHash} from './thesis-completion.mjs';
import {createHash} from 'node:crypto';

// This bounded view describes literal text coverage, not verified research
// facts. In particular it never turns a user's statement or a source preview
// into evidence and never authorizes removing a pending marker.
const markerPattern=/【(?:待核对|待补充)[：:][^】]{1,300}】|\[(?:To be verified|To be supplied):[^\]]{1,300}\]/giu;
const citationPattern=/\[source:[^\]\r\n]+\]/gu;
const literalTwelve=/(?<![\d.])\d+\.\d{12}(?!\d|\.\d)/gu;
const literalSix=/(?<![\d.])\d+\.\d{6}(?!\d|\.\d)/gu;
const unsafeText=/\[docx:|\[figure:|[０-９．]|(?=\p{Nd})[^\d]|(?<![\p{L}\d])\d+(?:\.\d+)?[eE][+-]?\d+\b|\d+\.\d{6,}\.\d+/iu;
const mask=value=>value.replace(markerPattern,text=>' '.repeat(text.length)).replace(citationPattern,text=>' '.repeat(text.length));
const markerClaimsTwelve=value=>/(?:12\s*(?:位小数|位)|12[ -]decimal)/iu.test(value);
const titleMatches={abstract:chapter=>/^(?:摘要|abstract)$/iu.test(String(chapter.title||'').trim())||['abstract_zh','abstract_en'].includes(chapter.kind),first:chapter=>/^(?:第\s*一\s*章|第\s*1\s*章|1[.、\s])/u.test(String(chapter.title||'').trim())};
const structureHash=chapters=>createHash('sha256').update(JSON.stringify(chapters.map(({id,title,kind,versionId})=>({id,title,kind,versionId})))).digest('hex');

export function thesisFactView({ownerId,thesisId,runId,snapshotHash,chapters=[],unit,phase='baseline',materials=[]}={}){
 const scopeValid=['baseline','candidate'].includes(phase)&&[ownerId,thesisId,runId,snapshotHash].every(value=>typeof value==='string'&&value.length>0)&&Array.isArray(chapters)&&chapters.length>0&&chapters.length<=30&&new Set(chapters.map(row=>row.id)).size===chapters.length&&chapters.every(row=>typeof row.id==='string'&&typeof row.text==='string'&&Array.isArray(row.figures));
 const total=scopeValid?chapters.reduce((sum,row)=>sum+row.text.length,0):0,complete=scopeValid&&total<=600000&&chapters.every(row=>row.text.trim());
 const view={version:1,ownerId,thesisId,runId,snapshotHash,manuscriptHash:scopeValid?completionManuscriptHash(chapters):null,structureHash:scopeValid?structureHash(chapters):null,phase,coverage:complete?'complete_text':'incomplete',sourceAccess:'no_new_read_inferred',declarations:[],numberChecks:[]};
 // These are user-provided assertions in selected material, not verified
 // factual evidence, and do not stand in for a read_material call.
 for(const material of materials){if(view.declarations.length>=2)break;const line=String(material.text||'').split(/\r?\n/u).find(value=>/(?:本次|本文|本研究|各章|全文).{0,35}(?:统一|保留).{0,10}(?:6|六)\s*位小数/u.test(value));if(line)view.declarations.push({sourceId:material.id,excerpt:line.slice(0,160),status:'user_supplied_not_verified_or_read'});}
 const original=String(unit?.completion?.originalText||'');
 for(const found of original.matchAll(markerPattern)){
  if(view.numberChecks.length>=2||!markerClaimsTwelve(found[0]))continue;
  const asksAbstract=/(?:摘要|abstract)/iu.test(found[0]),asksFirst=/(?:第一章|第\s*1\s*章|first\s+chapter)/iu.test(found[0]),asksCurrent=/(?:本章|this\s+chapter)/iu.test(found[0]);
  const target=[];if(asksAbstract)target.push(...chapters.filter(titleMatches.abstract));if(asksFirst)target.push(...chapters.filter(titleMatches.first));if(asksCurrent)target.push(...chapters.filter(row=>row.id===unit.chapterId));
  const targets=[...new Map(target.map(row=>[row.id,row])).values()],firstCount=chapters.filter(titleMatches.first).length,abstractCount=chapters.filter(titleMatches.abstract).length;
  let status='insufficient_coverage',hits=[],sixDigitSamples=[];
  if(complete&&asksFirst&&asksAbstract&&firstCount===1&&abstractCount>0&&targets.length>=2&&targets.every(row=>!row.figures.length&&!unsafeText.test(mask(row.text))&&mask(row.text).trim())){
   for(const chapter of targets){const text=mask(chapter.text);for(const match of text.matchAll(literalTwelve)){if(hits.length<8)hits.push({chapterId:chapter.id,offset:match.index,value:match[0]});}for(const match of text.matchAll(literalSix)){if(sixDigitSamples.length<8)sixDigitSamples.push({chapterId:chapter.id,offset:match.index,value:match[0]});}}
   status=hits.length?'literal_twelve_decimal_found':'no_literal_twelve_decimal_found';
  }
  view.numberChecks.push({chapterId:unit.chapterId,marker:found[0],targetChapterIds:targets.map(row=>row.id),status,...(hits.length?{hits}:{}),...(sixDigitSamples.length?{sixDigitSamples}:{}),scope:'literal_decimal_text_only_not_semantic_validation'});
 }
 return view;
}
export function currentThesisFactView(view,{ownerId,thesisId,runId,snapshotHash,chapters}={}){
 return !!view&&view.ownerId===ownerId&&view.thesisId===thesisId&&view.runId===runId&&view.snapshotHash===snapshotHash&&Array.isArray(chapters)&&view.manuscriptHash===completionManuscriptHash(chapters)&&view.structureHash===structureHash(chapters);
}
