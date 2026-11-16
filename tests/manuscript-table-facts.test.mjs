import test from 'node:test';
import assert from 'node:assert/strict';
import {manuscriptTableFacts,displayedTableExtremaConflicts} from '../backend/manuscript-table-facts.mjs';
import {auditWritingConsistency} from '../backend/writing-quality.mjs';
import {createWritingQualityRunner} from '../backend/writing-quality-runner.mjs';
const text='表 1 分组统计\n| 物种 | 花萼长 | 花萼宽 |\n| --- | --- | --- |\n| setosa 均值 | 5.006 | 3.418 |\n| setosa 标准差 | 0.352490 | 0.381024 |\n| versicolor 均值 | 5.936 | 2.770 |\n| versicolor 标准差 | 0.516171 | 0.313798 |\n| virginica 均值 | 6.588 | 2.974 |\n| virginica 标准差 | 0.635880 | 0.322497 |',cross={tables:[{number:'1',entireTable:true,text}]};
test('numeric comparison separates means and deviations and catches the counterexample to all-columns minimum',()=>{
 const before=structuredClone(cross),facts=manuscriptTableFacts(cross),sd=facts.find(r=>r.statistic==='标准差');
 assert.equal(sd.columns[0].min[0].row,'setosa 标准差');assert.equal(sd.columns[1].min[0].row,'versicolor 标准差');assert.equal(sd.columns[1].max[0].row,'setosa 标准差');
 assert.deepEqual(sd.displayedDecimalPlaces,[6]);assert.deepEqual(facts.find(r=>r.statistic==='均值').displayedDecimalPlaces,[3]);assert.deepEqual(cross,before);
});
test('negative values and tied decimal representations compare exactly without binary precision assumptions',()=>{
 const source='表 2 统计\n| 组 | x |\n| --- | --- |\n| A 均值 | -0.100000 |\n| B 均值 | -0.1 |\n| C 均值 | 0.2 |';const facts=manuscriptTableFacts({tables:[{number:'2',entireTable:true,text:source}]});assert.equal(facts[0].columns[0].min.length,2);assert.equal(facts[0].columns[0].max[0].row,'C 均值');
});
test('truncated tables, arbitrary mixed metrics and unsupported units get no inferred rankings',()=>{
 assert.deepEqual(manuscriptTableFacts({tables:[{...cross.tables[0],entireTable:false}]}),[]);
 for(const value of ['0.3 cm','1e-2','10%','—'])assert.deepEqual(manuscriptTableFacts({tables:[{...cross.tables[0],text:text.replace('0.381024',value)}]}),[]);
 const source='表 3 统计\n| 指标 | 数值 |\n| --- | --- |\n| 成本 | 100 |\n| 准确率 | 98 |';assert.deepEqual(manuscriptTableFacts({tables:[{number:'3',entireTable:true,text:source}]}),[]);
});
test('review receives column-level facts while retaining its own exact quote and warning checks',async()=>{
 let seen=false;const chapters=[{id:'results',title:'结果',text:text+'\n\n由表1可见，setosa所有变量的标准差均为最小。'}];const runner=createWritingQualityRunner({citationVerifier:{verify:async()=>({items:[],summary:{},limitations:[]})}});
 await runner({chapters,kind:'thesis',checkSupplements:false,runtime:{maxTurns:3,maxOutputTokens:4096,timeoutMs:30000},dispatch:async({task})=>{assert.equal(task.context.displayedTableFacts.find(r=>r.statistic==='标准差').columns[1].min[0].row,'versicolor 标准差');assert.match(task.instructions,/某一列成立不能推广为所有列/);seen=true;return{text:JSON.stringify({complete:true,findings:[],limitations:[]})};}});assert.equal(seen,true);
});
test('an explicit all-variable extreme conflicting with a complete table is a located deterministic warning',()=>{
 const claim='setosa所有变量的标准差均为三组最小',body=text+'\n\n由表1可见，'+claim+'。',found=displayedTableExtremaConflicts(body);assert.equal(found.length,1);assert.equal(found[0].quote,claim);assert.equal(body.slice(found[0].offset,found[0].offset+claim.length),claim);assert.equal(found[0].conflicts[0].column,'花萼宽');
 const audited=auditWritingConsistency({chapters:[{id:'results',title:'结果',text:body}]});assert.ok(audited.findings.some(f=>f.reasonCode==='displayed_table_extrema_conflict'&&f.severity==='warning'));
});
test('correct extrema, ties, partial scopes, negations, quoted examples and fenced code are not rejected',()=>{
 for(const tail of ['setosa一个变量的标准差均为三组最小。','并非setosa所有变量的标准差均为三组最小。','例如setosa所有变量的标准差均为三组最小。','“setosa所有变量的标准差均为三组最小”是一种错误说法。','```txt\nsetosa所有变量的标准差均为三组最小\n```'])assert.deepEqual(displayedTableExtremaConflicts(text+'\n\n'+tail),[]);
 assert.deepEqual(displayedTableExtremaConflicts(text.replace('3.418','2.000')+'\n\nsetosa所有变量的均值均为三组最小。'),[]);
 const tied=text.replace('0.313798','0.381024').replace('0.322497','0.381024');assert.deepEqual(displayedTableExtremaConflicts(tied+'\n\nsetosa所有变量的标准差均为三组最小。'),[]);
 assert.deepEqual(displayedTableExtremaConflicts(text+'\n\n'+text.replace('表 1','表 2')+'\n\nsetosa所有变量的标准差均为三组最小。'),[]);
});
