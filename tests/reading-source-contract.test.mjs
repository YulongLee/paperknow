import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {createToolRunService} from '../backend/tool-run-service.mjs';
import {startToolRunWorker} from '../backend/tool-run-worker.mjs';
import {normalizeToolRequest,toolRunPlan,parseToolOutput,joinToolOutputs,restoreReadingCheckpoint} from '../backend/tool-run-model.mjs';
const request=(materials,operation='answer')=>({kind:'literature',operation,snapshot:{title:'Synthetic reading scope',materials,question:'Which source contains the answer?'}});
const body=(quote,extra={})=>({complete:true,text:'Answer supported by the selected source.',sourceIds:['paper'],citations:[{sourceId:'paper',quote}],answered:true,...extra});
const output=(candidate,trace)=>({text:JSON.stringify(candidate),trace});
const read=(materialId,offset,limit)=>({tool:'read_material',status:'completed',materialId,offset,limit});

test('a real read outside the assigned unit does not authorize its quote',()=>{
 const quote='First range citation.',value=normalizeToolRequest(request([{id:'paper',name:'Source',text:quote+'x'.repeat(6100)}])),unit=toolRunPlan(value)[1];assert.equal(unit.ranges[0].start,5000);
 assert.throws(()=>parseToolOutput(output(body(quote),[read('paper',0,8000)]),value,unit),/本单元分配.*读取的范围/);
});
test('repeated quote resolves to its assigned occurrence and ignores model offsets',()=>{
 const quote='Repeated exact citation.',text=quote+'x'.repeat(5000-quote.length)+quote+'z'.repeat(1100),value=normalizeToolRequest(request([{id:'paper',name:'Source',text}])),unit=toolRunPlan(value)[1];
 const result=parseToolOutput(output(body(quote,{citations:[{sourceId:'paper',quote,start:0,end:1}]}),[read('paper',0,8000)]),value,unit);
 assert.deepEqual(result.citations,[{sourceId:'paper',quote,start:5000,end:5000+quote.length}]);assert.deepEqual(result.sourceRanges,unit.ranges);
});
test('adjacent real reads and adjacent assigned spans preserve a continuous quote',()=>{
 const text='abcdefghijklmno',value=normalizeToolRequest(request([{id:'paper',name:'Source',text}])),unit={id:'unit-0',ranges:[{sourceId:'paper',start:0,end:7},{sourceId:'paper',start:7,end:15}]};
 const parsed=parseToolOutput(output(body('defghijk'),[read('paper',0,7),read('paper',7,8)]),value,unit);assert.deepEqual(parsed.citations[0],{sourceId:'paper',quote:'defghijk',start:3,end:11});
 assert.throws(()=>parseToolOutput(output(body('defghijk'),[read('paper',0,6),read('paper',7,8)]),value,unit),/尚未完整读取/);
});
test('an authorized but unassigned source cannot enter a unit source list',()=>{
 const value=normalizeToolRequest(request([{id:'paper',name:'Source',text:'First source quote.'},{id:'other',name:'Other',text:'Other source quote.'}])),unit={id:'unit-0',ranges:[{sourceId:'paper',start:0,end:19}]};
 assert.throws(()=>parseToolOutput(output(body('Other source quote.',{sourceIds:['other'],citations:[{sourceId:'other',quote:'Other source quote.'}]}),[read('paper',0,19),read('other',0,19)]),value,unit),/超出本单元/);
});
test('answer aggregation preserves original range numbers and only displayed evidence',()=>{
 const plan=[{id:'unit-0',ranges:[{sourceId:'first',start:0,end:20}]},{id:'unit-1',ranges:[{sourceId:'second',start:0,end:20}]}],first={text:'No answer here.',sourceIds:['first'],citations:[{sourceId:'first',quote:'First source quote.'}],answered:false},second={text:'The answer is here.',sourceIds:['second'],citations:[{sourceId:'second',quote:'Second source quote.'}],answered:true},joined=joinToolOutputs('answer',[first,second],plan);
 assert.match(joined.text,/原文范围 2/);assert.doesNotMatch(joined.text,/原文范围 1|No answer/);assert.deepEqual(joined.sourceIds,['second']);assert.deepEqual(joined.citations,second.citations);assert.equal(joined.answered,true);assert.deepEqual(joined.sourceRanges,plan[1].ranges);
 assert.deepEqual(joined.answerRanges.map(r=>({rangeNumber:r.rangeNumber,answered:r.answered,included:r.included})),[{rangeNumber:1,answered:false,included:false},{rangeNumber:2,answered:true,included:true}]);
});
test('not-found and old unknown answer states remain explicit without invented inference',()=>{
 const row={text:'Original checked.',sourceIds:['paper'],citations:[{sourceId:'paper',quote:'Original checked.'}]};assert.equal(joinToolOutputs('answer',[row]).answered,null);assert.equal(joinToolOutputs('answer',[{...row,answered:false},{...row,answered:false}]).answered,false);
 const value=normalizeToolRequest(request([{id:'paper',name:'Source',text:'Original checked.'}])),unit=toolRunPlan(value)[0],parsed=parseToolOutput(output(body('Original checked.',{answered:undefined}),[read('paper',0,17)]),value,unit);assert.equal(parsed.answered,null);assert.throws(()=>parseToolOutput(output(body('Original checked.',{answered:'false'}),[read('paper',0,17)]),value,unit),/布尔值/);
});
for(const operation of ['read','answer'])test(operation+' rejects every impossible short unit before quote admission',()=>{
 for(const text of ['a','ab','abc','abcd'])assert.throws(()=>normalizeToolRequest(request([{id:'paper',name:'Source',text}],operation)),/至少 5 字符/);
 assert.throws(()=>normalizeToolRequest(request([{id:'one',name:'One',text:'abc'},{id:'two',name:'Two',text:'def'}],operation)),/至少 5 字符/);
 assert.throws(()=>normalizeToolRequest(request([{id:'long',name:'Long',text:'x'.repeat(6000)},{id:'tail',name:'Tail',text:'abc'}],operation)),/第 2 个原文范围/);
 assert.equal(toolRunPlan(normalizeToolRequest(request([{id:'paper',name:'Source',text:'abcde'}],operation))).length,1);
});
test('stored checkpoints revalidate scope and recover safe metadata without fabricated read traces',()=>{
 const quote='First range citation.',text=quote+'x'.repeat(5000-quote.length)+'Second range citation.'+'z'.repeat(1100),value=normalizeToolRequest(request([{id:'paper',name:'Source',text}])),unit=toolRunPlan(value)[1];
 assert.throws(()=>restoreReadingCheckpoint({text:'Old answer.',sourceIds:['paper'],citations:[{sourceId:'paper',quote}]},value,unit,1),/超出原分配范围/);
 const restored=restoreReadingCheckpoint({text:'Old answer.',sourceIds:['paper'],citations:[{sourceId:'paper',quote:'Second range citation.'}]},value,unit,1);assert.equal(restored.unitPosition,1);assert.equal(restored.answered,null);assert.equal(restored.citations[0].start,5000);assert.equal(Object.hasOwn(restored,'trace'),false);
});

const runtime={enabled:true,engine:'claude-agent-sdk',baseURL:'https://controlled-reading.example',model:'controlled-reading-model',apiKey:'not-a-real-provider-key',version:'controlled-reading-v1',maxTurns:6,maxOutputTokens:4096,maxCostUsd:.1,timeoutMs:30000};
function fixture(t,{failSecond=false,longSource=false}={}){
 const db=database(':memory:'),user={id:'alice'},at=new Date().toISOString(),calls=[];db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user.id,'Synthetic reader','user',at);let fail=failSecond;
 const config={getAgentSettings:()=>structuredClone(runtime),toolPollMs:60000,agentTaskRunner:async({task,validateToolOutput})=>{const range=task.context.unit.ranges[0],second=range.sourceId==='second'||range.start>0;calls.push(range.sourceId);if(second&&fail)throw Object.assign(Error('Synthetic interruption'),{usage:{input:10,output:2},costUsd:.001});const source=task.materials.find(s=>s.id===range.sourceId),quote=source.text.slice(range.start,range.start+25),result={text:JSON.stringify({complete:true,text:second?'Answer in the second range.':'No answer in the first range.',answered:second,sourceIds:[source.id],citations:[{sourceId:source.id,quote}]}),trace:[read(source.id,range.start,range.end-range.start)],usage:{input:100,output:200},costUsd:.001};assert.equal(validateToolOutput(result).valid,true);return result;}};
 const billing=createBillingService(db,config);config.billing=billing;billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});const order=randomUUID();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,user.id,'credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,user.id,'credits-200',200,'purchase',at);
 const service=createToolRunService(db,config),worker=startToolRunWorker(db,config),value=request(longSource?[{id:'paper',name:'Long source',text:'First source quotation. '.padEnd(5000,'x')+'Second source quotation. '+'b'.repeat(1100)}]:[{id:'first',name:'First',text:'First source quotation. '+'a'.repeat(4900)},{id:'second',name:'Second',text:'Second source quotation. '+'b'.repeat(4900)}]);
 const call=(path,data)=>service.handle({path:'/api/tool-runs'+path,method:data===undefined?'GET':'POST',user,readBody:async()=>data});
 const submit=async(resumeFromJobId)=>{const quote=await call('/quote',value),result=await call('/jobs',{...value,clientKey:randomUUID(),consent:true,billingToken:quote.value.token,...(resumeFromJobId?{resumeFromJobId}:{})});assert.equal(result.status,202);return result.value.item;};
 t.after(async()=>{await worker.stop();db.close();});return{db,billing,worker,calls,submit,call,get:id=>service.get(id,user),setFail:value=>{fail=value;}};
}
test('real tool worker persists exact locations and returns only the answered unit evidence with one settlement',async t=>{
 const f=fixture(t),created=await f.submit();await f.worker.tick();await f.worker.tick();const item=f.get(created.id);assert.equal(item.status,'completed');assert.deepEqual(f.calls,['first','second']);assert.match(item.output.text,/原文范围 2/);assert.doesNotMatch(item.output.text,/No answer|原文范围 1/);assert.deepEqual(item.output.sourceIds,['second']);assert.equal(item.output.citations.length,1);assert.equal(item.output.citations[0].start,0);assert.equal(item.output.answered,true);assert.equal(item.output.answerRanges.length,2);assert.deepEqual(item.output.answerRanges.map(r=>r.answered),[false,true]);
 const stored=JSON.parse(f.db.prepare('SELECT body FROM results WHERE job_id=?').get(created.id).body);assert.deepEqual(stored.sourceSnapshot.map(s=>s.id),['second']);assert.equal(f.db.prepare('SELECT count(*) n FROM tool_checkpoints WHERE run_id=?').get(created.id).n,2);assert.equal(f.billing.balance('alice').balance,190);assert.equal(f.billing.balance('alice').held,0);
});
test('resume retains old unit identity while filling legacy location metadata without regenerating its source',async t=>{
 const f=fixture(t,{failSecond:true}),created=await f.submit();await f.worker.tick();assert.equal(f.get(created.id).status,'failed');const cp=f.db.prepare('SELECT output FROM tool_checkpoints WHERE run_id=?').get(created.id),old=JSON.parse(cp.output);delete old.unitId;delete old.unitPosition;delete old.sourceRanges;for(const c of old.citations){delete c.start;delete c.end;}f.db.prepare('UPDATE tool_checkpoints SET output=? WHERE run_id=?').run(JSON.stringify(old),created.id);
 f.setFail(false);const resumed=await f.submit(created.id);await f.worker.tick();const done=f.get(resumed.id);assert.equal(done.status,'completed');assert.deepEqual(f.calls,['first','second','second']);assert.match(done.output.text,/原文范围 2/);assert.deepEqual(done.output.answerRanges.map(r=>[r.unitId,r.rangeNumber,r.answered]),[['unit-0',1,false],['unit-1',2,true]]);assert.equal(done.output.answerRanges[0].sourceRanges[0].sourceId,'first');assert.deepEqual(done.output.sourceIds,['second']);assert.equal(f.billing.balance('alice').balance,190);
});
test('impossible short material is rejected before any real quote, reservation or job is created',async t=>{
 const f=fixture(t);await assert.rejects(()=>f.call('/quote',request([{id:'short',name:'Short',text:'abc'}])),/至少 5 字符/);assert.equal(f.db.prepare('SELECT count(*) n FROM billing_quotes').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);assert.equal(f.billing.balance('alice').held,0);assert.equal(f.calls.length,0);
});
test('a legacy cross-unit checkpoint blocks resume before another provider call and retains the original record',async t=>{
 const f=fixture(t,{failSecond:true,longSource:true}),created=await f.submit();await f.worker.tick();assert.equal(f.get(created.id).completedUnits,1);const old=JSON.parse(f.db.prepare('SELECT output FROM tool_checkpoints WHERE run_id=?').get(created.id).output);old.citations=[{sourceId:'paper',quote:'Second source quotation.'}];f.db.prepare('UPDATE tool_checkpoints SET output=? WHERE run_id=?').run(JSON.stringify(old),created.id);f.setFail(false);const before=f.calls.length,resumed=await f.submit(created.id);await f.worker.tick();assert.equal(f.calls.length,before);assert.equal(f.get(resumed.id).status,'failed');assert.equal(f.get(resumed.id).completedUnits,1);assert.match(f.get(resumed.id).error,/原分配范围/);assert.equal(f.db.prepare('SELECT status FROM billing_reservations WHERE job_id=?').get(resumed.id).status,'released');assert.equal(f.billing.balance('alice').balance,200);assert.deepEqual(JSON.parse(f.db.prepare('SELECT output FROM tool_checkpoints WHERE run_id=?').get(created.id).output),old);
});
