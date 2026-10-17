import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {thesisSnapshotFromDraft} from '../dist/workspace/writing-model.mjs';
import {normalizeThesisSnapshot,thesisPlan,selectThesisEvidence,thesisAgentTask,parseThesisSection,thesisManualSourceIds,assertThesisAccountQuota} from '../backend/thesis-model.mjs';
import {thesisOutlineTask} from '../backend/thesis-outline-model.mjs';

const proposal={text:'拟结合用户实际可获得的资料开展案例分析，样本与执行条件待用户确认。',jobId:'method-job-1',model:'configured-model',generatedAt:'2026-10-17T00:00:00Z'};
const draft=(extra={})=>({title:'城市通勤的影响因素研究',degree:'本科',targetWords:500,method:'',outlineRows:[{id:'intro',title:'研究背景',level:1,words:250},{id:'design',title:'拟开展的研究方法',level:1,words:250}],methodSuggestion:{...proposal},...extra});
const snapshot=(extra={})=>normalizeThesisSnapshot(thesisSnapshotFromDraft(draft(extra)));

test('edited AI method advice stays a proposed requirement and never becomes a confirmed material',()=>{
 const value=thesisSnapshotFromDraft(draft({material:'用户手动填写的真实研究条件说明。',methodSuggestion:{...proposal,text:'用户修改后的拟开展访谈方案，尚未实施。'}}));
 assert.deepEqual(value.requirements.researchPlan,{text:'用户修改后的拟开展访谈方案，尚未实施。',origin:'ai',status:'proposed',jobId:'method-job-1'});
 assert.equal(value.materials.length,1);
 assert.equal(value.materials[0].text,'用户手动填写的真实研究条件说明。');
 assert.equal(value.materials[0].confirmed,true);
 assert.equal(value.profile.method,'');
 assert.equal(value.materials.some(row=>row.text.includes('访谈方案')),false);
 assert.equal(value.references.length,0);
});

test('a method proposal alone cannot bootstrap real-evidence admission',()=>{
 const value=snapshot();
 assert.equal(value.materials.length,0);
 assert.deepEqual(selectThesisEvidence(value,{chapterTitle:'研究方法',title:'拟开展的方法'}).sources,[]);
 assert.throws(()=>thesisPlan(value),/确认至少一份含正文/);
 const task=thesisOutlineTask(value);
 assert.deepEqual(task.context.requirements.researchPlan,value.requirements.researchPlan);
 assert.equal(task.materials.length,0);
 assert.equal(task.context.confirmedReferences.length,0);
});

test('a proposal informs method prose without entering source selection or citations',()=>{
 const value=snapshot({knowledgeFiles:[{id:'real-condition',name:'真实条件说明',text:'用户提供的现有资料范围与条件，尚未形成实证结果。'}]});
 const unit=thesisPlan(value)[1],task=thesisAgentTask(value,unit,[]);
 assert.equal(task.context.requirements.researchPlan.text,proposal.text);
 assert.match(task.instructions,/requirements\.researchPlan.*拟开展研究方案/);
 assert.match(task.instructions,/不属于 confirmedSources/);
 assert.match(task.instructions,/结果、实验、访谈、统计章节若缺真实数据必须停止/);
 assert.equal(task.materials.length,1);
 assert.equal(task.materials.some(row=>row.id===proposal.jobId),false);
 assert.equal(task.context.confirmedSources.some(row=>row.id===proposal.jobId),false);
 assert.deepEqual(thesisManualSourceIds('[source:method-job-1]',value),[]);
 const fabricated={text:JSON.stringify({text:'待用户确认的研究方案。'.repeat(60)+'[source:method-job-1]',source_ids:['method-job-1'],missing_evidence:[],complete:true}),trace:[{tool:'read_material',status:'completed',materialId:'method-job-1'}]};
 assert.throws(()=>parseThesisSection(fabricated,value,unit),error=>error.code==='unknown_source');
});

test('client metadata cannot promote edited AI advice to a completed or verified study',()=>{
 const input=thesisSnapshotFromDraft(draft());
 input.requirements.researchPlan={text:proposal.text,jobId:proposal.jobId,origin:'user_verified',status:'completed',confirmed:true};
 const value=normalizeThesisSnapshot(input);
 assert.deepEqual(value.requirements.researchPlan,{text:proposal.text,origin:'ai',status:'proposed',jobId:proposal.jobId});
 assert.throws(()=>normalizeThesisSnapshot({...input,outline:[{id:'one',title:'研究方法',sourceIds:[proposal.jobId]}]}),/只能分配已确认/);
});

test('method advice enforces its independent length and shape limits without changing legacy snapshots',()=>{
 assert.throws(()=>thesisSnapshotFromDraft(draft({methodSuggestion:{text:'字'.repeat(12001)}})),/12,000/);
 const input=thesisSnapshotFromDraft(draft());
 for(const researchPlan of ['拟开展的方案',{text:'字'.repeat(12001)},{text:'   '},{text:proposal.text,jobId:'x'.repeat(101)}]){
  assert.throws(()=>normalizeThesisSnapshot({...input,requirements:{researchPlan}}),error=>error.status===400);
 }
 const legacy=thesisSnapshotFromDraft(draft({methodSuggestion:undefined}));
 assert.equal(Object.hasOwn(legacy.requirements,'researchPlan'),false);
 assert.equal(Object.hasOwn(normalizeThesisSnapshot(legacy).requirements,'researchPlan'),false);
});

test('method histories count toward the owner storage quota while legacy schema remains readable',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`
 CREATE TABLE workspace_drafts(user_id TEXT,bytes INTEGER);
 CREATE TABLE theses(id TEXT,user_id TEXT,snapshot TEXT);
 CREATE TABLE thesis_runs(id TEXT,user_id TEXT,snapshot TEXT,plan TEXT);
 CREATE TABLE thesis_chapter_versions(thesis_id TEXT,text TEXT);
 CREATE TABLE thesis_checkpoints(run_id TEXT,text TEXT,trace TEXT);
 CREATE TABLE thesis_commands(user_id TEXT);
 CREATE TABLE thesis_outline_runs(user_id TEXT,snapshot TEXT,output TEXT);
 `);
 const config={thesisAccountStorageBytes:1500};
 assert.doesNotThrow(()=>assertThesisAccountQuota(db,'owner',512,config));
 db.exec('CREATE TABLE thesis_method_runs(user_id TEXT,snapshot TEXT,output TEXT)');
 db.prepare('INSERT INTO thesis_method_runs VALUES(?,?,?)').run('other','x'.repeat(3000),'other account output');
 assert.doesNotThrow(()=>assertThesisAccountQuota(db,'owner',512,config));
 db.prepare('INSERT INTO thesis_method_runs VALUES(?,?,?)').run('owner','x'.repeat(1100),null);
 assert.throws(()=>assertThesisAccountQuota(db,'owner',1,config),error=>error.code==='storage_limit');
});
