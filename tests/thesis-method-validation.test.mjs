import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeThesisMethodSnapshot,parseThesisMethod} from '../backend/thesis-method-model.mjs';

const snapshot=normalizeThesisMethodSnapshot({title:'拟开展的技术方案比较研究',profile:{level:'本科',targetWords:8000},materials:[],references:[]});
const proposal=()=>({complete:true,proposed:true,methods:[{name:'拟采用比较分析法',rationale:'拟根据真实可获得的材料比较方案。',steps:['拟确定比较维度。','拟收集材料并逐项核对。'],prerequisites:['需确认资料使用权限。'],limitations:['结论的适用范围需核对。']}],missingInformation:[],source_ids:[]});
const parse=body=>parseThesisMethod({text:JSON.stringify(body),trace:[],finishReason:'end_turn'},snapshot);
function validation(body,code,field){
 assert.throws(()=>parse(body),error=>{
  assert.equal(error.code,'invalid_method');assert.equal(error.validationCode,code);assert.equal(error.validationField,field);
  assert.match(error.message,/原补充说明未改变/);assert.doesNotMatch(error.message,/PRIVATE_RESEARCH_CONTENT|<script>|method-test-model/);
  return true;
 });
}

test('method proposals preserve academic comparisons and code notation as literal plain text',()=>{
 const body=proposal(),academic='拟以 p < 0.05 为参考，检查 x < y 与 z > 2，比较 `std::vector<int>` 和 `std::map<K,V>`，不预设实际结果。';
 body.methods[0].steps[1]=academic;
 const parsed=parse(body);assert.equal(parsed.methods[0].steps[1],academic);assert.ok(parsed.text.includes(academic));assert.equal(parsed.evidenceStatus,'proposal');assert.equal(parsed.proposed,true);
});

test('method proposals reject actual HTML and control characters without exposing submitted text in diagnostics',()=>{
 for(const text of ['<script>PRIVATE_RESEARCH_CONTENT</script>','<IMG src=x onerror=alert(1)>','<svg/onload=alert(1)>','<a href="https://example.test">link</a>','<!DOCTYPE html>','<!-- PRIVATE_RESEARCH_CONTENT -->','PRIVATE_RESEARCH_CONTENT\u0000']){
  const body=proposal();body.methods[0].rationale=text;validation(body,'unsupported_markup','methods[0].rationale');
 }
});

test('method validation reports missing fields and never invents completion, proposal or empty source markers',()=>{
 for(const [key,code] of [['complete','incomplete'],['proposed','missing_proposal_marker'],['methods','method_count'],['missingInformation','missing_list'],['source_ids','invalid_source_list']]){
  const body=proposal();delete body[key];validation(body,code,key);assert.equal(Object.hasOwn(body,key),false);
 }
 for(const key of ['complete','proposed']){const body=proposal();body[key]='true';validation(body,key==='complete'?'incomplete':'missing_proposal_marker',key);}
 for(const key of ['name','rationale']){const body=proposal();body.methods[0][key]='';validation(body,'missing_text','methods[0].'+key);}
 for(const key of ['steps','prerequisites','limitations']){const body=proposal();delete body.methods[0][key];validation(body,'missing_list','methods[0].'+key);}
});

test('method validation accepts inclusive list and text boundaries without truncating academic content',()=>{
 const body=proposal(),row=body.methods[0];row.name='名'.repeat(100);row.rationale='理'.repeat(800);row.steps=Array(6).fill('步'.repeat(500));row.prerequisites=Array(5).fill('前'.repeat(500));row.limitations=Array(5).fill('限'.repeat(500));body.missingInformation=Array(6).fill('待'.repeat(300));
 const parsed=parse(body);assert.equal(parsed.methods[0].name.length,100);assert.equal(parsed.methods[0].rationale.length,800);assert.deepEqual(parsed.methods[0].steps,row.steps);assert.deepEqual(parsed.methods[0].prerequisites,row.prerequisites);assert.deepEqual(parsed.methods[0].limitations,row.limitations);assert.deepEqual(parsed.missingInformation,body.missingInformation);
 const three=proposal();three.methods=Array.from({length:3},(_,index)=>({...structuredClone(three.methods[0]),name:'拟采用的方法 '+index}));assert.equal(parse(three).methods.length,3);
});

test('method validation distinguishes excessive lists, short plans and overlong text by safe field paths',()=>{
 for(const [key,count] of [['steps',1],['steps',7],['prerequisites',0],['prerequisites',6],['limitations',0],['limitations',6]]){const body=proposal();body.methods[0][key]=Array(count).fill('PRIVATE_RESEARCH_CONTENT');validation(body,'list_size','methods[0].'+key);}
 const missing=proposal();missing.missingInformation=Array(7).fill('PRIVATE_RESEARCH_CONTENT');validation(missing,'list_size','missingInformation');
 for(const [key,length] of [['name',101],['rationale',801]]){const body=proposal();body.methods[0][key]='字'.repeat(length);validation(body,'text_too_long','methods[0].'+key);}
 for(const key of ['steps','prerequisites','limitations']){const body=proposal();body.methods[0][key][0]='字'.repeat(501);validation(body,'text_too_long','methods[0].'+key+'[0]');}
 const longMissing=proposal();longMissing.missingInformation=['字'.repeat(301)];validation(longMissing,'text_too_long','missingInformation[0]');
});

test('method validation distinguishes malformed transport content, truncation and unverifiable sources',()=>{
 for(const [result,code] of [[{text:'not json PRIVATE_RESEARCH_CONTENT'},'invalid_json'],[{text:''},'missing_response'],[{text:'字'.repeat(30001)},'response_too_long'],[{text:JSON.stringify(proposal()),finishReason:'max_tokens'},'truncated']]){
  assert.throws(()=>parseThesisMethod(result,snapshot),error=>error.code==='invalid_method'&&error.validationCode===code&&error.validationField==='response'&&!error.message.includes('PRIVATE_RESEARCH_CONTENT'));
 }
 const body=proposal();body.source_ids=['PRIVATE_RESEARCH_CONTENT'];validation(body,'unverified_source','source_ids');
 const marker=proposal();marker.methods[0].rationale='拟核对 [source:PRIVATE_RESEARCH_CONTENT]';validation(marker,'unlisted_source_marker','methods');
 const duplicate=proposal();duplicate.methods.push(structuredClone(duplicate.methods[0]));validation(duplicate,'duplicate_method','methods[1].name');
});
