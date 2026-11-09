import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDeniedWritingTools} from '../backend/writing-worker.mjs';
import {classifyWritingRetry} from '../backend/writing-execution-policy.mjs';

test('denied tool diagnostics use fixed classifications and discard names and arguments',()=>{
 const error={code:'unauthorized_tool',status:502,agentTrace:[
  {status:'denied',tool:'mcp__paperknow__check_text_length',args:{text:'private-prompt'}},
  {status:'denied',tool:'mcp__foreign__private_model_secret',args:{token:'credential'}}
 ]};
 assert.deepEqual(classifyDeniedWritingTools(error),[{tool:'check_text_length',namespace:'paperknow'},{tool:'other',namespace:'external_mcp'}]);
 assert.doesNotMatch(JSON.stringify(classifyDeniedWritingTools(error)),/private|credential/);
 assert.equal(classifyWritingRetry(error).retryable,false);
});

test('missing or malformed traces cannot manufacture a known tool',()=>{
 assert.deepEqual(classifyDeniedWritingTools({agentTrace:[{status:'completed',tool:'Read'},{status:'denied',tool:'Read_private'}]}),[{tool:'other',namespace:'other'}]);
 assert.deepEqual(classifyDeniedWritingTools({}),[]);
});
