import test from 'node:test';
import assert from 'node:assert/strict';
import {assertExpressionRepairUnchanged,normalizeExpressionPatch,canSafeExpressionEdit,safeExpressionReplacement} from '../backend/thesis-expression-repair.mjs';
import {completionRepairs} from '../backend/thesis-completion-repair.mjs';
import {normalizeThesisSnapshot,thesisAgentTask,validateThesisCandidate,parseThesisSection} from '../backend/thesis-model.mjs';
import {aliasThesisRevision,restoreThesisObjects} from '../backend/thesis-object-alias.mjs';
import {researchWordCount} from '../backend/text-length.mjs';
import {completionPanelHTML,createCompletionDraft} from '../dist/workspace/thesis-completion-panel.mjs';
import {completionReviewPanel} from '../dist/workspace/thesis-completion-review.mjs';
const source='合成测试资料，记录了限定场景下的研究方法，不代表真实实验。'.repeat(10);
const value=()=>normalizeThesisSnapshot({title:'合成研究',profile:{level:'本科',language:'中文',targetWords:500},requirements:{deliveryVersion:1},materials:[{id:'m',name:'已知研究资料',text:source,confirmed:true}],references:[],outline:[{id:'c',title:'方法与分析',targetWords:500}]});
test('thesis expression repair removes only a duplicate full stop while preserving the citation and numbers',()=>{
 const quote='观察结果为 12 人。[source:m]。后续安排待确认。',text='研究说明：'+quote,checkpoint={text,figures:'[]',source_ids:'["m"]',missing_evidence:'[]',trace:'[]'};
 const fixed='观察结果为 12 人。[source:m]后续安排待确认。';
 assert.equal(canSafeExpressionEdit(text,quote),true);assert.equal(safeExpressionReplacement(quote),fixed);
 const candidate={text:JSON.stringify({complete:true,edits:[{old:quote,new:fixed}]}),trace:[]};
 const result=JSON.parse(normalizeExpressionPatch(candidate,checkpoint,[{quote}]).text);assert.equal(result.text,'研究说明：'+fixed);assert.deepEqual(result.source_ids,['m']);
 for(const next of [fixed.replace('12','13'),fixed.replace('[source:m]','[source:n]'),fixed.replace('观察结果','已经完成')])assert.throws(()=>normalizeExpressionPatch({text:JSON.stringify({complete:true,edits:[{old:quote,new:next}]})},checkpoint,[{quote}]));
 for(const unsafe of ['`'+quote+'`','“'+quote+'”','| '+quote+' |','$$'+quote+'$$'])assert.equal(canSafeExpressionEdit(unsafe,quote),false);
 assert.equal(canSafeExpressionEdit(quote+'\n'+quote,quote),false);
});
test('thesis final review schedules a uniquely located citation punctuation correction',()=>{
 const snapshot=value(),quote='本研究仅描述十二个计划任务。[source:m]。结果尚未取得。',unit={id:'u',chapterId:'c',chapterTitle:'方法与分析',title:'方法与分析',targetWords:500,part:1,parts:1,presentation:{},completion:{scope:'full'}},checkpoint={unit_id:'u',text:quote,trace:'[]',figures:'[]'},quality={consistency:{findings:[{sectionId:'c',category:'language_expression',reasonCode:'repeated_sentence_stop',quote}]}};
 const repairs=completionRepairs(snapshot,[unit],[checkpoint],quality,0);assert.equal(repairs.length,1);assert.equal(repairs[0].expressionOnly,true);assert.equal(repairs[0].task.context.revision.findings[0].quote,quote);
});
test('expression repair changes prose while preserving data, citations, math, code, tables and unresolved facts',()=>{
 const text='显而易见，本节讨论 60 条记录和 92.5% 的模拟比例。[source:m]\n【待补充：真实部署记录】\n$$x=1+2$$\n```python\nx=3\n```\n|组别|数量|\n|A|60|',checkpoint={text,figures:'[]'},fixed=text.replace('显而易见，本节讨论','本节仅分析');assert.doesNotThrow(()=>assertExpressionRepairUnchanged(checkpoint,{text:fixed,figures:[]}));
 for(const candidate of [text,fixed.replace('60','80'),fixed.replace('[source:m]','[source:other]'),fixed.replace('【待补充：真实部署记录】',''),fixed.replace('x=1+2','x=2+1'),fixed.replace('x=3','x=4'),fixed.replace('|A|60|','|B|60|')])assert.throws(()=>assertExpressionRepairUnchanged(checkpoint,{text:candidate,figures:[]}));
});
test('an incomplete materials check still allows grounded expression fixes without permitting missing-fact completion',()=>{
 const snapshot=value(),unit={id:'u',chapterId:'c',chapterTitle:'方法与分析',title:'方法与分析',targetWords:500,part:1,parts:1,presentation:{},completion:{scope:'full'}},text='显而易见，现有资料限定了本节的分析范围。【待补充：真实部署记录】',checkpoint={unit_id:'u',text,trace:'[]',figures:'[]'},quality={consistency:{findings:[{sectionId:'c',quote:'显而易见，现有资料限定了本节的分析范围。',category:'language_expression',severity:'info'},{sectionId:'c',quote:'【待补充：真实部署记录】',category:'unresolved_placeholder'}]},completionAudit:{issues:[{code:'unresolved_placeholders'}]},supplementCheck:{status:'unavailable',coverage:{complete:false}}};
 const repairs=completionRepairs(snapshot,[unit],[checkpoint],quality,0,{expressionOnly:true});assert.equal(repairs.length,1);assert.equal(repairs[0].expressionOnly,true);assert.deepEqual(repairs[0].task.context.revision.findings.map(row=>row.category),['language_expression']);assert.match(repairs[0].task.instructions,/直接将修正写入完整正文/);assert.match(repairs[0].task.instructions,/不补造资料/);
});
test('automatic writing receives the actual missing items instead of just a generic simulation request',()=>{
 const snapshot=value(),unit={id:'u',chapterId:'c',chapterTitle:'方法与分析',title:'方法与分析',targetWords:500,part:1,parts:1,presentation:{},completion:{scope:'full',originalText:'方法依据与分析说明尚待完善。',missingInformation:['本节的文献依据','已有模拟结果的分析说明']}};
 const task=thesisAgentTask(snapshot,unit,[]);assert.deepEqual(task.context.revision.missingInformation,unit.completion.missingInformation);assert.match(task.instructions,/逐项处理/);assert.match(task.instructions,/直接写入正文/);assert.match(task.instructions,/身份、真实实施记录及实测结果没有依据时，不得编造/);
});
test('expression editing cannot replace the whole checkpoint using a truncated long input',()=>{
 const snapshot=value(),text='Synthetic technical discussion. '.repeat(600)+'This ending must remain available for expression correction.',unit={id:'u',chapterId:'c',sectionId:'s',chapterTitle:'方法与分析',title:'方法与分析',targetWords:1800,part:1,parts:1,presentation:{},completion:{scope:'full'}},checkpoint={unit_id:'u',text,trace:'[]',figures:'[]'},quality={reviews:[{findings:[{sectionId:'c',category:'language_expression',quote:'This ending must remain available for expression correction.'}]}]};assert.deepEqual(completionRepairs(snapshot,[unit],[checkpoint],quality,0,{expressionOnly:true}),[]);assert.match(checkpoint.text,/ending must remain/);
});
test('completion UI makes gap filling primary and keeps numeric simulation as a distinct secondary function',()=>{
 const snapshot=value(),item={snapshot,profile:snapshot.profile,chapters:[{id:'c',title:'方法与分析',text:'已有论述。【待补充：文献依据】'}]},markup=completionPanelHTML(item,createCompletionDraft());assert.match(markup,/AI自动补充缺失内容/);assert.match(markup,/AI自动补充并检查/);assert.match(markup,/仿真研究数据/);assert.match(markup,/生成仿真数据/);assert.doesNotMatch(markup,/AI模拟数据补充/);assert.equal((markup.match(/data-completion-prepare/g)||[]).length,1);
});
test('legacy expression advice cannot be displayed as a completed correction or approved final result',()=>{
 const markup=completionReviewPanel({status:'ready',changes:[],suggestions:[{title:'方法与分析',text:'需要直接修正的原句'}],checks:{materials:true,manuscript:true,content:true}});assert.doesNotMatch(markup,/表达建议（供确认时参考）|data-completion-confirm(?:\s|>)/);assert.match(markup,/待确认的表达问题/);
});

test('full completion allows bounded expansion around an existing segment without weakening its upper limit',()=>{
 const snapshot=value(),unit={id:'unit',chapterId:'c',sectionId:'s',chapterTitle:'方法与分析',title:'方法与分析',targetWords:809,part:1,parts:1,presentation:{},completion:{scope:'full',baselineTargetWords:809,originalText:'已核对的方法说明。',originalObjects:[],missingInformation:[]}},task=thesisAgentTask(snapshot,unit,[]);
 assert.equal(task.context.lengthBudget.target,809);assert.equal(task.context.lengthBudget.max,991);assert.match(task.instructions,/允许范围 647～991/);assert.match(task.instructions,/不重复叙述或为达到字数而扩写/);
 const candidate=count=>({text:JSON.stringify({text:'研'.repeat(count)+'[source:m]',source_ids:['m'],missing_evidence:[],complete:true,draft:false}),trace:[{tool:'read_material',status:'completed',materialId:'m'}]});
 assert.equal(validateThesisCandidate(candidate(950),snapshot,unit).valid,true);
 const rejected=validateThesisCandidate(candidate(992),snapshot,unit);assert.equal(rejected.valid,false);assert.equal(rejected.feedback.code,'word_limit_exceeded');assert.match(rejected.feedback.rule,/不要逐字微调/);
});

test('unstructured simulation scope cannot force deletion of a measurement marker',()=>{
 const snapshot=value();snapshot.materials[0].text='仿真研究：配对数量由模型假设计算，不代表实际 FLOPs、时间或显存。';
 const marker='【待补充：具体实现的实际FLOPs、运行时间与显存占用等真实测量数据】',unit={id:'u',chapterId:'c',chapterTitle:'方法与分析',title:'方法与分析',targetWords:500,part:1,parts:1,presentation:{},completion:{scope:'full',originalText:'模型仅讨论组合计数。',originalObjects:[]}},build=text=>({text:JSON.stringify({text,source_ids:['m'],missing_evidence:['真实测量数据'],complete:true,draft:true}),trace:[{tool:'read_material',status:'completed',materialId:'m'}]});
 const added='模型仅讨论组合计数。具体实现的实际资源开销缺少可核对的真实测量记录'+marker+'。'+'研究'.repeat(250)+'[source:m]';
 const check=validateThesisCandidate(build(added),snapshot,unit);assert.notEqual(check.feedback?.code,'scope_expansion');
 const later='实测层面的 FLOPs、时间与显存数据不在本研究范围内，相应资源测量属于后续工作【待补充：若需真实性能对比，须提供实际运行的FLOPs、时间与显存测量记录】。'+'研究'.repeat(250)+'[source:m]';assert.notEqual(validateThesisCandidate(build(later),snapshot,unit).feedback?.code,'scope_expansion');
 const original={...unit,completion:{...unit.completion,originalText:marker}};assert.notEqual(validateThesisCandidate(build(added),snapshot,original).feedback?.code,'scope_expansion');
 const unscoped=value();assert.notEqual(validateThesisCandidate(build(added),unscoped,unit).feedback?.code,'scope_expansion');
 const asserted='实际显存为 500 MB'+marker+'。'+'研究'.repeat(250)+'[source:m]';assert.notEqual(validateThesisCandidate(build(asserted),snapshot,unit).feedback?.code,'scope_expansion');
 for(const text of ['仿真结果不涉及实际 FLOPs、耗时与显存。','教学模拟将实际 FLOPs、运行时间和显存排除在本研究范围。','本次仿真不包括真实 FLOPs、运行时间和显存。']){const scoped=value();scoped.materials[0].text=text;assert.notEqual(validateThesisCandidate(build(added),scoped,unit).feedback?.code,'scope_expansion',text);}
 const partial=value();partial.materials[0].text='仿真不涉及实际 FLOPs，其他指标暂未说明。';assert.notEqual(validateThesisCandidate(build(added),partial,unit).feedback?.code,'scope_expansion');
});


test('completion rejects new numbered subsection headings that duplicate an adjacent segment',()=>{
 const snapshot=value(),unit={id:'u',chapterId:'c',chapterTitle:'方法与分析',title:'方法与分析',targetWords:100,part:1,parts:1,presentation:{},completion:{scope:'full',originalText:'## 3.2 模型推导\n\n已有原稿',originalObjects:[]}},text='## 3.2 模型推导\n\n已有原稿。\n\n## 3.3 模型边界\n\n'+'研究'.repeat(70)+'[source:m]',result=validateThesisCandidate({text:JSON.stringify({text,source_ids:['m'],missing_evidence:[],complete:true}),trace:[{tool:'read_material',status:'completed',materialId:'m'}]},snapshot,unit);assert.equal(result.valid,false);assert.equal(result.feedback.code,'completion_heading_mismatch');
});
test('overlength feedback measures restored locked text, not the short placeholder',()=>{
 const snapshot=value(),id='obj-0123456789abcdef12345678',original='原稿公式如下 [docx:'+id+']，后文保持完整。',unit={id:'u',chapterId:'c',chapterTitle:'方法与分析',title:'方法与分析',targetWords:40,part:1,parts:1,presentation:{},completion:{scope:'full',originalText:original,originalObjects:[{id}]}},revision=aliasThesisRevision({originalExcerpt:original},unit),text=revision.originalExcerpt+'\n\n'+'研究'.repeat(100)+'[source:m]',result=validateThesisCandidate({text:JSON.stringify({text,source_ids:['m'],missing_evidence:[],complete:true}),trace:[{tool:'read_material',status:'completed',materialId:'m'}]},snapshot,unit);
 assert.equal(result.valid,false);assert.equal(result.feedback.code,'word_limit_exceeded');assert.equal(result.feedback.count,researchWordCount(restoreThesisObjects(text,unit),'中文'));assert.ok(result.feedback.count>researchWordCount(text,'中文'));
});

test('unstructured scope cannot suppress a possibly needed classroom evidence marker',()=>{
 const snapshot=value();snapshot.materials[0].text='仿真研究：无用户或受试者，不是实测研究。';const marker='【待补充：课堂观察或学习效果记录】';const unit={id:'u',chapterId:'c',chapterTitle:'方法与分析',title:'方法与分析',targetWords:100,part:1,parts:1,presentation:{},completion:{scope:'full',originalText:'教学案例只讨论理论模型。',originalObjects:[]}},build=text=>({text:JSON.stringify({text:text+'研究'.repeat(60)+'[source:m]',source_ids:['m'],missing_evidence:['记录'],complete:true,draft:true}),trace:[{tool:'read_material',status:'completed',materialId:'m'}]});
 const candidate='本案例可用于演示，但课堂实施效果尚未观察'+marker;assert.notEqual(validateThesisCandidate(build(candidate),snapshot,unit).feedback?.code,'scope_expansion');
 assert.notEqual(validateThesisCandidate(build(candidate),snapshot,{...unit,completion:{...unit.completion,originalText:marker}}).feedback?.code,'scope_expansion');
 assert.notEqual(validateThesisCandidate(build('本研究开展了课堂实施。'+marker),snapshot,unit).feedback?.code,'scope_expansion');
 assert.notEqual(validateThesisCandidate(build(candidate),value(),unit).feedback?.code,'scope_expansion');
});

test('nonperiodic local-window count cannot assert full width at sequence boundaries',()=>{
 const snapshot=value(),unit={id:'u',chapterId:'c',chapterTitle:'方法与分析',title:'方法与分析',targetWords:100,part:1,parts:1,presentation:{},completion:{scope:'full',originalText:'原稿使用完全配对计数。',originalObjects:[]}},formula='C_local(n,r)=n·min(n,2r+1)',build=text=>({text:JSON.stringify({text:text+'研究'.repeat(60)+'[source:m]',source_ids:['m'],missing_evidence:[],complete:true,draft:false}),trace:[{tool:'read_material',status:'completed',materialId:'m'}]});
 const check=validateThesisCandidate(build('每个位置仅与相对偏移不超过r的位置配对。'+formula),snapshot,unit);assert.equal(check.feedback.code,'unsupported_window_formula');assert.match(check.feedback.rule,/n=8、r=3.*44.*56/);
 assert.notEqual(validateThesisCandidate(build('周期边界情况下：'+formula),snapshot,unit).feedback?.code,'unsupported_window_formula');
 assert.notEqual(validateThesisCandidate(build(formula),snapshot,{...unit,completion:{...unit.completion,originalText:formula}}).feedback?.code,'unsupported_window_formula');
 assert.notEqual(validateThesisCandidate(build('普通窗口的配对数为 n(2r+1)-r(r+1)，其中 0≤r<n。'),snapshot,unit).feedback?.code,'unsupported_window_formula');
});


test('localized expression edits are unique, within the finding and preserve protected facts',()=>{
 const old='显而易见，本节讨论理论方法。',checkpoint={text:old+'\n样本60例。 [source:m] $$x=1+2$$ 【待补充：资料】',source_ids:JSON.stringify(['m']),missing_evidence:JSON.stringify(['资料']),figures:'[]',trace:JSON.stringify([{tool:'read_material',status:'completed',materialId:'m'}])},findings=[{quote:old}],patch=(a,b)=>({text:JSON.stringify({complete:true,edits:[{old:a,new:b}]}),trace:[]});
 const result=normalizeExpressionPatch(patch(old,'本节讨论理论方法。'),checkpoint,findings),body=JSON.parse(result.text);assert.match(body.text,/本节讨论理论方法。\n样本60例/);assert.equal(result.trace[0].materialId,'m');assert.doesNotThrow(()=>assertExpressionRepairUnchanged(checkpoint,{text:body.text,figures:[]}));
 assert.throws(()=>normalizeExpressionPatch(patch(old,'本节讨论理论方法，样本为70例。'),checkpoint,findings));assert.throws(()=>normalizeExpressionPatch(patch('样本60例。','样本70例。'),checkpoint,findings));assert.throws(()=>normalizeExpressionPatch(patch(old,'本节讨论理论方法。'),{...checkpoint,text:checkpoint.text+' '+old},findings));assert.throws(()=>normalizeExpressionPatch(patch('[docx:obj-123456]','公式'),{...checkpoint,text:'[docx:obj-123456]'},[{quote:'[docx:obj-123456]'}]));
});


test('localized expression repair cannot reverse claims or accept a full-document rewrite',()=>{
 const old='模型并未改善识别效果。',checkpoint={text:old+'其他内容需要保持原样。',source_ids:'[]',missing_evidence:'[]',figures:'[]',trace:'[]'},findings=[{quote:old}];assert.throws(()=>normalizeExpressionPatch({text:JSON.stringify({complete:true,edits:[{old:'模型并未改善识别效果',new:'模型显著改善识别效果'}]})},checkpoint,findings));assert.throws(()=>normalizeExpressionPatch({text:JSON.stringify({complete:true,text:'模型显著改善识别效果。其他内容被完全改写。'})},checkpoint,findings));
});

test('localized expression repairs reject quotations, overlapping anchors and fenced rewrites',()=>{
 const patch=edits=>({text:JSON.stringify({complete:true,edits}),trace:[]}),base={source_ids:'[]',missing_evidence:'[]',figures:'[]',trace:'[]'},q='显而易见，方法有效';
 assert.throws(()=>normalizeExpressionPatch(patch([{old:q,new:'方法有效'}]),{...base,text:'作者指出：“'+q+'。”[source:paper1]'},[{quote:q}]));
 const old='显而易见，显而易见，',t='显而易见，显而易见，显而易见，研究表明无差异。';
 assert.throws(()=>normalizeExpressionPatch(patch([{old,new:'显而易见，'}]),{...base,text:t},[{quote:old}]));
 const a='显而易见，众所周知，研究结果可信。',b='众所周知，研究结果可信。';
 assert.throws(()=>normalizeExpressionPatch(patch([{old:a,new:b},{old:b,new:'研究结果可信。'}]),{...base,text:a},[{quote:a}]));
 assert.throws(()=>normalizeExpressionPatch({text:'```json\n{"text":"不安全全文"}\n```'},base,[{quote:q}]));
});

test('completion status does not claim unsaved updates and displays released entitlement',()=>{
 const html=completionReviewPanel({status:'check_required',reasonCode:'check_unavailable',billingStatus:'released',changes:[],missing:[],issues:[],checks:{materials:false,manuscript:false,content:false}});assert.match(html,/当前正文和资料已保留/);assert.doesNotMatch(html,/补充后的内容已写入正文/);assert.match(html,/未扣积分或套餐次数/);
});

test('a 585-character original with 350-character outline target can fit a 649-character repair without resetting its long-term anchor',()=>{
 const snapshot=value(),unit={id:'u',chapterId:'c',sectionId:'s',chapterTitle:'方法',title:'方法',targetWords:585,part:1,parts:1,presentation:{},completion:{scope:'full',baselineTargetWords:350,anchorWords:585,originalText:'研'.repeat(585),missingInformation:[]}},task=thesisAgentTask(snapshot,unit,[]);assert.equal(task.context.lengthBudget.suggestedMax,702);assert.equal(task.context.lengthBudget.max,790);
 const result=count=>({text:JSON.stringify({text:'研'.repeat(count)+'[source:m]',source_ids:['m'],missing_evidence:[],complete:true,draft:false}),trace:[{tool:'read_material',status:'completed',materialId:'m'}]});assert.equal(validateThesisCandidate(result(649),snapshot,unit).valid,true);assert.equal(validateThesisCandidate(result(791),snapshot,unit).feedback.code,'word_limit_exceeded');
 const next={...unit,targetWords:649,completion:{...unit.completion,originalText:'研'.repeat(649)}};assert.equal(thesisAgentTask(snapshot,next,[]).context.lengthBudget.max,790);
});

test('elastic repair allowance stays tied to the original baseline for short, medium and long sections',()=>{
 const s=value();for(const [base,anchor,candidate] of [[285,450,528],[350,585,649],[546,881,1015],[900,1500,1790]]){const unit={id:'u',chapterId:'c',chapterTitle:'方法',title:'方法',targetWords:anchor,part:1,parts:1,presentation:{},completion:{scope:'full',baselineTargetWords:base,anchorWords:anchor,originalText:'研'.repeat(anchor)}},first=thesisAgentTask(s,unit,[]).context.lengthBudget.max;assert.ok(first>=candidate);assert.ok(first<=anchor+500);const next={...unit,targetWords:first,completion:{...unit.completion,originalText:'研'.repeat(first)}};assert.equal(thesisAgentTask(s,next,[]).context.lengthBudget.max,first);}
});

test('a short completed section cannot gain another 20 characters on each retry',()=>{
 const s=value(),base={id:'u',chapterId:'c',chapterTitle:'方法',title:'方法',targetWords:60,part:1,parts:1,presentation:{},completion:{scope:'full',baselineTargetWords:20,anchorWords:60,originalText:'研'.repeat(60)}};let unit=base;const fixed=thesisAgentTask(s,unit,[]).context.lengthBudget.max;assert.equal(fixed,140);
 for(let i=0;i<5;i++){unit={...unit,targetWords:fixed,completion:{...unit.completion,originalText:'研'.repeat(fixed)}};assert.equal(thesisAgentTask(s,unit,[]).context.lengthBudget.max,fixed);}
});

test('small overage above recommendation is accepted within a fixed long-term hard ceiling',()=>{
 const s=value(),unit={id:'u',chapterId:'c',chapterTitle:'方法',title:'方法',targetWords:663,part:1,parts:1,presentation:{},completion:{scope:'full',baselineTargetWords:350,anchorWords:595,originalText:'研'.repeat(663)}},task=thesisAgentTask(s,unit,[]);assert.equal(task.context.lengthBudget.suggestedMax,714);assert.equal(task.context.lengthBudget.max,804);assert.match(task.instructions,/超过建议但未超安全上限不需反复压缩/);
 const result=count=>({text:JSON.stringify({text:'研'.repeat(count)+'[source:m]',source_ids:['m'],missing_evidence:[],complete:true,draft:false}),trace:[{tool:'read_material',status:'completed',materialId:'m'}]});assert.equal(validateThesisCandidate(result(720),s,unit).valid,true);assert.equal(validateThesisCandidate(result(805),s,unit).feedback.code,'word_limit_exceeded');const next={...unit,targetWords:804,completion:{...unit.completion,originalText:'研'.repeat(804)}};assert.equal(thesisAgentTask(s,next,[]).context.lengthBudget.max,804);
});

test('completion respects the source rounding convention and never guesses unprovided figures',()=>{const snapshot=value(),unit={id:'u',chapterId:'c',chapterTitle:'方法',title:'方法',targetWords:400,part:1,parts:1,presentation:{},completion:{scope:'full',baselineTargetWords:400,anchorWords:400,originalText:'已有结果需要根据原始记录核对。'.repeat(20)}};const task=thesisAgentTask(snapshot,unit,[]);assert.match(task.instructions,/先相减再舍入/);assert.match(task.instructions,/先舍入再相减/);assert.match(task.instructions,/不得猜测、拼接不同实验/);});

test('preflight source hints reach completion only within the actually authorized readable range',()=>{
 const snapshot=value();snapshot.materials[0].text='文献第3.2.1节说明缩放点积注意力。'+('其他正文。'.repeat(20));snapshot.materials.push({id:'private',name:'未确认资料',text:'不能泄露的敏感正文。',confirmed:false});
 const unit={id:'u',chapterId:'c',chapterTitle:'方法',title:'方法',targetWords:400,part:1,parts:1,sourceIds:[],completionSourceIds:['m','private'],presentation:{},completion:{scope:'full',originalText:'原稿保留来源与待核对标记。[source:m]【待核对：公式位置】',missingInformation:['核对公式位置'],assessment:{status:'checked',items:[{status:'missing',requirement:'核对位置',missing:['核对公式位置'],evidence:[{sourceId:'m',quote:'文献第3.2.1节说明缩放点积注意力。'},{sourceId:'m',quote:'原文不存在的摘录'},{sourceId:'private',quote:'不能泄露的敏感正文。'}]}]}}};
 const task=thesisAgentTask(snapshot,unit,[]);assert.deepEqual(task.context.revision.assessment.items[0].evidence,[{sourceId:'m',quote:'文献第3.2.1节说明缩放点积注意力。'}]);assert.ok(!task.materials.some(row=>row.id==='private'));assert.match(task.instructions,/只是定位线索，必须实际调用 read_material/);assert.match(task.instructions,/不因短摘录存在就认定已核验全文/);assert.match(task.instructions,/不同精度的数值须按同一原始数据核算/);
 const long=structuredClone(snapshot);long.materials[0].text='甲'.repeat(44000)+'范围外的目标材料。';long.materials.push({id:'m2',name:'另一份已确认资料',text:'乙'.repeat(45000),confirmed:true});const clipped={...unit,completionSourceIds:['m','m2'],completion:{...unit.completion,assessment:{status:'checked',items:[{status:'missing',evidence:[{sourceId:'m',quote:'范围外的目标材料。'}]}]}}};const bounded=thesisAgentTask(long,clipped,[]);assert.ok(!bounded.materials.find(row=>row.id==='m').text.includes('范围外的目标材料。'));assert.equal(bounded.context.revision.assessment.items[0].evidence,undefined);
});

test('a teaching example is prompted not to invent scope while preserving a possible real-performance marker',()=>{
 const snapshot=value();snapshot.materials[0].text='测试范围：二维人工设定算例，不代表实测用户数据、模型训练或论文质量。本算例不声称准确率或真实用户效果。';
 const marker='【待补充：实测评估依据】',unit={id:'u',chapterId:'c',chapterTitle:'结果',title:'结果',targetWords:500,part:1,parts:1,presentation:{},completion:{scope:'full',originalText:'本文仅讨论教学算例。',originalObjects:[]}},build=text=>({text:JSON.stringify({text:text+'研究'.repeat(220)+'[source:m]',source_ids:['m'],missing_evidence:['实测评估'],complete:true,draft:true}),trace:[{tool:'read_material',status:'completed',materialId:'m'}]}),candidate='上述算例不涉及真实系统性能测试，不能据以评价模型性能'+marker+'。';
 assert.equal(validateThesisCandidate(build(candidate),snapshot,unit).valid,true);assert.ok(parseThesisSection(build(candidate),snapshot,unit).text.includes(marker));assert.match(thesisAgentTask(snapshot,unit,[]).instructions,/不应凭空新增范围外的实测要求/);
 assert.notEqual(validateThesisCandidate(build(candidate),snapshot,{...unit,completion:{...unit.completion,originalText:marker}}).feedback?.code,'scope_expansion');
 assert.notEqual(validateThesisCandidate(build('实验测试准确率达到99%'+marker),snapshot,unit).feedback?.code,'scope_expansion');assert.notEqual(validateThesisCandidate(build(marker+'研究'.repeat(500)+'本系统实测准确率达到99%。'),snapshot,unit).feedback?.code,'scope_expansion');assert.notEqual(validateThesisCandidate(build(candidate),snapshot,{...unit,completion:{...unit.completion,originalText:'本系统实测准确率达到99%。'}}).feedback?.code,'scope_expansion');
 const uncertain=value();assert.notEqual(validateThesisCandidate(build(candidate),uncertain,unit).feedback?.code,'scope_expansion');
 const conflicting=structuredClone(snapshot);conflicting.materials[0].text+='另一个模型准确率达到98%。';assert.notEqual(validateThesisCandidate(build(candidate),conflicting,unit).feedback?.code,'scope_expansion');
 const required=structuredClone(snapshot);required.requirements.instructions='必须提供实测性能测试。';assert.notEqual(validateThesisCandidate(build(candidate),required,unit).feedback?.code,'scope_expansion');const profileRequirement=structuredClone(snapshot);profileRequirement.profile.method='必须进行实测性能测试';assert.notEqual(validateThesisCandidate(build(candidate),profileRequirement,unit).feedback?.code,'scope_expansion');
});
test('acknowledgement instructions avoid invented advisors without suppressing a potentially needed marker',()=>{
 const snapshot=value(),marker='【待补充：若存在实际提供指导、资料或意见的人员，请补充其姓名与具体帮助。】',unit={id:'a',chapterId:'a',chapterTitle:'致谢',title:'致谢',targetWords:200,part:1,parts:1,personalMatter:true,completion:{scope:'full',originalText:'感谢公开论文作者。',acknowledgementFacts:'感谢公开论文作者；不涉及特定导师、机构资助或项目支持。'}},build=text=>({text:JSON.stringify({text,source_ids:[],missing_evidence:['指导人员'],complete:true,draft:true}),trace:[]});assert.notEqual(validateThesisCandidate(build('感谢公开论文作者。'+marker),snapshot,unit).feedback?.code,'scope_expansion');assert.match(thesisAgentTask(snapshot,unit,[]).instructions,/不新增“若存在”假设性必填项/);assert.notEqual(validateThesisCandidate(build('感谢公开论文作者。'+marker),snapshot,{...unit,completion:{...unit.completion,originalText:marker}}).feedback?.code,'scope_expansion');assert.notEqual(validateThesisCandidate(build('感谢公开论文作者。'+marker),snapshot,{...unit,completion:{...unit.completion,acknowledgementFacts:'感谢张老师提供指导。'}}).feedback?.code,'scope_expansion');assert.notEqual(validateThesisCandidate(build('感谢我的导师提供指导。'+marker),snapshot,unit).feedback?.code,'scope_expansion');assert.notEqual(validateThesisCandidate(build('感谢公开论文作者。'+marker),snapshot,{...unit,completion:{...unit.completion,originalText:'感谢我的导师提供指导。'}}).feedback?.code,'scope_expansion');
});
