import test from 'node:test';
import assert from 'node:assert/strict';
import {submitDocumentTranslation} from '../dist/workspace/document-translation-submit.mjs';
const input={fileId:'file',sourceLanguage:'en',targetLanguage:'zh',expectedUserId:'owner',consent:true,idempotencyKey:'once'};
test('a single translation action obtains a bound price then submits once; cached results need no new submit',async()=>{
 const calls=[],request=async(path,body)=>{calls.push({path,body});return path.endsWith('/quote')?{token:'bound-price'}:{id:'job'};};assert.equal((await submitDocumentTranslation(request,input)).id,'job');assert.deepEqual(calls.map(c=>c.path),['/document-translations/quote','/document-translations']);assert.equal(calls[1].body.billingToken,'bound-price');
 const cached=[];assert.deepEqual(await submitDocumentTranslation(async path=>{cached.push(path);return{existingJobId:'old'};},input),{id:'old',reused:true});assert.deepEqual(cached,['/document-translations/quote']);
});
test('insufficient credits stops before provider submit and preserves the specific error',async()=>{
 let count=0;await assert.rejects(submitDocumentTranslation(async()=>{count++;throw Object.assign(Error('可用积分不足，请充值或选择有效权益'),{status:402});},input),{status:402});assert.equal(count,1);await assert.rejects(submitDocumentTranslation(async()=>({}),input),/计费信息未取得/);
});
