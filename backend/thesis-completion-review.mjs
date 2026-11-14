import {citedDuplicateDoiIssues} from './thesis-duplicate-doi.mjs';
import {completionResolutions} from './thesis-completion-guidance.mjs';
import {completionContentAudit} from './thesis-completion-audit.mjs';
import {thesisHash,thesisError} from './thesis-model.mjs';
import {savedThesisChapters,completionManuscriptHash} from './thesis-completion.mjs';
import {thesisCompletionNeeds} from '../dist/workspace/thesis-completion-model.mjs';
import {supplementCheckReady} from '../dist/workspace/supplement-check-panel.mjs';

export function simulationCompletionProgress(snapshot,run,chapters,{current=false}={}){
 const saved=(snapshot.materials||[]).filter(row=>row.dataKind==='simulation'),runMaterials=(JSON.parse(run?.snapshot||'{}').materials||[]).filter(row=>row.dataKind==='simulation'),provided=new Set(saved.filter(row=>runMaterials.some(old=>old.id===row.id&&old.text===row.text&&JSON.stringify(old.simulation)===JSON.stringify(row.simulation))).map(row=>row.id));
 const cited=new Set(chapters.flatMap(row=>[...String(row.text||'').matchAll(/\[source:([^\]]+)\]/g)].map(match=>match[1])));
 return {savedCount:saved.length,records:saved.reduce((sum,row)=>sum+(row.simulation?.recipe?.sampleSize||0),0),includedCount:saved.filter(row=>provided.has(row.id)).length,usedCount:saved.filter(row=>provided.has(row.id)&&cited.has(row.id)).length,checked:current&&supplementCheckReady(JSON.parse(run?.quality||'null'))};
}

// Confirmation is tied to immutable chapter versions AND the current research,
// cover, template and review. It is an acknowledgement, never research evidence.
export function completionReview(db,row,run){
 const completion=JSON.parse(run?.settings_meta||'{}').completion;
 if(completion?.scope!=='full')return null;
 if(['queued','running'].includes(run.status))return {required:true,runId:run.id,status:'generating',fingerprint:null,changes:[],missing:[],issues:[],checks:{materials:false,manuscript:false,content:false}};
 const snapshot=JSON.parse(row.snapshot),saved=savedThesisChapters(db,row),chapters=saved.map(({record,...chapter})=>({...chapter,text:record?.text||'',figures:JSON.parse(record?.figures||'[]')}));
 const quality=run.quality?JSON.parse(run.quality):null,basisChanged=run.snapshot_hash!==row.snapshot_hash,stale=basisChanged||quality?.manuscriptHash!==completionManuscriptHash(chapters),current=run.id===row.current_run_id,simulation=simulationCompletionProgress(snapshot,run,chapters,{current:current&&!stale});
 const audit=completionContentAudit(snapshot,chapters,quality,row),needs=thesisCompletionNeeds({snapshot,chapters});
 const informationMissing=audit.issues.filter(issue=>/^cover_/.test(issue.code)).map(issue=>issue.message);
 const references=snapshot.references.filter(row=>row.confirmed!==false);if(references.length&&!references.some(row=>row.text?.trim()))informationMissing.push('已保存 '+references.length+' 篇文献题录，尚无可引用的摘要或正文。请补充对应文献内容。');
 if(basisChanged)return {required:true,runId:run.id,status:'check_required',fingerprint:null,confirmedAt:null,basisChanged:true,reportCurrent:false,reasonCode:'research_updated',nextAction:'update_manuscript',changes:[],missing:[],issues:[],suggestions:[],informationMissing,pendingSections:needs.chapters.map(({title,requests})=>({title,requests})),simulation,simulationUsed:simulation.usedCount>0,checks:{materials:false,manuscript:false,content:false}};
 const changes=saved.flatMap(({record,...chapter})=>{
  const prior=completion.baseline.find(reference=>reference.chapterId===chapter.id),before=prior?db.prepare('SELECT text FROM thesis_chapter_versions WHERE id=? AND thesis_id=? AND chapter_id=?').get(prior.versionId,row.id,chapter.id):null;
  return record&&record.id!==prior?.versionId?[{chapterId:chapter.id,title:chapter.title,kind:before?.text?.trim()?'updated':'added',beforeVersionId:prior?.versionId||null,version:record.version,characters:record.text.length}]:[];
 });
 const missing=[...new Set([
  ...needs.chapters.flatMap(chapter=>chapter.requests.map(request=>chapter.title+'：'+request)),
  ...audit.issues.filter(issue=>/^cover_|reference_minimum|foreign_references|citations_missing/.test(issue.code)).map(issue=>issue.message),
  ...(quality?.supplementCheck?.items||[]).filter(item=>item.status==='missing').flatMap(item=>(item.missing||[]).map(text=>item.title+'：'+text))
 ])].slice(0,60);
 const findings=[...(quality?.consistency?.findings||[]),...(quality?.reviews||[]).flatMap(review=>review.findings||[])];
 const issues=[...citedDuplicateDoiIssues(snapshot,chapters),...audit.issues.filter(issue=>!/^cover_|reference_minimum|foreign_references|citations_missing/.test(issue.code)).map(issue=>({title:'终稿内容',text:issue.message})),...findings.filter(finding=>finding.severity!=='info'||finding.category==='language_expression').slice(0,40).map(finding=>({chapterId:finding.sectionId,title:finding.sectionTitle||'正文',text: String(finding.suggestion||finding.explanation||'本项仍需完善').slice(0,500)}))].slice(0,50);
 const suggestions=[];
 const reviewMeta=JSON.parse(run.settings_meta||'{}'),billingRunId=reviewMeta.reviewOnly===true?reviewMeta.reviewPaidRunId:run.id;
 const paidStatus=db.prepare("SELECT status FROM billing_reservations WHERE job_id=? AND user_id=? ORDER BY attempt DESC LIMIT 1").get(billingRunId,row.user_id)?.status||null;
 const billingStatus=reviewMeta.reviewOnly===true&&paidStatus==='settled'?'included':paidStatus;
 const checkUnavailable=quality?.supplementCheck?.status==='unavailable';
 const status=['queued','running'].includes(run.status)?'generating':run.status!=='completed'||stale||checkUnavailable?'check_required':missing.length?'needs_materials':!supplementCheckReady(quality)||issues.length||needs.chapters.some(chapter=>chapter.needsTableTitles)?'check_required':'ready';
 const fingerprint=thesisHash({runId:run.id,snapshot:row.snapshot_hash,chapters:saved.map(chapter=>[chapter.id,chapter.record?.id||null]),metadata:row.export_metadata||null,template:row.export_template||null,quality:run.quality});
 const receipt=current&&status==='ready'?db.prepare('SELECT confirmed_at FROM thesis_completion_confirmations WHERE thesis_id=? AND run_id=? AND user_id=? AND fingerprint=?').get(row.id,run.id,row.user_id,fingerprint):null;
 return {required:true,runId:run.id,billingStatus,status:receipt?'confirmed':status,fingerprint:current&&status==='ready'?fingerprint:null,confirmedAt:receipt?.confirmed_at||null,basisChanged:false,reportCurrent:current&&!stale,reasonCode:stale?'manuscript_updated':checkUnavailable?'check_unavailable':null,nextAction:status==='ready'?'confirm':'complete_and_check',changes,missing,issues,suggestions,informationMissing,diagnosis:completionResolutions(quality?.completionDiagnosis,quality?.supplementCheck,chapters,{current:current&&!stale}),simulation,simulationUsed:simulation.usedCount>0,checks:{materials:!stale&&supplementCheckReady(quality),manuscript:quality?.coverage?.complete===true&&!stale,content:missing.length===0&&issues.length===0&&!needs.chapters.some(chapter=>chapter.needsTableTitles)}};
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
