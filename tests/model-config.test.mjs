import test from 'node:test';
import assert from 'node:assert/strict';
import {environmentConfig,modelRequestLimits} from '../backend/config.mjs';
import {modelLimits} from '../backend/model-budget.mjs';

test('model request limits accept bounded settings and reject malformed or excessive overrides',()=>{
 assert.deepEqual(modelRequestLimits(),{maxTokens:2400,timeoutMs:45000});
 assert.deepEqual(modelRequestLimits({aiMaxTokens:32,aiTimeoutMs:5000}),{maxTokens:32,timeoutMs:5000});
 assert.deepEqual(modelRequestLimits({aiMaxTokens:4096,aiTimeoutMs:90000}),{maxTokens:4096,timeoutMs:90000});
 for(const aiMaxTokens of [undefined,null,0,31,4097,-1,1.5,NaN,Infinity,'64',true])assert.equal(modelRequestLimits({aiMaxTokens}).maxTokens,2400);
 for(const aiTimeoutMs of [undefined,null,0,4999,90001,-1,5000.5,NaN,Infinity,'5000',false])assert.equal(modelRequestLimits({aiTimeoutMs}).timeoutMs,45000);
});

test('environment model controls parse valid settings while malformed values fall back to safe limits',()=>{
 const valid=environmentConfig({PK_AI_MAX_TOKENS:'64',PK_AI_TIMEOUT_MS:'5000',PK_AI_USER_DAILY_LIMIT:'12',PK_AI_GLOBAL_DAILY_LIMIT:'120'});
 assert.deepEqual(modelRequestLimits(valid),{maxTokens:64,timeoutMs:5000});assert.deepEqual(modelLimits(valid),{userDailyLimit:12,globalDailyLimit:120});
 for(const env of [{},{PK_AI_MAX_TOKENS:'invalid',PK_AI_TIMEOUT_MS:'Infinity',PK_AI_USER_DAILY_LIMIT:'0',PK_AI_GLOBAL_DAILY_LIMIT:'10001'},{PK_AI_MAX_TOKENS:'',PK_AI_TIMEOUT_MS:'',PK_AI_USER_DAILY_LIMIT:'',PK_AI_GLOBAL_DAILY_LIMIT:''}]){
  const config=environmentConfig(env);assert.deepEqual(modelRequestLimits(config),{maxTokens:2400,timeoutMs:45000});assert.deepEqual(modelLimits(config),{userDailyLimit:30,globalDailyLimit:300});
 }
});
