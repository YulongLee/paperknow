import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
import {hashPassword} from '../backend/auth.mjs';

async function fixture(t,{enabled=true,secure=false}={}) {
  const deliveries=new Map();
  const app=createServer({dbPath:':memory:',config:{secure,authCodeSecret:'private-fixture-code-secret-32-characters',authDelivery:{ready:{email:enabled,phone:enabled},async send(v){deliveries.set(v.address,v);}}}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  async function request(path,data,cookie='',origin=base.replace(/^http:/,secure?'https:':'http:')) {
    const res=await fetch(base+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:res.status,value:await res.json(),cookie:res.headers.get('set-cookie')};
  }
  async function code(channel,address,purpose) {
    app.db.prepare('UPDATE auth_challenges SET created_at=created_at-61000').run();
    const result=await request('/auth/code/send',{channel,address,purpose});assert.equal(result.status,200);
    assert.equal(JSON.stringify(result.value).includes(deliveries.get(address).code),false);
    return {challengeId:result.value.challengeId,code:deliveries.get(address).code};
  }
  return {...app,request,code};
}

test('HTTP phone registration, both login methods, reset revocation and logout work end to end',async t=>{
  const f=await fixture(t,{secure:true});const address='+8613800000123',password='fixture-original-password';
  const challenge=await f.code('phone',address,'register');
  const registered=await f.request('/auth/register',{...challenge,password,name:'手机研究者'});
  assert.equal(registered.status,200);assert.equal(registered.value.user.email,null);assert.equal(registered.value.user.phone,address);
  assert.ok(registered.value.user.phoneVerifiedAt);assert.equal(registered.value.user.hasPassword,true);
  assert.match(registered.cookie,/HttpOnly/);assert.match(registered.cookie,/SameSite=Strict/);assert.match(registered.cookie,/Secure/);
  assert.equal((await f.request('/auth/register',{...challenge,password,name:'重放'})).status,401);
  const originalCookie=registered.cookie.split(';')[0];
  assert.equal((await f.request('/auth/me',undefined,originalCookie)).value.user.id,registered.value.user.id);
  assert.equal((await f.request('/auth/login',{identifier:'13800000123',password})).status,200);
  const login=await f.code('phone',address,'login');
  assert.equal((await f.request('/auth/code/login',login)).status,200);
  const reset=await f.code('phone',address,'reset');
  const updated=await f.request('/auth/password/reset',{...reset,password:'fixture-replaced-password'});
  assert.equal(updated.status,200);assert.match(updated.cookie,/Max-Age=0/);
  assert.equal((await f.request('/auth/me',undefined,originalCookie)).status,401);
  assert.equal((await f.request('/auth/login',{identifier:address,password})).status,401);
  const logged=await f.request('/auth/login',{identifier:address,password:'fixture-replaced-password'});
  assert.equal(logged.status,200);const cookie=logged.cookie.split(';')[0];
  assert.equal((await f.request('/auth/logout',{},cookie)).status,200);
  assert.equal((await f.request('/auth/me',undefined,cookie)).status,401);
});

test('public capabilities reveal availability only and unverified registration has no legacy bypass',async t=>{
  const f=await fixture(t);const options=await f.request('/auth/options');
  assert.equal(options.status,200);assert.equal(options.value.emailCode,true);assert.equal(options.value.phoneCode,true);
  assert.equal(JSON.stringify((await f.request('/capabilities')).value).includes('private-fixture'),false);
  assert.equal((await f.request('/auth/register',{email:'legacy@example.com',password:'fixture-password',name:'test'})).status,401);
  assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,0);
});

test('existing email password accounts remain usable when delivery is unavailable',async t=>{
  const f=await fixture(t,{enabled:false});
  f.db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run('legacy','legacy@example.com','旧账号',await hashPassword('fixture-password'),'user',new Date().toISOString());
  const logged=await f.request('/auth/login',{email:'LEGACY@example.com',password:'fixture-password'});assert.equal(logged.status,200);
  assert.equal(logged.value.user.id,'legacy');assert.equal(logged.value.user.emailVerifiedAt,null);
  assert.equal((await f.request('/auth/code/send',{channel:'email',address:'legacy@example.com',purpose:'login'})).status,503);
  assert.equal(f.db.prepare('SELECT count(*) n FROM auth_challenges').get().n,0);
});

test('all authentication mutations enforce same-origin and mismatched code purposes fail',async t=>{
  const f=await fixture(t);
  for(const route of ['register','login','code/send','code/login','password/reset']){
    assert.equal((await f.request('/auth/'+route,{},'','https://untrusted.example')).status,403);
  }
  const challenge=await f.code('email','researcher@example.com','register');
  assert.equal((await f.request('/auth/code/login',challenge)).status,401);
  assert.equal((await f.request('/auth/password/reset',{...challenge,password:'fixture-password'})).status,401);
  const created=await f.request('/auth/register',{...challenge,password:'fixture-password',name:'研究者'});
  assert.equal(created.status,200);assert.equal(created.value.user.email,'researcher@example.com');assert.ok(created.value.user.emailVerifiedAt);
});
