import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {recoverFlattenedMarkdownTables} from '../backend/flattened-markdown-table.mjs';
import {createWritingDocx} from '../src/writing-document.js';

test('a flattened model table becomes an editable Word table and keeps its prose and values',async()=>{
 const source='前文与依据[1]。表1 指标定义| 维度 | 指标 | 操作定义 | 测量方式 || --- | --- | --- | --- || 效率 | 时间 | 检索到结果用时 | 录屏计时 || 效果 | 完成率 | 打开资源占比 | 观察编码 |后文保持。';
 const recovered=recoverFlattenedMarkdownTables(source);
 assert.match(recovered,/表1 指标定义\n\| 维度 \| 指标 \| 操作定义 \| 测量方式 \|\n\| ---/);
 assert.match(recovered,/\| 效果 \| 完成率 \| 打开资源占比 \| 观察编码 \|\n后文保持。/);
 const zip=await JSZip.loadAsync(await createWritingDocx(recovered));
 const xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/<w:tbl>/);assert.match(xml,/录屏计时/);assert.match(xml,/观察编码/);assert.match(xml,/后文保持。/);
});

test('ambiguous, incomplete, or already multiline table content remains unchanged',()=>{
 for(const s of ['讨论 a || b；不构成表格','正文 | a | b || --- | --- || 1 | 2 |尾注','| a | b |\n| --- | --- |\n| 1 | 2 |', '文本 | a | b || --- | --- || 1 | 2 || 3 |尾注'])assert.equal(recoverFlattenedMarkdownTables(s),s);
});
