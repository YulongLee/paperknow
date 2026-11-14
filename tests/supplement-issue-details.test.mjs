import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementIssueDetails} from '../backend/supplement-issue-details.mjs';
import {runSupplementCheck} from '../backend/supplement-check.mjs';

const chapters=[{id:'ch1',title:'结果',text:'甲研究结果。乙研究结果。'}];
const snapshot={materials:[{id:'m1',text:'来源文字：甲研究结果。结束'}]};
const items=[{id:'check-0-0',title:'结果',status:'missing',requirement:'研究资料',reason:'需进一步核对。',manuscriptQuote:'甲研究结果。',missing:['核对来源','核对 DOI'],evidence:[{sourceId:'m1',quote:'甲研究结果。'}]}];
const materials=[{id:'m1',text:'来源文字：甲研究结果。结束'}];
const trace=[{tool:'read_material',status:'completed',materialId:'m1',offset:0,limit:30}];
const build=changes=>supplementIssueDetails({items,chapters,snapshot,phase:'final',materials,trace,...changes});

test('missing records split for display but never authorize confirmation',()=>{
 const out=build();assert.equal(out.length,2);assert.notEqual(out[0].id,out[1].id);assert.equal(out[0].location.chapterId,'ch1');assert.equal(out[0].location.offset,0);assert.equal(out[0].evidence[0].quote,'甲研究结果。');assert.ok(out.every(row=>row.confirmationAllowed===false));
});
test('cannot claim evidence from preview, wrong source, failed read, or partial range',()=>{
 for(const value of [[],[{...trace[0],materialId:'m2'}],[{...trace[0],status:'failed'}],[{...trace[0],limit:7}],[{tool:'read_material',status:'completed',materialId:'m1'}]])assert.deepEqual(build({trace:value})[0].evidence,[]);
 assert.deepEqual(build({materials:[...materials,...materials]})[0].evidence,[]);
});
test('ambiguous manuscript and ambiguous source excerpt cannot be used as a location',()=>{
 assert.equal(build({chapters:[{...chapters[0],text:'甲研究结果。甲研究结果。'}]})[0].location,null);
 assert.deepEqual(build({materials:[{id:'m1',text:'甲研究结果。甲研究结果。'}]})[0].evidence,[]);
});
test('whole input changes invalidate the diagnostic binding; unsupported ids never locate a chapter',()=>{
 const before=build()[0];assert.notEqual(before.binding,build({snapshot:{materials:[]}})[0].binding);assert.notEqual(before.binding,build({chapters:[...chapters,{id:'ch2',text:'其他章节'}]})[0].binding);
 const out=build({items:[{...items[0],id:'check-99-0'}]});assert.equal(out[0].location,null);assert.equal(out[0].confirmationAllowed,false);
});
test('recovery section identifiers still resolve against the original full chapter',()=>{
 const out=build({items:[{...items[0],id:'check-0-8000-recovery-0-recovery-1'}]});assert.equal(out[0].location.offset,0);
});
test('real supplement pipeline retains per-item diagnostics without changing the final gate',async()=>{
 const report=await runSupplementCheck({snapshot,chapters,dispatch:async({task})=>({text:JSON.stringify({items:[{...items[0],id:task.context.chapters[0].id,evidence:[]}]}),trace:[]})});
 assert.equal(report.status,'needs_materials');assert.equal(report.coverage.complete,true);assert.equal(report.issueDetails.length,2);assert.equal(report.issueDetails[0].location.chapterId,'ch1');assert.equal(report.issueDetails[0].confirmationAllowed,false);
});
