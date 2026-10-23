import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {database} from '../backend/database.mjs';
import {normalizeThesisSnapshot,thesisPlan,thesisAgentTask,parseThesisSection,validateThesisCandidate,initializeThesisSchema,assertThesisAccountQuota,thesisWordCount} from '../backend/thesis-model.mjs';

const figure=()=>({id:'flow',title:'拟开展的研究流程',kind:'flowchart',nodes:[{id:'plan',label:'界定问题'},{id:'verify',label:'拟收集证据后验证'}],edges:[{from:'plan',to:'verify',label:'建议步骤'}],caption:'本图为拟开展方案，不表示研究已经实施。'});
const source={id:'evidence',name:'研究条件说明',text:'用户说明本次研究尚处于方案阶段，只提供问题定义和可用条件。没有进行实验、收集统计数据或验证任何效果。允许将拟开展的问题界定、证据收集与后续验证步骤整理为方案示意，但不得把计划描述为完成的实验或实测结果。'.repeat(2),confirmed:true};
function fixture({presentation={image:true},mode='rich',target=500,sections,chapters}={}){
 const snapshot=normalizeThesisSnapshot({title:'结构化插图与研究证据',profile:{level:'本科',language:'中文',targetWords:target},requirements:{contentMode:mode},materials:[source],references:[],outline:chapters||[{id:'chapter',title:'研究设计',targetWords:target,presentation,...(sections?{sections}:{})}]});
 return {snapshot,plan:thesisPlan(snapshot)};
}
function candidate(unit,{figures=[figure()],block='\n[figure:flow]\n',draft=false,...rest}={}){
 const gap=draft?'【待核对：本节为拟开展方案，仍需真实来源与研究信息】':'',length=thesisWordCount(block+gap,'中文');
 return {text:'研'.repeat(Math.max(0,unit.targetWords-length))+gap+block+'[source:evidence]',source_ids:['evidence'],missing_evidence:draft?['拟开展方案需要补充实际验证资料']:[],draft,complete:true,figures,...rest};
}
const response=body=>({text:JSON.stringify(body),trace:[{tool:'read_material',status:'completed',materialId:'evidence'}]});

test('image permission persists only when provided and is disabled in plain text and reference chapters',()=>{
 const {snapshot,plan}=fixture();assert.equal(snapshot.outline[0].presentation.image,true);assert.equal(plan[0].presentation.image,true);
 const legacy=fixture({presentation:{table:true}});assert.equal(Object.hasOwn(legacy.snapshot.outline[0].presentation,'image'),false);assert.equal(Object.hasOwn(legacy.plan[0].presentation,'image'),false);
 assert.equal(fixture({presentation:{image:false}}).plan[0].presentation.image,false);
 assert.equal(fixture({mode:'text'}).plan[0].presentation.image,false);
 const refs=fixture({chapters:[{id:'c',title:'研究设计',targetWords:500},{id:'r',title:'参考文献',presentation:{image:true}}]});assert.equal(refs.snapshot.outline[1].presentation.image,false);assert.ok(refs.plan.every(row=>row.chapterId!=='r'));
 for(const presentation of [{image:'true'},{image:1},{image:null},{image:true,url:'https://example.test/x.png'}])assert.throws(()=>fixture({presentation}),error=>error.status===400);
});

test('same-call structured figure is validated, namespaced and excluded from Chinese and English body counts',()=>{
 for(const language of ['中文','English']){
  const {snapshot,plan:[unit]}=fixture();snapshot.profile.language=language;
  const body=candidate(unit);if(language==='English')body.text='research '.repeat(unit.targetWords)+'\n[figure:flow]\n[source:evidence]';
  const before=structuredClone(body),parsed=parseThesisSection(response(body),snapshot,unit);
  assert.equal(parsed.wordCount,500);assert.equal(parsed.figures.length,1);assert.match(parsed.figures[0].id,/^fig-[a-f0-9]{20}$/);assert.ok(parsed.text.includes(`[figure:${parsed.figures[0].id}]`));assert.equal(parsed.text.includes('[figure:flow]'),false);
  assert.deepEqual(parsed.figures[0].nodes,body.figures[0].nodes);assert.deepEqual(body,before);
  assert.deepEqual(parseThesisSection(response(body),snapshot,unit),parsed);assert.equal(validateThesisCandidate(response(body),snapshot,unit).valid,true);
 }
});

test('namespaced figure IDs differ for different units and changed figure content, preserving history identity',()=>{
 const {snapshot,plan:[unit]}=fixture(),body=candidate(unit),first=parseThesisSection(response(body),snapshot,unit);
 assert.notEqual(parseThesisSection(response(body),snapshot,{...unit,id:'another-unit'}).figures[0].id,first.figures[0].id);
 const changed=structuredClone(body);changed.figures[0].nodes[0].label='重新界定研究问题';assert.notEqual(parseThesisSection(response(changed),snapshot,unit).figures[0].id,first.figures[0].id);
});

test('image permission never leaks from parent chapters or siblings and split units only allow one figure on their first part',()=>{
 const {snapshot,plan}=fixture({target:4000,presentation:{image:true},sections:[{id:'selected',title:'研究步骤',targetWords:3000,presentation:{image:true}},{id:'plain',title:'研究局限',targetWords:1000}]});
 assert.equal(plan.length,3);assert.equal(thesisAgentTask(snapshot,plan[0],[]).context.figureContract.allowed,true);
 for(const unit of plan.slice(1)){
  assert.equal(thesisAgentTask(snapshot,unit,[]).context.figureContract.allowed,false);
  assert.throws(()=>parseThesisSection(response(candidate(unit)),snapshot,unit),error=>error.code==='presentation_not_selected');
 }
 assert.equal(parseThesisSection(response(candidate(plan[0])),snapshot,plan[0]).figures.length,1);
});

test('selected image remains optional and legacy candidates do not gain new requirements',()=>{
 const {snapshot,plan:[unit]}=fixture();
 for(const figs of [[],undefined]){const body=candidate(unit,{figures:figs,block:''});if(figs===undefined)delete body.figures;assert.deepEqual(parseThesisSection(response(body),snapshot,unit).figures,[]);}
 const legacy=fixture({presentation:undefined});assert.deepEqual(parseThesisSection(response(candidate(legacy.plan[0],{figures:[],block:''})),legacy.snapshot,legacy.plan[0]).figures,[]);
});

test('markers must be complete, standalone and one-to-one, with no markers inside code blocks',()=>{
 const {snapshot,plan:[unit]}=fixture({presentation:{image:true,code:true}});
 for(const block of ['\n[figure:unknown]\n','\n[figure:flow]\n[figure:flow]\n','\n正文[figure:flow]\n','\n[figure:flow\n','\n[FIGURE:flow]\n','\n[figure]\n','\n```txt\n[figure:flow]\n```\n','']){
  const body=candidate(unit,{block});assert.throws(()=>parseThesisSection(response(body),snapshot,unit),error=>error.code==='invalid_figure',block);
 }
 assert.throws(()=>parseThesisSection(response(candidate(unit,{figures:[],block:'\n[figure:flow]\n'})),snapshot,unit),error=>error.code==='invalid_figure');
});

test('figures reject oversized or malformed payloads, unknown fields, links, executable markup and forged sources',()=>{
 const {snapshot,plan:[unit]}=fixture();
 const invalid=[null,{},[figure(),{...figure(),id:'another'}],[{...figure(),url:'https://example.test/fake.png'}],[{...figure(),kind:'chart'}],[{...figure(),nodes:[{id:'plan',label:'only one'}]}],[{...figure(),nodes:[{id:'a',label:'A'},{id:'a',label:'B'}]}],[{...figure(),edges:[{from:'plan',to:'unknown'}]}],[{...figure(),edges:[{from:'plan',to:'plan'}]}],[{...figure(),nodes:[{id:'a',label:'x'.repeat(81)},{id:'b',label:'B'}]}],[{...figure(),caption:'[source:invented]'}],[{...figure(),caption:'https://example.test/fake'}],[{...figure(),caption:'<svg onload="alert(1)">'}],[{...figure(),nodes:[{id:'a',label:'javascript:alert(1)'},{id:'b',label:'B'}]}]];
 for(const figures of invalid)assert.throws(()=>parseThesisSection(response(candidate(unit,{figures})),snapshot,unit),error=>error.code==='invalid_figure');
});

test('external and raw images remain rejected even with all four formats enabled',()=>{
 const {snapshot,plan:[unit]}=fixture({presentation:{table:true,image:true,formula:true,code:true}});
 for(const block of ['\n![diagram](https://example.test/fake.png)\n','\n![diagram][source]\n','\n![diagram]\n\n[diagram]: https://example.test/fake.png\n','\n<svg><script>alert(1)</script></svg>\n','\n<picture><source srcset="https://example.test/fake.png"></picture>\n','\n<iframe src="https://example.test/"></iframe>\n'])assert.throws(()=>parseThesisSection(response(candidate(unit,{figures:[],block})),snapshot,unit),error=>error.code==='unsupported_image');
});

test('four-format output keeps actual source reads and visible draft evidence gates unchanged',()=>{
 const {snapshot,plan:[unit]}=fixture({presentation:{table:true,image:true,formula:true,code:true}});
 const block='\n| 项目 | 计划 |\n| --- | --- |\n| 研究 | 拟验证 |\n\n$$x=a/b$$\n\n```python\n# 待核对示例，不执行\nvalue = a / b\n```\n\n[figure:flow]\n';
 const good=response(candidate(unit,{block,draft:true})),parsed=parseThesisSection(good,snapshot,unit);assert.equal(parsed.wordCount,500);assert.equal(parsed.figures.length,1);assert.equal(parsed.draft,true);
 assert.throws(()=>parseThesisSection({...good,trace:[]},snapshot,unit),error=>error.code==='unread_source');
 const body=JSON.parse(good.text);body.text=body.text.replace('[source:evidence]','[source:invented]');assert.throws(()=>parseThesisSection(response(body),snapshot,unit),error=>error.code==='unknown_source');
 const missing=JSON.parse(good.text);missing.draft=false;assert.throws(()=>parseThesisSection(response(missing),snapshot,unit),error=>error.code==='needs_materials');
 const undisclosed=JSON.parse(good.text);undisclosed.text=undisclosed.text.replace(/【待核对：[^】]+】/,'');assert.throws(()=>parseThesisSection(response(undisclosed),snapshot,unit),error=>error.code==='draft_disclosure_missing');
});

test('model prompt scopes same-call figures to current unit and retains factual data limits',()=>{
 const {snapshot,plan:[unit]}=fixture(),task=thesisAgentTask(snapshot,unit,[]);
 assert.equal(task.context.figureContract.source,'structured_diagram');assert.equal(task.context.figureContract.maxFigures,1);assert.match(task.instructions,/figures/);assert.match(task.instructions,/本次同一份 JSON/);assert.match(task.instructions,/实测数值必须来自已读取/);assert.match(task.instructions,/不执行/);assert.match(task.instructions,/不生成统计图、实验影像/);assert.match(task.context.lengthBudget.excluded,/插图位置标记/);
 const later=thesisAgentTask(snapshot,{...unit,part:2},[]);assert.equal(later.context.figureContract.maxFigures,0);assert.match(later.instructions,/本单元不允许插图/);
});

test('figures schema migration is repeatable and retains existing chapter and checkpoint text',t=>{
 const db=database(':memory:');t.after(()=>db.close());initializeThesisSchema(db);
 db.exec("PRAGMA foreign_keys=OFF; ALTER TABLE thesis_checkpoints DROP COLUMN figures; ALTER TABLE thesis_chapter_versions DROP COLUMN figures;");
 db.prepare('INSERT INTO thesis_checkpoints(run_id,unit_id,chapter_id,position,text,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('run','unit','chapter',0,'已有小节正文','2026-10-24','2026-10-24');
 db.prepare('INSERT INTO thesis_chapter_versions(id,thesis_id,chapter_id,version,source,text,created_at) VALUES(?,?,?,?,?,?,?)').run('version','thesis','chapter',1,'manual','已有历史正文','2026-10-24');
 initializeThesisSchema(db);
 assert.deepEqual({...db.prepare('SELECT text,figures FROM thesis_checkpoints').get()},{text:'已有小节正文',figures:'[]'});
 assert.deepEqual({...db.prepare('SELECT text,figures FROM thesis_chapter_versions').get()},{text:'已有历史正文',figures:'[]'});
 for(const table of ['thesis_checkpoints','thesis_chapter_versions']){const columns=db.prepare(`PRAGMA table_info(${table})`).all();assert.equal(columns.filter(row=>row.name==='figures').length,1);assert.equal(columns.find(row=>row.name==='figures').dflt_value,"'[]'");}
 initializeThesisSchema(db);for(const table of ['thesis_checkpoints','thesis_chapter_versions'])assert.equal(db.prepare(`PRAGMA table_info(${table})`).all().filter(row=>row.name==='figures').length,1);
});

test('figure JSON is counted in account storage for versions and checkpoints without touching other owners',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE workspace_drafts(user_id TEXT,bytes INTEGER); CREATE TABLE theses(id TEXT,user_id TEXT,snapshot TEXT); CREATE TABLE thesis_runs(id TEXT,user_id TEXT,snapshot TEXT,plan TEXT); CREATE TABLE thesis_chapter_versions(thesis_id TEXT,text TEXT,figures TEXT); CREATE TABLE thesis_checkpoints(run_id TEXT,text TEXT,trace TEXT,missing_evidence TEXT,figures TEXT); CREATE TABLE thesis_commands(user_id TEXT); CREATE TABLE thesis_outline_runs(user_id TEXT,snapshot TEXT,output TEXT);`);
 db.prepare('INSERT INTO theses VALUES(?,?,?)').run('thesis','owner','{}');db.prepare('INSERT INTO theses VALUES(?,?,?)').run('foreign','other','{}');
 db.prepare('INSERT INTO thesis_runs VALUES(?,?,?,?)').run('run','owner','{}','[]');
 const config={thesisAccountStorageBytes:2100};assert.doesNotThrow(()=>assertThesisAccountQuota(db,'owner',1,config));
 db.prepare('INSERT INTO thesis_chapter_versions VALUES(?,?,?)').run('foreign','text','x'.repeat(4000));assert.doesNotThrow(()=>assertThesisAccountQuota(db,'owner',1,config));
 for(const table of ['thesis_chapter_versions','thesis_checkpoints']){
  if(table==='thesis_chapter_versions')db.prepare('INSERT INTO thesis_chapter_versions VALUES(?,?,?)').run('thesis','text','x'.repeat(1100));else db.prepare('INSERT INTO thesis_checkpoints VALUES(?,?,?,?,?)').run('run','text','[]','[]','x'.repeat(1100));
  assert.throws(()=>assertThesisAccountQuota(db,'owner',1,config),error=>error.code==='storage_limit');db.exec(`DELETE FROM ${table}`);
 }
});
