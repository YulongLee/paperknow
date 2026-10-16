// Run only when explicitly verifying a staging/production model connection.
// This performs paid API calls with synthetic material, never edits configuration.
import {DatabaseSync} from 'node:sqlite';
import {environmentConfig,modelSettings} from '../backend/config.mjs';
import {createAgentSettings} from '../backend/agent-settings.mjs';
import {runAgentTask} from '../backend/agent-runtime.mjs';
const path=process.argv[2];
if(!path){console.error('Usage: node --env-file=<server-env> scripts/probe-agent-runtime.mjs <existing-sqlite-path>');process.exitCode=2;}else{
  let db;
  try{
    db=new DatabaseSync(path,{readOnly:true});
    if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_config_versions'").get())throw new Error('请先由独立 staging 服务初始化 Agent 配置表');
    const config=environmentConfig(),models=modelSettings(db,config);config.getAI=()=>models.get();
    const saved=createAgentSettings(db,config).get();
    const settings={...saved,enabled:true,maxTurns:Math.min(saved.maxTurns,3),timeoutMs:Math.min(saved.timeoutMs,30000),maxOutputTokens:Math.min(saved.maxOutputTokens,256),maxCostUsd:Math.min(saved.maxCostUsd,0.05)};
    const result=await runAgentTask({settings,task:{skill:'thesis-section',instructions:'这是一项基础设施验收，不撰写论文章节。必须先调用 read_material 读取 id=probe-source，再仅返回 SDK_OK。不得读取其他资源。',context:{probe:true},materials:[{id:'probe-source',name:'synthetic-probe.txt',text:'This is synthetic connectivity verification material. Return SDK_OK after reading.'}]}});
    const materialRead=result.trace.some(event=>event.tool==='read_material'&&event.status==='completed'&&event.materialId==='probe-source');
    if(!materialRead||!result.text.includes('SDK_OK'))throw new Error('模型返回但未通过授权材料工具验收');
    console.log(JSON.stringify({ok:true,engine:result.engine,model:result.model,version:saved.version,materialRead,finishReason:result.finishReason,usage:result.usage,costUsd:result.costUsd}));
  }catch(error){console.error(JSON.stringify({ok:false,error:error.status?error.message:'Agent 验收失败，请检查 staging 配置和运行环境',status:error.status||502,usage:error.usage??null,costUsd:error.costUsd??null}));process.exitCode=1;}
  finally{db?.close();}
}
