import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../backend/database.mjs';
import {digest} from '../backend/auth.mjs';
import {createStorage} from '../backend/storage.mjs';
import {createArtifactService,artifactKinds} from '../backend/artifact-service.mjs';
import {artifactMimeType} from '../backend/artifact-formats.mjs';
import {formulaMathMLMarkup} from '../src/research-formula-core.js';
import {exportGeneratedFile} from '../dist/workspace/artifact-export.mjs';

const settings={ossBucket:'private-test-bucket',ossEndpoint:'https://oss-cn-shanghai.aliyuncs.com',ossRegion:'cn-shanghai',ossPrefix:'paperknow/',ossAccessKeyId:'fixture-id',ossAccessKeySecret:'fixture-secret'};
const source=String.raw`\[\frac{x_1^2}{\sqrt{y}}\]`,mathml=formulaMathMLMarkup(source).markup;
const files=[{name:'研究公式.tex',kind:'tex',mimeType:'text/plain;charset=utf-8',text:source},{name:'研究公式.mml',kind:'mml',mimeType:'application/mathml+xml;charset=utf-8',text:mathml}];
function fixture(t){
 const db=database(':memory:'),objects=new Map(),puts=[];for(const id of ['alice','bob'])db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.test',id,null,'user',new Date().toISOString());
 const storage=createStorage(settings,{async put(key,value,options){puts.push({key,options});objects.set(key,Buffer.from(value));},async get(key){return{content:objects.get(key)};},async delete(key){objects.delete(key);}}),service=createArtifactService(db,{storage});t.after(()=>db.close());
 const request=(path='/api/artifacts',input,userId='alice',query={})=>service({path,method:input===undefined?'GET':'POST',user:userId?{id:userId}:null,query:new URLSearchParams(query),readBody:async()=>input});
 const upload=(file,userId='alice',extra={})=>request('/api/artifacts',{name:file.name,data:Buffer.from(file.text).toString('base64'),sourceType:'research',sourceId:'formula-original',expectedUserId:userId,...extra},userId);
 return{db,objects,puts,storage,service,request,upload};
}

test('TeX and MathML formula exports persist exact owned private OSS bytes and list accurate informational MIME metadata',async t=>{
 const f=fixture(t);for(const file of files){assert.ok(artifactKinds.includes(file.kind));assert.equal(artifactMimeType(file.kind),file.mimeType);const created=await f.upload(file),item=created.value.item;assert.equal(created.status,201);assert.equal(item.kind,file.kind);assert.equal(item.mimeType,file.mimeType);assert.equal(item.name,file.name);assert.equal(item.sourceType,'research');assert.equal(item.sourceId,'formula-original');
  const row=f.db.prepare('SELECT * FROM artifacts WHERE id=?').get(item.id);assert.equal(row.storage_key,`paperknow/users/alice/exports/${item.id}.${file.kind}`);assert.equal(row.sha256,digest(Buffer.from(file.text)));assert.equal(f.objects.get(row.storage_key).toString(),file.text);
  const response=await f.request(item.downloadUrl,undefined,'alice',{expectedUserId:'alice'});try{assert.equal(response.body.toString(),file.text);assert.equal(response.headers['Content-Type'],'application/octet-stream');assert.match(response.headers['Content-Disposition'],/^attachment;/);assert.ok(response.headers['Content-Disposition'].includes('artifact.'+file.kind));assert.equal(response.headers['X-Content-Type-Options'],'nosniff');assert.match(response.headers['Content-Security-Policy'],/sandbox; default-src 'none'/);}finally{response.release();}
  await assert.rejects(()=>f.request(item.downloadUrl,undefined,'bob'),{status:404});await assert.rejects(()=>f.request(item.downloadUrl,undefined,'bob',{expectedUserId:'alice'}),{status:409});
  const repeated=await f.upload(file);assert.equal(repeated.value.item.id,item.id);assert.equal(repeated.value.deduplicated,true);const other=await f.upload(file,'bob');assert.notEqual(other.value.item.id,item.id);
 }
 assert.equal(f.puts.length,4);assert.ok(f.puts.every(({options})=>options.headers['x-oss-object-acl']==='private'&&options.headers['Content-Type']==='application/octet-stream'&&options.headers['Content-Disposition']==='attachment'));
 const listed=(await f.request()).value.items;assert.equal(listed.length,2);assert.ok(listed.every(item=>item.mimeType===artifactMimeType(item.kind)));assert.doesNotMatch(JSON.stringify(listed),/storage_key|fixture-secret|oss-cn-shanghai/);
});

test('a logged-in formula download uses the real upload, private readback and expected original owner before native download',async t=>{
 const f=fixture(t);for(const file of files){const events=[],blobs=[];
  const fetchImpl=async(path,options={})=>{events.push(path);if(path==='/api/auth/me')return Response.json({user:{id:'alice'}});const url=new URL(path,'https://paperknow.test');assert.equal(options.headers['X-PaperKnow-User'],'alice');try{const result=await f.service({path:url.pathname,method:options.method||'GET',user:{id:'alice'},query:url.searchParams,readBody:async()=>JSON.parse(options.body)});if(result.body){result.release();return new Response(result.body,{headers:result.headers});}return Response.json(result.value,{status:result.status||200});}catch(error){return Response.json({error:error.message},{status:error.status||500});}};
  const result=await exportGeneratedFile({name:file.name,content:file.text,type:file.mimeType,sourceType:'research',sourceId:'formula-original',expectedUserId:'alice'},{fetchImpl,notify(){},documentObject:{body:{append(){}},createElement(){return{click(){events.push('native-download');},remove(){}};}},urlAPI:{createObjectURL(blob){blobs.push(blob);return'blob:owned-formula';},revokeObjectURL(){}},setTimeoutImpl(){}});
  assert.equal(result.saved,true);assert.equal(result.item.kind,file.kind);assert.equal(result.item.mimeType,file.mimeType);assert.equal(events.at(-1),'native-download');assert.ok(events.some(path=>path.endsWith('/download?expectedUserId=alice')));assert.equal(blobs.length,1);assert.equal(blobs[0].type,'application/octet-stream');assert.equal(await blobs[0].text(),file.text);
 }
});

test('new formula kinds reject invalid UTF-8, active XML, external resources and executable TeX before any OSS write or reservation',async t=>{
 const f=fixture(t),m=body=>'<math xmlns="http://www.w3.org/1998/Math/MathML">'+body+'</math>';
 const invalid=[{name:'invalid.tex',text:Buffer.from([255,254])},{name:'invalid.mml',text:Buffer.from([255,254])},{name:'invalid.tex',text:'x'.repeat(2001)},{name:'invalid.tex',text:String.raw`\write18{anything}`},{name:'invalid.tex',text:String.raw`\input{private}`},{name:'invalid.tex',text:String.raw`\newcommand{\secret}{x}`},{name:'invalid.tex',text:String.raw`\href{https://example.test}{x}`},{name:'invalid.tex',text:String.raw`\mmlToken{mi}[href="https://example.test"]{x}`},{name:'invalid.mml',text:'<svg xmlns="http://www.w3.org/2000/svg"/>'},{name:'invalid.mml',text:'<math><mi>x</mi></math>'},{name:'invalid.mml',text:'<!DOCTYPE math [<!ENTITY x SYSTEM "file:///private">]>'+m('<mi>&x;</mi>')},{name:'invalid.mml',text:'<?unsafe test?>'+m('<mi>x</mi>')},{name:'invalid.mml',text:m('<script>alert(1)</script>')},{name:'invalid.mml',text:m('<mi href="https://example.test">x</mi>')},{name:'invalid.mml',text:m('<mi style="background:url(https://example.test)">x</mi>')},{name:'invalid.mml',text:m('<mi onclick="alert(1)">x</mi>')},{name:'invalid.mml',text:m('<mrow xmlns="https://example.test"><mi>x</mi></mrow>')},{name:'invalid.mml',text:m('<mglyph src="https://example.test/x"/>')},{name:'invalid.mml',text:m('<mi>x</mi>')+'<more/>'},{name:'invalid.mml',text:m('<mrow>' .repeat(82)+'<mi>x</mi>'+'</mrow>'.repeat(82))}];
 for(const file of invalid)await assert.rejects(()=>f.upload(file),{status:400});assert.equal(f.puts.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM artifacts').get().n,0);
});

test('new export extensions never broaden original document upload, foreign object keys or unrelated binary signature rules',async t=>{
 const f=fixture(t);for(const file of files){await assert.rejects(()=>f.storage.put('formula','alice',file.kind,Buffer.from(file.text)),/不匹配/);const item=(await f.upload(file)).value.item,row=f.db.prepare('SELECT * FROM artifacts WHERE id=?').get(item.id);await assert.rejects(()=>f.storage.readArtifact({...row,user_id:'bob'}),/不匹配/);await assert.rejects(()=>f.storage.readArtifact({...row,storage_key:row.storage_key+'.html'}),/不匹配/);}
 for(const name of ['bad.exe','bad.pdf','bad.png','bad.docx'])await assert.rejects(()=>f.upload({name,text:'not a valid binary'}),{status:400});
 const html=await f.upload({name:'existing.html',text:'<script>inert attachment</script>'});const response=await f.request(html.value.item.downloadUrl);assert.equal(response.headers['Content-Type'],'application/octet-stream');assert.match(response.headers['Content-Security-Policy'],/sandbox/);response.release();
});
