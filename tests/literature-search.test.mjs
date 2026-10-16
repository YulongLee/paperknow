import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createLiteratureSearch,parseLiteratureQuery} from '../backend/literature-search.mjs';
import {createAPI} from '../backend/api.mjs';
import {database} from '../backend/database.mjs';
const params=(extra={})=>new URLSearchParams({q:'graph neural networks',...extra});
const cr=(extra={})=>({DOI:'10.1234/graph',title:['Graph neural networks'],author:[{given:'A',family:'Researcher'}],published:{'date-parts':[[2024,1,1]]},type:'journal-article',...extra});
const ep=(extra={})=>({id:'1234',source:'MED',title:'Graph neural networks in biology',authorString:'Researcher B',pubYear:'2025',doi:'10.1234/biology',isOpenAccess:'Y',pmcid:'PMC1234',pubTypeList:{pubType:['Journal Article']},...extra});
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const crResponse=(items=[cr()],total=42)=>json({message:{items,'total-results':total}});
const epResponse=(result=[ep()],hitCount=34)=>json({resultList:{result},hitCount});
test('query validation bounds every parameter before any provider call',async()=>{
 let calls=0;const service=createLiteratureSearch({fetchImpl:async()=>{calls++;return crResponse();}});
 for(const p of [params({q:'a'}),params({q:'x'.repeat(201)}),params({q:'hello\nworld'}),params({q:'!!'}),params({source:'http://127.0.0.1'}),params({yearFrom:'2025',yearTo:'2024'}),params({yearFrom:'999'}),params({openAccess:'yes'}),params({limit:'1000'}),params({limit:'1.2'}),params({url:'https://evil.test'})])await assert.rejects(service.search(p),{status:400});
 const duplicate=params();duplicate.append('q','second');await assert.rejects(service.search(duplicate),{status:400});assert.equal(calls,0);
 assert.deepEqual(parseLiteratureQuery(params()),{q:'graph neural networks',source:'all',yearFrom:null,yearTo:null,openAccess:false,limit:10});
});
test('Crossref uses only its fixed host, normalizes real identifiers and strips markup without claiming OA or full text',async()=>{
 let request;const service=createLiteratureSearch({fetchImpl:async(url,options)=>{request={url:new URL(url),options};return crResponse([cr({DOI:'10.1234/ABC?x=value',title:['<jats:title>Graph &amp; networks</jats:title>'],author:[{given:'A &lt;script&gt;bad&lt;/script&gt;',family:'Researcher'}],abstract:'<jats:p>A &lt;b&gt;real&lt;/b&gt; abstract &amp; result.</jats:p><script>SECRET</script>',license:[{URL:'https://creativecommons.org/licenses/by/4.0/'}],link:[{URL:'javascript:alert(1)'}]}),cr({DOI:'10.1234/<invalid>'})]);}});
 const result=await service.search(params({source:'crossref',yearFrom:'2020',yearTo:'2026'}));assert.equal(request.url.origin,'https://api.crossref.org');assert.equal(request.url.pathname,'/works');assert.equal(request.url.searchParams.get('filter'),'from-pub-date:2020-01-01,until-pub-date:2026-12-31');assert.equal(request.options.redirect,'error');assert.equal(request.options.method,'GET');assert.ok(request.options.signal);
 const item=result.items[0];assert.equal(result.items.length,1,'malformed DOI is omitted rather than rewritten into a different identifier');assert.equal(item.title,'Graph & networks');assert.equal(item.authors,'A Researcher');assert.equal(item.abstract,'A real abstract & result.');assert.doesNotMatch(JSON.stringify(result),/SECRET|javascript:/);assert.equal(item.doi,'10.1234/abc?x=value');assert.equal(item.url,'https://doi.org/10.1234/abc%3Fx%3Dvalue');assert.equal(item.openAccess,undefined);assert.equal(item.fullTextUrl,undefined);assert.equal(result.total,42);assert.equal(result.partial,false);
});
test('Europe PMC queries literal terms and applies dates/OA while linking only verified PMC access metadata',async()=>{
 let target;const service=createLiteratureSearch({fetchImpl:async url=>{target=new URL(url);return epResponse([ep({title:'<i>Biology</i> &amp; graphs',abstractText:'<p>Data &beta; &#x3B1;</p>'}),ep({id:'9',isOpenAccess:'N'}),ep({id:'10',pubYear:'2019'}),ep({id:'11',doi:'10.1234/different',pmcid:'javascript:evil'})]);}});
 const result=await service.search(params({source:'europepmc',q:'graph OR OPEN_ACCESS:N',yearFrom:'2020',yearTo:'2026',openAccess:'true'}));
 assert.equal(target.origin,'https://www.ebi.ac.uk');assert.equal(target.searchParams.get('query'),'"graph" AND "OR" AND "OPEN_ACCESS:N" AND FIRST_PDATE:[2020-01-01 TO 2026-12-31] AND OPEN_ACCESS:Y');assert.equal(target.searchParams.get('resultType'),'core');assert.equal(result.items.length,2);assert.equal(result.items[0].fullTextUrl,'https://europepmc.org/articles/PMC1234');assert.equal(result.items[0].url,'https://europepmc.org/article/MED/1234');assert.equal(result.items[0].abstract,'Data β α');assert.equal(result.items[1].fullTextUrl,undefined);assert.equal(result.items[0].sourceId,'MED:1234');
});
test('aggregate search deduplicates DOIs and bounds results without inventing a global total or metadata provenance',async()=>{
 const service=createLiteratureSearch({fetchImpl:async url=>new URL(url).hostname==='api.crossref.org'?crResponse([cr(),cr({DOI:'10.1234/second'})]):epResponse([ep({doi:'10.1234/GRAPH'}),ep({id:'other',doi:'10.1234/third'})])});
 const result=await service.search(params({limit:'3'}));assert.equal(result.items.length,3);assert.equal(new Set(result.items.map(item=>item.doi)).size,3);assert.equal(result.items[0].source,'crossref');assert.equal(result.items[0].openAccess,undefined);assert.equal(result.total,undefined);assert.ok(result.sources.every(source=>source.status==='ok'));
});
test('OA filtering honestly excludes unsupported Crossref rather than treating deposited licences as access proof',async()=>{
 const calls=[];const service=createLiteratureSearch({fetchImpl:async url=>{calls.push(new URL(url).hostname);return epResponse();}});
 const result=await service.search(params({openAccess:'true'}));assert.deepEqual(calls,['www.ebi.ac.uk']);assert.equal(result.sources[0].status,'unsupported_filter');assert.equal(result.partial,true);assert.equal(result.items[0].openAccess,true);await service.search(params({openAccess:'true'}));assert.equal(calls.length,1,'stable unsupported-filter results still cache');
 const only=await service.search(params({source:'crossref',openAccess:'true'}));assert.equal(only.items.length,0);assert.equal(only.sources[0].status,'unsupported_filter');
});
test('provider failures return visible partial results or explicit 503 and never reflect remote exceptions/secrets',async()=>{
 const service=createLiteratureSearch({fetchImpl:async url=>{if(new URL(url).hostname==='api.crossref.org')throw Error('secret-private-key at https://evil.test');return epResponse();}});
 const result=await service.search(params());assert.equal(result.partial,true);assert.equal(result.items.length,1);assert.equal(result.sources[0].status,'error');assert.doesNotMatch(JSON.stringify(result),/secret-private|evil.test/);
 await assert.rejects(service.search(params({source:'crossref'})),error=>{assert.equal(error.status,503);assert.equal(error.response.sources[0].status,'error');assert.doesNotMatch(JSON.stringify(error.response),/secret-private|evil.test/);return true;});
});
test('timeouts, malformed JSON, redirects and oversized provider bodies fail boundedly',async()=>{
 const timeout=createLiteratureSearch({timeoutMs:10,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))});await assert.rejects(timeout.search(params({source:'crossref'})),error=>error.status===503&&/超时/.test(error.response.sources[0].reason));
 for(const response of [new Response('{bad',{headers:{'content-type':'application/json'}}),new Response('',{status:302,headers:{location:'http://127.0.0.1/'}}),new Response('<xml/>',{headers:{'content-type':'text/xml'}}),new Response('x'.repeat(200),{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'99999'}})]){const service=createLiteratureSearch({maxResponseBytes:100,fetchImpl:async()=>response});await assert.rejects(service.search(params({source:'crossref'})),{status:503});}
});
test('in-flight requests deduplicate, one request per provider is enforced and cache returns isolated copies',async()=>{
 let resolve,calls=0;const service=createLiteratureSearch({fetchImpl:async()=>{calls++;return new Promise(r=>resolve=r);}}),first=service.search(params({source:'crossref'}),{clientKey:'a'}),same=service.search(params({source:'crossref'}),{clientKey:'b'});
 await assert.rejects(service.search(params({source:'crossref',q:'different public title'}),{clientKey:'c'}),{status:503});assert.equal(calls,1);resolve(crResponse());const [a,b]=await Promise.all([first,same]);a.items[0].title='mutated';assert.equal(b.items[0].title,'Graph neural networks');assert.equal((await service.search(params({source:'crossref'}))).items[0].title,'Graph neural networks');assert.equal(calls,1);
});
test('cache expires and evicts boundedly; client rate limits apply even to cached requests',async()=>{
 let time=100000,calls=0;const service=createLiteratureSearch({clock:()=>time,clientLimit:3,cacheTtlMs:100,maxCacheEntries:1,fetchImpl:async()=>{calls++;return crResponse();}});
 await service.search(params({source:'crossref'}),{clientKey:'a'});await service.search(params({source:'crossref'}),{clientKey:'a'});assert.equal(calls,1);time+=101;await service.search(params({source:'crossref'}),{clientKey:'a'});assert.equal(calls,2);await assert.rejects(service.search(params({source:'crossref'}),{clientKey:'a'}),{status:429});
 time+=1100;await service.search(params({source:'crossref',q:'different public title'}),{clientKey:'b'});time+=1100;await service.search(params({source:'crossref'}),{clientKey:'b'});assert.equal(calls,4);
});
test('upstream throttling creates a bounded cooldown and does not expose response content',async()=>{
 let calls=0;const service=createLiteratureSearch({fetchImpl:async()=>{calls++;return new Response('provider private diagnostics',{status:429,headers:{'retry-after':'999999'}});}});
 await assert.rejects(service.search(params({source:'crossref'})),{status:503});await assert.rejects(service.search(params({source:'crossref',q:'other public title'})),error=>error.status===503&&!JSON.stringify(error.response).includes('private diagnostics'));assert.equal(calls,1);
});
test('HTTP public metadata endpoint works without login while private routes and mutation origin checks remain protected',async t=>{
 const db=database(':memory:');let calls=0;const api=createAPI(db,{cancel(){}},{getAI:()=>({aiEnabled:false}),literatureFetch:async()=>{calls++;return crResponse();}}),server=http.createServer((req,res)=>void api(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 const response=await fetch(base+'/api/literature/search?'+params({source:'crossref'}));assert.equal(response.status,200);assert.equal((await response.json()).items[0].doi,'10.1234/graph');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await fetch(base+'/api/projects')).status,401);
 const post=await fetch(base+'/api/literature/search',{method:'POST',headers:{Origin:'https://evil.test','content-type':'application/json'},body:'{}'});assert.equal(post.status,403);assert.equal((await fetch(base+'/api/literature/search?q=a')).status,400);
 for(let i=0;i<19;i++)assert.equal((await fetch(base+'/api/literature/search?'+params({source:'crossref'}))).status,200);
 const limited=await fetch(base+'/api/literature/search?'+params({source:'crossref'}));assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);assert.equal(calls,1);const cap=await(await fetch(base+'/api/capabilities')).json();assert.equal(cap.academicSearch,true);assert.deepEqual(cap.academicSearchSources,['crossref','europepmc']);
});
