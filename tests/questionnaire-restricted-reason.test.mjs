import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAIQuestionnaire} from '../dist/workspace/questionnaire-model.mjs';
const requirements={outputCount:3,instructions:'了解最近30天共享单车使用频率、使用目的、体验以及未使用原因。'};
const reason={id:'q2',type:'multiple',title:'最近30天内，你没有使用或较少使用共享单车的主要原因有哪些？',options:['附近没有车辆','费用较高','以上都不是（我未使用共享单车没有上述原因）'],required:true};
const screen={id:'q1',type:'single',title:'最近30天内，你使用共享单车的次数？',options:['0次','1至5次','6次以上'],required:true};
const base=(q=reason,s=screen)=>({title:'共享单车调查',introduction:'本问卷匿名自愿参与，请按实际情况填写。',questions:[s,q,{id:'q3',type:'text',title:'其他建议',options:[],required:false}]});
test('mixed screening population can skip a question addressed only to non-users or infrequent users without changing options',()=>{const r=normalizeAIQuestionnaire(base(),requirements);assert.equal(r.questions[1].required,false);assert.match(r.questions[1].title,/不符合本题条件可跳过/);assert.doesNotMatch(r.questions[1].title,/未使用者可跳过/);assert.deepEqual(r.questions[1].options,reason.options);});
test('general reasons asked to all remain required, preserving choices',()=>{const q={...reason,title:'选择共享单车作为出行方式的主要原因有哪些？',options:['方便','价格','其他']};const r=normalizeAIQuestionnaire(base(q),requirements);assert.equal(r.questions[1].required,true);assert.deepEqual(r.questions[1].options,q.options);});
test('an explicit applicable option preserves required question and option text',()=>{const q={...reason,options:['附近没有车辆','费用较高','不适用（我经常使用）']};const r=normalizeAIQuestionnaire(base(q),requirements);assert.equal(r.questions[1].required,true);assert.deepEqual(r.questions[1].options,q.options);});
test('without a mixed-population screening question the specific reason question remains required',()=>{const s={...screen,title:'你是否从未使用共享单车？',options:['从未使用','不愿回答']};const r=normalizeAIQuestionnaire(base(reason,s),requirements);assert.equal(r.questions[1].required,true);assert.deepEqual(r.questions[1].options,reason.options);});

test('a screening question for a different service does not alter the required question',()=>{const s={...screen,title:'最近30天使用健身服务的次数？'};const r=normalizeAIQuestionnaire(base(reason,s),requirements);assert.equal(r.questions[1].required,true);assert.deepEqual(r.questions[1].options,reason.options);});
test('explicitly surveying only non-users preserves the required question',()=>{const r=normalizeAIQuestionnaire(base(),{...requirements,instructions:'仅调查未使用共享单车的人，了解他们没有使用的原因。'});assert.equal(r.questions[1].required,true);assert.deepEqual(r.questions[1].options,reason.options);});

test('an option restricted to non-users does not cover frequent users',()=>{const q={...reason,options:['附近没有车辆','费用较高','不适用（从未使用者未遇到上述情况）']};const r=normalizeAIQuestionnaire(base(q),requirements);assert.equal(r.questions[1].required,false);assert.deepEqual(r.questions[1].options,q.options);});

test('different stated screening periods do not force an inferred branch',()=>{const s={...screen,title:'最近7天内，你使用共享单车的次数？'};const r=normalizeAIQuestionnaire(base(reason,s),requirements);assert.equal(r.questions[1].required,true);});
test('a later screening question cannot establish an earlier branch',()=>{const result=normalizeAIQuestionnaire({title:'调查',introduction:'请按实际情况填写。',questions:[{...reason,id:'q1'},{...screen,id:'q2'},{id:'q3',type:'text',title:'建议',options:[],required:false}]},requirements);assert.equal(result.questions[0].required,true);});

test('different-subject screening cannot trigger the general experience fallback on non-use reasons',()=>{const s={...screen,title:'最近30天使用健身服务的次数？'},q={...reason,title:'最近30天没有使用共享单车的原因？',options:['附近没有车辆','费用较高','其他']};const r=normalizeAIQuestionnaire(base(q,s),{...requirements,instructions:'仅调查未使用共享单车的人'});assert.equal(r.questions[1].required,true);assert.equal(r.questions[1].title,q.title);});
test('internal reference uses actual displayed order and leaves unknown IDs untouched',()=>{const q={...reason,id:'q8',title:'若已在第q2题中选择0次以外的次数，请根据q99中说明作答。'};const r=normalizeAIQuestionnaire(base(q,{...screen,id:'q2'}),requirements);assert.match(r.questions[1].title,/第1题中/);assert.match(r.questions[1].title,/q99中/);});
test('broad college audience gets an other grade choice while explicit restriction does not',()=>{const grade={...screen,title:'你所在的年级是?',options:['大一','大二','大三','大四','研究生及以上']};const r=normalizeAIQuestionnaire(base(reason,grade),{...requirements,instructions:'目标人群：高校学生。'});assert.deepEqual(r.questions[0].options,[...grade.options,'其他']);const limited=normalizeAIQuestionnaire(base(reason,grade),{...requirements,instructions:'目标人群：高校学生；仅限本科生。'});assert.deepEqual(limited.questions[0].options,grade.options);});

test('product model IDs are not mistaken for question references',()=>{for(const title of ['型号 q2 的电池续航如何？','购买 q2 后使用体验如何？']){const q={...reason,id:'q8',title};const r=normalizeAIQuestionnaire(base(q,{...screen,id:'q2'}),requirements);assert.ok(r.questions[1].title.startsWith(title));}});

test('if a known question ID is followed by an explicit answer action it uses actual order',()=>{const q={...reason,id:'q8',title:'如果 q2 选择0次，请填写原因。'};const r=normalizeAIQuestionnaire(base(q,{...screen,id:'q2'}),requirements);assert.match(r.questions[1].title,/如果 第1题 选择/);});
test('year-specific sampling restrictions do not add a broader other category',()=>{const grade={...screen,title:'你所在的年级是?',options:['大一','大二','大三','大四','研究生及以上']};for(const instructions of ['面向大学学生，仅调查大一到大四学生','面向大学学生，问卷只对大三与大四发放']){const r=normalizeAIQuestionnaire(base(reason,grade),{...requirements,instructions});assert.deepEqual(r.questions[0].options,grade.options);}});

test('ambiguous product or software versions with 在...中 are not renumbered',()=>{const title='在q2中使用该软件遇到的问题？';const q={...reason,id:'q8',title};const r=normalizeAIQuestionnaire(base(q,{...screen,id:'q2'}),requirements);assert.ok(r.questions[1].title.startsWith(title));});

test('ambiguous 在q2中 selection remains unchanged without an explicit question label',()=>{const title='若已在q2中选择0次以外的次数，请按实际填写。';const q={...reason,id:'q8',title};const r=normalizeAIQuestionnaire(base(q,{...screen,id:'q2'}),requirements);assert.ok(r.questions[1].title.startsWith(title));});

test('batch references use the global position rather than local batch numbering',()=>{const q={...reason,id:'q12',title:'如果 q11 选择0次，请说明原因。'};const r=normalizeAIQuestionnaire(base(q,{...screen,id:'q11'}),{...requirements,questionStart:11});assert.match(r.questions[1].title,/第11题/);});
