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
