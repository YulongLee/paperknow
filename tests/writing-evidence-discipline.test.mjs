import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeThesisSnapshot,thesisPlan,thesisAgentTask} from '../backend/thesis-model.mjs';
import {normalizeWritingSnapshot,writingPlan,writingTask} from '../backend/writing-model.mjs';

const fixture={title:'高校数字阅读服务研究',profile:{level:'本科',language:'中文',targetWords:500},requirements:{},materials:[{id:'sample',name:'方案记录',text:'这是拟开展的阅读服务改进计划，演示人员只记录了三次检索步骤，没有实际问卷或效果数据。',confirmed:true}],references:[],outline:[{id:'c1',title:'研究方法与过程',targetWords:500,sections:[]}]};
test('thesis and every writing scenario receive claim-level evidence instructions',()=>{
 const thesis=normalizeThesisSnapshot(fixture),thesisTask=thesisAgentTask(thesis,thesisPlan(thesis)[0],[]);
 const snapshot=normalizeWritingSnapshot(fixture),unit=writingPlan(snapshot,'draft')[0];
 for(const task of [thesisTask,...['proposal','summary','taskbook','article','course','practice'].map(kind=>writingTask(kind,'draft',snapshot,unit)),writingTask('article','outline',snapshot,unit)]){
  assert.match(task.instructions,/题目、提纲、改进设想、演示记录和题录不能证明/);
  assert.match(task.instructions,/不能因为文档已读取就把其标记附在来源未陈述的事实后/);
  assert.match(task.instructions,/演示记录只支持记录中实际描述的步骤/);
 }
});
test('summary limits each cited detail to available text and taskbook separates plan sections',()=>{
 const snapshot=normalizeWritingSnapshot(fixture),unit=writingPlan(snapshot,'draft')[0];
 const summary=writingTask('summary','draft',snapshot,unit),taskbook=writingTask('taskbook','draft',snapshot,unit);
 assert.match(summary.instructions,/不得凭模型常识补写片段未说明的细节/);
 assert.match(summary.instructions,/摘要未提及不代表原文不存在/);
 assert.match(taskbook.instructions,/各栏目各有用途/);
 assert.match(taskbook.instructions,/仅在用户或模板明确要求具体数值且缺失时保留待补充标记/);
});
test('completion cannot infer an unspecified local institution while correcting a typo',async()=>{
 const {validateWritingCandidate}=await import('../backend/writing-model.mjs');
 const s=normalizeWritingSnapshot({title:'高校数字阅读服务研究',profile:{level:'本科',language:'中文',targetWords:200},requirements:{},materials:[],references:[],outline:[{id:'a',title:'研究背景',targetWords:200}]});
 const unit={...writingPlan(s,'draft')[0],completion:true,revisionOriginal:'本研究以校数字阅读服务为对象。'};
 const body=text=>({text:JSON.stringify({complete:true,text,source_ids:[],missing_evidence:[]}),trace:[]});
 const candidate=body('本研究以本校数字阅读服务为对象，'+ '拟研究如何改善阅读体验。'.repeat(18));const rejected=validateWritingCandidate(candidate,'proposal','draft',s,unit);assert.equal(rejected.valid,false);assert.equal(rejected.feedback.code,'unsupported_institution');assert.match(rejected.feedback.rule,/不能推测或虚构/);
 const allowed=body('本研究以高校数字阅读服务为对象，'+'拟研究如何改善阅读体验。'.repeat(18));assert.notEqual(validateWritingCandidate(allowed,'proposal','draft',s,unit).feedback?.code,'unsupported_institution');
 const userConfirmed={...unit,revisionOriginal:'本校数字阅读服务是研究对象。'};assert.notEqual(validateWritingCandidate(candidate,'proposal','draft',s,userConfirmed).feedback?.code,'unsupported_institution');
});
test('completion cannot add an ISO standard absent from the manuscript and authorized materials',async()=>{
 const {validateWritingCandidate}=await import('../backend/writing-model.mjs');
 const s=normalizeWritingSnapshot({title:'高校数字阅读服务研究',profile:{level:'本科',language:'中文',targetWords:200},requirements:{},materials:[],references:[],outline:[{id:'a',title:'研究背景',targetWords:200}]});
 const unit={...writingPlan(s,'draft')[0],completion:true,revisionOriginal:'本研究拟探讨阅读服务。'},body=text=>({text:JSON.stringify({complete:true,text,source_ids:[],missing_evidence:[]}),trace:[]});
 const text='参考 ISO 9241-11，'+'拟研究如何改善阅读体验。'.repeat(18),rejected=validateWritingCandidate(body(text),'proposal','draft',s,unit);assert.equal(rejected.valid,false);assert.equal(rejected.feedback.code,'unsupported_standard');assert.match(rejected.feedback.rule,/不得编造标准条款/);
 const retained={...unit,revisionOriginal:'本研究参考ISO 9241-11。'};assert.notEqual(validateWritingCandidate(body(text),'proposal','draft',s,retained).feedback?.code,'unsupported_standard');
 const withRequirement={...s,requirements:{...s.requirements,instructions:'请按 ISO 9241-11 研究'}};assert.notEqual(validateWritingCandidate(body(text),'proposal','draft',withRequirement,unit).feedback?.code,'unsupported_standard');
 const unconfirmed={...s,materials:[{id:'x',name:'未确认资料',text:'ISO 9241-11',confirmed:false}]};assert.equal(validateWritingCandidate(body(text),'proposal','draft',unconfirmed,unit).feedback.code,'unsupported_standard');
});
