import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database} from '../backend/database.mjs';
import {createAuthService} from '../backend/auth-service.mjs';
import {createSession,digest,hashPassword,safeUser,sessionUser,verifyPassword} from '../backend/auth.mjs';

const secret='auth-tests-use-only-a-fixed-64-character-secret-never-production-1234';
const password='Test-account-password-2026';
const userName='测试研究者';
const email='researcher@example.com';
const phone='13800138000';

function fixture(t,{db=database(':memory:'),delivery:customDelivery,authSecret=secret}={}){
  t.after(()=>db.close());
  let time=Date.now();
  const delivered=[];
  const delivery=customDelivery||{ready:{email:true,phone:true},async send(message){delivered.push(message);}};
  const service=createAuthService(db,{secret:authSecret,delivery,clock:()=>time});
  const advance=(ms=60001)=>{time+=ms;};
  async function code(channel='email',address=email,purpose='register',ip='203.0.113.5'){
    const challenge=await service.sendCode({channel,address,purpose},ip);
    return {...challenge,code:delivered.at(-1)?.code};
  }
  async function register(channel='email',address=email){return service.register({...await code(channel,address),name:userName,password});}
  return {db,service,delivery,delivered,advance,code,register,clock:()=>time};
}
const rejectStatus=(promise,status)=>assert.rejects(promise,{status});

test('disabled providers and missing signing key never issue a challenge or pretend to send',async t=>{
  const f=fixture(t,{authSecret:''});
  assert.deepEqual(f.service.options(),{password:true,emailCode:false,phoneCode:false,registration:{email:false,phone:false},codeLength:6,retryAfter:60});
  await rejectStatus(f.code(),503);
  assert.equal(f.delivered.length,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM auth_challenges').get().n,0);
  const disabled=createAuthService(f.db,{secret,delivery:{ready:{email:true,phone:false},async send(){}}});
  assert.equal(disabled.options().emailCode,true);
  assert.equal(disabled.options().phoneCode,false);
  await rejectStatus(disabled.sendCode({channel:'phone',address:phone,purpose:'register'},'203.0.113.2'),503);
});

test('verified email registration stores only a password hash and keyed challenge hash',async t=>{
  const f=fixture(t);
  const challenge=await f.code('email',' Researcher@Example.COM ');
  assert.match(challenge.code,/^\d{6}$/);
  const sent=f.delivered[0];
  assert.equal(sent.address,email);
  assert.equal(sent.purpose,'register');
  const row=f.db.prepare('SELECT * FROM auth_challenges').get();
  assert.equal(row.code_hash.length,64);
  assert.notEqual(row.code_hash,digest(challenge.code));
  assert.equal(Object.values(row).includes(challenge.code),false);
  const account=await f.service.register({...challenge,name:userName,password});
  assert.equal(account.user.email,email);
  assert.equal(account.user.phone,null);
  assert.equal(account.user.hasPassword,true);
  assert.ok(account.user.emailVerifiedAt);
  assert.equal(account.user.phoneVerifiedAt,null);
  assert.equal('password_hash' in account.user,false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,1);
  assert.equal(await verifyPassword(password,f.db.prepare('SELECT password_hash FROM users').get().password_hash),true);
  assert.equal(f.db.prepare('SELECT status FROM auth_challenges').get().status,'consumed');
  assert.equal(sessionUser(f.db,{headers:{cookie:`pk_session=${account.token}`}}).id,account.user.id);
  assert.equal(f.db.prepare('SELECT token_hash FROM sessions').get().token_hash,digest(account.token));
  await rejectStatus(f.service.register({...challenge,name:'重放',password}),401);
});

test('phone registration requires proof and supports normalized phone password and code login',async t=>{
  const f=fixture(t);
  await rejectStatus(f.service.register({challengeId:'unknown',code:'123456',name:userName,password}),401);
  assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,0);
  const account=await f.register('phone',phone);
  assert.equal(account.user.phone,'+8613800138000');
  assert.equal(account.user.email,null);
  assert.ok(account.user.phoneVerifiedAt);
  assert.equal((await f.service.passwordLogin({identifier:'+86 13800138000',password})).user.id,account.user.id);
  f.advance();
  const logged=await f.service.codeLogin(await f.code('phone',phone,'login'));
  assert.equal(logged.user.id,account.user.id);
  assert.equal(logged.user.hasPassword,true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,1);
});

test('code login never registers an unknown account and does not leave a session',async t=>{
  const f=fixture(t);
  const challenge=await f.code('email',email,'login');
  await rejectStatus(f.service.codeLogin(challenge),401);
  assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
  assert.equal(f.db.prepare('SELECT status FROM auth_challenges').get().status,'consumed');
});

test('same recipient cooldown applies across purposes and survives service recreation',async t=>{
  const f=fixture(t);
  await f.code();
  await rejectStatus(f.code('email',email,'login'),429);
  const restarted=createAuthService(f.db,{secret,delivery:f.delivery,clock:f.clock});
  await rejectStatus(restarted.sendCode({channel:'email',address:email,purpose:'reset'},'198.51.100.9'),429);
  f.advance();
  await restarted.sendCode({channel:'email',address:email,purpose:'reset'},'198.51.100.9');
  assert.equal(f.delivered.length,2);
});

test('wrong codes lock after five attempts and attempts persist across restarts',async t=>{
  const f=fixture(t);
  const challenge=await f.code();
  const wrong=challenge.code==='000000'?'000001':'000000';
  for(let i=0;i<4;i++)await rejectStatus(f.service.register({...challenge,code:wrong,name:userName,password}),401);
  const restarted=createAuthService(f.db,{secret,delivery:f.delivery,clock:f.clock});
  await rejectStatus(restarted.register({...challenge,code:wrong,name:userName,password}),401);
  assert.equal(f.db.prepare('SELECT attempts FROM auth_challenges').get().attempts,5);
  assert.equal(f.db.prepare('SELECT status FROM auth_challenges').get().status,'locked');
  await rejectStatus(restarted.register({...challenge,name:userName,password}),401);
  assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,0);
});

test('challenge codes are recipient-bound, purpose-bound and expire after five minutes',async t=>{
  const f=fixture(t);
  const first=await f.code();
  const second=await f.code('email','second@example.com');
  const mixed=first.code===second.code?'not-a-code':second.code;
  await rejectStatus(f.service.register({...first,code:mixed,name:userName,password}),401);
  await rejectStatus(f.service.codeLogin(first),401);
  await rejectStatus(f.service.resetPassword({...first,password}),401);
  assert.equal(f.db.prepare('SELECT status FROM auth_challenges WHERE id=?').get(first.challengeId).status,'sent');
  f.advance(300000);
  await rejectStatus(f.service.register({...first,name:userName,password}),401);
  assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,0);
});

test('resending invalidates the previous challenge, including across different purposes',async t=>{
  const f=fixture(t);
  const old=await f.code();
  f.advance();
  const fresh=await f.code();
  await rejectStatus(f.service.register({...old,name:userName,password}),401);
  assert.equal(f.db.prepare('SELECT status FROM auth_challenges WHERE id=?').get(old.challengeId).status,'superseded');
  await f.service.register({...fresh,name:userName,password});
});

test('pending and failed delivery cannot authenticate and failure details stay private',async t=>{
  let message,release;
  const delivery={ready:{email:true},send(value){message=value;return new Promise((resolve,reject)=>{release=reject;});}};
  const f=fixture(t,{delivery});
  const pending=f.service.sendCode({channel:'email',address:email,purpose:'register'},'203.0.113.1');
  const id=f.db.prepare('SELECT id FROM auth_challenges').get().id;
  await rejectStatus(f.service.register({challengeId:id,code:message.code,name:userName,password}),401);
  release(new Error('provider-secret-must-not-be-shown'));
  await assert.rejects(pending,cause=>cause.status===503&&!cause.message.includes('provider-secret'));
  assert.equal(f.db.prepare('SELECT status FROM auth_challenges').get().status,'failed');
  await rejectStatus(f.service.register({challengeId:id,code:message.code,name:userName,password}),401);
  await rejectStatus(f.service.sendCode({channel:'email',address:email,purpose:'register'},'203.0.113.1'),429);
});

test('out-of-order provider responses never reactivate a superseded code',async t=>{
  const deliveries=[];
  const delivery={ready:{email:true},send(message){return new Promise(resolve=>deliveries.push({message,resolve}));}};
  const f=fixture(t,{delivery});
  const first=f.service.sendCode({channel:'email',address:email,purpose:'register'},'203.0.113.1');
  f.advance();
  const second=f.service.sendCode({channel:'email',address:email,purpose:'register'},'203.0.113.1');
  deliveries[1].resolve();
  const fresh=await second;
  deliveries[0].resolve();
  await rejectStatus(first,409);
  await f.service.register({...fresh,code:deliveries[1].message.code,name:userName,password});
  assert.equal(f.db.prepare("SELECT count(*) n FROM auth_challenges WHERE status='consumed'").get().n,1);
});

test('parallel consumers create at most one account and one session',async t=>{
  const f=fixture(t);
  const input={...await f.code(),name:userName,password};
  const outcomes=await Promise.allSettled([f.service.register(input),f.service.register(input)]);
  assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,1);
  assert.equal(outcomes.find(item=>item.status==='rejected').reason.status,401);
  assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,1);
});

test('a challenge that expires during password hashing cannot register an account',async t=>{
  const f=fixture(t);
  const input={...await f.code(),name:userName,password};
  const registering=f.service.register(input);
  f.advance(300001);
  await rejectStatus(registering,401);
  assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
});

test('duplicate verified registration preserves the original identity, password and role',async t=>{
  const f=fixture(t);
  const original=await f.register();
  f.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(original.user.id);
  f.advance();
  await rejectStatus(f.service.register({...await f.code(),name:'替换身份',password:'Replacement-password-2026'}),409);
  const user=(await f.service.passwordLogin({email,password})).user;
  assert.equal(user.id,original.user.id);
  assert.equal(user.name,userName);
  assert.equal(user.role,'admin');
});

test('first verified login to a legacy mailbox revokes sessions and the unverified password',async t=>{
  const f=fixture(t);
  const id='legacy-user';
  f.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,email,userName,await hashPassword(password),'user',new Date().toISOString());
  const old=await f.service.passwordLogin({email,password});
  assert.equal(old.user.emailVerifiedAt,null);
  assert.equal(old.user.hasPassword,true);
  const verified=await f.service.codeLogin(await f.code('email',email,'login'));
  assert.equal(verified.user.id,id);
  assert.equal(verified.user.hasPassword,false);
  assert.ok(verified.user.emailVerifiedAt);
  assert.equal(sessionUser(f.db,{headers:{cookie:`pk_session=${old.token}`}}),null);
  assert.equal(sessionUser(f.db,{headers:{cookie:`pk_session=${verified.token}`}}).id,id);
  await rejectStatus(f.service.passwordLogin({email,password}),401);
});

test('stricter delivery validation does not lock out legacy email password accounts',async t=>{
  const f=fixture(t);
  const address="o'ne@example.com";
  f.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('legacy-address',address,userName,await hashPassword(password),'user',new Date().toISOString());
  assert.equal((await f.service.passwordLogin({email:address,password})).user.id,'legacy-address');
  await rejectStatus(f.service.sendCode({channel:'email',address,purpose:'login'},'192.0.2.1'),400);
  assert.equal(f.delivered.length,0);
});

test('password reset verifies ownership, preserves identity, revokes sessions and cannot replay',async t=>{
  const f=fixture(t);
  const original=await f.register('phone',phone);
  const second=await f.service.passwordLogin({identifier:phone,password});
  f.advance();
  const challenge=await f.code('phone',phone,'reset');
  const newPassword='A-new-password-with-words-2026';
  assert.deepEqual(await f.service.resetPassword({...challenge,password:newPassword}),{ok:true});
  assert.equal(sessionUser(f.db,{headers:{cookie:`pk_session=${original.token}`}}),null);
  assert.equal(sessionUser(f.db,{headers:{cookie:`pk_session=${second.token}`}}),null);
  await rejectStatus(f.service.passwordLogin({identifier:phone,password}),401);
  assert.equal((await f.service.passwordLogin({identifier:phone,password:newPassword})).user.id,original.user.id);
  await rejectStatus(f.service.resetPassword({...challenge,password:'Another-password-2026'}),401);
});

test('password verification underway cannot create a session after a password change',async t=>{
  const f=fixture(t);
  const original=await f.register();
  const login=f.service.passwordLogin({email,password});
  f.db.prepare('UPDATE users SET password_hash=NULL WHERE id=?').run(original.user.id);
  f.db.prepare('DELETE FROM sessions').run();
  await rejectStatus(login,401);
  assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
});

test('sending is limited per address, per IP and globally using durable counters',async t=>{
  const f=fixture(t);
  for(let i=0;i<6;i++){await f.code('email',email,'login',`203.0.113.${i+1}`);f.advance();}
  await rejectStatus(f.code('email',email,'login','203.0.113.200'),429);
  for(let i=0;i<20;i++)await f.code('email',`ip-${i}@example.com`,'login','198.51.100.2');
  await rejectStatus(f.code('email','ip-next@example.com','login','198.51.100.2'),429);
  // Exhaust all active limits directly, then a fresh IP/address must still hit
  // the global budget without sending a hundred fixtures per test run.
  f.db.prepare('UPDATE auth_rate_limits SET count=100').run();
  await rejectStatus(f.code('email','global@example.com','login','192.0.2.99'),429);
  const restarted=createAuthService(f.db,{secret,delivery:f.delivery,clock:f.clock});
  await rejectStatus(restarted.sendCode({channel:'phone',address:phone,purpose:'login'},'192.0.2.100'),429);
});

test('password abuse counters are account-bound and do not disclose whether the account exists',async t=>{
  const f=fixture(t);
  await f.register();
  let knownError,unknownError;
  try{await f.service.passwordLogin({email,password:'Incorrect-password'});}catch(cause){knownError=cause;}
  try{await f.service.passwordLogin({email:'unknown@example.com',password:'Incorrect-password'});}catch(cause){unknownError=cause;}
  assert.equal(knownError.status,401);
  assert.equal(knownError.message,unknownError.message);
  for(let i=1;i<20;i++)await rejectStatus(f.service.passwordLogin({email,password:'Incorrect-password'},`203.0.113.${i}`),401);
  const restarted=createAuthService(f.db,{secret,delivery:f.delivery,clock:f.clock});
  await rejectStatus(restarted.passwordLogin({email,password},'192.0.2.2'),429);
});

test('invalid addresses, purposes and weak passwords cannot create accounts',async t=>{
  const f=fixture(t);
  for(const input of [
    {channel:'email',address:'invalid',purpose:'register'},
    {channel:'email',address:'one@example.com,two@example.com',purpose:'register'},
    {channel:'email',address:'User <one@example.com>',purpose:'register'},
    {channel:'email',address:'"one"@example.com',purpose:'register'},
    {channel:'email',address:"o'ne@example.com",purpose:'register'},
    {channel:'email',address:'one;two@example.com',purpose:'register'},
    {channel:'email',address:'one@example.com\r\nBcc:other@example.com',purpose:'register'},
    {channel:'email',address:'one..two@example.com',purpose:'register'},
    {channel:'email',address:'one@-example.com',purpose:'register'},
    {channel:'phone',address:'+12025550123',purpose:'register'},
    {channel:'phone',address:'13800138000<script>',purpose:'register'},
    {channel:'other',address:email,purpose:'register'},
    {channel:'email',address:email,purpose:'bind'},
  ])await rejectStatus(f.service.sendCode(input,'192.0.2.1'),400);
  const challenge=await f.code();
  for(const invalid of ['',null,'short',' '.repeat(12),'x'.repeat(129)])await rejectStatus(f.service.register({...challenge,name:userName,password:invalid}),400);
  assert.equal(f.delivered.length,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,0);
});

test('configured global send budget applies across addresses, channels and IPs',async t=>{
  const f=fixture(t);
  const limited=createAuthService(f.db,{secret,delivery:f.delivery,clock:f.clock,dailyLimit:2});
  await limited.sendCode({channel:'email',address:email,purpose:'register'},'203.0.113.1');
  await limited.sendCode({channel:'phone',address:phone,purpose:'register'},'203.0.113.2');
  await rejectStatus(limited.sendCode({channel:'email',address:'next@example.com',purpose:'register'},'203.0.113.3'),429);
  assert.equal(f.delivered.length,2);
});

test('legacy migration preserves IDs, business foreign keys, indexes, triggers and valid sessions',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'paperknow-auth-migrate-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'old.sqlite');
  const legacy=new DatabaseSync(path);
  const schema=(await readFile(new URL('../backend/schema.sql',import.meta.url),'utf8')).split('CREATE TABLE IF NOT EXISTS auth_identities')[0]
    .replace('email TEXT UNIQUE,','email TEXT UNIQUE NOT NULL,').replace('password_hash TEXT,','password_hash TEXT NOT NULL,');
  legacy.exec(schema);
  const stored=await hashPassword(password),at=new Date().toISOString();
  legacy.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('old-user',email,userName,stored,'admin',at);
  legacy.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run('old-project','old-user','既有项目','本科','教育',at,at);
  legacy.prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?)').run('old-file','old-user','old-project','old.txt','txt',4,'hash',Buffer.from('data'),at);
  legacy.prepare('INSERT INTO jobs(id,user_id,project_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('old-job','old-user','old-project','parse','completed','completed','{}','job-key','hash',at,at);
  legacy.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run('old-result','old-user','old-project','old-job','parse','既有成果','{}',at);
  legacy.prepare('INSERT INTO result_revisions VALUES(?,?,?,?,?)').run('old-revision','old-result','old-user','人工修订',at);
  legacy.prepare('INSERT INTO service_settings VALUES(?,?,?,?)').run('ai','{}','old-user',at);
  legacy.exec('CREATE INDEX legacy_users_name ON users(name); CREATE TABLE name_audit(value TEXT); CREATE TRIGGER legacy_name_audit AFTER UPDATE OF name ON users BEGIN INSERT INTO name_audit VALUES(NEW.name); END;');
  const token=createSession(legacy,'old-user');
  legacy.close();
  const migrated=database(path);
  t.after(()=>migrated.close());
  assert.equal(migrated.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  assert.equal(migrated.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.equal(migrated.prepare('SELECT password_hash FROM users').get().password_hash,stored);
  assert.equal(migrated.prepare('SELECT role FROM users').get().role,'admin');
  for(const table of ['projects','files','jobs','results','result_revisions','service_settings']){
    const references=migrated.prepare(`PRAGMA foreign_key_list(${table})`).all();
    assert.ok(references.some(row=>row.table==='users'));
    assert.equal(migrated.prepare(`SELECT count(*) n FROM ${table}`).get().n,1);
  }
  assert.equal(sessionUser(migrated,{headers:{cookie:`pk_session=${token}`}}).id,'old-user');
  assert.equal(safeUser(migrated,'old-user').emailVerifiedAt,null);
  assert.ok(migrated.prepare("SELECT name FROM sqlite_master WHERE name='legacy_users_name'").get());
  migrated.prepare('UPDATE users SET name=? WHERE id=?').run('保留触发器','old-user');
  assert.equal(migrated.prepare('SELECT value FROM name_audit').get().value,'保留触发器');
  const backup=(await readdir(dir)).find(name=>name.includes('.before-auth-'));
  assert.ok(backup);
  assert.equal((await stat(join(dir,backup))).mode&0o777,0o600);
  const oldBackup=new DatabaseSync(join(dir,backup),{readOnly:true});
  assert.equal(oldBackup.prepare('SELECT count(*) n FROM projects').get().n,1);
  assert.equal(oldBackup.prepare('PRAGMA table_info(users)').all().find(row=>row.name==='email').notnull,1);
  oldBackup.close();
  const service=createAuthService(migrated,{secret,delivery:{ready:{},send(){}}});
  assert.equal((await service.passwordLogin({email,password})).user.id,'old-user');
});

test('migration reopens idempotently without new backups or identity duplication',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'paperknow-auth-reopen-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'current.sqlite');
  let db=database(path);
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('user',email,userName,await hashPassword(password),'user',new Date().toISOString());
  db.close();
  db=database(path);
  assert.equal(db.prepare('SELECT count(*) n FROM auth_identities').get().n,1);
  db.close();
  db=database(path);
  assert.equal(db.prepare('SELECT count(*) n FROM auth_identities').get().n,1);
  db.close();
  assert.equal((await readdir(dir)).some(name=>name.includes('.before-auth-')),false);
});

test('failed migration validation rolls back the original user schema and records',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'paperknow-auth-rollback-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'inconsistent.sqlite');
  const legacy=new DatabaseSync(path);
  legacy.exec(`PRAGMA foreign_keys=OFF;
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user',created_at TEXT NOT NULL);
    CREATE TABLE external_link(user_id TEXT REFERENCES users(id));
    INSERT INTO users VALUES('kept-user','kept@example.com','保留用户','existing-password-hash','user','2026-10-15');
    INSERT INTO external_link VALUES('missing-user');`);
  legacy.close();
  assert.throws(()=>database(path),/迁移校验失败/);
  const unchanged=new DatabaseSync(path);
  assert.equal(unchanged.prepare('SELECT id FROM users').get().id,'kept-user');
  assert.equal(unchanged.prepare('PRAGMA table_info(users)').all().find(row=>row.name==='email').notnull,1);
  assert.equal(unchanged.prepare("SELECT count(*) n FROM sqlite_master WHERE name='users_auth_migration'").get().n,0);
  unchanged.close();
});
