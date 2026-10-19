import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createLiteratureSearch,parseLiteratureQuery} from '../backend/literature-search.mjs';
import {arxivQueryURL} from '../backend/arxiv-client.mjs';
import {createAPI} from '../backend/api.mjs';
import {database} from '../backend/database.mjs';

const params=(extra={})=>new URLSearchParams({q:'synthetic graph research',source:'crossref',...extra});
const cr=(i=1,extra={})=>({DOI:'10.1234/synthetic'+i,title:['Synthetic research '+i],type:'journal-article',published:{'date-parts':[[2024]]},...extra});
const ep=(i=1,extra={})=>({id:String(i),source:'MED',title:'Synthetic research '+i,pubYear:'2024',doi:'10.1234/synthetic'+i,pubTypeList:{pubType:['Journal Article']},...extra});
const oa=(i=1,extra={})=>({id:'https://openalex.org/W'+i,title:'Synthetic research '+i,type:'article',publication_year:2024,doi:'https://doi.org/10.1234/synthetic'+i,...extra});
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const cross=(rows,total=100)=>json({message:{items:rows,'total-results':total}});
const europe=(rows,total=100)=>json({resultList:{result:rows},hitCount:total});
const openalex=(rows,total=100)=>json({results:rows,meta:{count:total}});
const atom=(doi=true,total=100)=>new Response(`<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>${total}</opensearch:totalResults><entry><id>http://arxiv.org/abs/2610.01234v1</id><title>Synthetic preprint</title><published>2026-10-18T12:00:00Z</published><updated>2026-10-18T12:00:00Z</updated><author><name>Owned Synthetic Author</name></author>${doi?'<arxiv:doi>10.1234/synthetic</arxiv:doi>':''}</entry></feed>`,{headers:{'content-type':'application/atom+xml'}});

test('source lists deduplicate known IDs and all new query values remain strictly bounded',()=>{
 const q=parseLiteratureQuery(params({source:'crossref, europepmc,crossref',type:'thesis',hasDoi:'false',hasCitations:'true',page:'5',sort:'citations'}));
 assert.equal(q.source,'crossref,europepmc');assert.equal(q.hasDoi,false);assert.equal(q.hasCitations,true);assert.equal(q.page,5);assert.equal(q.type,'thesis');
 assert.equal(parseLiteratureQuery(params({source:Array(7).fill('crossref').join(',')})).source,'crossref');
 for(const extra of [{source:'all,crossref'},{source:'all,all'},{source:'crossref,'},{source:'crossref,semantic'},{source:'crossref\n'},{type:'unknown'},{type:''},{hasDoi:'1'},{hasCitations:''},{page:'0'},{page:'6'},{page:'1.0'},{page:'01'},{page:''},{source:'arxiv,crossref',dateFrom:'2026-01-01'},{source:'arxiv,crossref',sort:'submittedDate'},{api_key:'private'},{cursorMark:'untrusted'}])assert.throws(()=>parseLiteratureQuery(params(extra)),{status:400});
 const duplicate=params({hasDoi:'true'});duplicate.append('hasDoi','false');assert.throws(()=>parseLiteratureQuery(duplicate),{status:400});
 for(const type of ['all','journal','thesis','book','report','chapter','preprint','conference','other'])assert.equal(parseLiteratureQuery(params({type})).type,type);
});

test('Crossref offset and provider sorting are bounded; year and count unknowns sort last',async()=>{
 const urls=[],service=createLiteratureSearch({fetchImpl:async url=>{urls.push(new URL(url));return cross([cr(1,{'is-referenced-by-count':null,published:null}),cr(2,{'is-referenced-by-count':0,published:{'date-parts':[[2020]]}}),cr(3,{'is-referenced-by-count':12,published:{'date-parts':[[2025]]}})]);}});
 const result=await service.search(params({page:'3',limit:'3',sort:'citations'}));
 assert.equal(urls[0].searchParams.get('offset'),'6');assert.equal(urls[0].searchParams.get('rows'),'3');assert.equal(urls[0].searchParams.get('sort'),'is-referenced-by-count');assert.equal(urls[0].searchParams.get('order'),'desc');
 assert.deepEqual(result.items.map(x=>x.doi),['10.1234/synthetic3','10.1234/synthetic2','10.1234/synthetic1']);assert.equal(result.items[2].citationCount,undefined);assert.equal(result.items[1].citationCount,0);assert.equal(result.page,3);assert.equal(result.returnedCount,3);assert.equal(result.hasMore,true);assert.equal(result.total,100);
 const years=await service.search(params({limit:'3',sort:'year'}));assert.deepEqual(years.items.map(x=>x.year),[2025,2020,null]);assert.equal(urls[1].searchParams.get('sort'),'published');
});

test('page five is the last possible window even with a provider total far above the cap',async()=>{
 const service=createLiteratureSearch({fetchImpl:async()=>cross([cr()],1000000)});
 const result=await service.search(params({page:'5'}));assert.equal(result.page,5);assert.equal(result.hasMore,false);assert.equal(result.sources[0].hasMore,false);assert.equal(result.window.maxPages,5);
});

test('current window filters use inbound citations, reject unknown counts, and never reuse an unfiltered total',async()=>{
 const make=()=>createLiteratureSearch({fetchImpl:async()=>cross([cr(1,{'references-count':50}),cr(2,{'is-referenced-by-count':0}),cr(3,{'is-referenced-by-count':3}),cr(4,{'is-referenced-by-count':-1})])});
 const cited=await make().search(params({hasCitations:'true'}));assert.deepEqual(cited.items.map(x=>x.doi),['10.1234/synthetic3']);assert.equal(cited.total,undefined);assert.equal(cited.sources[0].total,undefined);assert.equal(cited.sources[0].filterScope,'window');
 const uncited=await make().search(params({hasCitations:'false'}));assert.deepEqual(uncited.items.map(x=>x.doi),['10.1234/synthetic2']);assert.equal(uncited.items[0].citationCount,0);
 let calls=0;const impossible=createLiteratureSearch({fetchImpl:async()=>{calls++;return cross([]);}});const result=await impossible.search(params({hasDoi:'false'}));assert.equal(result.items.length,0);assert.equal(result.sources[0].status,'ok');assert.equal(result.hasMore,false);assert.equal(calls,0);
});

test('all normalized types genuinely filter returned metadata and unknown absent types do not become other',async()=>{
 const raw={journal:'journal-article',thesis:'dissertation',book:'edited-book',report:'report',chapter:'book-chapter',preprint:'posted-content',conference:'proceedings-article',other:'dataset'};
 for(const [type,native]of Object.entries(raw)){
  let target;const service=createLiteratureSearch({fetchImpl:async url=>{target=new URL(url);return cross([cr(1,{type:native}),cr(2,{type:undefined}),cr(3,{type:type==='journal'?'book':'journal-article'})]);}});
  const result=await service.search(params({type}));assert.equal(result.items.length,1,type);assert.equal(result.items[0].documentType,type);assert.match(target.searchParams.get('filter'),new RegExp('(?:^|,)type:'+native+'(?:,|$)'));assert.equal(result.sources[0].filterScope,undefined);assert.equal(result.total,100);
 }
});

test('bibliographic maps return actual supplied strings, structured authors and keywords with markup removed',async()=>{
 const service=createLiteratureSearch({fetchImpl:async()=>cross([cr(1,{author:[{given:'Owned',family:'Author'},{name:'Second &amp; Author'}],'container-title':['<b>Synthetic Journal</b>'],publisher:'Synthetic Press',volume:'7',issue:'2',page:'4-12',subject:['graphs','graphs','<i>methods</i>'],'is-referenced-by-count':'5'})])});
 const item=(await service.search(params())).items[0];assert.deepEqual(item.authorNames,['Owned Author','Second & Author']);assert.deepEqual(item.keywords,['graphs','methods']);assert.deepEqual([item.journal,item.publisher,item.volume,item.issue,item.pages,item.documentType,item.citationCount],['Synthetic Journal','Synthetic Press','7','2','4-12','journal',5]);
});

test('Europe PMC uses at most 100 fetched records then slices a bounded window rather than fabricating offset or total',async()=>{
 let target;const service=createLiteratureSearch({fetchImpl:async url=>{target=new URL(url);return europe(Array.from({length:100},(_,i)=>ep(i+1)),999999);}});
 const result=await service.search(params({source:'europepmc',page:'3',limit:'20'}));assert.equal(target.searchParams.get('pageSize'),'60');assert.equal(target.searchParams.has('offset'),false);assert.equal(target.searchParams.has('cursorMark'),false);assert.equal(result.items[0].sourceId,'MED:41');assert.equal(result.items.at(-1).sourceId,'MED:60');assert.equal(result.total,undefined);assert.equal(result.sources[0].total,undefined);assert.equal(result.sources[0].pagination.mode,'window');assert.equal(result.sources[0].pagination.windowLimit,100);assert.equal(result.hasMore,true);
 const last=await createLiteratureSearch({fetchImpl:async url=>{assert.equal(new URL(url).searchParams.get('pageSize'),'100');return europe(Array.from({length:100},(_,i)=>ep(i+1)),999999);}}).search(params({source:'europepmc',page:'5',limit:'20'}));assert.equal(last.items[0].sourceId,'MED:81');assert.equal(last.hasMore,false);
});

test('Europe PMC DOI and cited filters/sorts remain server-owned and verified again against mapped metadata',async()=>{
 let target;const service=createLiteratureSearch({fetchImpl:async url=>{target=new URL(url);return europe([ep(1,{citedByCount:2}),ep(2,{citedByCount:0}),ep(3,{citedByCount:5,doi:''}),ep(4,{citedByCount:null})]);}});
 const result=await service.search(params({source:'europepmc',q:'graphs OR HAS_DOI:N',hasDoi:'true',hasCitations:'true',sort:'citations'}));assert.equal(result.items.length,1);assert.equal(result.items[0].citationCount,2);assert.match(target.searchParams.get('query'),/^"graphs" AND "OR" AND "HAS_DOI:N" AND HAS_DOI:Y AND CITED:\[1 TO \*\] sort_cited:y$/);
 let negative;const zero=await createLiteratureSearch({fetchImpl:async url=>{negative=new URL(url);return europe([ep(1,{doi:'',citedByCount:'0'}),ep(2,{citedByCount:0}),ep(3,{doi:'',citedByCount:undefined})]);}}).search(params({source:'europepmc',hasDoi:'false',hasCitations:'false',sort:'year'}));assert.equal(zero.items.length,1);assert.match(negative.searchParams.get('query'),/HAS_DOI:N AND CITED:0 sort_date:y$/);
});

test('Europe PMC core metadata mapping retains actual author, book publisher and journal details',async()=>{
 const result=await createLiteratureSearch({fetchImpl:async()=>europe([ep(1,{authorList:{author:[{fullName:'Owned A'},{firstName:'Owned',lastName:'B'}]},journalInfo:{journal:{title:'Real Journal'},volume:'4',issue:'1'},pageInfo:'12-20',bookOrReportDetails:{publisher:'Real Publisher'},keywordList:{keyword:['real keyword']},citedByCount:0})])}).search(params({source:'europepmc'}));
 const item=result.items[0];assert.deepEqual(item.authorNames,['Owned A','Owned B']);assert.equal(item.journal,'Real Journal');assert.equal(item.publisher,'Real Publisher');assert.equal(item.volume,'4');assert.equal(item.issue,'1');assert.equal(item.pages,'12-20');assert.equal(item.citationCount,0);assert.deepEqual(item.keywords,['real keyword']);
});

test('OpenAlex uses actual native filter/page/sort fields and never selects authenticated full-text URLs',async()=>{
 let target;const service=createLiteratureSearch({openAlexApiKey:'synthetic-key',fetchImpl:async url=>{target=new URL(url);return openalex([oa(1,{type:'dissertation',cited_by_count:7}),oa(2,{type:'article',cited_by_count:7}),oa(3,{type:'dissertation',cited_by_count:undefined})]);}});
 const result=await service.search(params({source:'openalex',type:'thesis',hasDoi:'true',hasCitations:'true',sort:'citations',page:'2',limit:'3'}));assert.equal(target.searchParams.get('page'),'2');assert.equal(target.searchParams.get('per_page'),'3');assert.equal(target.searchParams.get('sort'),'cited_by_count:desc');assert.match(target.searchParams.get('filter'),/has_doi:true,cited_by_count:>0,type:dissertation$/);assert.match(target.searchParams.get('select'),/primary_location,biblio,type,cited_by_count,keywords/);assert.doesNotMatch(target.searchParams.get('select'),/content_urls/);assert.equal(result.items.length,1);assert.equal(result.items[0].documentType,'thesis');assert.equal(result.total,100);
});

test('OpenAlex missing counts remain unknown and actual location/biblio metadata is bounded',async()=>{
 const service=createLiteratureSearch({openAlexApiKey:'synthetic-key',fetchImpl:async()=>openalex([oa(1,{cited_by_count:null,primary_location:{source:{type:'journal',display_name:'Synthetic Journal',host_organization:'https://openalex.org/P1',host_organization_name:'Actual Publisher'}},biblio:{volume:'5',issue:'2',first_page:'14',last_page:'22'},keywords:[{display_name:'Graphs'}],authorships:[{author:{display_name:'Owned Author'}}]}),oa(2,{cited_by_count:0})])});
 const result=await service.search(params({source:'openalex',sort:'citations'})),item=result.items[1];assert.equal(item.citationCount,undefined);assert.equal(item.journal,'Synthetic Journal');assert.equal(item.publisher,'Actual Publisher');assert.equal(item.pages,'14-22');assert.deepEqual(item.keywords,['Graphs']);assert.deepEqual(item.authorNames,['Owned Author']);assert.equal(result.items[0].citationCount,0);
});

test('AMiner free pagination stays on the authorized route and bucket is not an exact count',async()=>{
 const urls=[],service=createLiteratureSearch({aminerEnabled:true,aminerApiKey:'synthetic-key',aminerUserId:'synthetic-user',fetchImpl:async url=>{urls.push(new URL(url));return json({code:200,success:true,total:100,data:[{id:'507f1f77bcf86cd799439011',title:'Synthetic title',first_author:'Owned Author',doi:'10.1234/aminer',year:2025,venue_name:'Actual venue',n_citation_bucket:'11-50'},{id:'507f1f77bcf86cd799439012',title:'Unknown citations',year:2025}]});}});
 const result=await service.search(params({source:'aminer',hasCitations:'true',page:'2',limit:'2'}));assert.equal(urls[0].pathname,'/gateway/open_platform/api/paper/search');assert.equal(urls[0].searchParams.get('page'),'2');assert.equal(urls[0].searchParams.get('size'),'2');assert.equal(result.items.length,1);assert.equal(result.items[0].citationCount,undefined);assert.equal(result.items[0].citationBucket,'11-50');assert.equal(result.items[0].venue,'Actual venue');assert.deepEqual(result.items[0].authorNames,['Owned Author']);assert.equal(result.total,undefined);assert.equal(result.sources[0].filterScope,'window');
 for(const extra of [{type:'journal'},{sort:'year'},{sort:'citations'},{openAccess:'true'}]){const r=await service.search(params({source:'aminer',...extra}));assert.equal(r.sources[0].status,'unsupported_filter');assert.equal(r.items.length,0);}assert.equal(urls.length,1);
});

test('arXiv start/year sorting and DOI filtering preserve its preprint/OA contract',async()=>{
 const query=parseLiteratureQuery(params({source:'arxiv',page:'4',limit:'3',sort:'year'})),url=arxivQueryURL(query);assert.equal(url.searchParams.get('start'),'9');assert.equal(url.searchParams.get('sortBy'),'submittedDate');
 const result=await createLiteratureSearch({fetchImpl:async()=>atom(false)}).search(params({source:'arxiv',hasDoi:'false',type:'preprint'}));assert.equal(result.items.length,1);assert.equal(result.items[0].documentType,'preprint');assert.equal(result.items[0].openAccess,true);assert.equal(result.items[0].citationCount,undefined);assert.deepEqual(result.items[0].authorNames,['Owned Synthetic Author']);assert.equal(result.total,undefined);assert.equal(result.sources[0].filterScope,'window');
 let calls=0;const unsupported=createLiteratureSearch({fetchImpl:async()=>{calls++;return atom();}});for(const extra of [{hasCitations:'true'},{hasCitations:'false'},{sort:'citations'}]){const r=await unsupported.search(params({source:'arxiv',...extra}));assert.equal(r.sources[0].status,'unsupported_filter');}const empty=await unsupported.search(params({source:'arxiv',type:'book'}));assert.equal(empty.sources[0].status,'ok');assert.equal(empty.items.length,0);assert.equal(calls,0);
});

test('cross-source DOI merge retains all declared OA links and citation counts without summing overlapping indexes',async()=>{
 const service=createLiteratureSearch({openAlexApiKey:'synthetic-key',fetchImpl:async url=>new URL(url).hostname==='api.crossref.org'?cross([cr(1,{'is-referenced-by-count':4,author:[{name:'First Author'}]})]):new URL(url).hostname==='www.ebi.ac.uk'?europe([ep(1,{citedByCount:12,isOpenAccess:'Y',pmcid:'PMC1234',authorString:'Second Author'})]):openalex([oa(1,{cited_by_count:9,open_access:{is_oa:true,oa_url:'https://owned.example/oa'},best_oa_location:{is_oa:true,pdf_url:'https://owned.example/paper.pdf'},keywords:[{display_name:'Actual keyword'}]})])});
 const result=await service.search(params({source:'crossref,europepmc,openalex'})),item=result.items[0];assert.equal(result.items.length,1);assert.equal(item.source,'crossref');assert.equal(item.citationCount,12);assert.equal(item.citationCountSource,'europepmc');assert.deepEqual(item.sourceProvenance.map(p=>p.citationCount),[4,12,9]);assert.deepEqual(item.sourceProvenance.map(p=>p.source),['crossref','europepmc','openalex']);assert.equal(item.openAccess,true);assert.deepEqual(item.fullTextUrls,['https://europepmc.org/articles/PMC1234','https://owned.example/paper.pdf']);assert.deepEqual(item.keywords,['Actual keyword']);assert.equal(result.total,undefined);assert.equal(result.returnedCount,1);
});

test('cross-source cited-state conflicts use positive evidence without inventing an exact bucket count',async()=>{
 const make=()=>createLiteratureSearch({aminerEnabled:true,aminerApiKey:'synthetic-key',aminerUserId:'synthetic-user',fetchImpl:async url=>new URL(url).hostname==='api.crossref.org'?cross([cr(1,{'is-referenced-by-count':0})]):json({code:200,success:true,data:[{id:'507f1f77bcf86cd799439011',title:'Same work',doi:'10.1234/synthetic1',n_citation_bucket:'11-50'}]})});
 const cited=await make().search(params({source:'crossref,aminer',hasCitations:'true'}));assert.equal(cited.items.length,1);assert.equal(cited.items[0].citationCount,0);assert.equal(cited.items[0].citationCountSource,'crossref');assert.equal(cited.items[0].citationBucket,'11-50');assert.equal(cited.items[0].sourceProvenance.length,2);
 const uncited=await make().search(params({source:'crossref,aminer',hasCitations:'false'}));assert.equal(uncited.items.length,0);
});

test('bounded aggregate windows disclose candidates omitted by the display cap',async()=>{
 const service=createLiteratureSearch({fetchImpl:async url=>new URL(url).hostname==='api.crossref.org'?cross([cr(1),cr(2)],2):europe([ep(3),ep(4)],2)});
 const result=await service.search(params({source:'crossref,europepmc',limit:'2'}));assert.equal(result.returnedCount,2);assert.equal(result.window.candidateCount,4);assert.equal(result.window.truncated,true);assert.equal(result.hasMore,false);assert.equal(result.total,undefined);
});

test('new params and explicit multi-source authorization cannot cross cached administrator scope',async()=>{
 let time=1000000;const calls=[],service=createLiteratureSearch({clock:()=>time,aminerEnabled:true,aminerApiKey:'synthetic-key',aminerUserId:'synthetic-user',fetchImpl:async url=>{const u=new URL(url);calls.push(u);return u.hostname==='api.crossref.org'?cross([cr(1,{'is-referenced-by-count':0})]):json({code:200,success:true,total:1,data:[{id:'507f1f77bcf86cd799439011',title:'Internal synthetic',doi:'10.1234/internal'}]});}});
 const selected=params({source:'crossref,aminer'}),admin=await service.search(selected,{allowAminer:true});assert.equal(admin.items.some(p=>p.source==='aminer'),true);time+=1100;
 const publicResult=await service.search(selected,{allowAminer:false});assert.equal(publicResult.items.some(p=>p.source==='aminer'),false);assert.equal(publicResult.sources.find(s=>s.id==='aminer').status,'not_configured');assert.equal(calls.filter(u=>u.hostname==='datacenter.aminer.cn').length,1);
 const keys=[{},{page:'2'},{type:'journal'},{hasCitations:'false'},{hasDoi:'true'},{sort:'year'},{sort:'citations'}];for(const extra of keys){time+=1100;await service.search(params(extra));}assert.equal(calls.filter(u=>u.hostname==='api.crossref.org').length,2+keys.length);
});

test('public endpoint returns the new window envelope and multiple-source flags without creating billing records',async t=>{
 const db=database(':memory:'),api=createAPI(db,{cancel(){}},{getAI:()=>({aiEnabled:false}),aminerEnabled:true,aminerAccess:'internal',aminerApiKey:'synthetic-key',aminerUserId:'synthetic-user',literatureFetch:async url=>{assert.equal(new URL(url).hostname,'api.crossref.org');return cross([cr(1,{'is-referenced-by-count':2})]);}}),server=http.createServer((req,res)=>void api(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/literature/search?'+params({source:'crossref,aminer',hasDoi:'true',hasCitations:'true',page:'2',sort:'citations'}));assert.equal(response.status,200);const value=await response.json();assert.equal(value.page,2);assert.equal(value.returnedCount,1);assert.equal(value.items[0].citationCount,2);assert.equal(value.sources.find(s=>s.id==='aminer').status,'not_configured');assert.equal(value.window.scope,'per_source');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,0);for(const name of ['billing_quotes','billing_reservations'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name))assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+name).get().n,0);
});
