import test from 'node:test';
import assert from 'node:assert/strict';
import {createRevision,revisedText} from '../dist/workspace/revision-model.mjs';
import {revisionAiSnapshot,applyRevisionAiOutput} from '../dist/workspace/revision-ai-model.mjs';
import {revisionStrategyModes,revisionStrategyPlans,revisionStrategy} from '../dist/workspace/revision-strategy.mjs';
import {validateRevisionOriginal,validateRevisionProtection} from '../dist/workspace/revision-protection.mjs';

const originals=[
 '研究纳入 24 名参与者，观测时间为 2 周。测量值为 3.5 mg/mL，并使用公式 $x=2y$ 表示既定关系；相关条件保持不变 [1]。这些观察只描述本次材料，尚不能作为普遍因果结论。',
 '第二部分依据授权资料介绍研究步骤，强调材料范围、样本边界和条件限制。已有研究 Wang (2024) 仅用于说明背景，不替代本次观察证据。',
 '第三部分记录 12 次重复测量，温度控制在 25 °C；原文标记 [source:material-3] 需要逐字保留。讨论应区分可核对事实与待验证解释，不能补造额外研究结果。'
];
const document=(patch={})=>({...createRevision({title:'合成修改契约原稿',text:originals.join('\n\n'),mode:'rewrite',requirements:'保留真实证据与原文限制。'},'revision-contract','2026-10-20T00:00:00.000Z'),plan:'strong',...patch});
const candidateText=original=>original.trim()+' 相关表达现已调整，原有证据和限制仍按原文保留。';
const outputFor=(doc,source)=>({paragraphs:source.context.paragraphIds.map(id=>{const original=doc.paragraphs.find(p=>p.id===id).original.trim();return{id,original,revised:candidateText(original),action:'revise',reason:'调整论述衔接，并保留原文的证据边界。'};})});
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
const emptyChangedReason=paragraph=>typeof paragraph.reason==='string'&&paragraph.reason.length>0;

test('all generated test candidates obey the shared factual-token and length rules',()=>{
 const doc=document(),source=revisionAiSnapshot(doc,{scope:'all'}),output=outputFor(doc,source);
 for(const row of output.paragraphs){assert.equal(validateRevisionOriginal(row.original).valid,true);assert.equal(validateRevisionProtection(row.original,row.revised).valid,true);assert.ok(Array.from(row.revised).length>=Array.from(row.original).length);}
});

test('selected source paragraphs follow document order regardless of requested ID order and leave both inputs untouched',()=>{
 const doc=document(),ids=['p2','p0'],before=structuredClone(doc),beforeIds=[...ids],source=revisionAiSnapshot(doc,{scope:'selected',paragraphIds:ids});
 assert.deepEqual(source.context.paragraphIds,['p0','p2']);assert.equal(source.context.scope,'selected');assert.equal(source.text,[originals[0],originals[2]].join('\n\n'));assert.equal(source.text.includes(originals[1]),false);assert.deepEqual(ids,beforeIds);assert.deepEqual(doc,before);
});

test('selected scope restores only declared doc.aiSelection IDs and explicit invalid IDs cannot fall back to that selection',()=>{
 const doc=document({aiSelection:{paragraphIds:['p2','p0'],reportText:'PRIVATE_REPORT_SELECTION_TEXT'}}),source=revisionAiSnapshot(doc,{scope:'selected'});
 assert.deepEqual(source.context.paragraphIds,['p0','p2']);assert.equal(JSON.stringify(source).includes('PRIVATE_REPORT_SELECTION_TEXT'),false);
 for(const paragraphIds of [[],['p0','p0'],['absent'],['p0','absent'],null,'p0',[null],[0]])assert.throws(()=>revisionAiSnapshot(doc,{scope:'selected',paragraphIds}),undefined,JSON.stringify(paragraphIds));
 for(const aiSelection of [undefined,{}, {paragraphIds:[]},{paragraphIds:['p1','p1']},{paragraphIds:['absent']}])assert.throws(()=>revisionAiSnapshot(document({aiSelection}),{scope:'selected'}));
});

test('unknown scopes reject explicitly while legacy current and all retain their exact meaning',()=>{
 const doc=document();assert.deepEqual(revisionAiSnapshot(doc).context.paragraphIds,['p0']);assert.deepEqual(revisionAiSnapshot(doc,{scope:'current',index:2}).context.paragraphIds,['p2']);assert.deepEqual(revisionAiSnapshot(doc,{scope:'all',index:2}).context.paragraphIds,['p0','p1','p2']);
 for(const scope of ['report','selection','',null,42,{}])assert.throws(()=>revisionAiSnapshot(doc,{scope}),undefined,String(scope));
 for(const index of [-1,3,Number.NaN])assert.throws(()=>revisionAiSnapshot(doc,{scope:'current',index}));
});

test('selected requests validate only chosen originals and never truncate oversized paragraphs or total selections',()=>{
 const large=document();large.paragraphs[1].original='研究边界需要逐字核对。'.repeat(400);large.paragraphs[1].suggestion=large.paragraphs[1].original;
 assert.deepEqual(revisionAiSnapshot(large,{scope:'selected',paragraphIds:['p0']}).context.paragraphIds,['p0']);assert.throws(()=>revisionAiSnapshot(large,{scope:'selected',paragraphIds:['p1']}),/3,500/);
 const row='本段只用于验证选择范围与证据边界，不代表真实研究已经完成。';
 const many=document({paragraphs:Array.from({length:121},(_,i)=>({id:'n'+i,original:row,suggestion:row,reason:'',comment:'',accepted:false,resolved:false}))});
 assert.throws(()=>revisionAiSnapshot(many,{scope:'selected',paragraphIds:many.paragraphs.map(p=>p.id)}),/120/);assert.deepEqual(revisionAiSnapshot(many,{scope:'selected',paragraphIds:['n120']}).context.paragraphIds,['n120']);
 const longRow='材料范围和证据边界需要在所有段落中逐项核对。'.repeat(140).slice(0,3300),wide=document({paragraphs:Array.from({length:11},(_,i)=>({id:'w'+i,original:longRow,suggestion:longRow,reason:'',comment:'',accepted:false,resolved:false}))});
 assert.ok(wide.paragraphs[0].original.length<=3500);assert.throws(()=>revisionAiSnapshot(wide,{scope:'selected',paragraphIds:wide.paragraphs.map(p=>p.id)}),/32,000/);
});

test('fixed strategy modes and plans validate before producing a request, including the English plan',()=>{
 for(const mode of Object.keys(revisionStrategyModes))for(const plan of Object.keys(revisionStrategyPlans)){const source=revisionAiSnapshot(document({mode,plan}));assert.equal(source.mode,mode);assert.equal(source.context.plan,plan);assert.equal(revisionStrategy(mode,plan).mode,mode);if(plan==='english')assert.equal(source.language,'en');}
 for(const mode of ['unknown','constructor','__proto__',null,12])assert.throws(()=>revisionAiSnapshot(document({mode})));
 for(const plan of ['unknown','constructor','__proto__','',null,12])assert.throws(()=>revisionAiSnapshot(document({plan})));
 assert.equal(revisionAiSnapshot(document({plan:undefined})).context.plan,'strong');
});

test('original preflight rejects malformed math and invisible-only material in the selected range',()=>{
 for(const original of ['原文公式没有闭合：\\(x=2y，并且其余解释仍然保留。','\u200b\u200c\u2060'.repeat(30)]){
  const invalid=document();invalid.paragraphs[1]={...invalid.paragraphs[1],original,suggestion:original};assert.equal(validateRevisionOriginal(original).valid,false);assert.throws(()=>revisionAiSnapshot(invalid,{scope:'selected',paragraphIds:['p1']}));assert.deepEqual(revisionAiSnapshot(invalid,{scope:'selected',paragraphIds:['p0']}).context.paragraphIds,['p0']);
 }
});

test('snapshots send chosen original paragraphs and relevant comments, never user report bodies or saved report excerpts',()=>{
 const doc=document({reportText:'PRIVATE_COMPLETE_REPORT',reportAttachment:{source:'cnki',text:'PRIVATE_RAW_REPORT',evidence:[{paragraphId:'p0',excerpt:'PRIVATE_REPORT_EXCERPT',reportExcerpt:'PRIVATE_REPORT_SOURCE'}]},aiSelection:{paragraphIds:['p0'],reportText:'PRIVATE_SELECTION_REPORT'}});doc.paragraphs[0].comment='核对本段的证据边界。';doc.paragraphs[1].comment='UNSELECTED_COMMENT_SHOULD_STAY_LOCAL';
 const source=revisionAiSnapshot(doc,{scope:'selected'}),serialized=JSON.stringify(source);assert.equal(source.text,originals[0]);assert.match(source.requirements,/核对本段/);assert.equal(serialized.includes('UNSELECTED_COMMENT_SHOULD_STAY_LOCAL'),false);assert.doesNotMatch(serialized,/PRIVATE_(?:COMPLETE|RAW|REPORT|SELECTION)/);assert.deepEqual(source.materials,[]);
});

test('fresh paragraphs retain real revise and retain reasons without accepting any output automatically',()=>{
 const doc=document(),source=revisionAiSnapshot(doc,{scope:'all'}),output=outputFor(doc,source);output.paragraphs[1]={...output.paragraphs[1],revised:output.paragraphs[1].original,action:'retain',reason:'本段已明确说明研究边界，无需调整。'};const before=structuredClone(doc),next=applyRevisionAiOutput(freeze(doc),output,source);
 assert.deepEqual(doc,before);assert.notEqual(next,doc);assert.equal(next.original,doc.original);assert.equal(revisedText(next),doc.original);
 for(const [index,row]of output.paragraphs.entries()){const paragraph=next.paragraphs[index];assert.equal(paragraph.suggestion,row.revised);assert.equal(paragraph.reason,row.reason);assert.equal(paragraph.aiAction,row.action);assert.equal(paragraph.aiGeneratedText,row.revised);assert.equal(paragraph.accepted,false);}
 assert.match(next.paragraphs[1].reason,/无需调整/);
});

test('legacy changed rows without action or reason remain compatible revise candidates with an explicit missing-reason notice',()=>{
 const doc=document(),source=revisionAiSnapshot(doc),output=outputFor(doc,source);delete output.paragraphs[0].action;delete output.paragraphs[0].reason;const next=applyRevisionAiOutput(doc,output,source),paragraph=next.paragraphs[0];assert.equal(paragraph.suggestion,output.paragraphs[0].revised);assert.equal(paragraph.aiAction,'revise');assert.equal(paragraph.aiGeneratedText,paragraph.suggestion);assert.equal(emptyChangedReason(paragraph),true);assert.equal(paragraph.accepted,false);
});

test('retain requires an exact trimmed original and a substantive string reason',()=>{
 const doc=document(),source=revisionAiSnapshot(doc,{scope:'all'}),baseline=outputFor(doc,source),original=baseline.paragraphs[1].original;
 for(const patch of [{action:'retain',revised:original,reason:''},{action:'retain',revised:original,reason:'  '},{action:'retain',revised:original,reason:null},{action:'retain',revised:original,reason:['not a reason']},{action:'retain',revised:candidateText(original),reason:'仍然保留'},{action:'retain',revised:' '+original,reason:'只保留原文'}]){const output=structuredClone(baseline);Object.assign(output.paragraphs[1],patch);assert.throws(()=>applyRevisionAiOutput(doc,output,source),undefined,JSON.stringify(patch));}
 for(const reason of [0,{},['not a reason']]){const output=structuredClone(baseline);output.paragraphs[1].reason=reason;assert.throws(()=>applyRevisionAiOutput(doc,output,source));}
});

test('revise cannot disguise unchanged text with whitespace or default invisible characters',()=>{
 const doc=document(),source=revisionAiSnapshot(doc),baseline=outputFor(doc,source),original=baseline.paragraphs[0].original;
 for(const revised of [original,' '+original+' ',original.replace('这些观察','这些 观察'),original+'\u200b\u200c\u2060']){assert.equal(validateRevisionProtection(original,revised).valid,true);const output=structuredClone(baseline);output.paragraphs[0].revised=revised;assert.throws(()=>applyRevisionAiOutput(doc,output,source));}
 const unchanged=structuredClone(baseline);delete unchanged.paragraphs[0].action;delete unchanged.paragraphs[0].reason;unchanged.paragraphs[0].revised=original;assert.throws(()=>applyRevisionAiOutput(doc,unchanged,source));
});

test('invalid number, unit, formula, citation or short output rejects the whole immutable batch even after a valid first row',()=>{
 const cases=[
  text=>text.replace('12 次','13 次'),
  text=>text.replace('25 °C','25 °F'),
  text=>text.replace('[source:material-3]','[source:other-material]'),
  ()=> '保留边界。'
 ];
 for(const mutate of cases){const doc=document(),before=structuredClone(doc),source=revisionAiSnapshot(doc,{scope:'selected',paragraphIds:['p0','p2']}),output=outputFor(doc,source);output.paragraphs[1].revised=mutate(output.paragraphs[1].revised);assert.equal(validateRevisionProtection(output.paragraphs[1].original,output.paragraphs[1].revised).valid,false);assert.throws(()=>applyRevisionAiOutput(freeze(doc),output,source));assert.deepEqual(doc,before);assert.equal(doc.paragraphs[0].suggestion,originals[0]);}
 const doc=document(),source=revisionAiSnapshot(doc),output=outputFor(doc,source);for(const revised of [output.paragraphs[0].revised.replace('$x=2y$','$x=3y$'),output.paragraphs[0].revised.replace('[1]','[2]'),output.paragraphs[0].revised.replace('3.5 mg/mL','3.5 g/mL')]){assert.equal(validateRevisionProtection(originals[0],revised).valid,false);assert.throws(()=>applyRevisionAiOutput(doc,{paragraphs:[{...output.paragraphs[0],revised}]},source));}
});

test('rows must match the frozen source ID, order and original exactly, without silently skipping extra or missing output',()=>{
 const doc=document(),source=revisionAiSnapshot(doc,{scope:'all'}),baseline=outputFor(doc,source),before=structuredClone(doc);
 for(const rows of [[],baseline.paragraphs.slice(1),[...baseline.paragraphs,baseline.paragraphs[0]],baseline.paragraphs.slice().reverse(),baseline.paragraphs.map((p,i)=>i===2?{...p,id:'p1'}:p),baseline.paragraphs.map((p,i)=>i===2?{...p,original:'另一份原文'}:p),baseline.paragraphs.map((p,i)=>i===2?{...p,action:'accept'}:p)]){assert.throws(()=>applyRevisionAiOutput(freeze(doc),{paragraphs:rows},source));assert.deepEqual(doc,before);}
});

test('existing accepted or edited manuscripts preserve their chosen text and receive separate reviewable AI candidates',()=>{
 const doc=document();doc.paragraphs[0]={...doc.paragraphs[0],suggestion:candidateText(originals[0]),accepted:true,reason:'用户已核对的版本',aiAction:'revise',aiGeneratedText:'older AI candidate'};doc.paragraphs[1]={...doc.paragraphs[1],suggestion:originals[1]+' 用户手工补充的说明。',accepted:false,reason:'人工修改理由'};doc.paragraphs[2].accepted=true;
 const source=revisionAiSnapshot(doc,{scope:'all'}),output=outputFor(doc,source),before=structuredClone(doc),next=applyRevisionAiOutput(freeze(doc),output,source);
 for(const [index,row]of output.paragraphs.entries()){const previous=before.paragraphs[index],paragraph=next.paragraphs[index];assert.equal(paragraph.suggestion,previous.suggestion);assert.equal(paragraph.accepted,previous.accepted);assert.equal(paragraph.reason,previous.reason);assert.deepEqual(paragraph.aiCandidate,{text:row.revised,action:row.action,reason:row.reason,requiresReview:true,factsVerified:false});}
 assert.equal(revisedText(next),revisedText(before));assert.deepEqual(doc,before);
});

test('retained AI candidates also preserve manual edits and their own exact retention reason',()=>{
 const doc=document();doc.paragraphs[1].suggestion+=' 人工候选保留。';doc.paragraphs[1].reason='用户自己的说明';const source=revisionAiSnapshot(doc,{scope:'all'}),output=outputFor(doc,source);output.paragraphs[1]={...output.paragraphs[1],revised:output.paragraphs[1].original,action:'retain',reason:'原文限制已清楚，保留原句供用户对照。'};const next=applyRevisionAiOutput(doc,output,source),paragraph=next.paragraphs[1];assert.equal(paragraph.suggestion,doc.paragraphs[1].suggestion);assert.equal(paragraph.reason,'用户自己的说明');assert.deepEqual(paragraph.aiCandidate,{text:originals[1],action:'retain',reason:output.paragraphs[1].reason,requiresReview:true,factsVerified:false});
});

test('a fresh selected paragraph can update while an edited selected neighbor stores a separate candidate',()=>{
 const doc=document();doc.paragraphs[2].suggestion+=' 用户正在核对的候选。';doc.paragraphs[2].accepted=true;const source=revisionAiSnapshot(doc,{scope:'selected',paragraphIds:['p2','p0']}),output=outputFor(doc,source),next=applyRevisionAiOutput(doc,output,source);
 assert.equal(next.paragraphs[0].suggestion,output.paragraphs[0].revised);assert.equal(next.paragraphs[0].accepted,false);assert.deepEqual(next.paragraphs[1],doc.paragraphs[1]);assert.equal(next.paragraphs[2].suggestion,doc.paragraphs[2].suggestion);assert.equal(next.paragraphs[2].accepted,true);assert.equal(next.paragraphs[2].aiCandidate.text,output.paragraphs[1].revised);
});

test('selected original changes are blocked by exact identity while comments and human candidate state invalidate the legacy-compatible fingerprint',()=>{
 const baseline=document(),source=revisionAiSnapshot(baseline,{scope:'selected',paragraphIds:['p0','p2']}),output=outputFor(baseline,source);
 const changedOriginal=structuredClone(baseline);changedOriginal.paragraphs[2].original+=' 原文已更新。';const beforeOriginal=structuredClone(changedOriginal);assert.throws(()=>applyRevisionAiOutput(freeze(changedOriginal),output,source));assert.deepEqual(changedOriginal,beforeOriginal);
 const changes=[p=>{p.comment='新的导师意见';},p=>{p.suggestion+=' 人工候选有变化。';},p=>{p.reason='人工理由已更新';},p=>{p.accepted=true;},p=>{p.resolved=true;}];
 for(const change of changes){const doc=structuredClone(baseline);change(doc.paragraphs[2]);const before=structuredClone(doc);assert.notEqual(revisionAiSnapshot(doc,{scope:'selected',paragraphIds:['p2','p0']}).context.editFingerprint,source.context.editFingerprint);assert.throws(()=>applyRevisionAiOutput(freeze(doc),output,source));assert.deepEqual(doc,before);}
});

test('changes outside the selected scope do not overwrite or unnecessarily block the selected candidate batch',()=>{
 const doc=document(),source=revisionAiSnapshot(doc,{scope:'selected',paragraphIds:['p0']}),output=outputFor(doc,source);doc.paragraphs[2].suggestion+=' 范围外的手工修改。';doc.paragraphs[2].comment='范围外的新意见';doc.paragraphs[2].accepted=true;const outside=structuredClone(doc.paragraphs[2]);assert.equal(revisionAiSnapshot(doc,{scope:'selected',paragraphIds:['p0']}).context.editFingerprint,source.context.editFingerprint);const next=applyRevisionAiOutput(doc,output,source);assert.equal(next.paragraphs[0].suggestion,output.paragraphs[0].revised);assert.deepEqual(next.paragraphs[2],outside);
});

test('source outer whitespace is trimmed only for AI paragraph identity while manuscript originals remain byte-for-byte intact',()=>{
 const doc=document();doc.paragraphs[0]={...doc.paragraphs[0],original:' \t'+originals[0]+'\n ',suggestion:' \t'+originals[0]+'\n '};const before=structuredClone(doc),source=revisionAiSnapshot(doc,{scope:'all'}),output=outputFor(doc,source);output.paragraphs[0]={...output.paragraphs[0],revised:originals[0],action:'retain',reason:'保留完整原文内容，外围空白仅由请求规范化处理。'};const next=applyRevisionAiOutput(doc,output,source);assert.equal(output.paragraphs[0].original,originals[0]);assert.equal(next.paragraphs[0].original,before.paragraphs[0].original);assert.equal(next.original,before.original);assert.deepEqual(doc,before);assert.equal(next.paragraphs[0].aiAction,'retain');
});
