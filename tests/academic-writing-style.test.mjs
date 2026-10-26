import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {normalizeThesisSnapshot,thesisPlan,thesisAgentTask} from '../backend/thesis-model.mjs';
import {thesisOutlineTask} from '../backend/thesis-outline-model.mjs';
import {normalizeWritingSnapshot,writingPlan,writingTask} from '../backend/writing-model.mjs';
import {normalizeThesisFigure,thesisFigureTitle,renderThesisFigureSvg} from '../dist/workspace/thesis-figure.mjs';
import {createWritingDocx,inspectThesisExportContent} from '../src/writing-document.js';
import {figurePngFixture} from './helpers/thesis-figure-png.mjs';

const input=(targetWords=1000)=>({title:'基于深度学习的识别系统',profile:{level:'本科',language:'中文',targetWords},requirements:{contentMode:'rich'},materials:[{id:'r1',name:'用户提供的设计资料',text:'资料描述系统的输入、特征提取与识别流程，只提供架构设计，尚无真实实验记录。'.repeat(3),confirmed:true}],references:[],outline:[{id:'design',title:'系统设计',targetWords:targetWords/2,presentation:{image:true}},{id:'validation',title:'验证方案',targetWords:targetWords/2,presentation:{image:true}}]});
const noForcedStatus=/拟开展方案须在图题或图注|明确标示“拟开展\/建议\/待验证”/;

test('thesis sections, summaries and outlines request formal prose without forcing draft-status figure labels',()=>{
 const snapshot=normalizeThesisSnapshot(input()),before=structuredClone(snapshot);
 const tasks=[...thesisPlan(snapshot).map(unit=>thesisAgentTask(snapshot,unit,[])),thesisAgentTask(snapshot,{id:'front-en',frontMatter:'abstract_en',targetWords:250},[{chapter_id:'design',unit_id:'design',text:'系统设计包含特征提取和身份匹配，当前资料没有实测准确率。'}]),thesisOutlineTask(snapshot)];
 for(const task of tasks){assert.match(task.instructions,/标题不要附加“拟开展”/);assert.match(task.instructions,/不能改写为已实现、已实验或已验证/);assert.doesNotMatch(task.instructions,noForcedStatus);}
 assert.match(tasks[0].instructions,/不添加“（拟开展）”“（草稿）”等状态后缀/);assert.match(tasks[0].instructions,/缺少必要事实/);assert.deepEqual(snapshot,before);
});

for(const kind of ['proposal','summary','taskbook','article','course','practice','idea','quick'])test(kind+' uses formal prose in ordinary and batched chapters and abstracts while preserving the evidence boundary',()=>{
 for(const words of [1000,200]){
  const snapshot=normalizeWritingSnapshot(input(words)),unit=writingPlan(snapshot,'draft')[0],task=writingTask(kind,'draft',snapshot,unit,[]);
  assert.match(task.instructions,/标题不要附加“拟开展”/);assert.match(task.instructions,/不以“拟开展\/拟采用\/建议”反复起句/);assert.doesNotMatch(task.instructions,noForcedStatus);assert.match(task.instructions,/不添加“（拟开展）”“（草稿）”等状态后缀/);
  assert.match(task.instructions,/不得编造实验/);if(kind==='proposal')assert.match(task.instructions,/应以未来或待验证表述完成/);
  const abstract=writingTask(kind,'abstract',snapshot,{id:'abstract',title:'摘要',targetWords:200},[]);assert.match(abstract.instructions,/不强制使用“拟开展”措辞/);assert.match(abstract.instructions,/不虚构已得到的结果/);
 }
});

test('legacy figure titles omit only isolated status suffixes without changing the stored graph or substantive qualifiers',()=>{
 const title='系统总体架构与核心识别流程';
 for(const suffix of ['（拟开展）',' (proposed)','（草稿）','（拟开展、待验证）','（拟开展） （草稿）'])assert.equal(thesisFigureTitle(title+suffix),title);
 for(const value of ['系统架构（设计方案）','模型（尚未进行实验验证）','系统（拟开展）结构','拟开展研究的伦理风险','（草稿）'])assert.equal(thesisFigureTitle(value),value);
 const figure={id:'architecture',title:title+'（拟开展）',kind:'flowchart',nodes:[{id:'input',label:'图像输入'},{id:'match',label:'身份匹配'}],edges:[{from:'input',to:'match'}],caption:'该图描述系统设计；识别性能尚无实测记录。'},before=structuredClone(figure),result=renderThesisFigureSvg(figure);
 assert.deepEqual(normalizeThesisFigure(figure),before);assert.deepEqual(figure,before);assert.doesNotMatch(result.svg,/（拟开展）/);assert.match(result.svg,/识别性能尚无实测记录/);
});

for(const documentKind of ['thesis','writing'])test(documentKind+' Word export presents an existing diagram with a formal caption and retains real limitations',async()=>{
 const figure={id:'architecture',title:'系统总体架构与核心识别流程（拟开展）',kind:'flowchart',nodes:[{id:'input',label:'图像输入'},{id:'match',label:'身份匹配'}],edges:[{from:'input',to:'match'}],caption:'系统设计包含图像输入与身份匹配；当前没有实测准确率。'},metadata={title:'识别系统设计',figures:[figure],chapterTitles:['系统设计']},before=structuredClone(metadata),text='识别系统设计\n系统设计\n本文提出的系统架构包含图像输入与身份匹配。\n[figure:architecture]\n当前资料仅支持设计说明，实验结果需由实际记录补充。',bytes=await createWritingDocx(text,{documentKind,writingKind:'article',metadata,figureRasterizer:async()=>figurePngFixture()}),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string'),doc=new DOMParser().parseFromString(xml,'application/xml'),content=doc.documentElement.textContent;
 assert.ok(content.includes('图 1 系统总体架构与核心识别流程'));assert.doesNotMatch(content,/（拟开展）/);assert.ok(content.includes(figure.caption));assert.ok(content.includes('实验结果需由实际记录补充'));assert.equal((await inspectThesisExportContent(bytes,text,{metadata})).figureSegments,1);assert.deepEqual(metadata,before);
});
