import test from 'node:test';
import assert from 'node:assert/strict';
import {createCitationVerifier,auditWritingConsistency,writingReviewTask,parseWritingReview} from '../backend/writing-quality.mjs';

const reference=(extra={})=>({id:'ref-1',title:'Evidence and research methods',authors:'Jane Smith',year:'2025',doi:'10.1234/example',confirmed:true,...extra});
const record=(extra={})=>({status:'ok',message:{DOI:'10.1234/example',title:['Evidence and research methods'],author:[{given:'Jane',family:'Smith'}],published:{'date-parts':[[2025]]},...extra}});
const json=(value,options={})=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'},...options});
const atom=(entries=[])=>'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>'+entries.length+'</opensearch:totalResults>'+entries.map(({id='2609.00065v1',title='Evidence and research methods'})=>'<entry><id>https://arxiv.org/abs/'+id+'</id><title>'+title+'</title><published>2026-09-01T00:00:00Z</published><updated>2026-09-02T00:00:00Z</updated><author><name>Jane Smith</name></author><summary>Public abstract.</summary></entry>').join('')+'</feed>';
const xml=value=>new Response(value,{headers:{'content-type':'application/atom+xml'}});

test('citation verification uses only a fixed official GET identifier route and never transmits manuscript fields',async()=>{
 const calls=[],input=reference({text:'PRIVATE-MANUSCRIPT-BODY',url:'http://127.0.0.1/private',privateField:'PRIVATE-USER-SECRET'}),before=structuredClone(input);
 const result=await createCitationVerifier({fetchImpl:async(url,options)=>{calls.push({url:new URL(url),options});return json(record());}}).verify([input]);
 assert.equal(calls.length,1);assert.equal(calls[0].url.origin,'https://api.crossref.org');assert.equal(decodeURIComponent(calls[0].url.pathname),'/works/10.1234/example');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.body,undefined);assert.equal(calls[0].options.headers.Authorization,undefined);
 assert.doesNotMatch(JSON.stringify(calls),/PRIVATE-|127\.0\.0\.1/);assert.deepEqual(input,before);assert.equal(result.items[0].metadataStatus,'matched');assert.equal(result.items[0].claimSupport,'not_checked');assert.equal(result.claimSupport,'not_checked');assert.equal(result.requests,1);assert.equal(result.summary.matched,1);assert.match(result.limitations.join(''),/不证明/);
});

test('DOI punctuation is path encoded and cannot inject a request host, query or filter',async()=>{
 const value='10.1234/https://evil.invalid/path?api_key=steal#fragment',calls=[];
 const result=await createCitationVerifier({fetchImpl:async(url)=>{calls.push(new URL(url));return json(record({DOI:value}));}}).verify([reference({doi:value})]);
 assert.equal(calls.length,1);assert.equal(calls[0].hostname,'api.crossref.org');assert.equal(calls[0].search,'');assert.equal(calls[0].hash,'');assert.equal(result.items[0].metadataStatus,'matched');
});

test('a successful provider response must return the requested identifier before it can count as matched',async()=>{
 const result=await createCitationVerifier({fetchImpl:async()=>json(record({DOI:'10.1234/unrelated'}))}).verify([reference()]);
 assert.equal(result.items[0].metadataStatus,'unavailable');assert.equal(result.summary.matched,0);assert.equal(result.items[0].record,undefined);
});

test('metadata conflicts are reviewable field differences rather than false-paper accusations',async()=>{
 const result=await createCitationVerifier({fetchImpl:async()=>json(record())}).verify([reference({title:'An unrelated title',authors:'Another Author',year:'2022'})]);
 const item=result.items[0];assert.equal(item.metadataStatus,'conflict');assert.deepEqual(item.conflictingFields,['title','year','authors']);assert.equal(item.claimSupport,'not_checked');assert.match(item.reason,/人工核对/);assert.doesNotMatch(item.reason,/伪造|造假|不存在/);
});

test('bibliographic punctuation, abbreviated author lists and online versus print years do not create conflicts',async()=>{
 const result=await createCitationVerifier({fetchImpl:async()=>json(record({'published-online':{'date-parts':[[2024]]}}))}).verify([reference({title:'Evidence & research methods',authors:'Smith J, et al.',year:'2024'}),reference({id:'b',title:'Evidence and research methods',authors:'Smith J, et al.',year:'2024'})]);
 assert.equal(result.items[0].fieldChecks.authors,'matched');assert.equal(result.items[0].fieldChecks.year,'matched');assert.equal(result.items[1].metadataStatus,'matched');assert.equal(result.requests,1);assert.equal(result.cacheHits,1);
});

test('references without public identifiers remain unverified without sending private Chinese titles or fetching user URLs',async()=>{
 let calls=0;const result=await createCitationVerifier({fetchImpl:async()=>{calls++;throw Error();}}).verify([reference({doi:'',title:'未公开的中文毕业论文研究题目',url:'https://example.org/fulltext'}),reference({id:'b',doi:'not-a-doi'}),reference({id:'c',doi:'',url:'http://169.254.169.254/latest/meta-data'})]);
 assert.equal(calls,0);assert.ok(result.items.every(row=>row.metadataStatus==='unverified'));assert.equal(result.summary.not_found,0);assert.doesNotMatch(JSON.stringify(result),/未公开的中文毕业论文研究题目|169\.254/);
});

test('unconfirmed references and malformed input never spend metadata requests',async()=>{
 let calls=0;const verifier=createCitationVerifier({fetchImpl:async()=>{calls++;return xml(atom([{id:'2609.00065v1'}]));}});
 const result=await verifier.verify([reference({confirmed:false}),reference({id:'arxiv:2609.00065',doi:'',url:'https://arxiv.org/abs/2609.00065',confirmed:false})]);assert.equal(calls,0);assert.ok(result.items.every(row=>row.metadataStatus==='unverified'));
 await assert.rejects(verifier.verify([null,reference()]),error=>error.status===400);assert.equal(calls,0);await assert.rejects(verifier.verify(Array.from({length:201},reference)),error=>error.status===400);
});

test('arXiv identifiers are verified in one bounded official id_list request and are never treated as missing DOI failures',async()=>{
 const calls=[],inputs=[reference({id:'arxiv:2609.00065',year:'2026',doi:'10.48550/arXiv.2609.00065',url:''}),reference({id:'second',year:'2026',doi:'',url:'https://arxiv.org/pdf/2609.00066v2.pdf'})];
 const result=await createCitationVerifier({openAlexApiKey:'private-openalex-key',fetchImpl:async(url,options)=>{calls.push({url:new URL(url),options});return xml(atom([{id:'2609.00065v1'},{id:'2609.00066v2'}]));}}).verify(inputs);
 assert.equal(calls.length,1);assert.equal(calls[0].url.origin,'https://export.arxiv.org');assert.equal(calls[0].url.pathname,'/api/query');assert.equal(calls[0].url.searchParams.get('id_list'),'2609.00065,2609.00066v2');assert.equal(calls[0].url.searchParams.get('max_results'),'2');assert.equal(calls[0].options.headers.Authorization,undefined);assert.ok(result.items.every(row=>row.metadataStatus==='matched'&&row.provider==='arxiv'));assert.equal(result.requests,1);
});

test('an arXiv response for another version or identifier cannot verify the requested version',async()=>{
 const result=await createCitationVerifier({fetchImpl:async()=>xml(atom([{id:'2609.00065v3'}]))}).verify([reference({id:'arxiv:2609.00065v2',year:'2026',doi:''})]);
 assert.equal(result.items[0].metadataStatus,'not_found');assert.match(result.items[0].reason,/不代表文献不存在/);
});

test('arXiv direct lookups reject XML entities and unexpected content without following document links',async()=>{
 let calls=0;const result=await createCitationVerifier({fetchImpl:async()=>{calls++;return xml('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+atom([]));}}).verify([reference({id:'arxiv:2609.00065',doi:''})]);
 assert.equal(calls,1);assert.equal(result.items[0].metadataStatus,'unavailable');
});

test('Crossref misses can use the configured OpenAlex key only in its own Authorization header',async()=>{
 const calls=[],secret='SERVER-OPENALEX-PRIVATE';const verifier=createCitationVerifier({openAlexApiKey:secret,fetchImpl:async(url,options)=>{const u=new URL(url);calls.push({u,options});return u.hostname==='api.crossref.org'?json({}, {status:404}):json({id:'https://openalex.org/W123',doi:'https://doi.org/10.1234/example',title:'Evidence and research methods',publication_year:2025,authorships:[{author:{display_name:'Jane Smith'}}]});}});
 const result=await verifier.verify([reference()]);assert.equal(calls.length,2);assert.equal(calls[0].options.headers.Authorization,undefined);assert.equal(calls[1].u.origin,'https://api.openalex.org');assert.equal(calls[1].options.headers.Authorization,'Bearer '+secret);assert.equal(calls[1].u.searchParams.has('api_key'),false);assert.equal(result.items[0].metadataStatus,'matched');assert.equal(result.items[0].provider,'openalex');assert.doesNotMatch(JSON.stringify(result),/SERVER-OPENALEX-PRIVATE/);
});

test('a public OpenAlex identifier works without a DOI but does not silently bypass missing configuration',async()=>{
 let calls=0;const input=reference({id:'openalex:W123',doi:''}),fetchImpl=async()=>{calls++;return json({id:'https://openalex.org/W123',title:input.title,publication_year:2025,authorships:[]});};
 const missing=await createCitationVerifier({fetchImpl}).verify([input]);assert.equal(missing.items[0].metadataStatus,'unavailable');assert.equal(calls,0);
 const present=await createCitationVerifier({fetchImpl,openAlexApiKey:'configured'}).verify([input]);assert.equal(calls,1);assert.equal(present.items[0].metadataStatus,'matched');assert.equal(present.items[0].fieldChecks.authors,'not_checked');
});

test('request ceilings and UTC day budgets leave remaining references visibly unverified',async()=>{
 let calls=0,time=Date.parse('2026-10-22T23:59:59Z');const verifier=createCitationVerifier({maxRequests:1,dailyLimit:1,clock:()=>time,cacheTtlMs:1,fetchImpl:async()=>{calls++;return json(record());}});
 const first=await verifier.verify([reference(),reference({id:'b',doi:'10.1234/second'})]);assert.equal(calls,1);assert.equal(first.items[1].metadataStatus,'unverified');assert.equal(first.requests,1);
 time+=5;const second=await verifier.verify([reference()]);assert.equal(second.items[0].metadataStatus,'unverified');assert.equal(calls,1);
 time+=86400000;const next=await verifier.verify([reference()]);assert.equal(next.items[0].metadataStatus,'matched');assert.equal(calls,2);
});

test('metadata cache is bounded, expires, and cannot be changed by a caller mutating returned records',async()=>{
 let calls=0,time=1000;const verifier=createCitationVerifier({clock:()=>time,cacheTtlMs:100,maxCacheEntries:1,fetchImpl:async url=>{calls++;const value=decodeURIComponent(new URL(url).pathname.slice('/works/'.length));return json(record({DOI:value}));}});
 const first=await verifier.verify([reference()]);first.items[0].record.title='tampered';const cached=await verifier.verify([reference()]);assert.equal(cached.items[0].record.title,reference().title);assert.equal(calls,1);
 await verifier.verify([reference({doi:'10.1234/second'})]);await verifier.verify([reference()]);assert.equal(calls,3);time+=101;await verifier.verify([reference()]);assert.equal(calls,4);
});

test('timeouts are bounded even when a provider ignores AbortSignal and errors never expose diagnostics',async()=>{
 const started=Date.now(),result=await createCitationVerifier({timeoutMs:50,fetchImpl:async()=>new Promise(()=>{})}).verify([reference()]);assert.ok(Date.now()-started<1000);assert.equal(result.items[0].metadataStatus,'unavailable');
 const failed=await createCitationVerifier({fetchImpl:async()=>{throw Error('SECRET upstream body and API key');}}).verify([reference()]);assert.equal(failed.items[0].metadataStatus,'unavailable');assert.doesNotMatch(JSON.stringify(failed),/SECRET|API key/);
});

test('bad content type, oversized responses, malformed JSON and source failure are not metadata verification',async()=>{
 for(const response of [new Response('html',{headers:{'content-type':'text/html'}}),new Response('x'.repeat(600),{headers:{'content-type':'application/json'}}),new Response('{',{headers:{'content-type':'application/json'}}),json({message:'SECRET'}, {status:429})]){
  const result=await createCitationVerifier({maxResponseBytes:512,fetchImpl:async()=>response}).verify([reference()]);assert.equal(result.items[0].metadataStatus,'unavailable');assert.doesNotMatch(JSON.stringify(result),/SECRET/);
 }
});

test('cancellation stops verification rather than turning an aborted operation into a matched record',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(createCitationVerifier().verify([reference()],{signal:controller.signal}),{name:'AbortError'});
 const active=new AbortController(),verifier=createCitationVerifier({fetchImpl:async()=>new Promise(()=>{})}),pending=verifier.verify([reference()],{signal:active.signal});setTimeout(()=>active.abort(),10);await assert.rejects(pending,{name:'AbortError'});
});

test('deterministic audit locates unresolved gaps and unknown citations in actual manuscript text',()=>{
 const text='研究说明。\n\n【待补充：调查记录与样本说明】\n\n研究观点[source:known]和另一处[source:invented]。',result=auditWritingConsistency({chapters:[{id:'c1',title:'研究方法',text,sourceIds:['known']}],references:[{id:'known',confirmed:true}]});
 assert.equal(result.status,'review_required');assert.equal(result.checkedSections,1);assert.deepEqual(result.findings.map(row=>row.category),['unresolved_placeholder','unknown_citation']);for(const finding of result.findings)assert.equal(text.slice(finding.offset,finding.offset+finding.quote.length),finding.quote);
});

test('deterministic audit compares source markers and lists without accepting unconfirmed materials',()=>{
 const result=auditWritingConsistency({chapters:[{id:'c',title:'方法',text:'说明[source:a]，待确认[source:b]。',sourceIds:['c']}],materials:[{id:'a',confirmed:true},{id:'b',confirmed:false},{id:'c',confirmed:true}]});
 assert.deepEqual(result.findings.map(row=>row.category),['citation_list_mismatch','unknown_citation','uncited_source']);assert.equal(result.findings.at(-1).field,'sourceIds');
});

test('duplicate title and substantive paragraph findings identify both locations without inferring numeric contradictions',()=>{
 const paragraph='这是一个可重复定位的完整论证段落，用于说明两个章节是否出现了相同的大段内容。'.repeat(3),result=auditWritingConsistency({chapters:[{id:'a',title:'研究方法',text:paragraph},{id:'b',title:'研究方法',text:'另一个引导段。\n\n'+paragraph}]});
 assert.deepEqual(result.findings.map(row=>row.category),['duplicate_title','duplicate_paragraph']);assert.equal(result.findings[1].relatedSectionId,'a');assert.equal(result.findings[1].offset,'另一个引导段。\n\n'.length);
 const numbers=auditWritingConsistency({chapters:[{id:'x',title:'真实范围待核对',text:'实验组为10人，对照组为20人。不同场景数值不能只凭数字不同就推断矛盾。'}]});assert.equal(numbers.findings.length,0);assert.equal(numbers.status,'no_deterministic_issues');assert.match(numbers.limitations.join(''),/未核实/);
});

test('deterministic findings are capped with an explicit omitted count and do not mutate source chapters',()=>{
 const chapters=[{id:'c',title:'方法',text:'【待补充：研究资料】'.repeat(4)}],before=structuredClone(chapters),result=auditWritingConsistency({chapters,maxFindings:2});
 assert.equal(result.findings.length,2);assert.equal(result.totalFindings,4);assert.equal(result.truncated,true);assert.deepEqual(chapters,before);
});

const manuscript=()=>[{id:'methods',title:'研究方法',text:'本文采用问卷方法进行拟开展研究，实际调查尚未执行。'},{id:'results',title:'结果框架',text:'本节仅规划拟开展的指标分析，尚无实测数据。'}];
const aiFinding=(extra={})=>({sectionId:'methods',quote:'本文采用问卷方法',category:'claim_scope',severity:'warning',explanation:'建议进一步澄清这是拟开展的方法。',suggestion:'保留拟开展的措辞并由作者核对。',...extra});
const aiResult=(findings=[],extra={})=>({text:JSON.stringify({complete:true,findings,limitations:['仅检查已提供草稿片段。'],...extra})});

test('review task includes bounded real excerpts, reports partial coverage and does not grant network or hidden-source tools',()=>{
 const chapters=[{id:'a',title:'章节',text:'研'.repeat(27000)},{id:'b',title:'未提供章节',text:'PRIVATE-EXCLUDED-SECTION'}],task=writingReviewTask({snapshot:{title:'论文',profile:{level:'硕士',language:'中文'},materials:[{text:'PRIVATE-SOURCE-BODY'}]},chapters});
 assert.equal(task.skill,'writing-review');assert.equal(task.context.manuscriptExcerpts.length,1);assert.equal(task.context.manuscriptExcerpts[0].text.length,26000);assert.equal(task.context.scope.excerpted,true);assert.equal(task.context.manuscriptExcerpts[0].totalCharacters,27000);assert.deepEqual(task.materials,[]);assert.doesNotMatch(JSON.stringify(task),/PRIVATE-EXCLUDED|PRIVATE-SOURCE-BODY/);assert.match(task.instructions,/不调用网络/);
});

test('review parsing binds every finding to a real section and an exact manuscript quote',()=>{
 const task=writingReviewTask({chapters:manuscript()}),result=parseWritingReview(aiResult([aiFinding()]),task),finding=result.findings[0];
 assert.equal(result.status,'review_required');assert.equal(result.scope,'provided_manuscript_excerpts_only');assert.equal(result.checkedSections,2);assert.equal(finding.offset,0);assert.equal(finding.grounding,'exact_manuscript_quote');assert.equal(finding.requiresReview,true);assert.match(result.limitations.join(''),/不构成事实核验/);
});

test('a completed review with no located findings is limited to supplied excerpts rather than a quality certification',()=>{
 const task=writingReviewTask({chapters:manuscript()}),result=parseWritingReview(aiResult(),task);assert.equal(result.status,'no_ai_findings');assert.equal(result.requiresReview,true);assert.equal(result.findings.length,0);assert.equal(result.excerpted,false);
});

test('review rejects invented locations, altered quotations, unsupported verdicts and duplicate findings',()=>{
 const task=writingReviewTask({chapters:manuscript()});for(const findings of [[aiFinding({sectionId:'invented'})],[aiFinding({quote:'这是原稿里不存在的文字'})],[aiFinding({severity:'error'})],[aiFinding({category:'fraud'})],[aiFinding(),aiFinding()]])assert.throws(()=>parseWritingReview(aiResult(findings),task),error=>error.code==='invalid_review_output');
});

test('review refuses truncated, malformed and incomplete responses while preserving the caller manuscript',()=>{
 const chapters=manuscript(),before=structuredClone(chapters),task=writingReviewTask({chapters});for(const result of [{text:'{'},{...aiResult(),truncated:true},{...aiResult(),finishReason:'max_tokens'},aiResult([],{complete:false}),aiResult([],{limitations:[42]})])assert.throws(()=>parseWritingReview(result,task),error=>error.code==='invalid_review_output');assert.deepEqual(chapters,before);
});


test('review task submits its complete findings contract through the authorized tool and freezes after acceptance',()=>{
 const task=writingReviewTask({chapters:manuscript()});
 assert.match(task.instructions,/作为 candidate 提交 submit_writing_output/);
 assert.match(task.instructions,/accepted=false.*按反馈修正完整候选/);
 assert.match(task.instructions,/accepted=true 后结果已冻结，立即结束/);
 assert.doesNotMatch(task.instructions,/check_text_length|只返回完整JSON/);
 assert.deepEqual(task.materials,[]);
});
