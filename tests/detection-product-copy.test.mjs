import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {parseDocument,analyzeDocument} from '../dist/precheck/engine.mjs';
import {reportHtml} from '../dist/precheck/export.mjs';
import {workspaceResultTitle,workspaceJobError} from '../dist/workspace/workspace-job-model.mjs';
import {accountOverviewItems} from '../dist/workspace/home-account-model.mjs';
import {articles} from '../dist/workspace/help-model.mjs';

test('public reports keep scope and original comparisons without showing processing diagnostics',()=>{
 const text='本研究整理真实教学记录，分析反馈资料与教学目标之间的关系，并对研究结论提供实际材料支持。';
 const source={id:'owned-source',title:'实际来源',text,authors:['研究者'],kind:'web',provider:'本次可访问的公开网页',url:'https://example.org/source',contentHash:'PRIVATE-HASH',fetchedAt:'2026-10-27T00:00:00Z'};
 const report={...analyzeDocument(parseDocument('第一章 研究内容\n\n'+text),[source],{id:'owned-report'}),mode:'web',web:{sampledParagraphs:3,totalParagraphs:80,queries:3,fetchedSources:1,failedSources:1,searchComplete:false,limitations:['PRIVATE-ALGORITHM-DETAIL'],sources:[{title:'PRIVATE-UNREAD-CANDIDATE',error:'PRIVATE-PROVIDER-ERROR'}]}};
 const before=JSON.stringify(report),dom=new JSDOM(reportHtml(report)),doc=dom.window.document;
 try{
  assert.match(doc.querySelector('h1').textContent,/论文重复率检测报告/);
  assert.match(doc.querySelector('.report-notice').textContent,/不保证覆盖全部文献.*不替代学校或机构指定的检测报告/);
  assert.match(doc.body.textContent,/本次检测范围受限/);
  assert.doesNotMatch(doc.body.textContent,/联网|抽样|逐字|Unicode|PRIVATE-|公开网页|次检索/);
  assert.equal(doc.querySelector('.report-paragraph .report-text').textContent,text);
  assert.ok(doc.querySelectorAll('.report-review-row mark').length>=2);
  assert.ok(doc.querySelector('a[href="https://example.org/source"]'));
  assert.equal(JSON.stringify(report),before);
 }finally{dom.window.close();}
});

test('user text containing technical terms remains verbatim in original and source comparison',()=>{
 const text='本研究分析联网查重与抽样检索的差异，记录 Unicode 处理方式与算法评价过程，并保存研究原始证据。';
 const source={id:'source',title:'联网查重研究原文',text,kind:'web',url:'https://example.org/source'};
 const report={...analyzeDocument(parseDocument(text),[source]),mode:'web'},before=JSON.stringify(report),dom=new JSDOM(reportHtml(report));
 try{
  assert.equal(dom.window.document.querySelector('.report-paragraph .report-text').textContent,text);
  assert.ok([...dom.window.document.querySelectorAll('.report-source-excerpt mark')].some(node=>node.textContent.startsWith('本研究分析联网查重与抽样检索')));
  assert.match(dom.window.document.querySelector('.report-source-title').textContent,/联网查重研究原文/);
  assert.equal(JSON.stringify(report),before);
 }finally{dom.window.close();}
});

test('historical result suffixes and diagnostic task errors use product copy without changing stored records',()=>{
 const row={id:'r1',type:'web_similarity',title:'联网查重研究 · 联网来源查重',created_at:'2026-10-27T00:00:00Z',error:'候选网页未取得，未继续联网检索。'},before=JSON.stringify(row);
 assert.equal(workspaceResultTitle(row),'联网查重研究 · 论文重复率检测');
 assert.equal(accountOverviewItems({results:[row]})[0].title,'联网查重研究 · 论文重复率检测');
 assert.doesNotMatch(workspaceJobError(row),/网页|联网|检索|候选/);
 assert.equal(workspaceJobError({...row,error:'可用积分不足，请充值。'}),'可用积分不足，请充值。');
 assert.equal(workspaceResultTitle({...row,type:'writing'}),row.title);
 assert.equal(JSON.stringify(row),before);
 const help=articles.find(row=>row.id==='detection-meaning');
 assert.doesNotMatch([help.summary,...help.steps,help.note].join(''),/联网|抽样|逐字|算法/);
 assert.match(help.note,/不保证覆盖全部文献/);
});
