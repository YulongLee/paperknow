import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from '../server.mjs';
import {createSession} from '../backend/auth.mjs';
import {environmentConfig} from '../backend/config.mjs';

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'pk-admin-route-'));
  const app=createServer({dbPath:join(dir,'test.sqlite'),config:{ownerEmail:'owner@example.com'}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  function account(id,role='user',verified=false){
    const now=new Date().toISOString();
    const email=id==='owner'?'owner@example.com':id+'@example.com';
    app.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,email,id,null,role,now);
    app.db.prepare('INSERT INTO auth_identities(channel,address,user_id,verified_at,created_at) VALUES(?,?,?,?,?)').run('email',email,id,verified?now:null,now);
    return 'pk_session='+createSession(app.db,id);
  }
  const get=(path,cookie='',method='GET')=>fetch(`http://127.0.0.1:${app.server.address().port}`+path,{headers:{Cookie:cookie},redirect:'manual',method});
  return {...app,account,get};
}

test('admin HTML requires a real admin session, including encoded paths and HEAD',async t=>{
  const f=await fixture(t),ordinary=f.account('reader'),admin=f.account('admin','admin');
  for(const path of ['/admin.html','/%61dmin.html','/nested/%2e%2e/admin.html']){
    const guest=await f.get(path);assert.equal(guest.status,302);assert.equal(guest.headers.get('location'),'/auth.html?mode=login&next=%2Fadmin.html');
    const denied=await f.get(path,ordinary);assert.equal(denied.status,403);assert.doesNotMatch(await denied.text(),/id="admin-app"/);
    const permitted=await f.get(path,admin);assert.equal(permitted.status,200);assert.equal(permitted.headers.get('cache-control'),'no-store');
  }
  assert.equal((await f.get('/admin.html',ordinary,'HEAD')).status,403);
  assert.equal((await f.get('/ADMIN.HTML',ordinary)).status,403);
  assert.equal((await f.get('/ADMIN.HTML')).status,302);
  assert.equal((await f.get('/admin.html','pk_session=forged')).status,302);
});

test('owner identity must be verified before server grants admin page access',async t=>{
  const f=await fixture(t),cookie=f.account('owner');
  const first=await f.get('/admin.html',cookie);assert.equal(first.status,403);assert.match(await first.text(),/verify=1/);
  assert.equal(f.db.prepare('SELECT role FROM users WHERE id=?').get('owner').role,'user');
  f.db.prepare('UPDATE auth_identities SET verified_at=? WHERE user_id=?').run(new Date().toISOString(),'owner');
  assert.equal((await f.get('/admin.html',cookie)).status,200);
  assert.equal(f.db.prepare('SELECT role FROM users WHERE id=?').get('owner').role,'admin');
  assert.equal(f.db.prepare('SELECT count(*) n FROM admin_audit').get().n,1);
});

test('legacy account links resolve inside the main workspace without open redirects',async t=>{
  const f=await fixture(t);
  const routes={projects:'/workspace.html#projects?scope=account',tasks:'/workspace.html#tasks?scope=account',results:'/workspace.html#assets?scope=account',admin:'/admin.html',agent:'/workspace.html#tasks?scope=account&view=agent'};
  for(const [view,destination] of Object.entries(routes)){
    const response=await f.get('/service.html?view='+view);assert.equal(response.status,302);assert.equal(response.headers.get('location'),destination);
  }
  assert.equal((await f.get('/service.html?view=https://evil.invalid')).headers.get('location'),'/workspace.html#home');
  assert.equal((await f.get('/service.html?view=projects&auth=register')).headers.get('location'),'/auth.html?mode=register&next=%2Fworkspace.html%23projects%3Fscope%3Daccount');
  assert.equal(environmentConfig({PK_OWNER_EMAIL:' Owner@Example.COM '}).ownerEmail,'owner@example.com');
});
