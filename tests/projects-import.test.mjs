import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession} from '../backend/auth.mjs';
import {createWorkspaceService} from '../backend/workspace-service.mjs';

const project=(localId='old-1',extra={})=>({localId,title:'历史研究项目',degree:'硕士',major:'教育学',description:'研究目标\n研究范围',stage:'开题阶段',status:'active',...extra});
async function fixture(t){
 const db=database(':memory:'),api=createAPI(db,{cancel(){}},{getAI:()=>({enabled:false})}),server=http.createServer((req,res)=>void api(req,res));
 for(const id of ['alice','bob'])db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());
 const cookies=Object.fromEntries(['alice','bob'].map(id=>[id,'pk_session='+createSession(db,id)]));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
 const request=async(path,data,{user='alice',owner=user,origin=base,method=data===undefined?'GET':'POST'}={})=>{
  const response=await fetch(base+'/api'+path,{method,headers:{...(user?{Cookie:cookies[user]}:{}),...(owner===undefined?{}:{'X-PaperKnow-User':owner}),...(data===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
  return {status:response.status,value:await response.json()};
 };
 const send=(items,options={})=>request('/projects/import-local',{expectedUserId:options.user||'alice',items},options);
 return {db,request,send};
}

test('explicit historical import keeps source IDs separate from server IDs and retries preserve later edits',async t=>{
 const f=await fixture(t),first=await f.send([project('local-a')]);assert.equal(first.status,200);assert.equal(first.value.imported,1);assert.equal(first.value.reused,0);
 const row=first.value.items[0];assert.equal(row.localId,'local-a');assert.notEqual(row.id,'local-a');assert.equal(row.item.title,'历史研究项目');assert.equal(row.item.version,0);assert.equal(row.imported,true);assert.deepEqual(first.value.mappings,[{localId:'local-a',projectId:row.id}]);
 const edited=await f.request('/projects/'+row.id,{version:0,title:'用户后来修改的名称',description:'新的说明',status:'archived'});assert.equal(edited.status,200);
 const repeat=await f.send([project('local-a',{title:'旧的标题不得覆盖'})]);assert.equal(repeat.status,200);assert.equal(repeat.value.imported,0);assert.equal(repeat.value.reused,1);assert.equal(repeat.value.items[0].id,row.id);assert.equal(repeat.value.items[0].item.title,'用户后来修改的名称');assert.equal(repeat.value.items[0].item.description,'新的说明');assert.equal(repeat.value.items[0].item.status,'archived');assert.equal(repeat.value.items[0].item.version,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM projects').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_project_imports').get().n,1);
});

test('same names do not merge projects and identical legacy IDs remain private to each account',async t=>{
 const f=await fixture(t),alice=await f.send([project('same-id'),project('different-id',{status:'archived'})]),bob=await f.send([project('same-id')],{user:'bob'});
 assert.equal(alice.value.items.length,2);assert.notEqual(alice.value.items[0].id,alice.value.items[1].id);assert.notEqual(alice.value.items[0].id,bob.value.items[0].id);
 assert.equal(alice.value.items[1].item.status,'archived');assert.equal((await f.request('/projects')).value.items.length,2);assert.equal((await f.request('/projects',undefined,{user:'bob'})).value.items.length,1);
 assert.equal((await f.request('/projects/'+alice.value.items[0].id,undefined,{user:'bob'})).status,404);
});

test('simultaneous repeats use one persistent mapping instead of creating duplicate projects',async t=>{
 const f=await fixture(t),responses=await Promise.all([f.send([project('concurrent-local')]),f.send([project('concurrent-local')])]);
 assert.deepEqual(responses.map(row=>row.status),[200,200]);assert.equal(responses[0].value.items[0].id,responses[1].value.items[0].id);assert.equal(responses.reduce((n,row)=>n+row.value.imported,0),1);assert.equal(f.db.prepare('SELECT count(*) n FROM projects').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_project_imports').get().n,1);
});

test('invalid import batches are atomic and reject unexpected authority, malformed IDs and overlong fields',async t=>{
 const f=await fixture(t),badRows=[{...project(),localId:''},{...project(),localId:12},{...project(),localId:'__proto__'},{...project(),localId:'x'.repeat(201)},{...project(),title:'x'.repeat(201)},{...project(),major:'x'.repeat(101)},{...project(),degree:'x'.repeat(21)},{...project(),stage:'x'.repeat(51)},{...project(),description:'x'.repeat(5001)},{...project(),title:'line\nname'},{...project(),status:'deleted'},{...project(),user_id:'bob'}];
 for(const bad of badRows){const response=await f.send([project('valid-first'),bad]);assert.equal(response.status,400);assert.equal(f.db.prepare('SELECT count(*) n FROM projects').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_project_imports').get().n,0);}
 for(const items of [[],null,{},[project('same'),project('same')],Array.from({length:101},(_,n)=>project('id-'+n))])assert.equal((await f.send(items)).status,400);
 const foreignField=await f.request('/projects/import-local',{expectedUserId:'alice',items:[project()],role:'admin'});assert.equal(foreignField.status,400);
});

test('a storage failure rolls back all new projects and mapping rows in the batch',async t=>{
 const f=await fixture(t);f.db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON workspace_project_details WHEN NEW.description='simulate-import-failure' BEGIN SELECT RAISE(ABORT,'simulated'); END");
 const result=await f.send([project('one'),project('two',{description:'simulate-import-failure'})]);assert.equal(result.status,500);assert.equal(f.db.prepare('SELECT count(*) n FROM projects').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_project_imports').get().n,0);
});

test('quota only counts new mappings and rejects a whole batch instead of importing a partial project list',async t=>{
 const f=await fixture(t),existing=await f.send([project('already-imported')]),at=new Date().toISOString();
 const insert=f.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)');f.db.exec('BEGIN');for(let n=0;n<998;n++)insert.run('existing-'+n,'alice','已有项目'+n,'本科','',at,at);f.db.exec('COMMIT');
 const over=await f.send([project('already-imported'),project('new-a'),project('new-b')]);assert.equal(over.status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM projects WHERE user_id=?').get('alice').n,999);assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_project_imports').get().n,1);
 const limit=await f.send([project('already-imported'),project('new-a')]);assert.equal(limit.status,200);assert.equal(limit.value.imported,1);assert.equal(limit.value.reused,1);assert.equal(limit.value.items[0].id,existing.value.items[0].id);
 assert.equal((await f.send([project('already-imported'),project('new-a')])).value.imported,0);assert.equal((await f.send([project('over-limit')])).status,409);
});

test('import requires a matching account and same origin and will not write into a changed session',async t=>{
 const f=await fixture(t),body={expectedUserId:'alice',items:[project()]};
 assert.equal((await f.request('/projects/import-local',body,{user:null,owner:undefined})).status,401);
 assert.equal((await f.request('/projects/import-local',body,{origin:'https://foreign.invalid'})).status,403);
 const stale=await f.request('/projects/import-local',body,{user:'bob',owner:'alice'});assert.equal(stale.status,409);assert.equal(stale.value.code,'ACCOUNT_CHANGED');
 assert.equal((await f.request('/projects/import-local',body,{user:'bob',owner:'bob'})).status,409);
 assert.equal((await f.request('/projects/import-local',{items:[project()]})).status,409);
 assert.equal((await f.request('/projects/import-local')).status,405);assert.equal(f.db.prepare('SELECT count(*) n FROM projects').get().n,0);
});

test('import mappings survive reopening the database and clean up only after explicit empty-project deletion',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'paperknow-project-import-'));t.after(()=>rm(directory,{recursive:true,force:true}));const path=join(directory,'workspace.sqlite');let db=database(path);const at=new Date().toISOString();db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('alice','alice@example.invalid','alice',null,'user',at);
 db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run('existing-before-migration','alice','已有云端项目','本科','',at,at);db.exec('DROP TABLE workspace_project_imports');db.close();db=database(path);assert.equal(db.prepare('SELECT title FROM projects WHERE id=?').get('existing-before-migration').title,'已有云端项目');
 const invoke=async(database)=>createWorkspaceService(database)({path:'/api/projects/import-local',method:'POST',user:{id:'alice'},readBody:async()=>({expectedUserId:'alice',items:[project('persistent-local')]})});
 const first=await invoke(db),id=first.value.items[0].id;db.close();db=database(path);try{const second=await invoke(db);assert.equal(second.value.items[0].id,id);assert.equal(second.value.imported,0);
 // Normal delete semantics permit a later deliberate re-import, while a retry
 // during the lifetime of the same cloud project cannot create a duplicate.
 db.prepare('DELETE FROM workspace_project_details WHERE project_id=?').run(id);db.prepare('DELETE FROM projects WHERE id=?').run(id);assert.equal(db.prepare('SELECT count(*) n FROM workspace_project_imports').get().n,0);
 }finally{db.close();}
});

test('standalone questionnaires are counted, listed and protect their project from deletion without exposing responses',async t=>{
 const f=await fixture(t),one=(await f.send([project('one')])).value.items[0].id,two=(await f.send([project('two')])).value.items[0].id,at=new Date().toISOString();
 const insert=f.db.prepare('INSERT INTO questionnaires VALUES(?,?,?,?,?,?,?)');insert.run('q-owned','alice',one,3,JSON.stringify({title:'独立保存的问卷',questions:[{title:'私人问题'}]}),at,at);insert.run('q-other-project','alice',two,1,JSON.stringify({title:'其他项目问卷'}),at,at);insert.run('q-foreign','bob',one,1,JSON.stringify({title:'其他账户的问卷'}),at,at);
 const list=(await f.request('/projects')).value.items,detail=(await f.request('/projects/'+one)).value;assert.equal(list.find(row=>row.id===one).counts.questionnaires,1);assert.equal(detail.item.counts.questionnaires,1);assert.deepEqual(detail.questionnaires,[{id:'q-owned',projectId:one,title:'独立保存的问卷',version:3,createdAt:at,updatedAt:at}]);assert.doesNotMatch(JSON.stringify(detail.questionnaires),/私人问题|其他账户|content|responses/);
 assert.equal((await f.request('/projects/'+one+'/delete',{version:0})).status,409);assert.equal((await f.request('/projects/'+one,undefined,{user:'bob'})).status,404);
 f.db.prepare('UPDATE questionnaires SET project_id=NULL WHERE project_id=?').run(one);assert.equal((await f.request('/projects/'+one+'/delete',{version:0})).status,200);assert.equal(f.db.prepare('SELECT count(*) n FROM questionnaires').get().n,3);
 f.db.exec('DELETE FROM questionnaires; DROP TABLE questionnaires');const old=(await f.request('/projects/'+two)).value;assert.equal(old.item.counts.questionnaires,0);assert.deepEqual(old.questionnaires,[]);assert.equal((await f.request('/projects/'+two+'/delete',{version:0})).status,200);
});
