import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAIQuestionnaire} from '../dist/workspace/questionnaire-model.mjs';
import {normalizeWritingSnapshot,writingPlan,parseWritingOutput,validateWritingCandidate} from '../backend/writing-model.mjs';

const requirements={outputCount:15,scalePoints:7};
const snapshot=()=>normalizeWritingSnapshot({title:'问卷选项诊断验收',profile:{level:'本科',language:'中文',targetWords:500},requirements:{outputCount:60,scalePoints:7},materials:[],references:[],outline:[]});
const question=(index,extra={})=>({id:'provider-'+index,type:'single',title:'待核对问题 '+index,options:['选项甲','选项乙'],required:false,...extra});
const body=(questions=Array.from({length:15},(_,index)=>question(index)))=>({complete:true,title:'匿名问卷设计',introduction:'匿名自愿参与，仅为拟开展的问卷设计。',source_ids:[],questions});
const candidate=value=>({text:JSON.stringify(value),trace:[]});
const capture=fn=>{try{fn();assert.fail('The invalid questionnaire must be rejected');}catch(error){if(error.code==='ERR_ASSERTION')throw error;return error;}};
const localKeys=['questionIndex','questionId','questionType','field','code','actualOptionsCount','expectedMin','expectedMax','expectedExact'];
function assertIssue(issue,{index,type,actual,min,max,exact,global}={}){
 assert.equal(issue.questionIndex,index);assert.equal(issue.questionId,'q'+(global??index));assert.equal(issue.questionType,type);assert.equal(issue.field,'options');assert.equal(issue.code,'option_count');assert.equal(issue.actualOptionsCount,actual);assert.equal(issue.expectedMin,min);assert.equal(issue.expectedMax,max);
 if(exact!==undefined)assert.equal(issue.expectedExact,exact);else assert.equal(Object.hasOwn(issue,'expectedExact'),false);
 if(global!==undefined)assert.equal(issue.globalQuestionIndex,global);
 assert.ok(Object.keys(issue).every(key=>localKeys.includes(key)||global!==undefined&&key==='globalQuestionIndex'),'diagnostics contain only contract-owned fields');
}

test('one slash-joined choice stays one invalid array element and produces a concrete count diagnosis without rewriting input',()=>{
 const value=body();value.questions[2].options=['甲 / 乙 / 丙'];const before=structuredClone(value),error=capture(()=>normalizeAIQuestionnaire(value,requirements));
 assert.equal(error.validationCode,'questionnaire_options');assert.equal(error.validationField,'questions');assert.equal(error.validationIssueCount,1);assert.equal(error.validationIssues.length,1);assertIssue(error.validationIssues[0],{index:3,type:'single',actual:1,min:2,max:10});assert.deepEqual(value,before);
});

test('choice arrays require two through ten entries while nonarrays report a null actual count',()=>{
 for(const type of ['single','multiple'])for(const options of [undefined,null,'甲 / 乙',{},[],['唯一选项'],Array.from({length:11},(_,i)=>'选项'+i)]){
  const value=body();value.questions[0]={...value.questions[0],type,options};const before=structuredClone(value),error=capture(()=>normalizeAIQuestionnaire(value,requirements));
  assert.equal(error.validationCode,'questionnaire_options');assertIssue(error.validationIssues[0],{index:1,type,actual:Array.isArray(options)?options.length:null,min:2,max:10});assert.deepEqual(value,before);
 }
});

test('requested seven-level scales use exact seven and text questions require an empty array',()=>{
 for(const options of [undefined,null,'1 / 2 / 3 / 4 / 5 / 6 / 7',[],Array.from({length:6},(_,i)=>'含义'+i),Array.from({length:8},(_,i)=>'含义'+i)]){
  const value=body();value.questions[4]={...value.questions[4],type:'scale',options};const error=capture(()=>normalizeAIQuestionnaire(value,requirements));assertIssue(error.validationIssues[0],{index:5,type:'scale',actual:Array.isArray(options)?options.length:null,min:7,max:7,exact:7});
 }
 for(const options of [undefined,null,'私密预设答案',['私密预设答案']]){const value=body();value.questions[7]={...value.questions[7],type:'text',options};const error=capture(()=>normalizeAIQuestionnaire(value,requirements));assertIssue(error.validationIssues[0],{index:8,type:'text',actual:Array.isArray(options)?options.length:null,min:0,max:0});}
});

test('multiple option errors are collected in input order up to ten with safe server-owned IDs and no private text',()=>{
 const value=body(Array.from({length:15},(_,index)=>question(index,{id:'MALICIOUS-ID-'+index+'<script>',title:'PRIVATE-QUESTION-TEXT-'+index,options:['PRIVATE-OPTION-TEXT-'+index]}))),before=structuredClone(value),error=capture(()=>normalizeAIQuestionnaire(value,requirements));
 assert.equal(error.validationCode,'questionnaire_options');assert.equal(error.validationField,'questions');assert.equal(error.validationIssueCount,15);assert.equal(error.validationIssues.length,10);
 for(const [index,issue]of error.validationIssues.entries())assertIssue(issue,{index:index+1,type:'single',actual:1,min:2,max:10});
 assert.doesNotMatch(JSON.stringify({message:error.message,...error}),/MALICIOUS-ID|PRIVATE-QUESTION-TEXT|PRIVATE-OPTION-TEXT|<script>/);assert.deepEqual(value,before);
});

test('parser and candidate feedback retain safe diagnostics and translate batch indices to global questions forty-six through sixty',()=>{
 const value=snapshot(),unit=writingPlan(value,'questionnaire')[3],output=body();
 for(const index of [0,4,14])output.questions[index]={...output.questions[index],id:'PRIVATE-ID-'+index+'<script>',title:'PRIVATE-QUESTION-'+index,options:['PRIVATE-OPTION-'+index]};
 const before=structuredClone(output),error=capture(()=>parseWritingOutput(candidate(output),'questionnaire','questionnaire',value,unit));assert.equal(error.status,502);assert.equal(error.validationCode,'questionnaire_options');assert.equal(error.validationField,'questions');assert.equal(error.validationIssues.length,3);
 for(const [position,index]of [0,4,14].entries())assertIssue(error.validationIssues[position],{index:index+1,global:46+index,type:'single',actual:1,min:2,max:10});
 const rejected=validateWritingCandidate(candidate(output),'questionnaire','questionnaire',value,unit);assert.equal(rejected.valid,false);assert.equal(rejected.feedback.code,'questionnaire_options');assert.equal(rejected.feedback.field,'questions');assert.equal(rejected.feedback.issueCount,3);assert.equal(rejected.feedback.issuesTruncated,false);assert.deepEqual(rejected.feedback.issues,error.validationIssues);assert.match(rejected.feedback.rule,/独立/);assert.match(rejected.feedback.rule,/数组/);assert.match(rejected.feedback.rule,/斜杠|串|分隔|[/／]/);assert.match(rejected.feedback.rule,/当前批次/);assert.match(rejected.feedback.rule,/保留本批全部题目和精确题数/);assert.match(rejected.feedback.rule,/不重复生成此前已完成的批次/);
 assert.doesNotMatch(JSON.stringify(rejected.feedback),/PRIVATE-ID|PRIVATE-QUESTION|PRIVATE-OPTION|<script>/);assert.deepEqual(output,before);
 const allBad=body(Array.from({length:15},(_,index)=>question(index,{options:[]}))),allRejected=validateWritingCandidate(candidate(allBad),'questionnaire','questionnaire',value,unit);assert.equal(allRejected.feedback.issues.length,10);assert.equal(allRejected.feedback.issueCount,15);assert.equal(allRejected.feedback.issuesTruncated,true);assert.deepEqual(allRejected.feedback.issues.map(issue=>issue.globalQuestionIndex),Array.from({length:10},(_,i)=>46+i));assert.match(allRejected.feedback.rule,/issuesTruncated=true 时还须检查本批其余题目/);
});

test('valid option boundaries remain accepted and unrelated content rules do not become more permissive',()=>{
 const questions=[question(0,{type:'single',options:['甲','乙']}),question(1,{type:'multiple',options:Array.from({length:10},(_,i)=>'选项'+i)}),question(2,{type:'scale',options:Array.from({length:7},(_,i)=>String(i+1))}),question(3,{type:'text',options:[]})],value=body(questions),before=structuredClone(value),parsed=normalizeAIQuestionnaire(value,{outputCount:4,scalePoints:7});assert.deepEqual(parsed.questions,questions);assert.deepEqual(value,before);
 for(const change of [value=>value.questions[0].options=['重复','重复'],value=>value.questions[0].options=['选项','长'.repeat(151)],value=>value.questions[2].options=['0','1','2','3','4','5','6'],value=>value.questions[0].required='false',value=>value.questions[0].id='__proto__',value=>value.questions.pop()]){const invalid=structuredClone(value);change(invalid);assert.throws(()=>normalizeAIQuestionnaire(invalid,{outputCount:4,scalePoints:7}));}
 const full=snapshot(),unit=writingPlan(full,'questionnaire')[3];assert.equal(validateWritingCandidate(candidate(body()),'questionnaire','questionnaire',full,unit).valid,true);
 const fewer=body();fewer.questions.pop();assert.equal(validateWritingCandidate(candidate(fewer),'questionnaire','questionnaire',full,unit).valid,false);
});

test('unknown question types remain rejected without reflecting injected enum text into diagnostics',()=>{
 const value=snapshot(),unit=writingPlan(value,'questionnaire')[3],output=body();output.questions[0].type='PRIVATE-TYPE<script>';output.questions[0].id='PRIVATE-ID<script>';output.questions[0].title='PRIVATE-TITLE';output.questions[0].options=['PRIVATE-OPTION'];
 const rejected=validateWritingCandidate(candidate(output),'questionnaire','questionnaire',value,unit);assert.equal(rejected.valid,false);assert.doesNotMatch(JSON.stringify(rejected.feedback),/PRIVATE-TYPE|PRIVATE-ID|PRIVATE-TITLE|PRIVATE-OPTION|<script>/);
});

test('option repair feedback cannot bypass actual-source reads or promote an incomplete questionnaire to completion',()=>{
 const value={...snapshot(),materials:[{id:'authorized',name:'已确认资料',text:'这是用户确认的可读问卷设计资料，不代表已有调查结果。',confirmed:true}]},unit=writingPlan(value,'questionnaire')[3],invalid=body();invalid.questions[0].options=['唯一选项'];
 const unread=validateWritingCandidate(candidate({...invalid,source_ids:['authorized']}),'questionnaire','questionnaire',value,unit);assert.equal(unread.valid,false);assert.equal(unread.feedback.code,'source_attribution');assert.deepEqual(unread.feedback.allowedAlreadyReadSourceIds,[]);assert.equal(Object.hasOwn(unread.feedback,'issues'),false);
 const incomplete=validateWritingCandidate(candidate({...invalid,complete:false,missing_evidence:['尚缺当前设计必要依据']}),'questionnaire','questionnaire',value,unit);assert.equal(incomplete.valid,false);assert.equal(incomplete.feedback.code,'needs_materials');assert.equal(Object.hasOwn(incomplete.feedback,'issues'),false);
});
