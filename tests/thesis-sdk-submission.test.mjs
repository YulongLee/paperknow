import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Readable} from 'node:stream';
import {runAgentTask} from '../backend/agent-runtime.mjs';
import {normalizeThesisSnapshot,thesisPlan,thesisAgentTask,validateThesisCandidate,parseThesisSection} from '../backend/thesis-model.mjs';

const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://fixture.example.com/anthropic',model:'fixture-model',apiKey:'synthetic-key',maxTurns:4,timeoutMs:20000,maxOutputTokens:4096,maxCostUsd:.1,maxTotalTokens:200000};
const snapshot=normalizeThesisSnapshot({title:'合成验收论文',profile:{level:'本科',language:'中文',targetWords:500},materials:[],references:[],outline:[{id:'c1',title:'研究背景',targetWords:500}]}),unit=thesisPlan(snapshot)[0];
const candidate={complete:true,draft:true,text:'研'.repeat(470)+'【待核对：来源与实际研究信息】',source_ids:[],missing_evidence:['请核对来源']};
function provider(candidates){const calls=[];return {calls,requestImpl(options,callback){const request=new PassThrough(),parts=[];request.on('data',part=>parts.push(part));request.on('end',()=>{const body=JSON.parse(Buffer.concat(parts));if(options.path.endsWith('/count_tokens')){const response=Readable.from(['{"input_tokens":10}']);response.statusCode=200;response.headers={'content-type':'application/json'};callback(response);return;}
 calls.push(body);if(calls.length>candidates.length){request.destroy(Error('Unexpected provider finish request'));return;}
 const tool={id:'fixture_'+calls.length,name:'mcp__paperknow__submit_writing_output',input:{candidate:candidates[calls.length-1]}},events=[{type:'message_start',message:{id:'provider_'+calls.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'tool_use',id:tool.id,name:tool.name,input:{}}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(tool.input)}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'tool_use',stop_sequence:null},usage:{input_tokens:10,output_tokens:30}},{type:'message_stop'}];
 const response=Readable.from([events.map(value=>'event: '+value.type+'\ndata: '+JSON.stringify(value)+'\n\n').join('')]);response.statusCode=200;response.headers={'content-type':'text/event-stream'};callback(response);
 });return request;}};}

test('a thesis section submits once and uses a local finish without outputting the whole prose twice',async()=>{
 const p=provider([candidate]),output=await runAgentTask({settings,task:thesisAgentTask(snapshot,unit,[]),validateThesisOutput:value=>validateThesisCandidate(value,snapshot,unit),dependencies:{lookup:async()=>[{address:'8.8.8.8',family:4}],httpsRequest:p.requestImpl}});
 assert.equal(p.calls.length,1);assert.equal(output.submitted,true);assert.equal(output.completionSource,'local_control');assert.equal(output.providerRequests,1);assert.equal(parseThesisSection(output,snapshot,unit).draft,true);
 assert.ok(output.skills.some(row=>row.id==='scientific-writing'));assert.ok(output.skills.some(row=>row.id==='citation-management'));
 assert.deepEqual(p.calls[0].tools.map(tool=>tool.name).sort(),['mcp__paperknow__read_material','mcp__paperknow__submit_writing_output']);
 assert.ok(!p.calls.some(body=>JSON.stringify(body).includes('mcp__paperknow__check_text_length')));
});

test('a rejected length candidate is repaired inside the same Agent execution without accepting the bad text',async()=>{
 const p=provider([{...candidate,text:'研'.repeat(1100)+'【待核对：本节资料来源】'},candidate]),feedback=[];
 const output=await runAgentTask({settings,task:thesisAgentTask(snapshot,unit,[]),validateThesisOutput:value=>{const checked=validateThesisCandidate(value,snapshot,unit);feedback.push(checked);return checked;},dependencies:{lookup:async()=>[{address:'8.8.8.8',family:4}],httpsRequest:p.requestImpl}});
 assert.equal(p.calls.length,2);assert.equal(feedback[0].valid,false);assert.equal(feedback[0].feedback.code,'word_limit_exceeded');assert.equal(feedback[1].valid,true);assert.equal(JSON.parse(output.text).text,candidate.text);assert.deepEqual(output.usage,{input:20,output:60});
});

test('structured diagram is accepted in the same writing submission without any image, network or execution tool',async()=>{
 const value=normalizeThesisSnapshot({title:'合成流程图验收',profile:{level:'本科',language:'中文',targetWords:500},requirements:{contentMode:'rich'},materials:[],references:[],outline:[{id:'c1',title:'研究方案',targetWords:500,presentation:{image:true}}]}),section=thesisPlan(value)[0];
 const selected={...candidate,text:candidate.text+'\n[figure:flow]\n',figures:[{id:'flow',title:'拟开展研究步骤',kind:'flowchart',nodes:[{id:'a',label:'提出研究问题'},{id:'b',label:'拟收集证据验证'}],edges:[{from:'a',to:'b'}],caption:'拟开展方案，尚未实施。'}]},p=provider([selected]);
 const output=await runAgentTask({settings,task:thesisAgentTask(value,section,[]),validateThesisOutput:result=>validateThesisCandidate(result,value,section),dependencies:{lookup:async()=>[{address:'8.8.8.8',family:4}],httpsRequest:p.requestImpl}}),parsed=parseThesisSection(output,value,section);
 assert.equal(p.calls.length,1);assert.equal(output.providerRequests,1);assert.equal(parsed.figures.length,1);assert.match(parsed.text,new RegExp(`\\[figure:${parsed.figures[0].id}\\]`));
 assert.deepEqual(p.calls[0].tools.map(tool=>tool.name).sort(),['mcp__paperknow__read_material','mcp__paperknow__submit_writing_output']);assert.equal(output.submitted,true);assert.equal(output.completionSource,'local_control');
});

test('real SDK growing Chinese repair history reports a recoverable preflight window with measured usage',async()=>{
 const p=provider([{...candidate,text:'研'.repeat(20000)+'【待核对：本节来源】'}]);
 await assert.rejects(()=>runAgentTask({settings:{...settings,maxTotalTokens:65000,timeoutMs:10000},task:thesisAgentTask(snapshot,unit,[]),validateThesisOutput:value=>validateThesisCandidate(value,snapshot,unit),dependencies:{lookup:async()=>[{address:'8.8.8.8',family:4}],httpsRequest:p.requestImpl}}),error=>{
  assert.equal(error.code,'budget_exceeded',JSON.stringify({message:error.message,status:error.status,calls:p.calls.length,firstBytes:p.calls[0]?Buffer.byteLength(JSON.stringify(p.calls[0])):0}));assert.deepEqual(error.usage,{input:10,output:30});assert.equal(error.executionBudget?.reason,'request_reservation');assert.equal(error.executionBudget?.usedTokens,40);assert.ok(error.executionBudget?.requestTokens>65000);return true;
 });assert.equal(p.calls.length,1,'Full second request is refused locally, before another provider call');
});
