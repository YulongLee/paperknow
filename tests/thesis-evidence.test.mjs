import test from 'node:test';
import assert from 'node:assert/strict';
import {assessThesisEvidence,thesisEvidenceMinCharacters} from '../dist/workspace/thesis-evidence.mjs';

test('thesis evidence counts only selected body text and keeps metadata and AI plans out of the source threshold',()=>{
 const onlyMetadata={materials:[],references:[{title:'Reference title '.repeat(20),abstract:'Abstract '.repeat(100),confirmed:true}],requirements:{researchPlan:{text:'AI proposed methods '.repeat(100)}}};
 const result=assessThesisEvidence(onlyMetadata);assert.equal(result.ready,false);assert.equal(result.characters,0);assert.equal(result.minCharacters,100);assert.match(result.reason,/确认至少一份含正文/);assert.match(result.reason,/当前 0/);
});

test('empty, one-character and whitespace-filled material cannot pass while 100 real Unicode characters can',()=>{
 for(const [text,count] of [['',0],['研',1],[' \n\t\u200b\u200d\ufeff '.repeat(100),0],['研'.repeat(99),99],['𠀀'.repeat(99),99]]){const result=assessThesisEvidence({materials:[{text,confirmed:true}]});assert.equal(result.ready,false);assert.equal(result.characters,count);assert.match(result.reason,/100/);assert.match(result.reason,new RegExp('当前 '+count));}
 const result=assessThesisEvidence({materials:[{text:'𠀀'.repeat(100),confirmed:true}]});assert.equal(result.ready,true);assert.equal(result.characters,100);assert.equal(result.reason,'');assert.equal(thesisEvidenceMinCharacters,100);
});

test('confirmed source fragments combine across material and reference bodies without treating unconfirmed text as evidence',()=>{
 const value={materials:[{text:'研'.repeat(60),confirmed:true},{text:'未'.repeat(100),confirmed:false}],references:[{text:'究'.repeat(40),confirmed:true}]},before=structuredClone(value),result=assessThesisEvidence(value);
 assert.equal(result.ready,true);assert.equal(result.characters,100);assert.deepEqual(value,before);
 const unconfirmed=assessThesisEvidence({materials:[{text:'研'.repeat(100)}]});assert.equal(unconfirmed.ready,false);assert.equal(unconfirmed.characters,0);
 const review=assessThesisEvidence({materials:[{text:'研'.repeat(100)}]},{confirmedOnly:false});assert.equal(review.ready,true);assert.equal(review.characters,100);
});

test('malformed optional arrays and non-text values never make an evidence check throw or pass',()=>{
 for(const value of [undefined,null,{}, {materials:'text',references:{}},{materials:[null,{}, {text:123,confirmed:true},{text:false,confirmed:true}]}]){const result=assessThesisEvidence(value);assert.equal(result.ready,false);assert.equal(result.characters,0);}
});

test('format-only instructions are not research evidence while legacy manually entered notes remain valid',()=>{
 const formatting={text:'学校排版格式要求。'.repeat(200),purpose:'格式要求',confirmed:true};
 assert.equal(assessThesisEvidence({materials:[formatting]}).characters,0);
 const notes={text:'真实研究说明与已有记录。'.repeat(10),kind:'ai',purpose:'研究背景',confirmed:true};
 assert.equal(assessThesisEvidence({materials:[formatting,notes]}).ready,true);
 assert.equal(assessThesisEvidence({materials:[formatting,notes]}).characters,Array.from(notes.text).length);
});
