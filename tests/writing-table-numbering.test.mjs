import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {auditWritingConsistency} from '../backend/writing-quality.mjs';
import {assessWritingDelivery} from '../dist/workspace/writing-delivery.mjs';
import {createWritingDocx} from '../src/writing-document.js';
import {auditThesisSubmission} from '../src/thesis-export-check.js';

const table=(caption,first='任务',second='交付')=>`${caption}\n\n| 阶段 | 内容 |\n| --- | --- |\n| ${first} | ${second} |`;
const chapters=()=>[{id:'a',title:'主要任务',text:'各环节要求见表1。\n\n'+table('表1 主要任务与工作要求')},{id:'b',title:'进度安排',text:'各阶段任务见表1。\n\n'+table('表1 进度安排与成果交付','计划','成果')}];
const collisions=rows=>auditWritingConsistency({chapters:rows}).findings.filter(row=>row.category==='table_consistency'&&/相同的表号/.test(row.explanation));

test('duplicate actual table captions in separate chapters block final delivery without changing either reference',async()=>{
 const rows=chapters(),before=structuredClone(rows),audit=auditWritingConsistency({chapters:rows}),items=collisions(rows);
 assert.equal(items.length,1);assert.equal(items[0].sectionId,'b');assert.equal(items[0].relatedSectionId,'a');assert.equal(items[0].quote,'表1 进度安排与成果交付');assert.equal(rows[1].text.slice(items[0].offset,items[0].offset+items[0].quote.length),items[0].quote);assert.equal(items[0].severity,'warning');assert.deepEqual(rows,before);
 const text=rows.map(row=>row.text).join('\n\n'),assessment=assessWritingDelivery({kind:'taskbook',text,snapshot:{materials:[],references:[]},quality:{consistency:audit,reviews:[]}});assert.equal(assessment.ready,false);assert.ok(assessment.issues.some(row=>row.code==='table_consistency'));
 const historical=assessWritingDelivery({kind:'taskbook',text,snapshot:{materials:[],references:[]},quality:{consistency:{status:'no_deterministic_issues',findings:[]},reviews:[]}});assert.equal(historical.ready,false);assert.equal(historical.issues.filter(row=>row.code==='table_consistency').length,1);
 const corrected=text.replace('表1 进度安排与成果交付','表2 进度安排与成果交付').replace('各阶段任务见表1。','各阶段任务见表2。');assert.equal(assessWritingDelivery({kind:'taskbook',text:corrected,snapshot:{materials:[],references:[]},quality:{consistency:{findings:[]},reviews:[]}}).ready,true);
 const bytes=await createWritingDocx(text,{documentKind:'writing',writingKind:'taskbook',metadata:{title:'合成任务书'}}),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');assert.match(xml,/表1 主要任务与工作要求/);assert.match(xml,/表1 进度安排与成果交付/);
});

test('duplicates are detected within one section and across equivalent caption conventions',()=>{
 assert.equal(collisions([{id:'a',text:table('表1 首表')+'\n\n'+table('Table 1 Next')}]).length,1);
 assert.equal(collisions([{id:'a',text:table('表2.1 首表')},{id:'b',text:table('表2－1 第二表')}]).length,1);
 assert.equal(collisions([{id:'a',text:table('表1 首表')},{id:'b',text:table('表2 第二表')}]).length,0);
 assert.equal(collisions([{id:'a',text:table('表1-1 首表')},{id:'b',text:table('表2-1 第二表')}]).length,0);
 assert.equal(collisions([{id:'a',text:table('表1-1-1 首表')},{id:'b',text:table('表1.1.1 第二表')}]).length,1);
});

test('only a matching immediately adjacent explicitly continued table avoids a duplicate, including final export checks',()=>{
 const original=table('表1 数据'),same=table('表1 数据（续）','乙','后续');
 for(const continuation of [same,table('表1 数据（continued）','乙','后续'),table('表1（续）','乙','后续'),table('续表1','乙','后续')]){
  const text=original+'\n\n'+continuation;assert.equal(collisions([{id:'a',text}]).length,0);assert.ok(!auditThesisSubmission({text}).submission.issues.some(issue=>issue.code==='table_numbers'));assert.ok(!assessWritingDelivery({kind:'taskbook',text}).issues.some(issue=>issue.code==='table_consistency'));
  assert.ok(!auditWritingConsistency({chapters:[{id:'a',text}]}).findings.some(issue=>/没有独立的编号/.test(issue.explanation)));assert.ok(!auditThesisSubmission({text}).submission.issues.some(issue=>issue.code==='table_captions'));
 }
 assert.equal(collisions([{id:'a',text:original+'\n\n'+same.replace('| 阶段 | 内容 |','| 阶段 | 结果 |')}]).length,1);
 assert.equal(collisions([{id:'a',text:original+'\n\n说明段落。\n\n'+same}]).length,1);
 assert.equal(collisions([{id:'a',text:original},{id:'b',text:same}]).length,1);
 for(const malformed of [original+'\n\n'+table('续表1').replace('| 阶段 | 内容 |','| 阶段 | 结果 |'),original+'\n\n其他内容。\n\n'+table('表1（续）'),table('续表1')])assert.ok(auditWritingConsistency({chapters:[{id:'a',text:malformed}]}).findings.some(issue=>/没有独立的编号/.test(issue.explanation)));
});

test('a caption or an example inside fenced code cannot become an extra actual table',()=>{
 const rows=[{id:'a',text:table('表1 唯一正文表')+'\n\n引用资料的表1。\n\n```text\n'+table('表1 代码示例')+'\n```'}];assert.equal(collisions(rows).length,0);
 assert.equal(collisions([{id:'a',text:table('| 表1 包装表题 |')},{id:'b',text:table('表1 重复表题')}]).length,1);
});
