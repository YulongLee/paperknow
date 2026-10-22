import test from 'node:test';
import assert from 'node:assert/strict';
import {createRevision} from '../dist/workspace/revision-model.mjs';
import {revisionAiSnapshot} from '../dist/workspace/revision-ai-model.mjs';
import {normalizeToolRequest,toolRunPlan,toolRunTask,parseToolOutput,restoreRevisionCheckpoint} from '../backend/tool-run-model.mjs';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createToolRunService} from '../backend/tool-run-service.mjs';
import {startToolRunWorker} from '../backend/tool-run-worker.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';

const original='本研究通过系统整理现有材料揭示研究主题的发展线索，讨论范围严格限制在实际收集的资料和已经说明的证据边界内。';
function request(){const doc={...createRevision({title:'来源任务契约',text:original,mode:'rewrite'},'comparison-contract','2026-10-22T00:00:00Z'),comparison:{version:1,sources:[{id:'s1',name:'合成其他文章',text:'对照文献提出以下表述。'+original+'其余部分不代表用户的研究结论。'}]}};return{kind:'revision',operation:'rewrite',snapshot:revisionAiSnapshot(doc)};}
const prepared=()=>{const input=request(),value=normalizeToolRequest(input),unit=toolRunPlan(value)[0],source=value.snapshot.materials.find(row=>row.id==='comparison:s1');return{input,value,unit,source};};
const output=({unit,source},trace=[],ids=[source.id])=>({text:JSON.stringify({complete:true,sourceIds:ids,paragraphs:unit.paragraphs.map(row=>({...row,revised:row.original.replace('通过系统整理','借助有序梳理'),action:'revise',reason:'依据对照来源重组表达，保留研究限制。'}))}),trace});

test('source-targeted generation allocates actual comparison material and requires complete reads plus exact source IDs',()=>{
 const f=prepared(),task=toolRunTask(f.value,f.unit);assert.deepEqual(task.materials,[f.source]);assert.deepEqual(task.context.revisionComparison.sourceRanges,[{sourceId:f.source.id,start:0,end:f.source.text.length}]);assert.match(task.instructions,/按实际对照文章/);assert.match(task.instructions,/不得通过删减研究信息/);
 assert.throws(()=>parseToolOutput(output(f,[],[]),f.value,f.unit),/完整读取来源/);
 const partial=[{tool:'read_material',status:'completed',materialId:f.source.id,offset:0,limit:f.source.text.length-1}];assert.throws(()=>parseToolOutput(output(f,partial),f.value,f.unit),/完整读取来源/);
 const full=[{tool:'read_material',status:'completed',materialId:f.source.id,offset:0,limit:f.source.text.length}];assert.throws(()=>parseToolOutput(output(f,full,[]),f.value,f.unit),/指定对照文章编号/);
 const parsed=parseToolOutput(output(f,full),f.value,f.unit);assert.deepEqual(parsed.sourceIds,[f.source.id]);assert.equal(parsed.factsVerified,false);assert.equal(parsed.requiresReview,true);assert.deepEqual(restoreRevisionCheckpoint(parsed,f.value,f.unit,0).sourceIds,[f.source.id]);assert.throws(()=>restoreRevisionCheckpoint({...parsed,sourceIds:[]},f.value,f.unit,0),/指定的对照文章/);
});
test('stale, fabricated, wrong-mode or malformed comparison contexts fail before a quote or model call',()=>{
 for(const transform of [
  input=>{input.snapshot.context.comparison.version=2;},
  input=>{input.snapshot.context.comparison.paragraphs[0].paragraphId='other';},
  input=>{input.snapshot.context.comparison.paragraphs[0].sourceIds=['comparison:absent'];},
  input=>{input.snapshot.materials[0].text='这份对照文章只有不相干的独立表述，完全不包含待处理原文所述的研究内容。';},
  input=>{input.snapshot.context.comparison.extra='untrusted';},
  input=>{input.snapshot.mode='reduce';},
  input=>{input.snapshot.materials.push({id:'comparison:extra',name:'unused',text:original});}
 ]){const input=request();transform(input);assert.throws(()=>normalizeToolRequest(input));}
});
test('each unit receives only the actual source articles matched to its assigned paragraphs',()=>{
 const first='甲'.repeat(2300)+original,second='乙'.repeat(2300)+'另一项合成材料专门用于验证不同单元来源的隔离，当前论述只使用相应的授权材料，不从前一段复制事实。';
 const value=normalizeToolRequest({kind:'revision',operation:'rewrite',snapshot:{title:'按单元来源范围',text:first+'\n\n'+second,mode:'rewrite',materials:[{id:'comparison:a',name:'A',text:first},{id:'comparison:b',name:'B',text:second}],context:{plan:'strong',paragraphIds:['p-a','p-b'],comparison:{version:1,paragraphs:[{paragraphId:'p-a',sourceIds:['comparison:a']},{paragraphId:'p-b',sourceIds:['comparison:b']}]}}}}),units=toolRunPlan(value);
 assert.equal(units.length,2);assert.deepEqual(toolRunTask(value,units[0]).materials.map(source=>source.id),['comparison:a']);assert.deepEqual(toolRunTask(value,units[1]).materials.map(source=>source.id),['comparison:b']);assert.deepEqual(toolRunTask(value,units[0]).context.options.comparison.paragraphs,[{paragraphId:'p-a',sourceIds:['comparison:a']}]);
});
test('legacy expression rewrites preserve their normalized snapshots, privacy and no-evidence completion contract',()=>{
 const value=normalizeToolRequest({kind:'revision',operation:'rewrite',snapshot:{title:'旧改写',text:original,mode:'rewrite',materials:[],context:{plan:'strong'}}}),again=normalizeToolRequest({kind:value.kind,operation:value.operation,snapshot:value.snapshot});assert.equal(again.inputHash,value.inputHash);const unit=toolRunPlan(value)[0],parsed=parseToolOutput({text:JSON.stringify({complete:true,sourceIds:[],paragraphs:unit.paragraphs.map(row=>({...row,revised:row.original.replace('通过系统整理','借助有序梳理'),action:'revise',reason:'改善表达。'}))}),trace:[]},value,unit);assert.deepEqual(parsed.sourceIds,[]);assert.equal(Object.hasOwn(toolRunTask(value,unit).context,'revisionComparison'),false);
});
test('real source-mode quote, job, worker and settlement succeed only after allocated article reads',async t=>{
 for(const reads of [false,true]){
  const db=database(':memory:'),user={id:randomUUID()},at=new Date().toISOString();db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user.id,'Source mode test','user',at);
  const config={toolPollMs:60000,getAgentSettings:()=>({enabled:true,engine:'claude-agent-sdk',baseURL:'https://comparison.invalid',model:'synthetic',apiKey:'not-a-real-key',version:'comparison-test',maxTurns:12,maxOutputTokens:4096,maxCostUsd:.1,timeoutMs:30000}),agentTaskRunner:async({task})=>{
   assert.equal(task.materials.length,1);assert.equal(task.materials[0].id,'comparison:s1');const source=task.materials[0],trace=reads?[{tool:'read_material',status:'completed',materialId:source.id,offset:0,limit:source.text.length}]:[];
   return{...output({unit:task.context.unit,source},trace,reads?[source.id]:[]),usage:{input:10,output:5},costUsd:.001};
  }};
  const billing=createBillingService(db,config);config.billing=billing;billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});const order=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,user.id,'credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,user.id,'credits-200',200,'purchase',at);
  const service=createToolRunService(db,config),worker=startToolRunWorker(db,config);t.after(async()=>{await worker.stop();db.close();});const call=(path,data)=>service.handle({path:'/api/tool-runs'+path,method:'POST',user,readBody:async()=>data}),input=request(),quote=await call('/quote',input),created=await call('/jobs',{...input,consent:true,billingToken:quote.value.token,clientKey:randomUUID()}),id=created.value.item.id;
  await worker.tick();const job=service.get(id,user);assert.equal(job.status,reads?'completed':'failed');assert.equal(job.completedUnits,reads?1:0);assert.equal(billing.balance(user.id).balance,reads?190:200);assert.equal(billing.balance(user.id).held,0);assert.equal(db.prepare('SELECT count(*) n FROM results').get().n,reads?1:0);if(reads)assert.deepEqual(job.output.sourceIds,['comparison:s1']);
 }
});
