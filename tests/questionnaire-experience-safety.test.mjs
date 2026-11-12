import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAIQuestionnaire} from '../dist/workspace/questionnaire-model.mjs';
import {normalizeWritingSnapshot,writingPlan,aggregateWritingQuestionnaire,validateWritingCandidate} from '../backend/writing-model.mjs';

const scale=['非常不满意','不满意','一般','满意','非常满意'];
const make=questions=>({title:'阅读调查',introduction:'匿名自愿参与',questions});
const nonuser={id:'q1',type:'single',title:'是否使用过数字阅读服务？',options:['从未使用过','使用过'],required:true};
const experience={id:'q2',type:'scale',title:'您对服务的使用体验满意吗？',options:scale,required:true};
const general={id:'q3',type:'single',title:'您的年级是？',options:['一年级','二年级'],required:true};
test('AI process notes are rejected without deleting consent or candidate text',()=>{
 const input=make([nonuser,experience,general]);input.introduction='本调查仅用于学术研究。\n参与完全自愿，可以随时退出。我们不收集姓名或联系方式。当前问卷不支持自动跳题逻辑，请自行判断作答。所有结果为待人工核对的草稿数据。感谢您的参与。';const before=structuredClone(input);assert.throws(()=>normalizeAIQuestionnaire(input,{outputCount:3,scalePoints:5}),e=>e.validationCode==='questionnaire_statement_conflict');assert.deepEqual(input,before);
});
test('non-users can skip required experience items while their scale and unrelated required questions are preserved',()=>{
 const input=make([nonuser,experience,general]),before=structuredClone(input);
 const out=normalizeAIQuestionnaire(input,{outputCount:3,scalePoints:5});
 assert.equal(out.questions[0].required,true);assert.equal(out.questions[1].required,false);
 assert.match(out.questions[1].title,/未使用者可跳过/);assert.deepEqual(out.questions[1].options,scale);
 assert.equal(out.questions[2].required,true);assert.deepEqual(input,before);
 assert.deepEqual(normalizeAIQuestionnaire(out,{outputCount:3,scalePoints:5}),out);
});
test('without explicit non-user option experience items remain unchanged',()=>{
 const out=normalizeAIQuestionnaire(make([{...nonuser,options:['使用过','曾经使用']},experience,general]),{outputCount:3,scalePoints:5});
 assert.equal(out.questions[1].required,true);
});
test('direct convenience ratings reject agree-disagree labels without rejecting agreement with statements',()=>{
 const agreement=['非常不同意','不同意','一般','同意','非常同意'];
 const rating={...experience,title:'请评价校内外访问的便利程度',options:agreement};
 assert.throws(()=>normalizeAIQuestionnaire(make([nonuser,rating,general]),{outputCount:3,scalePoints:5}),error=>error.validationCode==='questionnaire_options'&&error.validationIssues.some(i=>i.code==='scale_dimension_mismatch'&&i.questionIndex===2));
 const statement={...rating,title:'您是否同意该服务访问便利？'};
 assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([nonuser,statement,general]),{outputCount:3,scalePoints:5}));
 const corrected={...rating,options:['非常不便利','不便利','一般','便利','非常便利']};
 assert.equal(normalizeAIQuestionnaire(make([nonuser,corrected,general]),{outputCount:3,scalePoints:5}).questions[1].required,false);
});
test('incorrect convenience scale produces actionable safe feedback for model repair',()=>{
 const snap=normalizeWritingSnapshot({title:'阅读调查',profile:{level:'本科',language:'中文',targetWords:500},requirements:{outputCount:3,scalePoints:5},materials:[],references:[],outline:[]}),unit=writingPlan(snap,'questionnaire')[0];
 const candidate=make([nonuser,{...experience,title:'请评价访问的便利程度',options:['非常不同意','不同意','一般','同意','非常同意']},general]);
 const result=validateWritingCandidate({text:JSON.stringify({...candidate,complete:true,source_ids:[]}),trace:[]},'questionnaire','questionnaire',snap,unit);
 assert.equal(result.valid,false);assert.equal(result.feedback.code,'questionnaire_options');assert.equal(result.feedback.issues[0].code,'scale_dimension_mismatch');assert.match(result.feedback.rule,/从不便利到便利/);assert.doesNotMatch(JSON.stringify(result.feedback),/请评价访问/);
});
test('direct experience-and-ability question does not use agreement labels, while agreement statements remain valid',()=>{
 const agree=['非常不同意','不同意','一般','同意','非常同意'];
 const q={...experience,title:'请评价您在资源发现方面的体验：能否方便地找到自己想读的数字资源',options:agree};
 assert.throws(()=>normalizeAIQuestionnaire(make([nonuser,q,general]),{outputCount:3,scalePoints:5}),e=>e.validationCode==='questionnaire_options'&&e.validationIssues[0].code==='scale_dimension_mismatch');
 assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([nonuser,{...q,title:'请评价您是否同意以下陈述：我能方便地找到自己想读的数字资源'},general]),{outputCount:3,scalePoints:5}));
 assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([nonuser,{...q,options:['非常差','较差','一般','较好','非常好']},general]),{outputCount:3,scalePoints:5}));
});
test('non-user screening and experience questions from different batches are reconciled in the final output',()=>{
 const snap=normalizeWritingSnapshot({title:'阅读调查',profile:{level:'本科',language:'中文',targetWords:500},requirements:{outputCount:16,scalePoints:5},materials:[],references:[],outline:[]}), plan=writingPlan(snap,'questionnaire');
 const completed=plan.map(unit=>({id:unit.id,...make(Array.from({length:unit.questionCount},(_,i)=>{let n=unit.questionStart+i;if(n===1)return nonuser;if(n===9)return {...experience,id:'q9'};return {...general,id:'q'+n,title:'您的年级 '+n+' 是？'};})),sourceIds:[]}));
 const out=aggregateWritingQuestionnaire(snap,plan,completed);
 assert.equal(out.questions[8].required,false);assert.match(out.questions[8].title,/未使用者可跳过/);assert.match(out.text,/未使用者可跳过/);
});

test('explicit overlapping lower-bound frequency choices require repair, disjoint ranges are allowed',()=>{
 const q={...general,title:'使用频率',options:['每周至少一次','每月至少一次','从未使用']};
 assert.throws(()=>normalizeAIQuestionnaire(make([nonuser,experience,q]),{outputCount:3}),e=>e.validationIssues.some(i=>i.code==='frequency_overlap'));
 const safe={...q,title:'过去30天使用频率',options:['0次（过去30天未使用）','1至3次','4至7次','8至15次','16次及以上']};assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([nonuser,experience,safe]),{outputCount:3}));
});
test('multiple choice retains explicit none-of-the-above for supported mutual exclusion',()=>{
 const q={...general,type:'multiple',title:'使用过哪些服务？',options:['电子书','数据库','以上均未使用过']};
 assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([nonuser,experience,q]),{outputCount:3}));
 assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([nonuser,experience,{...q,options:['电子书','数据库','其他']}]),{outputCount:3}));
});
test('the specifically combined speed off-campus and multi-device satisfaction dimensions are flagged',()=>{
 const q={...experience,title:'您对访问速度、校外访问和多设备使用的满意程度如何？'};
 assert.throws(()=>normalizeAIQuestionnaire(make([nonuser,q,general]),{outputCount:3}),e=>e.validationIssues.some(i=>i.code==='multiple_dimensions'));
 assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([nonuser,{...q,title:'您对校外访问的满意程度如何？'},general]),{outputCount:3}));
});
test('repair feedback identifies safe issue codes without copying private titles or options',()=>{
 const snap=normalizeWritingSnapshot({title:'阅读调查',profile:{level:'本科',language:'中文',targetWords:500},requirements:{outputCount:3,scalePoints:5},materials:[],references:[],outline:[]}),unit=writingPlan(snap,'questionnaire')[0];
 const q={...general,title:'PRIVATE 标识频率',options:['每周至少一次','每月至少一次','从未使用']},candidate={...make([nonuser,experience,q]),complete:true,source_ids:[]};
 const result=validateWritingCandidate({text:JSON.stringify(candidate),trace:[]},'questionnaire','questionnaire',snap,unit);assert.equal(result.valid,false);assert.equal(result.feedback.issues[0].code,'frequency_overlap');assert.match(result.feedback.rule,/区间互不重叠/);assert.doesNotMatch(JSON.stringify(result.feedback),/PRIVATE/);
});

test('weekly frequency ranges must not leave an uncovered or ambiguous six-times gap',()=>{
 const q={...nonuser,title:'使用数字阅读服务的频率',options:['几乎每天','每周3至5次','每周1至2次','每月1至3次','每年偶尔或从未']};
 assert.throws(()=>normalizeAIQuestionnaire(make([q,experience,general]),{outputCount:3}),error=>error.validationIssues.some(i=>i.code==='frequency_gap'));
 const fixed={...q,title:'过去30天使用数字阅读服务的频率',options:['0次（过去30天未使用）','1至3次','4至7次','8至15次','16次及以上']};const out=normalizeAIQuestionnaire(make([fixed,experience,general]),{outputCount:3});assert.equal(out.questions[0].required,true);assert.equal(out.questions[1].required,false);assert.match(out.questions[1].title,/未使用者可跳过/);
});
test('standalone never-used and never-encountered choices cannot be mixed with other multiple selections',()=>{
 for(const option of ['未使用过','从未使用过','未遇到/未使用']){const q={...general,type:'multiple',title:'遇到过哪些问题？',options:['检索慢','页面复杂',option]};assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([nonuser,experience,q]),{outputCount:3}),option);}
});
test('an instruction to select a missing nonuser option requires candidate repair',()=>{
 const q={...nonuser,title:'过去30天使用数字阅读服务的频率',options:['0次（过去30天未使用）','1至3次','4至7次','8至15次','16次及以上']},input=make([q,experience,general]);input.introduction='本调查自愿参加。如果您未使用过相关服务，请在体验题中选择未使用。感谢您的参与。';const before=structuredClone(input);assert.throws(()=>normalizeAIQuestionnaire(input,{outputCount:3}),e=>e.validationCode==='questionnaire_statement_conflict');assert.deepEqual(input,before);
});

test('the real eight-question shape catches distinct missing ranges, incompatible choices and combined dimensions',()=>{
 const questions=[{...general,id:'q1'}, {id:'q2',type:'single',title:'您使用数字阅读服务（如电子书平台、学术数据库、移动阅读App等）的频率最接近以下哪一项？',options:['几乎每天使用','每周3至5次','每周1至2次','每月1至3次','每年偶尔使用或从未使用'],required:true},{id:'q3',type:'multiple',title:'您通常通过哪些渠道进入数字阅读服务？',options:['图书馆电子资源入口','搜索引擎链接','几乎没有固定渠道或未使用过'],required:true},{...experience,id:'q4',title:'您对数字阅读服务的检索便利性（如搜索响应速度、筛选功能、界面操作难易）满意程度如何？'},{...experience,id:'q5',title:'您对所需文献或图书资源的可获取性（如能否找到想读的内容、校外访问是否顺畅）满意程度如何？'},{...experience,id:'q6',title:'您对所使用服务的整体满意度如何？'},{id:'q7',type:'multiple',title:'您遇到过哪些问题？',options:['检索结果不相关','未遇到过问题','未使用过相关服务'],required:true},{id:'q8',type:'text',title:'还有哪些建议？',options:[],required:false}];
 assert.throws(()=>normalizeAIQuestionnaire(make(questions),{outputCount:8}),error=>{const found=new Set(error.validationIssues.map(i=>i.questionIndex+':'+i.code));for(const item of ['2:frequency_gap','4:multiple_dimensions','5:multiple_dimensions'])assert.ok(found.has(item),item);return true;});
 const corrected=questions.map(q=>q.id==='q2'?{...q,title:'过去30天使用数字阅读服务的频率',options:['0次（过去30天未使用）','1至3次','4至7次','8至15次','16次及以上']}:q.id==='q3'?{...q,options:['图书馆电子资源入口','搜索引擎链接','其他渠道']}:q.id==='q4'?{...q,title:'您对搜索响应速度的满意程度如何？'}:q.id==='q5'?{...q,title:'您对校外访问顺畅程度的满意程度如何？'}:q.id==='q7'?{...q,options:['检索结果不相关','资源无法下载']}:q);
 const input=make(corrected);input.introduction='参与自愿。从未使用过数字阅读服务的同学可在相关体验题处选择“未使用过”或直接跳过。';assert.throws(()=>normalizeAIQuestionnaire(input,{outputCount:8}),e=>e.validationCode==='questionnaire_statement_conflict');input.introduction='参与自愿。未使用者可跳过体验题。';const output=normalizeAIQuestionnaire(input,{outputCount:8});assert.equal(output.questions[1].required,true);assert.equal(output.questions[3].required,false);assert.match(output.questions[3].title,/未使用者可跳过/);assert.doesNotMatch(output.introduction,/选择“未使用过”/);
});

test('implementation notes are rejected without deleting response time and consent',()=>{
 const input=make([nonuser,experience,general]);input.introduction='参与完全自愿。本问卷不支持自动跳题，约需3分钟完成。';const before=structuredClone(input);assert.throws(()=>normalizeAIQuestionnaire(input,{outputCount:3}),e=>e.validationCode==='questionnaire_statement_conflict');assert.deepEqual(input,before);
});

test('missing option promise requires repair while correct skip hint remains',()=>{
 const input=make([nonuser,{...experience,required:false},general]);input.introduction='参与自愿。未使用者可选择未使用选项。';assert.throws(()=>normalizeAIQuestionnaire(input,{outputCount:3}),e=>e.validationCode==='questionnaire_statement_conflict');input.introduction='参与自愿。';const result=normalizeAIQuestionnaire(input,{outputCount:3});assert.equal(result.questions[1].required,false);assert.match(result.questions[1].title,/未使用者可跳过/);
});
test('existing nonuser skip variants are preserved, including duplicated wording for review',()=>{
 for(const suffix of ['（若从未使用可跳过本题）','（未使用过可跳过）','（若从未使用可跳过本题）（未使用者可跳过）']){const q={...experience,title:'使用体验满意度如何？'+suffix};const result=normalizeAIQuestionnaire(make([nonuser,q,general]),{outputCount:3});assert.equal(result.questions[1].required,false);assert.equal(result.questions[1].title,q.title,suffix);}
});

test('new real questionnaire frequency gap, zero overlap, combined dimensions and consent mismatch are caught',()=>{
 const q={...nonuser,title:'总体而言，你在过去一学期中使用数字阅读服务的频率如何？',options:['从不使用','每月少于1次','每月1至3次','每周1至2次','几乎每天使用']},dim={...experience,title:'你对数字阅读服务中学习或研究所需资源的可获取性（如馆藏覆盖范围、访问权限、是否需要付费）满意吗？'};
 assert.throws(()=>normalizeAIQuestionnaire(make([q,dim,general]),{outputCount:3}),e=>{assert.ok(e.validationIssues.some(i=>i.code==='frequency_gap'));assert.ok(e.validationIssues.some(i=>i.code==='frequency_overlap'));assert.ok(e.validationIssues.some(i=>i.code==='multiple_dimensions'));return true;});
 const fixed={...q,title:'过去30天使用数字阅读服务的频率',options:['0次（过去30天未使用）','1至3次','4至7次','8至15次','16次及以上']},input=make([fixed,{...experience,title:'资源访问是否方便？（未使用过可跳过）'},general]);input.introduction='你可以随时中止填写或跳过任何不想回答的题目。';assert.throws(()=>normalizeAIQuestionnaire(input,{outputCount:3}),e=>e.validationCode==='questionnaire_statement_conflict');input.introduction='你可以随时中止填写。';const result=normalizeAIQuestionnaire(input,{outputCount:3});assert.equal(result.questions[0].required,true);assert.equal(result.questions[1].required,false);assert.match(result.introduction,/随时中止填写/);assert.doesNotMatch(result.introduction,/跳过任何/);
});

test('a contradictory screening skip hint requires repair without deleting the text',()=>{
 const q={...nonuser,title:'过去30天使用数字服务的频率如何？（若从未使用可跳过本题）（未使用者可跳过）',options:['0次（过去30天未使用）','1至3次','4至7次','8至15次','16次及以上']};const input=make([q,experience,general]),before=structuredClone(input);assert.throws(()=>normalizeAIQuestionnaire(input,{outputCount:3}),e=>e.validationCode==='questionnaire_statement_conflict');assert.deepEqual(input,before);
});

test('actual 53980 frequency, mutually exclusive multi-select, and screening branch are reviewable',()=>{
 const q1={id:'q1',type:'single',title:'您目前是否在高校在读？',options:['是，本科生','是，硕士研究生','是，博士研究生','否（结束作答）'],required:true},q2={id:'q2',type:'single',title:'您使用数字阅读服务的频率最接近以下哪一项？',options:['几乎每天','每周4-6次','每周1-3次','每月1-3次','每学期几次或更少','从未使用过'],required:true},q3={id:'q3',type:'multiple',title:'您主要使用哪些类型的数字阅读服务？',options:['电子书平台','学术文献数据库','基本不使用上述服务'],required:false};
 assert.throws(()=>normalizeAIQuestionnaire(make([q1,q2,q3]),{outputCount:3}),error=>{const issues=new Set(error.validationIssues.map(row=>row.questionIndex+':'+row.code));for(const code of ['1:unsupported_branching','1:education_coverage','2:frequency_ambiguous'])assert.ok(issues.has(code),code);return true;});
 const corrected=[{...q1,options:['是，专科或高职生','是，本科生','是，硕士研究生','是，博士研究生','否（请自行停止作答）']},{...q2,title:'过去30天使用数字阅读服务的频率',options:['0次（过去30天未使用）','1至3次','4至7次','8至15次','16次及以上']},{...q3,options:['电子书平台','学术文献数据库','其他服务']}];assert.doesNotThrow(()=>normalizeAIQuestionnaire(make(corrected),{outputCount:3}));
 const constrained={...q1,options:['是，本科生','是，硕士研究生','是，博士研究生','否']};assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([constrained,{...q2,title:'过去30天使用数字阅读服务的频率',options:['0次（过去30天未使用）','1至3次','4至7次','8至15次','16次及以上']},{...q3,options:['电子书平台','其他服务']}]),{outputCount:3,instructions:'本次调查仅限本科及以上学生'}));
});

test('actual 53981 frequency uses a single reference window and truthful skip guidance',()=>{
 const q={...nonuser,title:'您平均使用数字阅读服务（如电子书平台、学术数据库、在线阅读App等）的频率是？',options:['每天一次及以上','每周3至5次','每周1至2次','每月1至3次','每学期几次','从未使用过']};
 assert.throws(()=>normalizeAIQuestionnaire(make([q,experience,general]),{outputCount:3}),error=>{const codes=new Set(error.validationIssues.map(row=>row.code));for(const code of ['frequency_gap','frequency_period','frequency_mixed_units'])assert.ok(codes.has(code),code);return true;});
 const fixed={...q,title:'过去30天使用数字阅读服务的次数是多少？',options:['0次（过去30天未使用）','1至3次','4至7次','8至15次','16次及以上']},input=make([fixed,experience,general]);input.introduction='参与完全自愿，您可以随时中止作答或跳过任何不愿回答的问题。';assert.throws(()=>normalizeAIQuestionnaire(input,{outputCount:3}),e=>e.validationCode==='questionnaire_statement_conflict');input.introduction='参与完全自愿，您可以随时中止作答。';const result=normalizeAIQuestionnaire(input,{outputCount:3});assert.equal(result.questions[0].required,true);assert.match(result.introduction,/随时中止作答/);assert.doesNotMatch(result.introduction,/跳过任何/);assert.equal(result.questions[1].required,false);
});

test('one-window counts must have no overlaps or gaps, without equating calendar months and weeks',()=>{
 const run=options=>normalizeAIQuestionnaire(make([{...nonuser,title:'过去30天的使用频率',options},experience,general]),{outputCount:3});
 assert.throws(()=>run(['0次','1至3次','5至7次','8次及以上']),e=>e.validationIssues.some(row=>row.code==='frequency_gap'));
 assert.throws(()=>run(['0次','1至3次','3至7次','8次及以上']),e=>e.validationIssues.some(row=>row.code==='frequency_overlap'));
 assert.doesNotThrow(()=>run(['0次','1至3次','4至7次','8次及以上']));
 assert.throws(()=>run(['从未使用过','每月1至3次','每学期几次']),e=>e.validationIssues.some(row=>row.code==='frequency_mixed_units'));
});

test('zero activity in an explicitly bounded window permits the related experience questions to be skipped',()=>{
 const q={...nonuser,title:'过去30天使用数字阅读服务的频率',options:['0次','1至3次','4至7次','8次及以上']};const result=normalizeAIQuestionnaire(make([q,experience,general]),{outputCount:3});assert.equal(result.questions[0].required,true);assert.equal(result.questions[1].required,false);assert.match(result.questions[1].title,/未使用者可跳过/);
});

test('required questions reject a standalone promise that every unwilling response may be skipped',()=>{
 const input=make([nonuser,experience,general]);input.introduction='参与完全自愿。您可以跳过任何不愿回答的问题。可随时停止作答。';const before=structuredClone(input);assert.throws(()=>normalizeAIQuestionnaire(input,{outputCount:3}),e=>e.validationCode==='questionnaire_statement_conflict');assert.deepEqual(input,before);
});

test('a previous month is a valid reference window without treating it as four weeks',()=>{
 const q={...nonuser,title:'上个月使用数字阅读服务的次数',options:['0次','1至3次','4至7次','8次及以上']};assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([q,experience,general]),{outputCount:3}));
});

test('usage count questions with words between usage and count still require a time window',()=>{
 const q={...nonuser,title:'您使用数字阅读服务的次数是多少？',options:['0次','1至3次','4至7次','8次及以上']};assert.throws(()=>normalizeAIQuestionnaire(make([q,experience,general]),{outputCount:3}),e=>e.validationIssues.some(row=>row.code==='frequency_period'));
});

test('frequency scales use the same period and interval checks as single choice questions',()=>{
 const scaleFrequency={id:'q1',type:'scale',title:'过去30天使用数字阅读服务的频率',options:['0次','1至3次','5至7次','8至15次','16次及以上'],required:true};
 assert.throws(()=>normalizeAIQuestionnaire(make([scaleFrequency,experience,general]),{outputCount:3}),e=>e.validationIssues.some(row=>row.code==='frequency_gap'&&row.questionType==='scale'));
 const overlap={...scaleFrequency,options:['0次','1至3次','3至7次','8至15次','16次及以上']};assert.throws(()=>normalizeAIQuestionnaire(make([overlap,experience,general]),{outputCount:3}),e=>e.validationIssues.some(row=>row.code==='frequency_overlap'));
 const noPeriod={...scaleFrequency,title:'使用数字阅读服务的频率',options:['从不','很少','有时','经常','总是']};assert.throws(()=>normalizeAIQuestionnaire(make([noPeriod,experience,general]),{outputCount:3}),e=>e.validationIssues.some(row=>row.code==='frequency_period'));
 const good={...scaleFrequency,options:['0次','1至3次','4至7次','8至15次','16次及以上']};assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([good,experience,general]),{outputCount:3}));
});

test('questions phrased as how many times are checked for interval gaps',()=>{
 const question={...nonuser,title:'过去30天你使用数字阅读服务几次？',options:['0次','1至3次','5至7次','8次及以上']};
 assert.throws(()=>normalizeAIQuestionnaire(make([question,experience,general]),{outputCount:3}),e=>e.validationIssues.some(row=>row.code==='frequency_gap'));
 const good={...question,options:['0次','1至3次','4至7次','8次及以上']};assert.doesNotThrow(()=>normalizeAIQuestionnaire(make([good,experience,general]),{outputCount:3}));
});
test('non-user neutral rating instructions require repair without changing original questions',()=>{
 const q={...experience,title:'您对检索便利程度满意吗？（指能否方便地找到所需内容；未使用者请选择中间选项）'},q2={...experience,id:'q4',title:'资源满足程度如何？（未使用者可选择中间选项）'},input=make([nonuser,q,q2,general]),before=structuredClone(input);assert.throws(()=>normalizeAIQuestionnaire(input,{outputCount:4}),e=>e.validationCode==='questionnaire_statement_conflict');assert.deepEqual(input,before);
});
test('multi-select options that negate every experience cannot be combined with positive choices',()=>{
 for(const label of ['过去30天未使用任何数字阅读服务','未遇到过明显困难','没有觉得便捷的方面','过去30天未使用,无法评价']){
  const multi={id:'q2',type:'multiple',title:'使用情况',required:false,options:['使用电子图书',label]};
  assert.deepEqual(normalizeAIQuestionnaire(make([nonuser,multi,general]),{outputCount:3}).questions[1].options,multi.options,label);
 }
});
test('agreement statements cannot use satisfaction labels and indirect non-users may skip experience',()=>{
 const indirect={...nonuser,options:['经常使用','偶尔使用','听说过但从未使用']};
 const mismatch={...experience,title:'我认为高校数字阅读资源的种类和数量能够满足我的学习与阅读需求。',options:['非常不满意','比较不满意','一般','比较满意','非常满意']};
 assert.throws(()=>normalizeAIQuestionnaire(make([indirect,mismatch,general]),{outputCount:3}),e=>e.validationIssues?.some(i=>i.code==='scale_dimension_mismatch'));
 const corrected={...mismatch,options:['非常不同意','比较不同意','不确定','比较同意','非常同意']};
 const result=normalizeAIQuestionnaire(make([indirect,corrected,general]),{outputCount:3});assert.equal(result.questions[1].required,false);assert.match(result.questions[1].title,/未使用者可跳过/);
});
test('a nonuser cannot be instructed to choose a mismatched option or jump to the survey end',()=>{
 const row={id:'q1',type:'single',title:'在过去30天内，您使用数字阅读服务的频率？（若从未使用，请选择最后一项并可直接跳到问卷末尾）',options:['0次（过去30天未使用）','1至3次','4至7次','8至15次','16次及以上'],required:true};
 assert.throws(()=>normalizeAIQuestionnaire(make([row,experience,general]),{outputCount:3}),e=>e.validationIssues?.some(i=>i.code==='unsupported_branching'));
 const correct={...row,title:'在过去30天内，您使用数字阅读服务的频率？'};assert.equal(normalizeAIQuestionnaire(make([correct,experience,general]),{outputCount:3}).questions.length,3);
});
test('yes-no screening treats no as non-user and rejects advertised jumps',()=>{
 const screen={id:'q1',type:'single',title:'您是否在过去30天内使用过学校提供的数字阅读服务？',options:['是','否'],required:true};
 const result=normalizeAIQuestionnaire(make([screen,experience,general]),{outputCount:3});assert.equal(result.questions[0].required,true);assert.equal(result.questions[1].required,false);
 assert.throws(()=>normalizeAIQuestionnaire(make([{...screen,options:['是','否（选择此项后可直接跳至第7题结束部分）']},experience,general]),{outputCount:3}),e=>e.validationIssues?.some(i=>i.code==='unsupported_branching'));
});
test('resource richness and accessibility cannot be collapsed into one agreement scale',()=>{
 const row={...experience,title:'请对高校数字阅读服务可提供资源的丰富程度与可获取性作出评价。',options:['非常不同意','比较不同意','一般','比较同意','非常同意']};
 assert.throws(()=>normalizeAIQuestionnaire(make([nonuser,row,general]),{outputCount:3}),e=>{const codes=e.validationIssues.map(i=>i.code);return codes.includes('scale_dimension_mismatch')&&codes.includes('multiple_dimensions');});
});
test('activity-day intervals cannot be paired with incorrect per-week claims',()=>{
 const q={...nonuser,title:'过去30天内，使用数字阅读服务的大致频率是？',options:['未使用过','1—7天（少于每周1次）','8—14天（约每周1—2次）','15—21天','22—29天','30天']};
 assert.throws(()=>normalizeAIQuestionnaire(make([q,experience,general]),{outputCount:3}),e=>e.validationIssues?.some(i=>i.code==='frequency_mixed_units'));
});
test('all-required claims, zero-day duration labels and undergraduate-only screening cannot mislead mixed student survey',()=>{
 const duration={id:'q2',type:'scale',title:'过去30天平均每天使用数字阅读服务的时长？',options:['几乎不使用(0天)','不足30分钟','30分钟至1小时','1小时至2小时','超过2小时'],required:true};
 assert.throws(()=>normalizeAIQuestionnaire(make([nonuser,duration,general]),{outputCount:3}),e=>e.validationIssues?.some(i=>i.code==='scale_dimension_mismatch'));
 const college={id:'q1',type:'single',title:'您目前就读于哪个本科年级?',options:['一年级','二年级','三年级','四年级','五年级及以上'],required:true};
 assert.throws(()=>normalizeAIQuestionnaire(make([college,experience,general]),{outputCount:3,instructions:'对象为高校在校学生'}),e=>e.validationIssues?.some(i=>i.code==='education_coverage'));
 const input=make([nonuser,experience,{...general,required:false}]);input.introduction='参与完全自愿。全部题目均为必答。请按真实情况作答。';const before=structuredClone(input);assert.throws(()=>normalizeAIQuestionnaire(input,{outputCount:3}),e=>e.validationCode==='questionnaire_statement_conflict');assert.deepEqual(input,before);
});
test('independent bike safety dimensions and reasons from a real prior sample require correction',()=>{
 const options=['非常不同意','不同意','一般','同意','非常同意'];
 const double={...experience,title:'您在多大程度上同意：车辆状况和停放秩序让我感到安全放心？',options};
 const reasons={id:'q3',type:'multiple',title:'不使用的原因',options:['费用偏高或不熟悉租车流程','没有合适的出行需求'],required:false};
 const input=make([nonuser,double,reasons]);const before=structuredClone(input);
 assert.throws(()=>normalizeAIQuestionnaire(input,{outputCount:3}),e=>e.validationIssues.some(i=>i.code==='multiple_dimensions'&&i.questionIndex===2)&&e.validationIssues.some(i=>i.code==='multiple_reasons'&&i.questionIndex===3));assert.deepEqual(input,before);
 const fixed=make([nonuser,{...double,title:'您对车辆状况是否满意？',options:scale},{...reasons,options:['费用偏高','不熟悉租车流程','没有合适的出行需求']}]);
 assert.equal(normalizeAIQuestionnaire(fixed,{outputCount:3}).questions.length,3);
});
test('combined-reason errors provide actionable model feedback without copying private questionnaire text',()=>{
 const snapshot=normalizeWritingSnapshot({title:'共享单车调查',profile:{level:'本科',major:'设计',language:'中文',targetWords:200},requirements:{outputCount:3},materials:[],references:[],outline:[]});
 const unit=writingPlan(snapshot,'questionnaire')[0];
 const output={...make([nonuser,experience,{id:'q3',type:'multiple',title:'不使用的原因',options:['费用偏高或不熟悉租车流程','其他'],required:false}]),complete:true,source_ids:[]};
 const result=validateWritingCandidate({text:JSON.stringify(output),usage:{input:100,output:100},costUsd:.001,finishReason:'end_turn'},'questionnaire','questionnaire',snapshot,unit);
 assert.equal(result.valid,false);assert.ok(result.feedback.issues.some(i=>i.code==='multiple_reasons'));assert.match(result.feedback.rule,/multiple_reasons/);assert.doesNotMatch(JSON.stringify(result.feedback),/费用偏高或不熟悉租车流程/);
});
