import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {materialTool} from '../backend/agent-tools.mjs';
import {runAgent,codexOptions} from '../backend/agent.mjs';
const ai={aiURL:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',aiKey:'test-secret',aiModel:'test-model'};
test('agent tools expose only authorized snapshot materials with bounded reads',()=>{
 const snapshot={materials:[{id:'allowed',name:'资料',text:'第一段\n\n第二段'}]};
 assert.equal(materialTool(snapshot,'list_materials').materials.length,1);
 assert.equal(materialTool(snapshot,'read_material',{materialId:'allowed',offset:0,limit:3}).text,'第一段');
 assert.equal(materialTool(snapshot,'text_statistics',{materialId:'allowed'}).paragraphs,2);
 assert.throws(()=>materialTool(snapshot,'read_material',{materialId:'foreign'}),/授权范围/);
 assert.throws(()=>materialTool(snapshot,'read_material',{materialId:'allowed',limit:9000}),/读取范围/);
 assert.throws(()=>materialTool(snapshot,'execute_shell',{materialId:'allowed'}),/允许列表/);
});
test('Codex config isolates personal settings and disables shell and outside search',()=>{
 const config=codexOptions(ai,'/test/task','/test/task/materials.json');
 assert.equal(config.env.PK_AI_KEY,undefined);assert.equal(config.env.CODEX_HOME,'/test/task/codex-home');
 assert.equal(config.config.features.shell_tool,false);assert.equal(config.config.features.unified_exec,false);assert.equal(config.config.web_search,'disabled');
 assert.equal(config.config.model_providers.paperknow_bailian.base_url,'https://dashscope.aliyuncs.com/compatible-mode/v1');
 assert.deepEqual(config.config.mcp_servers.paperknow.enabled_tools,['list_materials','read_material','text_statistics']);
});
test('agent persists final answer and tool trace while cleaning its private workspace',async()=>{
 let directory,signal;class FakeCodex{constructor(options){directory=options.env.CODEX_HOME.replace(/\/codex-home$/,'');}startThread(options){assert.equal(options.model,'test-model');assert.equal(options.sandboxMode,'read-only');return {async runStreamed(input,options){signal=options.signal;return {events:(async function*(){yield {type:'item.completed',item:{type:'mcp_tool_call',server:'paperknow',tool:'read_material',status:'completed',arguments:{materialId:'allowed'},result:{secret:'not stored'}}};yield {type:'item.completed',item:{type:'agent_message',text:'这是任务结果。'}};yield {type:'turn.completed',usage:{input_tokens:100,output_tokens:10}};})()};}};}}
 const result=await runAgent({ai,input:{text:'检查资料'},materials:[{id:'allowed',name:'资料',text:'内容'}],signal:new AbortController().signal,CodexClass:FakeCodex});
 assert.equal(result.body.suggestion,'这是任务结果。');assert.equal(result.body.engine,'codex_sdk');assert.equal(result.usage.input,100);assert.equal(JSON.stringify(result.body.trace).includes('secret'),false);assert.equal(signal.aborted,false);await assert.rejects(access(directory));
});
test('agent failure and unexpected system tools never become completed results',async()=>{
 for(const item of [{type:'command_execution'},{type:'file_change'}]){
  class FakeCodex{startThread(){return {async runStreamed(){return {events:(async function*(){yield {type:'item.completed',item};yield {type:'turn.completed'};})()};}};}}
  await assert.rejects(runAgent({ai,input:{text:'测试'},materials:[],signal:new AbortController().signal,CodexClass:FakeCodex}),/系统能力/);
 }
 class FailedCodex{startThread(){return {async runStreamed(){return {events:(async function*(){yield {type:'turn.failed',error:{message:'test-secret'}};})()};}};}}
 await assert.rejects(runAgent({ai,input:{text:'测试'},materials:[],signal:new AbortController().signal,CodexClass:FailedCodex}),e=>!e.message.includes('test-secret'));
});
