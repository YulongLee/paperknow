import test from 'node:test';
import assert from 'node:assert/strict';
import {presentThesisDocument,formatThesisReference} from '../dist/workspace/thesis-document.mjs';
import {auditThesisSubmission} from '../src/thesis-export-check.js';
const ref={id:'paper',title:'Research Model',authors:'Smith, Alice; Jones, Bob; White, Carol; Black, David',year:'2024',documentType:'journal',journal:'Journal of Testing',volume:'10',issue:'2',pages:'1-9',doi:'10.1234/example-x',url:'https://example.test/Paper',confirmed:true};
const raw='Smith A, Jones B, White C, et al. Research Model[J]. Journal of Testing, 2024, 10(2): 1-9. DOI: 10.1234/example-x. https://example.test/Paper.';
const snapshot=(row=ref)=>({title:'测试论文',profile:{},materials:[],references:[row]});
const body={title:'正文',text:'此处引用[source:paper]。'};
const referenceChapter=text=>({title:'参考文献',kind:'references',text:'[source:paper] '+text});
const assess=(reference,entry)=>{const text=presentThesisDocument(snapshot(reference),[body,referenceChapter(entry)],{submission:true});assert.ok(text.includes(entry));assert.match(text,/参考文献整理原文/);assert.ok(auditThesisSubmission({text}).submission.issues.some(issue=>issue.code==='bibliography_unreconciled'));};
test('an uncited user reference is preserved for reconciliation in formal export',()=>{
 for(const entry of [formatThesisReference(ref),raw]){const rows=[{title:'正文',text:'没有引用的正文。'},referenceChapter(entry)],final=presentThesisDocument(snapshot(),rows,{submission:true});assert.ok(final.includes(entry));assert.match(final,/参考文献整理原文/);assert.ok(auditThesisSubmission({text:final}).submission.issues.some(issue=>issue.code==='bibliography_unreconciled'));}
});
test('punctuation in reference identity fields and URL paths is never silently discarded',()=>{
 for(const changed of [raw.replace('Research Model','Research-Model'),raw.replace('1-9','19'),raw.replace('example-x','examplex'),raw.replace('/Paper','/paper'),raw.replace('Smith A','Smith-A')])assess(ref,changed);
});
test('the original spelling cannot hide an independently supplied access date',()=>{
 assess({...ref,accessedAt:'2026-11-01'},raw);
});
test('different source identities cannot be merged just because the citation fields agree',()=>{
 const value={...snapshot(),references:[ref,{...ref,id:'other'}]},rows=[body,{title:'参考文献',kind:'references',text:'[source:other] '+raw}],text=presentThesisDocument(value,rows,{submission:true});assert.match(text,/参考文献整理原文/);assert.ok(text.includes(raw));assert.ok(auditThesisSubmission({text}).submission.issues.some(issue=>issue.code==='bibliography_unreconciled'));
});
