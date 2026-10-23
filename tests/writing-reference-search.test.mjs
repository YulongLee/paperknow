import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {buildReferenceSearchQuery,normalizeReferenceSearchItem,newReferenceSearchItems,safeReferenceURL,mountWritingReferenceSearch,openWritingReferenceSearch} from '../dist/workspace/writing-reference-search.mjs';
import {literatureKey} from '../dist/workspace/literature-model.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let i=0;i<4;i++)await tick();};
const paper=(extra={})=>({id:'cr-1',source:'crossref',sourceId:'10.1234/real-source',title:'Research methods in education',authors:'A. Researcher',year:2024,doi:'10.1234/real-source',url:'https://doi.org/10.1234/real-source',abstract:'Database abstract only.',...extra});
const reply=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
const results=(items=[paper()],extra={})=>({items,sources:[{id:'crossref',label:'Crossref',status:'ok'},{id:'europepmc',label:'Europe PMC',status:'ok'}],query:{q:'education'},partial:false,...extra});
function fixture(options={}){
 const dom=new JSDOM('<dialog id="workspace-dialog" open><h1 id="workspace-dialog-title"></h1><div id="workspace-dialog-body"><div id="search-host"></div></div></dialog>',{url:'https://example.test/workspace.html#tool/writing'});
 for(const key of ['window','document','location','AbortController'])globalThis[key]=dom.window[key];
 const calls=[],imports=[];let stop;
 const base={container:document.getElementById('search-host'),context:{title:'Education feedback',keywords:'learning, education'},getExisting:()=>[],onImport:rows=>imports.push(rows),fetcher:async(url,init)=>{calls.push({url,init});return reply(results());}};
 const setup=extra=>{const settings={...base,...options,...extra},fetcher=settings.fetcher;settings.fetcher=(url,init)=>url==='/api/capabilities'?Promise.resolve(reply({academicSearchSources:options.availableSources||['crossref','europepmc'],academicSearchSourceStatus:options.sourceStatus||[]})):fetcher(url,init);return stop=mountWritingReferenceSearch(settings);};
 const $=selector=>document.querySelector(selector);
 return {dom,calls,imports,$,setup,close(){stop?.();document.querySelector('#workspace-dialog')?.dispatchEvent(new dom.window.Event('close'));dom.window.close();}};
}
function input(f,selector,value){const target=f.$(selector);target.value=value;target.dispatchEvent(new window.Event('input',{bubbles:true}));}
function submit(f){f.$('.wrs-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));}
function choose(f,index=0){const target=f.$('.wrs-results').querySelectorAll('[data-ref-select]')[index];target.checked=true;target.dispatchEvent(new window.Event('change',{bubbles:true}));return target;}
const bootstrap=fixture();
const {openLiteratureSearch}=await import('../dist/workspace/literature.mjs');
bootstrap.close();

test('recommendation query uses only the supplied title and keywords and keeps a bounded editable query',()=>{
 assert.equal(buildReferenceSearchQuery({title:'  AI feedback  ',keywords:'AI feedback, learning、learning'}),'AI feedback learning');
 assert.equal(buildReferenceSearchQuery({major:'艺术学'}),'艺术学');assert.equal(buildReferenceSearchQuery({}), '');
 assert.equal(buildReferenceSearchQuery({title:'x'.repeat(240),keywords:['another']} ).length,200);
});
test('search metadata never claims a read or confirmed full text and unsafe links are discarded',()=>{
 const value=normalizeReferenceSearchItem(paper({url:'javascript:alert(1)',fullTextUrl:'https://user:secret@example.test/private',text:'Do not import unrequested full text.',scope:'full',confirmed:true,fullTextRead:true}));
 assert.equal(value.scope,'metadata');assert.equal(value.text,'');assert.equal(value.confirmed,false);assert.equal(value.fullTextRead,false);assert.equal(value.fullTextUrl,'');assert.match(value.url,/^https:\/\/doi.org\//);assert.match(value.sourceLabel,/未读取全文/);
 assert.equal(safeReferenceURL('data:text/html,content'),'');assert.equal(safeReferenceURL('https://example.test/paper'),'https://example.test/paper');assert.equal(normalizeReferenceSearchItem({title:''}),null);
});
test('deduplication uses DOI and normalized title plus year without replacing existing notes or text',()=>{
 const original={id:'local-1',title:'Research methods in education',year:'2024',doi:'https://doi.org/10.1234/REAL-SOURCE',notes:[{text:'my note'}],text:'user text'};
 assert.equal(newReferenceSearchItems([paper()], [original]).length,0);
 assert.equal(newReferenceSearchItems([paper({doi:'',source:'europepmc',sourceId:'pm1',title:'Research Methods — in Education'})], [original]).length,0);
 assert.equal(newReferenceSearchItems([paper(),paper({source:'europepmc',sourceId:'pm1',id:'pm1'})]).length,1);
 assert.equal(original.text,'user text');assert.equal(original.notes[0].text,'my note');
});
test('keyword search is explicit, uses only GET metadata filters and shows partial provider availability',async()=>{
 const f=fixture({fetcher:async(url,init)=>{f.calls.push({url,init});return reply(results([paper()],{partial:true,sources:[{id:'crossref',label:'Crossref',status:'unsupported_filter',reason:'该来源不支持开放获取筛选。'},{id:'europepmc',label:'Europe PMC',status:'ok'}]}));}});
 const stop=f.setup();await stop.ready;assert.equal(f.calls.length,0);
 input(f,'[name=q]','feedback learning');input(f,'[name=yearFrom]','2020');input(f,'[name=yearTo]','2025');f.$('[name=openAccess]').checked=true;submit(f);await settle();
 const request=f.calls[0],url=new URL(request.url,'https://example.test');assert.equal(url.pathname,'/api/literature/search');assert.equal(url.searchParams.get('q'),'feedback learning');assert.equal(url.searchParams.get('yearFrom'),'2020');assert.equal(url.searchParams.get('yearTo'),'2025');assert.equal(url.searchParams.get('openAccess'),'true');assert.equal(url.searchParams.get('limit'),'10');assert.equal(request.init.method,'GET');assert.equal(request.init.body,undefined);
 assert.match(f.$('[data-ref-status]').textContent,/部分来源/);assert.match(f.$('[data-ref-sources]').textContent,/不支持当前筛选/);assert.equal(f.imports.length,0);assert.match(f.$('.wrs-results').textContent,/未读全文/);f.close();
});
test('configured OpenAlex is selectable in the shared search and imports only traceable metadata',async()=>{
 const f=fixture({availableSources:['crossref','europepmc','openalex'],fetcher:async(url,init)=>{f.calls.push({url,init});return reply(results([paper({source:'openalex',sourceId:'W123456',doi:'',url:'https://openalex.org/W123456',fullTextUrl:'https://repository.example.test/paper.pdf',openAccess:true})],{sources:[{id:'openalex',status:'ok'}]}));}}),stop=f.setup();
 await stop.ready;assert.deepEqual([...f.$('[name=source]').options].map(option=>option.value),['all','crossref','europepmc','openalex']);assert.match(f.$('[data-ref-provider-description]').textContent,/OpenAlex/);
 input(f,'[name=source]','openalex');input(f,'[name=q]','education');f.$('[name=openAccess]').checked=true;submit(f);await settle();
 const request=new URL(f.calls[0].url,'https://example.test');assert.equal(request.searchParams.get('source'),'openalex');assert.equal(request.searchParams.get('openAccess'),'true');assert.match(f.$('[data-ref-sources]').textContent,/OpenAlex已检索/);assert.match(f.$('.wrs-result-index').textContent,/OpenAlex/);assert.match(f.$('.wrs-result-links').textContent,/开放获取/);
 choose(f);f.$('[data-ref-import]').click();await settle();assert.equal(f.imports[0][0].source,'openalex');assert.match(f.imports[0][0].sourceLabel,/OpenAlex.*未读取全文/);assert.equal(f.imports[0][0].scope,'metadata');assert.equal(f.imports[0][0].text,'');assert.equal(f.imports[0][0].fullTextRead,false);f.close();
});
test('configured PubMed and Semantic Scholar search and import actual metadata without trusting full-text claims',async()=>{
 for(const [source,label,sourceURL] of [['pubmed','PubMed','https://pubmed.ncbi.nlm.nih.gov/12345678/'],['semantic_scholar','Semantic Scholar','https://www.semanticscholar.org/paper/1234567890abcdef']]){
  const f=fixture({availableSources:[source],fetcher:async(url,init)=>{f.calls.push({url,init});return reply(results([paper({source,sourceId:'record-1',sourceLabel:'CNKI full-text access',url:sourceURL,scope:'full',text:'Unrequested text',confirmed:true,fullTextRead:true,citationCount:8,citationCountSource:source,sourceProvenance:[{source,sourceId:'record-1',citationCount:8}]})],{sources:[{id:source,status:'ok'}]}));}}),stop=f.setup();
  try{await stop.ready;assert.deepEqual([...f.$('[name=source]').options].map(option=>option.value),['all',source]);input(f,'[name=source]',source);submit(f);await settle();assert.equal(new URL(f.calls[0].url,'https://example.test').searchParams.get('source'),source);assert.ok(f.$('[data-ref-sources]').textContent.includes(label));assert.ok(f.$('.wrs-result-index').textContent.includes(label));choose(f);f.$('[data-ref-import]').click();await settle();const saved=f.imports[0][0];assert.equal(saved.source,source);assert.equal(saved.sourceLabel,label+' · 在线题录，未读取全文');assert.equal(saved.sourceId,'record-1');assert.equal(saved.citationCountSource,source);assert.deepEqual(saved.sourceProvenance.map(({source,sourceId,citationCount})=>({source,sourceId,citationCount})),[{source,sourceId:'record-1',citationCount:8}]);assert.equal(saved.scope,'metadata');assert.equal(saved.text,'');assert.equal(saved.fullTextRead,false);assert.equal(saved.confirmed,false);assert.doesNotMatch(f.$('.writing-reference-search').textContent,/CNKI full-text access/);if(source==='pubmed'){assert.equal(f.$('[data-ref-pubmed-notice]').hidden,false);assert.equal(f.$('[data-ref-pubmed-notice] a').href,'https://www.ncbi.nlm.nih.gov/About/disclaimer.html');}}
  finally{f.close();}
 }
});
test('unavailable CNKI and Semantic Scholar show escaped backend reasons without becoming selectable or queried',async()=>{
 const f=fixture({availableSources:['pubmed','cnki'],sourceStatus:[{id:'pubmed',configured:true},{id:'cnki',configured:false,reason:'知网需配置授权检索接口后开放。'},{id:'semantic_scholar',configured:false,reason:'需配置接口密钥及商用许可 <img src=x onerror=alert(1)>'},{id:'unknown',configured:false,reason:'Hidden unknown provider'}]}),stop=f.setup();
 try{await stop.ready;assert.deepEqual([...f.$('[name=source]').options].map(option=>option.value),['all','pubmed']);assert.equal(f.$('[data-ref-availability]').hidden,false);assert.equal(f.$('[data-ref-availability]').open,false);assert.match(f.$('[data-ref-unavailable]').textContent,/知网.*需配置授权检索接口/);assert.match(f.$('[data-ref-unavailable]').textContent,/Semantic Scholar.*需配置接口密钥及商用许可 <img/);assert.equal(f.$('[data-ref-unavailable] img'),null);assert.doesNotMatch(f.$('[data-ref-unavailable]').textContent,/Hidden unknown provider/);assert.equal(f.calls.length,0);assert.equal(f.$('[data-ref-pubmed-notice] a').rel,'noopener noreferrer');}
 finally{f.close();}
});
test('all seven genuine bibliographic provenance sources survive normalization without accepting CNKI as an integrated provider',()=>{
 const sources=['crossref','europepmc','openalex','arxiv','aminer','pubmed','semantic_scholar'],value=normalizeReferenceSearchItem(paper({sourceProvenance:[...sources.map(source=>({source,sourceId:source+'-1'})),{source:'cnki',sourceId:'not-connected'}]}));assert.deepEqual(value.sourceProvenance.map(row=>row.source),sources);assert.equal(value.text,'');assert.equal(value.scope,'metadata');
});
const arxivPaper=(extra={})=>paper({source:'arxiv',sourceId:'2610.12345',arxivId:'2610.12345v2',title:'A current arXiv preprint',doi:'',url:'https://arxiv.org/abs/2610.12345v2',fullTextUrl:'https://arxiv.org/pdf/2610.12345v2',pdfUrl:'https://arxiv.org/pdf/2610.12345v2',type:'preprint',publishedDate:'2026-10-18T09:30:00Z',updatedDate:'2026-10-19T10:00:00Z',categories:['cs.AI','cs.LG'],openAccess:true,...extra});
test('arXiv is discoverable, defaults to latest submission, and keeps chronology filters scoped to arXiv',async()=>{
 const f=fixture({availableSources:['crossref','arxiv'],fetcher:async(url,init)=>{f.calls.push({url,init});return reply(results([arxivPaper()],{sources:[{id:'arxiv',status:'ok'}]}));}}),stop=f.setup();
 try{
  await stop.ready;assert.equal(f.$('[data-ref-arxiv]').hidden,false);assert.equal(f.$('[name=source]').closest('details'),null);assert.equal(f.$('[data-ref-arxiv-controls]').hidden,true);assert.match(f.$('[data-ref-arxiv-attribution]').textContent,/Thank you to arXiv for use of its open access interoperability\./);
  input(f,'[name=q]','language models');f.$('[data-ref-arxiv]').click();await settle();let query=new URL(f.calls[0].url,'https://example.test').searchParams;
  assert.equal(query.get('source'),'arxiv');assert.equal(query.get('sort'),'submittedDate');assert.equal(f.$('[data-ref-arxiv-controls]').hidden,false);assert.match(f.$('.wrs-result-heading').textContent,/最新提交/);
  assert.match(f.$('.wrs-result').textContent,/预印本.*首次提交 2026-10-18（UTC）.*最近更新 2026-10-19（UTC）/);assert.match(f.$('.wrs-preprint-note').textContent,/未必经过同行评审/);
  assert.deepEqual([...f.$('.wrs-result-links').querySelectorAll('a')].map(link=>link.href),['https://arxiv.org/abs/2610.12345v2','https://arxiv.org/pdf/2610.12345v2']);
  input(f,'[name=sort]','lastUpdatedDate');input(f,'[name=dateRange]','7');submit(f);await settle();query=new URL(f.calls[1].url,'https://example.test').searchParams;
  assert.equal(query.get('sort'),'lastUpdatedDate');assert.match(query.get('dateFrom'),/^\d{4}-\d{2}-\d{2}$/);assert.equal((Date.parse(query.get('dateTo'))-Date.parse(query.get('dateFrom')))/86400000,6);
  input(f,'[name=source]','all');f.$('[name=source]').dispatchEvent(new window.Event('change',{bubbles:true}));submit(f);await settle();query=new URL(f.calls[2].url,'https://example.test').searchParams;
  assert.equal(query.get('sort'),null);assert.equal(query.get('dateFrom'),null);assert.equal(f.$('[data-ref-arxiv-controls]').hidden,true);assert.match(f.$('.wrs-result-heading').textContent,/按数据库返回顺序/);
 }finally{f.close();}
});
test('arXiv metadata canonicalizes public links, validates dates and deduplicates different versions',()=>{
 const value=normalizeReferenceSearchItem(arxivPaper({url:'https://evil.test/fake',fullTextUrl:'javascript:bad',pdfUrl:'https://user:secret@example.test/',categories:['cs.AI','<img>','cs.AI'],updatedDate:'2026-02-31T10:00:00Z',text:'not imported',confirmed:true}));
 assert.equal(value.url,'https://arxiv.org/abs/2610.12345v2');assert.equal(value.pdfUrl,'https://arxiv.org/pdf/2610.12345v2');assert.equal(value.fullTextUrl,value.pdfUrl);assert.equal(value.sourceId,'2610.12345');assert.equal(value.publishedDate,'2026-10-18T09:30:00.000Z');assert.equal(value.updatedDate,'');assert.deepEqual(value.categories,['cs.AI']);assert.equal(value.text,'');assert.equal(value.confirmed,false);assert.equal(value.fullTextRead,false);
 assert.equal(newReferenceSearchItems([arxivPaper({title:'Changed title',arxivId:'2610.12345v3'})],[value]).length,0);
 const old=normalizeReferenceSearchItem(arxivPaper({sourceId:'hep-th/9901001',arxivId:'hep-th/9901001v1'}));assert.equal(old.url,'https://arxiv.org/abs/hep-th/9901001v1');
 const invalid=normalizeReferenceSearchItem(arxivPaper({arxivId:'../../admin'}));assert.equal(invalid.url,'');assert.equal(invalid.pdfUrl,'');
});
test('arXiv import preserves searchable metadata and dates in the local library without claiming full text',async()=>{
 const f=fixture(),previousFetch=globalThis.fetch;let stop;
 try{
  globalThis.localStorage=f.dom.window.localStorage;globalThis.fetch=async url=>reply(url==='/api/capabilities'?{academicSearchSources:['arxiv']}:results([arxivPaper()],{sources:[{id:'arxiv',status:'ok'}]}));
  stop=openLiteratureSearch({modal:(_,html)=>{f.$('#workspace-dialog-body').innerHTML=html;},notify:()=>{}});await stop.ready;input(f,'[name=q]','language models');f.$('[data-ref-arxiv]').click();await settle();choose(f);f.$('[data-ref-import]').click();await settle();
  const saved=JSON.parse(localStorage.getItem(literatureKey))[0];assert.equal(saved.source,'arxiv');assert.equal(saved.arxivId,'2610.12345v2');assert.equal(saved.sourceId,'2610.12345');assert.equal(saved.pdfUrl,'https://arxiv.org/pdf/2610.12345v2');assert.equal(saved.publishedDate,'2026-10-18T09:30:00.000Z');assert.equal(saved.updatedDate,'2026-10-19T10:00:00.000Z');assert.deepEqual(saved.categories,['cs.AI','cs.LG']);assert.equal(saved.type,'preprint');assert.equal(saved.scope,'metadata');assert.equal(saved.text,'');assert.equal(saved.abstract,'Database abstract only.');assert.equal(saved.status,'unread');assert.equal(saved.confirmed,false);assert.equal(saved.fullTextRead,false);
 }finally{stop?.();globalThis.fetch=previousFetch;f.close();}
});
test('closing an arXiv request cancels its signal and late results cannot paint or import',async()=>{
 let complete,signal;const f=fixture({availableSources:['arxiv'],fetcher:(_url,init)=>new Promise(resolve=>{complete=resolve;signal=init.signal;})}),stop=f.setup();
 try{await stop.ready;input(f,'[name=q]','language models');f.$('[data-ref-arxiv]').click();assert.equal(f.$('[data-ref-results]').getAttribute('aria-busy'),'true');stop();assert.equal(signal.aborted,true);f.$('#workspace-dialog-body').innerHTML='<p>Another screen</p>';complete(reply(results([arxivPaper()])));await settle();assert.equal(f.$('#workspace-dialog-body').textContent,'Another screen');assert.equal(f.imports.length,0);}finally{f.close();}
});
test('configured AMiner follows capabilities and imports academic metadata without claiming full-text access',async()=>{
 const f=fixture({availableSources:['crossref','aminer','aminer','unknown'],fetcher:async(url,init)=>{f.calls.push({url,init});return reply(results([paper({source:'aminer',sourceId:'507f1f77bcf86cd799439011',url:'https://www.aminer.cn/pub/507f1f77bcf86cd799439011',sourceLabel:'CNKI synchronized full text',text:'Unrequested text',confirmed:true,fullTextRead:true})],{sources:[{id:'aminer',status:'ok',reason:'private provider details'}]}));}}),stop=f.setup();
 try{
  await stop.ready;assert.deepEqual([...f.$('[name=source]').options].map(option=>option.value),['all','crossref','aminer']);assert.match(f.$('[data-ref-provider-description]').textContent,/AMiner 提供跨学科学术题录/);assert.match(f.$('[data-ref-provider-description]').textContent,/AMiner 检索提供学术题录，导入后可继续补充全文和阅读笔记。/);assert.doesNotMatch(f.$('[data-ref-provider-description]').textContent,/摘要|知网|查重/);
  input(f,'[name=source]','aminer');input(f,'[name=q]','人工智能 教育');submit(f);await settle();const request=new URL(f.calls[0].url,'https://example.test');assert.equal(request.searchParams.get('source'),'aminer');assert.equal(request.searchParams.get('q'),'人工智能 教育');assert.match(f.$('[data-ref-sources]').textContent,/AMiner已检索/);assert.match(f.$('.wrs-result-index').textContent,/AMiner/);assert.equal(f.$('.wrs-result-links a').href,'https://www.aminer.cn/pub/507f1f77bcf86cd799439011');assert.doesNotMatch(f.$('.writing-reference-search').textContent,/CNKI synchronized full text|private provider details/);
  choose(f);f.$('[data-ref-import]').click();await settle();const saved=f.imports[0][0];assert.equal(saved.source,'aminer');assert.equal(saved.sourceId,'507f1f77bcf86cd799439011');assert.equal(saved.sourceLabel,'AMiner · 在线题录，未读取全文');assert.equal(saved.scope,'metadata');assert.equal(saved.abstract,'Database abstract only.');assert.equal(saved.text,'');assert.equal(saved.confirmed,false);assert.equal(saved.fullTextRead,false);
 }finally{f.close();}
});
test('unconfigured OpenAlex is absent and source availability follows server capabilities',async()=>{
 const f=fixture({availableSources:['europepmc']}),stop=f.setup();await stop.ready;assert.deepEqual([...f.$('[name=source]').options].map(option=>option.value),['all','europepmc']);assert.doesNotMatch(f.$('[data-ref-provider-description]').textContent,/OpenAlex|Crossref|AMiner/);assert.equal(f.calls.length,0);f.close();
});
test('AMiner failures and unsupported filters use fixed actionable messages without exposing provider details',async()=>{
 const cases=[['not_configured',503,/暂未开放/],['budget_exhausted',503,/今日检索额度已用完/],['rate_limited',503,/请求较多/],['error',503,/暂时无法响应/],['unsupported_filter',200,/暂不支持开放获取筛选/]];
 for(const [status,httpStatus,message] of cases){
  const f=fixture({availableSources:['aminer'],fetcher:async()=>reply({error:'private provider details',items:[],sources:[{id:'aminer',status,reason:'private provider details'}],partial:true},httpStatus)}),stop=f.setup();
  try{await stop.ready;input(f,'[name=source]','aminer');submit(f);await settle();assert.match(f.$('[data-ref-sources]').textContent,message);if(httpStatus!==200)assert.match(f.$('[data-ref-error]').textContent,message);assert.doesNotMatch(f.$('.writing-reference-search').textContent,/private provider details/);assert.equal(f.imports.length,0);assert.equal(f.$('[data-ref-import]').disabled,true);}finally{f.close();}
 }
 const f=fixture({availableSources:['aminer'],fetcher:async()=>reply({error:'private provider details'},503)}),stop=f.setup();
 try{await stop.ready;input(f,'[name=source]','aminer');submit(f);await settle();assert.match(f.$('[data-ref-error]').textContent,/AMiner 暂时无法响应/);assert.doesNotMatch(f.$('.writing-reference-search').textContent,/private provider details/);}finally{f.close();}
});
test('AMiner exhaustion leaves successful aggregate references selectable',async()=>{
 const f=fixture({availableSources:['crossref','aminer'],mode:'recommend',fetcher:async()=>reply(results([paper()],{partial:true,sources:[{id:'crossref',status:'ok'},{id:'aminer',status:'budget_exhausted',reason:'private budget details'}]}))}),stop=f.setup();
 try{await stop.ready;assert.match(f.$('[data-ref-sources]').textContent,/AMiner今日检索额度已用完/);assert.match(f.$('[data-ref-status]').textContent,/部分来源暂不可用/);assert.doesNotMatch(f.$('.writing-reference-search').textContent,/private budget details/);choose(f);f.$('[data-ref-import]').click();await settle();assert.equal(f.imports.length,1);assert.equal(f.imports[0][0].source,'crossref');}finally{f.close();}
});
test('OpenAlex daily budget and unavailable configuration show actionable messages without exposing provider details',async()=>{
 for(const status of ['budget_exhausted','not_configured']){
  const f=fixture({availableSources:['crossref','europepmc','openalex'],fetcher:async()=>reply({error:'Upstream private configuration details',sources:[{id:'openalex',status,reason:'Upstream private configuration details'}]},503)}),stop=f.setup();await stop.ready;input(f,'[name=source]','openalex');submit(f);await settle();
  assert.match(f.$('[data-ref-error]').textContent,status==='budget_exhausted'?/今日检索额度已用完/:/暂未开放/);assert.match(f.$('[data-ref-sources]').textContent,/OpenAlex/);assert.doesNotMatch(f.$('.writing-reference-search').textContent,/Upstream private configuration details/);assert.equal(f.imports.length,0);assert.equal(f.$('[data-ref-import]').disabled,true);f.close();
 }
});
test('an exhausted OpenAlex source does not hide successful aggregate results or permit full-text claims',async()=>{
 const f=fixture({availableSources:['crossref','europepmc','openalex'],mode:'recommend',fetcher:async()=>reply(results([paper()],{partial:true,sources:[{id:'crossref',status:'ok'},{id:'openalex',status:'budget_exhausted'}]}))}),stop=f.setup();await stop.ready;
 assert.match(f.$('[data-ref-sources]').textContent,/Crossref已检索/);assert.match(f.$('[data-ref-sources]').textContent,/OpenAlex今日检索额度已用完/);assert.match(f.$('.wrs-result').textContent,/Research methods in education/);assert.match(f.$('.wrs-result').textContent,/未读全文/);choose(f);f.$('[data-ref-import]').click();await settle();assert.equal(f.imports.length,1);f.close();
});
test('recommended results are real metadata, require selection to import, and remain pending confirmation',async()=>{
 const f=fixture({mode:'recommend'}),stop=f.setup();await stop.ready;assert.equal(f.calls.length,1);assert.match(new URL(f.calls[0].url,'https://example.test').searchParams.get('q'),/Education feedback/);
 assert.equal(f.$('[data-ref-import]').disabled,true);choose(f);f.$('[data-ref-import]').click();await settle();assert.equal(f.imports.length,1);const row=f.imports[0][0];assert.equal(row.confirmed,false);assert.equal(row.fullTextRead,false);assert.equal(row.text,'');assert.equal(row.scope,'metadata');assert.equal(row.abstract,'Database abstract only.');assert.match(f.$('[data-ref-status]').textContent,/引用仍待核对确认/);assert.equal(f.$('[data-ref-select]').disabled,true);
 f.$('[data-ref-import]').click();await settle();assert.equal(f.imports.length,1);f.close();
});
test('late duplicate detection blocks re-adding an item introduced while the results were open',async()=>{
 let existing=[];const f=fixture({getExisting:()=>existing}),stop=f.setup({mode:'recommend'});await stop.ready;choose(f);existing=[paper({id:'existing-local'})];f.$('[data-ref-import]').click();await settle();assert.equal(f.imports.length,0);assert.match(f.$('[data-ref-status]').textContent,/无需重复添加/);f.close();
});
test('failed import retains the selection for an explicit retry and never creates a fake success',async()=>{
 let attempts=0;const f=fixture({mode:'recommend',onImport:rows=>{attempts++;if(attempts===1)throw Error('草稿保存失败，请保留现有内容。');f.imports.push(rows);}}),stop=f.setup();await stop.ready;choose(f);f.$('[data-ref-import]').click();await settle();assert.match(f.$('[data-ref-error]').textContent,/草稿保存失败/);assert.equal(f.$('[data-ref-select]').checked,true);assert.equal(f.$('[data-ref-import]').disabled,false);assert.equal(f.imports.length,0);
 f.$('[data-ref-import]').click();await settle();assert.equal(f.imports.length,1);assert.equal(f.$('[data-ref-error]').textContent,'');f.close();
});
test('untrusted titles, abstracts and source messages are escaped and all external links are safe',async()=>{
 const f=fixture({mode:'recommend',fetcher:async()=>reply(results([paper({title:'<img src=x onerror=alert(1)>',abstract:'<script>unsafe()</script>',url:'javascript:alert(1)',doi:'',fullTextUrl:'data:text/html,unsafe'})],{sources:[{id:'crossref',status:'error',reason:'<img src=x onerror=1>'}]}))}),stop=f.setup();await stop.ready;
 assert.equal(f.$('img'),null);assert.equal(f.$('script'),null);assert.equal(f.$('.wrs-result-links a'),null);assert.match(f.$('.wrs-result').textContent,/<script>unsafe/);assert.match(f.$('[data-ref-sources]').textContent,/<img/);f.close();
});
test('an older request cannot replace newer results even if the network ignores abort',async()=>{
 const pending=[];const f=fixture({fetcher:(url,init)=>new Promise(resolve=>{pending.push({url,init,resolve});})}),stop=f.setup();await stop.ready;
 input(f,'[name=q]','first query');submit(f);input(f,'[name=q]','second query');submit(f);assert.equal(pending[0].init.signal.aborted,true);
 pending[1].resolve(reply(results([paper({title:'Newer result',id:'new',sourceId:'new'})])));await settle();pending[0].resolve(reply(results([paper({title:'Older result'})])));await settle();assert.match(f.$('.wrs-results').textContent,/Newer result/);assert.doesNotMatch(f.$('.wrs-results').textContent,/Older result/);f.close();
});
test('cancel clears loading immediately and ignored-abort results cannot be imported',async()=>{
 let complete,signal;const f=fixture({fetcher:(url,init)=>new Promise(resolve=>{complete=resolve;signal=init.signal;})}),stop=f.setup();await stop.ready;submit(f);f.$('[data-ref-cancel]').click();assert.equal(signal.aborted,true);assert.equal(f.$('[data-ref-results]').getAttribute('aria-busy'),'false');assert.match(f.$('[data-ref-status]').textContent,/已取消/);complete(reply(results()));await settle();assert.equal(f.$('[data-ref-select]'),null);assert.equal(f.imports.length,0);f.close();
});
test('route changes and removal of the modal abort requests without painting another page',async()=>{
 let complete,signal;const f=fixture({fetcher:(url,init)=>new Promise(resolve=>{complete=resolve;signal=init.signal;})}),stop=f.setup();await stop.ready;submit(f);location.hash='#home';window.dispatchEvent(new window.HashChangeEvent('hashchange'));assert.equal(signal.aborted,true);f.$('#workspace-dialog-body').innerHTML='<h2>其他页面</h2>';complete(reply(results()));await settle();assert.equal(f.$('#workspace-dialog-body').textContent,'其他页面');assert.equal(f.imports.length,0);f.close();
});
test('provider failures show retry and empty results remain honest without invented references',async()=>{
 let requests=0;const f=fixture({fetcher:async()=>{requests++;return requests===1?reply({error:'数据库暂时不可用',sources:[{id:'crossref',status:'error',reason:'连接超时'}]},503):reply(results([]));}}),stop=f.setup();await stop.ready;submit(f);await settle();assert.match(f.$('[data-ref-error]').textContent,/数据库暂时不可用/);assert.match(f.$('[data-ref-sources]').textContent,/连接超时/);f.$('[data-ref-retry]').click();await settle();assert.equal(requests,2);assert.equal(f.$('[data-ref-error]').textContent,'');assert.match(f.$('.wrs-results').textContent,/暂未找到匹配文献/);assert.equal(f.$('[data-ref-import]').disabled,true);assert.equal(f.imports.length,0);f.close();
});
test('invalid terms and inverted years cannot trigger a network request',async()=>{
 const f=fixture(),stop=f.setup();await stop.ready;input(f,'[name=q]','x');submit(f);await settle();assert.match(f.$('[data-ref-error]').textContent,/2–200/);assert.equal(f.calls.length,0);input(f,'[name=q]','education');input(f,'[name=yearFrom]','2025');input(f,'[name=yearTo]','2020');submit(f);await settle();assert.match(f.$('[data-ref-error]').textContent,/起始年份不能晚于/);assert.equal(f.calls.length,0);f.close();
});
test('modal integration reuses the shared accessible dialog and disposes on close',async()=>{
 const f=fixture();let title;const dispose=openWritingReferenceSearch({modal:(label,html)=>{title=label;f.$('#workspace-dialog-body').innerHTML=html;},onImport:()=>{},context:{},mode:'recommend'});await dispose.ready;assert.equal(title,'推荐参考文献');assert.match(f.$('[data-ref-status]').textContent,/先填写论文题目/);assert.ok(f.$('.writing-reference-search[aria-labelledby]'));f.$('#workspace-dialog').dispatchEvent(new window.Event('close'));assert.equal(f.$('[data-ref-select]'),null);dispose();f.close();
});
test('the shared library search saves metadata atomically and preserves existing full text and notes',async()=>{
 const f=fixture(),previousFetch=globalThis.fetch;let dispose;
 try{
  globalThis.localStorage=f.dom.window.localStorage;
  const existing={id:'local-paper',title:'My imported source',year:'2022',doi:'10.9999/local',text:'User-provided full text.',scope:'full',notes:[{id:'note1',text:'My original note.'}],tags:[],status:'reading'};
  localStorage.setItem(literatureKey,JSON.stringify([existing]));globalThis.fetch=async url=>reply(url==='/api/capabilities'?{academicSearchSources:['crossref','europepmc']}:results());
  const ctx={modal:(_,html)=>{f.$('#workspace-dialog-body').innerHTML=html;},notify:()=>{}};
  dispose=openLiteratureSearch(ctx);await dispose.ready;input(f,'[name=q]','education methods');submit(f);await settle();choose(f);f.$('[data-ref-import]').click();await settle();
  const saved=JSON.parse(localStorage.getItem(literatureKey));assert.equal(saved.length,2);assert.deepEqual(saved[1],existing);assert.equal(saved[0].scope,'metadata');assert.equal(saved[0].text,'');assert.equal(saved[0].confirmed,false);assert.equal(saved[0].status,'unread');assert.equal(saved[0].abstract,'Database abstract only.');assert.equal(saved[0].fullTextRead,false);
  f.$('[data-ref-local]').click();assert.ok(f.$('#lit-search-form'));input(f,'#lit-search-query','My imported');f.$('#lit-search-form').dispatchEvent(new window.Event('submit',{cancelable:true}));assert.match(f.$('#lit-search-results').textContent,/My imported source/);f.$('[data-lit-online-search]').click();assert.ok(f.$('.writing-reference-search'));assert.equal(JSON.parse(localStorage.getItem(literatureKey)).length,2);
 }finally{dispose?.();globalThis.fetch=previousFetch;f.close();}
});
test('a full local library rejects the entire addition and retains the selected search results',async()=>{
 const f=fixture(),previousFetch=globalThis.fetch;let dispose;
 try{
  globalThis.localStorage=f.dom.window.localStorage;
  const before=Array.from({length:200},(_,i)=>({id:'local-'+i,title:'Existing paper '+i,year:'2020',scope:'metadata',text:'',tags:[],notes:[]}));localStorage.setItem(literatureKey,JSON.stringify(before));globalThis.fetch=async url=>reply(url==='/api/capabilities'?{academicSearchSources:['crossref','europepmc']}:results());
  dispose=openLiteratureSearch({modal:(_,html)=>{f.$('#workspace-dialog-body').innerHTML=html;},notify:()=>{}});await dispose.ready;input(f,'[name=q]','education methods');submit(f);await settle();choose(f);f.$('[data-ref-import]').click();await settle();assert.match(f.$('[data-ref-error]').textContent,/最多保存 200 篇/);assert.equal(f.$('[data-ref-select]').checked,true);assert.deepEqual(JSON.parse(localStorage.getItem(literatureKey)),before);
 }finally{dispose?.();globalThis.fetch=previousFetch;f.close();}
});
