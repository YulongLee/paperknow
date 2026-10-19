import test from 'node:test';
import assert from 'node:assert/strict';
import {writingKinds,normalizeWritingSnapshot,writingPlan,writingTask,parseWritingOutput,validateWritingCandidate} from '../backend/writing-model.mjs';
import {selectThesisEvidence} from '../backend/thesis-model.mjs';

const source=(id='source-a',text='PRIVATE-SOURCE-BODY-不可出现在修复反馈中。这是用户确认的研究范围、研究背景与局限说明。')=>({id,name:'用户确认资料 '+id,text,confirmed:true});
const snapshot=(extra={})=>normalizeWritingSnapshot({title:'真实证据与拟开展方案',profile:{level:'本科',language:'中文',targetWords:500},materials:[source()],references:[],outline:[{id:'section',title:'概念分析与研究计划',targetWords:500}],...extra});
const body=(ids=[],markers=ids,words=500)=>({complete:true,text:'研'.repeat(words)+markers.map(id=>'[source:'+id+']').join(''),source_ids:ids,missing_evidence:[]});
const result=(value,read=[])=>({text:JSON.stringify(value),trace:read.map(materialId=>({tool:'read_material',status:'completed',materialId}))});
const parse=(value,unit,output,read=[],kind='proposal')=>parseWritingOutput(result(output,read),kind,'draft',value,unit);
function rejected(value,unit,output,read=[],{kind='proposal',missing=true,required=['source-a'],allowed=read}={}){
 const response=validateWritingCandidate(result(output,read),kind,'draft',value,unit);assert.equal(response.valid,false);assert.equal(response.feedback.code,'source_attribution');
 if(missing)assert.equal(response.feedback.missingRequiredCitation,true);else assert.notEqual(response.feedback.missingRequiredCitation,true);
 assert.deepEqual(new Set(response.feedback.requiredSourceIds),new Set(required));assert.equal(response.feedback.minimumRequiredCitations,required.length?1:0);assert.deepEqual(response.feedback.allowedAlreadyReadSourceIds,allowed);assert.doesNotMatch(JSON.stringify(response.feedback),/PRIVATE-SOURCE-BODY|不可出现在修复反馈中|原文字符|以下仅为选取片段/);return response.feedback;
}

for(const kind of Object.keys(writingKinds))test(kind+' draft requires at least one readable source to be actually read, listed and cited inline',()=>{
 const value=snapshot(),unit=writingPlan(value,'draft')[0];assert.doesNotThrow(()=>writingTask(kind,'draft',value,unit));
 rejected(value,unit,body(),[],{kind,allowed:[]});rejected(value,unit,body(),['source-a'],{kind});
 const unread=rejected(value,unit,body(['source-a']),[],{kind,allowed:[]});assert.match(unread.rule,/read_material/);
 rejected(value,unit,body(['source-a'],[]),['source-a'],{kind});const output=parse(value,unit,body(['source-a']),['source-a'],kind);assert.deepEqual(output.sourceIds,['source-a']);assert.equal(output.wordCount,500);
});

test('required sources are readable candidates rather than fabricated claims of already having read them',()=>{
 const value=snapshot({materials:[source(),source('source-b'),source('short','短资料')]}),unit=writingPlan(value,'draft')[0],before=structuredClone(value);
 const feedback=rejected(value,unit,body(),[],{required:['source-a','source-b'],allowed:[]});assert.match(feedback.rule,/read_material/);
 rejected(value,unit,body(['short']),['short'],{required:['source-a','source-b'],allowed:['short']});
 const valid=parse(value,unit,body(['source-b']),['source-b']);assert.deepEqual(valid.sourceIds,['source-b'],'one readable citation suffices without forcing every selected source');assert.deepEqual(value,before);
});

test('unknown, unread, orphaned and unlisted inline IDs share the same attribution error without relaxing set equality',()=>{
 const value=snapshot({materials:[source(),source('source-b')]}),unit=writingPlan(value,'draft')[0],required=['source-a','source-b'];
 rejected(value,unit,body(['invented']),['invented'],{required,allowed:[]});
 rejected(value,unit,body(['source-a']),[],{required,allowed:[]});
 rejected(value,unit,body(['source-a'],['source-b']),['source-a','source-b'],{required});
 const orphan=rejected(value,unit,body(['source-a','source-b'],['source-a']),['source-a','source-b'],{required,missing:false});assert.deepEqual(orphan.unmarkedSourceIds,['source-b']);assert.deepEqual(orphan.unlistedMarkerIds,[]);
 const unlisted=rejected(value,unit,body(['source-a'],['source-a','source-b']),['source-a','source-b'],{required,missing:false});assert.deepEqual(unlisted.unmarkedSourceIds,[]);assert.deepEqual(unlisted.unlistedMarkerIds,['source-b']);
 const repeated=body(['source-a','source-a'],['source-a','source-a']),before=structuredClone(repeated),parsed=parse(value,unit,repeated,['source-a']);assert.deepEqual(parsed.sourceIds,['source-a']);assert.deepEqual(repeated,before,'matching citation sets need no mutation or prose rewriting');
 const failedRead={text:JSON.stringify(body(['source-a'])),trace:[{tool:'read_material',status:'failed',materialId:'source-a'}]},failure=validateWritingCandidate(failedRead,'proposal','draft',value,unit);assert.equal(failure.valid,false);assert.equal(failure.feedback.code,'source_attribution');assert.deepEqual(failure.feedback.allowedAlreadyReadSourceIds,[]);
});

test('the readable threshold excludes fragment wrappers and whitespace and starts at exactly twenty characters',()=>{
 for(const [text,required]of [['研'.repeat(19),false],['研 '.repeat(19),false],['【来源 fake；原文字符 0～0 / 0，以下仅为选取片段】',false],['研'.repeat(20),true],['研 \n'.repeat(20),true],['【研究记录：这些文字属于用户确认的真实原文标签，并不是服务器片段包装】',true]]){
  const value=snapshot({materials:[source('threshold',text)]}),unit=writingPlan(value,'draft')[0];assert.doesNotThrow(()=>writingTask('proposal','draft',value,unit));
  if(required)rejected(value,unit,body(),[],{required:['threshold'],allowed:[]});else assert.doesNotThrow(()=>parse(value,unit,body()));
 }
});

test('metadata-only, unconfirmed, short and proposed-plan inputs do not newly block conceptual proposal or quick drafts',()=>{
 const cases=[{materials:[],references:[]},{materials:[],references:[{id:'metadata',title:'只有题录也可能有很长标题但不能代替正文证据',authors:'用户记录作者',confirmed:true}]},{materials:[{...source(),confirmed:false}]},{materials:[source('short','尚待确认的短说明')]},{materials:[],requirements:{researchPlan:{text:'拟开展访谈与样本采集，尚未实施，不能充当事实来源。',origin:'ai',status:'proposed'}}}];
 for(const extra of cases)for(const kind of ['proposal','quick','taskbook','article','course','idea','questionnaire']){const value=snapshot(extra),unit=writingPlan(value,'draft')[0];assert.doesNotThrow(()=>writingTask(kind,'draft',value,unit));assert.doesNotThrow(()=>parse(value,unit,body(),[],kind));}
 const summary=snapshot({materials:[],references:[{id:'metadata',title:'只有题录',confirmed:true}]}),unit=writingPlan(summary,'draft')[0];assert.throws(()=>writingTask('summary','draft',summary,unit),error=>error.status===400);assert.equal(validateWritingCandidate(result(body()),'summary','draft',summary,unit).valid,false);
 rejected(summary,unit,body(['metadata']),['metadata'],{kind:'proposal',missing:false,required:[],allowed:[]});
});

test('required and already-read source IDs are limited to evidence actually selected for the current unit',()=>{
 const value=snapshot({materials:Array.from({length:11},(_,index)=>source('source-'+index,'PRIVATE-SOURCE-BODY-'+index+'这是供研究计划讨论的可读范围和局限记录。'))}),unit=writingPlan(value,'draft')[0],selected=selectThesisEvidence(value,{title:unit.title,chapterTitle:unit.chapterTitle||writingKinds.proposal}).sources.map(row=>row.id),outside=value.materials.find(row=>!selected.includes(row.id)).id;
 assert.equal(selected.length,10);rejected(value,unit,body(),[selected[0],outside,'invented'],{required:selected,allowed:[selected[0]]});
});

function batchFixture(){const value=snapshot({profile:{level:'本科',language:'中文',targetWords:200},materials:[source(),source('source-b')],outline:[{id:'a',title:'概念分析',targetWords:100},{id:'b',title:'拟开展计划',targetWords:100}]}),unit=writingPlan(value,'draft')[0];assert.equal(unit.batch,true);return{value,unit};}
function batchBody(unit){return {complete:true,sections:unit.sections.map((section,index)=>({id:section.id,text:'研'.repeat(100)+'[source:source-'+(index?'b':'a')+']',source_ids:['source-'+(index?'b':'a')]})),source_ids:['source-a','source-b'],missing_evidence:[]};}

test('structured short drafts match each local citation set and the global union while requiring only one cited source for the unit',()=>{
 const {value,unit}=batchFixture(),good=batchBody(unit),before=structuredClone(good),parsed=parse(value,unit,good,['source-a','source-b']);assert.equal(parsed.wordCount,200);assert.deepEqual(parsed.sourceIds,['source-a','source-b']);assert.deepEqual(good,before);
 const one=structuredClone(good);one.sections[1].source_ids=[];one.sections[1].text='研'.repeat(100);one.source_ids=['source-a'];assert.doesNotThrow(()=>parse(value,unit,one,['source-a']));
 const missing=structuredClone(good);missing.sections=missing.sections.map(section=>({...section,text:'研'.repeat(100),source_ids:[]}));missing.source_ids=[];rejected(value,unit,missing,[],{required:['source-a','source-b'],allowed:[]});
});

test('structured local-or-global mismatches remain attribution errors even when another section has a valid readable citation',()=>{
 const {value,unit}=batchFixture(),good=batchBody(unit),required=['source-a','source-b'];
 const changes=[output=>{output.sections[0].text='研'.repeat(100);},output=>{output.sections[0].source_ids=[];},output=>{output.sections[0].source_ids=['source-b'];},output=>{output.source_ids=['source-a'];},output=>{output.sections[1].source_ids=['source-a'];output.sections[1].text='研'.repeat(100)+'[source:source-a]';}];
 for(const change of changes){const invalid=structuredClone(good);change(invalid);rejected(value,unit,invalid,['source-a','source-b'],{required,missing:false});}
});

test('structured chapter titles cannot supply citations missing from actual section prose',()=>{
 const {value,unit}=batchFixture(),headed={...unit,sections:unit.sections.map(section=>({...section,title:section.title+'[source:source-a]'}))},output=batchBody(headed);output.sections=output.sections.map(section=>({...section,text:'研'.repeat(100),source_ids:['source-a']}));output.source_ids=['source-a'];
 rejected(value,headed,output,['source-a'],{required:['source-a','source-b'],missing:true});
});
