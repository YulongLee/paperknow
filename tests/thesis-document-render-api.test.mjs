import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession} from '../backend/auth.mjs';
import {THESIS_RENDER_MAX_INPUT_BYTES} from '../backend/thesis-document-renderer.mjs';

const route='/api/theses/document-render';
const input=Buffer.from('synthetic DOCX bytes; renderer is stubbed, payload validation is real');
const output=Buffer.from('%PDF-1.7\nsynthetic fixture bytes\n');
async function fixture(t,{conversionError}={}){
 const db=database(':memory:'),users={},calls=[],statusCalls=[];
 for(const id of ['render-alice','render-bob']){db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,'合成渲染测试账户','user',new Date().toISOString());users[id]={id,cookie:'pk_session='+createSession(db,id)};}
 const renderer={
  async status(){statusCalls.push(true);return{available:true,busy:false,maxInputBytes:THESIS_RENDER_MAX_INPUT_BYTES,engine:'private-renderer-name',commandPath:'/private/server/program',timeoutMs:120000};},
  async convert(value){calls.push(value);if(conversionError)throw conversionError;return{bytes:new Uint8Array(output),pages:3,warnings:['合成检查说明']};}
 };
 const api=createAPI(db,{cancel(){}},{thesisDocumentRenderer:renderer,getAI:()=>({enabled:false})}),server=http.createServer((req,res)=>void api(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});
 async function request({method='GET',person=users['render-alice'],headers={},value,raw}={}){
  const payload=raw===undefined?(value===undefined?undefined:JSON.stringify(value)):raw;
  const response=await fetch(base+route,{method,headers:{...(person?{Cookie:person.cookie}:{}),...(payload===undefined?{}:{Origin:base,'Content-Type':'application/json'}),...headers},body:payload});
  return{status:response.status,value:await response.json(),headers:response.headers};
 }
 const mutationTables=['jobs','results','usage','theses','thesis_runs','thesis_chapter_versions','billing_quotes','billing_reservations','billing_events','payment_credit_ledger','payment_bundle_entitlements','files'];
 const snapshot=()=>Object.fromEntries(mutationTables.map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));
 return{db,users,calls,statusCalls,request,snapshot,post:(extra={})=>request({method:'POST',value:{data:input.toString('base64'),expectedUserId:'render-alice'},headers:{'X-PaperKnow-User':'render-alice'},...extra})};
}

test('render status requires a session and returns only public readiness fields with no engine or server path',async t=>{
 const f=await fixture(t),before=f.snapshot();
 const unauthenticated=await f.request({person:null});assert.equal(unauthenticated.status,401);assert.equal(f.statusCalls.length,0);
 const response=await f.request({headers:{'X-PaperKnow-User':'render-alice'}});assert.equal(response.status,200);
 assert.deepEqual(response.value,{available:true,busy:false,maxInputBytes:2097152});assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 assert.doesNotMatch(JSON.stringify(response.value),/engine|private-renderer|server|commandPath/);assert.equal(f.calls.length,0);assert.deepEqual(f.snapshot(),before);
});

test('session, expected owner header, payload owner and Origin are checked before any conversion',async t=>{
 const f=await fixture(t),before=f.snapshot();
 assert.equal((await f.post({person:null})).status,401);
 assert.equal((await f.post({person:f.users['render-bob']})).status,409);
 assert.equal((await f.request({person:f.users['render-bob'],headers:{'X-PaperKnow-User':'render-alice'}})).status,409);
 assert.equal((await f.post({headers:{'X-PaperKnow-User':'render-alice'},value:{data:input.toString('base64'),expectedUserId:'render-bob'}})).status,409);
 assert.equal((await f.post({value:{data:input.toString('base64')}})).status,409);
 assert.equal((await f.post({headers:{Origin:'https://other.example','X-PaperKnow-User':'render-alice'}})).status,403);
 assert.equal((await f.post({headers:{Origin:'','X-PaperKnow-User':'render-alice'}})).status,403);
 assert.equal(f.calls.length,0);assert.equal(f.statusCalls.length,0);assert.deepEqual(f.snapshot(),before);
});

test('global method guard and JSON or base64 validation reject malformed requests without invoking the renderer',async t=>{
 const f=await fixture(t),before=f.snapshot();
 for(const method of ['PUT','PATCH','DELETE'])assert.equal((await f.request({method,raw:'{}'})).status,405);
 for(const raw of ['{','[]','null','"string"'])assert.equal((await f.post({raw})).status,400);
 assert.equal((await f.post({headers:{'Content-Type':'text/plain'},raw:'{}'})).status,415);
 for(const data of ['',null,123,'not base64','Zh==','RE9DWA==\n']){
  const response=await f.post({value:{data,expectedUserId:'render-alice'}});assert.equal(response.status,422,JSON.stringify(response.value));
 }
 const tooLarge=Buffer.alloc(THESIS_RENDER_MAX_INPUT_BYTES+1).toString('base64');assert.equal((await f.post({value:{data:tooLarge,expectedUserId:'render-alice'}})).status,413);
 assert.equal((await f.post({raw:'{"data":"'+'A'.repeat(3*1024*1024)+'","expectedUserId":"render-alice"}'})).status,413);
 assert.equal(f.calls.length,0);assert.equal(f.statusCalls.length,0);assert.deepEqual(f.snapshot(),before);
});

test('successful rendering returns the exact PDF bytes and page count without creating jobs or charging credits',async t=>{
 const f=await fixture(t),before=f.snapshot(),response=await f.post();
 assert.equal(response.status,200,JSON.stringify(response.value));assert.deepEqual(response.value,{data:output.toString('base64'),pages:3,mimeType:'application/pdf',warnings:['合成检查说明']});
 assert.deepEqual(Buffer.from(response.value.data,'base64'),output);assert.equal(f.calls.length,1);assert.deepEqual(Buffer.from(f.calls[0].bytes),input);assert.ok(f.calls[0].signal instanceof AbortSignal);assert.equal(f.calls[0].signal.aborted,false);
 assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(f.snapshot(),before);
});

test('renderer busy or unavailable errors retain safe status and leave the account unchanged',async t=>{
 for(const status of [429,503,504]){
  const f=await fixture(t,{conversionError:Object.assign(new Error('合成转换服务暂不可用'),{status,code:'synthetic_render_error'})}),before=f.snapshot(),response=await f.post();
  assert.equal(response.status,status);assert.equal(response.value.error,'合成转换服务暂不可用');assert.equal(f.calls.length,1);assert.deepEqual(f.snapshot(),before);
 }
});
