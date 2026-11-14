import {randomUUID} from 'node:crypto';
import {thesisHash,thesisError,thesisTransaction,assertThesisAccountQuota} from './thesis-model.mjs';
import {savedThesisChapters,completionManuscriptHash} from './thesis-completion.mjs';

// Internal, disabled-by-default lifecycle. No user billing reservation is
// created: every provider dispatch must instead use the paid session ledger.
export function createThesisReviewLifecycle(db,config,{sessions}){
 if(!sessions||typeof sessions.open!=='function'||typeof sessions.recover!=='function')throw thesisError(500,'复查会话配置无效');
 const enabled=()=>{if(config.thesisReviewOnlyEnabled!==true)throw thesisError(503,'终稿复查暂未开放','review_disabled');};
 const tx=fn=>db.isTransaction?fn():thesisTransaction(db,fn);
 const clock=()=>new Date(config.thesisNow?.()??Date.now()).toISOString();
 const own=(id,userId)=>{const row=db.prepare('SELECT * FROM theses WHERE id=? AND user_id=?').get(id,userId);if(!row)throw thesisError(404,'论文不存在');return row;};
 const versions=row=>savedThesisChapters(db,row).map(({record,...chapter})=>({...chapter,record}));
 // Lock the work's identity and chapter hierarchy, not mutable research
 // inputs. A user may supply or correct methods, questions, sources, and
 // section settings; the ensuing review still checks the new snapshot and
 // never treats a newly supplied statement as automatically verified.
 const studyIdentity=snapshot=>thesisHash({title:snapshot.title,profile:{level:snapshot.profile?.level,discipline:snapshot.profile?.discipline,major:snapshot.profile?.major,language:snapshot.profile?.language},outline:(snapshot.outline||[]).map(chapter=>({id:chapter.id,title:chapter.title,kind:chapter.kind,sections:(chapter.sections||[]).map(section=>({id:section.id,title:section.title}))})),mode:{deliveryVersion:snapshot.requirements?.deliveryVersion,contentMode:snapshot.requirements?.contentMode}});
 const baseline=row=>thesisHash({snapshot:row.snapshot_hash,metadata:row.export_metadata||null,template:row.export_template||null,chapters:versions(row).map(v=>[v.id,v.record?.id||null])});
 function enqueue({userId,thesisId,version,paidRunId,clientKey,settings}){
  enabled();if(typeof clientKey!=='string'||clientKey.length<8||clientKey.length>100||!Number.isSafeInteger(version)||typeof paidRunId!=='string')throw thesisError(400,'复查请求无效');
  return tx(()=>{
   const row=own(thesisId,userId),hash=thesisHash({operation:'review-only',thesisId,version,paidRunId});
   const prior=db.prepare('SELECT * FROM thesis_commands WHERE user_id=? AND client_key=?').get(userId,clientKey);
   if(prior){if(prior.input_hash!==hash||prior.thesis_id!==thesisId)throw thesisError(409,'此提交标识已用于其他论文操作');return {runId:prior.run_id,created:false};}
   if(row.version!==version||['queued','running','cancelling'].includes(row.status))throw thesisError(409,'论文已更新或正在处理，请刷新后重试');
   if(db.prepare("SELECT count(*) n FROM thesis_runs WHERE user_id=? AND status IN ('queued','running','cancelling')").get(userId).n>=2||db.prepare("SELECT count(*) n FROM thesis_runs WHERE status IN ('queued','running','cancelling')").get().n>=50)throw thesisError(429,'当前处理队列较忙，请稍后重试');
   const chapters=versions(row);if(!chapters.some(chapter=>chapter.record?.text?.trim()))throw thesisError(409,'请先保存论文正文');
   const session=sessions.open({userId,thesisId,paidRunId});
   if(session.unknown||session.inFlight)throw thesisError(409,'上次复查费用尚待核对，请联系支持；本次未额外扣费。','review_usage_unknown');
   if(session.remainingTokens<1||session.remainingCostUsd<=0)throw thesisError(429,'本次复查暂未完成，请联系支持；本次未额外扣费。','review_budget_exhausted');
   if(settings?.version!==session.settingsVersion||settings?.model!==session.settingsModel||(settings?.engine||'claude-agent-sdk')!==session.settingsEngine)throw thesisError(409,'原服务配置已变化，请联系支持','review_settings_changed');
   const original=db.prepare('SELECT settings_meta,snapshot FROM thesis_runs WHERE id=? AND user_id=? AND thesis_id=?').get(paidRunId,userId,thesisId),originalMeta=JSON.parse(original.settings_meta||'{}');
   if(studyIdentity(JSON.parse(original.snapshot))!==studyIdentity(JSON.parse(row.snapshot)))throw thesisError(409,'论文题目、类型或提纲已改变，不能沿用原完善服务复查，请重新确认处理方式。','review_study_changed');
   const runId=randomUUID(),at=clock(),meta={version:settings.version,model:settings.model,engine:settings.engine||'claude-agent-sdk',executionMaxCostUsd:settings.maxCostUsd,reviewOnly:true,reviewSessionId:session.id,reviewPaidRunId:paidRunId,reviewBaseline:baseline(row),completion:originalMeta.completion,qualityReview:true,supplementCheck:true};
   assertThesisAccountQuota(db,userId,Buffer.byteLength(row.snapshot)+2048,config);
   db.prepare('INSERT INTO jobs(id,user_id,project_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(runId,userId,row.project_id,'thesis','queued','queued',JSON.stringify({thesisId,reviewOnly:true}),`thesis:${clientKey}`,hash,at,at);
   db.prepare('INSERT INTO thesis_runs(id,thesis_id,user_id,snapshot,snapshot_hash,plan,settings_version,settings_meta,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(runId,thesisId,userId,row.snapshot,row.snapshot_hash,'[]',settings.version,JSON.stringify(meta),'queued','queued',at,at);
   db.prepare('INSERT INTO thesis_commands VALUES(?,?,?,?,?,?)').run(userId,clientKey,thesisId,runId,hash,at);
   db.prepare("UPDATE theses SET current_run_id=?,status='queued',version=version+1,updated_at=? WHERE id=? AND user_id=?").run(runId,at,thesisId,userId);
   return {runId,created:true};
  });
 }
 function current(run){const row=own(run.thesis_id,run.user_id),now=db.prepare('SELECT * FROM thesis_runs WHERE id=? AND user_id=?').get(run.id,run.user_id),job=db.prepare('SELECT status,attempt FROM jobs WHERE id=? AND user_id=?').get(run.id,run.user_id),meta=JSON.parse(now?.settings_meta||'{}');return Boolean(now&&now.status==='running'&&now.attempt===run.attempt&&job?.status==='running'&&job.attempt===run.attempt&&row.current_run_id===run.id&&row.snapshot_hash===now.snapshot_hash&&meta.reviewOnly===true&&meta.reviewBaseline===baseline(row));}
 function finish(run,quality){return tx(()=>{if(!current(run))throw thesisError(409,'论文或资料已变化，请重新检查','review_changed');const row=own(run.thesis_id,run.user_id),chapters=versions(row).map(({record,...chapter})=>({...chapter,text:record?.text||'',figures:JSON.parse(record?.figures||'[]')}));const complete=quality?.status==='completed'&&quality.coverage?.complete===true&&quality.supplementCheck?.coverage?.complete===true&&quality.snapshotHash===run.snapshot_hash&&quality.manuscriptHash===completionManuscriptHash(chapters);if(!complete)throw thesisError(502,'本次检查未完成，已保存内容保留','review_incomplete');const at=clock(),serialized=JSON.stringify(quality);assertThesisAccountQuota(db,run.user_id,Buffer.byteLength(serialized),config);db.prepare("UPDATE thesis_runs SET status='completed',stage='completed',quality=?,updated_at=? WHERE id=? AND attempt=?").run(serialized,at,run.id,run.attempt);db.prepare("UPDATE jobs SET status='completed',stage='completed',updated_at=? WHERE id=? AND user_id=?").run(at,run.id,run.user_id);db.prepare("UPDATE theses SET status='completed',version=version+1,updated_at=? WHERE id=? AND user_id=? AND current_run_id=?").run(at,run.thesis_id,run.user_id,run.id);});}
 function stop(run,status='failed'){return tx(()=>{const row=own(run.thesis_id,run.user_id),current=db.prepare('SELECT * FROM thesis_runs WHERE id=? AND user_id=?').get(run.id,run.user_id);if(!current||row.current_run_id!==run.id||current.attempt!==run.attempt||!['running','queued'].includes(current.status))return false;const at=clock(),safe=['failed','cancelled','interrupted'].includes(status)?status:'failed';db.prepare('UPDATE thesis_runs SET status=?,stage=?,error=?,updated_at=? WHERE id=?').run(safe,safe,'本次复查未完成，已保存内容保留；没有额外扣费。',at,run.id);db.prepare('UPDATE jobs SET status=?,stage=?,error=?,updated_at=? WHERE id=?').run(safe==='cancelled'?'cancelled':'failed',safe,'本次复查未完成，已保存内容保留；没有额外扣费。',at,run.id);db.prepare('UPDATE theses SET status=?,version=version+1,updated_at=? WHERE id=? AND current_run_id=?').run(safe,at,run.thesis_id,run.id);const recovered=sessions.recover({userId:run.user_id,thesisId:run.thesis_id,sessionId:JSON.parse(current.settings_meta).reviewSessionId,reviewRunId:run.id,attempt:run.attempt});if(recovered.usageConflict){const message='本次复查已停止，记录异常请联系支持；本次未额外扣费。';db.prepare('UPDATE thesis_runs SET error=? WHERE id=?').run(message,run.id);db.prepare('UPDATE jobs SET error=? WHERE id=?').run(message,run.id);}return true;});}
 return {enqueue,current,finish,stop};
}
