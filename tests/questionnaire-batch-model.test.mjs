import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWritingSnapshot,writingPlan,writingTask,parseWritingOutput,aggregateWritingQuestionnaire} from '../backend/writing-model.mjs';
import {requestedQuestionCount,normalizeAIQuestionnaire} from '../dist/workspace/questionnaire-model.mjs';
import {normalizeQuestionnaireContent,questionnaireReport} from '../backend/questionnaire-service.mjs';

const anchors=['完全不同意','不同意','略不同意','中立','略同意','同意','完全同意'];
const snapshot=(count=60,requirements={})=>normalizeWritingSnapshot({title:'数字阅读问卷分批设计',profile:{level:'本科',language:'中文',targetWords:500},requirements:{outputCount:count,scalePoints:7,...requirements},materials:[],references:[],outline:[]});
function bodyFor(unit,{question,heading='数字阅读体验调查',introduction='拟开展的匿名自愿调查，不代表已有答卷。'}={}){
 return {complete:true,title:heading,introduction,source_ids:[],questions:Array.from({length:unit.questionCount},(_,index)=>{const n=unit.questionStart+index;return question?question(n,index):{id:'provider-'+index,type:n%3===0?'scale':'text',title:'第 '+n+' 项阅读体验',options:n%3===0?[...anchors]:[],required:false};})};
}
const result=body=>({text:JSON.stringify(body),trace:[]});
const parse=(value,unit,body=bodyFor(unit))=>parseWritingOutput(result(body),'questionnaire','questionnaire',value,unit);
const complete=(value,plan,options)=>plan.map(unit=>({id:unit.id,...parse(value,unit,bodyFor(unit,options))}));
const contentBytes=value=>Buffer.byteLength(JSON.stringify({title:value.title,introduction:value.introduction,questions:value.questions}));

test('every requested total from three to sixty produces balanced bounded batches with exact continuous question ranges',()=>{
 for(let total=3;total<=60;total++){
  const value=snapshot(total),plan=writingPlan(value,'questionnaire'),counts=plan.map(unit=>unit.questionCount);
  assert.equal(plan.length,Math.ceil(total/15));assert.equal(new Set(plan.map(unit=>unit.id)).size,plan.length);assert.equal(counts.reduce((sum,n)=>sum+n,0),total);assert.ok(counts.every(n=>Number.isInteger(n)&&n>=3&&n<=15));assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
  let start=1;for(const [position,unit]of plan.entries()){assert.equal(unit.position,position);assert.equal(unit.questionStart,start);assert.equal(unit.questionTotal,total);start+=unit.questionCount;}assert.equal(start,total+1);
 }
 assert.deepEqual(writingPlan(snapshot(60),'questionnaire').map(unit=>[unit.questionStart,unit.questionCount,unit.questionTotal]),[[1,15,60],[16,15,60],[31,15,60],[46,15,60]]);
 assert.deepEqual(writingPlan(snapshot(16),'questionnaire').map(unit=>unit.questionCount),[8,8]);assert.equal(writingPlan(snapshot(6),'questionnaire')[0].id,'questionnaire');
});

test('English fifty and sixty question requests share the same strict upper boundary and ignore boilerplate defaults',()=>{
 for(const [instructions,total]of [['fifty questions',50],['Please design sixty questions.',60],['fifty-nine questions',59],['六十道题',60],['题数：50',50],['sixty questions.\n未指定时默认设计 6 道问题。',60]]){
  assert.equal(requestedQuestionCount({instructions}),total);const value=normalizeWritingSnapshot({title:'英文题数验收',profile:{targetWords:500},requirements:{instructions}});assert.equal(writingPlan(value,'questionnaire').reduce((sum,unit)=>sum+unit.questionCount,0),total);
 }
 for(const requirements of [{outputCount:2},{outputCount:61},{outputCount:15.5},{instructions:'sixty-one questions'},{instructions:'fifty questions; sixty questions'}])assert.throws(()=>requestedQuestionCount(requirements));
 assert.equal(requestedQuestionCount({}),6);assert.equal(requestedQuestionCount({outputCount:60,instructions:'旧说明只要 three questions'}),60);
});

test('batch task instructions distinguish whole-survey and current-batch counts and preserve previous question titles and heading',()=>{
 const value=snapshot(60,{targetSampleSize:250,researchDimensions:'易用性、内容质量',analysisFocus:'比较阅读频率下的服务需求'}),plan=writingPlan(value,'questionnaire'),first={id:plan[0].id,...parse(value,plan[0])},task=writingTask('questionnaire','questionnaire',value,plan[1],[first]);
 assert.equal(task.context.requirements.outputCount,60);assert.equal(task.context.outputCount,15);assert.equal(task.context.scalePoints,7);assert.deepEqual(task.context.questionnaireBatch,{start:16,count:15,total:60});
 assert.deepEqual(task.context.previousQuestionTitles,first.questions.map(q=>q.title));assert.deepEqual(task.context.questionnaireHeading,{title:first.title,introduction:first.introduction});assert.equal(task.context.requirements.targetSampleSize,250);assert.equal(task.context.requirements.researchDimensions,'易用性、内容质量');assert.equal(task.context.requirements.analysisFocus,'比较阅读频率下的服务需求');
 assert.match(task.instructions,/本批精确题数/);assert.match(task.instructions,/整份总题数/);assert.match(task.instructions,/previousQuestionTitles/);assert.match(task.instructions,/未收集任何样本，未计算信度、效度或统计检验/);
 const initial=writingTask('questionnaire','questionnaire',value,plan[0],[]);assert.deepEqual(initial.context.previousQuestionTitles,[]);assert.equal(initial.context.questionnaireHeading,null);
});

test('each batch parser enforces its own exact count, creates canonical global IDs and preserves all seven verbal anchors',()=>{
 const value=snapshot(60),plan=writingPlan(value,'questionnaire');
 for(const unit of plan){const raw=bodyFor(unit),before=structuredClone(raw),parsed=parse(value,unit,raw);assert.equal(parsed.questions.length,15);assert.deepEqual(parsed.questions.map(q=>q.id),Array.from({length:15},(_,i)=>'q'+(unit.questionStart+i)));for(const q of parsed.questions.filter(q=>q.type==='scale'))assert.deepEqual(q.options,anchors);assert.deepEqual(raw,before);}
 const unit=plan[1],body=bodyFor(unit);
 for(const count of [14,16,60]){const incorrect={...body,questions:Array.from({length:count},(_,i)=>({...body.questions[i%15],id:'unexpected-'+i}))};assert.throws(()=>parse(value,unit,incorrect),/15 道题/);}
 const duplicateIds=structuredClone(body);duplicateIds.questions[1].id=duplicateIds.questions[0].id;assert.throws(()=>parse(value,unit,duplicateIds),/题号重复或无效/);
 const fiveLevels=structuredClone(body),scale=fiveLevels.questions.find(q=>q.type==='scale');scale.options=scale.options.slice(0,5);assert.throws(()=>parse(value,unit,fiveLevels),/7 个分值/);
});

test('aggregation follows plan order and returns exactly sixty canonical unique questions with the first heading',()=>{
 const value=snapshot(60),plan=writingPlan(value,'questionnaire'),completed=complete(value,plan),before=structuredClone(completed);
 completed[1].title='后续批次不得替换的标题';completed[1].introduction='后续批次不同的参与说明。';
 const merged=aggregateWritingQuestionnaire(value,plan,[...completed].reverse());assert.equal(merged.questions.length,60);assert.deepEqual(merged.questions.map(q=>q.id),Array.from({length:60},(_,i)=>'q'+(i+1)));assert.equal(new Set(merged.questions.map(q=>q.id)).size,60);assert.equal(merged.title,before[0].title);assert.equal(merged.introduction,before[0].introduction);assert.deepEqual(merged.questions.filter(q=>q.type==='scale').map(q=>q.options),Array.from({length:20},()=>anchors));assert.equal(merged.requiresReview,true);assert.deepEqual(normalizeAIQuestionnaire(merged,value.requirements).questions,merged.questions);
 assert.deepEqual(completed[0],before[0]);assert.deepEqual(completed[2],before[2]);assert.deepEqual(completed[3],before[3]);
});

test('final results require all batches while partial validation accepts only a continuous valid prefix',()=>{
 const value=snapshot(60),plan=writingPlan(value,'questionnaire'),completed=complete(value,plan);
 assert.equal(aggregateWritingQuestionnaire(value,plan,[],{partial:true}),null);assert.throws(()=>aggregateWritingQuestionnaire(value,plan,[]),/尚未全部完成/);
 for(const count of [1,2,3]){const prefix=completed.slice(0,count),before=structuredClone(prefix),partial=aggregateWritingQuestionnaire(value,plan,prefix,{partial:true});assert.equal(partial.questions.length,count*15);assert.deepEqual(partial.questions.map(q=>q.id),Array.from({length:count*15},(_,i)=>'q'+(i+1)));assert.deepEqual(prefix,before);assert.throws(()=>aggregateWritingQuestionnaire(value,plan,prefix),/尚未全部完成/);}
 for(const gap of [[completed[1]],[completed[0],completed[2]]])assert.throws(()=>aggregateWritingQuestionnaire(value,plan,gap,{partial:true}),/题号不连续/);
});

test('partial validation rejects duplicate normalized titles and tampered scale options before accepting a new checkpoint',()=>{
 const value=snapshot(60),plan=writingPlan(value,'questionnaire'),completed=complete(value,plan),saved=structuredClone(completed[0]);
 const cases=[[' A B ','ａ b'],['研究体验','研 究 体 验']];
 for(const [first,next]of cases){const earlier=structuredClone(completed[0]),candidate=structuredClone(completed[1]);earlier.questions[0].title=first;candidate.questions[0].title=next;assert.throws(()=>aggregateWritingQuestionnaire(value,plan,[earlier,candidate],{partial:true}),/重复题目/);}
 const invalid=structuredClone(completed[1]);invalid.questions.find(q=>q.type==='scale').options.pop();assert.throws(()=>aggregateWritingQuestionnaire(value,plan,[completed[0],invalid],{partial:true}),/7 个分值/);
 assert.deepEqual(completed[0],saved,'a rejected candidate cannot edit the prior accepted checkpoint');
});

test('batch checkpoints still require authorized actual source reads and aggregation keeps their distinct source identities',()=>{
 const value={...snapshot(16),materials:[{id:'source-a',name:'已确认设计依据 A',text:'这是用户确认的可读取问卷设计依据，只说明研究范围，不代表已收集答卷。',confirmed:true},{id:'source-b',name:'已确认设计依据 B',text:'这是另一份用户确认的可读取维度设计说明，不代表研究效果得到验证。',confirmed:true}]},plan=writingPlan(value,'questionnaire'),completed=[];
 for(const [index,unit]of plan.entries()){const id=index?'source-b':'source-a',body={...bodyFor(unit),source_ids:[id]},readResult={text:JSON.stringify(body),trace:[{tool:'read_material',status:'completed',materialId:id}]};
  assert.throws(()=>parseWritingOutput({...readResult,trace:[]},'questionnaire','questionnaire',value,unit),error=>error.validationCode==='source_attribution');
  assert.throws(()=>parseWritingOutput({...readResult,text:JSON.stringify({...body,source_ids:['invented']})},'questionnaire','questionnaire',value,unit),error=>error.validationCode==='source_attribution');
  completed.push({id:unit.id,...parseWritingOutput(readResult,'questionnaire','questionnaire',value,unit)});
 }
 assert.deepEqual(aggregateWritingQuestionnaire(value,plan,completed).sourceIds,['source-a','source-b']);
});

test('the safe-adoption boundary is exactly thirty thousand UTF-8 bytes and overflow never silently truncates prior questions',()=>{
 const value=snapshot(60),plan=writingPlan(value,'questionnaire');let completed;
 for(let length=1;length<500;length++){
  const candidate=complete(value,plan,{question:n=>({id:'provider-'+n,type:'text',title:'问题 '+n+'：'+'研'.repeat(length),options:[],required:false}),introduction:'a'}),merged=aggregateWritingQuestionnaire(value,plan,candidate,{partial:true}),remaining=30000-contentBytes(merged);
  if(remaining>=0&&remaining<1999){for(const row of candidate)row.introduction='a'.repeat(remaining+1);completed=candidate;break;}
 }
 assert.ok(completed,'a valid payload can reach the byte boundary without exceeding any field maximum');const before=structuredClone(completed),merged=aggregateWritingQuestionnaire(value,plan,completed);assert.equal(contentBytes(merged),30000);assert.equal(merged.questions.length,60);
 const oversized=structuredClone(completed);oversized[0].introduction+='b';for(const partial of [false,true])assert.throws(()=>aggregateWritingQuestionnaire(value,plan,oversized,{partial}),/内容过长/);assert.deepEqual(completed,before);
 const huge=complete(value,plan,{question:n=>({id:'provider-'+n,type:'scale',title:'独立量表问题 '+n,options:anchors.map((label,i)=>label+'级'+i+'研'.repeat(140)),required:false})});assert.throws(()=>aggregateWritingQuestionnaire(value,plan,[huge[0]],{partial:true}),/未静默裁短/);
});

test('optional planning fields are typed design input in both contracts and never inflate actual response statistics',()=>{
 const requirements={targetSampleSize:1000,researchDimensions:' 易用性与持续使用 ',analysisFocus:' 后续比较计划 '},value=snapshot(3,requirements);assert.equal(value.requirements.targetSampleSize,1000);assert.equal(value.requirements.researchDimensions,'易用性与持续使用');assert.equal(value.requirements.analysisFocus,'后续比较计划');
 const questions=parse(value,writingPlan(value,'questionnaire')[0]).questions,content=normalizeQuestionnaireContent({title:'研究计划',introduction:'匿名自愿参与。',questions,questionCount:3,scalePoints:7,...requirements},{publish:true});assert.equal(content.targetSampleSize,1000);assert.equal(content.researchDimensions,'易用性与持续使用');assert.equal(content.analysisFocus,'后续比较计划');
 const report=questionnaireReport(content,[]);assert.equal(report.total,0);assert.equal(report.method,'descriptive');assert.ok(report.questions.every(q=>q.answered===0&&q.missing===0));assert.match(report.limitations,/不提供因果结论或显著性检验/);assert.equal(Object.hasOwn(report,'reliability'),false);assert.equal(Object.hasOwn(report,'validity'),false);
 for(const targetSampleSize of [0,1001,1.5,'250',false]){assert.throws(()=>snapshot(3,{targetSampleSize}),error=>error.status===400);assert.throws(()=>normalizeQuestionnaireContent({...content,targetSampleSize}),error=>error.status===400);}
 for(const field of ['researchDimensions','analysisFocus'])for(const invalid of [null,{},'研'.repeat(2001)]){assert.throws(()=>snapshot(3,{[field]:invalid}),error=>error.status===400);assert.throws(()=>normalizeQuestionnaireContent({...content,[field]:invalid}),error=>error.status===400);}
 for(const targetSampleSize of [1,1000])assert.equal(snapshot(3,{targetSampleSize}).requirements.targetSampleSize,targetSampleSize);
});
