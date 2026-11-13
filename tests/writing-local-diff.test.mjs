import test from 'node:test';
import assert from 'node:assert/strict';
import {localReviewScope,verifyLocalReviewCandidate,materializeLocalReviewCandidate} from '../backend/writing-local-diff.mjs';
import {checkTextLength} from '../backend/text-length.mjs';
const original='第一周：准备研究。\n第二周：对象信息待补充。\n第三周：完成测试安排。';
const findings=[{quote:'对象信息待补充。'}];
test('only a precisely located finding can change while all other text remains identical',()=>{
 const output='第一周：准备研究。\n第二周：计划邀请十二人。\n第三周：完成测试安排。';
 assert.deepEqual(verifyLocalReviewCandidate(original,findings,output),{eligible:true,accepted:true,changed:true,requiresFullReview:true});
 assert.equal(verifyLocalReviewCandidate(original,findings,output.replace('第三周','第四周')).accepted,false);
 assert.equal(verifyLocalReviewCandidate(original,findings,'完全重新撰写的正文').accepted,false);
 assert.equal(verifyLocalReviewCandidate(original,findings,output.replace('第一周：','第一周:')).accepted,false,'whitespace and punctuation outside the scope are protected');
});
test('missing, repeated and multiline anchors are not eligible; overlap covers only the union',()=>{
 assert.equal(localReviewScope(original,[]).eligible,false);
 assert.equal(localReviewScope('A A',[{quote:'A'}]).eligible,false);
 assert.equal(localReviewScope(original,[{quote:'不存在'}]).eligible,false);
 const overlap=[{quote:'对象信息'},{quote:'信息待补充'}];assert.equal(localReviewScope(original,overlap).eligible,true);
 assert.equal(verifyLocalReviewCandidate(original,overlap,original.replace('对象信息待补充','对象计划已补充')).accepted,true);
 assert.equal(verifyLocalReviewCandidate(original,overlap,original.replace('第二周：对象信息待补充','第九周：对象计划已补充')).accepted,false);
 assert.equal(localReviewScope(original,[{quote:'准备研究。\n第二周'}]).eligible,false);
 assert.equal(localReviewScope('甲乙',[{quote:'甲'},{quote:'乙'}]).eligible,false);
});
test('multiple anchors require exact non-ambiguous unchanged separators',()=>{
 const text='开头[A]分隔[B]结尾',issues=[{quote:'[A]'},{quote:'[B]'}];
 assert.equal(verifyLocalReviewCandidate(text,issues,'开头修改分隔修改结尾').accepted,true);
 assert.equal(verifyLocalReviewCandidate(text,issues,'开头修改分隔分隔修改结尾').accepted,false);
 assert.equal(verifyLocalReviewCandidate(text,issues,'开头修改分开修改结尾').accepted,false);
});
test('marked and complex objects never enter local rewriting',()=>{
 for(const text of ['|对象信息待补充。|','```\n对象信息待补充。\n```','$$\n对象信息待补充。\n$$','对象信息待补充。[figure:x]'])assert.equal(localReviewScope(text,findings).eligible,false,text);
 for(const replacement of ['补充\n新段落','[source:new]','[figure:new]','$$x$$','|列|'])assert.equal(verifyLocalReviewCandidate(original,findings,original.replace(findings[0].quote,replacement)).accepted,false,replacement);
});
test('a source marker on the same line remains byte-for-byte in place',()=>{
 const text='依据：对象信息待补充。[source:a] 其他正文。',accepted='依据：计划邀请十二人。[source:a] 其他正文。';
 assert.equal(verifyLocalReviewCandidate(text,findings,accepted).accepted,true);
 for(const changed of [accepted.replace('[source:a]',''),accepted.replace('[source:a]','[source:b]'),accepted.replace('[source:a]','')+'[source:a]',accepted.replace('计划邀请十二人。','计划邀请[source:b]十二人。')])assert.equal(verifyLocalReviewCandidate(text,findings,changed).accepted,false,changed);
 assert.equal(localReviewScope(text,[{quote:'对象信息待补充。[source:a]'}]).eligible,false,'an anchor cannot contain a source marker');
 assert.equal(localReviewScope('甲[source:a]乙',[{quote:'甲[source:a]'},{quote:'[source:a]乙'}]).eligible,false,'merged anchors cannot consume a marker');
});
test('any partial overlap with a citation or figure marker is rejected',()=>{
 const text='论述来自[source:ref-xyz]，后续继续。';
 for(const quote of ['[','source:ref','ref-xyz','xyz]',']','来自[source','xyz]，后续']){
  const scope=localReviewScope(text,[{quote}]);assert.equal(scope.eligible,false,quote);assert.equal(scope.reason,'anchor_touches_object_marker',quote);
 }
 assert.equal(localReviewScope('论述[source:incomplete',[{quote:'论述'}]).reason,'malformed_object_marker');
 assert.equal(localReviewScope('论述[figure:chart]',[{quote:'chart'}]).reason,'anchor_touches_object_marker');
});
test('Unicode and whitespace remain intact outside explicitly allowed spans',()=>{
 const text='🐑 前缀\n待修复\n后缀 🧪',issue=[{quote:'待修复'}];
 assert.equal(verifyLocalReviewCandidate(text,issue,'🐑 前缀\n已经修复\n后缀 🧪').accepted,true);
 assert.equal(verifyLocalReviewCandidate(text,[{quote:'\udc11'}],text).eligible,false);
 assert.equal(verifyLocalReviewCandidate(text,issue,'🐑前缀\n已经修复\n后缀 🧪').accepted,false);
});
test('scope verification must not replace length and final-review checks',()=>{
 const replacement='新',output=original.replace(findings[0].quote,replacement),result=verifyLocalReviewCandidate(original,findings,output);
 assert.equal(result.accepted,true);assert.equal(result.requiresFullReview,true);
 assert.equal(checkTextLength(output,{min:100,max:500,target:200}).withinRange,false);
});
test('short patches are assembled by the server and cannot include extra text or manipulate source markers',()=>{
 const body={complete:true,edits:[{index:1,replacement:'计划开展。'}],source_ids:['s1'],missing_evidence:[]};
 assert.equal(materializeLocalReviewCandidate(original,findings,body).text,original.replace(findings[0].quote,'计划开展。'));
 for(const candidate of [ {...body,text:'全文替换'}, {...body,edits:[]}, {...body,edits:[{index:2,replacement:'计划开展。'}]}, {...body,edits:[{index:1,replacement:'计划开展。[source:forged]'}]}, {...body,edits:[{index:1,replacement:'正文\n插入章节'}]} ])assert.throws(()=>materializeLocalReviewCandidate(original,findings,candidate));
});
test('patch rejection exposes only a fixed non-content diagnostic category',async()=>{
 const body={complete:true,edits:[{index:1,replacement:'计划开展。'}],source_ids:[],missing_evidence:[]};
 const failures=[[{...body,text:'私密全文'},'structure'],[{...body,edits:[]},'count'],[{...body,edits:[{index:2,replacement:'私密正文'}]},'order'],[{...body,edits:[{index:1,replacement:'[source:secret]'}]},'protected_content'],[{...body,edits:[{index:1,replacement:'长'.repeat(501)}]},'length']];
 for(const [candidate,reason] of failures)assert.throws(()=>materializeLocalReviewCandidate(original,findings,candidate),error=>error.localPatchReason===reason&&!error.message.includes('私密'));
 const {safeThesisValidation}=await import('../backend/thesis-retry-context.mjs');
 assert.equal(safeThesisValidation({code:'local_revision_scope',localPatchReason:'structure',text:'私密正文'}).localPatchReason,'structure');
 assert.equal(safeThesisValidation({code:'local_revision_scope',localPatchReason:'私密正文'}).localPatchReason,undefined);
});
test('patch rejects newly introduced repeated sentence punctuation, including across source markers',()=>{
 const body=replacement=>({complete:true,edits:[{index:1,replacement}],source_ids:['ref'],missing_evidence:[]}),finding=[{quote:'待补'}];
 for(const original of ['内容待补。','内容待补[source:ref]。','内容待补〔材料1〕。','内容待补，'])assert.throws(()=>materializeLocalReviewCandidate(original,finding,body('已补。')),error=>error.localPatchReason==='punctuation',original);
 assert.equal(materializeLocalReviewCandidate('内容待补。',finding,body('已补')).text,'内容已补。');
 assert.equal(materializeLocalReviewCandidate('内容待补。。',finding,body('已补')).text,'内容已补。。','pre-existing issue is not introduced by this edit');
 assert.equal(materializeLocalReviewCandidate('已有瑕疵。。其他内容待补。',finding,body('已补')).text,'已有瑕疵。。其他内容已补。');
 const distant='保留的瑕疵。。'+'甲'.repeat(1992)+'待补。';assert.equal(materializeLocalReviewCandidate(distant,finding,body('已补'+'乙'.repeat(100))).text,distant.replace('待补','已补'+'乙'.repeat(100)),'window comparisons remain aligned after a length change');
});
