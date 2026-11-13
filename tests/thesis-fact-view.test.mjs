import test from 'node:test';
import assert from 'node:assert/strict';
import {thesisFactView,currentThesisFactView} from '../backend/thesis-fact-view.mjs';
const chapters=()=>[
 {id:'zh',title:'摘要',kind:'abstract_zh',text:'权重 0.669762 与 0.330238。',figures:[],versionId:'v1'},
 {id:'en',title:'Abstract',kind:'abstract_en',text:'Weights 0.669762 and 0.330238.',figures:[],versionId:'v2'},
 {id:'c1',title:'第一章 研究背景',text:'权重为 0.669762 与 0.330238。',figures:[],versionId:'v3'},
 {id:'c2',title:'第二章 方法',text:'权重为 0.669762。【待核对：摘要与第一章 12 位小数需与本章统一】',figures:[],versionId:'v4'}
];
const unit={chapterId:'c2',completion:{originalText:'【待核对：摘要与第一章 12 位小数需与本章统一】'}};
const input=(rows=chapters())=>({ownerId:'owner',thesisId:'thesis',runId:'run',snapshotHash:'hash',chapters:rows,unit,materials:[{id:'user-note',text:'本次数学算例各章统一保留 6 位小数；原值 0.669761549327。'}]});
test('legacy decimal note is checked only against literal current manuscript, separated from user source text',()=>{
 const arg=input(),view=thesisFactView(arg),check=view.numberChecks[0];assert.equal(view.coverage,'complete_text');assert.equal(check.status,'no_literal_twelve_decimal_found');assert.deepEqual(check.targetChapterIds,['zh','en','c1','c2']);assert.ok(check.sixDigitSamples.some(row=>row.value==='0.669762'));assert.equal(check.marker,unit.completion.originalText);assert.equal(view.declarations[0].status,'user_supplied_not_verified_or_read');assert.equal(view.sourceAccess,'no_new_read_inferred');assert.ok(currentThesisFactView(view,arg));
});
test('a 12-place literal in any target section is reported rather than silently dismissed',()=>{for(const end of ['。','.',' ']){const rows=chapters();rows[0].text+='另一项数值 0.123456789012'+end;const check=thesisFactView(input(rows)).numberChecks[0];assert.equal(check.status,'literal_twelve_decimal_found');assert.equal(check.hits[0].value,'0.123456789012');}});
test('section numbering and opaque source identifiers are not confused with numeric scientific notation',()=>{const rows=chapters();rows[0].text+=' 方法见第 3.2.1 节[source:material:bfdfc270-6e90-45ec-8d75-ea676282d5ac]。';assert.equal(thesisFactView(input(rows)).numberChecks[0].status,'no_literal_twelve_decimal_found');});
test('incomplete chapters, figures, Word objects, unparseable numeric form, ambiguous sections and unknown scope cannot imply absence',()=>{
 for(const change of [rows=>{rows[1].text='';},rows=>{rows[2].figures=[{id:'f',data:{value:0.5}}];},rows=>{rows[0].text+='[docx:obj-012345678901234567890123]';},rows=>{rows[0].text+=' 1.23e-12';},rows=>{rows[0].text+=' ０.１２';},rows=>{rows[0].text+=' ٠.١٢٣٤٥٦٧٨٩٠١٢';},rows=>{rows[0].text+=' 1.123456789012.4';},rows=>{rows[0].text+=' 1.123456.4';},rows=>{rows.push({...rows[2],id:'duplicate'});},rows=>{rows[2].title='背景';}]){const rows=chapters();change(rows);assert.equal(thesisFactView(input(rows)).numberChecks[0].status,'insufficient_coverage');}
 const other={...unit,completion:{originalText:'【待核对：第二章与第三章 12 位小数需统一】'}};assert.equal(thesisFactView({...input(),unit:other}).numberChecks[0].status,'insufficient_coverage');
});
test('view is bound to owner, run, source snapshot, manuscript, title, figure and version',()=>{const arg=input(),view=thesisFactView(arg);for(const key of ['ownerId','thesisId','runId','snapshotHash'])assert.equal(currentThesisFactView(view,{...arg,[key]:'other'}),false,key);for(const change of [rows=>{rows[0].text+='变';},rows=>{rows[0].figures.push({id:'new'});},rows=>{rows[0].title='新标题';},rows=>{rows[0].versionId='new-version';}]){const rows=chapters();change(rows);assert.equal(currentThesisFactView(view,{...arg,chapters:rows}),false);}});
