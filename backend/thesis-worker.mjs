import {randomUUID} from 'node:crypto';
import {createBillingService} from './billing-service.mjs';
import {createModelBudget} from './model-budget.mjs';
import {initializeThesisSchema,thesisAgentTask,parseThesisSection,thesisFullText,thesisLimits,thesisError,thesisPublicError,thesisTransaction,assertThesisAccountQuota,assertThesisChapterCapacity,isThesisReferenceChapter,compileThesisReferences} from './thesis-model.mjs';
import {assertThesisSettings} from './thesis-service.mjs';
import {runAgentTask} from './agent-runtime.mjs';

const active=status=>status==='running'||status==='queued';
const validUsage=value=>Number.isSafeInteger(value)&&value>=0;
const safeStage=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,60}$/i.test(value)?value:'agent_running';
const cleanTrace=value=>(Array.isArray(value)?value:[]).slice(-50).map(row=>({stage:safeStage(typeof row==='string'?row:row?.stage||row?.tool||row?.type),...(row?.tool==='read_material'&&row.status==='completed'&&typeof row.materialId==='string'?{tool:'read_material',status:'completed',materialId:row.materialId.slice(0,100)}:{})}));

export function startThesisWorker(db,config={}){
 initializeThesisSchema(db);
 const billing=config.billing||createBillingService(db,config),modelBudget=config.modelBudget||createModelBudget(db,config),limits=thesisLimits(config);
 const clock=()=>new Date(config.thesisNow?.()??Date.now()).toISOString();
 let busy=false,stopped=false,currentPromise=null;const controllers=new Map();
 const transaction=fn=>thesisTransaction(db,fn);
 function markStopped(runId,status,message){
  const run=db.prepare('SELECT * FROM thesis_runs WHERE id=?').get(runId);if(!run||!active(run.status))return;
  const at=clock();db.prepare('UPDATE thesis_runs SET status=?,stage=?,error=?,updated_at=? WHERE id=?').run(status,status,message,at,runId);
  db.prepare('UPDATE jobs SET status=?,stage=?,error=?,updated_at=? WHERE id=?').run(status==='interrupted'?'failed':status,status,message,at,runId);
  db.prepare('UPDATE theses SET status=?,version=version+1,updated_at=? WHERE id=? AND current_run_id=?').run(status,at,run.thesis_id,runId);
  billing.release(runId);
 }
 transaction(()=>{for(const run of db.prepare("SELECT id FROM thesis_runs WHERE status='running'").all())markStopped(run.id,'interrupted','服务重启中断了任务；已完成章节已保存，预占权益已释放，请确认后续跑');});
 async function execute(){
  if(busy||stopped)return;
  const run=db.prepare("SELECT r.* FROM thesis_runs r JOIN theses t ON t.id=r.thesis_id WHERE r.status='queued' AND t.current_run_id=r.id ORDER BY r.created_at,r.id LIMIT 1").get();
  if(!run)return;busy=true;const controller=new AbortController();controllers.set(run.id,controller);let runtime={};
  try{
   const claimed=transaction(()=>{if(db.prepare("SELECT id FROM thesis_runs WHERE status='running' AND id!=? LIMIT 1").get(run.id))return false;if(!db.prepare("UPDATE thesis_runs SET status='running',stage='preparing',updated_at=? WHERE id=? AND status='queued'").run(clock(),run.id).changes)return false;
    db.prepare("UPDATE jobs SET status='running',stage='preparing',attempt=?,updated_at=? WHERE id=? AND status='queued'").run(run.attempt,clock(),run.id);
    db.prepare("UPDATE theses SET status='running',version=version+1,updated_at=? WHERE id=? AND current_run_id=?").run(clock(),run.thesis_id,run.id);modelBudget.start(run.id,run.attempt);return true;});
   if(!claimed)return;
   assertThesisSettings(await config.getAgentSettings?.());
   runtime=assertThesisSettings(await config.getAgentSettings?.(run.settings_version));
   if(runtime.version!==run.settings_version)throw thesisError(503,'原生成配置版本不可用，请联系管理员');
   const snapshot=JSON.parse(run.snapshot),plan=JSON.parse(run.plan),baseline=run.input_tokens+run.output_tokens;
   const runner=config.agentTaskRunner||runAgentTask;
   if(typeof runner!=='function')throw thesisError(503,'毕业论文 Agent 执行器尚未接入');
   for(const unit of plan){
    if(stopped)throw thesisError(503,'服务停止中断了任务');
    if(controller.signal.aborted||db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(run.id)?.status!=='running')return;
    const checkpoint=db.prepare('SELECT * FROM thesis_checkpoints WHERE run_id=? AND unit_id=?').get(run.id,unit.id);if(checkpoint.status==='completed')continue;
    assertThesisSettings(await config.getAgentSettings?.());
    const complete=db.prepare("SELECT * FROM thesis_checkpoints WHERE run_id=? AND status='completed' ORDER BY position").all(run.id);
    const task=thesisAgentTask(snapshot,unit,complete),maxTurns=Math.min(3,Math.max(1,Number(runtime.maxTurns)||3)),maxOutputTokens=Math.min(8000,Math.max(32,Number(runtime.maxOutputTokens)||4096));
    // The runtime relay enforces maxTotalTokens against the complete actual SDK
    // request, including system instructions, tool schemas and growing history.
    const totals=db.prepare('SELECT input_tokens,output_tokens FROM thesis_runs WHERE id=?').get(run.id),spent=totals.input_tokens+totals.output_tokens-baseline;
    if(spent+maxOutputTokens>=limits.maxRunTokens)throw thesisError(429,'本次生成已达到模型预算边界，已保留完成章节；请确认新报价后续跑','budget_exceeded');
    transaction(()=>{db.prepare("UPDATE thesis_checkpoints SET status='running',error=NULL,updated_at=? WHERE run_id=? AND unit_id=? AND status!='completed'").run(clock(),run.id,unit.id);db.prepare("UPDATE thesis_runs SET stage='generating_section',updated_at=? WHERE id=?").run(clock(),run.id);db.prepare("UPDATE jobs SET stage='generating_section',updated_at=? WHERE id=?").run(clock(),run.id);});
    let result,accounted=false;
    try{
     db.prepare('UPDATE thesis_runs SET provider_calls=provider_calls+1 WHERE id=?').run(run.id);
     result=await runner({settings:{...runtime,maxTurns,maxOutputTokens,maxTotalTokens:limits.maxRunTokens-spent},task,signal:controller.signal,onStage:stage=>{if(db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(run.id)?.status!=='running')return;const value=safeStage(stage);db.prepare('UPDATE thesis_runs SET stage=?,updated_at=? WHERE id=?').run(value,clock(),run.id);db.prepare("UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND status='running'").run(value,clock(),run.id);}});
     if(!validUsage(result?.usage?.input)||!validUsage(result?.usage?.output)||result.usage.input+result.usage.output===0)throw thesisError(502,'模型未返回可核算的用量，当前章节未标记完成，请联系管理员后重试','usage_unknown');
     transaction(()=>{db.prepare('UPDATE thesis_runs SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,updated_at=? WHERE id=?').run(result.usage.input,result.usage.output,clock(),run.id);db.prepare('UPDATE thesis_checkpoints SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,updated_at=? WHERE run_id=? AND unit_id=?').run(result.usage.input,result.usage.output,clock(),run.id,unit.id);});
     accounted=true;
     if(controller.signal.aborted||db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(run.id)?.status!=='running')return;
     if(spent+result.usage.input+result.usage.output>limits.maxRunTokens)throw thesisError(429,'模型实际用量达到本次预算上限，当前输出未作为完整章节提交，请确认后续跑','budget_exceeded');
     const content=parseThesisSection(result,snapshot,unit);
     transaction(()=>{
      if(db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(run.id)?.status!=='running')return;
      assertThesisAccountQuota(db,run.user_id,Math.max(512,Buffer.byteLength(content.text)+Buffer.byteLength(JSON.stringify(cleanTrace(result.trace))))-Math.max(512,Buffer.byteLength(checkpoint.text)+Buffer.byteLength(checkpoint.trace)),config);
      db.prepare("UPDATE thesis_checkpoints SET status='completed',text=?,source_ids=?,missing_evidence='[]',error=NULL,engine=?,model=?,trace=?,updated_at=? WHERE run_id=? AND unit_id=? AND status='running'").run(content.text,JSON.stringify(content.sourceIds),runtime.engine||'claude-agent-sdk',runtime.model,JSON.stringify(cleanTrace(result.trace)),clock(),run.id,unit.id);
      const chapterUnits=db.prepare('SELECT * FROM thesis_checkpoints WHERE run_id=? AND chapter_id=? ORDER BY position').all(run.id,unit.chapterId);
      if(chapterUnits.every(row=>row.status==='completed')&&!db.prepare("SELECT id FROM thesis_chapter_versions WHERE run_id=? AND chapter_id=? AND source='generated'").get(run.id,unit.chapterId)){
       const previous=db.prepare('SELECT coalesce(max(version),0) version FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=?').get(run.thesis_id,unit.chapterId).version;
       const text=chapterUnits.map(row=>{const part=plan.find(item=>item.id===row.unit_id);return `${part.part===1&&part.title!==part.chapterTitle?part.title+'\n\n':''}${row.text}`;}).join('\n\n');
       const sources=[...new Set(chapterUnits.flatMap(row=>JSON.parse(row.source_ids)))];
       assertThesisChapterCapacity(db,run.thesis_id,unit.chapterId);assertThesisAccountQuota(db,run.user_id,Math.max(512,Buffer.byteLength(text)),config);
       db.prepare('INSERT INTO thesis_chapter_versions VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),run.thesis_id,unit.chapterId,previous+1,run.id,'generated',text,JSON.stringify(sources),clock());
      }
      db.prepare('UPDATE theses SET version=version+1,updated_at=? WHERE id=? AND current_run_id=?').run(clock(),run.thesis_id,run.id);
     });
    }catch(error){
     if(!accounted){const usage=error.usage;transaction(()=>{if(validUsage(usage?.input)&&validUsage(usage?.output)){db.prepare('UPDATE thesis_runs SET input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE id=?').run(usage.input,usage.output,run.id);db.prepare('UPDATE thesis_checkpoints SET input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE run_id=? AND unit_id=?').run(usage.input,usage.output,run.id,unit.id);}else db.prepare('UPDATE thesis_runs SET usage_known=0 WHERE id=?').run(run.id);});}
     if(db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(run.id)?.status==='running')transaction(()=>db.prepare("UPDATE thesis_checkpoints SET status='failed',error=?,missing_evidence=?,updated_at=? WHERE run_id=? AND unit_id=? AND status!='completed'").run(thesisPublicError(error,runtime),JSON.stringify(error.missingEvidence||[]),clock(),run.id,unit.id));
     throw error;
    }
   }
   if(controller.signal.aborted||db.prepare('SELECT status FROM thesis_runs WHERE id=?').get(run.id)?.status!=='running')return;
   transaction(()=>{
    const checkpoints=db.prepare('SELECT * FROM thesis_checkpoints WHERE run_id=? ORDER BY position').all(run.id);
    if(checkpoints.length!==plan.length||checkpoints.some(row=>row.status!=='completed'))throw thesisError(409,'章节尚未全部完成，未将任务标为成功');
    const usedSources=[...new Set(checkpoints.flatMap(row=>JSON.parse(row.source_ids)))],bibliography=compileThesisReferences(snapshot,usedSources);
    for(const chapter of snapshot.outline.filter(isThesisReferenceChapter))if(bibliography&&!db.prepare("SELECT id FROM thesis_chapter_versions WHERE run_id=? AND chapter_id=? AND source='generated'").get(run.id,chapter.id)){
     assertThesisChapterCapacity(db,run.thesis_id,chapter.id);assertThesisAccountQuota(db,run.user_id,Math.max(512,Buffer.byteLength(bibliography)),config);
     const previous=db.prepare('SELECT coalesce(max(version),0) version FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=?').get(run.thesis_id,chapter.id).version;
     db.prepare('INSERT INTO thesis_chapter_versions VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),run.thesis_id,chapter.id,previous+1,run.id,'generated',bibliography,JSON.stringify(snapshot.references.filter(row=>row.confirmed&&usedSources.includes(row.id)).map(row=>row.id)),clock());
    }
    const chapters=snapshot.outline.map(chapter=>{const version=db.prepare("SELECT * FROM thesis_chapter_versions WHERE run_id=? AND chapter_id=? AND source='generated'").get(run.id,chapter.id);if(!version&&!isThesisReferenceChapter(chapter))throw thesisError(409,'章节检查点尚未完整保存');return {...chapter,text:version?.text||'',sourceIds:version?JSON.parse(version.source_ids):[],source:isThesisReferenceChapter(chapter)?'confirmed_reference_list':'agent_draft'};});
    const suggestion=thesisFullText(snapshot,chapters),resultId=randomUUID(),at=clock(),totals=db.prepare('SELECT input_tokens,output_tokens,usage_known FROM thesis_runs WHERE id=?').get(run.id);
    billing.settle(run.id);
    db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run(resultId,run.user_id,db.prepare('SELECT project_id FROM theses WHERE id=?').get(run.thesis_id).project_id,run.id,'agent',snapshot.title,JSON.stringify({original:'',suggestion,thesisId:run.thesis_id,engine:runtime.engine||'claude-agent-sdk',model:runtime.model,settingsVersion:run.settings_version,chapters:chapters.map(({id,title,text,sourceIds,source})=>({id,title,text,sourceIds,source})),materials:snapshot.materials.filter(row=>row.confirmed).map(({id,name})=>({id,name})),references:snapshot.references.filter(row=>row.confirmed).map(({id,title,authors,year,doi,url})=>({id,title,authors,year,doi,url})),trace:checkpoints.flatMap(row=>JSON.parse(row.trace)).slice(-100),referenceListIncomplete:snapshot.outline.some(isThesisReferenceChapter)&&!bibliography,requiresReview:true}),at);
    db.prepare('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),run.user_id,run.id,runtime.engine||'claude-agent-sdk',runtime.model,totals.usage_known?totals.input_tokens:null,totals.usage_known?totals.output_tokens:null,billing.isBillable(run.id)?1:0,at);
    db.prepare("UPDATE thesis_runs SET status='completed',stage='completed',error=NULL,result_id=?,updated_at=? WHERE id=?").run(resultId,at,run.id);
    db.prepare("UPDATE jobs SET status='completed',stage='completed',error=NULL,result_id=?,updated_at=? WHERE id=?").run(resultId,at,run.id);
    db.prepare("UPDATE theses SET status='completed',version=version+1,updated_at=? WHERE id=? AND current_run_id=?").run(at,run.thesis_id,run.id);
   });
  }catch(error){
   const status=stopped?'interrupted':error.code==='needs_materials'?'needs_materials':'failed',message=stopped?'服务停止中断了任务；已完成章节已保存，预占权益已释放':thesisPublicError(error,runtime);
   transaction(()=>markStopped(run.id,status,message));
  }finally{controllers.delete(run.id);busy=false;}
 }
 function tick(){if(busy||stopped)return Promise.resolve();currentPromise=execute();return currentPromise;}
 const timer=setInterval(()=>void tick(),Math.max(100,config.thesisPollMs||1000));timer.unref();
 return {tick,cancel(id){transaction(()=>markStopped(id,'cancelled','用户取消了任务，已完成章节已保存，预占权益已释放'));controllers.get(id)?.abort();},async stop(){stopped=true;clearInterval(timer);for(const controller of controllers.values())controller.abort();await currentPromise;},async close(){await this.stop();}};
}
