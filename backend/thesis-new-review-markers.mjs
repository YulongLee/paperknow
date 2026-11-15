// A display-only exact comparison. It never resolves a gap or decides whether
// the new marker is factually necessary. Only immutable, owned baseline versions
// and chapters written by the corresponding completion run can be compared.
export function completionNewMarkers(db,row,run,saved,{current=false}={}){
 if(!current||run?.status!=='completed')return [];
 let meta;try{meta=JSON.parse(run.settings_meta||'{}');}catch{return [];}
 const completion=meta.completion;if(completion?.scope!=='full'||!Array.isArray(completion.baseline))return [];
 const sourceRunId=meta.reviewOnly===true?meta.reviewPaidRunId:run.id;if(typeof sourceRunId!=='string'||!sourceRunId)return [];
 const originals=[];const seen=new Set();
 for(const ref of completion.baseline){
  if(!ref||typeof ref.chapterId!=='string'||typeof ref.versionId!=='string'||seen.has(ref.chapterId))return [];
  seen.add(ref.chapterId);const original=db.prepare('SELECT text FROM thesis_chapter_versions WHERE id=? AND thesis_id=? AND chapter_id=?').get(ref.versionId,row.id,ref.chapterId);
  if(!original||typeof original.text!=='string')return [];originals.push(original.text);
 }
 const originalText=originals.join('\n\n'),rows=[],dedupe=new Set();
 for(const {record,...chapter} of saved){
  if(!record||record.source!=='generated'||record.run_id!==sourceRunId||typeof record.text!=='string')continue;
  const matches=record.text.matchAll(/【(?:待补充|待核对|草稿说明)[：:][^】\n]{2,1000}】|\[(?:待补充|待核对|草稿说明)[：:][^\]\n]{2,1000}\]|\[(?:To be supplied|To be verified|Draft note):[^\]\n]{2,1000}\]/giu);
  for(const match of matches){const marker=match[0];if(originalText.includes(marker))continue;
   const key=chapter.id+'\0'+marker;if(dedupe.has(key))continue;dedupe.add(key);
   const start=Math.max(0,match.index-100),end=Math.min(record.text.length,match.index+marker.length+100);
   rows.push({chapterId:chapter.id,title:chapter.title,marker,context:record.text.slice(start,end).trim()});if(rows.length>=30)return rows;
  }
 }
 return rows;
}
