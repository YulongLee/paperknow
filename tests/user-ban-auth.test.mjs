import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {database} from '../backend/database.mjs';
import {createAuthService} from '../backend/auth-service.mjs';
import {accountIsBanned,createSession,ensureOwnerAdmin,hashPassword,sessionUser} from '../backend/auth.mjs';
import {createServer} from '../server.mjs';

const password='Account-test-original-2026',secret='test-auth-ban-code-secret-at-least-32-characters';
const account={id:'ban-auth-user',email:'banned-fixture@example.test',name:'账号管理验收'};
function managementSchema(db){db.exec(`CREATE TABLE IF NOT EXISTS user_management(user_id TEXT PRIMARY KEY REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('active','banned')),version INTEGER NOT NULL,reason TEXT NOT NULL,updated_by TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL)`);}
function status(db,value){db.prepare(`INSERT INTO user_management(user_id,status,version,reason,updated_by,updated_at) VALUES(?,?,1,?,?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,version=user_management.version+1,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(account.id,value,'仅测试的内部封禁备注',account.id,new Date().toISOString());}
async function fixture(t,{verified=true,owner=false}={}){
 const db=database(':memory:');managementSchema(db);t.after(()=>db.close());
 const hash=await hashPassword(password),at=new Date().toISOString();
 db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(account.id,account.email,account.name,hash,'user',at);
 db.prepare('INSERT INTO auth_identities(channel,address,user_id,verified_at,created_at) VALUES(?,?,?,?,?)').run('email',account.email,account.id,verified?at:null,at);
 let time=Date.now();const deliveries=[];
 const service=createAuthService(db,{secret,ownerEmail:owner?account.email:undefined,clock:()=>time,delivery:{ready:{email:true},async send(value){deliveries.push(value);}}});
 async function code(purpose='login'){time+=61000;const response=await service.sendCode({channel:'email',address:account.email,purpose},'203.0.113.9');return {...response,code:deliveries.at(-1).code};}
 return {db,service,hash,code};
}
const banned=cause=>cause.status===403&&cause.code==='ACCOUNT_BANNED'&&!cause.message.includes('内部封禁备注');

test('a ban blocks new password sessions, survives a new service, and unban requires fresh authentication',async t=>{
 const f=await fixture(t);const before=await f.service.passwordLogin({identifier:account.email,password});
 status(f.db,'banned');f.db.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id);
 await assert.rejects(f.service.passwordLogin({identifier:account.email,password}),banned);
 assert.equal(sessionUser(f.db,{headers:{cookie:'pk_session='+before.token}}),null);
 assert.throws(()=>createSession(f.db,account.id),banned);
 assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
 const restarted=createAuthService(f.db,{secret,delivery:{ready:{},send(){}}});
 await assert.rejects(restarted.passwordLogin({identifier:account.email,password}),banned);
 status(f.db,'active');
 assert.equal(sessionUser(f.db,{headers:{cookie:'pk_session='+before.token}}),null);
 const after=await restarted.passwordLogin({identifier:account.email,password});
 assert.equal(after.user.id,account.id);assert.notEqual(after.token,before.token);
 assert.equal(sessionUser(f.db,{headers:{cookie:'pk_session='+after.token}}).id,account.id);
});

test('current persisted status rejects even an unrevoked session and cannot auto-promote a banned verified owner',async t=>{
 const f=await fixture(t,{owner:true}),token=createSession(f.db,account.id);
 status(f.db,'banned');
 assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,1);
 assert.equal(sessionUser(f.db,{headers:{cookie:'pk_session='+token}},account.email),null);
 assert.throws(()=>ensureOwnerAdmin(f.db,account.id,account.email),banned);
 assert.equal(f.db.prepare('SELECT role FROM users WHERE id=?').get(account.id).role,'user');
});

test('a ban that lands during password verification is re-read before any session or owner elevation',async t=>{
 const f=await fixture(t,{owner:true});
 const login=f.service.passwordLogin({identifier:account.email,password});
 status(f.db,'banned');
 await assert.rejects(login,banned);
 assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
 assert.equal(f.db.prepare('SELECT role FROM users WHERE id=?').get(account.id).role,'user');
});

test('a valid code issued before the ban cannot verify or clear an unverified legacy account',async t=>{
 const f=await fixture(t,{verified:false}),input=await f.code();
 status(f.db,'banned');
 await assert.rejects(f.service.codeLogin(input),banned);
 assert.equal(f.db.prepare('SELECT status FROM auth_challenges WHERE id=?').get(input.challengeId).status,'consumed');
 assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(account.id).password_hash,f.hash);
 assert.equal(f.db.prepare('SELECT verified_at FROM auth_identities WHERE user_id=?').get(account.id).verified_at,null);
 assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
 status(f.db,'active');await assert.rejects(f.service.codeLogin(input),{status:401});
 const fresh=await f.service.codeLogin(await f.code());assert.equal(fresh.user.id,account.id);
});

test('password recovery cannot undo a ban, change its internal reason or promote a verified owner',async t=>{
 const f=await fixture(t,{owner:true}),input=await f.code('reset');status(f.db,'banned');
 await assert.rejects(f.service.resetPassword({...input,password:'Account-test-replaced-2026'}),banned);
 assert.equal(f.db.prepare('SELECT status FROM user_management WHERE user_id=?').get(account.id).status,'banned');
 assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(account.id).password_hash,f.hash);
 assert.equal(f.db.prepare('SELECT role FROM users WHERE id=?').get(account.id).role,'user');
 assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
});

test('legacy authentication handles absent management schemas without caching the absence',()=>{
 const db=new DatabaseSync(':memory:');try{
  assert.equal(accountIsBanned(db,'legacy'),false);
  db.exec('CREATE TABLE user_management(user_id TEXT PRIMARY KEY,status TEXT); INSERT INTO user_management VALUES(\'legacy\',\'banned\')');
  assert.equal(accountIsBanned(db,'legacy'),true);
  db.exec("UPDATE user_management SET status='active' WHERE user_id='legacy'");
  assert.equal(accountIsBanned(db,'legacy'),false);
 }finally{db.close();}
});

test('HTTP private reads, writes and both authentication methods reject a banned account until an explicit unban',async t=>{
 const deliveries=new Map(),app=createServer({dbPath:':memory:',config:{authCodeSecret:secret,authDelivery:{ready:{email:true},async send(value){deliveries.set(value.address,value);}}}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());managementSchema(app.db);
 const base='http://127.0.0.1:'+app.server.address().port,at=new Date().toISOString();
 app.db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(account.id,account.email,account.name,await hashPassword(password),'user',at);
 app.db.prepare('INSERT INTO auth_identities(channel,address,user_id,verified_at,created_at) VALUES(?,?,?,?,?)').run('email',account.email,account.id,at,at);
 async function request(path,body,cookie=''){
  const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 const login=await request('/auth/login',{identifier:account.email,password});assert.equal(login.status,200);
 const sent=await request('/auth/code/send',{channel:'email',address:account.email,purpose:'login'});assert.equal(sent.status,200);
 status(app.db,'banned');
 for(const [path,body] of [['/auth/me'],['/projects'],['/projects',{name:'应被拦截的项目'}],['/admin/users']])assert.equal((await request(path,body,login.cookie)).status,401);
 const blocked=await request('/auth/login',{identifier:account.email,password});assert.equal(blocked.status,403);assert.match(blocked.body.error,/封禁/);assert.equal(blocked.cookie,undefined);
 const codeLogin=await request('/auth/code/login',{challengeId:sent.body.challengeId,code:deliveries.get(account.email).code});assert.equal(codeLogin.status,403);assert.equal(codeLogin.cookie,undefined);
 assert.equal(app.db.prepare('SELECT count(*) n FROM projects WHERE user_id=?').get(account.id).n,0);
 app.db.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id);status(app.db,'active');
 assert.equal((await request('/auth/me',undefined,login.cookie)).status,401);
 const fresh=await request('/auth/login',{identifier:account.email,password});assert.equal(fresh.status,200);
 assert.equal((await request('/auth/me',undefined,fresh.cookie)).status,200);
});
