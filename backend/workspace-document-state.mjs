import {completionReview} from './thesis-completion-review.mjs';
import {assessWritingDelivery} from '../dist/workspace/writing-delivery.mjs';

// A saved file, a finished execution and an approved manuscript are different
// facts. This read model never changes worker status, billing or export gates.
export function thesisDocumentState(db,row,run=undefined,review=undefined){
 if(run===undefined)run=row.current_run_id?db.prepare('SELECT * FROM thesis_runs WHERE id=? AND user_id=?').get(row.current_run_id,row.user_id):null;
 const hasDraft=Boolean(db.prepare("SELECT 1 FROM thesis_chapter_versions v WHERE v.thesis_id=? AND v.chapter_id IN (SELECT json_extract(value,'$.id') FROM json_each(?,'$.outline')) AND trim(v.text)!='' AND NOT EXISTS (SELECT 1 FROM thesis_chapter_versions n WHERE n.thesis_id=v.thesis_id AND n.chapter_id=v.chapter_id AND n.version>v.version) LIMIT 1").get(row.id,row.snapshot));
 const full=run&&JSON.parse(run.settings_meta||'{}').completion?.scope==='full';
 let status=hasDraft?'draft_ready':'draft';
 if(['queued','running','cancelling'].includes(row.status)||['queued','running','cancelling'].includes(run?.status))status='generating';
 else if(full&&row.status==='draft'&&hasDraft)status='check_required';
 else if(run&&row.status!=='draft'){
  if(run.status==='cancelled')status='cancelled';
  else if(['failed','interrupted','budget_exceeded'].includes(run.status))status=hasDraft?'interrupted':'failed';
  else if(run.status==='needs_materials')status=JSON.parse(run.quality||'{}').supplementCheck?.status==='unavailable'?'check_required':'needs_materials';
  else if(full){
   const checked=review===undefined?completionReview(db,row,run):review;
   status=({ready:'awaiting_confirmation',confirmed:'confirmed',needs_materials:'needs_materials',generating:'generating'})[checked?.status]||'check_required';
  }
 }
 return {status,hasDraft,currentJobId:row.current_run_id||null};
}

export function writingDocumentState(db,row){
 if(row.operation!=='draft')return null;
 const output=row.output?JSON.parse(row.output):null;
 const hasDraft=Boolean(output?.text?.trim()||db.prepare('SELECT 1 FROM writing_checkpoints WHERE run_id=? LIMIT 1').get(row.id));
 let status=['queued','running'].includes(row.status)?'generating':hasDraft?'interrupted':'failed';
 if(row.status==='cancelled')status='cancelled';
 if(row.status==='completed'){
  const quality=output?.quality,job=db.prepare('SELECT input FROM jobs WHERE id=? AND user_id=?').get(row.id,row.user_id),input=JSON.parse(job?.input||'{}');
  const check=assessWritingDelivery({kind:row.kind,text:output?.text||'',snapshot:JSON.parse(row.snapshot),quality,requireSupplementCheck:input.supplementCheck===true});
  status=check.ready?'review_ready':quality?.supplementCheck?.status==='unavailable'?'check_required':check.issues.some(issue=>issue.material)?'needs_materials':'check_required';
 }
 return {status,hasDraft,currentJobId:row.id};
}

export function workspaceDocumentStates(db,rows,userId,{theses=false}={}){
 const exists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
 const hasTheses=exists('theses')&&exists('thesis_runs')&&exists('thesis_chapter_versions'),hasWriting=exists('writing_runs');
 const cache=new Map();
 const state=row=>{if(!cache.has(row.id))cache.set(row.id,thesisDocumentState(db,row));return cache.get(row.id);};
 return rows.map(item=>{
  if(theses){
   const row=hasTheses?db.prepare('SELECT * FROM theses WHERE id=? AND user_id=?').get(item.id,userId):null;
   return row?{...item,documentState:state(row)}:item;
  }
  if(item.type==='thesis'&&hasTheses){
   const run=db.prepare('SELECT thesis_id FROM thesis_runs WHERE id=? AND user_id=?').get(item.id,userId);
   const row=run?db.prepare('SELECT * FROM theses WHERE id=? AND user_id=?').get(run.thesis_id,userId):null;
   if(row){const historical=item.id!==row.current_run_id;return {...item,documentTitle:row.title,historical,currentJobId:row.current_run_id,...(!historical?{documentState:state(row)}:{})};}
  }
  if(item.type==='writing'&&hasWriting){const row=db.prepare('SELECT * FROM writing_runs WHERE id=? AND user_id=?').get(item.id,userId);if(row){const documentState=writingDocumentState(db,row);if(documentState)return {...item,documentTitle:JSON.parse(row.snapshot).title,documentState};}}
  return item;
 });
}
