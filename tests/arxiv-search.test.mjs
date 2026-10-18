import test from 'node:test';
import assert from 'node:assert/strict';
import {createArxivClient,parseArxivFeed,arxivQueryURL} from '../backend/arxiv-client.mjs';
import {createLiteratureSearch,parseLiteratureQuery} from '../backend/literature-search.mjs';

const ATOM='http://www.w3.org/2005/Atom';
const entry=({id='2610.01234v2',title='Graph &amp; neural research',published='2026-10-18T12:30:00Z',updated='2026-10-19T01:02:03Z',extra=''}={})=>`<entry><id>http://arxiv.org/abs/${id}</id><title>${title}</title><published>${published}</published><updated>${updated}</updated><summary>Public abstract with α and a &lt; b.</summary><author><name>Example Author</name></author><arxiv:doi>10.1234/GRAPH</arxiv:doi><category term="cs.LG"/><link rel="alternate" href="http://127.0.0.1/private"/><link title="pdf" href="javascript:alert(1)"/>${extra}</entry>`;
const feed=(entries=entry(),total=1)=>`<?xml version="1.0" encoding="UTF-8"?><feed xmlns="${ATOM}" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>${total}</opensearch:totalResults>${entries}</feed>`;
const response=(xml=feed(),extra={})=>new Response(xml,{headers:{'content-type':'application/atom+xml; charset=UTF-8'},...extra});
const query=(extra={})=>({q:'graph neural networks',source:'arxiv',limit:10,yearFrom:null,yearTo:null,openAccess:false,...extra});
const params=(extra={})=>new URLSearchParams({q:'graph neural networks',source:'arxiv',...extra});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('arXiv query validation isolates chronological sorting/date filters and rejects impossible/intersecting dates',()=>{
 const parsed=parseLiteratureQuery(params({sort:'submittedDate',dateFrom:'2026-10-01',dateTo:'2026-10-19',yearFrom:'2026',yearTo:'2026'}));assert.equal(parsed.sort,'submittedDate');assert.equal(parsed.dateFrom,'2026-10-01');
 for(const extra of [{sort:'unknown'},{source:'all',sort:'submittedDate'},{source:'openalex',sort:'lastUpdatedDate'},{source:'all',dateFrom:'2026-01-01'},{dateFrom:'2026-02-30'},{dateTo:'2025-02-29'},{dateFrom:'2026-1-01'},{dateFrom:'2027-01-01',yearTo:'2026'},{dateTo:'2020-01-01',yearFrom:'2026'},{dateFrom:'2026-10-19',dateTo:'2026-10-18'}])assert.throws(()=>parseLiteratureQuery(params(extra)),{status:400});
 assert.equal(parseLiteratureQuery(params({sort:'relevance',source:'all'})).sort,'relevance');
});

test('arXiv fixed query URL escapes user syntax and owns date bounds, sorting and limit',()=>{
 const url=arxivQueryURL(query({q:'graph OR all:"evil" & api_key=secret',sort:'lastUpdatedDate',limit:4,yearFrom:2020,yearTo:2026,dateFrom:'2026-10-01',dateTo:'2026-10-19'}));
 assert.equal(url.origin,'https://export.arxiv.org');assert.equal(url.pathname,'/api/query');assert.equal(url.searchParams.get('start'),'0');assert.equal(url.searchParams.get('max_results'),'4');assert.equal(url.searchParams.get('sortBy'),'lastUpdatedDate');assert.equal(url.searchParams.get('sortOrder'),'descending');assert.equal(url.searchParams.has('api_key'),false);
 assert.equal(url.searchParams.get('search_query'),'all:"graph" AND all:"OR" AND all:"all:evil" AND all:"&" AND all:"api_key=secret" AND submittedDate:[202610010000 TO 202610192359]');
});

test('arXiv feed normalizes canonical metadata/preprint dates and constructs external originals without following feed links',()=>{
 const result=parseArxivFeed(feed(),query()),paper=result.items[0];assert.equal(result.total,1);assert.equal(paper.id,'arxiv:2610.01234');assert.equal(paper.sourceId,'2610.01234');assert.equal(paper.arxivId,'2610.01234v2');assert.equal(paper.title,'Graph & neural research');assert.equal(paper.authors,'Example Author');assert.equal(paper.abstract,'Public abstract with α and a < b.');assert.equal(paper.doi,'10.1234/graph');assert.equal(paper.year,2026);assert.equal(paper.publishedDate,'2026-10-18T12:30:00.000Z');assert.equal(paper.updatedDate,'2026-10-19T01:02:03.000Z');assert.equal(paper.type,'preprint');assert.equal(paper.openAccess,true);assert.deepEqual(paper.categories,['cs.LG']);assert.equal(paper.url,'https://arxiv.org/abs/2610.01234v2');assert.equal(paper.pdfUrl,'https://arxiv.org/pdf/2610.01234v2');assert.equal(paper.fullTextUrl,paper.pdfUrl);assert.doesNotMatch(JSON.stringify(result),/127\.0\.0\.1|javascript:/);
 assert.equal(parseArxivFeed(feed(entry({id:'hep-th/9901001'})),query()).items[0].arxivId,'hep-th/9901001');
});

test('arXiv feed rejects malformed XML, DTD/entities/wrong namespaces/error feeds and bounds parser complexity',()=>{
 for(const xml of ['<feed>',`<feed xmlns="https://evil.test">${entry()}</feed>`,`<!DOCTYPE feed SYSTEM "http://127.0.0.1/"><feed xmlns="${ATOM}"/>`,`<!DOCTYPE feed [<!ENTITY x "EXPAND">]><feed xmlns="${ATOM}">&x;</feed>`,`<feed xmlns="${ATOM}"><entry><id>http://arxiv.org/api/errors#bad_query</id></entry></feed>`,`<feed xmlns="${ATOM}">${'<extra>'.repeat(40)}x${'</extra>'.repeat(40)}</feed>`,feed().replace('Graph &amp;','Graph &illegal;'),feed().replace('<title>','<title>\u0000')])assert.throws(()=>parseArxivFeed(xml,query()),error=>error.status===503&&!/127\.0\.0\.1|EXPAND|bad_query/.test(error.message));
});

test('arXiv identifiers, dates and namespace impostors cannot become unsafe links or misleading records',()=>{
 const xml=feed(entry({id:'2610.01234?api_key=private'})+entry({id:'../../admin'})+entry({published:'2026-02-30T00:00:00Z'})+entry({updated:'2026-13-01T00:00:00Z'})+entry({id:'2610.01235',extra:'<foreign:title xmlns:foreign="https://evil.test">Private</foreign:title>'}));
 const result=parseArxivFeed(xml,query());assert.equal(result.items.length,1);assert.equal(result.items[0].arxivId,'2610.01235');assert.doesNotMatch(JSON.stringify(result),/api_key|admin|Private/);
});

test('arXiv version duplicates have one stable identity, date filtering is enforced and chronology is explicit',()=>{
 const xml=feed(entry({id:'2610.01234v1',updated:'2026-10-18T13:00:00Z'})+entry()+entry({id:'2610.01235',published:'2026-10-19T12:30:00Z',updated:'2026-10-20T12:30:00Z'})+entry({id:'2501.01234',published:'2025-01-01T00:00:00Z',updated:'2025-01-01T00:00:00Z'}),4);
 const result=parseArxivFeed(xml,query({yearFrom:2026,dateFrom:'2026-10-18',dateTo:'2026-10-19',sort:'submittedDate'}));assert.equal(result.items.length,2);assert.equal(result.items[0].arxivId,'2610.01235');assert.equal(result.items[1].arxivId,'2610.01234v2');assert.equal(parseArxivFeed(xml,query({sort:'lastUpdatedDate',limit:1})).items[0].arxivId,'2610.01235');assert.equal(parseArxivFeed(xml,query({dateTo:'2026-10-17'})).items.length,1);
});

test('arXiv uses no credentials and retains a single connection until body completion across client instances',async()=>{
 let time=1000,release,active=0,maximum=0;const starts=[],delays=[];
 const fetchImpl=async(url,options)=>{starts.push(time);active++;maximum=Math.max(maximum,active);assert.equal(new URL(url).hostname,'export.arxiv.org');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);assert.ok(options.signal);const xml=feed();if(starts.length===1)return new Response(new ReadableStream({start(controller){release=()=>{controller.enqueue(new TextEncoder().encode(xml));controller.close();active--;};}}),{headers:{'content-type':'application/atom+xml'}});active--;return response();};
 const options={fetchImpl,clock:()=>time,wait:async ms=>{delays.push(ms);time+=ms;}},a=createArxivClient(options),b=createArxivClient(options);
 const first=a.search(query()),second=b.search(query({q:'another public topic'}));await tick();assert.equal(starts.length,1);assert.equal(active,1);release();await Promise.all([first,second]);assert.equal(maximum,1);assert.deepEqual(starts,[1000,4000]);assert.deepEqual(delays,[3000]);
});

test('arXiv queue is bounded, identical requests coalesce, cached replies isolate mutations and expire after one hour',async()=>{
 let time=1000,calls=0,release;const fetchImpl=async()=>{calls++;if(calls===1)await new Promise(resolve=>release=resolve);return response();};
 const client=createArxivClient({fetchImpl,clock:()=>time,wait:async ms=>{time+=ms;},maxQueue:2}),first=client.search(query()),same=client.search(query()),second=client.search(query({q:'different topic'}));await tick();await assert.rejects(client.search(query({q:'queue overflow'})),error=>error.sourceStatus==='rate_limited');assert.equal(calls,1);release();const [a,b]=await Promise.all([first,same,second]);a.items[0].title='mutated';assert.notEqual(b.items[0].title,'mutated');assert.equal(calls,2);assert.notEqual((await client.search(query())).items[0].title,'mutated');assert.equal(calls,2);time+=3600001;await client.search(query());assert.equal(calls,3);
});

test('arXiv timeout/oversized body/content-type/upstream throttling fail safely without exposing diagnostics',async()=>{
 const timeout=createArxivClient({timeoutMs:5,fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('private error')),{once:true}))});await assert.rejects(timeout.search(query()),error=>/超时/.test(error.message));
 for(const bad of [new Response('private api_key=secret',{status:403}),new Response('{}',{headers:{'content-type':'application/json'}}),response(feed(),{headers:{'content-type':'application/xml','content-length':'999999'}}),response(feed())]){const client=createArxivClient({maxResponseBytes:100,fetchImpl:async()=>bad});await assert.rejects(client.search(query()),error=>error.status===503&&!/private|api_key|secret/.test(error.message));}
 let time=1000,calls=0;const client=createArxivClient({clock:()=>time,wait:async ms=>{time+=ms;},fetchImpl:async()=>{calls++;return new Response('private diagnostic',{status:429,headers:{'retry-after':'999999'}});}});await assert.rejects(client.search(query()),{status:503});time+=299000;await assert.rejects(client.search(query({q:'other topic'})),error=>error.sourceStatus==='rate_limited');assert.equal(calls,1);time+=1001;await assert.rejects(client.search(query({q:'other topic'})),{status:503});assert.equal(calls,2);
});

test('arXiv is public and independently bounded so all five sources can participate without credential leaks',async()=>{
 const calls=[];const service=createLiteratureSearch({openAlexApiKey:'synthetic-openalex',aminerEnabled:true,aminerApiKey:'synthetic-aminer',aminerUserId:'testuser',fetchImpl:async(url,options)=>{
  const host=new URL(url).hostname;calls.push({host,authorization:options.headers.Authorization});
  if(host==='export.arxiv.org')return response();
  if(host==='api.crossref.org')return new Response(JSON.stringify({message:{items:[]}}),{headers:{'content-type':'application/json'}});
  if(host==='www.ebi.ac.uk')return new Response(JSON.stringify({resultList:{result:[]}}),{headers:{'content-type':'application/json'}});
  if(host==='api.openalex.org')return new Response(JSON.stringify({results:[]}),{headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify({code:200,success:true,data:[]}),{headers:{'content-type':'application/json'}});
 }});
 assert.ok(service.listSources({allowAminer:false}).includes('arxiv'));assert.equal(service.sourceStatus().find(row=>row.id==='arxiv').configured,true);
 const result=await service.search(params({source:'all'}));assert.equal(result.sources.length,5);assert.ok(result.sources.every(row=>row.status==='ok'));assert.equal(result.items[0].source,'arxiv');assert.equal(calls.find(row=>row.host==='export.arxiv.org').authorization,undefined);assert.doesNotMatch(JSON.stringify(result),/synthetic-/);
});

test('failed arXiv responses preserve other aggregate results with honest partial status',async()=>{
 const service=createLiteratureSearch({fetchImpl:async url=>{const host=new URL(url).hostname;if(host==='export.arxiv.org')throw Error('private remote error');return new Response(JSON.stringify(host==='api.crossref.org'?{message:{items:[{DOI:'10.1234/real',title:['Real paper']}]}}:{resultList:{result:[]}}),{headers:{'content-type':'application/json'}});}});
 const result=await service.search(params({source:'all'}));assert.equal(result.items[0].source,'crossref');assert.equal(result.partial,true);assert.equal(result.sources.find(row=>row.id==='arxiv').status,'error');assert.doesNotMatch(JSON.stringify(result),/private remote/);
});
