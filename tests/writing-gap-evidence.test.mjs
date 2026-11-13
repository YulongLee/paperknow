import test from 'node:test';import assert from 'node:assert/strict';import {buildWritingGapEvidenceTask,parseWritingGapEvidence,resolvedVirtualPlatformRequirement,resolvedDeferredScheduleRequirement} from '../backend/writing-gap-evidence.mjs';
const source={id:'m',name:'计划',confirmed:true,text:'平台 A 为模拟，计划招募12名成年学生，研究尚未实施。'},gap={manuscriptQuote:'【待补充参与者】',missing:['平台名称','拟招募人数'],evidence:[{sourceId:'m',quote:source.text}]};
const task=()=>buildWritingGapEvidenceTask([gap],{materials:[source],references:[]});const answer=(items)=>({text:JSON.stringify({checks:[{id:'gap-0',items}]})});const supported=(index,quote=source.text)=>({index,status:'supported',evidence:[{sourceId:'m',quote}]});
test('all missing items require directly authorized quoted evidence',()=>{const t=task();assert.equal(parseWritingGapEvidence(answer([supported(0),supported(1)]),t).allSupported,true);assert.equal(parseWritingGapEvidence(answer([supported(0),{index:1,status:'missing',evidence:[]}]),t).allSupported,false);for(const bad of [[supported(0)],[supported(0),supported(0)],[supported(0),supported(1,'造假数据')],[supported(0),{index:1,status:'supported',evidence:[]}]])assert.throws(()=>parseWritingGapEvidence(answer(bad),t));});
test('missing or unconfirmed evidence never starts a recheck',()=>{assert.equal(buildWritingGapEvidenceTask([{...gap,evidence:[]}],{materials:[source]}),null);assert.equal(buildWritingGapEvidenceTask([gap],{materials:[{...source,confirmed:false}]}),null);assert.equal(buildWritingGapEvidenceTask([{...gap,evidence:[{sourceId:'m',quote:'伪造的原文内容'}]}],{materials:[source]}),null);});
test('recheck instructions preserve planned versus observed boundaries and do not approve final output',()=>{const t=task();assert.match(t.instructions,/不能将拟开展计划、合成案例/);assert.match(t.instructions,/改写后仍需独立复查/);});
test('mixed reviewed facts retain both supported and unresolved requirements',()=>{const t=task(),result=parseWritingGapEvidence(answer([supported(0),{index:1,status:'missing',evidence:[]}]),t);assert.equal(result.allSupported,false);assert.deepEqual(result.checks,[{id:'gap-0',supported:['平台名称'],missing:['拟招募人数']}]);});
test('a final verified explicitly virtual platform does not require a real deployment',()=>{
 const text='研究对象为虚构高校数字阅读平台A，假设版本A-1.0，目前无真实平台或实际访问。',material={id:'v',confirmed:true,text},snapshot={materials:[material]},chapter={text:'研究对象为虚构数字阅读平台A，假设版本A-1.0。'},checked={status:'sufficient',evidence:[{sourceId:'v',quote:text}]},missing='所选数字阅读平台的实际名称与版本';
 assert.equal(resolvedVirtualPlatformRequirement({},missing,checked,chapter,snapshot),true);
 assert.equal(resolvedVirtualPlatformRequirement({},missing,{...checked,status:'missing'},chapter,snapshot),false);
 assert.equal(resolvedVirtualPlatformRequirement({},missing,checked,{text:'研究对象为真实数字阅读平台。'},snapshot),false);
 assert.equal(resolvedVirtualPlatformRequirement({},'真实调查结果与人数',checked,chapter,snapshot),false);
 assert.equal(resolvedVirtualPlatformRequirement({},missing,checked,chapter,{materials:[{...material,confirmed:false}]}),false);
 assert.equal(resolvedVirtualPlatformRequirement({},missing,{...checked,evidence:[{sourceId:'v',quote:'捏造的虚构平台'}]},chapter,snapshot),false);
 assert.equal(resolvedVirtualPlatformRequirement({},missing,checked,chapter,{materials:[{...material,text:'研究对象为真实平台，预期未来做模拟。'}]}),false);
 const altered=(c,e=text)=>resolvedVirtualPlatformRequirement({},missing,{status:'sufficient',evidence:[{sourceId:'v',quote:e}]},{text:c},{materials:[{id:'v',confirmed:true,text:e}]});
 assert.equal(altered('研究对象为虚构平台B，假设版本A-1.0。'),false,'different platform');
 assert.equal(altered('研究对象为虚构平台A，假设版本A-2.0。'),false,'different version');
 assert.equal(altered('研究对象为虚构平台A。'),false,'missing version');
 assert.equal(altered('研究对象为虚构平台A，假设版本A-1.0和B-2.0。'),false,'ambiguous version');
 assert.equal(altered(chapter.text,'研究对象为虚构平台A，目前无真实平台。'),false,'no cited version');
 const split={materials:[{id:'v',confirmed:true,text:'研究对象为虚构平台A，目前无真实平台。'},{id:'v2',confirmed:true,text:'研究对象假设版本A-1.0。'}]};
 assert.equal(resolvedVirtualPlatformRequirement({},missing,{status:'sufficient',evidence:[{sourceId:'v',quote:split.materials[0].text},{sourceId:'v2',quote:split.materials[1].text}]},chapter,split),false,'cannot join identity across separate sources');
});
test('source excerpts retain nearby and early qualifiers before the independent review',()=>{
 const long='该研究尚未实施。不得将计划当成真实结果。'+'背景介绍'.repeat(650)+'计划招募12名成年学生。'+'后续还需完成调查。';const quote='计划招募12名成年学生。',t=buildWritingGapEvidenceTask([{...gap,evidence:[{sourceId:'m',quote}]}],{materials:[{...source,text:long}]});assert.ok(t.context.checks[0].evidence.some(p=>p.quote.includes('尚未实施')));assert.ok(t.context.checks[0].evidence.some(p=>p.quote.includes(quote)));
});

test('a deferred schedule is resolved only with verified authorization and no invented dates',()=>{
 const gap={},missing='时间节点的确定依据（材料称由导师后续确认，尚未提供）',quote='计划分阶段推进，具体自然日期由导师后续确认。',snapshot={materials:[{id:'m',confirmed:true,text:quote}]},final={status:'sufficient',evidence:[{sourceId:'m',quote}]},chapter={text:'本研究按四阶段推进，时间节点待定。'};
 const check=(f=final,c=chapter,s=snapshot,chapters=[c],m=missing)=>resolvedDeferredScheduleRequirement(gap,m,f,c,s,chapters);
 assert.equal(check(),true);assert.equal(check({...final,status:'missing'}),false);assert.equal(check(final,chapter,{materials:[{id:'m',confirmed:false,text:quote}]}),false);
 assert.equal(check({...final,evidence:[{sourceId:'m',quote:'伪造日期由导师后续确认。'}]}),false);
 assert.equal(check(final,{text:'研究计划于2027年6月完成，时间节点待定。'}),false);
 assert.equal(check(final,chapter,snapshot,[chapter,{text:'研究将于三月开始。'}]),false);
 assert.equal(check(final,chapter,snapshot,[chapter],'实验结果的数据和人数待导师确认'),false);
});

