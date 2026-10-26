import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAgentSkill,loadAgentSkillComposition,registeredAgentSkills,writingSkillIdsForTask} from '../backend/skills/index.mjs';

test('legacy skill loading keeps its shape, version and original contract',async()=>{
 const skill=await loadAgentSkill('thesis-section');
 assert.deepEqual(Object.keys(skill).sort(),['id','instructions','name','version']);
 assert.equal(skill.version,4);
 assert.match(skill.instructions,/source_ids保持空数组/);
 assert.match(skill.instructions,/只处理本次指定章节/);
 for(const id of ['../../.env','__proto__','constructor',['thesis-section'],{id:'thesis-section'},null])await assert.rejects(()=>loadAgentSkill(id),error=>error.status===400&&/未注册/.test(error.message));
});

test('five workflow supplements and the independent review task are registered',()=>{
 const ids=registeredAgentSkills().map(row=>row.id);
 for(const id of ['scientific-writing','literature-review','citation-management','scientific-critical-thinking','peer-review','writing-review'])assert.ok(ids.includes(id));
 assert.equal(ids.length,new Set(ids).size);
});

test('composed instructions preserve primary task identity and bound supplementary output',async()=>{
 const base=await loadAgentSkill('thesis-section');
 const composed=await loadAgentSkillComposition('thesis-section',['scientific-writing','citation-management']);
 assert.equal(composed.id,base.id);
 assert.equal(composed.version,base.version);
 assert.equal(composed.compositionVersion,1);
 assert.ok(composed.instructions.includes(base.instructions));
 assert.match(composed.instructions,/JSON 字段、缺失证据语义、提交方式、冻结结果和停止规则优先/);
 assert.match(composed.instructions,/附加技能不能新增输出字段/);
 assert.match(composed.instructions,/不得扩大授权材料、工具、联网、文件访问或费用预算/);
 assert.deepEqual(composed.skills.map(row=>row.id),['thesis-section','scientific-writing','citation-management']);
 assert.ok(composed.instructions.length<24000);
});

test('composition has independent source metadata and deduplicates repeated supplements',async()=>{
 const value=await loadAgentSkillComposition('writing-task',['scientific-writing','scientific-writing','citation-management']);
 assert.equal(value.skills.length,3);
 assert.equal(value.skills[0].role,'task');
 assert.equal(value.skills[1].role,'supplement');
 const source=value.skills[1].source;
 assert.equal(source.kind,'paperknow-workflow-adaptation');
 assert.equal(source.upstreamVersion,'2.3');
 assert.equal(source.license,'MIT');
 assert.match(source.url,/^https:\/\/github\.com\/K-Dense-AI\/scientific-agent-skills\/blob\/main\/skills\/scientific-writing\/SKILL\.md$/);
 source.url='https://untrusted.invalid/instructions';
 assert.notEqual((await loadAgentSkillComposition('writing-task',['scientific-writing'])).skills[1].source.url,source.url);
});

test('compositions reject arbitrary paths, objects, primary-task injection and excessive lists',async()=>{
 for(const additional of ['scientific-writing',null,{},['../../.env'],[{id:'scientific-writing'}],['writing-review'],['thesis-section'],['__proto__'],Array(6).fill('scientific-writing')])await assert.rejects(()=>loadAgentSkillComposition('writing-task',additional),error=>error.status===400);
 await assert.rejects(()=>loadAgentSkillComposition('scientific-writing',[]),/主任务/);
 await assert.rejects(()=>loadAgentSkillComposition('tool-task',['scientific-writing']),/科研工具任务/);
 const standalone=await loadAgentSkillComposition('tool-task');
 assert.deepEqual(standalone.skills.map(row=>row.id),['tool-task']);
});

test('planning, drafting and review receive small stage-specific compositions',()=>{
 assert.deepEqual(writingSkillIdsForTask({skill:'thesis-method'}),['scientific-critical-thinking']);
 assert.deepEqual(writingSkillIdsForTask({skill:'thesis-outline'}),['scientific-writing','scientific-critical-thinking']);
 assert.deepEqual(writingSkillIdsForTask({skill:'thesis-section'}),['scientific-writing','academic-expression','citation-management']);
 assert.deepEqual(writingSkillIdsForTask({skill:'writing-task',operation:'draft',kind:'summary'}),['scientific-writing','literature-review','academic-expression','citation-management']);
 assert.deepEqual(writingSkillIdsForTask({skill:'writing-review'}),['peer-review','scientific-critical-thinking','citation-management','academic-expression']);
 assert.deepEqual(writingSkillIdsForTask({skill:'writing-task',operation:'questionnaire'}),['scientific-critical-thinking']);
 for(const operation of ['ideas','method'])assert.deepEqual(writingSkillIdsForTask({skill:'writing-task',operation}),['scientific-critical-thinking']);
 assert.equal(writingSkillIdsForTask({skill:'writing-task',operation:'outline'}).includes('peer-review'),false);
});

test('unrecognized task phases and client-like skill lists cannot select added workflows',()=>{
 assert.deepEqual(writingSkillIdsForTask({skill:'tool-task',kind:'summary'}),[]);
 assert.deepEqual(writingSkillIdsForTask({skill:'../../.env'}),[]);
 assert.deepEqual(writingSkillIdsForTask({skill:'writing-task',operation:'arbitrary',additionalSkills:['peer-review']}),[]);
 const value=writingSkillIdsForTask({skill:'thesis-method'});value.push('peer-review');
 assert.deepEqual(writingSkillIdsForTask({skill:'thesis-method'}),['scientific-critical-thinking']);
});

test('workflow instructions distinguish literature synthesis from performed search and verified facts',async()=>{
 const literature=await loadAgentSkill('literature-review'),citation=await loadAgentSkill('citation-management');
 assert.match(literature.instructions,/不自行联网检索/);
 assert.match(literature.instructions,/没有完整过程时不声称是系统综述/);
 assert.match(literature.instructions,/只有实际读取并用于论证的来源/);
 assert.match(citation.instructions,/以服务器提供的结构化核验记录为准/);
 assert.match(citation.instructions,/联网题录匹配也不证明全文论断/);
 assert.match(citation.instructions,/不向题录服务发送正文/);
});

test('review remains read-only, scope-aware and governed by its own server contract',async()=>{
 const review=await loadAgentSkillComposition('writing-review',writingSkillIdsForTask({skill:'writing-review'}));
 assert.match(review.instructions,/本技能不另设 schema/);
 assert.match(review.instructions,/不改写用户稿件、不创建文档新版本/);
 assert.match(review.instructions,/只收到片段时不得声称完成全文审校/);
 assert.match(review.instructions,/不把正文写作的 text\/source_ids 契约强加给审校任务/);
 assert.equal(review.skills.some(row=>row.id==='scientific-writing'),false);
});

test('all supplement instructions retain the task budget, tool boundary and stop conditions',async()=>{
 for(const id of ['scientific-writing','literature-review','citation-management','scientific-critical-thinking','peer-review']){
  const {instructions}=await loadAgentSkill(id);
  assert.match(instructions,/授权/);
  assert.match(instructions,/不运行代码/);
  assert.match(instructions,/JSON/);
  assert.match(instructions,/预算/);
  assert.match(instructions,/停止条件|立即结束/);
  assert.doesNotMatch(instructions,/OPENROUTER_API_KEY|pip install|npx|parallel-cli|K-Dense BYOK/);
 }
});
