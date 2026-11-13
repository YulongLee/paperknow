import test from 'node:test';
import assert from 'node:assert/strict';
import {createCitationVerifier,auditWritingConsistency,writingReviewTask,parseWritingReview} from '../backend/writing-quality.mjs';

const reference=(extra={})=>({id:'ref-1',title:'Evidence and research methods',authors:'Jane Smith',year:'2025',doi:'10.1234/example',confirmed:true,...extra});
const record=(extra={})=>({status:'ok',message:{DOI:'10.1234/example',title:['Evidence and research methods'],author:[{given:'Jane',family:'Smith'}],published:{'date-parts':[[2025]]},...extra}});
const json=(value,options={})=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'},...options});
const atom=(entries=[])=>'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>'+entries.length+'</opensearch:totalResults>'+entries.map(({id='2609.00065v1',title='Evidence and research methods'})=>'<entry><id>https://arxiv.org/abs/'+id+'</id><title>'+title+'</title><published>2026-09-01T00:00:00Z</published><updated>2026-09-02T00:00:00Z</updated><author><name>Jane Smith</name></author><summary>Public abstract.</summary></entry>').join('')+'</feed>';
const xml=value=>new Response(value,{headers:{'content-type':'application/atom+xml'}});

test('a specific ISO standard without an authorized source is a substantive warning',()=>{
 const chapters=[{id:'c',title:'研究方法',text:'本研究参照 ISO 9241-11 设计评价框架。'}];
 const unsupported=auditWritingConsistency({chapters,materials:[{id:'m',confirmed:true,text:'仅有普通研究计划。'}]});
 assert.ok(unsupported.findings.some(x=>x.reasonCode==='unsupported_standard'&&x.severity==='warning'));
 const confirmed=auditWritingConsistency({chapters,materials:[{id:'m',confirmed:true,text:'标准编号 ISO 9241-11 的参考资料。'}]});assert.ok(!confirmed.findings.some(x=>x.reasonCode==='unsupported_standard'));
 const unconfirmed=auditWritingConsistency({chapters,materials:[{id:'m',confirmed:false,text:'ISO 9241-11'}]});assert.ok(unconfirmed.findings.some(x=>x.reasonCode==='unsupported_standard'));
});

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

test('duplicate substantive paragraphs in the same chapter report both locations',()=>{
 const paragraph='该阶段完成需求梳理、材料核对与方案设计，后续依据确认后的资料开展工作。'.repeat(4);
 const text=paragraph+'\n\n一条不同的简短说明。\n\n'+paragraph;
 const result=auditWritingConsistency({chapters:[{id:'task',title:'工作内容',text}]});
 const finding=result.findings.find(row=>row.category==='duplicate_paragraph');
 assert.ok(finding);assert.equal(finding.relatedSectionId,'task');assert.equal(finding.relatedOffset,0);assert.equal(finding.offset,text.lastIndexOf(paragraph));assert.equal(text.slice(finding.offset,finding.offset+finding.quote.length),finding.quote);assert.match(finding.explanation,/本章节/);
});

const manuscript=()=>[{id:'methods',title:'研究方法',text:'本文采用问卷方法进行拟开展研究，实际调查尚未执行。'},{id:'results',title:'结果框架',text:'本节仅规划拟开展的指标分析，尚无实测数据。'}];
const aiFinding=(extra={})=>({sectionId:'methods',quote:'本文采用问卷方法',category:'claim_scope',severity:'warning',explanation:'建议进一步澄清这是拟开展的方法。',suggestion:'保留拟开展的措辞并由作者核对。',...extra});
const aiResult=(findings=[],extra={})=>({text:JSON.stringify({complete:true,findings,limitations:['仅检查已提供草稿片段。'],...extra})});

test('source review receives only cited confirmed text with an explicit limited scope',()=>{
 const snapshot={materials:[{id:'m',confirmed:true,text:'真实材料的确认内容'.repeat(400)},{id:'private',confirmed:true,text:'未引用的隐私内容'},{id:'unconfirmed',confirmed:false,text:'未确认内容'}],references:[{id:'a',confirmed:true,scope:'abstract',text:'已采纳摘要文字仅用于这一有限证据范围。'},{id:'metadata',confirmed:true,title:'没有正文的题录'}]};
 const chapters=[{id:'one',text:'先讨论[source:m]，再引用摘要[source:a]，并包含[source:unconfirmed]和[source:metadata]。'}];
 const before=structuredClone(snapshot),task=writingReviewTask({snapshot,chapters});
 assert.deepEqual(task.context.sourceEvidence.items.map(row=>row.id),['m','a']);
 assert.equal(task.context.sourceEvidence.citedCount,4);assert.equal(task.context.sourceEvidence.providedCount,2);assert.equal(task.context.sourceEvidence.limited,true);
 assert.equal(task.context.sourceEvidence.items[0].text.length,2000);assert.equal(task.context.sourceEvidence.items[0].excerpted,true);assert.equal(task.context.sourceEvidence.items[1].scope,'abstract');
 assert.doesNotMatch(JSON.stringify(task),/未引用的隐私内容|未确认内容/);assert.match(task.instructions,/不证明完整原文没有该事项/);assert.deepEqual(snapshot,before);
});

test('source review caps evidence and excludes ambiguous duplicate identifiers',()=>{
 const materials=Array.from({length:8},(_,i)=>({id:'s'+i,confirmed:true,text:'事实'.repeat(1000)}));materials.push({id:'s0',confirmed:true,text:'不同内容'});
 const task=writingReviewTask({snapshot:{materials},chapters:[{id:'one',text:materials.slice(0,8).map(row=>'引用[source:'+row.id+']。').join('')}]});
 assert.ok(task.context.sourceEvidence.items.length<=6);assert.ok(task.context.sourceEvidence.items.reduce((n,row)=>n+row.text.length,0)<=4000);assert.ok(!task.context.sourceEvidence.items.some(row=>row.id==='s0'));assert.equal(task.context.sourceEvidence.limited,true);
});

test('review task includes bounded real excerpts, reports partial coverage and does not grant network or hidden-source tools',()=>{
 const chapters=[{id:'a',title:'章节',text:'研'.repeat(27000)},{id:'b',title:'未提供章节',text:'PRIVATE-EXCLUDED-SECTION'}],task=writingReviewTask({snapshot:{title:'论文',profile:{level:'硕士',language:'中文'},materials:[{text:'PRIVATE-SOURCE-BODY'}]},chapters});
 assert.equal(task.skill,'writing-review');assert.equal(task.context.manuscriptExcerpts.length,1);assert.equal(task.context.manuscriptExcerpts[0].text.length,26000);assert.equal(task.context.scope.excerpted,true);assert.equal(task.context.manuscriptExcerpts[0].totalCharacters,27000);assert.deepEqual(task.materials,[]);assert.doesNotMatch(JSON.stringify(task),/PRIVATE-EXCLUDED|PRIVATE-SOURCE-BODY/);assert.match(task.instructions,/不调用网络/);
});

test('review parsing binds every finding to a real section and an exact manuscript quote',()=>{
 const task=writingReviewTask({chapters:manuscript()}),result=parseWritingReview(aiResult([aiFinding()]),task),finding=result.findings[0];
 assert.equal(result.status,'review_required');assert.equal(result.scope,'provided_manuscript_excerpts_only');assert.equal(result.checkedSections,2);assert.equal(finding.offset,0);assert.equal(finding.grounding,'exact_manuscript_quote');assert.equal(finding.requiresReview,true);assert.match(result.limitations.join(''),/不构成事实核验/);
});

test('a batch scope limitation cannot be reported as a located structural defect',()=>{
 const task=writingReviewTask({chapters:manuscript()});
 const scope=aiFinding({category:'structure',explanation:'本批未提供参考文献栏目的原句，无法判断其是否存在。这属于检查范围限制，不是已发现的缺失错误。',suggestion:'在阅读全文后核查参考文献。'});
 assert.throws(()=>parseWritingReview(aiResult([scope]),task),/范围限制误列/);
 // Do not silently discard a substantive issue mixed with a scope note.
 const mixed={...scope,explanation:scope.explanation+' 本段明确将未开展的调查写成已完成。'};
 assert.throws(()=>parseWritingReview(aiResult([mixed]),task),/范围限制误列/);
 const actual=aiFinding({category:'structure',explanation:'本段明确将未开展的调查写成已完成，须与资料核对。'});
 assert.equal(parseWritingReview(aiResult([actual]),task).findings.length,1);
 const valid=parseWritingReview(aiResult([actual],{limitations:['本批未提供参考文献，无法判断该栏目是否完整。']}),task);
 assert.equal(valid.findings.length,1);assert.match(valid.limitations.join(''),/无法判断/);
});

test('a reviewer cannot claim an exact phrase is absent from a named source that supplies it',()=>{
 const text='不涉及注意力权重，也不代表模型实测或教学成效[source:followup]。';
 const source={id:'followup',confirmed:true,text:'不是对完整算法、运行时间或教学成效的测量。研究不计算任何注意力权重。'};
 const task=writingReviewTask({snapshot:{materials:[source]},chapters:[{id:'one',title:'范围',text}]});
 const finding={sectionId:'one',quote:'不涉及注意力权重，也不代表模型实测或教学成效',category:'source_support',severity:'warning',explanation:'followup 片段是否单独承载“教学成效”措辞未能仅凭本次提供的文字完全核对。',suggestion:'请核对来源。'};
 assert.throws(()=>parseWritingReview(aiResult([finding]),task),/逐字片段描述与原文不一致/);
 assert.throws(()=>parseWritingReview(aiResult([{...finding,explanation:finding.explanation+' 正文另外声称实验已经完成。'}]),task),/逐字片段描述与原文不一致/);
 // Literal presence alone does not prove semantic entailment; an explicit
 // question about the scope of the claim remains reviewable.
 const semantic={...finding,explanation:'followup 片段虽包含“教学成效”，但无法支持已经完成真实教学的结论。'};
 assert.equal(parseWritingReview(aiResult([semantic]),task).findings.length,1);
 const absentTask=writingReviewTask({snapshot:{materials:[{...source,text:'本研究不计算任何注意力权重。'}]},chapters:[{id:'one',title:'范围',text}]});
 assert.equal(parseWritingReview(aiResult([finding]),absentTask).findings.length,1);
 const ambiguous=writingReviewTask({snapshot:{materials:[{id:'a',confirmed:true,text:'这里提到教学成效。'},{id:'ba',confirmed:true,text:'这里未介绍相关内容。'}]},chapters:[{id:'one',title:'范围',text:'教学成效尚需核对[source:a][source:ba]。'}]});
 const distinct={sectionId:'one',quote:'教学成效尚需核对',category:'source_support',severity:'warning',explanation:'ba来源没有提及“教学成效”，请核实对应论断。',suggestion:'核对 ba 来源。'};
 assert.equal(parseWritingReview(aiResult([distinct]),ambiguous).findings.length,1);
});

test('a completed review with no located findings is limited to supplied excerpts rather than a quality certification',()=>{
 const task=writingReviewTask({chapters:manuscript()}),result=parseWritingReview(aiResult(),task);assert.equal(result.status,'no_ai_findings');assert.equal(result.requiresReview,true);assert.equal(result.findings.length,0);assert.equal(result.excerpted,false);
});

test('optional expression improvements remain informational while substantive unsupported claims remain warnings',()=>{
 const task=writingReviewTask({chapters:manuscript()}),informational=aiFinding({category:'language_expression',severity:'info',explanation:'不同章节重复说明同一方法，可精简表达。'}),substantive=aiFinding({category:'data_support',severity:'warning',quote:'实际调查尚未执行',explanation:'此处需要核对实际调查是否开展。'}),result=parseWritingReview(aiResult([informational,substantive]),task);
 assert.equal(result.findings[0].severity,'info');assert.equal(result.findings[1].severity,'warning');assert.equal(result.findings[1].category,'data_support');
});

test('review rejects invented locations, altered quotations, unsupported verdicts and duplicate findings',()=>{
 const task=writingReviewTask({chapters:manuscript()});for(const findings of [[aiFinding({sectionId:'invented'})],[aiFinding({quote:'这是原稿里不存在的文字'})],[aiFinding({severity:'error'})],[aiFinding({category:'fraud'})],[aiFinding(),aiFinding()]])assert.throws(()=>parseWritingReview(aiResult(findings),task),error=>error.code==='invalid_review_output');
});

test('review refuses truncated, malformed and incomplete responses while preserving the caller manuscript',()=>{
 const chapters=manuscript(),before=structuredClone(chapters),task=writingReviewTask({chapters});for(const result of [{text:'{'},{...aiResult(),truncated:true},{...aiResult(),finishReason:'max_tokens'},aiResult([],{complete:false}),aiResult([],{limitations:[42]})])assert.throws(()=>parseWritingReview(result,task),error=>error.code==='invalid_review_output');assert.deepEqual(chapters,before);
});


test('review task submits its complete findings contract through the authorized tool and freezes after acceptance',()=>{
 const task=writingReviewTask({chapters:manuscript()});
 assert.match(task.instructions,/模板未指定的表格字段、可选栏目与版式建议不得臆造为强制要求，应标 info/);
 assert.match(task.instructions,/有序对 \(i,j\) 表示顺序有区别，并不意味着 i<j/);assert.match(task.instructions,/仅当正文明确将配对数量等同运行时间、资源或计算代价/);
 assert.match(task.instructions,/没有逻辑或数值矛盾时，若确有表达冗余，归 language_expression 且标 info/);assert.match(task.instructions,/实际矛盾、缺证或错引仍须标 warning/);
 assert.match(task.instructions,/未来才制作的对照表或成果不要求当下提供实际字段/);assert.match(task.instructions,/实际数值矛盾仍为 warning/);
 assert.match(task.instructions,/作为 candidate 提交 submit_writing_output/);
 assert.match(task.instructions,/accepted=false.*按反馈修正完整候选/);
 assert.match(task.instructions,/accepted=true 后结果已冻结，立即结束/);
 assert.doesNotMatch(task.instructions,/check_text_length|只返回完整JSON/);
 assert.deepEqual(task.materials,[]);
});

test('graphical captions with placement claims are flagged for review and actual layout accompanies review',()=>{
 const figure={id:'fig1',title:'示意图',kind:'flowchart',nodes:[{id:'a',label:'输入'},{id:'b',label:'输出'}],edges:[{from:'a',to:'b'}],caption:'左侧为输入，右侧为输出。'};
 const chapters=[{id:'c',title:'方法',text:'图示如下：\n\n[figure:fig1]',figures:[figure]}];
 const audit=auditWritingConsistency({chapters});const finding=audit.findings.find(row=>row.category==='figure_consistency');assert.ok(finding);assert.equal(finding.severity,'info');assert.match(finding.explanation,/核对位置/);
 const task=writingReviewTask({chapters});assert.equal(task.context.manuscriptExcerpts[0].figures[0].renderedPositions.length,2);assert.match(task.instructions,/实际渲染位置/);
 const neutral=structuredClone(chapters);neutral[0].figures[0].caption='输入与输出的关系。';assert.ok(!auditWritingConsistency({chapters:neutral}).findings.some(row=>row.category==='figure_consistency'));
});

test('explicit references to missing numbered figures and tables request review without inventing content',()=>{
 const run=text=>auditWritingConsistency({chapters:[{id:'a',title:'分析',text}]});
 assert.ok(run('表1给出了模型比较结果。').findings.some(row=>row.category==='table_consistency'));
 assert.ok(run('如图2所示，研究包含三个阶段。').findings.some(row=>row.category==='figure_consistency'));
 assert.ok(!run('原文的表1给出了比较结果[source:a]。').findings.some(row=>row.category==='table_consistency'));
 const table='表1 结果对比\n\n| 类别 | 指标 |\n| --- | --- |\n| A | 1 |';assert.ok(!auditWritingConsistency({chapters:[{id:'a',title:'分析',text:'表1给出对比。'},{id:'b',title:'结果',text:table}]}).findings.some(row=>row.category==='table_consistency'));
 assert.ok(!run('表1给出结果。\n\n[docx:table1]').findings.some(row=>row.category==='table_consistency'));
});

test('numbered table references are checked against real captions rather than any unrelated table',()=>{
 const table='表1 模拟结果\n| n | C |\n| --- | --- |\n| 8 | 64 |';
 const run=text=>auditWritingConsistency({chapters:[{id:'a',title:'结果',text}]}).findings.filter(row=>row.category==='table_consistency');
 assert.ok(run('如表2所示，配对数为64。\n\n'+table).some(row=>/表号/.test(row.explanation)));
 assert.equal(run('如表1所示，配对数为64。\n\n'+table).length,0);
 assert.equal(run('原文表2所示的结果[source:r]。\n\n'+table).length,0);
 assert.equal(run('如表2所示。\n\n'+table+'\n\n[docx:object]').length,0);
 assert.ok(run('如表2所示。\n\n'+table+'\n```\n表2 假表\n| n | C |\n| --- | --- |\n| 8 | 64 |\n```').some(row=>/表号/.test(row.explanation)));
 assert.ok(run('如表2所示。\n表1 结果\n| --- | --- |\n| n | C |\n| 8 | 64 |').some(row=>/表号/.test(row.explanation)));
 assert.equal(run(table+'\n```\n如表2所示。\n```').length,0);
});

test('literature analysis cannot be checked against metadata alone',()=>{
 const chapters=[{id:'a',title:'分析',text:'根据文献分析发现该方法具有优势。'}],references=[{id:'r',confirmed:true,title:'题录'}];
 assert.ok(auditWritingConsistency({chapters,references}).findings.some(row=>row.category==='source_support'));
 assert.ok(!auditWritingConsistency({chapters,references:[{...references[0],text:'已提供的摘要'}]}).findings.some(row=>row.category==='source_support'));
});

test('caption placement review covers row and edge directions',()=>{
 const figure={id:'f',title:'结构',kind:'flowchart',nodes:[{id:'a',label:'A'},{id:'b',label:'B'}],edges:[{from:'a',to:'b'}],caption:'上行为输入，下行为输出。'};
 const audit=auditWritingConsistency({chapters:[{id:'a',title:'方法',text:'[figure:f]',figures:[figure]}]});assert.ok(audit.findings.some(row=>row.category==='figure_consistency'));
});

test('figure reference numbers outside the actual sequential export labels are flagged',()=>{
 const figure={id:'f',title:'结构',kind:'flowchart',nodes:[{id:'a',label:'A'},{id:'b',label:'B'}],edges:[{from:'a',to:'b'}],caption:''};
 const check=text=>auditWritingConsistency({chapters:[{id:'a',title:'结构',text,figures:[figure]}]});
 assert.ok(check('如图3-1所示。\n\n[figure:f]').findings.some(row=>row.category==='figure_consistency'&&/编号/.test(row.explanation)));
 assert.ok(!check('如图1所示。\n\n[figure:f]').findings.some(row=>/编号/.test(row.explanation)));
 assert.ok(!check('引自文献的图3-1所示[source:x]。\n\n[figure:f]').findings.some(row=>/编号/.test(row.explanation)));
});

test('each editable table needs its own nearby numbered caption while code fences are ignored',()=>{
 const table='| 模型 | 特点 |\n| --- | --- |\n| A | 注意力 |',check=text=>auditWritingConsistency({chapters:[{id:'a',title:'综述',text}]});
 assert.equal(check(table).findings.filter(row=>row.category==='table_consistency').length,1);
 assert.equal(check('表 1 模型对比\n\n'+table).findings.filter(row=>row.category==='table_consistency').length,0);
 assert.equal(check('表 1 模型对比\n'+table+'\n\n'+table).findings.filter(row=>row.category==='table_consistency').length,1);
 assert.equal(check('```\n'+table+'\n```').findings.filter(row=>row.category==='table_consistency').length,0);
 assert.equal(check('Table 1. Model comparison\n'+table).findings.filter(row=>row.category==='table_consistency').length,0);
});

test('a wrapped single-cell table caption is recognized when above the table',()=>{
 const text='| 表1 模型对比 |\n\n| 模型 | 特点 |\n| --- | --- |\n| A | 注意力 |';assert.ok(!auditWritingConsistency({chapters:[{id:'a',title:'综述',text}]}).findings.some(row=>row.category==='table_consistency'));
});

test('a table example in a fenced code block does not satisfy an actual table reference',()=>{
 const run=text=>auditWritingConsistency({chapters:[{id:'a',title:'结果',text}]}),sample='| A | B |\n| --- | --- |\n| 1 | 2 |';
 assert.ok(run('表1给出实际对比结果。\n```\n'+sample+'\n```').findings.some(row=>row.category==='table_consistency'));
 assert.ok(!run('表1给出实际对比结果。\n表1 对比\n'+sample).findings.some(row=>row.category==='table_consistency'));
 const reversed='表1 对比\n| --- | --- |\n| A | B |\n| 1 | 2 |';assert.ok(!run('表1给出对比。\n'+reversed).findings.some(row=>row.category==='table_consistency'));
});

test('figure numbering audit agrees with an exact adjacent original caption',()=>{
 const figure={id:'f',title:'结构对比',kind:'flowchart',nodes:[{id:'a',label:'输入'},{id:'b',label:'输出'}],edges:[{from:'a',to:'b'}],caption:''},text='如图2-1所示。\n[figure:f]\n图2-1 结构对比';
 const result=auditWritingConsistency({chapters:[{id:'a',title:'结构',text,figures:[figure]}]});assert.ok(!result.findings.some(row=>row.category==='figure_consistency'&&/编号/.test(row.explanation)));
});

test('a section saying this table exists needs an actual local table, even if another section contains a table',()=>{
 const chapters=[{id:'a',title:'工作要求',text:'表1 工作要求\n| 项目 | 内容 |\n| --- | --- |\n| 范围 | 检索 |'},{id:'b',title:'进度安排',text:'阶段计划参考资料[source:m]；各阶段起止日期待排定，本表仅固定三个阶段的工作内容。'}],result=auditWritingConsistency({chapters});assert.ok(result.findings.some(row=>row.sectionId==='b'&&row.category==='table_consistency'&&/本章节/.test(row.explanation)));
 const withTable=structuredClone(chapters);withTable[1].text+='\n\n表2 进度安排\n| 阶段 | 内容 |\n| --- | --- |\n| 第一阶段 | 研究设计 |';assert.ok(!auditWritingConsistency({chapters:withTable}).findings.some(row=>row.sectionId==='b'&&row.category==='table_consistency'));
});

test('audits discrete one-step change separately from the derivative without claiming general math verification',()=>{
 const text='完全配对定义 C(n)=n²。连续变化率为 $$\\frac{dC}{dn}=2n$$，说明长度每增加一个单位，新增配对数量随当前长度线性增大。';
 const run=value=>auditWritingConsistency({chapters:[{id:'math',title:'推导',text:value}]}),problem=run(text).findings.find(row=>row.category==='method_result_consistency');
 assert.ok(problem);assert.ok(text.includes(problem.quote));assert.match(problem.suggestion,/2n\+1/);
 assert.ok(!run(text+' 精确差分为 C(n+1)−C(n)=2n+1。').findings.some(row=>row.category==='method_result_consistency'));
 assert.ok(!run('C(n)=n²，连续变量的导数为 2n，曲线随 n 增长。').findings.some(row=>row.category==='method_result_consistency'));
 assert.match(run(text).limitations.join(''),/未核实/);
});

test('source review selects a verbatim window relevant to each cited claim without mixing sources',()=>{
 const materialA='Unrelated background '.repeat(160)+'On WMT 2014 the model achieved 28.4 BLEU and 41.8 BLEU. '+'Closing details '.repeat(160);
 const materialB='Different background '.repeat(180)+'The model scored 80.5 GLUE on its task. '+'Another section '.repeat(160);
 const snapshot={materials:[],references:[{id:'a',confirmed:true,text:materialA},{id:'b',confirmed:true,text:materialB},{id:'private',confirmed:true,text:'Private unreferenced content 28.4 BLEU'}]};
 const chapters=[{id:'one',text:'翻译结果为 28.4 和 41.8 BLEU [source:a]；另一模型达到 80.5 GLUE [source:b]。'}];
 const evidence=writingReviewTask({snapshot,chapters}).context.sourceEvidence.items;
 assert.deepEqual(evidence.map(row=>row.id),['a','b']);
 assert.match(evidence[0].text,/28\.4 BLEU and 41\.8 BLEU/);assert.doesNotMatch(evidence[0].text,/80\.5 GLUE/);
 assert.match(evidence[1].text,/80\.5 GLUE/);assert.doesNotMatch(evidence[1].text,/28\.4 BLEU/);
 assert.equal(evidence[0].text,materialA.slice(evidence[0].offset,evidence[0].offset+evidence[0].text.length));
 assert.equal(evidence[1].text,materialB.slice(evidence[1].offset,evidence[1].offset+evidence[1].text.length));
 assert.ok(evidence.every(row=>row.text.length<=2000&&row.excerpted));
});

test('later numeric citation remains searchable after an earlier long Chinese claim',()=>{
 const text='unrelated introduction '.repeat(150)+'WMT 2014 achieved 28.4 BLEU and 41.8 BLEU in 3.5 days. '+'additional background '.repeat(100);
 const chapters=[{id:'first',text:'注意力机制的设计及架构背景讨论有大量中文论述与细节。'.repeat(8)+'[source:a]'},{id:'second',text:'其结果在 WMT 2014 达到 28.4 与 41.8 BLEU，训练 3.5 天[source:a]。'}];
 const row=writingReviewTask({snapshot:{references:[{id:'a',confirmed:true,text}]},chapters}).context.sourceEvidence.items[0];
 assert.ok(row.text.includes('28.4 BLEU')&&row.text.includes('41.8 BLEU')&&row.text.includes('3.5 days'));
});

test('citation windows share a fixed budget without starving later confirmed sources',()=>{
 const references=Array.from({length:6},(_,i)=>({id:'r'+i,confirmed:true,text:('Source '+i+' evidence. ').repeat(400)}));
 const chapters=[{id:'c',text:references.map(r=>'相关来源[source:'+r.id+']').join('；')}];
 const items=writingReviewTask({snapshot:{references},chapters}).context.sourceEvidence.items;
 assert.equal(items.length,6);assert.ok(items.every(x=>x.text.length>0));assert.ok(items.reduce((n,x)=>n+x.text.length,0)<=4000);
});

test('review cannot misquote an equation as the manuscript definition',()=>{
 const task=writingReviewTask({snapshot:{},chapters:[{id:'c',title:'数学定义',text:'合成资料定义 C(n)=n²，长度加倍时配对数量变为四倍。'}]});
 const row={sectionId:'c',quote:'长度加倍时配对数量变为四倍',category:'logic',severity:'warning',explanation:'有序位置对数按定义 C(n)=(n+1)²，故不是四倍。',suggestion:'请核对公式。'};
 assert.throws(()=>parseWritingReview(aiResult([row]),task),/公式无法逐字核对/);
 row.explanation='有序位置对数按定义 C(n)=n²，需明确对比范围。';assert.equal(parseWritingReview(aiResult([row]),task).findings.length,1);
 row.explanation='对该式的离散差分可以进一步推导，并与连续导数区分。';assert.equal(parseWritingReview(aiResult([row]),task).findings.length,1);
});

test('flags nonperiodic local-window formula while preserving circular models and code samples',()=>{
 const text='每个位置仅与相对偏移不超过r的位置配对，C_local(n,r)=n·min(n,2r+1)。',check=t=>auditWritingConsistency({chapters:[{id:'c',title:'方法',text:t}]});const findings=check(text).findings;assert.ok(findings.some(f=>f.category==='method_result_consistency'&&/44.*56/.test(f.explanation)));assert.equal(check('周期边界：'+text).findings.filter(f=>/非周期局部窗口/.test(f.explanation)).length,0);assert.equal(check('```text\n'+text+'\n```').findings.filter(f=>/非周期局部窗口/.test(f.explanation)).length,0);
});

test('numbered Markdown tables remain auditable with known Word formula or image objects',()=>{
 const id='obj-0123456789abcdef12345678',text='见表2所示。\n\n[docx:'+id+']\n\n表1 结果\n\n| 类别 | 数量 |\n| --- | --- |\n| A | 1 |',chapters=[{id:'c',title:'结果',text}],run=objects=>auditWritingConsistency({chapters,docxObjects:objects}).findings.filter(f=>f.category==='table_consistency'&&/表号/.test(f.explanation));
 for(const kind of ['formula','image'])assert.equal(run([{id,kind}]).length,1,kind);
 assert.equal(run([]).length,0,'unknown preserved objects may contain opaque tables');
 assert.equal(run([{id,kind:'table'}]).length,0,'opaque Word table may account for reference');
});
test('preserved Word formulas or tables do not count as an image for missing figure review',()=>{
 const id='obj-0123456789abcdef12345678',chapters=[{id:'c',title:'结果',text:'图1显示系统结构。\n\n[docx:'+id+']'}],run=objects=>auditWritingConsistency({chapters,docxObjects:objects}).findings.filter(f=>f.category==='figure_consistency'&&/未找到对应对象/.test(f.explanation));
 for(const kind of ['formula','table'])assert.equal(run([{id,kind}]).length,1,kind);
 assert.equal(run([{id,kind:'image'}]).length,0);
 assert.equal(run([]).length,0,'an unclassified object may contain an image');
});

test('review uses applicable degree-specific guidance without changing user requirements or suppressing source concerns',()=>{
 const base='开题报告撰写规范 v1：学校要求优先。研究生按实际任务展开创新点、前期基础与困难对策。不得假造研究结果。\n学校要求：明确研究对象。';
 const make=level=>writingReviewTask({snapshot:{profile:{level},requirements:{instructions:base}},chapters:[{id:'a',text:'本研究拟进行模拟预测试，具体实施条件尚待确定。'}]});
 const under=make('本科'),post=make('硕士'),unknown=make('');assert.doesNotMatch(under.context.writingRequirements,/研究生按实际任务/);assert.match(under.context.writingRequirements,/学校要求：明确研究对象/);assert.match(post.context.writingRequirements,/研究生按实际任务/);assert.match(unknown.context.writingRequirements,/研究生按实际任务/);assert.match(under.instructions,/不得把研究生专属要求套用到本科/);assert.match(under.instructions,/同句另外包含实际未授权的方法或缺乏依据的陈述/);
 const userCustom=writingReviewTask({snapshot:{profile:{level:'本科'},requirements:{instructions:'学校特别规定：研究生按实际任务展开创新点、前期基础与困难对策。'}},chapters:[{id:'a',text:'正文内容足够检查。'}]});assert.match(userCustom.context.writingRequirements,/研究生按实际任务/);
});
