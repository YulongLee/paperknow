import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {database} from '../backend/database.mjs';
import {createAPI} from '../backend/api.mjs';
import {createDesktopReleaseStorage} from '../backend/desktop-release-storage.mjs';
import {createDesktopReleaseService,publishDesktopManifest,desktopCatalogRevision,validateDesktopManifest} from '../backend/desktop-release-service.mjs';
import {desktopReleaseCommand,parseDesktopReleaseArguments} from '../scripts/publish-desktop-release.mjs';

const settings={ossBucket:'test-bucket',ossEndpoint:'https://oss-cn-shanghai.aliyuncs.com',ossRegion:'cn-shanghai',ossPrefix:'paperknow/',ossAccessKeyId:'fixture-id-not-real',ossAccessKeySecret:'fixture-secret-not-real'};
function mockStorage(){
 const objects=new Map(),calls=[];let uploadFailure=false;
 const client={
  async head(key){calls.push({method:'head',key});const item=objects.get(key);if(!item)throw Object.assign(new Error('fixture missing'),{status:404});return {meta:item.meta,res:{headers:{'content-length':String(item.buffer.length),...item.headers}}};},
  async getACL(key){calls.push({method:'getACL',key});return {acl:objects.get(key)?.acl||'private'};},
  async multipartUpload(key,file,options){calls.push({method:'multipartUpload',key,file,options});options.progress?.(0,{uploadId:'fixture-upload-id'});if(uploadFailure)throw new Error('fixture-secret-do-not-disclose');objects.set(key,{buffer:await readFile(file),meta:options.meta,acl:options.headers['x-oss-object-acl'],headers:{'content-type':options.mime,'content-disposition':options.headers['Content-Disposition'],'cache-control':options.headers['Cache-Control']}});},
  async abortMultipartUpload(key,uploadId){calls.push({method:'abort',key,uploadId});},
  async signatureUrlV4(method,expires,request,key){calls.push({method:'sign',httpMethod:method,expires,request,key});return `https://${settings.ossBucket}.oss-cn-shanghai.aliyuncs.com/${key}?fixture-only-signature=not-real`;}
 };
 return {storage:createDesktopReleaseStorage(settings,client),objects,calls,client,setUploadFailure:value=>uploadFailure=value};
}
async function localPackage(name='PaperKnow-0.1.0-arm64.dmg',contents='synthetic package fixture only'){
 const directory=await mkdtemp(join(tmpdir(),'paperknow-release-fixture-')),file=join(directory,name);await writeFile(file,contents,{mode:0o600});return {directory,file};
}
async function uploaded(mock,overrides={}){const file=await localPackage(overrides.fileName);return mock.storage.upload({platform:'macos',arch:'arm64',version:'0.1.0',minSystem:'macOS 12 or later',file:file.file,...overrides});}
const manifest=releases=>({schemaVersion:1,version:releases[0].version,releases});

test('desktop OSS rejects invalid endpoints, partial config and foreign project roots',()=>{
 assert.equal(createDesktopReleaseStorage({}),null);
 assert.throws(()=>createDesktopReleaseStorage({ossBucket:'test-bucket'}),/配置不完整/);
 for(const change of [{ossPrefix:'../users/'},{ossEndpoint:'https://attacker.example.invalid/'},{ossEndpoint:'http://oss-cn-shanghai.aliyuncs.com'},{ossEndpoint:'https://oss-cn-shanghai.aliyuncs.com/path'}])assert.throws(()=>createDesktopReleaseStorage({...settings,...change},{}));
});
test('empty desktop catalogue exposes version but no invented downloads or object paths',()=>{
 const db=database(':memory:');try{const service=createDesktopReleaseService(db,{});assert.deepEqual(service.catalog(),{version:'0.1.0',releases:[]});assert.equal(desktopCatalogRevision(db),'empty');}finally{db.close();}
});
test('installer multipart upload is private and hashes local file without putting packages into user storage',async()=>{
 const mock=mockStorage(),release=await uploaded(mock);
 const upload=mock.calls.find(value=>value.method==='multipartUpload');assert.equal(typeof upload.file,'string');assert.equal(upload.options.parallel,2);assert.equal(upload.options.headers['x-oss-object-acl'],'private');assert.equal(release.bytes,30);
 assert.equal(release.sha256,createHash('sha256').update('synthetic package fixture only').digest('hex'));
 assert.ok(release.storageKey.startsWith('paperknow/clients/macos/arm64/0.1.0/'+release.sha256+'/'));assert.equal(release.signed,false);
 assert.equal(mock.calls.some(value=>value.key.includes('/users/')),false);
 const duplicate=await mock.storage.upload({platform:'macos',arch:'arm64',version:'0.1.0',minSystem:release.minSystem,file:upload.file});assert.deepEqual(duplicate,release);assert.equal(mock.calls.filter(value=>value.method==='multipartUpload').length,1);
});
test('forged user directory, bucket, sha, length and public ACL packages fail verification',async()=>{
 const mock=mockStorage(),release=await uploaded(mock),before=mock.calls.length;
 for(const change of [{storageKey:'paperknow/users/user/exports/stolen.zip'},{storageBucket:'foreign-bucket'},{storageKey:'https://attacker.invalid/file'},{bytes:0},{sha256:'g'.repeat(64)},{signed:true},{platform:'windows',arch:'arm64'}])await assert.rejects(mock.storage.verify({...release,...change}));
 assert.equal(mock.calls.length,before);
 const object=mock.objects.get(release.storageKey);object.buffer=Buffer.from('bad size');await assert.rejects(mock.storage.verify(release),/完整性/);object.buffer=Buffer.from('synthetic package fixture only');
 object.meta.sha256='0'.repeat(64);await assert.rejects(mock.storage.verify(release),/完整性/);object.meta.sha256=release.sha256;
 object.acl='public-read';await assert.rejects(mock.storage.verify(release),/私有/);
});
test('failed multipart uploads abort only their own upload and do not publish a manifest',async()=>{
 const mock=mockStorage(),existing=await uploaded(mock),file=await localPackage('PaperKnow-0.1.0-x64.exe','windows synthetic fixture'),output=join(file.directory,'must-not-publish.json');
 mock.setUploadFailure(true);
 const spec=join(file.directory,'spec.json');await writeFile(spec,JSON.stringify({version:'0.1.0',releases:[{platform:'macos',arch:'arm64',file:mock.calls.find(value=>value.method==='multipartUpload').file,minSystem:'macOS 12 or later'},{platform:'windows',arch:'x64',file:file.file,minSystem:'Windows 10 or later'}]}));
 await assert.rejects(desktopReleaseCommand(['upload','--spec',spec,'--manifest',output],{config:{},storage:mock.storage}),/上传或校验未完成/);
 await assert.rejects(stat(output),{code:'ENOENT'});assert.equal(mock.objects.size,1);assert.ok(mock.objects.has(existing.storageKey));
 const abort=mock.calls.find(value=>value.method==='abort');assert.ok(abort.key.startsWith('paperknow/clients/windows/x64/'));assert.equal(abort.uploadId,'fixture-upload-id');
});
test('all manifest objects must validate before catalogue mutation and historical packages remain intact',async()=>{
 const mock=mockStorage(),release=await uploaded(mock),db=database(':memory:');
 try{
  const first=await publishDesktopManifest(db,mock.storage,manifest([release]),{expectedRevision:'empty'});assert.equal(first.changed,true);assert.equal(db.prepare('SELECT count(*) n FROM desktop_releases WHERE published=1').get().n,1);
  const windowsFile=await localPackage('PaperKnow-0.1.0-x64.exe','windows synthetic fixture'),windows=await mock.storage.upload({platform:'windows',arch:'x64',version:'0.1.0',minSystem:'Windows 10 or later',file:windowsFile.file});
  mock.objects.get(windows.storageKey).meta.sha256='0'.repeat(64);
  await assert.rejects(publishDesktopManifest(db,mock.storage,manifest([release,windows]),{expectedRevision:first.revision}),/完整性/);assert.equal(desktopCatalogRevision(db),first.revision);assert.equal(db.prepare('SELECT count(*) n FROM desktop_releases').get().n,1);
  const replacementFile=await localPackage('PaperKnow-0.1.0-arm64.dmg','replacement synthetic package'),replacement=await mock.storage.upload({platform:'macos',arch:'arm64',version:'0.1.0',minSystem:'macOS 12 or later',file:replacementFile.file});
  await publishDesktopManifest(db,mock.storage,manifest([replacement]),{expectedRevision:first.revision});assert.equal(db.prepare('SELECT count(*) n FROM desktop_releases').get().n,2);assert.equal(db.prepare('SELECT sha256 FROM desktop_releases WHERE published=1').get().sha256,replacement.sha256);assert.ok(mock.objects.has(release.storageKey));
 }finally{db.close();}
});
test('concurrent stale catalogue publications cannot replace a newer release and exact retries are idempotent',async()=>{
 const mock=mockStorage(),release=await uploaded(mock),db=database(':memory:');
 try{
  const file=await localPackage('PaperKnow-0.1.0-x64.exe','windows synthetic fixture'),windows=await mock.storage.upload({platform:'windows',arch:'x64',version:'0.1.0',minSystem:'Windows 10 or later',file:file.file});
  const results=await Promise.allSettled([publishDesktopManifest(db,mock.storage,manifest([release]),{expectedRevision:'empty'}),publishDesktopManifest(db,mock.storage,manifest([windows]),{expectedRevision:'empty'})]);
  assert.equal(results.filter(value=>value.status==='fulfilled').length,1);assert.match(results.find(value=>value.status==='rejected').reason.message,/其他发布/);
  const current=db.prepare('SELECT platform FROM desktop_releases WHERE published=1').get().platform,entry=current==='macos'?release:windows;
  const retry=await publishDesktopManifest(db,mock.storage,manifest([entry]),{expectedRevision:'empty'});assert.equal(retry.changed,false);assert.equal(db.prepare('SELECT count(*) n FROM desktop_releases WHERE published=1').get().n,1);
 }finally{db.close();}
});
test('manifest schema never accepts arbitrary URLs, duplicate architectures or empty releases',async()=>{
 const mock=mockStorage(),release=await uploaded(mock);
 for(const value of [{schemaVersion:1,version:'0.1.0',releases:[]},manifest([release,release]),manifest([{...release,downloadUrl:'https://attacker.invalid/file'}]),{...manifest([release]),secret:'not allowed'},manifest([{...release,version:'0.2.0'}])])assert.throws(()=>validateDesktopManifest(value,mock.storage));
});
test('published immutable descriptors reject metadata changes without changing revision or live downloads',async()=>{
 const mock=mockStorage(),release=await uploaded(mock),db=database(':memory:');
 try{
  const first=await publishDesktopManifest(db,mock.storage,manifest([release]),{expectedRevision:'empty'});
  await assert.rejects(publishDesktopManifest(db,mock.storage,manifest([{...release,minSystem:'macOS 13 or later'}]),{expectedRevision:first.revision}),/历史安装包的描述不可更改/);
  assert.equal(desktopCatalogRevision(db),first.revision);assert.equal(db.prepare('SELECT min_system FROM desktop_releases WHERE published=1').get().min_system,release.minSystem);
 }finally{db.close();}
});
test('anonymous download API returns controlled no-store redirects and never streams package bytes',async t=>{
 const mock=mockStorage(),release=await uploaded(mock),db=database(':memory:');await publishDesktopManifest(db,mock.storage,manifest([release]),{expectedRevision:'empty'});
 const api=createAPI(db,{cancel(){}},{desktopReleaseStorage:mock.storage,getAI:()=>({})}),server=http.createServer((req,res)=>void api(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();});const base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(base+'/api/desktop/releases'),catalog=await response.json();assert.equal(response.status,200);assert.equal(catalog.releases.length,1);assert.equal(catalog.releases[0].downloadUrl,'/api/desktop/download/macos/arm64');assert.equal(catalog.releases[0].sha256,release.sha256);assert.equal(JSON.stringify(catalog).includes('test-bucket'),false);assert.equal(JSON.stringify(catalog).includes('storageKey'),false);assert.equal(JSON.stringify(catalog).includes('fixture-secret'),false);
 const download=await fetch(base+catalog.releases[0].downloadUrl,{redirect:'manual'});assert.equal(download.status,302);assert.equal(await download.text(),'');assert.equal(download.headers.get('cache-control'),'private, no-store');assert.equal(download.headers.get('referrer-policy'),'no-referrer');assert.ok(download.headers.get('location').startsWith('https://test-bucket.oss-cn-shanghai.aliyuncs.com/paperknow/clients/'));
 const sign=mock.calls.find(value=>value.method==='sign');assert.equal(sign.httpMethod,'GET');assert.equal(sign.expires,300);assert.deepEqual(sign.request,{});assert.equal([...new URL(download.headers.get('location')).searchParams.keys()].some(key=>key.startsWith('response-')),false);
 for(const path of ['/api/desktop/download/windows/arm64','/api/desktop/download/linux/x64','/api/desktop/download/windows/x64'])assert.equal((await fetch(base+path,{redirect:'manual'})).status,404);
 mock.objects.delete(release.storageKey);const unavailable=await fetch(base+catalog.releases[0].downloadUrl,{redirect:'manual'});assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{error:'客户端下载暂时不可用，请稍后重试'});assert.equal(unavailable.headers.get('location'),null);
});
test('untrusted signed download hosts are rejected rather than redirected',async()=>{
 const mock=mockStorage(),release=await uploaded(mock);mock.client.signatureUrlV4=async()=>`https://attacker.invalid/${release.storageKey}`;await assert.rejects(mock.storage.downloadURL(release),/地址校验失败/);
});
test('download signing relies on verified stored attachment headers and rejects unsafe metadata',async()=>{
 const mock=mockStorage(),release=await uploaded(mock),object=mock.objects.get(release.storageKey),expectedHeaders={...object.headers};
 for(const change of [{'content-type':'text/html'},{'content-type':''},{'content-disposition':'inline'},{'content-disposition':'attachment; filename="another.exe"'},{'cache-control':'public, max-age=3600'}]){
  object.headers={...expectedHeaders,...change};await assert.rejects(mock.storage.downloadURL(release),/响应头校验失败/);
 }
 assert.equal(mock.calls.some(value=>value.method==='sign'),false);
 object.headers=expectedHeaders;await mock.storage.downloadURL(release);const sign=mock.calls.find(value=>value.method==='sign');assert.deepEqual(sign.request,{});
 for(const disposition of [`attachment;filename=${release.fileName}`,` ATTACHMENT ; filename = "${release.fileName}" ; `]){object.headers={...expectedHeaders,'content-disposition':disposition};await mock.storage.downloadURL(release);}
 object.headers={...expectedHeaders,'content-disposition':`attachment; filename="${release.fileName.toLowerCase()}"`};await assert.rejects(mock.storage.downloadURL(release),/响应头校验失败/);
});
test('CLI requires absolute paths, catalogue revision and exclusive manifest output',async()=>{
 assert.throws(()=>parseDesktopReleaseArguments(['upload','--spec','relative.json','--manifest','/tmp/manifest.json']),/绝对路径/);
 assert.throws(()=>parseDesktopReleaseArguments(['publish','--database','/tmp/existing.sqlite','--manifest','/tmp/release.json']),/expected/);
 const mock=mockStorage(),file=await localPackage(),spec=join(file.directory,'spec.json'),output=join(file.directory,'manifest.json');await writeFile(spec,JSON.stringify({version:'0.1.0',releases:[{platform:'macos',arch:'arm64',file:file.file,minSystem:'macOS 12 or later'}]}));
 const result=await desktopReleaseCommand(['upload','--spec',spec,'--manifest',output],{config:{},storage:mock.storage});assert.equal(result.published,false);assert.equal(result.count,1);assert.equal((await stat(output)).mode&0o777,0o600);
 await assert.rejects(desktopReleaseCommand(['upload','--spec',spec,'--manifest',output],{config:{},storage:mock.storage}),{code:'EEXIST'});assert.equal(JSON.parse(await readFile(output,'utf8')).releases.length,1);
});
test('publish CLI creates a consistent private backup and preserves other product data',async()=>{
 const mock=mockStorage(),release=await uploaded(mock),directory=await mkdtemp(join(tmpdir(),'paperknow-release-cli-')),dbPath=join(directory,'existing.sqlite'),manifestPath=join(directory,'release.json'),backup=join(directory,'before.sqlite');
 let db=database(dbPath);db.prepare("INSERT INTO users(id,email,name,role,created_at) VALUES('retained','fixture@example.invalid','retained fixture','user',?)").run(new Date().toISOString());db.close();
 await writeFile(manifestPath,JSON.stringify(manifest([release])));
 const preview=await desktopReleaseCommand(['inspect','--database',dbPath,'--manifest',manifestPath],{config:{},storage:mock.storage});assert.equal(preview.revision,'empty');assert.deepEqual(preview.current,[]);
 const result=await desktopReleaseCommand(['publish','--database',dbPath,'--manifest',manifestPath,'--expected',preview.revision,'--backup',backup],{config:{},storage:mock.storage});assert.equal(result.published,true);assert.equal(result.backup,backup);assert.equal((await stat(backup)).mode&0o777,0o600);
 db=database(dbPath);assert.equal(db.prepare('SELECT name FROM users WHERE id=?').get('retained').name,'retained fixture');assert.equal(db.prepare('SELECT count(*) n FROM desktop_releases WHERE published=1').get().n,1);db.close();
 const {DatabaseSync}=await import('node:sqlite');const prior=new DatabaseSync(backup,{readOnly:true});try{assert.equal(prior.prepare('SELECT count(*) n FROM desktop_releases').get().n,0);assert.equal(prior.prepare('SELECT count(*) n FROM users').get().n,1);}finally{prior.close();}
 await assert.rejects(desktopReleaseCommand(['publish','--database',dbPath,'--manifest',manifestPath,'--expected',result.revision,'--backup',backup],{config:{},storage:mock.storage}),/已存在/);
});
