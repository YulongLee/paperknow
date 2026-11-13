import test from 'node:test';
import assert from 'node:assert/strict';
import {writingReviewTask,parseWritingReview} from '../backend/writing-quality.mjs';
import {assessWritingDelivery,writingAdvisoryFinding} from '../dist/workspace/writing-delivery.mjs';
test('scope review distinguishes mathematical generality and optional examples from unsupported observed claims',()=>{
 const text='组合数量随长度迅速扩大。长度n的有序位置对数C(n)=n²。长度仅取样8至64。';
 const task=writingReviewTask({chapters:[{id:'c',title:'背景',text}]});
 assert.match(task.instructions,/一般数学定义所推出的普遍规律不因示例仅取有限样本/);
 assert.match(task.instructions,/未被用户或学校明确要求.*额外数值推导应归为 language_expression\/info/);
 assert.match(task.instructions,/具体数值或公式冲突.*实测断言.*warning/);
 const finding={sectionId:'c',quote:'组合数量随长度迅速扩大',category:'language_expression',severity:'info',explanation:'可以补充更详细的数学说明。',suggestion:'可增加额外推导。'};
 const parsed=parseWritingReview({text:JSON.stringify({complete:true,checkedFigureIds:[],findings:[finding],limitations:[]})},task);assert.equal(parsed.findings[0].severity,'info');
 const quality={status:'completed',coverage:{complete:true},reviews:[{status:'completed',findings:parsed.findings}]};
 assert.equal(assessWritingDelivery({kind:'proposal',text,quality}).ready,false);
 const critical={...finding,category:'data_support',severity:'warning',explanation:'正文中的实际测量缺少记录。'};
 const guarded=assessWritingDelivery({kind:'proposal',text,quality:{...quality,reviews:[{status:'completed',findings:[critical]}]}});assert.equal(guarded.ready,false);
});
test('fixture identity notes block delivery while genuine simulation disclosure remains allowed',()=>{
 const quality={status:'completed',coverage:{complete:true},reviews:[{status:'completed',findings:[]}]},base='本研究采用数学仿真，说明假设和模拟数据的适用范围。';
 assert.equal(assessWritingDelivery({kind:'proposal',text:base,quality}).ready,true);
 const leaked=assessWritingDelivery({kind:'proposal',text:base+'材料中的大学、学生与教师身份均为虚构占位，不构成实证对象。',quality});
 assert.equal(leaked.ready,false);assert.ok(leaked.issues.some(row=>row.code==='identity_placeholder_leak'));
 const reversed=assessWritingDelivery({kind:'proposal',text:base+'资料中的测试大学与学生均为虚构身份。',quality});assert.equal(reversed.ready,false);assert.ok(reversed.issues.some(row=>row.code==='identity_placeholder_leak'));
 assert.equal(assessWritingDelivery({kind:'proposal',text:base+'资料中的测试大学与学生均为虚构身份，以保护隐私。',quality}).ready,false);
 assert.equal(assessWritingDelivery({kind:'proposal',text:base+'来源中的测试大学、测试学院、测试学生、编号TEST2026001与测试教师均为虚构身份。',quality}).ready,false);
 for(const note of ['资料中的学生均使用虚构身份，以进行隐私保护。','资料中的大学、学生与教师身份均为虚构占位，经过匿名处理。'])assert.equal(assessWritingDelivery({kind:'proposal',text:base+note,quality}).ready,true,note);
});

test('AI wording advice and mixed factual issues remain reviewable',()=>{
 const benign={category:'language_expression',severity:'info',quote:'这段文字的表达比较重复',explanation:'可减少重复措辞。',suggestion:'精简句式。'};
 assert.equal(writingAdvisoryFinding(benign),false);
 const findings=[
  {...benign,explanation:'缺少实验记录，数值无法核实。'},
  {category:'claim_scope',severity:'info',quote:'不能据此推断群体效果，但实际实验的成功率为95%。',explanation:'未发现矛盾'},
  {category:'method_result_consistency',severity:'info',quote:'第2-4周采集患者样本并取得95%成功率。',explanation:'并无事实冲突'},
  {...benign,explanation:'模板缺少指导教师姓名，请补充。'},
  {...benign,explanation:'引用来源的作者尚未确认。'},
  {...benign,explanation:'文中数据可能存在伪造。'},
  {...benign,quote:'The proposed model achieved 99% accuracy.',explanation:'This claim is not substantiated'},
  {...benign,category:'terminology',quote:'受访同学均表示学习效率提升',explanation:'尚未证明该结论'},
  {...benign,quote:'无法推断长期表现。模型识别率达到99%。',explanation:'需核实前述陈述'},
  {...benign,quote:'该研究已经达到预期目标',explanation:'可能存在事实疑虑'}
 ];
 for(const row of findings)assert.equal(writingAdvisoryFinding(row),false,JSON.stringify(row));
});
test('only system-identified repeated transitions are non-blocking; substantive and unverified AI suggestions remain reviewable',()=>{
 const text='此外，第二段说明已有条件。',safe={category:'language_expression',severity:'info',reasonCode:'repeated_transition',quote:text,explanation:'本节有 3 段以“此外”起句，段落衔接可能重复。'};
 assert.equal(writingAdvisoryFinding(safe),true);assert.equal(assessWritingDelivery({kind:'proposal',text,quality:{consistency:{findings:[safe]}}}).ready,true);
 for(const unsafe of [{...safe,reasonCode:undefined,explanation:'指代不清，研究对象未确认。'},{...safe,category:'source_support',explanation:'该引用不支持论断。'},{...safe,severity:'warning',explanation:'存在缺失的真实数据。'}])assert.equal(assessWritingDelivery({kind:'proposal',text,quality:{reviews:[{findings:[unsafe]}]}}).ready,false);
});
