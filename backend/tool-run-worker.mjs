import {randomUUID} from 'node:crypto';
import {createBillingService} from './billing-service.mjs';
import {createModelBudget} from './model-budget.mjs';
import {thesisTransaction,thesisError,thesisPublicError} from './thesis-model.mjs';
import {assertThesisSettings} from './thesis-service.mjs';
import {initializeToolRunSchema,toolStorageCheck} from './tool-run-service.mjs';
import {toolRunTask,parseToolOutput,validateToolCandidate,joinToolOutputs,toolOperationNames} from './tool-run-model.mjs';
import {runAgentTask} from './agent-runtime.mjs';
import {publicAIError} from './public-ai-metadata.mjs';
const validUsage=v=>Number.isSafeInteger(v)&&v>=0;
export function startToolRunWorker(db,config={}){
 const billing=config.billing||createBillingService(db,config),budget=config.modelBudget||createModelBudget(db,config);initializeToolRunSchema(db);
 const clock=()=>new Date(config.toolNow?.()??Date.now()).toISOString(),transaction=fn=>thesisTransaction(db,fn),controllers=new Map();let stopped=false,busy=false,pending;
 function finish(id,status,message){if(!db.prepare("SELECT 1 FROM tool_runs WHERE id=? AND status IN ('queued','running')").get(id))return;db.prepare('UPDATE tool_runs SET status=?,stage=?,error=?,updated_at=? WHERE id=?').run(status,status,message,clock(),id);db.prepare('UPDATE jobs SET status=?,stage=?,error=?,updated_at=? WHERE id=?').run(status,status,message,clock(),id);billing.release(id);}
 transaction(()=>{for(const row of db.prepare("SELECT id FROM tool_runs WHERE status='running'").all())finish(row.id,'failed','服务重启中断了处理，预占已释放，已完成单元保留；请核对后继续');});
 async function execute(){
  if(stopped||busy)return;const row=db.prepare("SELECT r.* FROM tool_runs r JOIN jobs j ON j.id=r.id WHERE r.status='queued' AND j.status='queued' ORDER BY r.created_at,r.id LIMIT 1").get();if(!row)return;busy=true;const controller=new AbortController();controllers.set(row.id,controller);let runtime={},inputTokens=0,outputTokens=0,known=true,cost=0;
  const running=()=>db.prepare("SELECT 1 FROM tool_runs r JOIN jobs j ON j.id=r.id WHERE r.id=? AND r.status='running' AND j.status='running'").get(row.id);
  const account=output=>{const u=output?.usage;if(validUsage(u?.input)&&validUsage(u?.output)&&u.input+u.output>0){inputTokens+=u.input;outputTokens+=u.output;}else known=false;if(Number.isFinite(output?.costUsd)&&output.costUsd>=0)cost+=output.costUsd;else known=false;db.prepare('UPDATE tool_runs SET input_tokens=?,output_tokens=?,usage_known=?,updated_at=? WHERE id=?').run(inputTokens,outputTokens,known?1:0,clock(),row.id);};
  try{
   const claimed=transaction(()=>{if(db.prepare("SELECT 1 FROM tool_runs WHERE status='running' AND id!=?").get(row.id))return false;if(!db.prepare("UPDATE tool_runs SET status='running',stage='preparing',updated_at=? WHERE id=? AND status='queued'").run(clock(),row.id).changes)return false;db.prepare("UPDATE jobs SET status='running',stage='preparing',attempt=1,updated_at=? WHERE id=? AND status='queued'").run(clock(),row.id);budget.start(row.id,1);return true;});if(!claimed)return;
   assertThesisSettings(await config.getAgentSettings?.());runtime=assertThesisSettings(await config.getAgentSettings?.(row.settings_version));if(runtime.version!==row.settings_version)throw thesisError(503,'原处理配置版本不可用');
   const value={kind:row.kind,operation:row.operation,snapshot:JSON.parse(row.snapshot)},plan=JSON.parse(row.plan),completed=db.prepare('SELECT output FROM tool_checkpoints WHERE run_id=? ORDER BY position').all(row.id).map(c=>JSON.parse(c.output)),limit=Number.isSafeInteger(config.toolMaxTokens)&&config.toolMaxTokens>=1000&&config.toolMaxTokens<=400000?config.toolMaxTokens:200000;
   for(const [position,unit]of plan.entries()){
    if(controller.signal.aborted||!running())return;if(db.prepare('SELECT 1 FROM tool_checkpoints WHERE run_id=? AND unit_id=?').get(row.id,unit.id))continue;
    if(inputTokens+outputTokens>=limit||cost>=runtime.maxCostUsd-.01)throw thesisError(429,'本次处理达到执行预算，已完成部分仍保留，请核对后继续');
    const task=toolRunTask(value,unit,completed);let generated;
    try{generated=await(config.agentTaskRunner||runAgentTask)({settings:{...runtime,maxTotalTokens:limit-inputTokens-outputTokens,maxCostUsd:runtime.maxCostUsd-cost},task,signal:controller.signal,validateToolOutput:candidate=>validateToolCandidate(candidate,value,unit),onStage:stage=>{if(!running())return;const safe=/^[a-z][a-z0-9_-]{0,60}$/i.test(stage)?stage:'processing';db.prepare('UPDATE tool_runs SET stage=?,updated_at=? WHERE id=?').run(safe,clock(),row.id);db.prepare("UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND status='running'").run(safe,clock(),row.id);}});}catch(error){account(error);throw error;}
    account(generated);if(controller.signal.aborted||!running())return;if(!known)throw thesisError(502,'本次处理未返回可核对用量，未标记完成');if(inputTokens+outputTokens>limit||cost>runtime.maxCostUsd)throw thesisError(429,'本次处理超过执行预算，原稿与已完成部分保留');
    const parsed=parseToolOutput(generated,value,unit);transaction(()=>{if(!running())return;const json=JSON.stringify(parsed);toolStorageCheck(db,row.user_id,Buffer.byteLength(json),config);db.prepare('INSERT INTO tool_checkpoints VALUES(?,?,?,?,?)').run(row.id,unit.id,position,json,clock());});completed.push(parsed);
   }
   transaction(()=>{
    if(controller.signal.aborted||!running())return;const output=joinToolOutputs(row.operation,completed),sourceSnapshot=value.snapshot.materials.filter(s=>output.sourceIds.includes(s.id)).map(({id,name})=>({id,name})),body=JSON.stringify({...output,toolJobId:row.id,kind:row.kind,operation:row.operation,sourceSnapshot}),json=JSON.stringify(output),id=randomUUID(),at=clock();toolStorageCheck(db,row.user_id,Buffer.byteLength(body)+Buffer.byteLength(json),config);
    billing.settle(row.id);db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run(id,row.user_id,null,row.id,'tool_run',value.snapshot.title+' · '+toolOperationNames[row.operation],body,at);db.prepare('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),row.user_id,row.id,runtime.engine||'claude-agent-sdk',runtime.model,inputTokens,outputTokens,billing.isBillable(row.id)?1:0,at);
    db.prepare("UPDATE tool_runs SET status='completed',stage='completed',output=?,result_id=?,error=NULL,updated_at=? WHERE id=?").run(json,id,at,row.id);db.prepare("UPDATE jobs SET status='completed',stage='completed',result_id=?,error=NULL,updated_at=? WHERE id=?").run(id,at,row.id);
   });
  }catch(error){
   const code=typeof error.code==='string'&&/^[a-z][a-z0-9_]{0,60}$/.test(error.code)?error.code:'tool_error',message=publicAIError(thesisPublicError(error,runtime),[runtime.model,runtime.engine,runtime.baseURL].filter(v=>typeof v==='string'));
   transaction(()=>{db.prepare('INSERT INTO tool_diagnostics VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET code=excluded.code,metrics=excluded.metrics,created_at=excluded.created_at').run(row.id,code,JSON.stringify({status:error.status||500,inputTokens,outputTokens,usageKnown:known}),clock());finish(row.id,stopped?'failed':controller.signal.aborted?'cancelled':'failed',stopped?'服务停止中断了处理，预占已释放，已完成部分保留':message);});
  }finally{if(stopped)transaction(()=>finish(row.id,'failed','服务停止中断了处理，预占已释放，已完成部分保留'));controllers.delete(row.id);busy=false;}
 }
 function tick(){if(busy||stopped)return Promise.resolve();pending=execute();return pending;}const timer=setInterval(()=>void tick(),Math.max(100,config.toolPollMs||1000));timer.unref();
 return{tick,cancel(id){transaction(()=>finish(id,'cancelled','已停止，预占已释放，已完成单元保留'));controllers.get(id)?.abort();},async stop(){stopped=true;clearInterval(timer);for(const c of controllers.values())c.abort();await pending;}};
}
