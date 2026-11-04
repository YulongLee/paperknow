import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {selectLiteratureOverview,readingRangeLabel} from '../dist/workspace/literature-reading-selection.mjs';
import {literatureParagraphs,validateSavedLiteratureAiResults} from '../dist/workspace/literature-ai-model.mjs';
import {locatePdfQuote} from '../dist/workspace/pdf-quote-location.mjs';
import {enrichLiteraturePaper} from '../dist/workspace/literature-import-metadata.mjs';
import {normalizeToolRequest,toolRunPlan,toolRunTask,parseToolOutput,validateToolCandidate} from '../backend/tool-run-model.mjs';
import {mountLiteratureAi} from '../dist/workspace/literature-ai.mjs';

const paper={id:'assessment-regression',title:'Synthetic study',scope:'full',text:'# Synthetic study\n\n## Abstract\n\nA complete abstract about a synthetic sequence study.\n\n## 1 Introduction\n\nThe motivating question is sequence processing.\n\n## 2 Method\n\nThe method uses scaled attention for encoding.\n\n## 3 Experiments\n\nThe experiment compares two synthetic systems on held-out samples.\n\n## 4 Results\n\nThe result is a score of 27.3 under the stated conditions.\n\n## 5 Limitations\n\nThe limitation is a restricted sample and one domain.\n\n## 6 Conclusion\n\nThe conclusion applies only to these stated sequence tasks.\n\n## References\n\nUnrelated reference listing must not replace experiment evidence.'};
test('overview covers every available section with exact complete paragraphs and one coherent plan',()=>{
 const {materials,coverage}=selectLiteratureOverview(paper),parts=literatureParagraphs(paper.text);
 assert.equal(coverage.coveredSections,7);assert.equal(coverage.sections,7);assert.equal(materials.length,7);
 for(const source of materials)assert.equal(parts.find(p=>p.id===source.id).text,source.text);
 assert.ok(materials.some(m=>m.text.includes('27.3')));assert.ok(materials.some(m=>m.text.includes('limitation')));assert.ok(!materials.some(m=>m.text.includes('reference listing')));
 const value=normalizeToolRequest({kind:'literature',operation:'read',snapshot:{title:paper.title,mode:'summary',materials,context:{readingCoverage:coverage}}});assert.equal(toolRunPlan(value).length,1);
 const task=toolRunTask(value,toolRunPlan(value)[0]);assert.equal(task.materials.length,7);
 const label=readingRangeLabel({operation:'read',parts,materials,coverage});assert.match(label,/7 \/ 7 节 · 7 段/);
 validateSavedLiteratureAiResults([{id:'r',operation:'read',sourceScope:'full',materials,mode:'summary',output:{text:'A bounded section overview.',sourceIds:[materials[0].id],citations:[{sourceId:materials[0].id,quote:materials[0].text}]}}]);
});
test('long overviews preserve limits and tell the truth when some sections cannot fit',()=>{
 const p={...paper,id:'large',text:Array.from({length:45},(_,i)=>'## '+i+' Section\n\n'+('Full sentence for section '+i+'. ').repeat(75)).join('\n\n')};
 const {materials,coverage}=selectLiteratureOverview(p);assert.ok(materials.length<=20);assert.ok(coverage.characters<=18000);assert.ok(coverage.coveredSections<coverage.sections);assert.equal(coverage.coveredSections,new Set(materials.map(m=>m.name.split(' · ')[1])).size);
 const changed=selectLiteratureOverview({...paper,text:paper.text.replace('27.3','88.8')});assert.ok(changed.materials.some(m=>m.text.includes('88.8')));
});
test('switching a formula question to summary does not reuse the question or fabricate the displayed range',async()=>{
 const dom=new JSDOM('<div id="ai"></div>',{url:'https://reading.test',pretendToBeVisual:true});let p=structuredClone(paper),snapshot;
 const api=async(path,data)=>{if(path==='/auth/me')return{user:{id:'isolated'}};if(path==='/tool-runs/reuse')return{item:null};if(path==='/tool-runs/capabilities')return{ready:true};if(path==='/tool-runs/quote'){snapshot=data.snapshot;throw Error('No paid generation in this test');}throw Error('Unexpected route '+path);};
 const ui=mountLiteratureAi({container:dom.window.document.querySelector('#ai'),layout:'assistant',initialOperation:'answer',ctx:{api},getPaper:()=>p,updatePaper:fn=>p=fn(p)});
 try{const d=dom.window.document,question=d.querySelector('[data-lit-ai-question]');question.value='Explain scaled attention formula';question.dispatchEvent(new dom.window.Event('input'));d.querySelector('[data-lit-ai-operation="read"][data-lit-assistant-mode="summary"]').click();
  assert.match(d.querySelector('[data-lit-range-label]').textContent,/7 \/ 7 节/);d.querySelector('[data-lit-ai-open]').click();for(let i=0;i<30&&!snapshot;i++)await new Promise(r=>setTimeout(r,5));
  assert.ok(snapshot);assert.equal(snapshot.question,'');assert.ok(snapshot.materials.some(m=>m.text.includes('27.3')));assert.ok(snapshot.materials.some(m=>m.text.includes('limitation')));assert.equal(snapshot.context.readingCoverage.coveredSections,7);
 }finally{ui.dispose();dom.window.close();}
});
const grounded=()=>normalizeToolRequest({kind:'literature',operation:'answer',snapshot:{title:'Grounding test',question:'What is the ImageNet score?',materials:[{id:'p1',name:'Abstract',text:'The reported experiment uses sequence translation only.'}],context:{answerEvidencePolicy:'grounded-v2'}}});
const result=body=>({text:JSON.stringify({complete:true,sourceIds:['p1'],citations:[{sourceId:'p1',quote:'sequence translation only.'}],...body}),trace:[{tool:'read_material',status:'completed',materialId:'p1',offset:0,limit:6000}]});
test('missing-answer responses cannot carry invented other-chapter content into the saved answer',()=>{
 const value=grounded(),unit=toolRunPlan(value)[0];const parsed=parseToolOutput(result({answered:false,text:'ImageNet Top-1 准确率属于该论文实验部分其他章节的内容。'}),value,unit);
 assert.match(parsed.text,/未找到足够依据/);assert.doesNotMatch(parsed.text,/其他章节/);assert.equal(parsed.answered,false);
 const bad=result({answered:true,text:'ImageNet Top-1 准确率属于该论文实验部分其他章节的内容。'});assert.equal(validateToolCandidate(bad,value,unit).valid,false);
 assert.equal(validateToolCandidate(result({text:'No answer.'}),value,unit).valid,false);
 assert.match(toolRunTask(value,unit).instructions,/不推断未读取章节/);
});
test('PDF quote lookup handles wrapping and math markup, and refuses missing or ambiguous matches',()=>{
 const lines=[{page:8,text:'Transformer (base model) 27.3 38.1 3.3 · 10¹⁸',x:.1,y:.2,h:.02,right:.8},{page:8,text:'Transformer (big) 28.4 41.8',x:.1,y:.23,h:.02,right:.8}];
 const found=locatePdfQuote(lines,'Transformer (base model) 27.3 38.1 $3.3 \\cdot 10^{18}$ Transformer (big) 28.4 41.8');assert.equal(found.page,8);assert.equal(found.lines.length,2);
 assert.equal(locatePdfQuote([...lines,...lines.map(l=>({...l,page:9}))],'Transformer (big) 28.4 41.8'),null);
 assert.equal(locatePdfQuote(lines,'A claim not present in this document'),null);assert.equal(locatePdfQuote([], 'Image-only scan with no text layer'),null);
});
test('metadata extraction only uses the imported header and never overwrites user fields',()=>{
 const text='# A trusted title\n\nJane Doe $^{*}$ Example University\njane@example.invalid\n\n## Abstract\n\nActual abstract text.\n\n## Method\n\nMethod body';
 const p=enrichLiteraturePaper({text,authors:'',abstract:''});assert.equal(p.authors,'Jane Doe');assert.equal(p.abstract,'Actual abstract text.');assert.equal(p.year,undefined);
 assert.equal(enrichLiteraturePaper({...p,authors:'User supplied author'}).authors,'User supplied author');assert.equal(enrichLiteraturePaper({text:'No header; no names.',authors:''}).authors,'');
});
