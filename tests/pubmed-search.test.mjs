import test from 'node:test';
import assert from 'node:assert/strict';
import {createPubMedClient,parsePubMedSummary,pubmedQueryURL} from '../backend/pubmed-client.mjs';

const query={q:'diabetes therapy',limit:2,page:1,sort:'relevance'};
const json=(value,options={})=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'},...options});
const search=(ids=['42908850','42908838'],count=10)=>({esearchresult:{count:String(count),idlist:ids}});
const record=(uid,overrides={})=>({uid,title:'Effect of <i>treatment</i> &amp; outcomes',authors:[{name:'Li Y'},{name:'Smith AB'}],pubdate:'2026 Oct',fulljournalname:'Example Journal',volume:'13',issue:'2',pages:'12-19',pubtype:['Journal Article'],articleids:[{idtype:'doi',value:'10.1234/EXAMPLE'},{idtype:'pmc',value:'PMC123'}],attributes:['Has Abstract'],...overrides});
const summary=(overrides={})=>({result:{uids:['42908838','42908850'],'42908838':record('42908838'),'42908850':record('42908850'),...overrides}});
function harness(options={}){let now=1000;const starts=[],requests=[];const fetchImpl=async(url,init)=>{starts.push(now);requests.push({url:new URL(url),init});return new URL(url).pathname.endsWith('esearch.fcgi')?json(search()):json(summary());};return {starts,requests,fetchImpl,clock:()=>now,wait:async ms=>{now+=ms;},advance:ms=>{now+=ms;},...options};}

test('PubMed uses fixed anonymous ESearch parameters and literal keyword tokens',()=>{
  const url=pubmedQueryURL({...query,q:'diabetes OR cancer[Title] "x" \\ therapy',yearFrom:2023,yearTo:2026,sort:'year',page:3});
  assert.equal(url.origin,'https://eutils.ncbi.nlm.nih.gov');assert.equal(url.pathname,'/entrez/eutils/esearch.fcgi');
  assert.equal(url.searchParams.get('term'),'"diabetes"[All Fields] AND "OR"[All Fields] AND "cancerTitle"[All Fields] AND "x"[All Fields] AND "therapy"[All Fields]');
  assert.equal(url.searchParams.get('retstart'),'4');assert.equal(url.searchParams.get('retmax'),'2');assert.equal(url.searchParams.get('sort'),'pub date');
  assert.equal(url.searchParams.get('mindate'),'2023');assert.equal(url.searchParams.get('maxdate'),'2026');assert.equal(url.searchParams.get('datetype'),'pdat');assert.equal(url.searchParams.get('db'),'pubmed');assert.equal(url.searchParams.has('api_key'),false);
  assert.equal(pubmedQueryURL({...query,yearTo:2025}).searchParams.get('mindate'),'1000');
});

test('PubMed refuses unsupported or unbounded requests before calling upstream',()=>{
  for(const extra of [{sort:'citations'},{sort:'submittedDate'},{openAccess:true},{hasCitations:true},{hasCitations:false},{limit:21},{page:6},{yearFrom:2026,yearTo:2024},{q:'"\\[]'}])assert.throws(()=>pubmedQueryURL({...query,...extra}),error=>error.status===503);
});

test('PubMed batches PMID metadata, retains search order and truthful bibliographic fields',async()=>{
  const h=harness(),client=createPubMedClient(h),value=await client.search(query);
  assert.equal(h.requests.length,2);assert.deepEqual(h.starts,[1000,1350]);
  assert.equal(h.requests[1].url.pathname,'/entrez/eutils/esummary.fcgi');assert.equal(h.requests[1].url.searchParams.get('id'),'42908850,42908838');
  assert.equal(h.requests[1].init.redirect,'error');assert.ok(h.requests[1].init.signal instanceof AbortSignal);
  assert.deepEqual(value.items.map(item=>item.sourceId),['42908850','42908838']);assert.equal(value.total,10);assert.equal(value.hasMore,true);assert.deepEqual(value.pagination,{mode:'offset',page:1,limit:2});
  const item=value.items[0];assert.equal(item.title,'Effect of treatment & outcomes');assert.equal(item.source,'pubmed');assert.equal(item.id,'pubmed:42908850');assert.equal(item.doi,'10.1234/example');assert.equal(item.year,2026);assert.equal(item.journal,'Example Journal');assert.equal(item.pages,'12-19');assert.equal(item.documentType,'journal');assert.equal(item.authors,'Li Y, Smith AB');assert.equal(item.url,'https://pubmed.ncbi.nlm.nih.gov/42908850/');
  for(const field of ['abstract','openAccess','fullTextUrl','pdfUrl','citationCount'])assert.equal(field in item,false,field+' must not be inferred');
});

test('PubMed zero results avoids ESummary and caps pagination at five pages',async()=>{
  let calls=0;const client=createPubMedClient({fetchImpl:async()=>{calls++;return json(search([],0));}});
  assert.deepEqual(await client.search(query),{items:[],total:0,hasMore:false,pagination:{mode:'offset',page:1,limit:2}});assert.equal(calls,1);
  const h=harness();assert.equal((await createPubMedClient(h).search({...query,page:5})).hasMore,false);
});

test('PubMed ignores unrequested/mismatched IDs and safely normalizes actual metadata',()=>{
  const items=parsePubMedSummary(summary({'42908850':record('42908850',{title:'<script>bad</script> A &#x202e;title &lt;b&gt;safe&lt;/b&gt;',authors:[{name:'A\u0000 B'}],pubdate:'unknown',pubtype:['Book'],articleids:[{idtype:'doi',value:'javascript:alert(1)'}]}),'42908838':record('123'),'999':record('999')}),['42908850','42908838']);
  assert.equal(items.length,1);assert.equal(items[0].title,'bad A title safe');assert.equal(items[0].authors,'A B');assert.equal(items[0].year,null);assert.equal(items[0].doi,'');assert.equal(items[0].type,'book');
  assert.throws(()=>parsePubMedSummary({error:'sensitive upstream message'},['1']),/PubMed 响应格式异常/);
  assert.throws(()=>parsePubMedSummary({result:{}},['42908850']),/PubMed 文献详情暂时不可用/);
  const unknownType=parsePubMedSummary(summary({'42908850':record('42908850',{pubtype:undefined})}),['42908850'])[0];assert.equal(unknownType.type,'');assert.equal(unknownType.documentType,'');
});

test('PubMed coalesces identical requests, returns isolated copies, expires and evicts cache',async()=>{
  const h=harness(),client=createPubMedClient({...h,cacheTtlMs:1000,maxCacheEntries:1});
  const [a,b]=await Promise.all([client.search(query),client.search(query)]);assert.equal(h.requests.length,2);a.items[0].title='changed';assert.notEqual(b.items[0].title,'changed');
  assert.notEqual((await client.search(query)).items[0].title,'changed');assert.equal(h.requests.length,2);
  h.advance(1001);await client.search(query);assert.equal(h.requests.length,4);
  await client.search({...query,q:'different query'});await client.search(query);assert.equal(h.requests.length,8);
});

test('PubMed shares each HTTP request rate gate across independently created clients',async()=>{
  const h=harness(),a=createPubMedClient(h),b=createPubMedClient(h);
  await Promise.all([a.search(query),b.search({...query,q:'cancer therapy'})]);
  assert.deepEqual(h.starts,[1000,1350,1700,2050]);
});

test('PubMed queue capacity rejects extra distinct requests but permits coalescing',async()=>{
  let release;const h=harness(),original=h.fetchImpl;
  h.fetchImpl=async(url,init)=>{if(!release)await new Promise(resolve=>{release=resolve;});return original(url,init);};
  const client=createPubMedClient({...h,maxQueue:1}),first=client.search(query),same=client.search(query);
  await assert.rejects(client.search({...query,q:'different query'}),error=>error.sourceStatus==='rate_limited');release();await Promise.all([first,same]);assert.equal(h.requests.length,2);
});

test('PubMed throttling installs a shared bounded cooldown without exposing upstream text',async()=>{
  let now=1000,calls=0;const fetchImpl=async()=>{calls++;return json({error:'SECRET'},{status:429,headers:{'content-type':'application/json','retry-after':'99999'}});};
  const opts={fetchImpl,clock:()=>now,wait:async ms=>{now+=ms;}},client=createPubMedClient(opts);
  await assert.rejects(client.search(query),error=>error.sourceStatus==='rate_limited'&&!error.message.includes('SECRET'));
  await assert.rejects(createPubMedClient(opts).search({...query,q:'different query'}),error=>error.sourceStatus==='rate_limited');assert.equal(calls,1);
  now+=300001;await assert.rejects(client.search(query),error=>error.sourceStatus==='rate_limited');assert.equal(calls,2);
});

test('PubMed rejects oversized, non-JSON, invalid JSON, invalid IDs and upstream error responses',async()=>{
  const responses=[()=>new Response('PRIVATE',{headers:{'content-type':'text/html'}}),()=>json(search(),{headers:{'content-type':'application/json','content-length':'9999'}}),()=>new Response('x'.repeat(501),{headers:{'content-type':'application/json'}}),()=>new Response('{broken',{headers:{'content-type':'application/json'}}),()=>json(search(['https://bad.example'],1)),()=>json({error:'PRIVATE'}),()=>json({}, {status:500})];
  for(const response of responses){let calls=0;const client=createPubMedClient({fetchImpl:async()=>{calls++;return response();},maxResponseBytes:500});await assert.rejects(client.search(query),error=>error.sourceStatus==='error'&&!error.message.includes('PRIVATE'));assert.equal(calls,1);}
});

test('PubMed aborts timed out HTTP requests and releases the queue for a retry',async()=>{
  let calls=0;const fetchImpl=async(url,{signal})=>{calls++;if(calls===1)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('PRIVATE')),{once:true}));return json(search([],0));};
  const client=createPubMedClient({fetchImpl,timeoutMs:5,wait:async()=>{}});
  await assert.rejects(client.search(query),/PubMed 响应超时/);assert.equal((await client.search(query)).total,0);assert.equal(calls,2);
});

test('PubMed timeout cancels a stalled response body',async()=>{
  let cancelled=false;const stream=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}});
  const client=createPubMedClient({fetchImpl:async()=>new Response(stream,{headers:{'content-type':'application/json'}}),timeoutMs:5});
  await assert.rejects(client.search(query),/PubMed 响应超时/);assert.equal(cancelled,true);
});
