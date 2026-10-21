import test from 'node:test';
import assert from 'node:assert/strict';
import {splitMethodSupplement,fillMethodSupplement,methodSupplementStart,methodSupplementEnd} from '../dist/workspace/writing-method-supplement.mjs';
import {assessThesisEvidence} from '../dist/workspace/thesis-evidence.mjs';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';

test('filling and replacing a proposal preserves surrounding user explanation exactly',()=>{
 const first=fillMethodSupplement('用户已有说明。','拟开展方法一。');
 const existing=first+'\n\n用户后续条件。';
 const replaced=fillMethodSupplement(existing,'拟开展方法二。');
 assert.equal(replaced.split(methodSupplementStart).length,2);
 assert.ok(replaced.startsWith('用户已有说明。\n\n'));
 assert.ok(replaced.endsWith('\n\n用户后续条件。'));
 assert.deepEqual(splitMethodSupplement(replaced),{userText:'用户已有说明。\n\n用户后续条件。',methodText:'拟开展方法二。',hasMethod:true,invalid:false});
 assert.equal(fillMethodSupplement(replaced,''),'用户已有说明。\n\n用户后续条件。');
});

test('a marked proposal cannot become evidence through raw source text or snapshot fallback',()=>{
 const method='拟采用文献分析并核对用户条件。'.repeat(20),text=fillMethodSupplement('真实研究背景',method);
 const raw={materials:[{text,confirmed:true}]};
 assert.equal(assessThesisEvidence(raw).characters,6);
 const value=thesisSnapshotFromDraft({title:'方法采用验收',degree:'本科',targetWords:500,material:text,methodSuggestion:{text:method,jobId:'method-1'},outlineRows:[{title:'研究方法',level:1,words:500}]});
 assert.equal(value.materials[0].text,'真实研究背景');
 assert.equal(value.requirements.researchPlan.text,method);
 assert.equal(value.requirements.researchPlan.status,'proposed');
 assert.equal(assessThesisEvidence(value).ready,false);
});

test('incomplete, reversed or repeated method markers retain raw input without promoting any of it to evidence',()=>{
 const valid=fillMethodSupplement('研'.repeat(150),'拟开展方案'),base={title:'标记验收',targetWords:500,outlineRows:[{title:'研究方法',level:1,words:500}]};
 for(const raw of [valid.replace(methodSupplementEnd,''),valid.replace(methodSupplementStart,''),methodSupplementEnd+'\n'+methodSupplementStart,valid+'\n'+methodSupplementStart,valid+'\n'+valid]){
  const before=raw;assert.equal(splitMethodSupplement(raw).invalid,true);
  assert.equal(assessThesisEvidence({materials:[{text:raw,confirmed:true}]}).characters,0);
  assert.throws(()=>fillMethodSupplement(raw,'替换方法'),/标记不完整或重复/);
  assert.throws(()=>thesisSnapshotFromDraft({...base,material:raw}),/标记不完整或重复/);
  assert.equal(raw,before);
 }
});
