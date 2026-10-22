import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {digest} from '../backend/auth.mjs';
import {createThesisService} from '../backend/thesis-service.mjs';
import {createFileService} from '../backend/file-service.mjs';
import {initializeThesisSchema} from '../backend/thesis-model.mjs';

const snapshot=()=>({title:'合成论文模板测试',profile:{level:'本科',language:'中文',targetWords:500},requirements:{format:'历史学校格式规范.docx'},outline:[{id:'chapter-1',title:'研究背景',targetWords:500}],bodySections:[{id:'chapter-1',title:'研究背景',text:'保留用户已经写好的正文。'}]});
const templateProfile=()=>({version:1,rules:{body:{eastAsiaFont:'仿宋',size:12},margins:{left:3}},recognized:['正文东亚字体','左页边距'],warnings:['封面仍需核对'],summary:['正文字体：仿宋','左页边距：3cm']});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(t,extra={}){
 const db=database(':memory:'),user={id:'alice'},other={id:'bob'},objects=new Map(),calls=[];
 for(const person of [user,other])db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(person.id,person.id,'user',new Date().toISOString());
 const config={requireRemoteStorage:true,storage:{provider:'aliyun_oss',bucket:'private-test',async read(row){calls.push({read:row.id,owner:row.user_id});if(!objects.has(row.id))throw Error('private storage unavailable');return objects.get(row.id);},async remove(row){objects.delete(row.id);}},inspectThesisDocxTemplate:async bytes=>{calls.push({inspect:Buffer.from(bytes).toString()});return templateProfile();},...extra};
 const service=createThesisService(db,config),fileService=createFileService(db,config);
 async function request(path,method='GET',body,person=user){return (await service.handle({path,method,user:person,readBody:async()=>body}))?.value;}
 async function create(extraBody={}){return (await request('/api/theses','POST',{snapshot:snapshot(),clientKey:randomUUID(),...extraBody})).item;}
 function seed(id,{owner=user.id,kind='docx',data=Buffer.from('PK synthetic template '+id),bytes=data.length,sha=digest(data),provider='aliyun_oss'}={}){
  db.prepare('INSERT INTO files(id,user_id,name,kind,bytes,sha256,body,created_at,storage_provider,storage_key,storage_bucket) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,'学校-'+id+'.'+kind,kind,bytes,sha,provider==='aliyun_oss'?Buffer.alloc(0):data,new Date().toISOString(),provider,'private-key-never-disclose/'+id,'private-test');objects.set(id,data);return {id,sha256:sha};
 }
 async function set(item,templateFileId){return (await request(`/api/theses/${item.id}/export-template`,'POST',{version:item.version,templateFileId})).item;}
 async function remove(file){return (await fileService({path:`/api/files/${file.id}/delete`,method:'POST',user,readBody:async()=>({expectedSha256:file.sha256})})).value;}
 t.after(()=>db.close());return {db,config,service,request,create,set,seed,remove,user,other,calls,objects};
}

test('a historic format filename never becomes an applied template, and old schema gains the independent column',async t=>{
 const f=fixture(t),item=await f.create();assert.equal(item.exportTemplate,null);assert.equal(item.snapshot.requirements.format,'历史学校格式规范.docx');
 assert.deepEqual(await f.request(`/api/theses/${item.id}/export-template`),{exportTemplate:null,version:item.version});assert.equal(f.calls.length,0);
 f.db.exec('ALTER TABLE theses DROP COLUMN export_template');initializeThesisSchema(f.db);assert.ok(f.db.prepare('PRAGMA table_info(theses)').all().some(row=>row.name==='export_template'));
 assert.equal(f.service.get(item.id,f.user).exportTemplate,null);
});

test('binding persists real owned source and server rules across service instances without changing the research snapshot or saved chapters',async t=>{
 const f=fixture(t),file=f.seed('school'),created=await f.create();f.db.prepare("UPDATE theses SET status='completed' WHERE id=?").run(created.id);
 const before=f.db.prepare('SELECT * FROM theses WHERE id=?').get(created.id),chapters=f.service.get(created.id,f.user).chapters,item=await f.set(created,file.id),after=f.db.prepare('SELECT * FROM theses WHERE id=?').get(created.id);
 assert.equal(item.version,created.version+1);assert.equal(item.status,'completed');assert.equal(after.snapshot_hash,before.snapshot_hash);assert.equal(after.snapshot,before.snapshot);assert.equal(after.current_run_id,before.current_run_id);assert.deepEqual(item.chapters,chapters);
 assert.deepEqual(item.exportTemplate,{version:1,source:{fileId:file.id,name:'学校-school.docx',sha256:file.sha256,size:f.objects.get(file.id).length},profile:templateProfile(),status:'ready'});
 assert.equal(f.calls.filter(row=>row.inspect).length,1);assert.doesNotMatch(JSON.stringify(item),/private-key-never-disclose|private-test|storage_key/);
 const next=createThesisService(f.db,f.config),reloaded=(await next.handle({path:`/api/theses/${item.id}`,method:'GET',user:f.user})).value.item;
 assert.deepEqual(reloaded.exportTemplate,item.exportTemplate);assert.equal(reloaded.fullText,item.fullText);assert.equal(f.calls.filter(row=>row.inspect).length,1,'reading immutable profile does not reinterpret its rules');
});

test('template replacement is optimistic, null explicitly restores defaults, and unrelated snapshot updates retain the binding',async t=>{
 const f=fixture(t),a=f.seed('school-a'),b=f.seed('school-b'),original=await f.create(),first=await f.set(original,a.id);
 await assert.rejects(f.set(original,b.id),{status:409});assert.equal(f.service.get(first.id,f.user).exportTemplate.source.fileId,a.id);
 const snapshotUpdate=(await f.request(`/api/theses/${first.id}`,'POST',{version:first.version,snapshot:snapshot()})).item;assert.equal(snapshotUpdate.exportTemplate.source.fileId,a.id);
 const second=await f.set(snapshotUpdate,b.id),before=f.db.prepare('SELECT snapshot_hash,status FROM theses WHERE id=?').get(second.id),cleared=await f.set(second,null);
 assert.equal(cleared.exportTemplate,null);assert.equal(cleared.version,second.version+1);assert.deepEqual(f.db.prepare('SELECT snapshot_hash,status FROM theses WHERE id=?').get(second.id),before);
 assert.equal((await f.set(cleared,null)).version,cleared.version,'an already explicit default is a no-op');
});

test('binding accepts only source ids, verifies owner, and never accepts caller rules, URLs, PDF, oversized or local-only sources',async t=>{
 const f=fixture(t),item=await f.create();f.seed('other-template',{owner:f.other.id});f.seed('pdf-norms',{kind:'pdf'});f.seed('too-large',{bytes:2*1024*1024+1});f.seed('local-only',{provider:'local_server_sqlite'});
 for(const [id,status] of [['other-template',404],['missing',404],['https://example.test/file.docx',400],['pdf-norms',400],['too-large',409],['local-only',409],['',400]])await assert.rejects(f.set(item,id),{status});
 for(const body of [{version:item.version,rules:templateProfile().rules,templateFileId:null},{version:item.version,url:'https://example.test/docx'},{version:item.version}])await assert.rejects(f.request(`/api/theses/${item.id}/export-template`,'POST',body),{status:400});
 await assert.rejects(f.request(`/api/theses/${item.id}/export-template`,'GET',undefined,f.other),{status:404});
 await assert.rejects(f.request(`/api/theses/${item.id}/export-template`,'DELETE'),{status:405});assert.equal(f.calls.length,0);
});

test('creating with a real template is atomic and idempotent while invalid templates cannot silently become defaults',async t=>{
 const f=fixture(t),a=f.seed('create-a'),b=f.seed('create-b'),clientKey=randomUUID(),body={snapshot:snapshot(),clientKey,exportTemplateFileId:a.id};
 const first=(await f.request('/api/theses','POST',body)).item,again=(await f.request('/api/theses','POST',body)).item;assert.equal(again.id,first.id);assert.equal(first.exportTemplate.source.fileId,a.id);assert.equal(f.calls.filter(row=>row.inspect).length,1);
 await assert.rejects(f.request('/api/theses','POST',{...body,exportTemplateFileId:b.id}),{status:409});
 await assert.rejects(f.create({exportTemplateFileId:'missing'}),{status:404});assert.equal(f.db.prepare('SELECT count(*) n FROM theses').get().n,1);
 assert.equal((await f.create({exportTemplateFileId:null})).exportTemplate,null);assert.equal((await f.create()).exportTemplate,null);
});

test('private source reads validate actual bytes and parsing failures preserve the previous binding',async t=>{
 const f=fixture(t),a=f.seed('valid'),b=f.seed('corrupt'),item=await f.set(await f.create(),a.id);f.objects.set(b.id,Buffer.from('PK different bytes'));
 await assert.rejects(f.set(item,b.id),{status:422});assert.equal(f.calls.filter(row=>row.inspect).length,1);
 f.objects.delete(b.id);await assert.rejects(f.set(item,b.id),{status:503});
 f.objects.set(b.id,Buffer.from('PK synthetic template '+b.id));f.config.inspectThesisDocxTemplate=async()=>{throw Error('cannot parse malformed zip');};await assert.rejects(f.set(item,b.id),{status:422});
 f.config.inspectThesisDocxTemplate=async()=>({...templateProfile(),recognized:[]});await assert.rejects(f.set(item,b.id),{status:422});
 assert.equal(f.service.get(item.id,f.user).exportTemplate.source.fileId,a.id);assert.equal(f.service.get(item.id,f.user).version,item.version);
});

test('GET marks inaccessible, corrupt, missing and pending-delete sources unavailable instead of implying fallback',async t=>{
 const f=fixture(t),a=f.seed('availability'),item=await f.set(await f.create(),a.id),route=`/api/theses/${item.id}/export-template`;
 assert.equal((await f.request(route)).exportTemplate.status,'ready');const original=f.objects.get(a.id);f.objects.delete(a.id);
 let unavailable=(await f.request(route)).exportTemplate;assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.source.fileId,a.id);assert.deepEqual(unavailable.profile,templateProfile());
 assert.equal((await f.request(`/api/theses/${item.id}`)).item.exportTemplate.status,'unavailable');assert.notEqual(f.db.prepare('SELECT export_template FROM theses WHERE id=?').get(item.id).export_template,null);
 f.objects.set(a.id,Buffer.from('PK changed'));assert.equal((await f.request(route)).exportTemplate.status,'unavailable');f.objects.set(a.id,original);
 assert.equal((await f.request(route)).exportTemplate.status,'ready');
 f.db.prepare("INSERT INTO workspace_file_deletions(file_id,user_id,expected_sha256,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?)").run(a.id,f.user.id,a.sha256,new Date().toISOString(),new Date().toISOString());
 assert.equal((await f.request(route)).exportTemplate.status,'unavailable');f.db.prepare('DELETE FROM workspace_file_deletions WHERE file_id=?').run(a.id);f.db.prepare('DELETE FROM files WHERE id=?').run(a.id);
 assert.equal((await f.request(route)).exportTemplate.status,'unavailable');
});

test('source deletion is blocked until all thesis bindings explicitly clear the reference',async t=>{
 const f=fixture(t),file=f.seed('shared'),one=await f.set(await f.create(),file.id),two=await f.set(await f.create(),file.id);
 await assert.rejects(f.remove(file),error=>error.status===409&&error.message.includes('论文导出模板'));await f.set(one,null);await assert.rejects(f.remove(file),{status:409});await f.set(two,null);
 assert.equal((await f.remove(file)).deleted,true);assert.equal(f.objects.has(file.id),false);
});

test('an original changed during asynchronous inspection cannot be bound and concurrent edits retain optimistic ownership',async t=>{
 const f=fixture(t),a=f.seed('stable'),b=f.seed('racing'),item=await f.set(await f.create(),a.id),entered=deferred(),release=deferred(),inspect=f.config.inspectThesisDocxTemplate;
 f.config.inspectThesisDocxTemplate=async bytes=>{entered.resolve();await release.promise;return inspect(bytes);};
 const changing=f.set(item,b.id);await entered.promise;await f.remove(b);release.resolve();await assert.rejects(changing,{status:409});assert.equal(f.service.get(item.id,f.user).exportTemplate.source.fileId,a.id);
 const c=f.seed('new-racing'),enteredAgain=deferred(),releaseAgain=deferred();f.config.inspectThesisDocxTemplate=async bytes=>{enteredAgain.resolve();await releaseAgain.promise;return inspect(bytes);};
 const setting=f.set(item,c.id);await enteredAgain.promise;const clear=await f.set(item,null);releaseAgain.resolve();await assert.rejects(setting,{status:409});assert.equal(f.service.get(item.id,f.user).version,clear.version);assert.equal(f.service.get(item.id,f.user).exportTemplate,null);
});

test('a template read cannot return a stale ready selection after a concurrent explicit reset',async t=>{
 const f=fixture(t),source=f.seed('read-racing'),item=await f.set(await f.create(),source.id),entered=deferred(),release=deferred(),read=f.config.storage.read;
 f.config.storage.read=async row=>{entered.resolve();await release.promise;return read(row);};
 const pending=f.request(`/api/theses/${item.id}/export-template`);await entered.promise;await f.set(item,null);release.resolve();await assert.rejects(pending,{status:409});assert.equal(f.service.get(item.id,f.user).exportTemplate,null);
});

test('malformed saved template metadata is visibly unavailable and cannot be upgraded by a filename',async t=>{
 const f=fixture(t),item=await f.create();for(const value of ['not JSON',JSON.stringify({version:1,source:{fileId:'lost'},profile:templateProfile()}),JSON.stringify({version:1,source:null})]){
  f.db.prepare('UPDATE theses SET export_template=? WHERE id=?').run(value,item.id);const actual=(await f.request(`/api/theses/${item.id}/export-template`)).exportTemplate;assert.equal(actual.status,'unavailable');assert.equal(actual.profile,null);
 }
 assert.equal(f.calls.length,0);assert.equal((await f.set(f.service.get(item.id,f.user),null)).exportTemplate,null);
});

test('template profile storage is bounded and included in the shared account quota',async t=>{
 const f=fixture(t),file=f.seed('quota'),item=await f.create(),before=f.db.prepare('SELECT length(CAST(snapshot AS BLOB)) n FROM theses').get().n;
 f.config.thesisAccountStorageBytes=before+512+200;await assert.rejects(f.set(item,file.id),error=>error.status===413&&error.code==='storage_limit');assert.equal(f.service.get(item.id,f.user).exportTemplate,null);
 delete f.config.thesisAccountStorageBytes;await f.set(item,file.id);f.config.thesisAccountStorageBytes=before+512+200;await assert.rejects(f.create(),error=>error.status===413&&error.code==='storage_limit');
 f.config.inspectThesisDocxTemplate=async()=>({...templateProfile(),rules:{tooLarge:'x'.repeat(70000)}});await assert.rejects(f.set(f.service.get(item.id,f.user),file.id),{status:413});
});
