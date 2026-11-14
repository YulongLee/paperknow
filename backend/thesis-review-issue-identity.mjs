import {thesisHash} from './thesis-model.mjs';

// These identifiers support later, version-scoped review; they never grant
// permission to clear a finding or bypass any manuscript/export check.
export function thesisReviewIssueIdentities({row,run,saved,quality,current}){
 if(!current||run?.status!=='completed'||run.user_id!==row.user_id||run.thesis_id!==row.id||run.id!==row.current_run_id||run.snapshot_hash!==row.snapshot_hash||quality?.coverage?.complete!==true)return [];
 const chapters=new Map();for(const chapter of saved){if(!chapter?.id||chapters.has(chapter.id))return [];chapters.set(chapter.id,chapter);}
 const basis=thesisHash({owner:row.user_id,thesis:row.id,run:run.id,snapshot:row.snapshot_hash,chapters:saved.map(chapter=>[chapter.id,chapter.record?.id||null,thesisHash(chapter.record?.text||'')]),metadata:row.export_metadata||null,template:row.export_template||null,quality:run.quality});
 const findings=[...(quality.consistency?.findings||[]).map(f=>({f,source:'consistency'})),...(quality.reviews||[]).flatMap(review=>(review.findings||[]).map(f=>({f,source:'review'})))];
 const seen=new Set(),items=[];
 for(const {f,source} of findings){
  const chapter=chapters.get(f?.sectionId),text=chapter?.record?.text,quote=f?.quote,offset=f?.offset;
  if(typeof text!=='string'||typeof quote!=='string'||quote.length<6||quote.length>500||!Number.isSafeInteger(offset)||offset<0||text.slice(offset,offset+quote.length)!==quote||text.indexOf(quote)!==offset||text.indexOf(quote,offset+1)!==-1)continue;
  const details={source,chapterId:chapter.id,chapterVersionId:chapter.record.id,offset,quote,category:String(f.category||'').slice(0,100),severity:String(f.severity||'').slice(0,30),reasonCode:String(f.reasonCode||'').slice(0,100),explanation:String(f.explanation||'').slice(0,1000),suggestion:String(f.suggestion||'').slice(0,1000)};
  const id=thesisHash({basis,details});if(seen.has(id))continue;seen.add(id);
  items.push({id,basis,chapterId:chapter.id,chapterVersionId:chapter.record.id,offset,quote,category:details.category,severity:details.severity,explanation:details.explanation,suggestion:details.suggestion,source,confirmable:false});
  if(items.length>=100)break;
 }
 return items;
}
