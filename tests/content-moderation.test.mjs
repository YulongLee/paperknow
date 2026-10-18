import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentModeration} from '../backend/content-moderation.mjs';

const configured={moderationEnabled:true,moderationAccessKeyId:'test-moderation-id',moderationAccessKeySecret:'test-moderation-secret'};
const passing=()=>({statusCode:200,body:{Code:200,Data:{RiskLevel:'none',Result:[{Label:'nonLabel'}]},RequestId:'mock-request'}});
const risk=level=>({statusCode:200,body:{Code:200,Data:{RiskLevel:level,Result:[{Label:'not-disclosed',RiskWords:'private-original',Confidence:99}]}}});
const mock=(handler=()=>passing(),config={})=>{
 const calls=[];
 const client={async callApi(params,request,runtime){calls.push({params,request,runtime});return handler(calls.length,params,request,runtime);}};
 return {...createContentModeration({...configured,...config},{client}),calls};
};
const safeFailure=code=>error=>{
 assert.equal(error.code,code);assert.equal(error.moderationSafe,true);
 assert.match(error.message,/[\u4e00-\u9fff]/);
 assert.doesNotMatch(error.message,/private-original|test-moderation|secret|https:|RiskWords|not-disclosed|AccessKey/i);
 assert.equal(error.cause,undefined);return true;
};

test('moderation requires explicitly enabled dedicated credentials and a whitelisted endpoint',async()=>{
 for(const config of [{},{moderationEnabled:true},{...configured,moderationEnabled:false},{...configured,moderationEnabled:'1'},{moderationEnabled:true,aiKey:'model-secret',smsAccessKeyId:'sms-id-1234',smsAccessKeySecret:'sms-secret-1234'},{...configured,moderationEndpoint:'http://green-cip.cn-shanghai.aliyuncs.com'},{...configured,moderationEndpoint:'green-cip.cn-shanghai.aliyuncs.com.attacker.test'},{...configured,moderationEndpoint:'https://green-cip.cn-shanghai.aliyuncs.com/'},{...configured,moderationEndpoint:'green-cip.cn-shanghai.aliyuncs.com:443'},{...configured,moderationRegion:'cn-beijing'},{...configured,moderationAccessKeySecret:'contains space'},{...configured,moderationMaxCalls:0},{...configured,moderationMaxCalls:101},{...configured,moderationMaxCharacters:Infinity}]){
  const moderation=createContentModeration(config,{client:{callApi(){assert.fail('must not call provider');}}});
  assert.equal(moderation.ready,false);await assert.rejects(moderation.checkText('测试内容'),safeFailure('moderation_not_configured'));
 }
 assert.equal(createContentModeration(configured).ready,true);
 for(const region of ['shanghai','beijing','hangzhou','shenzhen','chengdu']){
  const moderation=mock(undefined,{moderationEndpoint:`https://green-cip.cn-${region}.aliyuncs.com`,moderationRegion:`cn-${region}`});
  assert.equal(moderation.ready,true);assert.deepEqual(await moderation.checkText('测试内容'),{allowed:true});
 }
});

test('uses correct RPC and separate input/output services without leaking public diagnostics',async()=>{
 const moderation=mock();
 assert.deepEqual(await moderation.checkText('正常输入'),{allowed:true});
 assert.deepEqual(await moderation.checkText('正常输出',{kind:'output'}),{allowed:true});
 const first=moderation.calls[0];
 assert.equal(first.params.action,'TextModerationPlus');assert.equal(first.params.version,'2022-03-02');assert.equal(first.params.style,'RPC');assert.equal(first.params.method,'POST');assert.equal(first.params.pathname,'/');assert.equal(first.params.protocol,'HTTPS');assert.equal(first.params.reqBodyType,'formData');
 assert.equal(first.request.body.Service,'llm_query_moderation');assert.equal(moderation.calls[1].request.body.Service,'llm_response_moderation');
 const parameters=JSON.parse(first.request.body.ServiceParameters);assert.equal(parameters.content,'正常输入');assert.match(parameters.dataId,/^pk-[a-f0-9-]{36}$/);
 assert.equal(parameters.accountId,undefined);assert.equal(parameters.sessionId,undefined);
 assert.equal(first.runtime.autoretry,false);assert.equal(first.runtime.maxAttempts,1);assert.equal(first.runtime.ignoreSSL,false);
});

test('only the official explicit passing structure can pass',async()=>{
 const unknown=[null,{},passing().body,{statusCode:200,body:{Code:'200',Data:passing().body.Data}},{statusCode:201,body:passing().body},{statusCode:200,body:{Code:200,Data:{}}},{statusCode:200,body:{Code:200,Data:{RiskLevel:'pass',Result:[{Label:'nonLabel'}]}}},{statusCode:200,body:{Code:200,Data:{RiskLevel:'none',Result:[]}}},{statusCode:200,body:{Code:200,Data:{RiskLevel:'none',Result:[{}]}}},{statusCode:200,body:{Code:200,Data:{RiskLevel:'none',Result:[{Label:'nonLabel'},{Label:'private-risk'}]}}},{statusCode:200,body:{code:200,data:{riskLevel:'none',result:[{label:'nonLabel'}]}}},{statusCode:200,body:{Code:200,Data:{Suggestion:'pass'}}}];
 for(const response of unknown)await assert.rejects(mock(()=>response).checkText('正常内容'),safeFailure('moderation_unavailable'));
 for(const level of ['low','medium','high'])assert.deepEqual(await mock(()=>risk(level)).checkText('待处理内容'),{allowed:false,code:'content_rejected'});
 const advice=passing();advice.body.Data.Advice=[{Answer:'private-original'}];assert.deepEqual(await mock(()=>advice).checkText('待处理内容'),{allowed:false,code:'content_rejected'});
 const emptyAdvice=passing();emptyAdvice.body.Data.Advice=[];assert.deepEqual(await mock(()=>emptyAdvice).checkText('待处理内容'),{allowed:true});
});

test('provider HTTP/business/auth/throttling failures never pass or leak the raw error',async()=>{
 for(const response of [{statusCode:403,body:{Code:200,Data:passing().body.Data}},{statusCode:200,body:{Code:408,Message:'AccessKey test-moderation-secret',Data:passing().body.Data}},{statusCode:429,body:{Message:'private-original'}}])await assert.rejects(mock(()=>response).checkText('测试'),safeFailure('moderation_unavailable'));
 const moderation=mock(()=>{throw Object.assign(new Error('test-moderation-secret private-original https://internal.invalid'),{code:'AccessKeyDenied',data:{RiskWords:'private-original'}});});
 await assert.rejects(moderation.checkText('测试'),safeFailure('moderation_unavailable'));assert.equal(moderation.calls.length,1);
});

test('Unicode chunking preserves astral characters and checks all input and output parts',async()=>{
 for(const [kind,limit]of [['input',2000],['output',5000]]){
  const text='甲'.repeat(limit-1)+'😀'+'乙'.repeat(limit+100),moderation=mock();
  assert.deepEqual(await moderation.checkText(text,{kind}),{allowed:true});
  const contents=moderation.calls.map(call=>JSON.parse(call.request.body.ServiceParameters).content);
  assert.equal(contents.length,3);assert.equal(Array.from(contents[0]).length,limit);assert.ok(contents[0].endsWith('😀'));
  for(const content of contents){assert.ok(Array.from(content).length<=limit);assert.equal(content.isWellFormed(),true);}
  assert.equal(contents.join(''),text);
 }
});

test('a rejection in any later part short circuits without checking or publishing further text',async()=>{
 const moderation=mock(n=>n===2?risk('medium'):passing());
 assert.deepEqual(await moderation.checkText('甲'.repeat(7000)),{allowed:false,code:'content_rejected'});
 assert.equal(moderation.calls.length,2);
 const failed=mock(n=>n===2?{statusCode:200,body:{Code:500}}:passing());
 await assert.rejects(failed.checkText('甲'.repeat(7000)),safeFailure('moderation_unavailable'));assert.equal(failed.calls.length,2);
});

test('invalid text, UTF surrogates and kinds do not create provider calls',async()=>{
 const moderation=mock();
 for(const text of [null,undefined,{},42,'','  \n\t','a\u0000b','\ud800','\udc00','a\ud800b'])await assert.rejects(moderation.checkText(text),safeFailure('moderation_input_invalid'));
 await assert.rejects(moderation.checkText('正文',{kind:'unexpected'}),safeFailure('moderation_input_invalid'));
 await assert.rejects(moderation.checkText('正文',{signal:{}}),safeFailure('moderation_input_invalid'));
 for(const options of [null,[],true,'input'])await assert.rejects(moderation.checkText('正文',options),safeFailure('moderation_input_invalid'));
 assert.equal(moderation.calls.length,0);
});

test('preflights full length and call-count budgets before any paid request',async()=>{
 const length=mock(undefined,{moderationMaxCharacters:10});
 await assert.rejects(length.checkText('😀'.repeat(11)),safeFailure('moderation_limit'));assert.equal(length.calls.length,0);
 const calls=mock(undefined,{moderationMaxCalls:1});
 await assert.rejects(calls.checkText('甲'.repeat(2001)),safeFailure('moderation_limit'));assert.equal(calls.calls.length,0);
 assert.deepEqual(await calls.checkText('甲'.repeat(2000)),{allowed:true});
});

test('the full 200000-code-point research budget is checked in 100 input or 40 output calls',async()=>{
 const text='😀'.repeat(200000);
 for(const [kind,maximum]of [['input',100],['output',40]]){
  const moderation=mock();assert.deepEqual(await moderation.checkText(text,{kind}),{allowed:true});
  assert.equal(moderation.calls.length,maximum);
  assert.equal(moderation.calls.map(call=>JSON.parse(call.request.body.ServiceParameters).content).join(''),text);
 }
 const moderation=mock();await assert.rejects(moderation.checkText(text+'甲'),safeFailure('moderation_limit'));assert.equal(moderation.calls.length,0);
});

test('timeout is fail closed, is not retried and keeps the outstanding SDK slot bounded',async()=>{
 let settle;const moderation=mock(n=>n===1?new Promise(resolve=>{settle=resolve;}):passing(),{moderationTimeoutMs:10,moderationMaxConcurrent:1});
 await assert.rejects(moderation.checkText('正文'),safeFailure('moderation_timeout'));
 await assert.rejects(moderation.checkText('另一份正文'),safeFailure('moderation_busy'));assert.equal(moderation.calls.length,1);
 settle(passing());await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(await moderation.checkText('恢复后的正文'),{allowed:true});assert.equal(moderation.calls.length,2);
});

test('an already aborted request never reaches the provider',async()=>{
 const controller=new AbortController();controller.abort(new Error('private-original'));
 const moderation=mock();await assert.rejects(moderation.checkText('正文',{signal:controller.signal}),safeFailure('moderation_cancelled'));assert.equal(moderation.calls.length,0);
});

test('cancellation stops waiting and never submits a later part; late provider result is discarded',async()=>{
 let settle,started;const entered=new Promise(resolve=>{started=resolve;}),controller=new AbortController();
 const moderation=mock(()=>{started();return new Promise(resolve=>{settle=resolve;});},{moderationMaxConcurrent:1});
 const pending=moderation.checkText('甲'.repeat(5000),{signal:controller.signal});await entered;controller.abort();
 await assert.rejects(pending,safeFailure('moderation_cancelled'));
 await assert.rejects(moderation.checkText('其他正文'),safeFailure('moderation_busy'));
 settle(passing());await new Promise(resolve=>setImmediate(resolve));assert.equal(moderation.calls.length,1);
});

test('whole-operation deadline bounds a sequence of individually successful calls',async()=>{
 const moderation=mock(()=>new Promise(resolve=>setTimeout(()=>resolve(passing()),15)),{moderationTimeoutMs:100,moderationTotalTimeoutMs:25});
 await assert.rejects(moderation.checkText('甲'.repeat(6000)),safeFailure('moderation_timeout'));
 assert.ok(moderation.calls.length<=2);
 await new Promise(resolve=>setTimeout(resolve,20));
});
