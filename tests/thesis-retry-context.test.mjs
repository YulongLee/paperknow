import test from 'node:test';
import assert from 'node:assert/strict';
import {withThesisRetryCandidate,safeThesisValidation} from '../backend/thesis-retry-context.mjs';
test('private recovery context preserves original permissions and sources, remains bounded, and never promotes the rejected candidate',()=>{
 const task={instructions:'Original rules.',context:{revision:{originalObjects:[{id:'obj-original'}]},unit:{id:'u1'}},materials:[{id:'m1',text:'authorized'}]},candidate={text:'Rejected private body',source_ids:['unknown'],complete:true};
 const next=withThesisRetryCandidate(task,candidate);assert.deepEqual(next.materials,task.materials);assert.deepEqual(next.context.revision,task.context.revision);assert.equal(task.context.retryCandidate,undefined);assert.notEqual(next.context.retryCandidate,candidate);assert.match(next.instructions,/重新提交完整 candidate/);assert.match(next.instructions,/不是已通过的正文/);
 const longRules={...task,instructions:'x'.repeat(11999)};assert.equal(withThesisRetryCandidate(longRules,candidate),longRules);
 assert.equal(withThesisRetryCandidate(task,{text:'x'.repeat(24001)}),task);const large={...task,context:{...task.context,padding:'x'.repeat(38980)}};assert.equal(withThesisRetryCandidate(large,candidate),large);
 assert.deepEqual(safeThesisValidation({code:'incomplete',count:5,secret:'private',text:'body'}),{code:'incomplete',count:5});assert.equal(safeThesisValidation({code:'invalid code\nprivate'}),null);
 assert.deepEqual(safeThesisValidation({code:'invalid_tool_output',rule:'private paragraph',revision:{code:'revision_protection',paragraphIndex:2,original:'secret',issues:[{code:'protected_spans_changed',text:'private'},{code:'secret-content'}]}}),{code:'invalid_tool_output',revision:{code:'revision_protection',paragraphIndex:2,issues:[{code:'protected_spans_changed'}]}});
 assert.deepEqual(safeThesisValidation({code:'invalid_tool_output',revision:{code:'arbitrary_secret',paragraphIndex:1}}),{code:'invalid_tool_output'});
});
