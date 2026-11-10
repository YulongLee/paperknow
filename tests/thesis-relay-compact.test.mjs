import test from 'node:test';
import assert from 'node:assert/strict';
import {compactRepeatedThesisReads,compactRejectedThesisCandidates} from '../backend/thesis-relay-compact.mjs';
import {failureDiagnostics} from '../backend/thesis-worker.mjs';
const call=(id,input,name='mcp__paperknow__read_material')=>({role:'assistant',content:[{type:'tool_use',id,name,input}]});
const result=(id,source,text,extra={})=>({role:'user',content:[{type:'tool_result',tool_use_id:id,content:[{type:'text',text:JSON.stringify({id:source,name:'测试文献',text,nextOffset:null})}],...extra}]});
test('only exact duplicate authorized reads are elided, while outline, evidence and tool ids survive',()=>{
 const long='合成原文资料'.repeat(200),input={id:'source1',offset:0,limit:2000};
 const body={outline:[{id:'1',title:'合成提纲'}],messages:[call('a',input),result('a','source1',long),call('b',input),result('b','source1',long),call('c',{...input,offset:1}),result('c','source1',long),call('d',{...input,id:'source2'}),result('d','source2',long),call('e',input),result('e','source1',long,{is_error:true})]};
 const before=structuredClone(body),removed=compactRepeatedThesisReads(body);assert.ok(removed>0);assert.deepEqual(body.outline,before.outline);assert.deepEqual(body.messages[1],before.messages[1]);assert.deepEqual(body.messages[5],before.messages[5]);assert.deepEqual(body.messages[7],before.messages[7]);assert.deepEqual(body.messages[9],before.messages[9]);assert.equal(body.messages[3].content[0].tool_use_id,'b');assert.equal(JSON.parse(body.messages[3].content[0].content[0].text).alreadyRead,true);
});
test('different text and non-read tools are untouched',()=>{const body={messages:[call('a',{id:'x'}),result('a','x','first'.repeat(100)),call('b',{id:'x'}),result('b','x','second'.repeat(100)),call('c',{id:'x'},'other_tool'),result('c','x','first'.repeat(100))]};const copy=structuredClone(body);assert.equal(compactRepeatedThesisReads(body),0);assert.deepEqual(body,copy);});
test('only old explicitly rejected candidates are compacted; latest candidates, evidence and feedback remain intact',()=>{
 const candidate=id=>call(id,{candidate:{text:'候选文本'.repeat(500),source_ids:['s1'],complete:true}},'mcp__paperknow__submit_writing_output');
 const feedback=(id,accepted)=>({role:'user',content:[{type:'tool_result',tool_use_id:id,content:[{type:'text',text:JSON.stringify({accepted,rule:'按资料修订'})}]}]});
 const body={messages:[call('r',{id:'s1'}),result('r','s1','证据'.repeat(800)),candidate('a'),feedback('a',false),candidate('b'),feedback('b',false),candidate('c'),feedback('c',false),candidate('d'),feedback('d',true)]};
 const before=structuredClone(body);assert.ok(compactRejectedThesisCandidates(body)>0);assert.match(body.messages[2].content[0].input.candidate.text,/此前候选/);assert.deepEqual(body.messages[0],before.messages[0]);assert.deepEqual(body.messages[1],before.messages[1]);assert.deepEqual(body.messages[3],before.messages[3]);assert.deepEqual(body.messages[6],before.messages[6]);assert.deepEqual(body.messages[8],before.messages[8]);assert.deepEqual(body.messages[2].content[0].input.candidate.source_ids,['s1']);assert.equal(compactRejectedThesisCandidates(body),0);
});
test('accepted, incomplete or malformed tool feedback never authorizes compacting a candidate',()=>{
 const make=id=>call(id,{candidate:{text:'正文'.repeat(1000)}},'mcp__paperknow__submit_writing_output');const body={messages:[make('a'),{role:'user',content:[{type:'tool_result',tool_use_id:'a',content:[{type:'text',text:'{"accepted":true}'}]}]},make('b'),make('c')]};const before=structuredClone(body);assert.equal(compactRejectedThesisCandidates(body),0);assert.deepEqual(body,before);
});
test('thesis error diagnostic stores fixed category and numeric counters only',()=>{const error={providerDiagnostic:'rate_limit',requestMetrics:{providerRequests:4,requestBodyBytes:300,maxRequestBodyBytes:100,compactedBytes:20,toolCalls:3,private:'hidden'}};assert.deepEqual(failureDiagnostics(error),[{stage:'execution_metrics',metrics:{providerRequests:4,requestBodyBytes:300,maxRequestBodyBytes:100,compactedBytes:20,toolCalls:3},providerDiagnostic:'rate_limit'}]);assert.doesNotMatch(JSON.stringify(failureDiagnostics(error)),/hidden/);assert.deepEqual(failureDiagnostics({providerDiagnostic:'secret',requestMetrics:{...error.requestMetrics,toolCalls:-1}}),[]);});
