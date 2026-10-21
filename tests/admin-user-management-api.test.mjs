import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession} from '../backend/auth.mjs';

async function fixture(t){
 const db=database(':memory:'),now=new Date().toISOString();for(const [id,role]of [['admin-http','admin'],['ordinary-http','user']])db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,'合成接口验收',role,now);
 const config={aiURL:'https://synthetic.example.invalid/chat',aiKey:'synthetic-no-network',aiModel:'synthetic',authCodeSecret:'synthetic-auth-secret-at-least-32-characters'};
 const api=createAPI(db,{cancel(){}},config),server=http.createServer((req,res)=>void api(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const admin='pk_session='+createSession(db,'admin-http'),ordinary='pk_session='+createSession(db,'ordinary-http');
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
 async function request(path,{cookie=admin,input,origin=base,owner}={}){const res=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{Cookie:cookie,...(owner?{'X-PaperKnow-User':owner}:{}),...(input===undefined?{}:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})})},body:input===undefined?undefined:JSON.stringify(input)});return {status:res.status,body:await res.json()};}
 return {db,request,admin,ordinary};
}

test('HTTP user adjustments enforce admin session, request origin and owner binding before changing balances',async t=>{
 const f=await fixture(t),path='/api/admin/users/ordinary-http/credits',input={commandId:randomUUID(),version:1,delta:200,reason:'合成客服补偿'};
 assert.equal((await f.request(path,{cookie:'',input})).status,401);
 assert.equal((await f.request(path,{cookie:f.ordinary,input})).status,403);
 assert.equal((await f.request(path,{origin:'https://other.example.invalid',input})).status,403);
 assert.equal((await f.request(path,{origin:'',input})).status,403);
 assert.equal((await f.request(path,{owner:'different-admin',input})).status,409);
 assert.equal(f.db.prepare('SELECT count(*) n FROM admin_credit_adjustments').get().n,0);
 const saved=await f.request(path,{input});assert.equal(saved.status,200);assert.equal(saved.body.credits.available,200);
 const ownBalance=await f.request('/api/payments/entitlements',{cookie:f.ordinary});assert.equal(ownBalance.status,200);assert.equal(ownBalance.body.credits.balance,200);
 const repeated=await f.request(path,{input});assert.equal(repeated.status,200);assert.equal(repeated.body.credits.balance,200);
});

test('HTTP banning revokes a previously valid account cookie and unban does not revive that cookie',async t=>{
 const f=await fixture(t),path='/api/admin/users/ordinary-http/status';
 assert.equal((await f.request('/api/auth/me',{cookie:f.ordinary})).status,200);
 const banned=await f.request(path,{input:{commandId:randomUUID(),version:1,status:'banned',reason:'合成违规账号'}});assert.equal(banned.status,200);assert.equal(banned.body.user.status,'banned');
 assert.equal((await f.request('/api/auth/me',{cookie:f.ordinary})).status,401);
 const unbanned=await f.request(path,{input:{commandId:randomUUID(),version:2,status:'active',reason:'合成复核解封'}});assert.equal(unbanned.status,200);
 assert.equal((await f.request('/api/auth/me',{cookie:f.ordinary})).status,401);
});
