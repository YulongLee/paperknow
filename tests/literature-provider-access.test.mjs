import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createLiteratureSearch,parseLiteratureQuery} from '../backend/literature-search.mjs';
import {createAPI} from '../backend/api.mjs';
import {database} from '../backend/database.mjs';
import {createSession} from '../backend/auth.mjs';
import {environmentConfig} from '../backend/config.mjs';
import {normalizeReferenceSearchItem} from '../dist/workspace/writing-reference-search.mjs';

const query=(extra={})=>new URLSearchParams({q:'graph research',source:'pubmed',...extra});
const record=(extra={})=>({uid:'12345',title:'A supplied biomedical study',authors:[{name:'Researcher A'}],pubdate:'2025 Jan',pubtype:['Journal Article'],articleids:[{idtype:'doi',value:'10.1234/shared'}],fulljournalname:'Actual journal',volume:'8',issue:'2',pages:'10-19',...extra});
const semanticRecord=()=>({paperId:'a'.repeat(40),title:'A supplied scholarly record',year:2025,authors:[{name:'Researcher B'}],publicationTypes:['JournalArticle'],isOpenAccess:false,citationCount:3});
const pubmedFetch=(url)=>Response.json(new URL(url).pathname.endsWith('esearch.fcgi')?{esearchresult:{count:'50',idlist:['12345']}}:{result:{uids:['12345'],'12345':record()}});

test('PubMed is public while CNKI and unconfigured Semantic Scholar are unavailable without making upstream calls',async()=>{
 let calls=0;const service=createLiteratureSearch({fetchImpl:async()=>{calls++;throw Error('must not call');}});
 assert.ok(service.listSources().includes('pubmed'));assert.ok(!service.listSources().includes('cnki'));assert.ok(!service.listSources().includes('semantic_scholar'));
 for(const id of ['cnki','semantic_scholar']){
  const status=service.sourceStatus().find(row=>row.id===id);assert.equal(status.configured,false);assert.match(status.reason,/配置/);
  await assert.rejects(service.search(query({source:id})),error=>error.status===503&&error.response.sources[0].status==='not_configured');
 }
 assert.equal(calls,0);assert.equal(parseLiteratureQuery(query({source:'pubmed,openalex,semantic_scholar,cnki'})).source,'pubmed,openalex,semantic_scholar,cnki');
});

test('PubMed bibliographic metadata imports with its real source identity and remains unread',async()=>{
 const calls=[],service=createLiteratureSearch({fetchImpl:async(url,options)=>{calls.push({url:new URL(url),options});return pubmedFetch(url);}});
 const result=await service.search(query()),raw=result.items[0],imported=normalizeReferenceSearchItem(raw);
 assert.equal(result.total,50);assert.equal(result.hasMore,true);assert.equal(raw.pmid,'12345');assert.equal(raw.sourceProvenance[0].pmid,'12345');assert.equal(raw.journal,'Actual journal');assert.equal(raw.pages,'10-19');
 assert.equal(imported.source,'pubmed');assert.equal(imported.sourceId,'12345');assert.equal(imported.scope,'metadata');assert.equal(imported.text,'');assert.equal(imported.confirmed,false);assert.equal(imported.fullTextRead,false);assert.equal(imported.openAccess,undefined);assert.match(imported.sourceLabel,/PubMed.*未读取全文/);
 assert.deepEqual(calls.map(call=>call.url.pathname.split('/').at(-1)),['esearch.fcgi','esummary.fcgi']);for(const call of calls){assert.equal(call.url.hostname,'eutils.ncbi.nlm.nih.gov');assert.equal(call.options.headers.Authorization,undefined);}
 await service.search(query());assert.equal(calls.length,2,'repeat metadata requests use the cache');
});

test('PubMed year/type/DOI filters describe the current window and never claim the unfiltered whole-index total',async()=>{
 const service=createLiteratureSearch({fetchImpl:async url=>pubmedFetch(url)});
 const result=await service.search(query({yearFrom:'2025',yearTo:'2025',type:'journal',hasDoi:'true'}));
 assert.equal(result.items.length,1);assert.equal(result.total,undefined);assert.equal(result.sources[0].total,undefined);assert.equal(result.sources[0].filterScope,'window');assert.equal(result.sources[0].pagination.mode,'offset');
 const later=await service.search(query({yearFrom:'2026',yearTo:'2026'}));assert.equal(later.items.length,0);assert.equal(later.total,undefined);
});

test('unsupported PubMed evidence filters do not spend provider requests',async()=>{
 let calls=0;const service=createLiteratureSearch({fetchImpl:async()=>{calls++;throw Error('must not call');}});
 for(const extra of [{openAccess:'true'},{hasCitations:'true'},{hasCitations:'false'},{sort:'citations'}]){const value=await service.search(query(extra));assert.equal(value.sources[0].status,'unsupported_filter');assert.equal(value.items.length,0);}
 assert.equal(calls,0);
});

test('PubMed and Crossref merge only matching DOI while retaining both provenances',async()=>{
 const service=createLiteratureSearch({fetchImpl:async url=>new URL(url).hostname==='api.crossref.org'?Response.json({message:{items:[{DOI:'10.1234/shared',title:['A supplied biomedical study'],published:{'date-parts':[[2025]]},type:'journal-article'}]}}):pubmedFetch(url)});
 const result=await service.search(query({source:'crossref,pubmed'}));assert.equal(result.items.length,1);assert.deepEqual(result.items[0].sourceProvenance.map(row=>row.source),['crossref','pubmed']);assert.equal(result.items[0].pmid,'12345');assert.equal(result.items[0].journal,'Actual journal');assert.equal(result.items[0].citationCount,undefined);
});

test('Semantic Scholar credentials, budget, and cached results cannot cross public/internal scope',async()=>{
 let calls=0,time=1000000;const key='synthetic-private-semantic-key',service=createLiteratureSearch({clock:()=>time,semanticScholarEnabled:true,semanticScholarApiKey:key,semanticScholarDailyLimit:1,fetchImpl:async(url,options)=>{calls++;assert.equal(new URL(url).hostname,'api.semanticscholar.org');assert.equal(options.headers['x-api-key'],key);assert.equal(String(url).includes(key),false);return Response.json({total:1,offset:0,data:[semanticRecord()]});}});
 assert.equal(service.listSources().includes('semantic_scholar'),false);assert.equal(service.listSources({allowSemanticScholar:true}).includes('semantic_scholar'),true);
 const input=query({source:'semantic_scholar'}),internal=await service.search(input,{allowSemanticScholar:true});assert.equal(internal.items[0].source,'semantic_scholar');assert.equal(JSON.stringify(internal).includes(key),false);
 await assert.rejects(service.search(input),error=>error.response.sources[0].status==='not_configured');
 time+=300001;await service.search(input,{allowSemanticScholar:true});assert.equal(calls,1,'an inner cache hit after the five-minute outer cache expires spends no outbound budget');
 await assert.rejects(service.search(query({q:'other research',source:'semantic_scholar'}),{allowSemanticScholar:true}),error=>error.response.sources[0].status==='budget_exhausted');assert.equal(calls,1);
});

test('Semantic Scholar environment defaults closed and bounds configured daily caps',()=>{
 const defaults=environmentConfig({});assert.equal(defaults.semanticScholarEnabled,false);assert.equal(defaults.semanticScholarAccess,'internal');assert.equal(defaults.semanticScholarCommercialLicensed,false);assert.equal(defaults.semanticScholarDailyLimit,100);
 for(const value of ['-1','1.5','10001','invalid'])assert.equal(environmentConfig({PK_SEMANTIC_SCHOLAR_DAILY_LIMIT:value}).semanticScholarDailyLimit,100);
 assert.equal(environmentConfig({PK_SEMANTIC_SCHOLAR_DAILY_LIMIT:'0'}).semanticScholarDailyLimit,0);
});

test('public Semantic Scholar activation requires both public scope and explicit commercial permission, while admins can test internally',async t=>{
 const db=database(':memory:');db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('admin','admin@example.invalid','Admin',null,'admin',new Date().toISOString());const cookie='pk_session='+createSession(db,'admin');let calls=0;
 const config={getAI:()=>({aiEnabled:false}),semanticScholarEnabled:true,semanticScholarApiKey:'synthetic-key',semanticScholarAccess:'public',semanticScholarCommercialLicensed:false,literatureFetch:async()=>{calls++;return Response.json({total:1,offset:0,data:[semanticRecord()]});}};
 let api=createAPI(db,{cancel(){}},config);const server=http.createServer((req,res)=>void api(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 const request=(path,admin=false)=>fetch(base+'/api/'+path,{headers:admin?{Cookie:cookie}:{}}),path='literature/search?'+query({source:'semantic_scholar'});
 assert.equal((await request(path)).status,503);assert.equal(calls,0);
 assert.equal((await(await request('capabilities')).json()).academicSearchSources.includes('semantic_scholar'),false);
 assert.equal((await request(path,true)).status,200);assert.equal(calls,1);
 api=createAPI(db,{cancel(){}},{...config,semanticScholarCommercialLicensed:true});assert.equal((await request(path)).status,200);assert.equal(calls,1,'credential-scoped public metadata cache is reused after authorization');
 const cap=await(await request('capabilities')).json();assert.equal(cap.academicSearchSources.includes('semantic_scholar'),true);assert.equal(cap.academicSearchSourceStatus.find(row=>row.id==='cnki').configured,false);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM files').get().n,0);
});
