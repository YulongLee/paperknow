import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import JSZip from 'jszip';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createSession,digest} from '../backend/auth.mjs';
import {defaultThesisTemplateProfile,inspectThesisDocxTemplate} from '../src/thesis-template-profile.js';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',P='http://schemas.openxmlformats.org/package/2006/relationships',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const snapshot=()=>({title:'HTTP 合成论文',profile:{level:'本科',language:'中文',targetWords:500},requirements:{format:'旧文件名不能等同于已应用模板'},outline:[{id:'c-1',title:'研究背景',targetWords:500}],bodySections:[{id:'c-1',title:'研究背景',text:'本段为自动化测试的合成正文，不得在更换模板时丢失。'}]});
async function docx(){
 const zip=new JSZip(),{rules}=defaultThesisTemplateProfile();rules.styles.Normal.eastAsia='仿宋';rules.page.left=1800;
 const styles=Object.entries(rules.styles).map(([role,s])=>`<w:style w:type="paragraph"${role==='Normal'?' w:default="1"':''} w:styleId="${role}"><w:name w:val="${role}"/><w:pPr><w:jc w:val="${s.alignment}"/><w:spacing w:line="${s.line}" w:lineRule="${s.lineRule}" w:before="${s.before}" w:after="${s.after}"/><w:ind w:firstLine="${s.firstLine}" w:firstLineChars="${s.firstLineChars}" w:hanging="${s.hanging}"/><w:pageBreakBefore w:val="${s.pageBreakBefore?1:0}"/></w:pPr><w:rPr><w:rFonts w:ascii="${s.ascii}" w:eastAsia="${s.eastAsia}"/><w:sz w:val="${s.size}"/><w:b w:val="${s.bold?1:0}"/></w:rPr></w:style>`).join('');
 zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
 zip.file('_rels/.rels',`<Relationships xmlns="${P}"><Relationship Id="main" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);zip.file('word/_rels/document.xml.rels',`<Relationships xmlns="${P}"><Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/></Relationships>`);
 const s=rules.page;zip.file('word/document.xml',`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>合成学校模板示例</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="${s.width}" w:h="${s.height}"/><w:pgMar w:top="${s.top}" w:bottom="${s.bottom}" w:left="${s.left}" w:right="${s.right}" w:header="${s.header}" w:footer="${s.footer}" w:gutter="${s.gutter}"/></w:sectPr></w:body></w:document>`);zip.file('word/styles.xml',`<w:styles xmlns:w="${W}">${styles}</w:styles>`);return Buffer.from(await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}));
}
async function fixture(t){
 const db=database(':memory:'),objects=new Map(),reads=[],users={};
 for(const id of ['alice','bob']){db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(id,id,'user',new Date().toISOString());users[id]={id,cookie:'pk_session='+createSession(db,id)};}
 const storage={provider:'aliyun_oss',bucket:'test-private',async put(id,owner,kind,bytes){objects.set(id,Buffer.from(bytes));return `private-oss-key/${owner}/${id}.${kind}`;},async read(row){reads.push({id:row.id,owner:row.user_id});if(storage.gate)await storage.gate(row);if(!objects.has(row.id))throw Error('offline');return objects.get(row.id);},async remove(row){objects.delete(row.id);}};
 const api=createAPI(db,{cancel(){}},{requireRemoteStorage:true,storage,getAI:()=>({enabled:false})}),server=http.createServer((req,res)=>void api(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();});
 async function request(path,input,person=users.alice,headers={}){const response=await fetch(base+'/api'+path,{method:input===undefined?'GET':'POST',headers:{...(person?{Cookie:person.cookie}:{}),...(input===undefined?{}:{Origin:base,'Content-Type':'application/json'}),...headers},body:input===undefined?undefined:JSON.stringify(input)});return {status:response.status,value:await response.json()};}
 async function upload(person=users.alice){const bytes=await docx(),r=await request('/files',{name:'合成学校模板.docx',data:bytes.toString('base64'),expectedUserId:person.id},person);assert.equal(r.status,201,JSON.stringify(r.value));return {id:r.value.id,bytes,sha256:digest(bytes)};}
 async function create(person=users.alice,extra={}){const r=await request('/theses',{snapshot:snapshot(),clientKey:randomUUID(),...extra},person);assert.equal(r.status,201,JSON.stringify(r.value));return r.value.item;}
 return {db,objects,storage,reads,users,request,upload,create};
}

test('real DOCX parsing binds over HTTP, survives account reload and is included in an owner-only account archive',async t=>{
 const f=await fixture(t),source=await f.upload(),expected=await inspectThesisDocxTemplate(source.bytes);assert.ok(expected.recognized.length>100,'fully specified templates exercise all recognized fields');
 const item=await f.create(f.users.alice,{exportTemplateFileId:source.id}),profile=item.exportTemplate.profile;assert.equal(item.exportTemplate.status,'ready');assert.equal(profile.rules.styles.Normal.eastAsia,'仿宋');assert.equal(profile.rules.page.left,1800);assert.deepEqual(profile.unresolved,expected.unresolved);
 assert.equal((await f.request('/theses/'+item.id)).value.item.exportTemplate.source.sha256,source.sha256);assert.equal((await f.request('/theses/'+item.id+'/export-template')).value.exportTemplate.status,'ready');
 const otherSource=await f.upload(f.users.bob),other=await f.create(f.users.bob,{exportTemplateFileId:otherSource.id}),archive=await f.request('/account/export',undefined,f.users.alice,{'X-PaperKnow-User':'alice'});
 assert.equal(archive.status,200,JSON.stringify(archive.value));assert.equal(archive.value.theses.length,1);assert.equal(archive.value.theses[0].id,item.id);assert.deepEqual(archive.value.theses[0].exportTemplate,item.exportTemplate);assert.equal(archive.value.includesOriginalFiles,false);
 assert.doesNotMatch(JSON.stringify(archive.value),/private-oss-key|test-private/);assert.equal(JSON.stringify(archive.value).includes(other.id),false);assert.equal(JSON.stringify(archive.value).includes(otherSource.id),false);assert.equal(archive.value.files[0].downloadPath,'/api/files/'+source.id+'/download');
});

test('HTTP owner headers stop cookie-switch reads and writes before parsing or touching either account',async t=>{
 const f=await fixture(t),source=await f.upload(),item=await f.create(),other=await f.create(f.users.bob),headers={'X-PaperKnow-User':'alice'},route='/theses/'+item.id+'/export-template';
 assert.equal((await f.request(route,undefined,null)).status,401);assert.equal((await f.request(route,undefined,f.users.bob,headers)).status,409);assert.equal((await f.request(route,{version:item.version,templateFileId:source.id},f.users.bob,headers)).status,409);
 assert.equal((await f.request(route,undefined,f.users.bob)).status,404);assert.equal((await f.request('/theses/'+other.id+'/export-template',{version:other.version,templateFileId:source.id},f.users.bob)).status,404);assert.equal(f.reads.length,0);
 for(const id of [item.id,other.id])assert.equal(f.db.prepare('SELECT export_template FROM theses WHERE id=?').get(id).export_template,null);
 const bound=await f.request(route,{version:item.version,templateFileId:source.id},f.users.alice,headers);assert.equal(bound.status,200);assert.equal(bound.value.item.exportTemplate.status,'ready');
});

test('concurrent HTTP template changes use optimistic version checks after private I/O and cookie changes cannot target the new account',async t=>{
 const f=await fixture(t),first=await f.upload(),second=await f.upload(),item=await f.create(),bobItem=await f.create(f.users.bob),entered=deferred(),release=deferred();
 f.storage.gate=async row=>{if(row.id===first.id){entered.resolve();await release.promise;}};
 const route='/theses/'+item.id+'/export-template',pending=f.request(route,{version:item.version,templateFileId:first.id},f.users.alice,{'X-PaperKnow-User':'alice'});await entered.promise;
 const switched=await f.request('/theses/'+bobItem.id+'/export-template',{version:bobItem.version,templateFileId:first.id},f.users.bob,{'X-PaperKnow-User':'alice'});assert.equal(switched.status,409);
 const newer=await f.request(route,{version:item.version,templateFileId:second.id});assert.equal(newer.status,200);release.resolve();assert.equal((await pending).status,409);
 delete f.storage.gate;const current=(await f.request('/theses/'+item.id)).value.item;assert.equal(current.exportTemplate.source.fileId,second.id);assert.equal(current.version,newer.value.item.version);assert.equal((await f.request('/theses/'+bobItem.id,undefined,f.users.bob)).value.item.exportTemplate,null);
});

test('template identity CAS survives chapter checkpoints before and during inspection without losing body or research',async t=>{
 const f=await fixture(t),source=await f.upload(),item=await f.create(),route='/theses/'+item.id+'/export-template',entered=deferred(),release=deferred();
 const original=f.db.prepare('SELECT snapshot,snapshot_hash FROM theses WHERE id=?').get(item.id);
 f.db.prepare("UPDATE theses SET version=version+1,status='running' WHERE id=?").run(item.id);
 f.storage.gate=async row=>{if(row.id===source.id){entered.resolve();await release.promise;}};
 const pending=f.request(route,{version:item.version,templateFileId:source.id,expectedTemplateFileId:null},f.users.alice,{'X-PaperKnow-User':'alice'});
 await entered.promise;
 const newBody='后台刚刚完成的新章节正文，切换模板时必须原样保留。';
 f.db.prepare('INSERT INTO thesis_chapter_versions(id,thesis_id,chapter_id,version,run_id,source,text,source_ids,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),item.id,'c-1',2,null,'generated',newBody,'[]',new Date().toISOString());
 f.db.prepare('UPDATE theses SET version=version+1 WHERE id=?').run(item.id);
 release.resolve();const changed=await pending;
 assert.equal(changed.status,200,JSON.stringify(changed.value));assert.equal(changed.value.item.version,item.version+3);
 assert.equal(changed.value.item.status,'running');assert.equal(changed.value.item.exportTemplate.source.fileId,source.id);
 assert.equal(changed.value.item.chapters[0].text,newBody);assert.equal(changed.value.item.chapters[0].version,2);
 assert.deepEqual(f.db.prepare('SELECT snapshot,snapshot_hash FROM theses WHERE id=?').get(item.id),original);
 assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_chapter_versions WHERE thesis_id=?').get(item.id).n,2);
 assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_generation_quotes').get().n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_runs').get().n,0);
 // Restoring default uses the same setting-level compare and swap, even when
 // more chapter activity has advanced the aggregate thesis revision.
 const bound=changed.value.item;f.db.prepare('UPDATE theses SET version=version+1 WHERE id=?').run(item.id);
 const cleared=await f.request(route,{version:bound.version,templateFileId:null,expectedTemplateFileId:source.id});
 assert.equal(cleared.status,200,JSON.stringify(cleared.value));assert.equal(cleared.value.item.exportTemplate,null);
 assert.equal(cleared.value.item.chapters[0].text,newBody);assert.equal(cleared.value.item.status,'running');
});

test('template identity CAS rejects a competing selection before or during private inspection',async t=>{
 const f=await fixture(t),first=await f.upload(),second=await f.upload(),item=await f.create(),route='/theses/'+item.id+'/export-template',entered=deferred(),release=deferred();
 f.storage.gate=async row=>{if(row.id===first.id){entered.resolve();await release.promise;}};
 const pending=f.request(route,{version:item.version,templateFileId:first.id,expectedTemplateFileId:null});await entered.promise;
 const newer=await f.request(route,{version:item.version,templateFileId:second.id,expectedTemplateFileId:null});assert.equal(newer.status,200,JSON.stringify(newer.value));
 release.resolve();const conflict=await pending;assert.equal(conflict.status,409);assert.match(conflict.value.error,/格式模板已在其他页面更新/);
 delete f.storage.gate;const reads=f.reads.length;
 const stale=await f.request(route,{version:newer.value.item.version,templateFileId:first.id,expectedTemplateFileId:null});
 assert.equal(stale.status,409);assert.equal(f.reads.length,reads,'a known template conflict must stop before reading a new private original');
 const current=(await f.request('/theses/'+item.id)).value.item;
 assert.equal(current.exportTemplate.source.fileId,second.id);assert.equal(current.version,newer.value.item.version);
 assert.equal(current.chapters[0].text,item.chapters[0].text);assert.deepEqual(current.snapshot,item.snapshot);
});

test('legacy clients retain exact thesis revision protection and malformed template CAS values are rejected before reads',async t=>{
 const f=await fixture(t),source=await f.upload(),item=await f.create(),route='/theses/'+item.id+'/export-template';
 f.db.prepare('UPDATE theses SET version=version+1 WHERE id=?').run(item.id);
 const stale=await f.request(route,{version:item.version,templateFileId:source.id});assert.equal(stale.status,409);assert.equal(f.reads.length,0);
 for(const expectedTemplateFileId of [0,42,true,'',' ','../private',{},[],'a'.repeat(121)]){
  const response=await f.request(route,{version:item.version,templateFileId:source.id,expectedTemplateFileId});
  assert.equal(response.status,400,JSON.stringify({expectedTemplateFileId,response}));
 }
 for(const version of [0,-1,1.5,'1',null])assert.equal((await f.request(route,{version,templateFileId:source.id,expectedTemplateFileId:null})).status,400);
 assert.equal(f.reads.length,0);assert.equal(f.db.prepare('SELECT export_template FROM theses WHERE id=?').get(item.id).export_template,null);
 const foreign=await f.upload(f.users.bob),denied=await f.request(route,{version:item.version,templateFileId:foreign.id,expectedTemplateFileId:null});
 assert.equal(denied.status,404);assert.equal(f.reads.length,0);
});
