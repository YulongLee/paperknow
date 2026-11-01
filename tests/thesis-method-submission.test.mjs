import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {runAgentTask} from '../backend/agent-runtime.mjs';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {createWritingService} from '../backend/writing-service.mjs';
import {startWritingWorker} from '../backend/writing-worker.mjs';
import {normalizeThesisMethodSnapshot,thesisMethodTask,parseThesisMethod,validateThesisMethodCandidate,methodValidationFeedback} from '../backend/thesis-method-model.mjs';

const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://fixture.example.com/anthropic',model:'fixture-model',apiKey:'synthetic-key',maxTurns:4,timeoutMs:20000,maxOutputTokens:4096,maxCostUsd:.1,maxTotalTokens:60000};
const snapshot=normalizeThesisMethodSnapshot({title:'合成图书馆服务方案比较研究',profile:{level:'本科',language:'中文',targetWords:8000},materials:[],references:[]});
const proposal=()=>({complete:true,proposed:true,methods:[{name:'拟采用比较分析法',rationale:'拟依据可获得的公开服务资料比较方案。',steps:['拟确定服务比较维度。','拟收集资料并逐项核对。'],prerequisites:['需确认资料能够取得并可引用。'],limitations:['结论范围需结合实际资料核对。']}],missingInformation:[],source_ids:[]});
function provider(responses){
 const calls=[];
 return {calls,requestImpl(options,callback){
  const request=new PassThrough(),parts=[];request.on('data',part=>parts.push(part));request.on('end',()=>{
   const body=JSON.parse(Buffer.concat(parts));
   if(options.path.endsWith('/count_tokens')){const response=Readable.from(['{"input_tokens":10}']);response.statusCode=200;response.headers={'content-type':'application/json'};callback(response);return;}
   calls.push(body);const selected=responses[calls.length-1];
   if(!selected){request.destroy(Error('Unexpected paid request'));return;}
   const tool=selected.tool||'submit_writing_output',text=Object.hasOwn(selected,'text'),input=selected.input||{candidate:selected.candidate};
   const events=[{type:'message_start',message:{id:'method_'+calls.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}},
    {type:'content_block_start',index:0,content_block:text?{type:'text',text:''}:{type:'tool_use',id:'tool_method_'+calls.length,name:'mcp__paperknow__'+tool,input:{}}},
    {type:'content_block_delta',index:0,delta:text?{type:'text_delta',text:selected.text}:{type:'input_json_delta',partial_json:JSON.stringify(input)}},
    {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:text?'end_turn':'tool_use',stop_sequence:null},usage:{input_tokens:10,output_tokens:30}},{type:'message_stop'}];
   const response=Readable.from([events.map(value=>'event: '+value.type+'\ndata: '+JSON.stringify(value)+'\n\n').join('')]);response.statusCode=200;response.headers={'content-type':'text/event-stream'};callback(response);
  });return request;
 }};
}
const dependencies=p=>({lookup:async()=>[{address:'8.8.8.8',family:4}],httpsRequest:p.requestImpl});

test('method suggestions use the real SDK full-object submission and finish locally without duplicate prose',async()=>{
 const body=proposal(),p=provider([{candidate:body}]),stages=[];
 const output=await runAgentTask({settings,task:thesisMethodTask(snapshot),validateMethodOutput:value=>validateThesisMethodCandidate(value,snapshot),onStage:stage=>stages.push(stage),dependencies:dependencies(p)});
 assert.equal(p.calls.length,1);assert.equal(output.submitted,true);assert.equal(output.completionSource,'local_control');assert.deepEqual(output.usage,{input:10,output:30});
 assert.equal(parseThesisMethod(output,snapshot).methods[0].name,body.methods[0].name);
 assert.deepEqual(p.calls[0].tools.map(tool=>tool.name).sort(),['mcp__paperknow__read_material','mcp__paperknow__submit_writing_output']);
 assert.deepEqual(p.calls[0].tool_choice,{type:'any'});assert.ok(stages.includes('checking_method'));assert.equal(stages.at(-1),'method_ready');
});

test('an incomplete method proposal is repaired in the same execution with specific validation feedback',async()=>{
 const bad=proposal();delete bad.methods[0].limitations;
 const p=provider([{candidate:bad},{candidate:proposal()}]),checked=[],stages=[];
 const output=await runAgentTask({settings,task:thesisMethodTask(snapshot),validateMethodOutput:value=>{const feedback=validateThesisMethodCandidate(value,snapshot);checked.push(feedback);return feedback;},onStage:stage=>stages.push(stage),dependencies:dependencies(p)});
 assert.equal(p.calls.length,2);assert.equal(checked[0].valid,false);assert.equal(checked[0].feedback.field,'methods[0].limitations');assert.equal(checked[0].feedback.reason,'missing_list');assert.equal(checked[1].valid,true);
 assert.match(JSON.stringify(p.calls[1].messages),/methods\[0\]\.limitations/);assert.ok(stages.includes('repairing_method'));assert.equal(stages.at(-1),'method_ready');
 assert.deepEqual(output.usage,{input:20,output:60});assert.deepEqual(parseThesisMethod(output,snapshot).methods[0].limitations,proposal().methods[0].limitations);
});

test('method source repair requires a real authorized read and retains it through the next submission',async()=>{
 const value=normalizeThesisMethodSnapshot({...snapshot,materials:[{id:'fixture-source',name:'合成资料',text:'公开服务方案合成测试材料。',confirmed:true}]}),body={...proposal(),source_ids:['fixture-source']};
 const p=provider([{candidate:body},{tool:'read_material',input:{id:'fixture-source'}},{candidate:body}]),checked=[];
 const output=await runAgentTask({settings,task:thesisMethodTask(value),validateMethodOutput:candidate=>{const result=validateThesisMethodCandidate(candidate,value);checked.push(result);return result;},dependencies:dependencies(p)});
 assert.equal(checked[0].feedback.reason,'unverified_source');assert.equal(checked[1].valid,true);assert.equal(p.calls.length,3);
 assert.deepEqual(parseThesisMethod(output,value).sourceIds,['fixture-source']);assert.deepEqual(output.usage,{input:30,output:90});
});

test('a plain SDK final response cannot bypass method validation even if it contains otherwise valid JSON',async()=>{
 for(const text of ['Here is the proposal: '+JSON.stringify(proposal()),JSON.stringify(proposal())]){
  const p=provider([{text}]);
  await assert.rejects(()=>runAgentTask({settings,task:thesisMethodTask(snapshot),validateMethodOutput:value=>validateThesisMethodCandidate(value,snapshot),dependencies:dependencies(p)}),error=>error.code==='method_validation_failed'&&error.usage.input===10&&error.usage.output===30);
  assert.equal(p.calls.length,1);
 }
});

test('method automatic correction obeys the pinned turn limit and never accepts an incomplete last candidate',async()=>{
 const bad={...proposal(),methods:[]},p=provider(Array.from({length:3},()=>({candidate:bad})));
 await assert.rejects(()=>runAgentTask({settings:{...settings,maxTurns:3},task:thesisMethodTask(snapshot),validateMethodOutput:value=>validateThesisMethodCandidate(value,snapshot),dependencies:dependencies(p)}),error=>error.code==='turn_limit'&&error.usage.input===30&&error.usage.output===90);
 assert.equal(p.calls.length,3);
});

test('method feedback is safe, strict and does not invent absent values',()=>{
 const bad=proposal();bad.methods[0].steps=['PRIVATE_RESEARCH_CONTENT'];
 const result=validateThesisMethodCandidate({text:JSON.stringify(bad)},snapshot);
 assert.equal(result.valid,false);assert.equal(result.feedback.field,'methods[0].steps');assert.equal(result.feedback.reason,'list_size');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_RESEARCH_CONTENT/);assert.equal(bad.methods[0].steps.length,1);
 assert.equal(validateThesisMethodCandidate({text:'broken JSON'},snapshot).feedback.reason,'invalid_json');
 const failure=new Error('unexpected');assert.throws(()=>methodValidationFeedback(failure),error=>error===failure);
});

test('context flags cannot grant method submission permissions without the server validator',async()=>{
 const body=proposal(),p=provider([{text:JSON.stringify(body)}]),task=thesisMethodTask(snapshot);
 task.context.validateMethodOutput=true;task.context.methodSubmission=true;
 const output=await runAgentTask({settings,task,dependencies:dependencies(p)});
 assert.equal(output.submitted,undefined);assert.ok(!p.calls[0].tools.some(tool=>tool.name==='mcp__paperknow__submit_writing_output'));
});

test('other writing scenarios share method correction through the actual worker and settle a single user fee',async t=>{
 const db=database(':memory:'),user={id:'method-reader'},at=new Date().toISOString();
 db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user.id,'合成方法测试','user',at);
 const bad=proposal();delete bad.methods[0].prerequisites;const p=provider([{candidate:bad},{candidate:proposal()}]),runtime={...settings,version:'method-submission-test'};
 const config={getAgentSettings:()=>({...runtime}),writingPollMs:60000,agentTaskRunner:args=>runAgentTask({...args,dependencies:dependencies(p)})};
 const billing=createBillingService(db,config);config.billing=billing;
 billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});
 const order=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,user.id,'credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,user.id,'credits-200',200,'purchase',at);
 const service=createWritingService(db,config),worker=startWritingWorker(db,config);t.after(async()=>{await worker.stop();db.close();});
 const request=(path,data)=>service.handle({path:'/api/writing'+path,method:'POST',user,readBody:async()=>data}),input={kind:'proposal',operation:'method',snapshot};
 const quote=await request('/quote',input);assert.equal(quote.status,200);
 const queued=await request('/jobs',{...input,clientKey:randomUUID(),billingToken:quote.value.token,consent:true});assert.equal(queued.status,202);
 await worker.tick();const item=service.get(queued.value.item.id,user);
 assert.equal(item.status,'completed',JSON.stringify(item));assert.equal(item.output.proposed,true);assert.equal(p.calls.length,2);
 assert.equal(billing.balance(user.id).balance,190);assert.equal(billing.balance(user.id).held,0);
 assert.equal(db.prepare('SELECT count(*) n FROM billing_reservations WHERE job_id=?').get(item.id).n,1);assert.equal(db.prepare('SELECT count(*) n FROM usage WHERE job_id=?').get(item.id).n,1);
});
