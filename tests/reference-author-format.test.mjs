import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {formatThesisReference,thesisDocumentPresentation} from '../dist/workspace/thesis-document.mjs';
import {normalizeThesisSnapshot} from '../backend/thesis-model.mjs';
import {createWritingDocx} from '../src/writing-document.js';

test('comma-separated full author names do not collapse into one author',()=>{
 const row={title:'Example paper',authors:'Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit',year:'2017'};
 const result=formatThesisReference(row);
 assert.match(result,/^Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit\./);
 assert.doesNotMatch(result,/\[(?:J|C|PP)/,'unknown publication type is not invented');
 assert.equal(row.authors,'Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit');
});

test('one western surname-comma-given name and ambiguous author strings retain their meanings',()=>{
 assert.match(formatThesisReference({title:'Example',authors:'Vaswani, Ashish'}),/^Vaswani A\./);
 const ambiguous='Smith, John, Jones, Alice';assert.ok(formatThesisReference({title:'Example',authors:ambiguous}).startsWith(ambiguous+'.'));
 const twoFullNames='Ashish Vaswani, Noam Shazeer';assert.ok(formatThesisReference({title:'Example',authors:twoFullNames}).startsWith(twoFullNames+'.'));
 for(const raw of ['Лев Толстой, Антон Чехов, Иван Тургенев','Willem van der Meer, Jan de Vries, Jane Smith'])assert.ok(formatThesisReference({title:'Example',authors:raw}).startsWith(raw+'.'));
 const romanized='Tanaka Akira, Kim Min, Lee Jin';assert.ok(formatThesisReference({title:'Example',authors:romanized}).startsWith(romanized+'.'));
 assert.match(formatThesisReference({title:'Example',authorNames:[{family:'Vaswani',given:'Ashish'}]}),/^Vaswani A\./);
 assert.match(formatThesisReference({title:'Example',authorNames:[{literal:'University of Example, Department of Science'}]}),/^University of Example, Department of Science\./);
 assert.match(formatThesisReference({title:'Example',authors:'张三,李四'}),/^张三, 李四\./);
});

test('manual comma-separated authors remain correctly formatted through summary Word export',async()=>{
 const snapshot=normalizeThesisSnapshot({title:'测试综述',profile:{level:'本科',language:'中文',targetWords:500},materials:[],references:[{id:'r',title:'Example paper',authors:'Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit',year:'2017',confirmed:true,text:'公开摘要。'}],outline:[{id:'c',title:'研究综述',targetWords:500}]});
 const p=thesisDocumentPresentation(snapshot,[{id:'c',title:'研究综述',text:'该文提出一种模型[source:r]。'}]);
 assert.match(p.text,/\[1\] Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit\. Example paper\. 2017\./);
 const bytes=await createWritingDocx(p.text,{documentKind:'writing',writingKind:'summary',metadata:{title:snapshot.title,chapterTitles:['研究综述'],citationRanges:p.citationRanges}});
 const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit\./);assert.doesNotMatch(xml,/\[(?:J|C|PP)/);assert.doesNotMatch(xml,/\[source:r\]/);
});
