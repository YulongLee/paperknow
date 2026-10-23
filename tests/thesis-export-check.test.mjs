import test from 'node:test';
import assert from 'node:assert/strict';
import {auditThesisExport} from '../src/thesis-export-check.js';
import {thesisDocumentPresentation} from '../dist/workspace/thesis-document.mjs';

const completedQuality = (overrides = {}) => ({status:'completed',stale:false,coverage:{totalCharacters:100,reviewedCharacters:100,complete:true},reviews:[{status:'completed',outcome:'no_ai_findings',findings:[]}],consistency:{status:'no_deterministic_issues',findings:[]},...overrides});
const check = (report, id) => report.checks.find(row => row.id === id);
const ranges = (text, numbers) => numbers.map(number => {const start=text.indexOf(`[${number}]`);return {start,end:start+String(number).length+2,number};});
const clean = (overrides = {}) => auditThesisExport({text:'第一章 研究方法\n\n本文说明研究方法与适用范围。',metadata:{citationRanges:[]},quality:completedQuality(),...overrides});

test('preflight is pure, deterministic, browser-portable and explicit about what it did not verify', () => {
 const input={text:'第一章 研究方法\n\n已核对的研究论述[1]。\n\n参考文献\n\n[1] 作者. 确认的文献.',metadata:{citationRanges:[]},quality:completedQuality(),templateProfile:{version:1,rules:{},warnings:[],unresolved:[]}};
 input.metadata.citationRanges=ranges(input.text,[1]);
 const before=structuredClone(input),result=auditThesisExport(input);
 assert.equal(result.status,'passed');assert.equal(result.checkedCharacters,input.text.length);
 assert.deepEqual(input,before);assert.deepEqual(auditThesisExport(input),result);
 assert.equal(result.scope.layout,'not_rendered');assert.equal(result.scope.facts,'not_verified');assert.equal(result.scope.citationSupport,'not_verified');assert.equal(result.scope.modelReview,'existing_record_only');
 assert.match(result.summary,/导出规则检查/);assert.doesNotMatch(result.summary,/质量合格|全文通过|已核实/);
 assert.equal(check(result,'citation_mapping').details.citationOccurrences,1);
});

test('empty text, whitespace and a references-only document do not pass the actual-body check', () => {
 for(const text of ['', ' \n\t\r\n', '参考文献\n[1] 作者. 题录.', '论文题目\n\n参考文献\n[1] 作者. 题录.']){
  const result=clean({text,metadata:{title:'论文题目',citationRanges:[]}});
  assert.equal(check(result,'body_present').status,'review_required');assert.equal(result.status,'review_required');
 }
 assert.equal(auditThesisExport().status,'review_required');
 assert.equal(auditThesisExport({text:{toString(){throw Error('not text');}}}).checkedCharacters,0);
});

test('actual presentation bibliography names and source ranges map references without changing stored chapters', () => {
 const snapshot={title:'研究论文',references:[{id:'ref-1',title:'真实题录一',confirmed:true},{id:'ref-2',title:'真实题录二',confirmed:true}],materials:[]};
 const chapters=[{id:'one',title:'第一章 研究背景',text:'本文讨论来源[source:ref-2]并补充比较[source:ref-1]。'},{id:'two',title:'第二章 研究方法',text:'方法继续引用[source:ref-2]。'}],before=structuredClone(chapters);
 const presentation=thesisDocumentPresentation(snapshot,chapters),result=clean({text:presentation.text,metadata:{title:snapshot.title,citationRanges:presentation.citationRanges}});
 assert.match(presentation.text,/已使用的参考文献（用户确认，待核对原文）/);
 assert.equal(result.counts.referenceEntries,2);assert.equal(result.counts.citationOccurrences,3);
 assert.equal(check(result,'citation_mapping').status,'passed');assert.deepEqual(check(result,'citation_mapping').details.missingReferenceNumbers,[]);assert.deepEqual(chapters,before);
});

test('only proven citation numbers can produce a missing reference warning and detail list', () => {
 const text='第一章 引言\n\n论点甲[1]；论点乙[3]；普通 [2] 不能冒充来源。\n\n参考文献\n\n[1] 已有题录。\n\n待引用文献（尚未在正文引用）\n\n[3] 待引用列表不冒充已有参考文献。';
 const result=clean({text,metadata:{citationRanges:ranges(text,[1,3])}});
 assert.equal(check(result,'citation_mapping').status,'review_required');assert.deepEqual(check(result,'citation_mapping').details.missingReferenceNumbers,[3]);assert.equal(result.counts.citationOccurrences,2);
 assert.equal(result.counts.referenceEntries,1);
});

test('unproven ordinary brackets, array indices, formulas and code never become broken citations', () => {
 const text='第一章 引言\n\n普通 [1] 需要来源记录。array[2] 与 x[3] 是索引，$v=[4]$ 是公式。`[5]` 是代码。[链接](https://example.test)\n\n```text\n[6]\n```\n\n$$\nx=[7]\n$$\n\n\\[\nx=[8]\n\\]\n\n| 字段 | 值 |\n| [9] | 1 |\n\n参考文献\n[1] 文献一';
 const result=clean({text,metadata:{}}),mapping=check(result,'citation_mapping');
 assert.equal(mapping.status,'not_checked');assert.equal(mapping.details.possibleCitationOccurrences,1);assert.equal(result.counts.citationOccurrences,0);assert.equal(mapping.count,0);assert.equal(check(result,'citation_provenance'),undefined);
 const explicit=clean({text,metadata:{citationRanges:[]}});assert.equal(check(explicit,'citation_mapping').status,'passed');assert.equal(explicit.counts.citationOccurrences,0);
});

test('invalid, stale, code and reference-list citation ranges are reported instead of trusted', () => {
 const text='第一章 引言\n\n有效引文[1]。`[2]` $v=[3]$\n\n参考文献\n[1] 已有题录。\n[4] 文献四。';
 const valid=ranges(text,[1]),invalid=[...ranges(text,[2,3,4]),{start:0,end:3,number:1},{start:-1,end:2,number:1},{start:text.length,end:text.length+3,number:9},{start:7,end:10,number:NaN}];
 const result=clean({text,metadata:{citationRanges:[...valid,...valid,...invalid]}});
 assert.equal(result.counts.citationOccurrences,1);assert.equal(check(result,'citation_provenance').count,invalid.length);assert.equal(check(result,'citation_provenance').status,'review_required');assert.deepEqual(check(result,'citation_mapping').details.missingReferenceNumbers,[]);
});

test('reference lists cannot silently reuse a number or substitute uncited notes for a numbered reference', () => {
 const text='第一章 引言\n\n论据[2]。\n\n参考文献\n[1] 原有文献。\n[1] 另一篇文献。\n\n附录 A\n\n[2] 非参考文献。';
 const result=clean({text,metadata:{citationRanges:ranges(text,[2])}});
 assert.equal(check(result,'reference_number_duplicates').count,1);assert.deepEqual(check(result,'reference_number_duplicates').details.numbers,[1]);assert.deepEqual(check(result,'citation_mapping').details.missingReferenceNumbers,[2]);
});

test('an unused numeric list is surfaced without claiming the sources or claims are false', () => {
 const result=clean({text:'第一章 引言\n\n未建立引用的正文。\n\n参考文献\n[1] 文献一。\n[2] 文献二。'});
 assert.equal(check(result,'references_not_cited').count,2);assert.match(check(result,'references_not_cited').message,/请核对是否实际使用/);assert.doesNotMatch(JSON.stringify(result),/伪造|文献虚假|不存在/);
});

test('explicit placeholders and unresolved semantic source markers are found but ordinary prose is not', () => {
 const result=clean({text:'第一章 引言\n\n【待补充：访谈记录】\n正文中[待核对：数据]。[来源待核对]。[source:missing-ref]\n\n讨论“待补充”措辞不等于占位。`【待补充：代码示例】` $x=【待补充：公式示例】$'});
 assert.equal(check(result,'unresolved_placeholders').count,3);assert.equal(check(result,'unresolved_sources').count,1);assert.equal(result.counts.unresolvedPlaceholders,3);assert.equal(result.status,'review_required');
});

test('actual unresolved source presentation is caught', () => {
 const presentation=thesisDocumentPresentation({title:'测试论文',references:[],materials:[]},[{id:'one',title:'第一章 引言',text:'这里引用[source:deleted-reference]。'}]);
 const result=clean({text:presentation.text,metadata:{citationRanges:presentation.citationRanges}});
 assert.match(presentation.text,/来源待核对/);assert.equal(result.counts.unresolvedPlaceholders,1);
});

test('only exact long paragraphs and exact full headings count as repeated, excluding bibliography and code', () => {
 const paragraph='这是一段较长且应当只出现一次的研究论述，需要结合实际样本与研究背景进行解释，不能从重复排版的文字中自动推断研究质量或真实性。'.repeat(2);
 const text=`第一章 研究方法\n\n${paragraph}\n\n第二章 结果分析\n\n${paragraph}\n\n第二章 结果分析\n\n研究方法\n\n短标签\n\n短标签\n\n参考文献\n[1] ${paragraph}\n\n\`\`\`text\n${paragraph}\n\`\`\``;
 const result=clean({text});assert.equal(result.counts.duplicateParagraphs,1);assert.equal(result.counts.duplicateHeadings,1);assert.match(check(result,'duplicate_paragraphs').message,/不是数据库查重/);
 assert.equal(clean({text:`第一章 引言\n\n${paragraph}\n\n第二章 讨论\n\n${paragraph}新增内容。`}).counts.duplicateParagraphs,0);
});

test('missing review records and unknown coverage are never described as full manuscript checks', () => {
 for(const quality of [null,undefined,{},completedQuality({reviews:[]}),completedQuality({coverage:{complete:true}}),completedQuality({coverage:{totalCharacters:0,reviewedCharacters:0,complete:true}})]){
  const result=clean({quality});assert.notEqual(check(result,'existing_review').status,'passed');assert.equal(result.scope.existingReviewComplete,false);assert.equal(result.status,'review_required');
 }
 assert.match(check(clean({quality:null}),'existing_review').message,/尚无可用/);
});

test('partial, unavailable and not-started review batches preserve actual coverage counts', () => {
 for(const status of ['partial','unavailable']){
  const quality=completedQuality({status,coverage:{totalCharacters:800,reviewedCharacters:300,complete:false},reviews:[{status:'completed',findings:[]},{status:'not_started',reason:'PRIVATE execution key',findings:[]}]});
  const result=clean({quality});assert.match(check(result,'existing_review').message,/300 \/ 800/);assert.equal(check(result,'existing_review').status,'review_required');assert.equal(check(result,'existing_review').details.reviewedCharacters,300);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 }
 const inconsistent=clean({quality:completedQuality({coverage:{totalCharacters:300,reviewedCharacters:900,complete:true}})});assert.equal(inconsistent.scope.existingReviewComplete,false);assert.doesNotMatch(check(inconsistent,'existing_review').message,/900 \/ 300/);
});

test('edited manuscripts label an otherwise complete prior review as stale', () => {
 const result=clean({quality:completedQuality({stale:true})}),row=check(result,'existing_review');assert.equal(row.status,'review_required');assert.equal(row.details.stale,true);assert.equal(result.scope.existingReviewStale,true);assert.equal(result.scope.existingReviewComplete,false);assert.match(row.message,/不代表当前导出版本/);
});

test('stored review findings and review-required outcomes remain visible without exposing quoted text or provider diagnostics', () => {
 const quality=completedQuality({provider:'PRIVATE provider',model:'PRIVATE model',apiKey:'PRIVATE key',reviews:[{status:'completed',outcome:'review_required',findings:[{quote:'PRIVATE user manuscript',explanation:'PRIVATE internal diagnostic'}]}],consistency:{status:'review_required',findings:[{quote:'PRIVATE quote'}]}}),result=clean({quality});
 assert.equal(result.counts.existingReviewFindings,2);assert.equal(check(result,'existing_review').status,'review_required');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 const emptyFinding=clean({quality:completedQuality({reviews:[{status:'completed',outcome:'review_required',findings:[]}]})});assert.equal(check(emptyFinding,'existing_review').status,'review_required');
});

test('template recognition warns with bounded counts, never copies private profile notes into the report', () => {
 const result=clean({templateProfile:{version:1,rules:{},unresolved:['PRIVATE missing font'],warnings:['PRIVATE local computer path'],summary:['PRIVATE template description']}}),row=check(result,'template_rules');
 assert.equal(row.status,'review_required');assert.deepEqual(row.details,{unresolved:1,notices:1});assert.equal(row.count,2);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 assert.equal(check(clean(),'template_rules'),undefined);
});

test('missing reference lists are finite and only the first twenty numbers are returned', () => {
 let text='第一章 引言\n\n';const citationRanges=[];
 for(let number=1;number<=40;number++){text+='论点';const start=text.length;text+=`[${number}]`;citationRanges.push({start,end:text.length,number});text+='。';}
 const result=clean({text,metadata:{citationRanges}}),row=check(result,'citation_mapping');assert.equal(row.count,40);assert.equal(row.details.missingReferenceNumbers.length,20);assert.equal(row.details.truncated,true);assert.equal(JSON.stringify(result).includes('论点'),false);
});

test('limits are explicit and do not claim a truncated manuscript was fully audited', () => {
 const text='正文内容'.repeat(500001),result=clean({text});assert.equal(result.checkedCharacters,2_000_000);assert.equal(result.scope.completeText,false);assert.equal(check(result,'audit_scope').status,'review_required');assert.equal(result.status,'review_required');
 const rangeResult=clean({text:'正文内容',metadata:{citationRanges:Array.from({length:20001},()=>({start:0,end:3,number:1}))}});assert.equal(check(rangeResult,'citation_provenance').status,'review_required');assert.match(check(rangeResult,'citation_provenance').message,/上限/);
});

test('a report can be serialized without including any raw manuscript, user metadata or dynamic field diagnostics', () => {
 const result=clean({text:'PRIVATE-MANUSCRIPT 【待补充：PRIVATE-DATA】\n\n参考文献\n[1] PRIVATE-REFERENCE',metadata:{title:'PRIVATE-TITLE',author:'PRIVATE-AUTHOR',supervisor:'PRIVATE-SUPERVISOR',citationRanges:[]}});
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);assert.ok(JSON.stringify(result).length<12000);assert.ok(result.checks.every(row=>['passed','review_required','not_checked'].includes(row.status)));assert.ok(result.warnings.every(row=>typeof row.message==='string'&&typeof row.code==='string'));
});

test('partial generated chapter presentation is never described as a complete manuscript', () => {
 const snapshot={title:'测试论文',outline:[{id:'one',title:'第一章 引言'},{id:'two',title:'第二章 研究方法'}],references:[],materials:[]};
 const presentation=thesisDocumentPresentation(snapshot,[{id:'one',title:'第一章 引言',text:'这是已保存的一章正文。'}]),result=clean({text:presentation.text,metadata:{title:snapshot.title,citationRanges:presentation.citationRanges}});
 assert.equal(check(result,'incomplete_manuscript').status,'review_required');assert.match(check(result,'incomplete_manuscript').message,/部分章节尚未完成/);assert.equal(result.status,'review_required');
});

test('English draft placeholders and an empty template profile are reported with public wording', () => {
 const result=clean({text:'Research methods\n\n[To be supplied: original observations]\n[Draft note: examples only]',templateProfile:{}});
 assert.equal(result.counts.unresolvedPlaceholders,2);assert.equal(check(result,'template_rules').status,'not_checked');assert.equal(result.status,'review_required');
});

test('many citation ranges in one long paragraph are checked without network calls', () => {
 let text='第一章 引言\n\n',citationRanges=[];
 for(let index=0;index<20000;index++){text+='可核对的论述';const start=text.length;text+='[1]';citationRanges.push({start,end:text.length,number:1});text+='。';}
 text+='\n\n参考文献\n[1] 已确认的题录。';
 const beforeFetch=globalThis.fetch;let calls=0;
 try{globalThis.fetch=()=>{calls++;throw Error('network must not run');};const result=clean({text,metadata:{citationRanges}});assert.equal(result.counts.citationOccurrences,20000);assert.equal(check(result,'citation_mapping').status,'passed');assert.equal(calls,0);}
 finally{globalThis.fetch=beforeFetch;}
});
