import test from 'node:test';
import assert from 'node:assert/strict';
import {researchWordCount,normalizeTextLengthBudget,checkTextLength} from '../backend/text-length.mjs';
import {thesisWordCount,normalizeThesisSnapshot,thesisPlan,thesisAgentTask,parseThesisSection} from '../backend/thesis-model.mjs';
import {runAgentTask} from '../backend/agent-runtime.mjs';

const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://provider.example.com/anthropic',model:'length-tool-fixture',apiKey:'test-only-length-tool-secret',version:'v-length',maxTurns:6,maxOutputTokens:256,maxCostUsd:.1,timeoutMs:5000};
const lookup=async()=>[{address:'8.8.8.8',family:4}];
const success={type:'result',subtype:'success',is_error:false,stop_reason:'end_turn',total_cost_usd:.001,modelUsage:{fixture:{inputTokens:10,outputTokens:10}},permission_denials:[]};
function fixture(){
 const snapshot=normalizeThesisSnapshot({title:'有限资料下的研究边界',profile:{language:'中文',targetWords:500},materials:[{id:'source-1',name:'本人确认的案例资料',text:'这是用户提供的研究记录；仅用于案例讨论，不声称已经验证效果。',confirmed:true}],references:[],outline:[{id:'c1',title:'研究边界',targetWords:60},{id:'c2',title:'分析与计划',targetWords:440}]}),unit=thesisPlan(snapshot)[0];
 return {snapshot,unit,task:thesisAgentTask(snapshot,unit,[])};
}
const body=text=>JSON.stringify({text,source_ids:['source-1'],missing_evidence:[],complete:true});

test('pure length statistics share parser counting, exclude source IDs, and expose no input text',()=>{
 assert.equal(researchWordCount('研 究\n😊，A[source:private-id]'),5);
 assert.equal(researchWordCount("A well-known author's result 42[source:secret-name]",'English'),5);
 for(const language of ['中文','English'])for(const count of [40,60,80]){
  const text=(language==='English'?'research '.repeat(count):'研'.repeat(count))+'[source:private-id]'.repeat(10),budget={target:60,min:40,max:80,language},frozen=structuredClone(budget),result=checkTextLength(text,budget);
  assert.equal(result.count,count);assert.equal(result.withinRange,true);assert.equal(result.delta,60-count);assert.equal(thesisWordCount(text,language),result.count);assert.deepEqual(budget,frozen);assert.doesNotMatch(JSON.stringify(result),/private-id|research|研/);
 }
 assert.equal(checkTextLength('研'.repeat(39),{target:60,min:40,max:80}).withinRange,false);assert.equal(checkTextLength('研'.repeat(81),{target:60,min:40,max:80}).withinRange,false);
});

test('pure checks reject malformed or oversized inputs instead of changing range or truncating text',()=>{
 for(const invalid of [null,{},[],{target:60,min:80,max:100},{target:60,min:0,max:50},{target:'60',min:40,max:80},{target:60,min:-1,max:80},{target:60,min:0,max:100001},{target:NaN,min:0,max:80}])assert.throws(()=>normalizeTextLengthBudget(invalid),/篇幅范围/);
 const budget={target:60,min:40,max:80};for(const text of [null,{},'研'.repeat(60001)])assert.throws(()=>checkTextLength(text,budget),/最多 60,000/);
 assert.equal(checkTextLength('研'.repeat(60000),budget).count,60000);assert.equal(checkTextLength('',budget).count,0);
});

test('every in-range candidate finalizes immediately even when it differs from the exact target',()=>{
 const budget={target:60,min:40,max:80};
 for(const count of [40,41,59,60,61,79,80]){const result=checkTextLength('研'.repeat(count),budget);assert.equal(result.nextAction,'finalize');assert.equal(result.withinRange,true);assert.equal(result.delta,60-count);}
 for(const count of [0,39,81,265]){const result=checkTextLength('研'.repeat(count),budget);assert.equal(result.nextAction,'revise');assert.equal(result.withinRange,false);}
 const {task}=fixture();assert.match(task.instructions,/停止规则优先于贴近目标的偏好/);assert.match(task.instructions,/立即将本次已检查的原文逐字作为最终 JSON 的 text 返回/);assert.match(task.instructions,/禁止再修改文字、再次检查或调用其他工具/);assert.match(task.instructions,/即使 delta 不为 0，只要范围内就是合格篇幅/);assert.match(task.instructions,/一次修订应靠近 min～max 的内部而非边界/);assert.match(task.instructions,/不要逐个删除或增加 1～2 个字/);
});

test('Agent can check and revise prose inside one run, with immutable server range and unchanged execution budgets',async()=>{
 const {snapshot,unit,task}=fixture();let invocations=0,optionsSeen;
 const output=await runAgentTask({settings,task,dependencies:{lookup,query:({options})=>{invocations++;optionsSeen=options;return(async function*(){
  const tools=options.mcpServers.paperknow.instance._registeredTools;assert.deepEqual(Object.keys(tools).sort(),['check_text_length','read_material']);assert.equal((await options.canUseTool('mcp__paperknow__list_materials',{})).behavior,'deny');assert.equal((await options.canUseTool('mcp__paperknow__load_skill',{})).behavior,'deny');
  assert.equal((await options.canUseTool('mcp__paperknow__check_text_length',{})).behavior,'allow');assert.equal((await options.canUseTool('mcp__foreign__check_text_length',{})).behavior,'deny');assert.equal((await options.canUseTool('Bash',{})).behavior,'deny');
  await tools.read_material.handler({id:'source-1'});
  const first=JSON.parse((await tools.check_text_length.handler({text:'研'.repeat(265)+'[source:source-1]',target:265,min:0,max:1000,language:'English'})).content[0].text);
  assert.deepEqual(first,{count:265,target:60,min:40,max:80,withinRange:false,delta:-205,nextAction:'revise'});
  const revised='研'.repeat(60)+'[source:source-1]',second=JSON.parse((await tools.check_text_length.handler({text:revised})).content[0].text);assert.equal(second.withinRange,true);
  yield {...success,result:body(revised)};
 })();}}});
 assert.equal(invocations,1);assert.equal(optionsSeen.maxTurns,settings.maxTurns);assert.equal(optionsSeen.maxBudgetUsd,settings.maxCostUsd);assert.equal(optionsSeen.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,String(settings.maxOutputTokens));assert.equal(optionsSeen.persistSession,false);assert.deepEqual(optionsSeen.tools,[]);
 assert.equal(parseThesisSection(output,snapshot,unit).wordCount,60);assert.deepEqual(output.trace.map(row=>row.tool),['read_material','check_text_length','check_text_length']);assert.doesNotMatch(JSON.stringify(output.trace),/研/);assert.deepEqual(output.trace[1].length,{count:265,target:60,min:40,max:80,withinRange:false,delta:-205,nextAction:'revise'});
});

test('a checked candidate cannot authorize a different overlong final answer',async()=>{
 const {snapshot,unit,task}=fixture(),output=await runAgentTask({settings,task,dependencies:{lookup,query:({options})=>(async function*(){const tools=options.mcpServers.paperknow.instance._registeredTools;await tools.read_material.handler({id:'source-1'});assert.equal(JSON.parse((await tools.check_text_length.handler({text:'研'.repeat(60)})).content[0].text).withinRange,true);yield {...success,result:body('研'.repeat(265)+'[source:source-1]')};})()}});
 assert.throws(()=>parseThesisSection(output,snapshot,unit),error=>error.code==='word_limit_exceeded');
});

test('the optional pure tool does not grant new tools to tasks without a trusted range or remove the existing call cap',async()=>{
 const {task}=fixture(),without={...task,context:{title:task.context.title}};
 await runAgentTask({settings,task:without,dependencies:{lookup,query:({options})=>(async function*(){assert.equal(options.mcpServers.paperknow.instance._registeredTools.check_text_length,undefined);assert.equal((await options.canUseTool('mcp__paperknow__check_text_length',{})).behavior,'deny');yield {...success,result:'unchanged generic task'};})()}});
 const result=await runAgentTask({settings,task,dependencies:{lookup,query:({options})=>(async function*(){const handler=options.mcpServers.paperknow.instance._registeredTools.check_text_length.handler;for(let i=0;i<20;i++)await handler({text:'研'.repeat(60)});await assert.rejects(()=>handler({text:'研'.repeat(60)}),/工具调用次数已达上限/);yield {...success,result:'bounded test result'};})()}});assert.equal(result.trace.length,20);
 await assert.rejects(()=>runAgentTask({settings,task:{...task,context:{...task.context,lengthBudget:{target:60,min:70,max:80}}},dependencies:{lookup,query:()=>{throw Error('must not dispatch');}}}),/正文篇幅范围无效/);
});

test('turn-limit failures expose a private safe tool trace without content, source IDs or model credentials',async()=>{
 const {task}=fixture();let failure;
 try{await runAgentTask({settings,task,dependencies:{lookup,query:({options})=>(async function*(){
  const tools=options.mcpServers.paperknow.instance._registeredTools;await tools.read_material.handler({id:'source-1'});await tools.check_text_length.handler({text:'研'.repeat(90)+'[source:source-1]'});await tools.check_text_length.handler({text:'研'.repeat(80)});
  yield {...success,subtype:'error_max_turns',result:'private generated content must never enter the failure trace'};
 })()}});}catch(error){failure=error;}
 assert.match(failure.message,/回合上限/);assert.deepEqual(failure.agentTrace,[{tool:'read_material',status:'completed'},{tool:'check_text_length',status:'completed',length:{count:90,target:60,min:40,max:80,withinRange:false,delta:-30,nextAction:'revise'}},{tool:'check_text_length',status:'completed',length:{count:80,target:60,min:40,max:80,withinRange:true,delta:-20,nextAction:'finalize'}}]);
 assert.doesNotMatch(JSON.stringify(failure.agentTrace),/研|source-1|private generated|length-tool-fixture|test-only-length-tool-secret|apiKey|model/);assert.equal(Object.keys(failure).includes('agentTrace'),false);assert.equal(JSON.stringify(failure).includes('agentTrace'),false);
 assert.deepEqual(failure.usage,{input:10,output:10});
});
