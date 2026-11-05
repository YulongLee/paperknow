import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWebSimilarityAdvice,verifiedAdviceInputs} from '../backend/web-similarity-advice.mjs';

const config={webSimilarityAdviceEnabled:true,aiEnabled:true,aiKey:'synthetic-test-key',aiModel:'qwen-flash',aiURL:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'};
const text='这一段是专门用于合成测试的研究文本内容，应当保留引用和研究事实。';
function report(n=1){return {sources:[{id:'src-1',text}],sections:[{included:true,paragraphs:Array.from({length:n},(_,i)=>({id:'p-'+i,text,matches:[{paragraphId:'p-'+i,sourceId:'src-1',range:[0,Array.from(text).length],sourceRange:[0,Array.from(text).length]}]}))}]};}
const response=items=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items})}}]}),{headers:{'content-type':'application/json'}});

test('only verified real text matches are eligible, limited to five paragraphs without transmitting source text',async()=>{
 const r=report(7),before=JSON.stringify(r),calls=[];
 const advice=await generateWebSimilarityAdvice(r,config,{fetchImpl:async(url,options)=>{calls.push({url,...options});return response([{paragraphId:'p-0',advice:'核对引用，并结合研究背景重新组织这一段。'},{paragraphId:'p-6',advice:'不能越界。'}]);}});
 assert.deepEqual(advice,[{paragraphId:'p-0',advice:'核对引用，并结合研究背景重新组织这一段。'}]);assert.equal(calls.length,1);
 const body=JSON.parse(calls[0].body),payload=JSON.parse(body.messages[1].content);assert.equal(payload.paragraphs.length,5);assert.equal(body.max_tokens,700);assert.equal(body.enable_thinking,false);assert.equal(JSON.stringify(r),before);
 assert.match(body.messages[0].content,/核对匹配来源的归属与规范引用/);assert.match(body.messages[0].content,/结合自己的研究独立概括/);assert.match(body.messages[0].content,/保留现有专业术语、模型名称及其大小写/);assert.match(body.messages[0].content,/不要建议随意替换专业术语/);
 assert.deepEqual(verifiedAdviceInputs({...r,sources:[{id:'src-1',text:'完全不相同的材料'}]}),[]);
 assert.deepEqual(verifiedAdviceInputs({...r,sections:[{included:false,paragraphs:r.sections[0].paragraphs}]}),[]);
});

test('invalid output, disabled settings and unavailable provider degrade to no advice',async()=>{
 let calls=0;const never=async()=>{calls++;throw Error('private key must never leak');};
 assert.deepEqual(await generateWebSimilarityAdvice(report(),{...config,webSimilarityAdviceEnabled:false},{fetchImpl:never}),[]);
 assert.deepEqual(await generateWebSimilarityAdvice(report(),{...config,aiURL:'https://attacker.invalid/compatible-mode/v1/chat/completions'},{fetchImpl:never}),[]);assert.equal(calls,0);
 assert.deepEqual(await generateWebSimilarityAdvice(report(),config,{fetchImpl:never}),[]);
 assert.deepEqual(await generateWebSimilarityAdvice(report(),config,{fetchImpl:async()=>new Response('not json')}),[]);
 assert.deepEqual(await generateWebSimilarityAdvice(report(),config,{fetchImpl:async()=>response([{paragraphId:'p-0',advice:'<script>恶意</script>'},{paragraphId:'p-0',advice:'来源 https://example.com'}])}),[]);
 const cancelled=new AbortController();cancelled.abort();assert.deepEqual(await generateWebSimilarityAdvice(report(),config,{signal:cancelled.signal,fetchImpl:never}),[]);
});

test('matching range is in excerpt codepoints and correctly represents a truncated long match',()=>{
 const long='🙂'+('研究'.repeat(400));const r={sources:[{id:'src',text:long}],sections:[{included:true,paragraphs:[{id:'p-1',text:long,matches:[{paragraphId:'p-1',sourceId:'src',range:[1,700],sourceRange:[1,700]}]}]}]};
 const [item]=verifiedAdviceInputs(r);assert.equal(Array.from(item.excerpt).length,320);assert.deepEqual(item.matchedRange,[1,320]);assert.equal(item.matchTruncated,true);
 assert.equal(Array.from(item.excerpt).slice(...item.matchedRange).join(''),Array.from(long).slice(1,320).join(''));
});

test('when possible, bounded excerpt starts and ends at natural sentence boundaries',()=>{
 const prefix='前文说明。'+'上下文'.repeat(12)+'。';const matched='测试研究内容'.repeat(12)+'。';const tail=('其他说明'.repeat(18)+'。').repeat(8);const content=prefix+matched+tail;
 const start=Array.from(prefix).length,end=start+Array.from(matched).length;
 const r={sources:[{id:'src',text:content}],sections:[{included:true,paragraphs:[{id:'p-1',text:content,matches:[{paragraphId:'p-1',sourceId:'src',range:[start,end],sourceRange:[start,end]}]}]}]};
 const [item]=verifiedAdviceInputs(r);assert.equal(item.excerpt.startsWith(matched),true);assert.equal(item.excerpt.endsWith('。'),true);assert.ok(Array.from(item.excerpt).length<=320);assert.deepEqual(item.matchedRange,[0,Array.from(matched).length]);assert.equal(item.matchTruncated,false);
});

test('suppress invented truncation advice while preserving relevant citation guidance',async()=>{
 let system='';const result=await generateWebSimilarityAdvice(report(3),config,{fetchImpl:async(url,options)=>{system=JSON.parse(options.body).messages[0].content;return response([{paragraphId:'p-0',advice:'句末似乎被截断，请补全后续内容。'},{paragraphId:'p-1',advice:'请核对引用并补充真实文献来源。'},{paragraphId:'p-2',advice:'请核验模型对数据截断阈值的描述。'}]);}});
 assert.deepEqual(result,[{paragraphId:'p-1',advice:'请核对引用并补充真实文献来源。'},{paragraphId:'p-2',advice:'请核验模型对数据截断阈值的描述。'}]);assert.match(system,/局部摘录/);assert.match(system,/不要据此判断论文句子不完整/);
});

test('model prose cannot invent specific sources, author attributions, years, DOI or citation numbers',async()=>{
 const rows=[
  {paragraphId:'p-0',advice:'请引用 BERT 原始论文（Devlin et al., 2019）。'},
  {paragraphId:'p-1',advice:'该方法最早在２０２０年提出。'},
  {paragraphId:'p-2',advice:'请引用 DOI 10.1234/example。'},
  {paragraphId:'p-3',advice:'请添加参考文献 [1–3]。'},
  {paragraphId:'p-4',advice:'请核对对应来源与引用格式，并结合本研究独立概括。'}
 ];
 let prompt='';const result=await generateWebSimilarityAdvice(report(5),config,{fetchImpl:async(url,options)=>{prompt=JSON.parse(options.body).messages[0].content;return response(rows);}});
 assert.deepEqual(result,[rows[4]]);assert.match(prompt,/绝对不要猜测、补充或重复任何具体文献、作者姓名、年份、参考文献编号、DOI 或网址/);
 for(const advice of ['请参考文献编号 12。','请核对张三等人的原文。','请查阅《具体论文标题》。']){
  const actual=await generateWebSimilarityAdvice(report(),config,{fetchImpl:async()=>response([{paragraphId:'p-0',advice}])});assert.deepEqual(actual,[]);
 }
});

test('only official workspace hosts in known regions accept matching workspace and canonicalize their path',async()=>{
 let count=0,request;
 const fetchImpl=async(url,options)=>{count++;request={url,options};return response([{paragraphId:'p-0',advice:'请核对引用。'}]);};
 const workspace={...config,aiURL:'https://ws-abc.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',aiWorkspaceId:'ws-abc'};
 assert.equal((await generateWebSimilarityAdvice(report(),workspace,{fetchImpl})).length,1);
 assert.equal(request.url,'https://ws-abc.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');assert.equal(request.options.headers['X-DashScope-WorkSpace'],undefined);
 for(const changes of [{aiWorkspaceId:'ws-other'},{aiURL:'https://ws-abc.fake.maas.aliyuncs.com/compatible-mode/v1'},{aiURL:'https://ws-abc.cn-beijing.maas.aliyuncs.com.evil.example/compatible-mode/v1'}])assert.deepEqual(await generateWebSimilarityAdvice(report(),{...workspace,...changes},{fetchImpl}),[]);
 assert.equal(count,1);
});

test('actual advice input and output pass moderation, with failures returning no advice',async()=>{
 const checks=[];let calls=0,blocked='';const moderation={ready:true,async checkText(value,{kind}){checks.push({value,kind});return{allowed:kind!==blocked};}};
 const fetchImpl=async()=>{calls++;return response([{paragraphId:'p-0',advice:'请核对引用。'}]);};
 const cfg={...config,moderationEnabled:true,moderation};
 assert.equal((await generateWebSimilarityAdvice(report(),cfg,{fetchImpl})).length,1);assert.deepEqual(checks.map(c=>c.kind),['input','output']);assert.match(checks[0].value,/matchedRange/);
 checks.length=0;blocked='input';const noInput=await generateWebSimilarityAdvice(report(),cfg,{fetchImpl});assert.deepEqual(noInput,[]);assert.equal(noInput.usage,undefined);assert.equal(calls,1);
 blocked='output';const noOutput=await generateWebSimilarityAdvice(report(),cfg,{fetchImpl});assert.deepEqual(noOutput,[]);assert.equal(noOutput.usage.attempted,true);assert.equal(calls,2);
});

test('attempted failed request records unknown usage while disabled requests do not',async()=>{
 const result=await generateWebSimilarityAdvice(report(),config,{fetchImpl:async()=>{throw Error('timeout');}});
 assert.deepEqual(result,[]);assert.deepEqual(result.usage,{attempted:true,model:'qwen-flash',inputTokens:null,outputTokens:null});
 assert.equal((await generateWebSimilarityAdvice(report(),{...config,webSimilarityAdviceEnabled:false})).usage,undefined);
});
