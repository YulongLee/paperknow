import {completionContentAudit} from './thesis-completion-audit.mjs';
import {thesisHash,thesisError} from './thesis-model.mjs';
import {savedThesisChapters,completionManuscriptHash} from './thesis-completion.mjs';
import {thesisCompletionNeeds} from '../dist/workspace/thesis-completion-model.mjs';
import {supplementCheckReady} from '../dist/workspace/supplement-check-panel.mjs';

// Confirmation is tied to immutable chapter versions AND the current research,
// cover, template and review. It is an acknowledgement, never research evidence.
export function completionReview(db,row,run){
 const completion=JSON.parse(run?.settings_meta||'{}').completion;
 if(completion?.scope!=='full')return null;
 if(['queued','running'].includes(run.status))return {required:true,runId:run.id,status:'generating',fingerprint:null,changes:[],missing:[],issues:[],checks:{materials:false,manuscript:false,content:false}};
 const snapshot=JSON.parse(row.snapshot),saved=savedThesisChapters(db,row),chapters=saved.map(({record,...chapter})=>({...chapter,text:record?.text||'',figures:JSON.parse(record?.figures||'[]')}));
 const quality=run.quality?JSON.parse(run.quality):null,stale=run.snapshot_hash!==row.snapshot_hash||quality?.manuscriptHash!==completionManuscriptHash(chapters);
 const changes=saved.flatMap(({record,...chapter})=>{
  const prior=completion.baseline.find(reference=>reference.chapterId===chapter.id),before=prior?db.prepare('SELECT text FROM thesis_chapter_versions WHERE id=? AND thesis_id=? AND chapter_id=?').get(prior.versionId,row.id,chapter.id):null;
  return record&&record.id!==prior?.versionId?[{chapterId:chapter.id,title:chapter.title,kind:before?.text?.trim()?'updated':'added',beforeVersionId:prior?.versionId||null,version:record.version,characters:record.text.length}]:[];
 });
 const audit=completionContentAudit(snapshot,chapters,quality,row),needs=thesisCompletionNeeds({snapshot,chapters}),missing=[...new Set([
  ...needs.chapters.flatMap(chapter=>chapter.requests.map(request=>chapter.title+'：'+request)),
  ...audit.issues.filter(issue=>/^cover_|reference_minimum|foreign_references|citations_missing/.test(issue.code)).map(issue=>issue.message),
  ...(quality?.supplementCheck?.items||[]).filter(item=>item.status==='missing').flatMap(item=>(item.missing||[]).map(text=>item.title+'：'+text))
 ])].slice(0,60);
 const findings=[...(quality?.consistency?.findings||[]),...(quality?.reviews||[]).flatMap(review=>review.findings||[])];
 const issues=[...audit.issues.filter(issue=>!/^cover_|reference_minimum|foreign_references|citations_missing/.test(issue.code)).map(issue=>({title:'终稿内容',text:issue.message})),...findings.slice(0,40).map(finding=>({chapterId:finding.sectionId,title:finding.sectionTitle||'正文',text: String(finding.suggestion||finding.explanation||'本项仍需完善').slice(0,500)}))].slice(0,50);
 const current=run.id===row.current_run_id,status=['queued','running'].includes(run.status)?'generating':run.status!=='completed'||stale?'check_required':missing.length?'needs_materials':!supplementCheckReady(quality)||issues.length||needs.chapters.some(chapter=>chapter.needsTableTitles)?'check_required':'ready';
 const fingerprint=thesisHash({runId:run.id,snapshot:row.snapshot_hash,chapters:saved.map(chapter=>[chapter.id,chapter.record?.id||null]),metadata:row.export_metadata||null,template:row.export_template||null,quality:run.quality});
 const receipt=current&&status==='ready'?db.prepare('SELECT confirmed_at FROM thesis_completion_confirmations WHERE thesis_id=? AND run_id=? AND user_id=? AND fingerprint=?').get(row.id,run.id,row.user_id,fingerprint):null;
 return {required:true,runId:run.id,status:receipt?'confirmed':status,fingerprint:current&&status==='ready'?fingerprint:null,confirmedAt:receipt?.confirmed_at||null,changes,missing,issues,simulationUsed:snapshot.materials.some(material=>material.dataKind==='simulation'),checks:{materials:supplementCheckReady(quality),manuscript:quality?.coverage?.complete===true&&!stale,content:missing.length===0&&issues.length===0&&!needs.chapters.some(chapter=>chapter.needsTableTitles)}};
}

export function confirmCompletionReview(db,row,run,input,at){
 if(!input||Object.keys(input).some(key=>!['version','runId','fingerprint'].includes(key))||!Number.isSafeInteger(input.version)||typeof input.runId!=='string'||typeof input.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.fingerprint))throw thesisError(400,'请确认当前自动补充结果');
 if(input.version!==row.version||input.runId!==row.current_run_id)throw thesisError(409,'论文已有新版本，请核对最新补充结果后确认');
 const review=completionReview(db,row,run);
 if(!review||!['ready','confirmed'].includes(review.status)||input.fingerprint!==review.fingerprint)throw thesisError(409,'当前内容或检查结果已变化，请完成检查后重新确认');
 if(review.status==='confirmed')return review;
 db.prepare('INSERT INTO thesis_completion_confirmations(thesis_id,run_id,user_id,fingerprint,confirmed_at) VALUES(?,?,?,?,?)').run(row.id,run.id,row.user_id,review.fingerprint,at);
 return {...review,status:'confirmed',confirmedAt:at};
}
