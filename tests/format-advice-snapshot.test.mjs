import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultRules,checkFormatting,formatAdviceSnapshot} from '../dist/workspace/format-model.mjs';

const paragraph=(level,format)=>({text:'用于检验格式定位的真实合成段落',level,format});
test('format advice exposes one-based locations, explicit physical units and authoritative deterministic counts',()=>{
 const rules=defaultRules(),doc={paragraphs:[paragraph(1,{font:['宋体'],size:[12]}),paragraph(0,{font:['黑体'],size:[10.5],line:[1],indent:[0]}),paragraph(0,{font:['宋体'],size:[12],line:[1.5],indent:[2]})],sections:[{top:1,bottom:2.5,left:2.5,right:3}],warnings:[]};
 const originalRules=structuredClone(rules),originalIssues=checkFormatting(doc,rules),snapshot=formatAdviceSnapshot({title:'格式验收'},doc,rules),review=JSON.parse(snapshot.text);
 assert.equal(review.totalIssues,8);assert.deepEqual(review.issueSummary,{total:8,selected:8,groups:[{name:'标题',count:2},{name:'正文',count:4},{name:'分节页边距',count:2}]});
 assert.deepEqual(review.issues.filter(i=>i.section!=null).map(i=>[i.location,i.section,i.label,i.unit,i.target]),[['第 1 节',1,'上页边距','cm','2.5 cm'],['第 1 节',1,'右页边距','cm','2.5 cm']]);assert.ok(review.issues.every(i=>!Object.hasOwn(i,'index')));
 assert.deepEqual(review.issues.find(i=>i.paragraph===1&&i.key==='size'),{location:'段落 1',paragraph:1,key:'size',label:'字号',status:'fix',unit:'pt',current:'12 pt',target:'16 pt'});
 assert.equal(review.rules.h1,'16 pt');assert.equal(review.rules.top,'2.5 cm');assert.equal(review.rules.line,'1.5 倍');assert.equal(review.rules.indent,'2 字符');assert.equal(review.paragraphs[0].role,'1级标题');assert.equal(review.paragraphs[1].role,'正文');
 assert.match(snapshot.requirements,/不得重新分组计数/);assert.match(snapshot.requirements,/不得将16pt说成16号/);assert.match(snapshot.requirements,/逐字使用 issues.location/);assert.equal(snapshot.materials[0].text,snapshot.text);assert.deepEqual(rules,originalRules);assert.deepEqual(checkFormatting(doc,rules),originalIssues);
});

test('format advice separates the full authoritative issue count from a capped excerpt without inventing paragraph text',()=>{
 const rules=defaultRules(),doc={paragraphs:Array.from({length:30},()=>paragraph(0,{font:['黑体'],size:[10.5],line:[1],indent:[0]})),sections:[{top:2.5,bottom:2.5,left:2.5,right:2.5}],warnings:[]},review=JSON.parse(formatAdviceSnapshot({title:'长文格式验收'},doc,rules).text);
 assert.equal(review.totalIssues,120);assert.equal(review.issueSummary.total,120);assert.equal(review.issueSummary.selected,80);assert.equal(review.issueSummary.groups.find(g=>g.name==='正文').count,120);assert.equal(review.issues.length,80);assert.equal(review.paragraphs.length,12);assert.deepEqual(review.paragraphs.map(p=>p.paragraph),Array.from({length:12},(_,i)=>i+1));assert.equal(review.totalParagraphs,30);
});
