import test from 'node:test';
import assert from 'node:assert/strict';
import {createSemanticScholarClient,parseSemanticScholarResponse,semanticScholarQueryURL} from '../backend/semantic-scholar-client.mjs';

const id='649def34f8be52c8b66281af98ae884c09aef38b';
const paper=(extra={})=>({paperId:id,title:'Evidence based graph research',authors:[{name:'Example Author'}],year:2026,externalIds:{DOI:'https://doi.org/10.1234/GRAPH'},abstract:'Public abstract only',publicationTypes:['JournalArticle'],isOpenAccess:true,openAccessPdf:{url:'https://arxiv.org/pdf/2610.01234'},citationCount:9,journal:{name:'Research Journal',volume:'4',pages:'12-20'},...extra});
const query=(extra={})=>({q:'graph neural networks',limit:10,...extra});
const response=(data={data:[paper()],total:1,offset:0},extra={})=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'},...extra});
const client=(options={})=>{let time=1000;return createSemanticScholarClient({apiKey:'synthetic-key',clock:()=>time,wait:async ms=>{time+=ms;},...options});};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('Semantic Scholar uses fixed official relevance endpoint and provider-side filters with bounded pagination',()=>{
 const url=semanticScholarQueryURL(query({q:'graph & api_key=untrusted',page:3,limit:5,yearFrom:2020,yearTo:2026,openAccess:true,hasCitations:true,type:'conference'}));
 assert.equal(url.origin,'https://api.semanticscholar.org');assert.equal(url.pathname,'/graph/v1/paper/search');assert.equal(url.searchParams.get('query'),'graph & api_key=untrusted');assert.equal(url.searchParams.get('offset'),'10');assert.equal(url.searchParams.get('limit'),'5');assert.equal(url.searchParams.get('year'),'2020-2026');assert.equal(url.searchParams.get('minCitationCount'),'1');assert.equal(url.searchParams.get('publicationTypes'),'Conference');assert.equal(url.searchParams.has('openAccessPdf'),true);assert.equal(url.searchParams.has('api_key'),false);assert.equal(url.searchParams.has('sort'),false);
 assert.equal(semanticScholarQueryURL(query({yearFrom:2026,yearTo:2026})).searchParams.get('year'),'2026');assert.equal(semanticScholarQueryURL(query({yearTo:2026})).searchParams.get('year'),'-2026');
 for(const extra of [{q:'a'},{limit:21},{page:6},{page:0},{yearFrom:2027,yearTo:2026}])assert.throws(()=>semanticScholarQueryURL(query(extra)),error=>error.sourceStatus==='invalid_query');
 for(const extra of [{sort:'year'},{sort:'citations'},{hasDoi:true},{hasDoi:false},{hasCitations:false},{type:'thesis'},{type:'report'},{type:'preprint'},{dateFrom:'2026-01-01'}])assert.throws(()=>semanticScholarQueryURL(query(extra)),error=>error.sourceStatus==='unsupported_filter');
});

test('Semantic Scholar produces verified metadata links and never labels abstracts as article text',()=>{
 const result=parseSemanticScholarResponse({data:[paper()],total:25,offset:0,next:1},query()),item=result.items[0];
 assert.equal(item.id,'semantic_scholar:'+id);assert.equal(item.source,'semantic_scholar');assert.equal(item.sourceId,id);assert.equal(item.url,'https://www.semanticscholar.org/paper/'+id+'?utm_source=api');assert.equal(item.doi,'10.1234/graph');assert.equal(item.authors,'Example Author');assert.equal(item.year,2026);assert.equal(item.citationCount,9);assert.equal(item.journal,'Research Journal');assert.equal(item.volume,'4');assert.equal(item.pages,'12-20');assert.equal(item.abstract,'Public abstract only');assert.equal(item.text,undefined);assert.equal(item.fullText,undefined);assert.equal(item.type,'journal');assert.equal(item.fullTextUrl,'https://arxiv.org/pdf/2610.01234');assert.equal(result.hasMore,true);assert.deepEqual(result.pagination,{page:1,limit:10,offset:0,nextOffset:1,maxPages:5});
});

test('Semantic Scholar rejects untrusted identity and unsafe PDF links without following arbitrary provider URLs',()=>{
 const badLinks=['javascript:alert(1)','http://127.0.0.1/private','http://[::1]/','https://user:password@publisher.org/file','https://localhost/file','https://private.internal/file'];
 for(const url of badLinks){const result=parseSemanticScholarResponse({data:[paper({url:'https://evil.invalid/redirect',openAccessPdf:{url}})]},query());assert.equal(result.items[0].pdfUrl,undefined);assert.equal(result.items[0].fullTextUrl,undefined);assert.equal(parseSemanticScholarResponse({data:[paper({openAccessPdf:{url}})]},query({openAccess:true})).items.length,0);assert.doesNotMatch(JSON.stringify(result),/evil\.invalid|127\.0\.0\.1|password|javascript:/);}
 const result=parseSemanticScholarResponse({data:[paper({paperId:'../../admin'}),paper({paperId:'https://evil.invalid'}),paper({paperId:id.toUpperCase()}),paper()]},query());assert.equal(result.items.length,1);assert.equal(result.items[0].sourceId,id);
 assert.equal(parseSemanticScholarResponse({data:[paper({isOpenAccess:false})]},query()).items[0].pdfUrl,undefined);
});

test('Semantic Scholar parses type/year/citation filters honestly and bounds provider pagination to five pages',()=>{
 assert.equal(parseSemanticScholarResponse({data:[paper({year:2010})]},query({yearFrom:2020})).items.length,0);assert.equal(parseSemanticScholarResponse({data:[paper({citationCount:null})]},query({hasCitations:true})).items.length,0);
 for(const [type,publicationType] of [['journal','Journal Article'],['book','Book'],['chapter','BookSection'],['conference','Conference'],['other','Dataset']])assert.equal(parseSemanticScholarResponse({data:[paper({publicationTypes:[publicationType]})]},query({type})).items[0].type,type);
 const final=parseSemanticScholarResponse({data:[paper()],total:99999,offset:40,next:41},query({page:5}));assert.equal(final.hasMore,false);assert.equal(final.pagination.nextOffset,null);
 assert.equal(parseSemanticScholarResponse({data:[paper()],total:25,next:900},query()).hasMore,false);
 for(const payload of [null,[],{data:{}},{data:Array(21).fill(paper())},{data:[],offset:999}])assert.throws(()=>parseSemanticScholarResponse(payload,query()),{status:503});
});

test('Semantic Scholar preserves unknown access and publication type, and separates conference venue from journal',()=>{
 const unknown=parseSemanticScholarResponse({data:[paper({isOpenAccess:null,publicationTypes:null,venue:'Unknown proceedings',journal:null,citationCount:null})]},query()).items[0];assert.equal(Object.hasOwn(unknown,'openAccess'),false);assert.equal(Object.hasOwn(unknown,'type'),false);assert.equal(Object.hasOwn(unknown,'documentType'),false);assert.equal(Object.hasOwn(unknown,'citationCount'),false);assert.equal(unknown.venue,'Unknown proceedings');assert.equal(unknown.journal,undefined);assert.equal(unknown.fullTextUrl,undefined);
 const conference=parseSemanticScholarResponse({data:[paper({publicationTypes:['Conference'],venue:'Conference proceedings',journal:null})]},query()).items[0];assert.equal(conference.type,'conference');assert.equal(conference.venue,'Conference proceedings');assert.equal(conference.journal,undefined);
 assert.equal(parseSemanticScholarResponse({data:[paper({publicationTypes:['UnrecognizedType']})]},query({type:'other'})).items.length,0);
});

test('Semantic Scholar requires a key and sends it only in the official request header',async()=>{
 let calls=0;const fetchImpl=async(url,options)=>{calls++;assert.equal(new URL(url).hostname,'api.semanticscholar.org');assert.equal(new URL(url).searchParams.has('api_key'),false);assert.equal(options.redirect,'error');assert.equal(options.headers['x-api-key'],'synthetic-key');assert.equal(options.headers.Authorization,undefined);assert.ok(options.signal);return response();};
 for(const apiKey of ['',null,'header\ninjection'])await assert.rejects(createSemanticScholarClient({apiKey,fetchImpl}).search(query()),error=>error.sourceStatus==='not_configured');assert.equal(calls,0);
 const result=await client({fetchImpl}).search(query());assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result),/synthetic-key/);
});

test('Semantic Scholar coalesces requests, caches isolated copies and limits one request per second across clients',async()=>{
 let time=1000,calls=0,release;const starts=[],waits=[],fetchImpl=async()=>{calls++;starts.push(time);if(calls===1)await new Promise(resolve=>release=resolve);return response();};
 const options={apiKey:'synthetic-key',fetchImpl,clock:()=>time,wait:async ms=>{waits.push(ms);time+=ms;},maxQueue:2},a=createSemanticScholarClient(options),b=createSemanticScholarClient(options),first=a.search(query()),same=b.search(query()),second=b.search(query({q:'another topic'}));await tick();await assert.rejects(a.search(query({q:'overflow topic'})),error=>error.sourceStatus==='rate_limited');assert.equal(calls,1);release();const [one,two]=await Promise.all([first,same,second]);one.items[0].title='Changed';assert.notEqual(two.items[0].title,'Changed');assert.deepEqual(starts,[1000,2000]);assert.deepEqual(waits,[1000]);assert.notEqual((await b.search(query())).items[0].title,'Changed');assert.equal(calls,2);time+=3600001;await a.search(query());assert.equal(calls,3);
});

test('Semantic Scholar isolates cache and rate limits for different credential scopes',async()=>{
 const keys=[],fetchImpl=async(_url,{headers})=>{keys.push(headers['x-api-key']);return response();};
 await client({apiKey:'key-one',fetchImpl}).search(query());await client({apiKey:'key-two',fetchImpl}).search(query());assert.deepEqual(keys,['key-one','key-two']);
});

test('Semantic Scholar outbound budget callback counts fetches, excluding cache hits and coalesced reads',async()=>{
 let time=1000,fetches=0,reservations=0,release;const fetchImpl=async()=>{fetches++;if(fetches===1)await new Promise(resolve=>release=resolve);return response();};
 const options={apiKey:'synthetic-key',fetchImpl,clock:()=>time,wait:async ms=>{time+=ms;},beforeRequest:async()=>{reservations++;}},a=createSemanticScholarClient(options),b=createSemanticScholarClient(options),first=a.search(query()),same=b.search(query());await tick();assert.equal(fetches,1);assert.equal(reservations,1);release();await Promise.all([first,same]);time+=300001;await b.search(query());assert.equal(fetches,1);assert.equal(reservations,1);await b.search(query({q:'another topic'}));assert.equal(fetches,2);assert.equal(reservations,2);time+=3600001;await a.search(query());assert.equal(fetches,3);assert.equal(reservations,3);
});

test('Semantic Scholar outbound budget rejection prevents network access and remains a clear source error',async()=>{
 let fetches=0,reservations=0;const api=client({beforeRequest:()=>{reservations++;throw Object.assign(Error('今日检索额度已用完'),{status:503,sourceStatus:'rate_limited'});},fetchImpl:async()=>{fetches++;return response();}});
 await assert.rejects(api.search(query()),error=>error.sourceStatus==='rate_limited'&&error.message==='今日检索额度已用完');assert.equal(fetches,0);assert.equal(reservations,1);
});

test('Semantic Scholar holds the queue until the active response body has completed',async()=>{
 let release,calls=0;const fetchImpl=async()=>{calls++;if(calls===1)return new Response(new ReadableStream({start(controller){release=()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify({data:[paper()]})));controller.close();};}}),{headers:{'content-type':'application/json'}});return response();};
 const api=client({fetchImpl}),one=api.search(query()),two=api.search(query({q:'second topic'}));await tick();assert.equal(calls,1);release();await Promise.all([one,two]);assert.equal(calls,2);
});

test('Semantic Scholar safely reports upstream authorization, throttling, oversized and invalid responses',async()=>{
 for(const bad of [new Response('private token diagnostic',{status:403}),new Response('private token diagnostic',{status:500}),new Response('<html>private token</html>',{headers:{'content-type':'text/html'}}),new Response('invalid json',{headers:{'content-type':'application/json'}}),response(undefined,{headers:{'content-type':'application/json','content-length':'999999'}}),response()]){await assert.rejects(client({fetchImpl:async()=>bad,maxResponseBytes:100}).search(query()),error=>error.status===503&&!/private|token|diagnostic/.test(error.message));}
 let time=1000,calls=0;const api=client({clock:()=>time,wait:async ms=>{time+=ms;},fetchImpl:async()=>{calls++;return new Response('private diagnostic',{status:429,headers:{'retry-after':'999999'}});}});await assert.rejects(api.search(query()),error=>error.sourceStatus==='rate_limited');time+=299000;await assert.rejects(api.search(query({q:'other topic'})),error=>error.sourceStatus==='rate_limited');assert.equal(calls,1);time+=1001;await assert.rejects(api.search(query({q:'other topic'})),error=>error.sourceStatus==='rate_limited');assert.equal(calls,2);
});

test('Semantic Scholar bounds the entire fetch/read timeout without leaking remote errors',async()=>{
 const api=client({timeoutMs:5,fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('private remote failure')),{once:true}))});await assert.rejects(api.search(query()),error=>/超时/.test(error.message)&&!error.message.includes('private'));
 let cancelled=false;const stalled=client({timeoutMs:5,fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}})});await assert.rejects(stalled.search(query()),error=>/超时/.test(error.message));assert.equal(cancelled,true);
});
