import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession} from '../backend/auth.mjs';
import {createStorage} from '../backend/storage.mjs';

async function fixture(t,{remote=true}={}){
 const db=database(':memory:'),objects=new Map(),storage=remote?createStorage({ossBucket:'test-bucket',ossEndpoint:'https://oss-cn-shanghai.aliyuncs.com',ossRegion:'cn-shanghai',ossPrefix:'paperknow/',ossAccessKeyId:'id',ossAccessKeySecret:'secret'},{async put(key,value){objects.set(key,Buffer.from(value));},async get(key){return {content:objects.get(key)};},async delete(key){objects.delete(key);}}):null;
 const api=createAPI(db,{cancel(){}},{storage,requireRemoteStorage:true,getAI:()=>({enabled:false})}),server=http.createServer((req,res)=>void api(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,cookies={};
 for(const id of ['alice','bob']){db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,null,'user',new Date().toISOString());cookies[id]='pk_session='+createSession(db,id);}
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
 const request=(path,input,user='alice',origin=base)=>fetch(base+path,{method:input===undefined?'GET':'POST',headers:{...(user?{Cookie:cookies[user]}:{}),...(input===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},body:input===undefined?undefined:JSON.stringify(input)});
 return {db,objects,request,api,cookies};
}
test('artifact API applies sessions and origin policy, then delivers owned verified attachment bytes',async t=>{
 const f=await fixture(t),input={name:'论文.txt',data:Buffer.from('研究成果').toString('base64'),sourceType:'thesis',expectedUserId:'alice'};
 assert.equal((await f.request('/api/artifacts',input,null)).status,401);assert.equal((await f.request('/api/artifacts',input,'alice','http://untrusted.invalid')).status,403);
 const created=await f.request('/api/artifacts',input);assert.equal(created.status,201);const {item}=await created.json();
 const download=await f.request(item.downloadUrl+'?expectedUserId=alice');assert.equal(download.status,200);assert.equal(await download.text(),'研究成果');assert.match(download.headers.get('content-disposition'),/^attachment/);assert.equal(download.headers.get('x-content-type-options'),'nosniff');
 assert.equal((await f.request(item.downloadUrl,undefined,'bob')).status,404);
 assert.equal((await f.request(item.downloadUrl+'?expectedUserId=bob')).status,409);
 const list=await (await f.request('/api/artifacts?page=1&pageSize=5')).json();assert.equal(list.total,1);assert.equal(list.storage.ready,true);
 const archive=await (await f.request('/api/account/export')).json();assert.equal(archive.artifacts?.length,1);assert.equal(archive.artifacts[0].id,item.id);assert.equal(JSON.stringify(archive.artifacts).includes('storage_key'),false);
 assert.equal((await f.request('/api/artifacts/'+item.id+'/delete',{expectedSha256:item.sha256,expectedUserId:'alice'})).status,200);assert.equal(f.objects.size,0);
});
test('artifact metadata API applies session, origin, owner and revision protection without changing cloud bytes',async t=>{
 const f=await fixture(t),created=await f.request('/api/artifacts',{name:'原始成果.txt',data:Buffer.from('cloud original').toString('base64'),sourceType:'research'}),{item}=await created.json(),path=`/api/artifacts/${item.id}/metadata`,input={version:item.version,name:'重命名成果.txt',expectedUserId:'alice'},at=new Date().toISOString();
 f.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run('cloud-project','alice','项目','本科','专业',at,at);
 assert.equal(item.version,1);assert.ok(item.updatedAt);
 assert.equal((await f.request(path,input,null)).status,401);assert.equal((await f.request(path,input,'alice','http://untrusted.invalid')).status,403);assert.equal((await f.request(path,{...input,expectedUserId:'bob'},'bob')).status,404);
 assert.equal((await f.request(path,{...input,expectedUserId:'bob'})).status,409);assert.equal((await f.request(path)).status,405);
 const updated=await f.request(path,{...input,projectId:'cloud-project'});assert.equal(updated.status,200);const changed=(await updated.json()).item;assert.equal(changed.name,input.name);assert.equal(changed.version,2);assert.equal(changed.projectId,'cloud-project');assert.equal(changed.sha256,item.sha256);assert.equal(f.objects.size,1);
 assert.equal((await f.request(path,input)).status,409);assert.equal((await f.request(path,{version:2,name:'misleading.pdf'})).status,400);
 const list=await(await f.request('/api/artifacts?kind=txt&projectId=cloud-project')).json();assert.equal(list.total,1);assert.equal(list.items[0].version,2);assert.equal(list.items[0].name,input.name);assert.ok(list.items[0].updatedAt);
 assert.equal((await f.request('/api/artifacts?projectId=cloud-project',undefined,'bob')).status,404);
 const download=await f.request(changed.downloadUrl);assert.equal(download.status,200);assert.equal(await download.text(),'cloud original');assert.ok(download.headers.get('content-disposition').includes(encodeURIComponent(input.name)));
 assert.equal((await f.request(`/api/artifacts/${item.id}/delete`,{expectedSha256:item.sha256})).status,200);assert.equal(f.objects.size,0);assert.equal((await f.request(path,{version:2,name:'deleted.txt'})).status,404);
});
test('authenticated TeX and MathML HTTP exports retain their exact type, owner and inert attachment delivery',async t=>{
 const f=await fixture(t),cases=[['科研公式.tex',String.raw`\frac{x_1}{y^2}`,'tex','text/plain;charset=utf-8'],['科研公式.mml','<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>x</mi><mi>y</mi></mfrac></math>','mml','application/mathml+xml;charset=utf-8']];
 for(const [name,text,kind,mimeType]of cases){const input={name,data:Buffer.from(text).toString('base64'),sourceType:'research',expectedUserId:'alice'};
  assert.equal((await f.request('/api/artifacts',{...input,expectedUserId:'bob'})).status,409);assert.equal((await f.request('/api/artifacts',input,'bob')).status,409);
  const created=await f.request('/api/artifacts',input);assert.equal(created.status,201);const {item}=await created.json();assert.equal(item.kind,kind);assert.equal(item.mimeType,mimeType);
  const downloaded=await f.request(item.downloadUrl+'?expectedUserId=alice');assert.equal(downloaded.status,200);assert.equal(await downloaded.text(),text);assert.equal(downloaded.headers.get('content-type'),'application/octet-stream');assert.match(downloaded.headers.get('content-disposition'),/^attachment;/);assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');assert.match(downloaded.headers.get('content-security-policy'),/sandbox/);
  assert.equal((await f.request(item.downloadUrl,undefined,'bob')).status,404);assert.equal((await f.request(item.downloadUrl+'?expectedUserId=alice',undefined,'bob')).status,409);
 }
 const before=f.objects.size;assert.equal((await f.request('/api/artifacts',{name:'危险.mml',data:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>').toString('base64'),sourceType:'research',expectedUserId:'alice'})).status,400);assert.equal(f.objects.size,before);assert.equal((await(await f.request('/api/artifacts',undefined,'bob')).json()).total,0);
});
test('only artifact uploads receive the larger request-body allowance',async t=>{
 const f=await fixture(t),input={name:'data.txt',data:Buffer.alloc(2500000,97).toString('base64'),sourceType:'other'};
 const response=await f.request('/api/artifacts',input);assert.equal(response.status,201);assert.equal((await response.json()).item.bytes,2500000);
 assert.equal((await f.request('/api/files',{name:input.name,data:input.data})).status,413);
 assert.equal((await f.request('/api/projects',{title:input.data})).status,413);
});
test('missing OSS fails original and final-file uploads without database binary fallback',async t=>{
 const f=await fixture(t,{remote:false}),input={name:'a.txt',data:'YQ=='};
 assert.equal((await f.request('/api/artifacts',input)).status,503);assert.equal((await f.request('/api/files',input)).status,503);
 assert.equal(f.db.prepare('SELECT count(*) n FROM artifacts').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,0);
});

test('HTTP download slots remain occupied for slow responses until finish or close, including repeated events',async t=>{
 const f=await fixture(t),created=await f.request('/api/artifacts',{name:'slow.txt',data:'YQ=='}),{item}=await created.json();
 class HeldResponse extends EventEmitter{
  constructor(){super();this.destroyed=false;this.writableEnded=false;}
  writeHead(status,headers){this.statusCode=status;this.headers=headers;return this;}
  end(body){this.body=body;this.writableEnded=true;return this;}
 }
 const request=async({closed=false}={})=>{const res=new HeldResponse();res.destroyed=closed;await f.api({url:item.downloadUrl,method:'GET',headers:{host:'localhost',cookie:f.cookies.alice},socket:{remoteAddress:'127.0.0.1'}},res);return res;};
 const first=await request(),second=await request();assert.equal(first.statusCode,200);assert.equal(second.statusCode,200);
 assert.equal((await request()).statusCode,429);
 first.emit('finish');const third=await request();assert.equal(third.statusCode,200);
 first.emit('close');assert.equal((await request()).statusCode,429);
 second.emit('close');third.emit('finish');const last=await request();assert.equal(last.statusCode,200);last.emit('close');
 // A socket can close before OSS returns, so its close event predates hooking.
 for(let i=0;i<3;i++)await request({closed:true});
 const afterDisconnected=await request();assert.equal(afterDisconnected.statusCode,200);afterDisconnected.emit('finish');
});
