import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWritingSnapshot,writingPlan,writingTask,parseWritingOutput} from '../backend/writing-model.mjs';
import {requestedIdeaCount,requestedQuestionCount,requestedScalePoints,normalizeAIQuestionnaire,normalizeScaleOptions} from '../dist/workspace/questionnaire-model.mjs';

const snapshot=extra=>normalizeWritingSnapshot({title:'数字阅读的研究范围',profile:{level:'本科',language:'中文',targetWords:200},materials:[],references:[],outline:[{id:'review',title:'文献比较',targetWords:200}],...extra});
const candidate=(body,ids=[])=>({text:JSON.stringify(body),trace:ids.map(materialId=>({tool:'read_material',status:'completed',materialId})),usage:{input:100,output:200}});
const ideaRows=n=>Array.from({length:n},(_,i)=>({title:'候选题目'+i,rationale:'明确范围',questions:['研究问题'],methods:['拟采用方法'],limitations:['待确认条件']}));
const survey=(count=6,points=5)=>({complete:true,title:'数字阅读体验',introduction:'匿名自愿参与，仅用于研究整理。',source_ids:[],questions:Array.from({length:count},(_,i)=>({id:'q'+i,type:i===0?'scale':'single',title:'阅读体验'+i,options:i===0?Array.from({length:points},(_,n)=>'含义'+(n+1)):['是','否'],required:false}))});

test('requested counts support typed values and explicit Chinese/English text without confusing defaults or scale levels',()=>{
 for(const instructions of ['请给我三个题目，简要说明。','生成 3 个候选题目。','3 ideas','候选数量：3'])assert.equal(requestedIdeaCount({instructions}),3,instructions);
 for(const instructions of ['只需要三道题，分别了解入口和建议。','共 3 个问题，采用七级量表。','3 questions','three questions','题数：3'])assert.equal(requestedQuestionCount({instructions}),3,instructions);
 assert.equal(requestedQuestionCount({instructions:'研究目标：只需要三道题。\n未指定时默认设计 6 道题。'}),3);
 assert.equal(requestedQuestionCount({}),6);assert.equal(requestedIdeaCount({}),3);assert.equal(requestedScalePoints({instructions:'采用七级李克特量表'}),7);assert.equal(requestedScalePoints({instructions:'7-point Likert scale'}),7);assert.equal(requestedScalePoints({instructions:'seven-point Likert scale'}),7);assert.equal(requestedQuestionCount({instructions:'twenty-five questions'}),25);
 assert.equal(requestedQuestionCount({outputCount:8,instructions:'旧说明只要三道题'}),8);
 for(const requirements of [{outputCount:2},{outputCount:61},{outputCount:3.5},{instructions:'只要二道题'},{instructions:'3 道题，同时要 5 道题'}])assert.throws(()=>requestedQuestionCount(requirements));
 assert.throws(()=>requestedIdeaCount({instructions:'请生成10个题目'}));assert.throws(()=>requestedScalePoints({scalePoints:11}));
});

test('summary admission requires readable evidence while outline planning and unrelated proposal generation remain available',()=>{
 const metadata=snapshot({references:[{id:'meta',title:'只有题录',confirmed:true}],materials:[{id:'hidden',name:'未确认正文',text:'真实材料'.repeat(10),confirmed:false}]});
 const unit=writingPlan(metadata,'draft')[0];assert.throws(()=>writingTask('summary','draft',metadata,unit),error=>error.status===400&&/可读摘要或正文/.test(error.message));
 assert.doesNotThrow(()=>writingTask('summary','outline',metadata,writingPlan(metadata,'outline')[0]));assert.doesNotThrow(()=>writingTask('proposal','draft',metadata,unit));
 const readable=snapshot({references:[{id:'source',title:'用户确认摘要',text:'摘要正文与研究范围、研究问题、材料来源及局限的完整说明。',confirmed:true}]});
 assert.equal(writingTask('summary','draft',readable,writingPlan(readable,'draft')[0]).materials.length,1);
});

test('completed summary must cite a known actually-read source with a matching inline marker',()=>{
 const value=snapshot({references:[{id:'source',title:'用户确认摘要',text:'摘要正文与研究范围、研究问题、材料来源及局限的完整说明。',confirmed:true}]}),unit=writingPlan(value,'draft')[0],body={complete:true,text:'综'.repeat(200)+'[source:source]',source_ids:['source'],missing_evidence:[]};
 assert.equal(parseWritingOutput(candidate(body,['source']),'summary','draft',value,unit).wordCount,200);
 for(const result of [candidate({...body,text:'综'.repeat(200),source_ids:[]}),candidate({...body,text:'综'.repeat(200)},['source']),candidate(body),candidate({...body,source_ids:['invented']},['invented'])])assert.throws(()=>parseWritingOutput(result,'summary','draft',value,unit));
});

test('idea and questionnaire response lengths must equal the confirmed requested count, including defaults',()=>{
 const value=snapshot({requirements:{instructions:'请生成4个题目',outputCount:4}}),unit=writingPlan(value,'ideas')[0];assert.equal(writingTask('idea','ideas',value,unit).context.outputCount,4);
 for(const n of [3,5])assert.throws(()=>parseWritingOutput(candidate({complete:true,proposed:true,source_ids:[],ideas:ideaRows(n)}),'idea','ideas',value,unit),/4 个候选题目/);
 assert.equal(parseWritingOutput(candidate({complete:true,proposed:true,source_ids:[],ideas:ideaRows(4)}),'idea','ideas',value,unit).ideas.length,4);
 const defaultValue=snapshot(),questionUnit=writingPlan(defaultValue,'questionnaire')[0];assert.equal(parseWritingOutput(candidate(survey()),'questionnaire','questionnaire',defaultValue,questionUnit).questions.length,6);assert.throws(()=>parseWritingOutput(candidate(survey(3)),'questionnaire','questionnaire',defaultValue,questionUnit),/6 道题/);
});

test('seven-point AI scales preserve all anchors and invalid answers or altered cardinality cannot pass completion',()=>{
 const requirements={outputCount:3,scalePoints:7},value=snapshot({requirements}),unit=writingPlan(value,'questionnaire')[0],valid=survey(3,7),parsed=parseWritingOutput(candidate(valid),'questionnaire','questionnaire',value,unit);
 assert.deepEqual(parsed.questions[0].options,valid.questions[0].options);assert.equal(writingTask('questionnaire','questionnaire',value,unit).context.scalePoints,7);
 for(const change of [body=>({...body,questions:body.questions.slice(0,2)}),body=>({...body,questions:body.questions.map((q,i)=>i?q:{...q,options:q.options.slice(0,5)})}),body=>({...body,questions:body.questions.map((q,i)=>i?q:{...q,options:['重复','重复','3','4','5','6','7']})}),body=>({...body,questions:body.questions.map((q,i)=>i?q:{...q,required:'true'})}),body=>({...body,questions:body.questions.map((q,i)=>i?q:{...q,answers:['伪造回答']})}),body=>({...body,introduction:'说'.repeat(2001)})])assert.throws(()=>normalizeAIQuestionnaire(change(valid),requirements));
 assert.deepEqual(normalizeScaleOptions([],{legacyDefault:true}),['1','2','3','4','5']);assert.throws(()=>normalizeScaleOptions(['0','1','2']));
});
