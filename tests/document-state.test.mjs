import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
import {createSession} from '../backend/auth.mjs';
import {thesisDocumentState,workspaceDocumentStates} from '../backend/workspace-document-state.mjs';
import {documentStateLabel,documentStateGroup} from '../dist/workspace/document-state.mjs';
import {workspaceJobStatusLabel} from '../dist/workspace/workspace-job-model.mjs';
import {accountOverviewItems,accountOverviewTasks} from '../dist/workspace/home-account-model.mjs';

async function fixture(t){
 const app=createServer({dbPath:':memory:',config:{agentEnabled:false,aiKey:'',aiURL:'',aiModel:'',mineruEnabled:false}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
 const db=app.db,at='2026-11-03T10:00:00.000Z';
 for(const id of ['owner','other'])db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,id,'user',at);
 db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run('project','owner','Synthetic project','本科','CS',at,at);
 const origin='http://127.0.0.1:'+app.server.address().port,cookie='pk_session='+createSession(db,'owner');
 const api=async(path,body)=>{const response=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{cookie,...(body?{'Content-Type':'application/json',Origin:origin}:{}), 'X-PaperKnow-User':'owner'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
 const response=await fetch(origin+'/api/theses',{method:'POST',headers:{cookie,'Content-Type':'application/json',Origin:origin},body:JSON.stringify({projectId:'project',snapshot:{title:'合成资料的状态验收',profile:{level:'本科',language:'中文',targetWords:500},outline:[{id:'body',title:'第一章 方法',targetWords:500}],materials:[],references:[]}})});
 assert.equal(response.status,201);const paper=(await response.json()).item;
 const getRow=()=>db.prepare('SELECT * FROM theses WHERE id=?').get(paper.id);
 function version(id='body',text='合成正文，仅用于软件状态测试。',n=1){db.prepare('INSERT INTO thesis_chapter_versions(id,thesis_id,chapter_id,version,source,text,source_ids,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id+'-'+n,paper.id,id,n,'manual',text,'[]',at);}
 function run(id,{status='completed',full=false,current=true,purpose}={}){
  db.prepare('INSERT INTO jobs(id,user_id,project_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'owner','project','thesis',status,status,'{}',id,'hash',at,at);
  const row=getRow();db.prepare('INSERT INTO thesis_runs(id,thesis_id,user_id,snapshot,snapshot_hash,plan,settings_version,settings_meta,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,paper.id,'owner',row.snapshot,row.snapshot_hash,'[]','synthetic',JSON.stringify(full?{completion:{scope:'full',baseline:[],...(purpose?{purpose}:{})}}:{}),status,status,at,at);
  if(current)db.prepare('UPDATE theses SET current_run_id=?,status=? WHERE id=?').run(id,status,paper.id);
  return db.prepare('SELECT * FROM thesis_runs WHERE id=?').get(id);
 }
 return {db,api,paper,getRow,run,version};
}

test('a finished thesis execution is not presented as an approved final manuscript on any account list',async t=>{
 const f=await fixture(t);f.version();f.run('current',{full:true});
 const details=(await f.api('/theses/'+f.paper.id)).item;
 assert.notEqual(details.completionReview.status,'ready');assert.notEqual(details.documentState.status,'confirmed');
 assert.notEqual(documentStateLabel(details),'已完成');
 const list=(await f.api('/theses')).items.find(row=>row.id===f.paper.id);
 const project=await f.api('/projects/project'),projectPaper=project.theses.find(row=>row.id===f.paper.id);
 const job=(await f.api('/jobs')).items.find(row=>row.id==='current'),projectJob=project.jobs.find(row=>row.id==='current');
 for(const row of [list,projectPaper,job,projectJob])assert.deepEqual(row.documentState,details.documentState);
 assert.equal(job.status,'completed'); // Execution and billing history remain unchanged.
 assert.equal(documentStateGroup(job),'attention');
 const home=accountOverviewItems({theses:[list]})[0];assert.ok(home.kind.endsWith(documentStateLabel(details)));
 assert.equal(workspaceJobStatusLabel(job),documentStateLabel(details));
 const homeJob=accountOverviewTasks([job])[0];assert.equal(workspaceJobStatusLabel(homeJob),'待检查完善');assert.equal(documentStateGroup(homeJob),'attention');
});

test('full draft generation stays a saved draft while incomplete final checks need attention',async t=>{
 const f=await fixture(t);f.version();f.run('draft-run',{full:true,purpose:'draft'});
 let job=(await f.api('/jobs')).items.find(row=>row.id==='draft-run');
 assert.equal(job.status,'completed');assert.equal(job.documentState.status,'draft_ready');assert.equal(workspaceJobStatusLabel(job),'初稿已保存');assert.equal(workspaceJobStatusLabel(accountOverviewTasks([job])[0]),'初稿已保存');
 f.run('final-run',{full:true,purpose:'completion'});
 f.db.prepare('UPDATE thesis_runs SET quality=? WHERE id=?').run(JSON.stringify({status:'partial',coverage:{complete:false},supplementCheck:{status:'unavailable'}}),'final-run');
 job=(await f.api('/jobs')).items.find(row=>row.id==='final-run');
 assert.equal(job.status,'completed');assert.equal(job.documentState.status,'check_required');assert.equal(documentStateGroup(job),'attention');assert.equal(workspaceJobStatusLabel(job),'待检查完善');assert.equal(workspaceJobStatusLabel(accountOverviewTasks([job])[0]),'待检查完善');
});

test('previous failed jobs are historical and cannot borrow the current successful job state',async t=>{
 const f=await fixture(t);f.version();f.run('old',{status:'failed',current:false});f.run('latest');
 f.db.prepare('UPDATE jobs SET error=? WHERE id=?').run('Agent 执行超时，结果未提交','old');
 const jobs=(await f.api('/jobs')).items,old=jobs.find(row=>row.id==='old'),latest=jobs.find(row=>row.id==='latest');
 assert.equal(old.historical,true);assert.equal(old.currentJobId,'latest');assert.equal(old.documentState,undefined);assert.match(old.error,/超时/);
 assert.equal(latest.historical,false);assert.equal(latest.documentState.status,'draft_ready');
 assert.equal(workspaceJobStatusLabel(latest),'初稿已保存');assert.equal(workspaceJobStatusLabel(old),'失败');
 assert.equal(workspaceDocumentStates(f.db,[{id:'latest',type:'thesis'}],'other')[0].documentState,undefined);
});

test('only current outline chapters and their latest saved versions count as an available draft',async t=>{
 const f=await fixture(t);assert.equal(thesisDocumentState(f.db,f.getRow()).hasDraft,false);
 f.version('removed');assert.equal(thesisDocumentState(f.db,f.getRow()).hasDraft,false);
 f.version();assert.equal(thesisDocumentState(f.db,f.getRow()).status,'draft_ready');
 f.version('body','',2);assert.equal(thesisDocumentState(f.db,f.getRow()).hasDraft,false);
});

test('the legacy failed-job mapping for missing materials displays the precise thesis reason',async t=>{
 const f=await fixture(t);f.version();f.run('needs',{status:'needs_materials',full:true});
 f.db.prepare("UPDATE jobs SET status='failed' WHERE id='needs'").run();
 let job=(await f.api('/jobs')).items.find(row=>row.id==='needs');assert.equal(job.documentState.status,'needs_materials');assert.equal(documentStateGroup(job),'attention');assert.equal(workspaceJobStatusLabel(job),'待补充资料');
 f.db.prepare('UPDATE thesis_runs SET quality=? WHERE id=?').run(JSON.stringify({supplementCheck:{status:'unavailable'}}),'needs');
 job=(await f.api('/jobs')).items.find(row=>row.id==='needs');assert.equal(job.documentState.status,'check_required');assert.equal(workspaceJobStatusLabel(job),'待检查完善');
});

test('review and confirmation states follow the existing completion gate without altering execution or permissions',async t=>{
 const f=await fixture(t);f.version();const run=f.run('final',{full:true});
 for(const [review,status,label]of [['ready','awaiting_confirmation','待确认终稿'],['confirmed','confirmed','终稿已确认'],['needs_materials','needs_materials','待补充资料'],['check_required','check_required','待检查完善']]){
  const state=thesisDocumentState(f.db,f.getRow(),run,{status:review});assert.equal(state.status,status);assert.equal(documentStateLabel({documentState:state}),label);
 }
 f.db.prepare("UPDATE thesis_runs SET status='failed' WHERE id='final'").run();f.db.prepare("UPDATE theses SET status='failed' WHERE id=?").run(f.paper.id);
 assert.equal(thesisDocumentState(f.db,f.getRow()).status,'interrupted');
 f.db.prepare("UPDATE thesis_runs SET status='cancelled' WHERE id='final'").run();f.db.prepare("UPDATE theses SET status='cancelled' WHERE id=?").run(f.paper.id);
 assert.equal(thesisDocumentState(f.db,f.getRow()).status,'cancelled');
 f.db.prepare("UPDATE theses SET status='draft' WHERE id=?").run(f.paper.id);
 assert.equal(thesisDocumentState(f.db,f.getRow()).status,'check_required');
 assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_completion_confirmations').get().n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM billing_reservations').get().n,0);
});

test('a completed writing operation with unresolved material placeholders is listed as needing attention',async t=>{
 const f=await fixture(t),at=new Date().toISOString(),snapshot={title:'Synthetic proposal',materials:[],references:[],outline:[]};
 f.db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('writing-job','owner','writing','completed','completed','{}','writing-job','hash',at,at);
 f.db.prepare('INSERT INTO writing_runs(id,user_id,kind,operation,snapshot,input_hash,client_key,settings_version,status,stage,plan,output,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('writing-job','owner','proposal','draft',JSON.stringify(snapshot),'hash','writing-job','synthetic','completed','completed','[]',JSON.stringify({text:'研究过程【待补充：实际研究记录】'}),at,at);
 const job=(await f.api('/jobs')).items.find(row=>row.id==='writing-job');assert.equal(job.status,'completed');assert.equal(job.documentState.status,'needs_materials');assert.equal(documentStateGroup(job),'attention');
});
