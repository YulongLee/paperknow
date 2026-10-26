import test from 'node:test';
import assert from 'node:assert/strict';
import {academicExpressionFindings} from '../backend/academic-expression.mjs';
import {auditWritingConsistency,writingReviewTask,parseWritingReview} from '../backend/writing-quality.mjs';
import {loadAgentSkillComposition,writingSkillIdsForTask} from '../backend/skills/index.mjs';
const section=text=>({id:'methods',title:'研究方法',text});
const hints=text=>[...academicExpressionFindings([section(text)])];

test('repeated transitions produce a located informational hint and never rewrite factual content',()=>{
 const text='此外，ResNet-18 在示例集上的准确率为 94.2%。\n\n此外，样本量为 120，p=0.032。[source:r]\n\n此外，外部验证尚未完成。',chapters=[section(text)],before=structuredClone(chapters);
 const result=auditWritingConsistency({chapters,references:[{id:'r',confirmed:true}]});
 assert.equal(result.findings.length,1);const finding=result.findings[0];assert.equal(finding.category,'language_expression');assert.equal(finding.severity,'info');assert.match(finding.explanation,/3 段/);assert.equal(text.slice(finding.offset,finding.offset+finding.quote.length),finding.quote);assert.ok(finding.quote.includes('120，p=0.032。[source:r]'));assert.deepEqual(chapters,before);
 assert.equal(hints('此外，方法处理输入。\n\n此外，实验仍有局限。').length,0);
});

test('English repetitions and unsupported certainty are hints rather than AI-origin verdicts',()=>{
 const english='Moreover, the method uses CNN features.\n\nMOREOVER, the split remains 8:2.\n\nMoreover, the comparison needs external validation.';
 assert.equal(hints(english).length,1);const text='显而易见，该模型在所给范围内有效。';assert.equal(hints(text).length,1);
 assert.equal(hints('It is obvious that the claim needs evidence.').length,1);
 assert.doesNotMatch(JSON.stringify(hints(english)),/AI率|检测分数|人工写作|人工智能生成|AI生成/);
});

test('quoted text, code, formulas, table rows, blockquotes and headings are excluded with offsets intact',()=>{
 const protectedText=['```python\n此外，模型标签与原代码一致。\n显而易见，字符串只是数据。\n```','~~~\n此外，示例代码。\n~~~','$$\n此外，公式说明。\n$$','\\[\n此外，数学内容。\n\\]','“此外，受访者的原话不得改写。”','「此外，引用原文。」','"Moreover, a verbatim quotation."','| 此外，表格标签 | 120 |','> 此外，直接引用的段落。','# 此外，标题文本','【待补充：此外，外部验证记录】'].join('\n\n');
 assert.equal(hints(protectedText).length,0);
 const text=protectedText+'\n\n此外，🧪 示例段落一。\n\n此外，示例段落二。\n\n此外，示例段落三。';const result=hints(text);assert.equal(result.length,1);assert.match(result[0].explanation,/3 段/);assert.equal(result[0].offset,text.indexOf('此外，示例段落二。'));assert.equal(text.slice(result[0].offset,result[0].offset+result[0].quote.length),result[0].quote);
});

test('technical terminology, evidence boundaries and numbered procedures do not trigger repetition hints',()=>{
 const text='1. 输入图像后执行预处理。\n2. 使用 CNN 提取特征。\n3. CNN 的参数定义见公式 $F_1=2PR/(P+R)$。\n相关关系不代表因果关系；结果仍需外部验证。\n【待补充：外部验证记录】';
 assert.equal(hints(text).length,0);assert.equal(hints('样本量为 120；准确率为 94.2%，p=0.032，不能外推到未知个体。').length,0);
 const result=auditWritingConsistency({chapters:Array.from({length:8},(_,i)=>({id:'c'+i,title:'章节'+i,text:'显而易见，本节需要明确证据。'})),maxFindings:2});assert.equal(result.findings.length,2);assert.equal(result.totalFindings,8);assert.equal(result.truncated,true);
});

test('unclosed protected blocks stay excluded rather than scanning or classifying their contents as prose',()=>{
 for(const open of ['```','~~~','$$','\\[','\\(','“','‘','「','『']){
  const text=open+'\n'+('此外，重复标记仍是未闭合保护区中的内容。\n'.repeat(6000));assert.equal(hints(text).length,0,open);
 }
});

test('expression suggestions must quote actual manuscript text and remain read-only review findings',()=>{
 const chapters=[section('此外，本节有重复衔接，但数据仍须保留。')],before=structuredClone(chapters),task=writingReviewTask({chapters});
 const finding={sectionId:'methods',quote:'此外，本节有重复衔接',category:'language_expression',severity:'info',explanation:'相邻段落衔接可能重复。',suggestion:'根据本段与前段的具体关系调整衔接，保留所有研究事实。'};
 const response=quote=>({text:JSON.stringify({complete:true,findings:[{...finding,quote}],limitations:['仅检查所给正文。']})});
 const parsed=parseWritingReview(response(finding.quote),task);assert.equal(parsed.findings[0].category,'language_expression');assert.equal(parsed.findings[0].grounding,'exact_manuscript_quote');assert.throws(()=>parseWritingReview(response('不存在的原文，不得生成发现'),task),error=>error.code==='invalid_review_output');assert.deepEqual(chapters,before);
});

test('only prose and review stages receive the registered expression skill with task contracts and budgets unchanged',async()=>{
 for(const args of [{skill:'thesis-section'},{skill:'thesis-section',kind:'summary'},{skill:'writing-task',kind:'article',operation:'draft'},{skill:'writing-task',kind:'proposal',operation:'draft'},{skill:'writing-task',operation:'abstract'},{skill:'writing-review'}]){
  const ids=writingSkillIdsForTask(args);assert.equal(ids.filter(id=>id==='academic-expression').length,1);const loaded=await loadAgentSkillComposition(args.skill,ids);assert.ok(loaded.instructions.length<24000);assert.equal(loaded.skills.find(s=>s.id==='academic-expression').source.kind,'paperknow');assert.match(loaded.instructions,/直接引语原文不得润色/);assert.match(loaded.instructions,/不改变事实、权限、费用预算及停止条件/);
 }
 for(const args of [{skill:'tool-task'},{skill:'writing-review',operation:'supplement-check'},{skill:'thesis-outline'},{skill:'thesis-method'},{skill:'writing-task',operation:'outline'},{skill:'writing-task',operation:'questionnaire'},{skill:'writing-task',operation:'ideas'}])assert.equal(writingSkillIdsForTask(args).includes('academic-expression'),false);
});
