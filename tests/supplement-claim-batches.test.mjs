import test from 'node:test';
import assert from 'node:assert/strict';
import {citationClaimBatches,validateCitationClaimBatch} from '../backend/supplement-claim-batches.mjs';
import {runSupplementCheck} from '../backend/supplement-check.mjs';

const refs=Array.from({length:7},(_,i)=>({id:'r'+i,title:'来源 '+i,text:'授权的合成来源 '+i+' 明确描述测试结果。',confirmed:true}));
const text=refs.map(r=>'单句引用材料[source:'+r.id+']，').join('')+'。',chapter={id:'ch',title:'结论',text},snapshot={references:refs,materials:[]},runtime={maxTurns:6,maxOutputTokens:4096,timeoutMs:30000};
function fixture({uncertain=false,ignoreUncertain=false,failClaim=false,failFinalOnce=false}={}){
 const calls=[];let finalAttempts=0;
 return {calls,dispatch:async({task,validateReviewOutput})=>{
  calls.push(task.context.phase);let items;
  if(task.context.phase==='citation-excerpt')items=task.context.chapters.map(row=>({id:row.id,status:'located',quote:task.materials.find(m=>m.id===row.sourceId).text}));
  else if(task.context.phase==='citation-claim'){
   if(failClaim)throw Object.assign(Error('budget'),{code:'cost_budget',status:502});
   const review=task.context.citationClaimReview;items=task.context.chapters.map(row=>{const claims=review.claims.filter(c=>c.sectionId===row.id),bad=uncertain&&claims.some(c=>review.sources[c.sourceIndex].sourceId==='r6');return{id:row.id,status:bad?'missing':'sufficient',citationAssessments:claims.map(c=>({id:c.id,status:bad&&review.sources[c.sourceIndex].sourceId==='r6'?'uncertain':'supported'}))};});
  }else{
   if(failFinalOnce&&finalAttempts++===0)throw Object.assign(Error('timeout'),{code:'timeout',status:504});
   items=task.context.chapters.map(row=>{const bad=task.context.citationClaimAssessments?.some(c=>c.sectionId===row.id&&c.status!=='supported');return{id:row.id,status:bad&&!ignoreUncertain?'missing':'sufficient',requirement:'引用依据',reason:bad?'部分引用依据待核对。':'已核对引用。',manuscriptQuote:row.text.slice(0,30),evidence:[{sourceId:'r0',quote:refs[0].text}],missing:bad&&!ignoreUncertain?['核对相关引用的来源依据']:[],checkedFigureIds:[]};});
  }
  const result={text:JSON.stringify({items}),trace:[],usage:{input:10,output:10},costUsd:.001};const validation=validateReviewOutput(result);if(!validation.valid)throw Object.assign(Error('invalid'),{code:'invalid_supplement_check'});return result;
 }};
}
const run=f=>runSupplementCheck({snapshot,chapters:[chapter],kind:'thesis',phase:'final',citationBatches:true,splitClaimBatches:true,runtime,dispatch:f.dispatch});

test('claim batches retain every occurrence, bind the same source and reject forged support',()=>{
 const sources=refs.map((r,i)=>({sectionId:'ch',sourceId:r.id,offset:i,status:i===6?'unavailable':'located',...(i===6?{}:{quote:r.text})})),claims=sources.map((s,i)=>({id:'claim-'+i,sectionId:'ch',offset:i,sourceIndex:i})),batches=citationClaimBatches({sources,claims},[chapter]);assert.deepEqual(batches.map(b=>b.review.claims.length),[3,3,1]);assert.deepEqual(batches.flatMap(b=>b.review.claims.map(c=>c.id)),claims.map(c=>c.id));
 const last=batches.at(-1),bad={text:JSON.stringify({items:[{id:'ch',status:'sufficient',citationAssessments:[{id:'claim-6',status:'supported'}]}]})};assert.throws(()=>validateCitationClaimBatch(last,bad));
});
test('every claim batch and the independent whole-section review are required',async()=>{
 const f=fixture(),report=await run(f);assert.equal(report.status,'final_ready');assert.equal(report.coverage.complete,true);assert.deepEqual(f.calls,['citation-excerpt','citation-excerpt','citation-claim','citation-claim','citation-claim','final']);assert.equal(report.items[0].citationClaimReview.items.length,7);
});
test('an uncertain claim requires a missing finding and cannot be silently accepted',async()=>{
 const f=fixture({uncertain:true}),report=await run(f);assert.equal(report.status,'needs_materials');assert.equal(report.items[0].citationClaimReview.items.filter(row=>row.status==='uncertain').length,1);
 const ignored=await run(fixture({uncertain:true,ignoreUncertain:true}));assert.notEqual(ignored.status,'final_ready');assert.equal(ignored.coverage.complete,false);
});
test('a failed claim batch stops review without marking the text complete',async()=>{
 const f=fixture({failClaim:true}),report=await run(f);assert.equal(report.status,'unavailable');assert.equal(report.reasonCode,'cost_budget');assert.equal(report.coverage.checked,0);assert.ok(!f.calls.includes('final'));
});
test('a transient final-review retry reuses only already validated supported claims',async()=>{
 const f=fixture({failFinalOnce:true}),report=await runSupplementCheck({snapshot,chapters:[chapter],kind:'thesis',phase:'final',recover:true,citationBatches:true,splitClaimBatches:true,runtime,dispatch:f.dispatch});assert.equal(report.status,'final_ready');assert.equal(f.calls.filter(x=>x==='citation-claim').length,3);assert.equal(f.calls.filter(x=>x==='citation-excerpt').length,2);assert.equal(f.calls.filter(x=>x==='final').length,2);
});
