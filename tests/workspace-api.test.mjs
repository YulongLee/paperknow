import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession} from '../backend/auth.mjs';

async function fixture(t){
 const db=database(':memory:'),api=createAPI(db,{cancel(){}},{getAI:()=>({enabled:false})}),server=http.createServer((req,res)=>void api(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
 const users=Object.fromEntries(['alice','bob','admin'].map(id=>{db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid','测试研究者',null,id==='admin'?'admin':'user',new Date().toISOString());return [id,{id,cookie:'pk_session='+createSession(db,id)}];}));
 async function request(path,data,user=users.alice,origin=base){const response=await fetch(base+'/api'+path,{method:data===undefined?'GET':'POST',headers:{...(user?{Cookie:user.cookie}:{}),...(data===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,value:await response.json()};}
 const project=async(title='账户研究项目')=>(await request('/projects',{title,degree:'硕士',major:'教育学'})).value.item;
 const save=async(extra={})=>request('/workspace/drafts',{title:'研究草稿',tool:'writing',payload:{title:'研究草稿',tool:'writing',text:'由用户明确选择保存的正文。'},...extra});
 return {db,base,request,users,project,save};
}

test('workspace reads require login and every mutation requires same-origin',async t=>{
 const f=await fixture(t);
 for(const path of ['/projects','/workspace/drafts','/workspace/summary','/account/profile','/feedback'])assert.equal((await f.request(path,undefined,null)).status,401);
 assert.equal((await f.request('/workspace/drafts',{title:'x',tool:'writing',payload:{}},f.users.alice,'https://attacker.invalid')).status,403);
 assert.equal((await f.request('/account/profile',{name:'替换'},f.users.alice,'')).status,403);
 assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_drafts').get().n,0);
});

test('account profile changes only the signed-in display name and preserves login identities and role',async t=>{
 const f=await fixture(t);const read=await f.request('/account/profile');assert.equal(read.value.user.name,'测试研究者');
 const saved=await f.request('/account/profile',{name:' 新研究者 '});assert.equal(saved.status,200);assert.equal(saved.value.user.name,'新研究者');assert.equal(saved.value.user.role,'user');
 assert.equal((await f.request('/auth/me')).value.user.name,'新研究者');
 for(const input of [{name:'A',role:'admin'},{name:'A',email:'owner@example.invalid'},{name:''},{name:'x'.repeat(51)},{name:'line\nname'}])assert.equal((await f.request('/account/profile',input)).status,400);
 assert.equal((await f.request('/account/profile',undefined,f.users.bob)).value.user.name,'测试研究者');
 assert.equal(JSON.stringify(saved.value).includes('password_hash'),false);
});

test('profile updates from a stale account form cannot change a newly signed-in account',async t=>{
 const f=await fixture(t);
 const stale=await f.request('/account/profile',{name:'原账户表单中的昵称',expectedUserId:'alice'},f.users.bob);assert.equal(stale.status,409);assert.equal(f.db.prepare('SELECT name FROM users WHERE id=?').get('bob').name,'测试研究者');assert.equal(f.db.prepare('SELECT name FROM users WHERE id=?').get('alice').name,'测试研究者');
 for(const expectedUserId of [null,{},123,''])assert.equal((await f.request('/account/profile',{name:'不得更新',expectedUserId},f.users.bob)).status,409);
 const matched=await f.request('/account/profile',{name:'正确账户的新昵称',expectedUserId:'bob'},f.users.bob);assert.equal(matched.status,200);assert.equal(matched.value.user.name,'正确账户的新昵称');
 assert.equal((await f.request('/account/profile',{name:'兼容旧客户端'},f.users.alice)).status,200);
});

test('projects support editing, detail, archive, restore and optimistic concurrency without altering legacy columns',async t=>{
 const f=await fixture(t),p=await f.project();assert.equal(p.version,0);assert.equal(p.status,'active');
 const changed=await f.request('/projects/'+p.id,{version:0,title:'更新的项目',stage:'正文写作',description:'项目说明',status:'archived'});assert.equal(changed.status,200);assert.equal(changed.value.item.version,1);assert.equal(changed.value.item.description,'项目说明');
 const conflict=await f.request('/projects/'+p.id,{version:0,title:'过期覆盖'});assert.equal(conflict.status,409);
 assert.equal((await f.request('/projects/'+p.id,{version:1,status:'active'})).value.item.version,2);
 const detail=(await f.request('/projects/'+p.id)).value;assert.equal(detail.item.title,'更新的项目');for(const key of ['files','jobs','results','drafts'])assert.deepEqual(detail[key],[]);
 assert.equal((await f.request('/projects/'+p.id,{version:2,status:'deleted'})).status,400);
 assert.equal((await f.request('/projects/'+p.id,{title:'无版本'})).status,400);
 assert.equal((await f.request('/projects/'+p.id,undefined,f.users.bob)).status,404);
 assert.equal((await f.request('/projects/'+p.id,{version:2,status:'archived'},f.users.bob)).status,404);
 const at=new Date().toISOString();f.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run('legacy-project','alice','旧项目','本科','',at,at);assert.equal((await f.request('/projects/legacy-project')).value.item.version,0);
});

test('project creation includes stage and description in one atomic operation',async t=>{
 const f=await fixture(t),response=await f.request('/projects',{title:'完整项目',degree:'博士',major:'计算机',stage:'开题阶段',description:'研究目标与范围'});assert.equal(response.status,201);assert.equal(response.value.id,response.value.item.id);assert.equal(response.value.item.version,0);assert.equal(response.value.item.stage,'开题阶段');assert.equal(response.value.item.description,'研究目标与范围');
 assert.equal((await f.request('/projects',{title:'错误项目',description:'x'.repeat(5001)})).status,400);assert.equal(f.db.prepare('SELECT count(*) n FROM projects').get().n,1);
 f.db.exec("CREATE TRIGGER reject_project_details BEFORE INSERT ON workspace_project_details WHEN NEW.description='simulate-storage-failure' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
 const failed=await f.request('/projects',{title:'不得留下半创建项目',description:'simulate-storage-failure'});assert.equal(failed.status,500);assert.equal(f.db.prepare('SELECT count(*) n FROM projects').get().n,1);
});

test('only empty projects can be deleted; files, tasks, task results and account drafts prevent deletion',async t=>{
 const f=await fixture(t),empty=await f.project();await f.request('/projects/'+empty.id,{version:0,status:'archived'});
 assert.equal((await f.request('/projects/'+empty.id+'/delete',{version:0})).status,409);
 assert.equal((await f.request('/projects/'+empty.id+'/delete',{version:1})).status,200);assert.equal((await f.request('/projects/'+empty.id)).status,404);
 const at=new Date().toISOString();
 for(const kind of ['files','jobs','results','workspace_drafts']){
  const p=await f.project(kind),id='occupied-'+kind;
  if(kind==='files')f.db.prepare('INSERT INTO files(id,user_id,project_id,name,kind,bytes,sha256,body,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,'alice',p.id,'x.txt','txt',1,'hash',Buffer.from('x'),at);
  if(kind==='jobs')f.db.prepare('INSERT INTO jobs(id,user_id,project_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'alice',p.id,'parse','completed','completed','{}',id,'hash',at,at);
  if(kind==='results')f.db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run(id,'alice',p.id,null,'parse','结果','{}',at);
  if(kind==='workspace_drafts')await f.save({projectId:p.id});
  assert.equal((await f.request('/projects/'+p.id+'/delete',{version:0})).status,409,kind);
  assert.equal((await f.request('/projects/'+p.id,{version:0,status:'archived'})).status,200,kind);
 }
});

test('account draft lifecycle is explicit, private, project-aware and preserves full editable content',async t=>{
 const f=await fixture(t),p=await f.project();assert.equal((await f.request('/workspace/drafts')).value.items.length,0);
 const data={text:'第一章\n实际研究材料',document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'正文'}]}]},paragraphs:[{id:'p1',original:'原文',suggestion:'改写'}]};
 const saved=await f.save({projectId:p.id,payload:data});assert.equal(saved.status,201);const d=saved.value.item;assert.equal(d.version,1);assert.equal(d.project_id,p.id);assert.deepEqual(d.payload,data);
 const listed=(await f.request('/workspace/drafts')).value.items[0];assert.equal('payload'in listed,false);assert.equal(listed.bytes,Buffer.byteLength(JSON.stringify(data)));
 assert.deepEqual((await f.request('/workspace/drafts/'+d.id)).value.item.payload,data);
 const update=await f.request('/workspace/drafts/'+d.id,{version:1,title:'改名',payload:{...data,text:'新正文'}});assert.equal(update.status,200);assert.equal(update.value.item.version,2);
 assert.equal((await f.request('/workspace/drafts/'+d.id,{version:1,payload:{text:'过期正文'}})).status,409);assert.equal((await f.request('/workspace/drafts/'+d.id)).value.item.payload.text,'新正文');
 for(const suffix of ['', '/delete'])assert.equal((await f.request('/workspace/drafts/'+d.id+suffix,{version:2},f.users.bob)).status,404);
 assert.equal((await f.request('/workspace/drafts/'+d.id,undefined,f.users.bob)).status,404);assert.deepEqual((await f.request('/workspace/drafts',undefined,f.users.bob)).value.items,[]);
 assert.equal((await f.request('/projects/'+p.id)).value.drafts[0].id,d.id);
 assert.equal((await f.request('/workspace/drafts/'+d.id+'/delete',{version:1})).status,409);
 assert.equal((await f.request('/workspace/drafts/'+d.id+'/delete',{version:2})).status,200);assert.equal((await f.request('/workspace/drafts/'+d.id)).status,404);
});

test('draft save idempotency avoids duplicates, rejects changed requests and remains scoped to each account',async t=>{
 const f=await fixture(t),one=await f.save({clientKey:'save-test-2026'}),two=await f.save({clientKey:'save-test-2026'});assert.equal(one.value.item.id,two.value.item.id);
 assert.equal((await f.save({clientKey:'save-test-2026',title:'其他草稿'})).status,409);
 const other=await f.request('/workspace/drafts',{title:'研究草稿',tool:'writing',payload:{text:'其他用户内容'},clientKey:'save-test-2026'},f.users.bob);assert.equal(other.status,201);assert.notEqual(other.value.item.id,one.value.item.id);
 assert.equal(f.db.prepare('SELECT count(*) n FROM workspace_drafts').get().n,2);
});

test('draft input strips authority and foreign linkage, sanitizes HTML and validates quotas and project ownership',async t=>{
 const f=await fixture(t),p=await f.project();
 const saved=await f.save({payload:{id:'local-original',projectId:'foreign-local',text:'正文',html:'<p onclick="bad()">你好</p><script>alert(1)</script><strong>保留</strong>',exportUnlocked:true,payment:{paid:true},userId:'admin',role:'admin',nested:{exportUnlocked:true,role:'admin',content:'内容'}}});assert.equal(saved.status,201);const body=saved.value.item.payload;
 for(const key of ['id','projectId','exportUnlocked','payment','userId','role'])assert.equal(key in body,false);assert.deepEqual(body.nested,{content:'内容'});assert.equal(body.html.includes('<script'),false);assert.equal(body.html.includes('onclick'),false);assert.equal(body.html.includes('<strong>保留</strong>'),true);
 assert.equal((await f.request('/workspace/drafts',{title:'x',tool:'writing',projectId:p.id,payload:{}},f.users.bob)).status,404);
 assert.equal((await f.save({tool:'unknown-tool'})).status,400);assert.equal((await f.save({payload:[]})).status,400);assert.equal((await f.save({payload:{text:'字'.repeat(260000)}})).status,413);
 let deep={};for(let i=0;i<35;i++)deep={nested:deep};assert.equal((await f.save({payload:deep})).status,400);
 f.db.prepare('UPDATE workspace_drafts SET bytes=? WHERE id=?').run(50*1024*1024,saved.value.item.id);assert.equal((await f.save()).status,409);
});

test('saved task results can be named and associated only with owned projects without mutating their body',async t=>{
 const f=await fixture(t),p=await f.project(),at=new Date().toISOString();f.db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run('result-alice','alice',null,null,'parse','原始结果',JSON.stringify({text:'不可覆盖的任务原文'}),at);
 const changed=await f.request('/results/result-alice',{title:'论文材料解析',projectId:p.id});assert.equal(changed.status,200);assert.equal(changed.value.item.project_id,p.id);assert.equal(changed.value.item.body.text,'不可覆盖的任务原文');
 assert.equal((await f.request('/results/result-alice',{projectId:p.id},f.users.bob)).status,404);
 const foreign=(await f.request('/projects',{title:'他人项目'},f.users.bob)).value.item.id;assert.equal((await f.request('/results/result-alice',{projectId:foreign})).status,404);
 assert.equal((await f.request('/results/result-alice',{body:{text:'篡改'}})).status,400);assert.equal((await f.request('/results/result-alice',{projectId:''})).value.item.project_id,null);
});

test('feedback status is visible only to its owner, while administrator notes remain private',async t=>{
 const f=await fixture(t),created=await f.request('/feedback',{category:'功能问题',text:'导出按钮无法使用'});assert.equal(created.status,201);assert.equal(created.value.item.status,'open');assert.equal(created.value.item.body,'导出按钮无法使用');
 const updated='2026-10-15T10:00:00.000Z';f.db.prepare('INSERT INTO feedback_management VALUES(?,?,?,?,?)').run(created.value.id,'processing','仅后台内部：用户不应看见','admin',updated);
 const data=await f.request('/feedback');assert.equal(data.value.items[0].status,'processing');assert.equal(data.value.items[0].updated_at,updated);assert.equal(JSON.stringify(data.value).includes('仅后台内部'),false);assert.equal('note'in data.value.items[0],false);
 assert.deepEqual((await f.request('/feedback',undefined,f.users.bob)).value.items,[]);
});

test('account summary counts persisted records and model usage without mixing local tasks or fabricating quotas',async t=>{
 const f=await fixture(t),p=await f.project();await f.request('/projects/'+p.id,{version:0,status:'archived'});await f.save({projectId:p.id});await f.request('/files',{name:'内容.txt',projectId:p.id,data:Buffer.from('账户正文').toString('base64')});
 const at=new Date().toISOString();f.db.prepare('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)').run('use-1','alice',null,'fixture','test-model',12,7,0,at);
 f.db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('job-1','alice','parse','completed','completed','{}','summary','hash',at,at);
 const response=await f.request('/workspace/summary');assert.equal(response.status,200);assert.deepEqual(response.value.counts,{projects:1,activeProjects:0,archivedProjects:1,files:1,drafts:1,results:0,jobs:1,queuedJobs:0,runningJobs:0,completedJobs:1,failedJobs:0,cancelledJobs:0});
 assert.equal(response.value.storage.fileBytes,Buffer.byteLength('账户正文'));assert.ok(response.value.storage.draftBytes>0);assert.deepEqual(response.value.usage,{records:1,inputTokens:12,outputTokens:7,billableRecords:0,billingEnabled:false});
 const other=(await f.request('/workspace/summary',undefined,f.users.bob)).value;assert.equal(other.counts.projects,0);assert.equal(other.storage.fileBytes,0);assert.equal(other.usage.records,0);
});

test('expired sessions cannot read, replace or delete account content',async t=>{
 const f=await fixture(t),saved=(await f.save()).value.item;
 f.db.prepare('UPDATE sessions SET expires_at=0 WHERE user_id=?').run(f.users.alice.id);
 for(const [path,input]of [['/workspace/drafts/'+saved.id,undefined],['/workspace/drafts/'+saved.id,{version:1,payload:{text:'过期会话覆盖'}}],['/workspace/drafts/'+saved.id+'/delete',{version:1}],['/account/profile',{name:'替换'}]])assert.equal((await f.request(path,input)).status,401);
 const retained=f.db.prepare('SELECT version,payload FROM workspace_drafts WHERE id=?').get(saved.id);assert.equal(retained.version,1);assert.match(retained.payload,/明确选择保存/);
});

test('simultaneous draft writes cannot silently overwrite each other',async t=>{
 const f=await fixture(t),saved=(await f.save()).value.item;
 const responses=await Promise.all(['页面一正文','页面二正文'].map(text=>f.request('/workspace/drafts/'+saved.id,{version:1,payload:{text}})));
 assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);const winner=responses.find(response=>response.status===200).value.item;
 const final=(await f.request('/workspace/drafts/'+saved.id)).value.item;assert.equal(final.version,2);assert.deepEqual(final.payload,winner.payload);
});

test('draft references never authorize foreign attachments or create processing tasks automatically',async t=>{
 const f=await fixture(t),foreignFile=(await f.request('/files',{name:'他人的原件.txt',data:Buffer.from('他人的私人原文').toString('base64')},f.users.bob)).value.id;
 const saved=await f.save({payload:{text:'用户自己输入的参考说明',fileId:foreignFile,knowledgeFiles:[{id:foreignFile,name:'不可信引用'}]}});assert.equal(saved.status,201);assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
 assert.equal((await f.request('/files/'+foreignFile+'/download')).status,404);assert.equal((await f.request('/jobs',{type:'parse',fileId:foreignFile,idempotencyKey:'foreign-reference'})).status,404);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);
});

test('payload prototype keys and markup cannot become executable stored HTML or permission flags',async t=>{
 const f=await fixture(t),payload=JSON.parse('{"text":"正文","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"nested":{"Role":"admin","PAYMENT":{"paid":true},"previewHTML":"<img src=x onerror=alert(1)><p>安全段落</p><svg onload=bad()>"}}');
 const response=await f.save({payload});assert.equal(response.status,201);const returned=response.value.item.payload;
 assert.equal(Object.hasOwn(returned,'__proto__'),false);assert.equal(Object.hasOwn(returned,'constructor'),false);assert.deepEqual(returned.nested,{previewHTML:'<p>安全段落</p>'});assert.equal({}.polluted,undefined);
});

test('draft replacement enforces quota with verified serialized bytes and rejects caller byte overrides',async t=>{
 const f=await fixture(t),saved=(await f.save()).value.item;
 assert.equal((await f.request('/workspace/drafts/'+saved.id,{version:1,bytes:1,payload:{text:'绕过配额'}})).status,400);
 const changed=await f.request('/workspace/drafts/'+saved.id,{version:1,payload:{text:'修改正文',html:'<p>正文</p>'}});assert.equal(changed.status,200);assert.equal(changed.value.item.bytes,Buffer.byteLength(JSON.stringify(changed.value.item.payload)));
 assert.equal((await f.request('/workspace/drafts/'+saved.id,{version:2,payload:{text:'x'.repeat(750*1024)}})).status,413);
 const final=(await f.request('/workspace/drafts/'+saved.id)).value.item;assert.equal(final.version,2);assert.equal(final.payload.text,'修改正文');
});

test('account archive exports complete owned content without originals, credentials or administrative notes',async t=>{
 const f=await fixture(t),p=await f.project(),d=(await f.save({projectId:p.id,payload:{text:'完整账户草稿'}})).value.item;
 const ownFile=(await f.request('/files',{name:'测试原件.txt',projectId:p.id,data:Buffer.from('原件字节不包含在归档中').toString('base64')})).value.id;
 const foreign=await f.request('/workspace/drafts',{title:'他人私密草稿',tool:'writing',payload:{text:'bob-secret-content'}},f.users.bob);assert.equal(foreign.status,201);
 const at=new Date().toISOString();f.db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run('archive-result','alice',p.id,null,'parse','解析成果',JSON.stringify({text:'用户成果正文'}),at);
 f.db.prepare('INSERT INTO result_revisions VALUES(?,?,?,?,?)').run('own-revision','archive-result','alice','用户修订正文',at);
 f.db.prepare('INSERT INTO result_revisions VALUES(?,?,?,?,?)').run('foreign-revision','archive-result','bob','foreign-revision-secret',at);
 const feedback=(await f.request('/feedback',{text:'我的问题建议'})).value.id;f.db.prepare('INSERT INTO feedback_management VALUES(?,?,?,?,?)').run(feedback,'processing','private-admin-note','admin',at);
 f.db.prepare("UPDATE users SET password_hash='secret-password-hash' WHERE id='alice'").run();
 const response=await f.request('/account/export');assert.equal(response.status,200);const data=response.value,serialized=JSON.stringify(data);
 assert.equal(data.format,'paperknow-account-archive');assert.equal(data.version,1);assert.equal(data.scope,'account');assert.equal(data.account.id,'alice');assert.equal(data.includesOriginalFiles,false);assert.equal(data.restoreSupported,false);
 assert.equal(data.projects[0].id,p.id);assert.equal(data.drafts[0].id,d.id);assert.equal(data.drafts[0].payload.text,'完整账户草稿');assert.equal(data.files[0].downloadPath,'/api/files/'+ownFile+'/download');assert.equal(data.results[0].body.text,'用户成果正文');assert.equal(data.results[0].revisions.length,1);assert.equal(data.results[0].revisions[0].body,'用户修订正文');assert.equal(data.feedback[0].status,'processing');
 for(const excluded of ['原件字节不包含在归档中','bob-secret-content','foreign-revision-secret','private-admin-note','secret-password-hash','storage_key','storage_bucket','token_hash','hasPassword'])assert.equal(serialized.includes(excluded),false,excluded);
 const other=(await f.request('/account/export',undefined,f.users.bob)).value;assert.equal(other.drafts.length,1);for(const key of ['projects','files','results','jobs','feedback'])assert.deepEqual(other[key],[]);
 assert.equal((await f.request('/account/export',undefined,null)).status,401);assert.equal((await f.request('/account/export',{})).status,405);
 f.db.prepare('UPDATE workspace_drafts SET bytes=? WHERE id=?').run(101*1024*1024,d.id);assert.equal((await f.request('/account/export')).status,413);
});

test('feedback limits a daily burst rather than permanently locking out long-standing users',async t=>{
 const f=await fixture(t),old=new Date(Date.now()-3*86400000).toISOString();for(let n=0;n<100;n++)f.db.prepare('INSERT INTO feedback VALUES(?,?,?,?,?)').run('historical-'+n,'alice','产品建议','过去的问题'+n,old);
 assert.equal((await f.request('/feedback',{text:'新的问题仍可提交'})).status,201);
 for(let n=0;n<19;n++)assert.equal((await f.request('/feedback',{text:'今日反馈'+n})).status,201);
 assert.equal((await f.request('/feedback',{text:'超过每日限制'})).status,429);assert.equal((await f.request('/feedback',{text:'另一个账户'},f.users.bob)).status,201);
});

test('account archive download is rate limited independently for each signed-in account',async t=>{
 const f=await fixture(t);for(let i=0;i<5;i++)assert.equal((await f.request('/account/export')).status,200);assert.equal((await f.request('/account/export')).status,429);assert.equal((await f.request('/account/export',undefined,f.users.bob)).status,200);assert.equal((await f.request('/account/profile')).status,200);
});
