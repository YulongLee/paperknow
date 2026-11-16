import test from 'node:test';
import assert from 'node:assert/strict';
import {splitDenseSupplementPiece} from '../backend/supplement-dense-sections.mjs';
import {runSupplementCheck} from '../backend/supplement-check.mjs';

const refs=Array.from({length:9},(_,i)=>({id:'r'+i,title:'来源 '+i,text:'这是一段授权来源证据 '+i+'，用于合成测试。',confirmed:true}));
const paragraphs=refs.map((r,i)=>`第 ${i+1} 段记录了明确的研究事实，并引用对应的材料[source:${r.id}]。`);
const text=paragraphs.join('\n\n');
const piece=value=>({text:value,figures:[]});

test('dense sources are split only at paragraph boundaries and preserve every byte and citation',()=>{
 const parts=splitDenseSupplementPiece(piece(text));assert.equal(parts.length,3);assert.equal(parts.map(part=>part.text).join(''),text);
 assert.deepEqual(parts.map(part=>part.relativeOffset),[0,parts[0].text.length,parts[0].text.length+parts[1].text.length]);
 for(const part of parts)assert.ok(new Set([...part.text.matchAll(/\[source:([^\]]+)\]/g)].map(match=>match[1])).size<=4);
});
test('an indivisible sentence is never split and a detached citation stays with its preceding paragraph',()=>{
 const indivisible=paragraphs.join(' ').replaceAll('。','，'),untouched=splitDenseSupplementPiece(piece(indivisible));assert.equal(untouched.length,1);assert.equal(untouched[0].text,indivisible);
 const value=paragraphs.slice(0,4).join('\n\n')+'\n\n[source:r4]附加依据。\n\n'+paragraphs.slice(5).join(' '),parts=splitDenseSupplementPiece(piece(value));assert.equal(parts.map(part=>part.text).join(''),value);assert.ok(parts.every(part=>!/^\s*\[source:/u.test(part.text)));assert.ok(parts.some(part=>part.text.includes(paragraphs[3])&&part.text.includes('[source:r4]')));
});
test('code fences and math are never split across a boundary',()=>{
 for(const wrapper of [value=>'```\n'+value+'\n```',value=>'```\n'+value+'\n~~~',value=>'$$\n'+value+'\n$$',value=>'\\[\n'+value+'\n\\]']){
  const value=wrapper(text),parts=splitDenseSupplementPiece(piece(value));assert.equal(parts.length,1);assert.equal(parts[0].text,value);
 }
});
test('an indivisible source-heavy sentence does not prevent safe splits around it',()=>{
 const heavy=paragraphs.slice(2).join(' ').replaceAll('。','，'),value=paragraphs.slice(0,2).join('\n\n')+'\n\n'+heavy,parts=splitDenseSupplementPiece(piece(value));assert.equal(parts.length,2);assert.equal(parts.map(row=>row.text).join(''),value);assert.equal(parts[1].text,heavy);assert.equal(new Set([...parts[1].text.matchAll(/\[source:([^\]]+)\]/g)].map(m=>m[1])).size,7);
});
test('sentence boundaries split a dense paragraph while preserving post-punctuation citation markers',()=>{
 const value=paragraphs.map((p,i)=>i===3?p.replace('[source:r3]。','。[source:r3]'):p).join(''),parts=splitDenseSupplementPiece(piece(value));assert.ok(parts.length>1);assert.equal(parts.map(row=>row.text).join(''),value);assert.ok(parts.every(part=>!/^\s*\[source:/u.test(part.text)));assert.ok(parts.some(part=>part.text.includes('。[source:r3]')));
});
test('an embedded figure, table or imported document object keeps its complete surrounding section',()=>{
 for(const marker of ['[figure:flow]','[docx:obj-0123456789abcdef01234567]','| 列一 | 列二 |\n| --- | --- |']){const value=text+'\n\n'+marker,parts=splitDenseSupplementPiece(piece(value));assert.equal(parts.length,1);assert.equal(parts[0].text,value);}
});
test('opt-in dense final review checks every partition and every cited source without relaxing evidence',async()=>{
 const calls=[],chapter={id:'chapter',title:'研究背景',text,figures:[]},snapshot={materials:[],references:refs};
 const report=await runSupplementCheck({snapshot,chapters:[chapter],kind:'thesis',phase:'final',denseCitationSections:true,runtime:{maxTurns:6,maxOutputTokens:4096,timeoutMs:30000},dispatch:async({task,validateReviewOutput})=>{
  calls.push(task);const items=task.context.chapters.map(section=>{const ids=[...new Set([...section.text.matchAll(/\[source:([^\]]+)\]/g)].map(m=>m[1]))];return {id:section.id,status:'sufficient',requirement:'引用内容',reason:'已核对提供的内容。',manuscriptQuote:section.text.slice(0,20),checkedFigureIds:[],missing:[],evidence:ids.map(id=>({sourceId:id,quote:refs.find(r=>r.id===id).text}))};});
  const output={text:JSON.stringify({items}),trace:[],usage:{input:10,output:10},costUsd:.001};assert.equal(validateReviewOutput(output).valid,true);return output;
 }});
 assert.equal(report.status,'final_ready');assert.equal(report.coverage.complete,true);assert.equal(report.coverage.total,3);assert.equal(report.coverage.checked,3);
 assert.equal(calls.length,3);for(const task of calls){assert.ok(new Set(task.context.chapters.flatMap(section=>[...section.text.matchAll(/\[source:([^\]]+)\]/g)].map(m=>m[1]))).size<=4);assert.ok(task.context.chapters.every(section=>section.partialChapter===true));assert.match(task.instructions,/仅是原章节的一部分/);assert.match(task.instructions,/不能当成独立资料或核实证据/);}
 const segments=calls.flatMap(task=>task.context.chapters);assert.equal(segments[0].adjacentContext.before,'');assert.ok(segments[0].adjacentContext.after);assert.ok(segments[1].adjacentContext.before);assert.equal(segments.at(-1).adjacentContext.after,'');
 assert.match(report.limitations.join(' '),/跨段关系与未读取的来源仍需人工复核/);
 assert.equal(calls.flatMap(task=>task.context.chapters).map(row=>row.text).join(''),text);assert.equal(report.items.reduce((sum,item)=>sum+item.citationCoverage.withExcerpt,0),9);
});
test('a cost limit on a partition stays incomplete and never automatically retries or marks later parts checked',async()=>{
 let calls=0;const chapter={id:'chapter',title:'研究背景',text,figures:[]},snapshot={materials:[],references:refs};
 const report=await runSupplementCheck({snapshot,chapters:[chapter],kind:'thesis',phase:'final',recover:true,denseCitationSections:true,runtime:{maxTurns:6,maxOutputTokens:4096,timeoutMs:30000},dispatch:async({task,validateReviewOutput})=>{
  if(++calls===2)throw Object.assign(new Error('model limit'),{status:502,code:'cost_budget'});
  const items=task.context.chapters.map(section=>({id:section.id,status:'sufficient',requirement:'引用内容',reason:'已核对提供的内容。',manuscriptQuote:section.text.slice(0,20),checkedFigureIds:[],missing:[],evidence:[...section.text.matchAll(/\[source:([^\]]+)\]/g)].map(m=>({sourceId:m[1],quote:refs.find(r=>r.id===m[1]).text}))}));
  const output={text:JSON.stringify({items}),trace:[],usage:{input:10,output:10},costUsd:.001};assert.equal(validateReviewOutput(output).valid,true);return output;
 }});
 assert.equal(calls,2);assert.equal(report.status,'unavailable');assert.equal(report.reasonCode,'cost_budget');assert.deepEqual(report.coverage,{total:3,checked:1,complete:false});
});
test('dense splitting is disabled unless explicitly enabled for a final thesis review',async()=>{
 for(const options of [{kind:'thesis',phase:'final'},{kind:'thesis',phase:'materials',denseCitationSections:true},{kind:'writing',phase:'final',denseCitationSections:true}]){
  const seen=[];await runSupplementCheck({snapshot:{materials:[],references:refs},chapters:[{id:'chapter',title:'研究背景',text,figures:[]}],runtime:{maxTurns:6,maxOutputTokens:4096,timeoutMs:30000},...options,dispatch:async({task})=>{seen.push(...task.context.chapters);throw Object.assign(new Error('stop'),{code:'cost_budget'});}});
  assert.equal(seen.length,1);assert.equal(seen[0].text,text);
 }
});
test('opt-in checks separate ordinary chapters too, without increasing the allowed execution budget',async()=>{
 const chapters=[{id:'a',title:'摘要',text:'这是用于检查的合成摘要。'},{id:'b',title:'Abstract',text:'This is a synthetic abstract.'}],seen=[],runtime={maxTurns:4,maxOutputTokens:2048,timeoutMs:30000,maxCostUsd:.3};
 const report=await runSupplementCheck({snapshot:{materials:[],references:[]},chapters,kind:'thesis',phase:'final',denseCitationSections:true,runtime,dispatch:async({task,settings})=>{
  seen.push(task.context.chapters);assert.equal(settings.maxCostUsd,.3);assert.ok(settings.maxTurns<=4);const items=task.context.chapters.map(c=>({id:c.id,status:'not_required',requirement:'合成摘要',reason:'不含外部研究事实。',manuscriptQuote:c.text,evidence:[],missing:[],checkedFigureIds:[]}));return{text:JSON.stringify({items}),trace:[],usage:{input:1,output:1},costUsd:.001};
 }});
 assert.equal(report.status,'final_ready');assert.deepEqual(seen.map(rows=>rows.length),[1,1]);assert.equal(report.coverage.checked,2);
});
