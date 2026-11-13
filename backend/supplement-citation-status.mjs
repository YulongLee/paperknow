import {createHash} from 'node:crypto';
// This is a bounded description of the current run's metadata verification,
// not evidence for any statement made in the paper.
export const supplementCitationFingerprint=snapshot=>createHash('sha256').update(JSON.stringify(snapshot?.references||[])).digest('hex');
const doi=value=>typeof value==='string'?value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').toLowerCase():'';
const arxiv=value=>typeof value==='string'?value.trim().replace(/^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\//i,'').replace(/\.pdf$/i,'').replace(/^10\.48550\/arxiv\./i,'').replace(/v\d+$/i,'').toLowerCase():'';
const title=value=>typeof value==='string'?value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,''):'';
export function supplementCitationStatus(snapshot,boundVerification,citedIds){
 if(!boundVerification||boundVerification.referenceFingerprint!==supplementCitationFingerprint(snapshot))return [];
 const refs=Array.isArray(snapshot?.references)?snapshot.references:[],items=Array.isArray(boundVerification.verification?.items)?boundVerification.verification.items:[],requested=new Set(citedIds||[]),out=[];
 for(const id of requested){
  const matches=refs.filter(r=>r?.id===id&&r.confirmed===true),results=items.filter(r=>r?.id===id);if(matches.length!==1||results.length>1)continue;
  const ref=matches[0],item=results[0],record=item?.record;
  if(!item||item.metadataStatus!=='matched'){if(doi(ref.doi))out.push({sourceId:id,identifier:'unverified',doiProvided:true,doiStatus:'not_checked',fields:{},documentType:null});if(out.length===20)break;continue;}
  if(!record||item.fieldChecks?.title!=='matched'||!title(ref.title)||title(ref.title)!==title(record.title))continue;
  const wantedDoi=doi(ref.doi),recordDoi=doi(record.doi);let identifier='';
  if(item.provider==='arxiv'){
   const actual=arxiv(record.identifier),candidates=[ref.arxivId,ref.url,ref.doi].map(arxiv).filter(x=>/^(?:\d{4}\.\d{4,5}|[a-z][a-z.\-]*\/\d{7})$/i.test(x));
   if(!actual||!candidates.includes(actual))continue;identifier='arxiv';
  }else if(['crossref','openalex'].includes(item.provider)&&wantedDoi&&wantedDoi===recordDoi)identifier='doi';else continue;
  out.push({sourceId:id,identifier,doiProvided:!!wantedDoi,doiStatus:wantedDoi&&recordDoi===wantedDoi?'matched':'not_checked',fields:Object.fromEntries(['title','year','authors'].filter(k=>['matched','conflict','not_checked','not_provided'].includes(item.fieldChecks?.[k])).map(k=>[k,item.fieldChecks[k]])),documentType:/^(?:EB\/OL|EB|webpage)$/i.test(String(ref.documentType||'').trim())?'electronic_document':null});
  if(out.length===20)break;
 }
 return out;
}
