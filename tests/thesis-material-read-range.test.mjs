import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeThesisSnapshot,thesisAgentTask,thesisReadableSources,selectThesisEvidence} from '../backend/thesis-model.mjs';
const unit={id:'u',chapterId:'c',chapterTitle:'实验结果',title:'实验结果',targetWords:300,sourceIds:[],presentation:{},completion:{scope:'full',originalText:'研究结果原稿。',missingInformation:[]}};
function snapshot(materials,references=[]){return normalizeThesisSnapshot({title:'实验结果',profile:{level:'本科',language:'中文',targetWords:500},requirements:{},materials,references,outline:[{id:'c',title:'实验结果',targetWords:300}]});}
test('writing tool receives full authorized original material, including records beyond preview',()=>{
 const original='【实验记录】\n'+'甲'.repeat(12000)+'\n【模型指标.csv】\nSVM_RBF,0.9605316321105795\n【逐条预测.csv】\nIRIS-073,versicolor,virginica';
 const s=snapshot([{id:'m',name:'研究记录',confirmed:true,text:original},{id:'not-authorized',name:'未授权',confirmed:false,text:'PRIVATE'}]);const task=thesisAgentTask(s,unit,[]),material=task.materials.find(row=>row.id==='m'),info=task.context.confirmedSources.find(row=>row.id==='m');
 assert.equal(material.text,original);assert.ok(material.text.indexOf('IRIS-073')>12000);assert.equal(info.readableCharacters,original.length);assert.equal(info.totalCharacters,original.length);assert.equal(info.readTruncated,false);assert.ok(info.readHints.some(h=>original.slice(h.offset).startsWith('【模型指标.csv】')));assert.ok(!task.materials.some(row=>row.id==='not-authorized'));assert.match(task.instructions,/readHints.*不是事实证据/);
});
test('long original sources share bounded readable prefixes with explicit scope and no unselected data',()=>{
 const materials=Array.from({length:10},(_,i)=>({id:'m'+i,name:'记录'+i,confirmed:true,text:'【记录】\n'+String(i).repeat(9000)}));const s=snapshot(materials),chosen=selectThesisEvidence(s,unit).sources,read=thesisReadableSources(s,chosen);assert.equal(read.materials.length,10);assert.ok(read.materials.reduce((n,r)=>n+r.text.length,0)<=80000);
 for(const item of read.materials){const original=s.materials.find(x=>x.id===item.id).text,meta=read.details.get(item.id);assert.ok(item.text.length>=7900);assert.equal(item.text,original.slice(0,item.text.length));assert.equal(meta.readTruncated,true);assert.equal(meta.readableCharacters,item.text.length);assert.equal(meta.totalCharacters,original.length);for(const hint of meta.readHints||[])assert.ok(hint.offset<item.text.length);}
 const task=thesisAgentTask(s,unit,[]);for(const info of task.context.confirmedSources)assert.ok(info.fragments.every(fragment=>fragment.end<=info.readableCharacters));
 assert.throws(()=>thesisReadableSources(s,[{id:'alien',name:'not authorized'}]),e=>e.code==='source_unavailable');
});
test('bounded material prefixes never split a UTF-16 surrogate pair',()=>{
 const materials=Array.from({length:10},(_,i)=>({id:'m'+i,name:'记录'+i,confirmed:true,text:'甲'.repeat(7999)+'🧪'+'乙'.repeat(999)})),s=snapshot(materials),read=thesisReadableSources(s,selectThesisEvidence(s,unit).sources);for(const row of read.materials){assert.ok(!/[\uD800-\uDBFF]$/.test(row.text));assert.equal(row.text.length,7999);assert.equal(read.details.get(row.id).readableCharacters,7999);}
});
test('a cited abstract receives the same authorized original source and keeps its boundaries',()=>{
 const text='第一段。'+'研'.repeat(14000)+'\n【参考细节】\n资料尾部',s=snapshot([], [{id:'r',title:'真实文献',authors:'作者',year:'2025',confirmed:true,text}]),u={...unit,frontMatter:'abstract_zh',completion:{...unit.completion,originalText:'摘要原文[source:r]'}};const task=thesisAgentTask(s,u,[]);assert.equal(task.materials.find(x=>x.id==='r').text,text);assert.equal(task.context.confirmedSources.find(x=>x.id==='r').readTruncated,false);
});
test('an abstract with an identified factual gap can read authorized data without inventing a citation',()=>{
 const text='【逐条预测.csv】\n'+'甲'.repeat(9000)+'\nIRIS-073,versicolor,virginica',s=snapshot([{id:'m',name:'研究数据',confirmed:true,text}]),u={...unit,frontMatter:'abstract_en',completion:{scope:'full',originalText:'An abstract.',missingInformation:['核对预测记录']}};const task=thesisAgentTask(s,u,[]);assert.equal(task.materials[0].text,text);assert.match(task.instructions,/摘要不添加正文引用/);assert.match(task.instructions,/不能借资料编造/);assert.ok(task.context.confirmedSources[0].readHints.length);
});
test('abstract reading retains simulation provenance and explicitly forbids describing it as a real measurement',()=>{
 const s=snapshot([{id:'m',name:'模拟研究',confirmed:true,text:'这是仿真结果，不是真实测量。'}]);s.materials[0].dataKind='simulation';const u={...unit,frontMatter:'abstract_zh',completion:{scope:'full',originalText:'已有摘要。',missingInformation:['核对结果']}};const task=thesisAgentTask(s,u,[]);assert.equal(task.context.confirmedSources[0].dataKind,'simulation');assert.match(task.instructions,/模拟分析，不得表述为实测/);
});
