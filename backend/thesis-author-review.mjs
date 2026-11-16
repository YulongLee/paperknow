import {randomUUID} from 'node:crypto';
import {thesisError} from './thesis-model.mjs';
import {authorReviewCategories} from '../dist/workspace/thesis-author-review-model.mjs';

function sourcesFor(issue,snapshot,chapters){
 const chapter=chapters.find(c=>c.id===issue.chapterId);if(!chapter)return [];
 const abstract=/^front-abstract_/.test(chapter.id)||/^摘要$|^abstract$/i.test(chapter.title||'');
 const texts=abstract?chapters.filter(c=>!/^参考文献$|^references$/i.test(c.title||'')).map(c=>c.text||c.record?.text||''):[chapter.text||chapter.record?.text||''];
 const ids=new Set(texts.flatMap(text=>[...text.matchAll(/\[source:([^\]\n]{1,200})\]/g)].map(m=>m[1]))),all=[...(snapshot.materials||[]),...(snapshot.references||[])];
 return all.filter(s=>ids.has(s.id)&&s.confirmed===true&&typeof s.text==='string'&&s.text.trim()&&all.filter(other=>other.id===s.id).length===1);
}
export function decorateAuthorReviews(db,row,run,issues,snapshot,chapters,{current=false}={}){
 if(!current||run?.status!=='completed')return issues;
 for(const issue of issues){
  const sources=issue.source==='review'&&['warning','info'].includes(issue.severity)&&authorReviewCategories.includes(issue.category)?sourcesFor(issue,snapshot,chapters):[];
  issue.authorReviewAllowed=sources.length>0;
  if(!issue.authorReviewAllowed)continue;
  issue.authorReviewSources=sources.slice(0,40).map(s=>({id:s.id,name:String(s.name||s.title||'已保存资料').slice(0,240)}));
  const event=db.prepare('SELECT * FROM thesis_author_review_events WHERE thesis_id=? AND user_id=? AND run_id=? AND basis=? AND issue_id=? ORDER BY rowid DESC LIMIT 1').get(row.id,row.user_id,run.id,issue.basis,issue.id),source=event&&sources.find(s=>s.id===event.source_id);
  if(event?.decision==='keep'&&source&&event.reason.trim().length>=20&&event.source_quote.trim().length>=8&&source.text.includes(event.source_quote))issue.authorReview={id:event.id,confirmed:true,reason:event.reason,sourceId:event.source_id,sourceName:String(source.name||source.title||'已保存资料').slice(0,240),sourceQuote:event.source_quote,confirmedAt:event.created_at};
 }
 return issues;
}
export function authorReviewQuality(quality,issues){
 if(!quality)return quality;
 return {...quality,authorReview:{version:1,scope:'author_confirmation_not_independent_verification',items:issues.filter(i=>i.authorReviewAllowed&&i.authorReview?.confirmed).map(i=>({id:i.authorReview.id,basis:i.basis,source:'review',confirmed:true,chapterId:i.chapterId,offset:i.offset,quote:i.quote,category:i.category,severity:i.severity,reasonCode:i.reasonCode,explanation:i.explanation,suggestion:i.suggestion,...i.authorReview}))}};
}
export function recordAuthorReview(db,row,run,review,input,at){
 if(!review?.reportCurrent||run?.status!=='completed'||run.id!==row.current_run_id||run.thesis_id!==row.id||run.user_id!==row.user_id||review.runId!==input.runId)throw thesisError(409,'论文或检查结果已变化，请重新检查');
 const issue=review.reviewItems?.find(i=>i.id===input.issueId);
 if(!issue?.authorReviewAllowed)throw thesisError(409,'本项需修改正文或补充材料，不能用作者确认替代');
 let reason='',sourceId='',sourceQuote='';
 if(input.confirmed){
  reason=typeof input.reason==='string'?input.reason.trim():'';sourceId=typeof input.sourceId==='string'?input.sourceId:'';sourceQuote=typeof input.sourceQuote==='string'?input.sourceQuote.trim():'';
  if(reason.length<20||reason.length>500||sourceQuote.length<8||sourceQuote.length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(reason+sourceQuote))throw thesisError(400,'请填写20～500字核对说明，并摘录8～500字已保存资料作为依据');
  const snapshot=JSON.parse(row.snapshot),source=[...(snapshot.materials||[]),...(snapshot.references||[])].find(s=>s.id===sourceId&&s.confirmed===true);
  if(!issue.authorReviewSources.some(s=>s.id===sourceId)||!source?.text?.includes(sourceQuote))throw thesisError(422,'核对摘录须逐字来自所选的已保存资料，请检查资料和摘录');
  if(issue.authorReview?.confirmed&&issue.authorReview.reason===reason&&issue.authorReview.sourceId===sourceId&&issue.authorReview.sourceQuote===sourceQuote)return false;
 }else if(!issue.authorReview?.confirmed)return false;
 if(db.prepare('SELECT count(*) n FROM thesis_author_review_events WHERE thesis_id=? AND user_id=? AND run_id=? AND issue_id=?').get(row.id,row.user_id,run.id,issue.id).n>=100)throw thesisError(429,'本项核对次数过多，请修改正文后重新检查');
 db.prepare('INSERT INTO thesis_author_review_events(id,thesis_id,user_id,run_id,issue_id,basis,decision,reason,source_id,source_quote,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),row.id,row.user_id,run.id,issue.id,issue.basis,input.confirmed?'keep':'revoke',reason,sourceId,sourceQuote,at);
 return true;
}
