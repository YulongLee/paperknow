import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {presentThesisDocument} from '../dist/workspace/thesis-document.mjs';
import {createWritingDocx} from '../src/writing-document.js';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';
import {normalizeThesisSnapshot,thesisAgentTask,thesisFullText,compileThesisReferences,thesisManualSourceIds} from '../backend/thesis-model.mjs';

const snapshot=()=>({title:'用户真实主题',profile:{level:'本科',language:'中文',targetWords:500},requirements:{},materials:[{id:'private-notebook',name:'本人的实验笔记',purpose:'研究记录',text:'用户记录',confirmed:true},{id:'unused-material',name:'未使用的访谈',confirmed:true}],references:[{id:'reference-b',title:'真实文献乙',authors:'用户确认作者乙',year:'2024',doi:'10.1234/user-confirmed',url:'https://example.test/paper',text:'用户文献片段',confirmed:true},{id:'reference-a',title:'真实文献甲',confirmed:true},{id:'unconfirmed-ref',title:'尚未确认的题录',confirmed:false},{id:'unused-ref',title:'已确认但未引用',confirmed:true}],outline:[{id:'chapter-1',title:'研究分析',targetWords:500}]});
const chapters=()=>[{id:'chapter-1',title:'研究分析',text:'原始笔记[source:private-notebook]，参考乙[source:reference-b]；对照甲[source:reference-a]，再次参考乙[source:reference-b]。',sourceIds:['private-notebook','reference-b','reference-a']}];

test('document citations have independent reference and private-material numbers without changing evidence',()=>{
 const value=snapshot(),rows=chapters(),before=structuredClone({value,rows}),text=presentThesisDocument(value,rows);
 assert.match(text,/原始笔记\[材料1\]，参考乙\[1\]；对照甲\[2\]，再次参考乙\[1\]/);
 assert.match(text,/\[1\] 用户确认作者乙\. 真实文献乙\. 2024\. DOI: 10\.1234\/user-confirmed\. https:\/\/example.test\/paper/);
 assert.match(text,/\[2\] 真实文献甲/);assert.match(text,/研究材料来源（用户提供，待人工核对）\n\n\[材料1\] 本人的实验笔记（研究记录）/);
 assert.doesNotMatch(text,/\[source:|private-notebook|reference-b|reference-a|未使用的访谈|尚未确认的题录/);
 assert.match(text,/待引用文献（尚未在正文引用）/);assert.match(text,/\[待引用1\] 已确认但未引用/);
 assert.deepEqual({value,rows},before);assert.equal(thesisFullText(value,rows),text);
 assert.deepEqual(thesisManualSourceIds(rows[0].text,value),['private-notebook','reference-b','reference-a']);
 assert.match(compileThesisReferences(value,['reference-b']),/\[source:reference-b\]/);
});

test('unknown, unconfirmed and ambiguous source markers remain visibly unresolved and never become a bibliography',()=>{
 const value=snapshot();value.materials.push({id:'ambiguous',name:'私有材料',confirmed:true});value.references.push({id:'ambiguous',title:'冲突题录',confirmed:true});
 const text=presentThesisDocument(value,[{title:'本节',text:'缺失[source:unknown-internal]，未确认[source:unconfirmed-ref]，冲突[source:ambiguous]。'}]);
 assert.equal((text.match(/\[来源待核对\]/g)||[]).length,3);assert.match(text,/正文含有未匹配的来源标记/);
 assert.doesNotMatch(text,/unknown-internal|unconfirmed-ref|ambiguous|冲突题录|尚未确认的题录|已使用的参考文献|研究材料来源/);
});

test('an existing reference chapter renders its real entries once while a private-material appendix stays separate',()=>{
 const rows=chapters();rows.push({title:'参考文献',kind:'references',text:'[source:reference-b] 用户确认作者乙. 真实文献乙. 2024. DOI: 10.1234/user-confirmed. https://example.test/paper\n[source:reference-a] 真实文献甲',sourceIds:['reference-b','reference-a']});
 const text=presentThesisDocument(snapshot(),rows);assert.doesNotMatch(text,/已使用的参考文献|\[source:/);assert.equal((text.match(/真实文献乙/g)||[]).length,1);assert.match(text,/研究材料来源/);
 assert.equal(presentThesisDocument(snapshot(),[{title:'未生成',text:''}]),'');
});

test('a manually edited reference chapter cannot hide an associated but omitted source record',()=>{
 const rows=chapters();rows.push({title:'参考文献',text:'用户正在整理的参考文献文本，不作真实性验证。'});
 const text=presentThesisDocument(snapshot(),rows);assert.match(text,/参考文献/);assert.match(text,/\[1\] 用户确认作者乙\. 真实文献乙/);assert.match(text,/\[2\] 真实文献甲/);
});

test('a retained source marker or partial bibliography cannot suppress its canonical bibliographic metadata',()=>{
 for(const entry of ['[source:reference-b] 待补','[source:reference-b] 用户确认作者乙. 真实文献乙. 2024.','[source:reference-b] 用户确认作者乙. 真实文献乙. 2024. DOI: 10.1234/user-confirmed']){
  const value=snapshot(),rows=chapters();rows.push({title:'参考文献',text:entry+'\n[source:reference-a] 真实文献甲',sourceIds:['reference-b','reference-a']});const before=structuredClone(rows);
  const text=presentThesisDocument(value,rows);assert.match(text,/参考文献/);assert.match(text,/\[1\] 用户确认作者乙\. 真实文献乙\. 2024\. DOI: 10\.1234\/user-confirmed\. https:\/\/example.test\/paper/);assert.doesNotMatch(text,/\[source:/);assert.deepEqual(rows,before);
 }
});

test('partial exports clearly name missing body chapters without treating empty reference metadata as missing prose',()=>{
 const value=snapshot();value.outline.push({id:'chapter-2',title:'尚未完成的方法章'},{id:'refs',title:'参考文献',kind:'references'});const rows=[...chapters(),{id:'chapter-2',title:'尚未完成的方法章',text:''},{id:'refs',title:'参考文献',kind:'references',text:''}],before=structuredClone({value,rows});
 const text=presentThesisDocument(value,rows);assert.match(text,/部分章节尚未完成/);assert.match(text,/本文仅包含当前已保存的章节草稿，不代表完整论文。尚未完成：尚未完成的方法章。/);assert.doesNotMatch(text,/尚未完成：.*参考文献/);assert.deepEqual({value,rows},before);
 assert.doesNotMatch(presentThesisDocument(snapshot(),chapters()),/部分章节尚未完成/);delete value.outline;assert.doesNotMatch(presentThesisDocument(value,rows),/部分章节尚未完成/);
});

test('document presentation removes one exact leading chapter title while keeping stored prose and different headings intact',()=>{
 const value=snapshot(),rows=chapters();rows[0].text=' 研究分析 \n这是正文[source:private-notebook]\n研究分析\n后续段落。';const before=structuredClone(rows),text=presentThesisDocument(value,rows);assert.equal((text.match(/研究分析/g)||[]).length,2);assert.match(text,/研究分析\n\n这是正文\[材料1\]\n研究分析\n后续段落/);assert.deepEqual(rows,before);
 rows[0].text='研究分析与比较\n其他标题。';assert.match(presentThesisDocument(value,rows),/研究分析\n\n研究分析与比较\n其他标题/);
});

test('DOCX exports the same readable source inventory and keeps academic formulas and code text intact',async()=>{
 const value=snapshot(),rows=chapters();rows[0].text+='\n研究中的 GPT 与 Qwen 比较、x < y、LaTeX: \\alpha + \\beta 和代码 const result = 1; 均为论文内容。';
 const text=presentThesisDocument(value,rows),zip=await JSZip.loadAsync(await createWritingDocx(text)),xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/原始笔记\[材料1\]/);assert.match(xml,/DOI: 10\.1234\/user-confirmed/);assert.match(xml,/GPT 与 Qwen 比较、x &lt; y/);assert.match(xml,/const result = 1;/);assert.doesNotMatch(xml,/\[source:|private-notebook|reference-b/);
});

const draft=formula=>({title:'用户主题',degree:'硕士',targetWords:500,...(formula===undefined?{}:{formula}),knowledgeFiles:[{id:'uploaded',name:'真实研究记录',text:'真实资料'}],outlineRows:[{id:'one',title:'分析',level:1,words:500}]});
test('content form survives normalization while only explicit leaf preferences authorize chapter formats',()=>{
 for(const contentMode of ['text','rich']){
  const value=normalizeThesisSnapshot(thesisSnapshotFromDraft(draft(contentMode))),task=thesisAgentTask(value,{chapterTitle:'分析',title:'论证',sourceIds:[],targetWords:500},[]);
  assert.equal(value.requirements.contentMode,contentMode);assert.equal(task.context.requirements.contentMode,contentMode);
  assert.deepEqual(task.context.unit.presentation,{table:false,formula:false,code:false});
  if(contentMode==='rich'){assert.match(task.instructions,/本节未开启任何扩展项目/);assert.match(task.instructions,/不主动添加数据表、图片、公式块或代码块/);assert.match(task.instructions,/全局扩展形式都不能代替本节授权/);}
  else assert.match(task.instructions,/不主动添加数据表、图片、公式块或代码块/);
 }
 const selected=draft('rich');selected.outlineRows[0].presentation={formula:true};
 const value=normalizeThesisSnapshot(thesisSnapshotFromDraft(selected)),task=thesisAgentTask(value,{id:'one',chapterId:'one',sectionId:'one',chapterTitle:'分析',title:'论证',sourceIds:[],targetWords:500},[]);
 assert.deepEqual(task.context.unit.presentation,{table:false,formula:true,code:false});
 assert.match(task.instructions,/适合当前论证时生成本节已开启的 公式/);
 assert.match(task.instructions,/公式使用 LaTeX 并解释变量、适用条件和依据/);
});

test('legacy snapshots keep their absent content form and unsupported modes cannot enter the execution contract',()=>{
 const value=normalizeThesisSnapshot(thesisSnapshotFromDraft(draft()));assert.equal(Object.hasOwn(value.requirements,'contentMode'),false);
 for(const contentMode of ['',null,false,'embedded-images',{model:'injected'}])assert.throws(()=>normalizeThesisSnapshot({...snapshot(),requirements:{contentMode}}),/支持的正文内容形式/);
});
