import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession} from '../backend/auth.mjs';

test('stale account headers cannot read or mutate the newly signed-in account',async t=>{
 const db=database(':memory:'),api=createAPI(db,{cancel(){}},{getAI:()=>({enabled:false})});
 for(const id of ['alice','bob'])db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());
 const cookie='pk_session='+createSession(db,'bob'),server=http.createServer((req,res)=>void api(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
 const request=async(path,expected,data)=>{const response=await fetch(base+'/api'+path,{method:data===undefined?'GET':'POST',headers:{Cookie:cookie,...(expected===undefined?{}:{'X-PaperKnow-User':expected}),...(data===undefined?{}:{Origin:base,'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,value:await response.json()};};
 for(const [path,data]of [['/auth/logout',{}],['/projects'],['/account/export'],['/usage'],['/orders'],['/projects',{title:'来自Alice的旧表单'}],['/feedback',{category:'功能问题',text:'不应保存到新账户的旧反馈'}],['/orders',{productId:'credits-200',provider:'wechat',idempotencyKey:'wrong-account-key'}]]){
  const response=await request(path,'alice',data);assert.equal(response.status,409,path);assert.equal(response.value.code,'ACCOUNT_CHANGED',path);
 }
 assert.equal(db.prepare('SELECT count(*) n FROM projects').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM feedback').get().n,0);
 assert.equal((await request('/projects','bob')).status,200);
 assert.equal((await request('/projects',undefined)).status,200,'older callers remain compatible');
 assert.equal((await request('/projects','')).status,409,'an empty owner is not silently omitted');
 const created=await request('/projects','bob',{title:'Bob的研究项目'});assert.equal(created.status,201);
 const conflict=await request('/projects/'+created.value.id,'bob',{title:'旧版本覆盖',version:999});assert.equal(conflict.status,409);assert.equal(conflict.value.code,undefined,'normal version conflicts are not account changes');
});
