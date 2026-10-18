import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createLiteratureSearch,parseLiteratureQuery} from '../backend/literature-search.mjs';

const apiKey='synthetic-aminer-signing-secret',userId='test-user-123';
const params=(extra={})=>new URLSearchParams({q:'人工智能 education',source:'aminer',...extra});
const paper=(extra={})=>({id:'507f1f77bcf86cd799439011',title:'Artificial intelligence in education',title_zh:'教育中的人工智能',doi:'https://doi.org/10.1234/EDUCATION',first_author:'Example Researcher',year:2025,venue_name:'Example Journal',n_citation_bucket:'10-20',...extra});
const response=(data=[paper()],extra={},headers={})=>new Response(JSON.stringify({code:200,success:true,data,total:42,...extra}),{headers:{'content-type':'application/json',...headers}});
const service=options=>createLiteratureSearch({aminerEnabled:true,aminerApiKey:apiKey,aminerUserId:userId,...options});
const tokenFor=(payload,header={alg:'HS256',sign_type:'SIGN'})=>{
 const content=Buffer.from(JSON.stringify(header)).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url');
 return content+'.'+createHmac('sha256','synthetic-console-issuer-secret').update(content).digest('base64url');
};

test('AMiner requires complete valid server configuration and rejects client credentials before any upstream call',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return response();};
 const unconfigured=createLiteratureSearch({aminerEnabled:true,fetchImpl});
 assert.deepEqual(unconfigured.listSources(),['crossref','europepmc']);
 assert.deepEqual(unconfigured.sourceStatus().find(row=>row.id==='aminer'),{id:'aminer',label:'AMiner',configured:false});
 assert.equal(parseLiteratureQuery(params()).source,'aminer');
 for(const config of [{},{aminerApiKey:apiKey},{aminerUserId:userId},{aminerApiKey:'bad\nsecret',aminerUserId:userId},{aminerApiKey:'bad secret',aminerUserId:userId},{aminerApiKey:'x'.repeat(501),aminerUserId:userId},{aminerApiKey:apiKey,aminerUserId:'bad user'},{aminerApiKey:apiKey,aminerUserId:'x'.repeat(101)}]){
  const search=createLiteratureSearch({aminerEnabled:true,fetchImpl,...config});
  assert.equal(search.listSources().includes('aminer'),false);
  await assert.rejects(search.search(params()),error=>error.status===503&&error.response.sources[0].status==='not_configured');
 }
 for(const extra of [{api_key:'client-secret'},{user_id:'client-user'},{page:'2'},{endpoint:'https://evil.example'}])await assert.rejects(service({fetchImpl}).search(params(extra)),{status:400});
 assert.equal(calls,0);
 const configured=service({fetchImpl}),ids=configured.listSources();ids.push('evil');assert.equal(configured.listSources().includes('evil'),false);
 assert.equal(configured.sourceStatus().find(row=>row.id==='aminer').configured,true);
});

test('AMiner stays disabled by default despite valid credentials and never joins an aggregate until explicitly enabled',async()=>{
 const time=1792382400000,token=tokenFor({user_id:'synthetic-console-user',exp:Math.floor(time/1000)+300});
 for(const setting of [{},{aminerEnabled:false},{aminerEnabled:'true'},{aminerEnabled:1}]){
  let calls=0;const search=createLiteratureSearch({aminerToken:token,aminerApiKey:apiKey,aminerUserId:userId,clock:()=>time,...setting,fetchImpl:async url=>{
   calls++;const host=new URL(url).hostname;assert.notEqual(host,'datacenter.aminer.cn');
   return host==='api.crossref.org'?new Response(JSON.stringify({message:{items:[]}}),{headers:{'content-type':'application/json'}}):new Response(JSON.stringify({resultList:{result:[]}}),{headers:{'content-type':'application/json'}});
  }});
  assert.equal(search.listSources().includes('aminer'),false);assert.equal(search.sourceStatus().find(row=>row.id==='aminer').configured,false);
  await assert.rejects(search.search(params()),error=>error.status===503&&error.response.sources[0].status==='not_configured');assert.equal(calls,0);
  const result=await search.search(params({source:'all'}));assert.equal(result.sources.some(row=>row.id==='aminer'),false);assert.equal(calls,2);
 }
});

test('AMiner uses only its fixed free GET title search with page one and a raw short-lived HS256 JWT',async()=>{
 const time=1792382400123;let request;
 const search=service({clock:()=>time,fetchImpl:async(url,options)=>{request={url:new URL(url),options};return response();}});
 const result=await search.search(params({q:'人工智能 & api_key=injected',limit:'20'}));
 assert.equal(request.url.origin,'https://datacenter.aminer.cn');assert.equal(request.url.pathname,'/gateway/open_platform/api/paper/search');
 assert.deepEqual([...request.url.searchParams.keys()],['page','size','title']);assert.equal(request.url.searchParams.get('page'),'1');assert.equal(request.url.searchParams.get('size'),'20');assert.equal(request.url.searchParams.get('title'),'人工智能 & api_key=injected');
 assert.equal(request.options.method,'GET');assert.equal(request.options.body,undefined);assert.equal(request.options.redirect,'error');assert.ok(request.options.signal);
 const token=request.options.headers.Authorization;assert.doesNotMatch(token,/^Bearer /);assert.equal(token.split('.').length,3);
 const [header,payload,signature]=token.split('.'),decode=value=>JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
 assert.deepEqual(decode(header),{alg:'HS256',sign_type:'SIGN'});assert.deepEqual(decode(payload),{user_id:userId,exp:Math.floor(time/1000)+300,timestamp:Math.floor(time/1000)});
 assert.equal(signature,createHmac('sha256',apiKey).update(header+'.'+payload).digest('base64url'));
 assert.equal(result.items[0].source,'aminer');assert.equal(result.items[0].sourceId,'507f1f77bcf86cd799439011');assert.equal(result.items[0].doi,'10.1234/education');assert.equal(result.items[0].authors,'Example Researcher');assert.equal(result.items[0].year,2025);assert.equal(result.items[0].url,'https://www.aminer.cn/pub/507f1f77bcf86cd799439011');assert.equal(result.total,42);
 for(const secret of [apiKey,userId,token])assert.equal(JSON.stringify(result).includes(secret),false);
});

test('AMiner accepts an existing private token before API-key signing without claiming issuer signature verification',async()=>{
 const time=1792382400000,token=tokenFor({user_id:'synthetic-console-user',exp:Math.floor(time/1000)+360*86400});let authorization;
 const search=service({aminerToken:token,aminerApiKey:'different-secret',aminerUserId:'different-user',clock:()=>time,fetchImpl:async(url,options)=>{authorization=options.headers.Authorization;return response();}});
 assert.equal(search.listSources().includes('aminer'),true);const result=await search.search(params());assert.equal(authorization,token);assert.doesNotMatch(authorization,/^Bearer /);assert.equal(result.items[0].source,'aminer');assert.equal(JSON.stringify(result).includes(token),false);
 const numeric=tokenFor({user_id:12345,exp:Math.floor(time/1000)+300},{alg:'HS256'}),numericSearch=createLiteratureSearch({aminerEnabled:true,aminerToken:numeric,clock:()=>time,fetchImpl:async(url,options)=>{assert.equal(options.headers.Authorization,numeric);return response();}});
 assert.equal(numericSearch.listSources().includes('aminer'),true);await numericSearch.search(params());
});

test('AMiner rejects malformed, unsupported or expired tokens without signing fallback or upstream calls',async()=>{
 const time=1792382400000,validPayload={user_id:'synthetic-console-user',exp:Math.floor(time/1000)+300};let calls=0;
 const valid=tokenFor(validPayload),invalid=[
  'not-a-jwt',' '+valid,valid+'\n',valid+'.extra','x'.repeat(10001),
  tokenFor(validPayload,{alg:'none'}),tokenFor(validPayload,{alg:'HS512'}),
  tokenFor({...validPayload,exp:Math.floor(time/1000)}),tokenFor({...validPayload,exp:Math.floor(time/1000)-1}),tokenFor({...validPayload,exp:String(validPayload.exp)}),tokenFor({...validPayload,exp:Infinity}),
  tokenFor({...validPayload,user_id:''}),tokenFor({...validPayload,user_id:'  '}),tokenFor({...validPayload,user_id:null}),tokenFor({...validPayload,user_id:{id:'private'}}),
  valid.split('.').slice(0,2).join('.')+'.'+Buffer.alloc(31).toString('base64url'),
 ];
 for(const token of invalid){
  const search=service({aminerToken:token,clock:()=>time,fetchImpl:async()=>{calls++;return response();}});assert.equal(search.listSources().includes('aminer'),false);
  await assert.rejects(search.search(params()),error=>error.status===503&&error.response.sources[0].status==='not_configured'&&!JSON.stringify(error.response).includes(token));
 }
 assert.equal(calls,0);
});

test('AMiner stops using an expired existing token and cannot reuse its cached source state',async()=>{
 let time=1792382400000,calls=0;const token=tokenFor({user_id:'synthetic-console-user',exp:Math.floor(time/1000)+1});
 const search=createLiteratureSearch({aminerEnabled:true,aminerToken:token,clock:()=>time,fetchImpl:async()=>{calls++;return response();}});await search.search(params());assert.equal(calls,1);
 time+=1001;assert.equal(search.listSources().includes('aminer'),false);assert.equal(search.sourceStatus().find(row=>row.id==='aminer').configured,false);
 await assert.rejects(search.search(params()),error=>error.status===503&&error.response.sources[0].status==='not_configured');assert.equal(calls,1);
});

test('AMiner normalizes real IDs and Chinese title fallbacks while omitting uncontracted access claims',async()=>{
 const search=service({fetchImpl:async()=>response([
  paper({id:'507F1F77BCF86CD799439011',title:'<b>Safe &amp; paper</b><script>private</script>',first_author:'A &lt;script&gt;private&lt;/script&gt; Researcher',abstract:'not contracted',fullTextUrl:'https://example.org/download',openAccess:true}),
  paper({id:'507f1f77bcf86cd799439012',title:' ',title_zh:'中文论文 &beta;',doi:null,first_author:null,year:'2024'}),
  paper({id:'https://evil.example/paper'}),paper({id:'../507f1f77bcf86cd799439011'}),paper({id:'507f1f77bcf86cd799439013',title:null,title_zh:null}),
 ])});
 const result=await search.search(params());assert.equal(result.items.length,2);
 assert.equal(result.items[0].title,'Safe & paper');assert.equal(result.items[0].authors,'A Researcher');assert.equal(result.items[0].sourceId,'507f1f77bcf86cd799439011');
 assert.equal(result.items[1].title,'中文论文 β');assert.equal(result.items[1].doi,'');assert.equal(result.items[1].year,2024);assert.equal(result.items[1].authors,'');
 for(const item of result.items)for(const field of ['abstract','fullTextUrl','openAccess','fullTextRead','text','venue_name','n_citation_bucket'])assert.equal(Object.hasOwn(item,field),false);
 assert.doesNotMatch(JSON.stringify(result),/private|evil\.example|not contracted/);
});

test('AMiner applies year bounds locally without inventing upstream filters or a filtered total',async()=>{
 let target;const search=service({fetchImpl:async url=>{target=new URL(url);return response([paper(),paper({id:'507f1f77bcf86cd799439012',year:2019}),paper({id:'507f1f77bcf86cd799439013',year:null}),paper({id:'507f1f77bcf86cd799439014',year:2027})]);}});
 const result=await search.search(params({yearFrom:'2020',yearTo:'2026'}));assert.equal(result.items.length,1);assert.equal(result.items[0].year,2025);assert.equal(result.total,undefined);assert.equal(result.sources[0].total,undefined);
 assert.deepEqual([...target.searchParams.keys()],['page','size','title']);
});

test('AMiner OA filtering is explicitly unsupported and never spends an upstream request',async()=>{
 let calls=0;const search=service({fetchImpl:async()=>{calls++;return response();}});
 const result=await search.search(params({openAccess:'true'}));assert.deepEqual(result.items,[]);assert.equal(result.sources[0].status,'unsupported_filter');assert.equal(result.partial,true);assert.equal(calls,0);
});

test('AMiner aggregate searches deduplicate DOIs and isolate JWT and OpenAlex credentials by host',async()=>{
 const requests=[];const search=service({openAlexApiKey:'synthetic-openalex-key',fetchImpl:async(url,options)=>{
  const host=new URL(url).hostname;requests.push({host,authorization:options.headers.Authorization});
  if(host==='api.crossref.org')return new Response(JSON.stringify({message:{items:[{DOI:'10.1234/education',title:['Crossref record']}]}}),{headers:{'content-type':'application/json'}});
  if(host==='www.ebi.ac.uk')return new Response(JSON.stringify({resultList:{result:[]}}),{headers:{'content-type':'application/json'}});
  if(host==='api.openalex.org')return new Response(JSON.stringify({meta:{count:0},results:[]}),{headers:{'content-type':'application/json'}});
  assert.equal(host,'datacenter.aminer.cn');return response([paper(),paper({id:'507f1f77bcf86cd799439012',doi:null})]);
 }});
 const result=await search.search(params({source:'all'}));assert.deepEqual(result.sources.map(row=>row.id),['crossref','europepmc','aminer','openalex']);assert.equal(result.items.length,2);assert.equal(result.items[0].source,'crossref');assert.equal(result.items[1].source,'aminer');assert.equal(result.total,undefined);
 assert.equal(requests.length,4);assert.match(requests.find(row=>row.host==='datacenter.aminer.cn').authorization,/^[\w-]+\.[\w-]+\.[\w-]+$/);assert.equal(requests.find(row=>row.host==='api.openalex.org').authorization,'Bearer synthetic-openalex-key');assert.ok(requests.filter(row=>['api.crossref.org','www.ebi.ac.uk'].includes(row.host)).every(row=>row.authorization===undefined));
});

test('AMiner HTTP-200 business failures are errors with bounded cooldowns and sanitized messages',async()=>{
 for(const code of [40301,40302,40306,40307,40308,50001,99999]){
  let time=1000000,calls=0;const search=service({clock:()=>time,fetchImpl:async()=>{calls++;return response([],{code,success:false,message:apiKey+' '+userId+' private diagnostics',data:{private:apiKey}});}});
  await assert.rejects(search.search(params()),error=>{assert.equal(error.status,503);assert.equal(error.response.sources[0].status,code===40306?'rate_limited':'error');assert.doesNotMatch(JSON.stringify(error.response),/synthetic-aminer|test-user|diagnostics|99999/);return true;});
  await assert.rejects(search.search(params({q:'another topic'})),{status:503});assert.equal(calls,1);
  time+=(code===40306||code===50001||code===99999?60001:300001);
  await assert.rejects(search.search(params({q:'another topic'})),{status:503});assert.equal(calls,2);
 }
});

test('AMiner business and quota failures keep successful aggregate results visible',async()=>{
 const search=service({fetchImpl:async url=>{
  const host=new URL(url).hostname;
  if(host==='api.crossref.org')return new Response(JSON.stringify({message:{items:[]}}),{headers:{'content-type':'application/json'}});
  if(host==='www.ebi.ac.uk')return new Response(JSON.stringify({resultList:{result:[{id:'123',source:'MED',title:'Remaining useful record',pubYear:'2024'}]}}),{headers:{'content-type':'application/json'}});
  return response([],{code:40306,success:false,message:'private diagnostics'});
 }});
 const result=await search.search(params({source:'all'}));assert.equal(result.partial,true);assert.equal(result.items[0].title,'Remaining useful record');assert.equal(result.sources.find(row=>row.id==='aminer').status,'rate_limited');
 const disabled=service({aminerDailyLimit:0,fetchImpl:async url=>{
  assert.notEqual(new URL(url).hostname,'datacenter.aminer.cn');
  return new URL(url).hostname==='api.crossref.org'?new Response(JSON.stringify({message:{items:[]}}),{headers:{'content-type':'application/json'}}):new Response(JSON.stringify({resultList:{result:[]}}),{headers:{'content-type':'application/json'}});
 }});
 const exhausted=await disabled.search(params({source:'all'}));assert.equal(exhausted.partial,true);assert.equal(exhausted.sources.find(row=>row.id==='aminer').status,'budget_exhausted');
});

test('AMiner HTTP errors, malformed contracts and remote exceptions never expose provider diagnostics',async()=>{
 for(const status of [401,403,429,500]){
  let calls=0;const search=service({fetchImpl:async()=>{calls++;return new Response(apiKey+' private diagnostic',{status,headers:{'retry-after':'60'}});}});
  await assert.rejects(search.search(params()),error=>error.status===503&&!JSON.stringify(error.response).includes(apiKey));
  if(status!==500){await assert.rejects(search.search(params({q:'other title'})),{status:503});assert.equal(calls,1);}
 }
 for(const value of [{code:200,success:false,data:[]},{code:200,success:true,data:{}},{code:200,success:true,data:null},{code:200,success:true,data:Array.from({length:1001},()=>paper())},{results:[paper()]}]){
  const search=service({fetchImpl:async()=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}})});await assert.rejects(search.search(params()),{status:503});
 }
 const search=service({fetchImpl:async()=>{throw Error(apiKey+' at private-provider.example');}});await assert.rejects(search.search(params()),error=>error.status===503&&!/synthetic-aminer|private-provider/.test(JSON.stringify(error.response)));
});

test('AMiner counts attempted outbound calls, uses cached and in-flight results once, and resets its UTC day budget',async()=>{
 let time=86400000+1000,calls=0,resolve;
 const search=service({aminerDailyLimit:1,clock:()=>time,fetchImpl:async()=>{calls++;return new Promise(done=>resolve=done);}});
 const first=search.search(params()),same=search.search(params());assert.equal(calls,1);resolve(response());const [a,b]=await Promise.all([first,same]);a.items[0].title='changed';assert.equal(b.items[0].title,paper().title);assert.equal((await search.search(params())).items[0].title,paper().title);assert.equal(calls,1);
 await assert.rejects(search.search(params({q:'another title'})),error=>error.status===503&&error.response.sources[0].status==='budget_exhausted');assert.equal(calls,1);
 time+=86400000;const next=search.search(params({q:'another title'}));assert.equal(calls,2);resolve(response());await next;
 const disabled=service({aminerDailyLimit:0,fetchImpl:async()=>{throw Error('must not call');}});await assert.rejects(disabled.search(params()),error=>error.response.sources[0].status==='budget_exhausted');
 let failedCalls=0;const failed=service({aminerDailyLimit:1,fetchImpl:async()=>{failedCalls++;throw Error('upstream unavailable');}});await assert.rejects(failed.search(params()),{status:503});await assert.rejects(failed.search(params({q:'another title'})),error=>error.response.sources[0].status==='budget_exhausted');assert.equal(failedCalls,1);
});

test('AMiner preserves timeout, response-size and content-type bounds',async()=>{
 const timeout=service({timeoutMs:5,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error(apiKey)),{once:true}))});await assert.rejects(timeout.search(params()),error=>error.status===503&&/超时/.test(error.response.sources[0].reason));
 for(const value of [new Response('{bad',{headers:{'content-type':'application/json'}}),new Response('',{status:302,headers:{location:'https://other.example/'}}),new Response('<html>private</html>',{headers:{'content-type':'text/html'}}),response(),response([],{},{'content-length':'99999'})]){
  const search=service({maxResponseBytes:100,fetchImpl:async()=>value});await assert.rejects(search.search(params()),{status:503});
 }
});
