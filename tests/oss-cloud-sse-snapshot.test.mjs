import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,realpath,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createOssSnapshot} from '../deploy/oss-snapshot.mjs';
import {publishSseSnapshot,restoreSseSnapshot,createSseDestination} from '../deploy/oss-cloud-sse-snapshot.mjs';
import {Readable} from 'node:stream';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){const root=await mkdtemp(join(await realpath(tmpdir()),'pk-cloud-backup-'));t.after(()=>rm(root,{recursive:true,force:true}));const snapshotDir=join(root,'db'),backupRoot=join(root,'local'),restoreRoot=join(root,'restore');for(const p of [snapshotDir,backupRoot,restoreRoot])await mkdir(p,{mode:0o700});const path=join(snapshotDir,'paperknow.sqlite'),db=new DatabaseSync(path);db.exec("CREATE TABLE files(id TEXT,user_id TEXT,kind TEXT,bytes INTEGER,sha256 TEXT,storage_provider TEXT,storage_bucket TEXT,storage_key TEXT);CREATE TABLE artifacts(id TEXT,user_id TEXT,kind TEXT,bytes INTEGER,sha256 TEXT,storage_provider TEXT,storage_bucket TEXT,storage_key TEXT,status TEXT);CREATE TABLE workspace_file_deletions(file_id TEXT,status TEXT);");const content=Buffer.from('synthetic sensitive research text');db.prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?,?)').run('f1','u1','pdf',content.length,sha(content),'aliyun_oss','source-bucket','paperknow/users/u1/originals/f1.pdf');db.close();await chmod(path,0o600);await writeFile(join(snapshotDir,'snapshot.json'),JSON.stringify({createdAt:'20261114',scope:'SQLite snapshot'}),{mode:0o600});const source={bucket:'source-bucket',prefix:'paperknow/',async read(){return content;},async readArtifact(){throw Error('unexpected');}};const backupDir=(await createOssSnapshot({snapshotDir,backupRoot,storage:source})).path;const map=new Map();let fail=false;const destination={bucket:'backup-bucket',async putNew(k,b){if(map.has(k))throw Error('overwrite');if(fail)throw Error('synthetic failure');map.set(k,Buffer.from(b));},async get(k,max){const b=map.get(k);if(!b||b.length>max)throw Error('missing');return Buffer.from(b);},fail(){fail=true;}};return {root,snapshotDir,backupRoot,backupDir,restoreRoot,source,destination,content,map,key:randomBytes(32)};}
test('SSE cloud round trip restores to a private isolated directory and verifies full source mapping',async t=>{const f=await fixture(t),result=await publishSseSnapshot(f);assert.equal(result.count,1);assert.equal(f.map.size,4);const restored=await restoreSseSnapshot({...f,id:result.id});assert.equal(restored.count,1);const obj=await readdir(join(restored.path,'backups','oss-snapshot','objects'));assert.equal(obj.length,1);assert.deepEqual(await readFile(join(restored.path,'backups','oss-snapshot','objects',obj[0])),f.content);});
test('a failed upload never publishes the manifest and never deletes source or remote objects',async t=>{const f=await fixture(t);f.destination.fail();await assert.rejects(publishSseSnapshot(f));assert.equal(f.map.size,0);assert.deepEqual(await readFile(join(f.snapshotDir,'snapshot.json'),'utf8'),JSON.stringify({createdAt:'20261114',scope:'SQLite snapshot'}));});
test('tampering fails without leaving a restored directory',async t=>{const f=await fixture(t),result=await publishSseSnapshot(f);const name=[...f.map.keys()].find(k=>k.includes('/objects/'));const b=f.map.get(name);b[b.length-1]^=1;await assert.rejects(restoreSseSnapshot({...f,id:result.id}));assert.deepEqual(await readdir(f.restoreRoot),[]);});
test('source and destination cannot be the same bucket and no copy is attempted',async t=>{const f=await fixture(t);f.destination.bucket=f.source.bucket;await assert.rejects(publishSseSnapshot(f));assert.equal(f.map.size,0);});
test('uncommitted cloud runs cannot be restored',async t=>{const f=await fixture(t),result=await publishSseSnapshot(f);f.map.delete(`paperknow-sse-backup-v1/${result.id}/manifest`);await assert.rejects(restoreSseSnapshot({...f,id:result.id}));assert.deepEqual(await readdir(f.restoreRoot),[]);});

test('a mid-upload failure leaves only unpublished objects and never deletes them',async t=>{const f=await fixture(t);let calls=0;const put=f.destination.putNew;f.destination.putNew=async(k,b)=>{if(++calls===3)throw Error('synthetic failure');return put.call(f.destination,k,b);};await assert.rejects(publishSseSnapshot(f));assert.equal(f.map.size,2);assert.equal([...f.map.keys()].some(k=>k.endsWith('/manifest')),false);});

test('failed manifest readback may leave a manifest, and retry uses a new path',async t=>{const f=await fixture(t);const get=f.destination.get;let failOnce=true;f.destination.get=async(k,max)=>{if(k.endsWith('/manifest')&&failOnce){failOnce=false;throw Error('read failed');}return get(k,max);};await assert.rejects(publishSseSnapshot(f));const oldManifest=[...f.map.keys()].find(k=>k.endsWith('/manifest'));assert.ok(oldManifest);const result=await publishSseSnapshot(f);assert.notEqual(oldManifest,`paperknow-sse-backup-v1/${result.id}/manifest`);assert.equal([...f.map.keys()].filter(k=>k.endsWith('/manifest')).length,2);});

test('OSS adapter requires private ACL, public-access block and no versioning',async()=>{
 const env={PK_OSS_BUCKET:'source',PK_BACKUP_OSS_BUCKET:'backup',PK_BACKUP_OSS_ENDPOINT:'https://oss-cn-shanghai.aliyuncs.com',PK_BACKUP_OSS_REGION:'cn-shanghai',PK_BACKUP_OSS_ACCESS_KEY_ID:'synthetic',PK_BACKUP_OSS_ACCESS_KEY_SECRET:'synthetic'};
 let block=true,acl='private',versionStatus;
 const client={async getBucketACL(){return {acl};},async getBucketVersioning(){return {versionStatus};},_bucketRequestParams(){return {};},async request(){return {data:{BlockPublicAccess:block}};}};
 const adapter=createSseDestination(env,client);await adapter.preflight();
 block=false;await assert.rejects(adapter.preflight());block=true;
 acl='public-read';await assert.rejects(adapter.preflight());acl='private';
 versionStatus='Enabled';await assert.rejects(adapter.preflight());
});
test('OSS adapter sets SSE, forbids overwrite and rejects unencrypted retrieval',async()=>{
 const env={PK_OSS_BUCKET:'source',PK_BACKUP_OSS_BUCKET:'backup',PK_BACKUP_OSS_ENDPOINT:'https://oss-cn-shanghai.aliyuncs.com',PK_BACKUP_OSS_REGION:'cn-shanghai',PK_BACKUP_OSS_ACCESS_KEY_ID:'synthetic',PK_BACKUP_OSS_ACCESS_KEY_SECRET:'synthetic'};
 let received,encrypted=true;
 const client={async put(_n,_b,options){received=options.headers;},async getStream(){return {stream:Readable.from([Buffer.from('synthetic')]),res:{headers:encrypted?{'x-oss-server-side-encryption':'AES256'}:{}}};}};
 const adapter=createSseDestination(env,client);await adapter.putNew('x',Buffer.from('synthetic'));
 assert.equal(received['x-oss-server-side-encryption'],'AES256');assert.equal(received['x-oss-object-acl'],'private');assert.equal(received['x-oss-forbid-overwrite'],'true');
 assert.equal((await adapter.get('x',9)).toString(),'synthetic');encrypted=false;await assert.rejects(adapter.get('x',9));
});
