import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession,ensureOwnerAdmin,hashPassword,sessionUser} from '../backend/auth.mjs';
import {modelSettings} from '../backend/config.mjs';

const owner='liyulong19950316@163.com';
const password='Test-admin-account-password-2026';
const privateKey='private-model-key-must-never-leak';
const timestamp=()=>new Date().toISOString();

async function fixture(t,overrides={}){
  const db=database(':memory:');
  const deliveries=[];
  const config={ownerEmail:owner,authCodeSecret:'test-auth-code-signing-secret-long-enough',authDelivery:{ready:{email:true,phone:true},async send(message){deliveries.push(message);}},
    aiURL:'https://model.example.invalid/v1/chat',aiKey:privateKey,aiModel:'configured-model',storage:{provider:'local_server_sqlite'},...overrides};
  config.settings=modelSettings(db,config);
  config.getAI=()=>config.settings.get();
  const cancelled=[];
  const worker={cancel(id){assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'cancelled');cancelled.push(id);}};
  const api=createAPI(db,worker,config);
  const server=http.createServer((req,res)=>void api(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  async function request(path,{data,cookie='',method=data===undefined?'GET':'POST',origin=base}={}){
    const response=await fetch(base+path,{method,headers:{Cookie:cookie,...(method==='GET'?{}:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})})},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,value:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  async function code(address,purpose,channel='email'){
    db.prepare('UPDATE auth_challenges SET created_at=created_at-61000 WHERE channel=? AND address=?').run(channel,address);
    const response=await request('/api/auth/code/send',{data:{channel,address,purpose}});
    assert.equal(response.status,200);
    return {...response.value,code:deliveries.at(-1).code};
  }
  async function register(email=owner,extra={}){
    const response=await request('/api/auth/register',{data:{...await code(email,'register'),name:'研究用户',password,...extra}});
    assert.equal(response.status,200);
    return response;
  }
  async function legacy(email=owner,{verified=false,role='user'}={}){
    const id=randomUUID();
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,email,'旧账号',await hashPassword(password),role,timestamp());
    db.prepare('INSERT INTO auth_identities VALUES(?,?,?,?,?)').run('email',email,id,verified?timestamp():null,timestamp());
    return {id,cookie:`pk_session=${createSession(db,id)}`};
  }
  function seedUser(name,index){
    const id=`seed-user-${index}`;
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,`seed-${index}@example.com`,name,'not-a-real-password','user',timestamp());
    return id;
  }
  function job(userId,status,id=randomUUID()){
    const at=timestamp();
    db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,error,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,userId,'polish',status,status,JSON.stringify({text:'private-original-document',apiKey:privateKey}),status==='failed'?`failure ${privateKey}`:null,id,'private-input-hash',at,at);
    return id;
  }
  return {db,config,request,register,code,legacy,seedUser,job,cancelled,deliveries};
}

test('every admin path rejects guests and ordinary users before returning data or accepting actions',async t=>{
  const f=await fixture(t);
  const paths=['','/revenue','/revenue/export','/overview','/users','/jobs','/results','/feedback','/orders','/usage','/audit','/settings','/model','/unknown'];
  for(const path of paths)assert.equal((await f.request('/api/admin'+path)).status,401);
  assert.equal((await f.request('/api/admin/model',{method:'POST',origin:'',data:{model:'bad',enabled:true}})).status,401);
  const user=await f.register('ordinary@example.com',{role:'admin',email:owner,name:owner});
  assert.equal(user.value.user.role,'user');
  assert.equal(user.value.user.email,'ordinary@example.com');
  for(const path of paths)assert.equal((await f.request('/api/admin'+path,{cookie:user.cookie})).status,403);
  assert.equal((await f.request('/api/admin/jobs/fake/cancel',{cookie:user.cookie,data:{role:'admin'}})).status,403);
  assert.equal((await f.request('/api/admin/feedback/fake',{cookie:user.cookie,data:{status:'resolved',note:'fake'}})).status,403);
  assert.equal(f.db.prepare('SELECT count(*) n FROM admin_audit').get().n,0);
});

test('unverified owner password and session stay ordinary until the mailbox is actually verified',async t=>{
  const f=await fixture(t);
  const existing=await f.legacy();
  assert.equal((await f.request('/api/auth/me',{cookie:existing.cookie})).value.user.role,'user');
  const passwordLogin=await f.request('/api/auth/login',{data:{email:owner,password,role:'admin',emailVerifiedAt:timestamp()}});
  assert.equal(passwordLogin.value.user.role,'user');
  assert.equal((await f.request('/api/admin/overview',{cookie:passwordLogin.cookie})).status,403);
  const verified=await f.request('/api/auth/code/login',{data:{...await f.code(owner,'login'),role:'user'}});
  assert.equal(verified.status,200);
  assert.equal(verified.value.user.role,'admin');
  assert.equal(verified.value.user.id,existing.id);
  assert.equal(verified.value.user.hasPassword,false);
  assert.equal((await f.request('/api/admin/overview',{cookie:verified.cookie})).status,200);
  assert.equal((await f.request('/api/auth/me',{cookie:existing.cookie})).status,401);
  await f.request('/api/auth/me',{cookie:verified.cookie});
  assert.equal(f.db.prepare("SELECT count(*) n FROM admin_audit WHERE action='owner.verified'").get().n,1);
});

test('verified owner registration ignores role input and promotes only the configured mailbox',async t=>{
  const f=await fixture(t,{ownerEmail:` ${owner.toUpperCase()} `});
  const ownerAccount=await f.register(owner,{role:'user'});
  assert.equal(ownerAccount.value.user.role,'admin');
  assert.ok(ownerAccount.value.user.emailVerifiedAt);
  const other=await f.register('other@example.com',{role:'admin',name:owner});
  assert.equal(other.value.user.role,'user');
  assert.equal(f.db.prepare("SELECT count(*) n FROM users WHERE role='admin'").get().n,1);
});

test('existing verified identities can gain owner role through password login or an existing session',async t=>{
  const f=await fixture(t);
  const existing=await f.legacy(owner,{verified:true});
  const promoted=await f.request('/api/auth/login',{data:{email:owner,password}});
  assert.equal(promoted.value.user.role,'admin');
  f.db.prepare("UPDATE users SET role='user' WHERE id=?").run(existing.id);
  const me=await f.request('/api/auth/me',{cookie:existing.cookie});
  assert.equal(me.value.user.role,'admin');
  assert.equal(ensureOwnerAdmin(f.db,{id:existing.id,role:'user'},owner).role,'admin');
});

test('owner password reset promotes only after successful ownership proof and revokes old sessions',async t=>{
  const f=await fixture(t);
  const existing=await f.legacy();
  const reset=await f.request('/api/auth/password/reset',{data:{...await f.code(owner,'reset'),password:'Replacement-owner-password-2026'}});
  assert.equal(reset.status,200);
  assert.equal(f.db.prepare('SELECT role FROM users WHERE id=?').get(existing.id).role,'admin');
  assert.equal((await f.request('/api/auth/me',{cookie:existing.cookie})).status,401);
});

test('legacy users.email and untrusted user role fields do not substitute for a verified identity',async t=>{
  const f=await fixture(t);
  const existing=await f.legacy(owner,{verified:false});
  f.db.prepare("UPDATE auth_identities SET address='different@example.com',verified_at=? WHERE user_id=?").run(timestamp(),existing.id);
  assert.equal(ensureOwnerAdmin(f.db,{id:existing.id,role:'admin',email:owner,emailVerifiedAt:timestamp()},owner).role,'user');
  assert.equal((await f.request('/api/admin',{cookie:existing.cookie})).status,403);
  const manual=await f.legacy('existing-admin@example.com',{role:'admin'});
  assert.equal((await f.request('/api/admin/overview',{cookie:manual.cookie})).status,200);
  assert.equal(f.db.prepare('SELECT role FROM users WHERE id=?').get(manual.id).role,'admin');
});

test('owner promotion and audit insertion are atomic',async t=>{
  const f=await fixture(t);
  const existing=await f.legacy(owner,{verified:true});
  f.db.exec("CREATE TRIGGER reject_test_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.throws(()=>ensureOwnerAdmin(f.db,existing.id,owner));
  assert.equal(f.db.prepare('SELECT role FROM users WHERE id=?').get(existing.id).role,'user');
  f.db.exec('DROP TRIGGER reject_test_audit;');
  assert.equal(ensureOwnerAdmin(f.db,existing.id,owner).role,'admin');
});

test('admin users paginate, cap page size and filter safely without accepting arbitrary SQL',async t=>{
  const f=await fixture(t),admin=await f.register();
  for(let i=0;i<55;i++)f.seedUser(i<3?'特别研究者':'普通研究者',i);
  const response=await f.request('/api/admin/users?page=1&pageSize=1000',{cookie:admin.cookie});
  assert.equal(response.status,200);
  assert.equal(response.value.pageSize,50);
  assert.equal(response.value.items.length,50);
  assert.equal(response.value.total,56);
  const next=await f.request('/api/admin/users?page=2&pageSize=50',{cookie:admin.cookie});
  assert.equal(next.value.items.length,6);
  assert.equal(new Set([...response.value.items,...next.value.items].map(item=>item.id)).size,56);
  const filtered=await f.request('/api/admin/users?q='+encodeURIComponent('特别')+'&status=user',{cookie:admin.cookie});
  assert.equal(filtered.value.total,3);
  assert.equal((await f.request('/api/admin/users?status=admin',{cookie:admin.cookie})).value.total,1);
  assert.equal((await f.request('/api/admin/users?q='+encodeURIComponent("' OR 1=1 --"),{cookie:admin.cookie})).value.total,0);
  for(const query of ['page=0','page=-1','page=1.5','pageSize=0','status=owner','sort=password_hash','page=1&page=2','q='+'x'.repeat(101)]){
    assert.equal((await f.request('/api/admin/users?'+query,{cookie:admin.cookie})).status,400);
  }
  const legacy=await f.request('/api/admin',{cookie:admin.cookie});
  assert.ok(legacy.value.users.length<=100);
});

test('overview and list metadata come from persisted data without exposing document or credential bodies',async t=>{
  const f=await fixture(t),admin=await f.register();
  const user=f.seedUser('数据研究者',1),at=timestamp();
  f.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run('project',user,'实际项目','本科','教育',at,at);
  f.db.prepare('INSERT INTO files(id,user_id,project_id,name,kind,bytes,sha256,body,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('file',user,'project','paper.txt','txt',123,'private-file-hash',Buffer.from('private-file-body'),at);
  for(const status of ['queued','running','failed','completed','cancelled'])f.job(user,status,`job-${status}`);
  f.db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run('result',user,'project','job-completed','polish','实际成果','private-result-body',at);
  f.db.prepare('INSERT INTO feedback VALUES(?,?,?,?,?)').run('feedback',user,'产品建议','反馈内容',at);
  f.db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run('order',user,'basic','pending',at);
  f.db.prepare('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)').run('usage',user,'job-completed','test_provider','test_model',null,12,0,at);
  const overview=await f.request('/api/admin/overview',{cookie:admin.cookie});
  assert.equal(overview.status,200);
  assert.deepEqual(overview.value.metrics,{users:2,projects:1,files:1,storageBytes:123,jobs:5,queued:1,running:1,failed:1,completed:1,results:1,feedbackOpen:1,orders:1});
  assert.equal(overview.value.daily.length,7);
  assert.equal(overview.value.daily.reduce((total,day)=>total+day.jobs,0),5);
  assert.equal(overview.value.services.payment,false);
  assert.equal((await f.request('/api/admin/overview?days=30',{cookie:admin.cookie})).value.daily.length,30);
  assert.equal((await f.request('/api/admin/overview?days=365',{cookie:admin.cookie})).status,400);
  for(const name of ['users','jobs','results','orders','usage','audit']){
    const list=await f.request('/api/admin/'+name,{cookie:admin.cookie});
    assert.equal(list.status,200);
    const serialized=JSON.stringify(list.value);
    for(const secret of ['private-original-document','private-result-body','private-file-body','private-input-hash','private-file-hash',privateKey,'password_hash','code_hash'])assert.equal(serialized.includes(secret),false,`${name} leaked ${secret}`);
    if(name==='users'){
      const row=list.value.items.find(item=>item.id===user);
      assert.equal(row.project_count,1);
      assert.equal(row.job_count,5);
      assert.equal(row.email_verified_at,null);
    }
    if(name==='usage'){assert.equal(list.value.items[0].input_tokens,null);assert.equal(list.value.items[0].output_tokens,12);}
    if(name==='orders')assert.equal('amount' in list.value.items[0],false);
  }
  const failed=await f.request('/api/admin/jobs?status=failed',{cookie:admin.cookie});
  assert.equal(failed.value.total,1);
  assert.ok(failed.value.items[0].error.includes('[已隐藏]'));
  assert.equal((await f.request('/api/admin/usage?status=unbilled',{cookie:admin.cookie})).value.total,1);
  assert.equal((await f.request('/api/admin/usage?status=billable',{cookie:admin.cookie})).value.total,0);
  const usageByJob=await f.request('/api/admin/usage?q=job-completed',{cookie:admin.cookie});
  assert.equal(usageByJob.status,200);
  assert.equal(usageByJob.value.total,1);
  assert.equal(usageByJob.value.items[0].id,'usage');
  assert.equal(usageByJob.value.items[0].job_id,'job-completed');
  assert.equal((await f.request('/api/admin/usage?q=job-queued',{cookie:admin.cookie})).value.total,0);
  assert.equal((await f.request('/api/admin/results?status=completed',{cookie:admin.cookie})).status,400);
});

test('admin cancels only active jobs, handles competing cancellation and writes an audit record once',async t=>{
  const f=await fixture(t),admin=await f.register();
  const id=admin.value.user.id;
  for(const status of ['queued','running','failed','completed','cancelled'])f.job(id,status,status);
  const results=await Promise.all([
    f.request('/api/admin/jobs/queued/cancel',{cookie:admin.cookie,data:{}}),
    f.request('/api/admin/jobs/queued/cancel',{cookie:admin.cookie,data:{}}),
  ]);
  assert.deepEqual(results.map(item=>item.status).sort(),[200,409]);
  assert.equal((await f.request('/api/admin/jobs/running/cancel',{cookie:admin.cookie,data:{}})).status,200);
  for(const status of ['failed','completed','cancelled'])assert.equal((await f.request(`/api/admin/jobs/${status}/cancel`,{cookie:admin.cookie,data:{}})).status,409);
  assert.equal((await f.request('/api/admin/jobs/missing/cancel',{cookie:admin.cookie,data:{}})).status,404);
  assert.equal((await f.request('/api/admin/jobs/failed/retry',{cookie:admin.cookie,data:{}})).status,404);
  assert.deepEqual(f.cancelled.sort(),['queued','running']);
  assert.equal(f.db.prepare("SELECT count(*) n FROM admin_audit WHERE action='job.cancel'").get().n,2);
  assert.equal(f.db.prepare("SELECT status FROM jobs WHERE id='completed'").get().status,'completed');
});

test('feedback handling keeps original content, validates updates and audits without copying private notes',async t=>{
  const f=await fixture(t),admin=await f.register();
  const user=f.seedUser('反馈用户',1),at=timestamp();
  f.db.prepare('INSERT INTO feedback VALUES(?,?,?,?,?)').run('feedback',user,'功能建议','原始反馈不能改写',at);
  const before=await f.request('/api/admin/feedback?status=open',{cookie:admin.cookie});
  assert.equal(before.value.items[0].status,'open');
  assert.equal(before.value.items[0].note,'');
  const update=await f.request('/api/admin/feedback/feedback',{cookie:admin.cookie,data:{status:'processing',note:'  仅供处理人员查看的备注  '}});
  assert.deepEqual(update.value,{ok:true});
  const current=await f.request('/api/admin/feedback?status=processing',{cookie:admin.cookie});
  assert.equal(current.value.items[0].body,'原始反馈不能改写');
  assert.equal(current.value.items[0].note,'仅供处理人员查看的备注');
  assert.equal(current.value.items[0].updated_by,admin.value.user.id);
  assert.equal((await f.request('/api/admin/overview',{cookie:admin.cookie})).value.metrics.feedbackOpen,1);
  await f.request('/api/admin/feedback/feedback',{cookie:admin.cookie,data:{status:'resolved',note:'已处理'}});
  assert.equal((await f.request('/api/admin/overview',{cookie:admin.cookie})).value.metrics.feedbackOpen,0);
  for(const data of [{status:'deleted',note:''},{status:'open',note:123},{status:'open',note:'x'.repeat(2001)}]){
    assert.equal((await f.request('/api/admin/feedback/feedback',{cookie:admin.cookie,data})).status,400);
  }
  assert.equal((await f.request('/api/admin/feedback/missing',{cookie:admin.cookie,data:{status:'open',note:''}})).status,404);
  const audit=await f.request('/api/admin/audit?q=feedback.update',{cookie:admin.cookie});
  assert.equal(audit.value.total,2);
  assert.equal(typeof audit.value.items[0].detail,'object');
  assert.equal(JSON.stringify(audit.value).includes('仅供处理人员查看的备注'),false);
  assert.equal(f.db.prepare('SELECT body FROM feedback').get().body,'原始反馈不能改写');
});

test('model settings validate changes, enforce origin and expose status without provider credentials',async t=>{
  const f=await fixture(t),admin=await f.register();
  const settings=await f.request('/api/admin/settings',{cookie:admin.cookie});
  assert.equal(settings.value.ai.model,'configured-model');
  assert.deepEqual(settings.value.auth,{emailCode:true,phoneCode:true});
  assert.deepEqual(settings.value.storage,{provider:'local_server_sqlite'});
  assert.equal(settings.value.payment,false);
  assert.equal(JSON.stringify(settings.value).includes(privateKey),false);
  assert.equal((await f.request('/api/admin/model',{cookie:admin.cookie,data:{model:'changed-model',enabled:false},origin:'https://attacker.invalid'})).status,403);
  assert.equal((await f.request('/api/admin/model',{cookie:admin.cookie,data:{model:'<script>',enabled:true}})).status,400);
  assert.equal((await f.request('/api/admin/model',{cookie:admin.cookie,data:{model:'model',enabled:'yes'}})).status,400);
  const updated=await f.request('/api/admin/model',{cookie:admin.cookie,data:{model:'changed-model',enabled:false,apiKey:'ignored-fake-key',url:'https://fake.invalid'}});
  assert.equal(updated.status,200);
  assert.equal(updated.value.ai.model,'changed-model');
  assert.equal(updated.value.ai.ready,false);
  assert.equal(f.config.getAI().aiKey,privateKey);
  const audit=await f.request('/api/admin/audit?q=model.update',{cookie:admin.cookie});
  assert.equal(audit.value.total,1);
  assert.deepEqual(audit.value.items[0].detail.to,{model:'changed-model',enabled:false});
  assert.equal(JSON.stringify(audit.value).includes(privateKey),false);
  assert.equal(JSON.stringify(audit.value).includes('ignored-fake-key'),false);
});

test('feedback state and model changes roll back if their audit write fails',async t=>{
  const f=await fixture(t),admin=await f.register();
  f.db.prepare('INSERT INTO feedback VALUES(?,?,?,?,?)').run('feedback',admin.value.user.id,'产品建议','原始正文',timestamp());
  f.db.exec("CREATE TRIGGER reject_changes BEFORE INSERT ON admin_audit WHEN NEW.action!='owner.verified' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
  assert.equal((await f.request('/api/admin/feedback/feedback',{cookie:admin.cookie,data:{status:'resolved',note:'fake'}})).status,500);
  assert.equal(f.db.prepare('SELECT count(*) n FROM feedback_management').get().n,0);
  assert.equal((await f.request('/api/admin/model',{cookie:admin.cookie,data:{model:'should-rollback',enabled:false}})).status,500);
  assert.equal(f.config.getAI().aiModel,'configured-model');
  const queued=f.job(admin.value.user.id,'queued');
  assert.equal((await f.request(`/api/admin/jobs/${queued}/cancel`,{cookie:admin.cookie,data:{}})).status,500);
  assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(queued).status,'queued');
  assert.equal(f.cancelled.length,0);
});

test('administrator API does not offer role changes and an ordinary account cannot self-promote',async t=>{
  const f=await fixture(t),admin=await f.register(),user=await f.register('ordinary@example.com');
  assert.equal((await f.request(`/api/admin/users/${user.value.user.id}`,{cookie:admin.cookie,data:{role:'admin'}})).status,404);
  assert.equal((await f.request('/api/admin/users',{cookie:user.cookie,data:{id:user.value.user.id,role:'admin'}})).status,403);
  assert.equal(f.db.prepare('SELECT role FROM users WHERE id=?').get(user.value.user.id).role,'user');
  assert.equal(sessionUser(f.db,{headers:{cookie:user.cookie}},owner).role,'user');
});
