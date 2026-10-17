import {researchWordCount} from '../backend/text-length.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {thesisEditorPresentation,restoreThesisEditorText,thesisEditorWordCount} from '../dist/workspace/thesis-editor-presentation.mjs';
const snapshot=()=>({materials:[{id:'private-material-a-long-internal-id',name:'真实观察记录',text:'用户真实资料',confirmed:true},{id:'private-material-b-long-internal-id',name:'用户调查汇总',text:'用户真实资料',confirmed:true}],references:[{id:'reference-a-long-internal-id',title:'研究文献题录',text:'',confirmed:true}]});

test('chapter citation presentation is reversible and leaves canonical text and source metadata untouched',()=>{
 const sources=snapshot(),before=structuredClone(sources),raw='观察记录 [source:private-material-a-long-internal-id]；研究讨论 [source:reference-a-long-internal-id]。再次核对 [source:private-material-a-long-internal-id]。',view=thesisEditorPresentation(sources,raw);
 assert.equal(view.text,'观察记录 〔材料1〕；研究讨论 〔文献1〕。再次核对 〔材料1〕。');assert.equal(view.sources.length,2);assert.equal(view.sources[0].name,'真实观察记录');assert.equal(view.sources[1].name,'研究文献题录');assert.equal(view.sources[1].hasText,false);assert.doesNotMatch(view.text,/source:|long-internal-id/);assert.equal(restoreThesisEditorText(view.text,view).text,raw);assert.deepEqual(sources,before);
});

test('literal same-name short markers cause whole-chapter raw fallback instead of guessed associations',()=>{
 const raw='原有文字 〔材料1〕 与引用 [source:private-material-a-long-internal-id]。',view=thesisEditorPresentation(snapshot(),raw);
 assert.equal(view.collision,true);assert.equal(view.text,raw);assert.deepEqual(view.bindings,[]);assert.equal(restoreThesisEditorText(view.text+' 人工补充',view).text,raw+' 人工补充');assert.deepEqual(restoreThesisEditorText(view.text,view).unmatched,[]);
});

test('ordinary square-bracket content is never mistaken for a citation view marker',()=>{
 const raw='用户正文 [材料1]、[文献1]、[1]；已关联记录 [source:private-material-a-long-internal-id]。',view=thesisEditorPresentation(snapshot(),raw);
 assert.equal(view.collision,false);assert.match(view.text,/\[材料1\]、\[文献1\]、\[1\]/);assert.match(view.text,/〔材料1〕/);assert.equal(restoreThesisEditorText(view.text,view).text,raw);
});

test('unknown source markers remain reversible and clearly unverified without exposing their internal ID in normal text',()=>{
 const raw='资料需要核对 [source:removed-or-unknown-private-id]，再次核对 [source:removed-or-unknown-private-id]。',view=thesisEditorPresentation(snapshot(),raw);
 assert.equal(view.text,'资料需要核对 〔待核对来源1〕，再次核对 〔待核对来源1〕。');assert.equal(view.sources[0].kind,'unknown');assert.equal(view.sources[0].confirmed,false);assert.doesNotMatch(view.text,/removed-or-unknown-private-id/);assert.equal(restoreThesisEditorText(view.text,view).text,raw);
});

test('unmapped pasted short labels remain literal with an explicit unmatched indication',()=>{
 const raw='已关联记录 [source:private-material-a-long-internal-id]。',view=thesisEditorPresentation(snapshot(),raw),pasted=view.text+' 粘贴 〔材料2〕 和 〔文献1〕，并非已关联来源。',restored=restoreThesisEditorText(pasted,view);
 assert.equal(restored.text,raw+' 粘贴 〔材料2〕 和 〔文献1〕，并非已关联来源。');assert.deepEqual(restored.unmatched,['〔材料2〕','〔文献1〕']);assert.equal(view.bindings.length,1);
});

test('snapshot reorder changes only the display number, never the canonical draft association',()=>{
 const sources=snapshot(),raw='真实依据 [source:private-material-a-long-internal-id]。',first=thesisEditorPresentation(sources,raw),canonical=restoreThesisEditorText(first.text+' 人工补充',first).text;const reordered={...sources,materials:[...sources.materials].reverse()},second=thesisEditorPresentation(reordered,canonical);
 assert.match(first.text,/〔材料1〕/);assert.match(second.text,/〔材料2〕/);assert.equal(second.sources[0].name,'真实观察记录');assert.equal(restoreThesisEditorText(second.text,second).text,canonical);assert.match(canonical,/source:private-material-a-long-internal-id/);assert.doesNotMatch(canonical,/private-material-b/);
});

test('uncited short labels in original prose remain literal and unbound',()=>{
 const raw='用户自行粘贴了 〔材料2〕，尚未关联任何来源。',view=thesisEditorPresentation(snapshot(),raw);
 assert.equal(view.text,raw);assert.deepEqual(view.bindings,[]);assert.deepEqual(view.unmatched,['〔材料2〕']);assert.equal(restoreThesisEditorText(view.text,view).text,raw);
});


test('editor counts match backend Chinese and English counts and exclude whitespace and raw citation markers',()=>{
 for(const [text,language] of [['汉字 空白\n标点。😀 [source:very-long-private-id]','中文'],["We can't claim state-of-the-art results. [source:long-id] Data 2026.",'English'],['重复[source:a][source:a]引用\t 资料','中文'],['中文 English [source:x] mixed 研究词。','英文']])assert.equal(thesisEditorWordCount(text,language),researchWordCount(text,language));
 assert.equal(thesisEditorWordCount('正文 [source:an-internal-id-with-100-characters]。','中文'),3);assert.equal(thesisEditorWordCount("We can't over-claim. [source:x]",'English'),3);
});
