import {randomUUID} from 'node:crypto';
import {taskProjectId} from './task-project-context.mjs';
import {createBillingService} from './billing-service.mjs';
import {createModelBudget} from './model-budget.mjs';
import {initializeThesisSchema,thesisError,thesisPublicError,thesisTransaction,assertThesisAccountQuota} from './thesis-model.mjs';
import {assertThesisSettings} from './thesis-service.mjs';
import {thesisOutlineTask,parseThesisOutline,validateThesisOutlineCandidate} from './thesis-outline-model.mjs';
import {runAgentTask} from './agent-runtime.mjs';

const validUsage=value=>Number.isSafeInteger(value)&&value>=0;
const executionProtectionMessage='本次提纲生成触发了单次执行保护，原提纲保留；预占权益已释放，本次不扣积分或套餐次数。请重新确认后再试。';
const outlineFailureMessage=(error,runtime)=>['budget_exceeded','execution_budget','cost_budget','turn_limit'].includes(error?.code)||error?.message==='Agent 已超出执行预算，结果未提交'?executionProtectionMessage:thesisPublicError(error,runtime);
export function startThesisOutlineWorker(db,config={}){
 initializeThesisSchema(db);const billing=config.billing||createBillingService(db,config),modelBudget=config.modelBudget||createModelBudget(db,config),clock=()=>new Date(config.thesisNow?.()??Date.now()).toISOString();
 let busy=false,stopped=false,pending=null;const controllers=new Map(),transaction=fn=>thesisTransaction(db,fn);
 function finish(id,status,message){const row=db.prepare('SELECT status FROM thesis_outline_runs WHERE id=?').get(id);if(!row||!['queued','running'].includes(row.status))return;const at=clock();db.prepare('UPDATE thesis_outline_runs SET status=?,stage=?,error=?,updated_at=? WHERE id=?').run(status,status,message,at,id);db.prepare('UPDATE jobs SET status=?,stage=?,error=?,updated_at=? WHERE id=?').run(status,status,message,at,id);billing.release(id);}
 transaction(()=>{for(const row of db.prepare("SELECT id FROM thesis_outline_runs WHERE status='running'").all())finish(row.id,'failed','服务重启中断了提纲生成，预占权益已释放，请重新确认后生成');});
 async function execute(){
  if(busy||stopped)return;const row=db.prepare("SELECT r.* FROM thesis_outline_runs r JOIN jobs j ON j.id=r.id WHERE r.status='queued' AND j.status='queued' ORDER BY r.created_at,r.id LIMIT 1").get();if(!row)return;
  busy=true;const controller=new AbortController();controllers.set(row.id,controller);let runtime={},accounted=false;
  const running=()=>db.prepare("SELECT 1 FROM thesis_outline_runs r JOIN jobs j ON j.id=r.id WHERE r.id=? AND r.status='running' AND j.status='running'").get(row.id);
  const account=(usage)=>{if(accounted)return;accounted=true;if(validUsage(usage?.input)&&validUsage(usage?.output)&&usage.input+usage.output>0)db.prepare('UPDATE thesis_outline_runs SET input_tokens=?,output_tokens=?,updated_at=? WHERE id=?').run(usage.input,usage.output,clock(),row.id);else db.prepare('UPDATE thesis_outline_runs SET usage_known=0,updated_at=? WHERE id=?').run(clock(),row.id);};
  try{
   const claimed=transaction(()=>{if(db.prepare("SELECT 1 FROM thesis_outline_runs WHERE status='running' AND id!=? LIMIT 1").get(row.id))return false;if(!db.prepare("UPDATE thesis_outline_runs SET status='running',stage='preparing',updated_at=? WHERE id=? AND status='queued'").run(clock(),row.id).changes)return false;db.prepare("UPDATE jobs SET status='running',stage='preparing',attempt=1,updated_at=? WHERE id=? AND status='queued'").run(clock(),row.id);modelBudget.start(row.id,1);return true;});if(!claimed)return;
   assertThesisSettings(await config.getAgentSettings?.());runtime=assertThesisSettings(await config.getAgentSettings?.(row.settings_version));if(runtime.version!==row.settings_version)throw thesisError(503,'原提纲生成配置版本不可用，请联系管理员');
   const snapshot=JSON.parse(row.snapshot),budget=Number.isSafeInteger(config.thesisOutlineMaxTokens)&&config.thesisOutlineMaxTokens>=1000&&config.thesisOutlineMaxTokens<=200000?config.thesisOutlineMaxTokens:200000,maxTurns=Math.min(3,Math.max(1,Number(runtime.maxTurns)||3)),maxOutputTokens=Math.min(8000,Math.max(32,Number(runtime.maxOutputTokens)||4096));
   const output=await(config.agentTaskRunner||runAgentTask)({settings:{...runtime,maxTurns,maxOutputTokens,maxTotalTokens:budget},task:thesisOutlineTask(snapshot),validateOutlineOutput:candidate=>validateThesisOutlineCandidate(candidate,snapshot),signal:controller.signal,onStage:stage=>{if(!running())return;const safe=typeof stage==='string'&&/^[a-z][a-z0-9_-]{0,60}$/i.test(stage)?stage:'agent_running';db.prepare('UPDATE thesis_outline_runs SET stage=?,updated_at=? WHERE id=?').run(safe,clock(),row.id);db.prepare("UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND status='running'").run(safe,clock(),row.id);}});
   account(output?.usage);if(controller.signal.aborted||!running())return;
   if(!validUsage(output?.usage?.input)||!validUsage(output?.usage?.output)||output.usage.input+output.usage.output===0)throw thesisError(502,'模型未返回可核算的用量，提纲未标记完成');
   if(output.usage.input+output.usage.output>budget||output.usage.output>maxTurns*maxOutputTokens||Number.isFinite(output.costUsd)&&output.costUsd>runtime.maxCostUsd)throw thesisError(429,'提纲生成超过模型执行预算，结果未提交，预占权益将释放','execution_budget');
   const parsed=parseThesisOutline(output,snapshot);
   transaction(()=>{if(controller.signal.aborted||!running())return;const json=JSON.stringify(parsed);assertThesisAccountQuota(db,row.user_id,Math.max(512,Buffer.byteLength(json))+Math.max(512,Buffer.byteLength(parsed.text)),config);const at=clock(),resultId=randomUUID();billing.settle(row.id);db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run(resultId,row.user_id,taskProjectId(db,row),row.id,'thesis_outline',snapshot.title+' · 论文提纲',JSON.stringify({original:snapshot.title,text:parsed.text,suggestion:parsed.text,chapters:parsed.chapters,outlineJobId:row.id,engine:runtime.engine||'claude-agent-sdk',model:runtime.model,settingsVersion:row.settings_version,requiresReview:true}),at);db.prepare('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),row.user_id,row.id,runtime.engine||'claude-agent-sdk',runtime.model,output.usage.input,output.usage.output,billing.isBillable(row.id)?1:0,at);db.prepare("UPDATE thesis_outline_runs SET status='completed',stage='completed',output=?,result_id=?,error=NULL,updated_at=? WHERE id=?").run(json,resultId,at,row.id);db.prepare("UPDATE jobs SET status='completed',stage='completed',result_id=?,error=NULL,updated_at=? WHERE id=?").run(resultId,at,row.id);});
  }catch(error){account(error.usage);transaction(()=>finish(row.id,stopped?'failed':controller.signal.aborted?'cancelled':'failed',stopped?'服务停止中断了提纲生成，预占权益已释放，请重新确认后生成':outlineFailureMessage(error,runtime)));}
  finally{if(stopped)transaction(()=>finish(row.id,'failed','服务停止中断了提纲生成，预占权益已释放，请重新确认后生成'));controllers.delete(row.id);busy=false;}
 }
 function tick(){if(busy||stopped)return Promise.resolve();pending=execute();return pending;}
 const timer=setInterval(()=>void tick(),Math.max(100,config.thesisOutlinePollMs||1000));timer.unref();
 return{tick,cancel(id){transaction(()=>finish(id,'cancelled','已取消提纲生成，预占权益已释放'));controllers.get(id)?.abort();},async stop(){stopped=true;clearInterval(timer);for(const controller of controllers.values())controller.abort();await pending;},async close(){await this.stop();}};
}
