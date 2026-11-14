// Explicit, opt-in offline export of OSS objects referenced by one SQLite snapshot.
// No remote writes, deletes, bucket creation, automatic scheduling, or live restore.
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp,rename,rm,lstat,realpath,copyFile,readdir} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createStorage} from '../backend/storage.mjs';
import {environmentConfig} from '../backend/config.mjs';

const digest=data=>createHash('sha256').update(data).digest('hex');
async function fileDigest(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
const inside=(parent,child)=>{const p=relative(parent,child);return p===''||(!p.startsWith('..')&&!p.startsWith('/'));};
const fileId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(v);
async function privateDir(path){const absolute=resolve(path),stat=await lstat(absolute);if(stat.isSymbolicLink()||!stat.isDirectory()||(stat.mode&0o777)!==0o700||stat.uid!==process.getuid()||await realpath(absolute)!==absolute)throw Error('directory must be private, owned and not use symlinks');return absolute;}
async function regular(path){const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw Error('snapshot file is not private or regular');return stat;}
async function sourceRows(snapshotDir,storage){
 if(!storage||typeof storage.bucket!=='string'||!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(storage.bucket)||typeof storage.prefix!=='string'||!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/.test(storage.prefix))throw Error('storage identity invalid');
 const source=await privateDir(snapshotDir), dbPath=join(source,'paperknow.sqlite');await regular(join(source,'snapshot.json'));await regular(dbPath);
 const meta=JSON.parse(await readFile(join(source,'snapshot.json'),'utf8'));if(!meta.createdAt||!String(meta.scope||'').includes('SQLite'))throw Error('invalid snapshot metadata');
 for(const suffix of ['-wal','-journal']){try{const st=await lstat(dbPath+suffix);if(st.isSymbolicLink()||suffix==='-journal'||st.size)throw Error('snapshot has live journal');}catch(e){if(e.code!=='ENOENT')throw e;}}
 const dbDigest=await fileDigest(dbPath);const db=new DatabaseSync(dbPath,{readOnly:true});let rows;try{
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').get()!==undefined)throw Error('database check failed');
  if(db.prepare("SELECT count(*) AS n FROM workspace_file_deletions WHERE status='pending'").get().n)throw Error('snapshot has pending deletions');
  if(db.prepare("SELECT count(*) AS n FROM artifacts WHERE status IN ('uploading','deleting')").get().n)throw Error('snapshot has pending artifact changes');
  rows=[...db.prepare("SELECT id,user_id,kind,bytes,sha256,storage_provider,storage_bucket,storage_key,'originals' AS area FROM files WHERE storage_provider='aliyun_oss'").all(),...db.prepare("SELECT id,user_id,kind,bytes,sha256,storage_provider,storage_bucket,storage_key,'exports' AS area FROM artifacts WHERE status='ready' AND storage_provider='aliyun_oss'").all()];
 }finally{db.close();}
 const seen=new Set();for(const row of rows){if(!fileId(row.id)||!fileId(row.user_id)||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>20*1024*1024||!/^([a-f0-9]{64})$/.test(row.sha256)||row.storage_bucket!==storage.bucket||row.storage_key!==`${storage.prefix}users/${row.user_id}/${row.area}/${row.id}.${row.kind}`||!/^([a-z0-9]+)$/.test(row.kind)||seen.has(row.storage_key))throw Error('object metadata invalid');seen.add(row.storage_key);}
 if(await fileDigest(dbPath)!==dbDigest)throw Error('database snapshot changed');rows.sort((a,b)=>a.storage_key<b.storage_key?-1:a.storage_key>b.storage_key?1:0);return {source,dbPath,dbDigest,createdAt:meta.createdAt,rows};
}
async function rootFor(root,source){const path=await privateDir(root);if(inside(path,source)||inside(source,path)||['/var/lib/paperknow','/opt/paperknow','/etc/paperknow'].some(p=>inside(p,path)))throw Error('backup destination overlaps source or application');return path;}
const entry=row=>({key:row.storage_key,area:row.area,bytes:row.bytes,sha256:row.sha256,file:digest(row.storage_key)});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function createOssSnapshot({snapshotDir,backupRoot,storage}){
 if(!storage||typeof storage.read!=='function'||typeof storage.readArtifact!=='function')throw Error('read-only storage is required');
 const {source,dbPath,dbDigest,createdAt,rows}=await sourceRows(snapshotDir,storage),root=await rootFor(backupRoot,source),tmp=await mkdtemp(join(root,'.paperknow-oss-incomplete-'));
 try{await mkdir(join(tmp,'objects'),{mode:0o700});const databaseSha256=dbDigest,entries=[];for(const row of rows){const bytes=await (row.area==='originals'?storage.read(row):storage.readArtifact(row));if(!Buffer.isBuffer(bytes)||bytes.length!==row.bytes||digest(bytes)!==row.sha256)throw Error('object integrity failed');const item=entry(row);await writeFile(join(tmp,'objects',item.file),bytes,{mode:0o600,flag:'wx'});entries.push(item);}
  if(await fileDigest(dbPath)!==databaseSha256)throw Error('database snapshot changed');const manifest={version:1,createdAt:new Date().toISOString(),databaseCreatedAt:createdAt,databaseSha256,bucket:storage.bucket,prefix:storage.prefix,entries};await writeFile(join(tmp,'manifest.json'),JSON.stringify(manifest)+'\n',{mode:0o600,flag:'wx'});if(await fileDigest(dbPath)!==databaseSha256)throw Error('database snapshot changed');
  const result=join(root,'oss-snapshot-'+randomUUID());await rename(tmp,result);return {path:result,count:entries.length};
 }catch(error){await rm(tmp,{recursive:true,force:true});throw error;}
}
export async function verifyOssSnapshot({snapshotDir,backupRoot,backupDir,storage}){
 const {source,dbPath,dbDigest,createdAt,rows}=await sourceRows(snapshotDir,storage),root=await rootFor(backupRoot,source),backup=await privateDir(backupDir);if(relative(root,backup).includes('/')||relative(root,backup).startsWith('..')||backup===root)throw Error('backup must be a direct child of backup root');
 const path=join(backup,'manifest.json');await regular(path);const manifest=JSON.parse(await readFile(path,'utf8'));if(manifest.version!==1||manifest.bucket!==storage.bucket||manifest.prefix!==storage.prefix||manifest.databaseCreatedAt!==createdAt||manifest.databaseSha256!==dbDigest||!equal(manifest.entries,rows.map(entry)))throw Error('snapshot manifest mismatch');
 const objects=await privateDir(join(backup,'objects'));if(!equal((await readdir(objects)).sort(),manifest.entries.map(item=>item.file).sort()))throw Error('backup object set mismatch');const tmp=await mkdtemp(join(root,'.paperknow-restore-check-'));try{for(const e of manifest.entries){const src=join(objects,e.file);const stat=await regular(src);if(stat.size!==e.bytes)throw Error('object size mismatch');const dest=join(tmp,e.file);await copyFile(src,dest);const bytes=await readFile(dest);if(bytes.length!==e.bytes||digest(bytes)!==e.sha256)throw Error('object checksum mismatch');}if(await fileDigest(dbPath)!==dbDigest)throw Error('database snapshot changed');return {count:manifest.entries.length,verified:true};}finally{await rm(tmp,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 // The caller provides credentials in its protected environment; never read or print a secret file.
 try{if(process.argv.length!==5||!['backup','verify'].includes(process.argv[2]))throw Error('invalid arguments');const config=environmentConfig(),storage=process.argv[2]==='backup'?createStorage(config):{bucket:config.ossBucket,prefix:config.ossPrefix};if(!storage)throw Error('storage unavailable');if(process.argv[2]==='backup'){const result=await createOssSnapshot({snapshotDir:process.argv[3],backupRoot:process.argv[4],storage});console.log(JSON.stringify({path:result.path,count:result.count}));}else{const backup=resolve(process.argv[4]),root=resolve(backup,'..'),result=await verifyOssSnapshot({snapshotDir:process.argv[3],backupRoot:root,backupDir:backup,storage});console.log(JSON.stringify(result));}}catch{console.error('OSS snapshot operation failed; no live data changed.');process.exitCode=1;}
}
