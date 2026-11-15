import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeThesisSnapshot,selectThesisEvidence,thesisAgentTask,validateThesisCandidate} from '../backend/thesis-model.mjs';
import {runAgentTask} from '../backend/agent-runtime.mjs';
import {cleanThesisTrace} from '../backend/thesis-worker.mjs';
import {computeThesisRunBudget} from '../backend/thesis-execution-policy.mjs';
import {providerFixture,primeProvider} from './fixtures/agent-provider.mjs';

const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://provider.example.com/anthropic',model:'fixture',apiKey:'synthetic-secret',version:'v1',maxTurns:12,maxOutputTokens:2048,maxCostUsd:.5,timeoutMs:5000};
function sample(count,{long=false}={}){
 const references=Array.from({length:count},(_,i)=>({id:'ref-'+i,title:'合成文献 '+i,authors:'作者',year:'2020',confirmed:true,text:('独立资料 '+i+'。').repeat(long?560:5)}));
 const snapshot=normalizeThesisSnapshot({title:'合成论文',profile:{level:'本科',language:'中文',targetWords:500},requirements:{deliveryVersion:1},materials:[],references,outline:[{id:'c',title:'背景',targetWords:500}]});
 const original='研究说明。'+references.map(row=>'[source:'+row.id+']').join(''),unit={id:'u',chapterId:'c',sectionId:'c',chapterTitle:'背景',title:'背景',targetWords:100,part:1,parts:1,presentation:{},completion:{scope:'full',originalText:original}};return{snapshot,unit,references,original};
}
test('11 and 20 original sources are all retained; 21 are rejected rather than truncated',()=>{
 for(const count of [11,20]){const {snapshot,unit,references}=sample(count),selected=selectThesisEvidence(snapshot,unit),task=thesisAgentTask(snapshot,unit,[]);assert.deepEqual(selected.sources.map(row=>row.id),references.map(row=>row.id));assert.deepEqual(task.materials.map(row=>row.id),references.map(row=>row.id));assert.equal(task.context.revision.protectedCitationSequence.length,count);}
 const {snapshot,unit}=sample(21);assert.throws(()=>thesisAgentTask(snapshot,unit,[]),error=>error.code==='completion_sources_exceeded');
});
test('multi-source budget covers the bounded readable material, and truncation is explicitly recorded',()=>{
 const {snapshot,unit}=sample(20,{long:true}),task=thesisAgentTask(snapshot,unit,[]);assert.equal(task.materials.length,20);assert.ok(task.materials.reduce((n,row)=>n+row.text.length,0)<=80000);assert.ok(task.context.confirmedSources.some(row=>row.readTruncated));assert.ok(task.context.confirmedSources.every(row=>row.readTruncated===(row.readableCharacters<row.totalCharacters)));
 const many=computeThesisRunBudget({snapshot,plan:[unit],settings}),short={...unit,completion:{...unit.completion,originalText:unit.completion.originalText.replace(/\[source:ref-(?:1[0-9])\]/g,'')}};assert.ok(many>computeThesisRunBudget({snapshot,plan:[short],settings}));
});
for(const count of [11,20])test('actual authorized batch tool retains individual source evidence for '+count+' references',async()=>{
 const {snapshot,unit,references,original}=sample(count),task=thesisAgentTask(snapshot,unit,[]),candidate={text:original+'研'.repeat(85),source_ids:references.map(row=>row.id),missing_evidence:[],draft:false,complete:true,figures:[]};let checkedTrace;
 const output=await runAgentTask({settings,task,validateThesisOutput:value=>{checkedTrace=value.trace;return validateThesisCandidate(value,snapshot,unit);},dependencies:{lookup:async()=>[{address:'8.8.8.8',family:4}],httpsRequest:providerFixture().requestImpl,query:({options})=>(async function*(){
  await primeProvider(options);const tools=options.mcpServers.paperknow.instance._registeredTools;assert.ok(tools.read_materials);assert.match(options.systemPrompt,/read_material、read_materials 和 submit_writing_output/);
  const decode=value=>JSON.parse(value.content[0].text),range=row=>({id:row.id,offset:0,limit:4});
  await assert.rejects(()=>tools.read_materials.handler({ranges:[range(references[0]),{id:'other-account',offset:0,limit:1}]}),/未授权/);
  await assert.rejects(()=>tools.read_materials.handler({ranges:[{id:references[0].id,offset:9999,limit:1}]}),/读取范围无效/);
  await assert.rejects(()=>tools.read_materials.handler({ranges:references.map(row=>({id:row.id,offset:0,limit:2000}))}),/超过本次上限/);
  await tools.read_materials.handler({ranges:references.slice(0,-1).map(range)});
  assert.equal(decode(await tools.submit_writing_output.handler({candidate})).accepted,false);
  await tools.read_materials.handler({ranges:[range(references.at(-1))]});assert.equal(decode(await tools.submit_writing_output.handler({candidate})).accepted,true);
  yield{type:'result',subtype:'success',is_error:false,stop_reason:'end_turn',total_cost_usd:.001,modelUsage:{fixture:{inputTokens:10,outputTokens:20}},permission_denials:[]};
 })()}});
 assert.equal(output.submitted,true);assert.deepEqual(checkedTrace.filter(row=>row.tool==='read_material'&&row.status==='completed').map(row=>row.materialId),references.map(row=>row.id));assert.ok(checkedTrace.filter(row=>row.tool==='read_material').every(row=>row.offset===0&&row.limit===4));
});
test('bounded stored trace retains an actual read per source without content or invented coverage',()=>{
 const reads=Array.from({length:20},(_,i)=>({tool:'read_material',status:'completed',materialId:'ref-'+i,offset:i,limit:4,text:'private'})),later=Array.from({length:70},()=>({tool:'submit_writing_output',status:'completed'})),stored=cleanThesisTrace([...reads,...later]);assert.equal(stored.length,50);assert.equal(stored.filter(row=>row.tool==='read_material').length,20);assert.ok(stored.filter(row=>row.tool==='read_material').every(row=>row.limit===4));assert.doesNotMatch(JSON.stringify(stored),/private/);
});
test('supplement review can batch authorized sources with independently recorded exact ranges',async()=>{
 const materials=Array.from({length:10},(_,i)=>({id:'r'+i,name:'资料'+i,text:'已提供的合成来源原文。'}));let readTrace;
 const output=await runAgentTask({settings,task:{skill:'writing-review',instructions:'核对来源',context:{operation:'supplement-check'},materials},validateReviewOutput:value=>{readTrace=value.trace;return{valid:true};},dependencies:{lookup:async()=>[{address:'8.8.8.8',family:4}],httpsRequest:providerFixture().requestImpl,query:({options})=>(async function*(){
  await primeProvider(options);const tools=options.mcpServers.paperknow.instance._registeredTools;assert.ok(tools.read_materials);assert.match(options.systemPrompt,/补充检查也可调用 read_materials/);
  await assert.rejects(()=>tools.read_materials.handler({ranges:[{id:'r0',offset:0,limit:4},{id:'other-account',offset:0,limit:4}]}),/未授权/);
  await tools.read_materials.handler({ranges:materials.map(row=>({id:row.id,offset:0,limit:5}))});await tools.submit_writing_output.handler({candidate:{items:[]}});
  yield{type:'result',subtype:'success',is_error:false,stop_reason:'end_turn',total_cost_usd:.001,modelUsage:{fixture:{inputTokens:10,outputTokens:20}},permission_denials:[]};
 })()}});assert.equal(output.submitted,true);assert.deepEqual(readTrace.filter(row=>row.tool==='read_material').map(row=>[row.materialId,row.offset,row.limit]),materials.map(row=>[row.id,0,5]));assert.doesNotMatch(JSON.stringify(readTrace),/other-account|合成来源原文/);
});
