import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeWritingSnapshot,writingPlan,writingTask,parseWritingOutput} from '../backend/writing-model.mjs';
import {assessWritingDelivery} from '../dist/workspace/writing-delivery.mjs';

test('practice guidance distinguishes simulated future plans but keeps actual evidence gaps in the candidate and final gate',()=>{
 const snapshot=normalizeWritingSnapshot({title:'纸面模拟实践',profile:{targetWords:200},requirements:{instructions:'必须提供真实用户评估结果。'},materials:[{id:'m',name:'模拟资料',confirmed:true,text:'本次案例为模拟演示，没有真实用户测试，后续验证仍需实际记录。'}],references:[],outline:[{id:'s',title:'实践结果',targetWords:200}]}),unit=writingPlan(snapshot,'draft')[0],task=writingTask('practice','draft',snapshot,unit);
 assert.match(task.instructions,/不要附加要求现在补交真实用户评估/);assert.match(task.instructions,/不能删除实质缺项/);
 const text='模拟纸面分析。'.repeat(25)+'未经用户测试【待补充：真实用户评估】[source:m]',candidate={text:JSON.stringify({complete:true,text,source_ids:['m'],missing_evidence:[]}),trace:[{tool:'read_material',status:'completed',materialId:'m'}]},parsed=parseWritingOutput(candidate,'practice','draft',snapshot,unit);
 assert.match(parsed.text,/【待补充：真实用户评估】/);const check=assessWritingDelivery({kind:'practice',text:parsed.text,snapshot,quality:{consistency:{findings:[]},reviews:[]}});assert.equal(check.ready,false);assert.ok(check.issues.some(issue=>issue.material));
});
