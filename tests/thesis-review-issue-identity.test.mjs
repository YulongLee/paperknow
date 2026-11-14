import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {thesisReviewIssueIdentities} from '../backend/thesis-review-issue-identity.mjs';

test('receipt foreign keys cascade when a run is cleaned up',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE jobs(id TEXT PRIMARY KEY);');
  db.exec(readFileSync(new URL('../backend/thesis-schema.sql',import.meta.url),'utf8'));
  const fks=db.prepare('PRAGMA foreign_key_list(thesis_review_issue_receipts)').all();assert.deepEqual(fks.map(f=>f.on_delete),['CASCADE','CASCADE','CASCADE']);
  db.exec("INSERT INTO users VALUES('u'); INSERT INTO jobs VALUES('r'); INSERT INTO theses(id,user_id,title,snapshot,snapshot_hash,input_hash,created_at,updated_at) VALUES('t','u','x','{}','s','i','now','now'); INSERT INTO thesis_runs(id,thesis_id,user_id,snapshot,snapshot_hash,plan,settings_version,settings_meta,status,stage,created_at,updated_at) VALUES('r','t','u','{}','s','{}','v','{}','completed','done','now','now'); INSERT INTO thesis_review_issue_receipts VALUES('t','u','r','i','b','now'); DELETE FROM thesis_runs WHERE id='r';");
  assert.equal(db.prepare('SELECT count(*) n FROM thesis_review_issue_receipts').get().n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
const fixture=()=>({row:{id:'thesis',user_id:'owner',current_run_id:'run',snapshot_hash:'snapshot',export_metadata:'cover',export_template:'template'},run:{id:'run',user_id:'owner',thesis_id:'thesis',status:'completed',snapshot_hash:'snapshot',quality:'full report'},saved:[{id:'c1',record:{id:'v1',text:'这是需要核对的具体论文原句。其他文字。'}}],quality:{coverage:{complete:true},consistency:{findings:[{sectionId:'c1',quote:'需要核对的具体论文原句',offset:2,category:'source_support',severity:'warning',explanation:'请核对来源。'}]},reviews:[]},current:true});
const items=value=>thesisReviewIssueIdentities(value);
test('issues are stable, unique and never authorise confirmation',()=>{
 const f=fixture(),result=items(f);assert.equal(result.length,1);assert.deepEqual(items(f),result);assert.match(result[0].id,/^[a-f0-9]{64}$/);assert.equal(result[0].confirmable,false);assert.equal(result[0].chapterVersionId,'v1');assert.equal(result[0].offset,2);
});
test('each owner and document or evidence change invalidates the previous identity',()=>{
 const f=fixture(),base=items(f)[0].id;
 for(const mutate of [x=>{x.row.user_id=x.run.user_id='other';},x=>{x.row.id=x.run.thesis_id='other';},x=>{x.row.current_run_id=x.run.id='other';},x=>{x.row.snapshot_hash=x.run.snapshot_hash='changed evidence';},x=>{x.saved[0].record.id='v2';},x=>{x.saved[0].record.text+='新增正文';},x=>{x.row.export_metadata='new cover';},x=>{x.row.export_template='new template';},x=>{x.run.quality='updated report';}]){const changed=structuredClone(f);mutate(changed);assert.notEqual(items(changed)[0].id,base);}
});
test('stale, wrong-owner, ambiguous or unlocatable issues never receive identities',()=>{
 const f=fixture();for(const mutate of [x=>{x.current=false;},x=>{x.run.user_id='other';},x=>{x.run.thesis_id='other';},x=>{x.run.id='other';},x=>{x.run.status='running';},x=>{x.run.snapshot_hash='stale';},x=>{x.quality.coverage.complete=false;},x=>{x.quality.consistency.findings[0].offset=0;},x=>{x.saved[0].record.text+='需要核对的具体论文原句';},x=>{x.quality.consistency.findings[0].quote='不存在的原句';},x=>{x.saved.push(structuredClone(x.saved[0]));}]){const changed=structuredClone(f);mutate(changed);assert.deepEqual(items(changed),[]);}
});
