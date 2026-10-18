import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiteratureSearch,parseLiteratureQuery} from '../backend/literature-search.mjs';
const params=(extra={})=>new URLSearchParams({q:'graph neural networks',source:'openalex',...extra});
const work=(extra={})=>({id:'https://openalex.org/W123456',title:'Graph neural networks',doi:'https://doi.org/10.1234/GRAPH',publication_year:2024,authorships:[{author:{display_name:'A Researcher'}}],abstract_inverted_index:{Graphs:[0],and:[1],biology:[2]},open_access:{is_oa:true,oa_url:'https://repository.example/paper'},best_oa_location:{is_oa:true,pdf_url:'https://repository.example/paper.pdf'},type:'article',...extra});
const response=(results=[work()],headers={})=>new Response(JSON.stringify({results,meta:{count:100}}),{headers:{'content-type':'application/json',...headers}});
test('OpenAlex is opt-in with server credentials; unconfigured direct requests never spend keyless budget',async()=>{
 let calls=0;const service=createLiteratureSearch({fetchImpl:async()=>{calls++;return response();}});
 assert.deepEqual(service.listSources(),['crossref','europepmc']);assert.deepEqual(service.sourceStatus().at(-1),{id:'openalex',label:'OpenAlex',configured:false});
 assert.equal(parseLiteratureQuery(params()).source,'openalex');
 await assert.rejects(service.search(params()),error=>error.status===503&&error.response.sources[0].status==='not_configured');assert.equal(calls,0);
 await assert.rejects(service.search(params({api_key:'client-injected-key'})),{status:400});assert.equal(calls,0);
 const sources=service.listSources();sources.push('evil');assert.equal(service.listSources().includes('evil'),false);
 for(const key of ['invalid\nsecret','invalid secret','x'.repeat(501)])assert.equal(createLiteratureSearch({openAlexApiKey:key}).listSources().includes('openalex'),false);
});
test('OpenAlex uses a fixed endpoint, Bearer authentication, bounded fields and server-owned date/OA filters',async()=>{
 let request;const key='private-test-key';const service=createLiteratureSearch({openAlexApiKey:key,fetchImpl:async(url,options)=>{request={url:new URL(url),options};return response();}});
 const result=await service.search(params({q:'graph & api_key=evil',yearFrom:'2020',yearTo:'2026',openAccess:'true',limit:'4'}));
 assert.equal(request.url.origin,'https://api.openalex.org');assert.equal(request.url.pathname,'/works');assert.equal(request.url.searchParams.get('search'),'graph & api_key=evil');assert.equal(request.url.searchParams.get('api_key'),null);assert.equal(request.url.searchParams.get('per_page'),'4');assert.equal(request.url.searchParams.get('filter'),'from_publication_date:2020-01-01,to_publication_date:2026-12-31,open_access.is_oa:true');assert.match(request.url.searchParams.get('select'),/abstract_inverted_index/);assert.doesNotMatch(request.url.searchParams.get('select'),/content_urls/);assert.equal(request.options.headers.Authorization,'Bearer '+key);assert.equal(request.options.redirect,'error');assert.equal(request.options.method,'GET');
 assert.equal(result.items[0].source,'openalex');assert.equal(result.items[0].sourceId,'W123456');assert.equal(result.items[0].doi,'10.1234/graph');assert.equal(result.items[0].url,'https://doi.org/10.1234/graph');assert.equal(result.items[0].authors,'A Researcher');assert.equal(result.items[0].year,2024);assert.equal(result.items[0].abstract,'Graphs and biology');assert.equal(result.items[0].fullTextUrl,'https://repository.example/paper.pdf');assert.equal(result.items[0].openAccess,true);assert.equal(result.total,100);assert.doesNotMatch(JSON.stringify(result),new RegExp(key));
});
test('OpenAlex handles missing DOI/abstract and sanitizes titles, authors, inverted indexes and unsafe OA links',async()=>{
 const service=createLiteratureSearch({openAlexApiKey:'test-key',fetchImpl:async()=>response([
  work({doi:null,title:'<b>Safe &amp; study</b><script>SECRET</script>',authorships:[{author:{display_name:'A &lt;script&gt;BAD&lt;/script&gt; Researcher'}}],abstract_inverted_index:{'Hello':[0],'<script>SECRET</script>':[1],'&beta;':[2],broken:[-1,1e12,'0',0.5]},best_oa_location:{is_oa:true,pdf_url:'javascript:alert(1)',landing_page_url:'http://127.0.0.1/admin'},open_access:{is_oa:true,oa_url:'https://user:pass@private.example/'}}),
  work({id:'https://evil.example/W123456'}),work({id:'https://openalex.org/W123457',title:null,display_name:'Fallback title',doi:'bad',abstract_inverted_index:null,open_access:{is_oa:false,oa_url:'https://repository.example/not-proven'},best_oa_location:{is_oa:true,pdf_url:'https://repository.example/not-proven.pdf'}}),
 ])});
 const result=await service.search(params());assert.equal(result.items.length,2);assert.equal(result.items[0].title,'Safe & study');assert.equal(result.items[0].authors,'A Researcher');assert.equal(result.items[0].abstract,'Hello β');assert.equal(result.items[0].url,'https://openalex.org/W123456');assert.equal(result.items[0].fullTextUrl,undefined);assert.equal(result.items[1].title,'Fallback title');assert.equal(result.items[1].abstract,undefined);assert.equal(result.items[1].openAccess,false);assert.equal(result.items[1].fullTextUrl,undefined);assert.doesNotMatch(JSON.stringify(result),/SECRET|BAD|javascript:|127\.0\.0\.1|user:pass/);
});
test('OpenAlex abstract reconstruction limits pathological offsets and output while preserving order',async()=>{
 const huge={};for(let i=0;i<10000;i++)huge['term'+i]=[10000-i];huge.tail=Array.from({length:10000},(_,i)=>i);
 const service=createLiteratureSearch({openAlexApiKey:'test-key',fetchImpl:async()=>response([work({abstract_inverted_index:{third:[2],first:[0],second:[1]}}),work({id:'https://openalex.org/W99',doi:null,abstract_inverted_index:huge})])});
 const result=await service.search(params());assert.equal(result.items[0].abstract,'first second third');assert.ok(!result.items[1].abstract||result.items[1].abstract.length<=3000);
});
test('OpenAlex never exposes authenticated content download endpoints as public OA links',async()=>{
 const service=createLiteratureSearch({openAlexApiKey:'test-key',fetchImpl:async()=>response([work({best_oa_location:{is_oa:true,pdf_url:'https://content.openalex.org/works/W123456.pdf'},open_access:{is_oa:true,oa_url:'https://content.openalex.org/works/W123456.pdf'},content_urls:{pdf:'https://content.openalex.org/works/W123456.pdf'}})])});
 const result=await service.search(params());assert.equal(result.items[0].fullTextUrl,undefined);assert.doesNotMatch(JSON.stringify(result),/content\.openalex\.org/);
});
test('OpenAlex filters untrusted year and OA metadata again after retrieval',async()=>{
 const service=createLiteratureSearch({openAlexApiKey:'test-key',fetchImpl:async()=>response([work(),work({id:'https://openalex.org/W2',publication_year:2019}),work({id:'https://openalex.org/W3',publication_year:null}),work({id:'https://openalex.org/W4',open_access:{is_oa:false}}),work({id:'https://openalex.org/W5',open_access:{is_oa:'true'}})])});
 const result=await service.search(params({yearFrom:'2020',yearTo:'2026',openAccess:'true'}));assert.equal(result.items.length,1);
});
test('aggregate searches retain existing providers, deduplicate DOI variants and send keys only to OpenAlex',async()=>{
 const requests=[];const service=createLiteratureSearch({openAlexApiKey:'test-key',fetchImpl:async(url,options)=>{
  const host=new URL(url).hostname;requests.push({host,authorization:options.headers.Authorization});
  if(host==='api.crossref.org')return new Response(JSON.stringify({message:{items:[{DOI:'10.1234/graph',title:['Crossref graph'],published:{'date-parts':[[2024]]}}]}}),{headers:{'content-type':'application/json'}});
  if(host==='www.ebi.ac.uk')return new Response(JSON.stringify({resultList:{result:[]}}),{headers:{'content-type':'application/json'}});
  return response([work(),work({id:'https://openalex.org/W2',doi:null})]);
 }});
 const result=await service.search(params({source:'all'}));assert.equal(result.items.length,2);assert.deepEqual(result.sources.map(value=>value.id),['crossref','europepmc','openalex']);assert.equal(result.items[0].source,'crossref');assert.equal(result.items[1].sourceId,'W2');assert.equal(result.total,undefined);assert.equal(requests.find(value=>value.host==='api.openalex.org').authorization,'Bearer test-key');assert.ok(requests.filter(value=>value.host!=='api.openalex.org').every(value=>value.authorization===undefined));
});
test('OpenAlex auth and upstream failures never echo provider bodies, credentials or remote exceptions',async()=>{
 for(const status of [401,403,500]){
  const service=createLiteratureSearch({openAlexApiKey:'private-test-key',fetchImpl:async()=>new Response('private-test-key provider diagnostics',{status})});
  await assert.rejects(service.search(params()),error=>error.status===503&&error.response.sources[0].status==='error'&&!/private-test-key|diagnostics/.test(JSON.stringify(error.response)));
 }
 const service=createLiteratureSearch({openAlexApiKey:'private-test-key',fetchImpl:async()=>{throw Error('private-test-key');}});await assert.rejects(service.search(params()),error=>error.status===503&&!/private-test-key/.test(JSON.stringify(error.response)));
});
test('OpenAlex rejected credentials cause a bounded cooldown instead of repeated quota-spending retries',async()=>{
 let time=1000000,calls=0;const service=createLiteratureSearch({openAlexApiKey:'test-key',clock:()=>time,fetchImpl:async()=>{calls++;return new Response('private',{status:403});}});
 await assert.rejects(service.search(params()),{status:503});await assert.rejects(service.search(params({q:'another topic'})),{status:503});assert.equal(calls,1);
 time+=300001;await assert.rejects(service.search(params({q:'another topic'})),{status:503});assert.equal(calls,2);
});
test('OpenAlex request budget counts outbound calls but not cache hits, resets on UTC day and can disable calls',async()=>{
 let time=86400000+1000,calls=0;const service=createLiteratureSearch({openAlexApiKey:'test-key',openAlexDailyLimit:1,clock:()=>time,fetchImpl:async()=>{calls++;return response();}});
 await service.search(params());await service.search(params());assert.equal(calls,1);
 await assert.rejects(service.search(params({q:'another topic'})),error=>error.status===503&&/今日检索额度/.test(error.response.sources[0].reason));assert.equal(calls,1);
 time+=86400000;await service.search(params({q:'another topic'}));assert.equal(calls,2);
 const disabled=createLiteratureSearch({openAlexApiKey:'test-key',openAlexDailyLimit:0,fetchImpl:async()=>{throw Error('must not call');}});await assert.rejects(disabled.search(params()),{status:503});
});
test('OpenAlex upstream depleted-budget headers pause retrieval until reset, including 429 responses',async()=>{
 for(const status of [200,429]){
  let time=86400000+1000,calls=0;const service=createLiteratureSearch({openAlexApiKey:'test-key',clock:()=>time,fetchImpl:async()=>{calls++;return status===200?response([work()],{'x-ratelimit-remaining':'0','x-ratelimit-reset':'3600'}):new Response('private',{status,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'3600','retry-after':'60'}});}});
  if(status===200)await service.search(params());else await assert.rejects(service.search(params()),{status:503});
  time+=301000;await assert.rejects(service.search(params({q:'another topic'})),{status:503});assert.equal(calls,1);
  time+=3600000;if(status===200)await service.search(params({q:'another topic'}));else await assert.rejects(service.search(params({q:'another topic'})),{status:503});assert.equal(calls,2);
 }
});
test('OpenAlex requests share in-flight/cache behavior and enforce timeout and response-size bounds',async()=>{
 let resolve,calls=0;const service=createLiteratureSearch({openAlexApiKey:'test-key',fetchImpl:async()=>{calls++;return new Promise(done=>resolve=done);}});
 const first=service.search(params()),same=service.search(params());assert.equal(calls,1);resolve(response());const [a,b]=await Promise.all([first,same]);a.items[0].title='changed';assert.equal(b.items[0].title,'Graph neural networks');assert.equal((await service.search(params())).items[0].title,'Graph neural networks');assert.equal(calls,1);
 const timeout=createLiteratureSearch({openAlexApiKey:'test-key',timeoutMs:5,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('private upstream error')),{once:true}))});await assert.rejects(timeout.search(params()),error=>error.status===503&&/超时/.test(error.response.sources[0].reason));
 const oversized=createLiteratureSearch({openAlexApiKey:'test-key',maxResponseBytes:100,fetchImpl:async()=>response()});await assert.rejects(oversized.search(params()),{status:503});
});
