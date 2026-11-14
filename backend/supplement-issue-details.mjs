import {createHash} from 'node:crypto';

// These are display/diagnostic records, not an authorization to confirm an
// issue. Model-generated categories cannot safely identify independently
// resolvable facts. Account, run and rule bindings must be added by a future
// server-owned confirmation service before any issue can be confirmed.
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=value=>typeof value==='string'?value:'';
export function supplementIssueDetails({items=[],chapters=[],snapshot={},phase,materials=[],trace=[]}={}){
 const binding=digest({version:1,phase,snapshot,chapters});
 const reads=Array.isArray(trace)?trace:[];
 const result=[];
 for(const item of items){
  if(item?.status!=='missing'||!Array.isArray(item.missing))continue;
  const match=/^check-(\d+)-\d+(?:-recovery-\d+)*$/u.exec(text(item.id));
  const index=match?Number(match[1]):-1,chapter=Number.isSafeInteger(index)?chapters[index]:null;
  const body=text(chapter?.text),quote=text(item.manuscriptQuote),offset=quote?body.indexOf(quote):-1;
  const unique=offset>=0&&body.indexOf(quote,offset+1)<0;
  const evidence=[];
  for(const proof of Array.isArray(item.evidence)?item.evidence:[]){
   const matches=materials.filter(source=>source?.id===proof?.sourceId);
   const original=text(matches[0]?.text),excerpt=text(proof?.quote),start=excerpt?original.indexOf(excerpt):-1;
   if(matches.length!==1||start<0||original.indexOf(excerpt,start+1)>=0)continue;
   const read=reads.some(entry=>entry?.tool==='read_material'&&entry.status==='completed'&&entry.materialId===proof.sourceId&&Number.isSafeInteger(entry.offset)&&entry.offset>=0&&Number.isSafeInteger(entry.limit)&&entry.limit>0&&entry.offset<=start&&entry.offset+entry.limit>=start+excerpt.length);
   if(!read)continue;
   evidence.push({sourceId:proof.sourceId,quote:excerpt,offset:start,sourceHash:digest(original)});
  }
  for(const [ordinal,description] of item.missing.entries()){
   if(typeof description!=='string'||!description.trim())continue;
   const location=unique?{chapterId:text(chapter?.id),chapterIndex:index,offset,quote,chapterHash:digest(body)}:null;
   result.push({id:digest({binding,section:item.id,ordinal,description,location,evidence}),binding,sectionId:text(item.id),title:text(item.title),description,location,evidence,confirmationAllowed:false});
  }
 }
 return result;
}
