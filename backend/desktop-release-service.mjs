import {createHash} from 'node:crypto';
import {createDesktopReleaseStorage,desktopReleaseVersion} from './desktop-release-storage.mjs';

export const desktopReleaseSchema=`CREATE TABLE IF NOT EXISTS desktop_releases(
 id TEXT PRIMARY KEY,platform TEXT NOT NULL CHECK(platform IN ('macos','windows')),arch TEXT NOT NULL CHECK(arch IN ('arm64','x64')),
 version TEXT NOT NULL,file_name TEXT NOT NULL,bytes INTEGER NOT NULL CHECK(bytes>0),sha256 TEXT NOT NULL,
 storage_provider TEXT NOT NULL CHECK(storage_provider='aliyun_oss'),storage_bucket TEXT NOT NULL,storage_key TEXT NOT NULL UNIQUE,
 min_system TEXT NOT NULL,format TEXT NOT NULL,signed INTEGER NOT NULL CHECK(signed=0),published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
 created_at TEXT NOT NULL,published_at TEXT,UNIQUE(platform,arch,version,sha256)
 );
 CREATE UNIQUE INDEX IF NOT EXISTS desktop_release_current ON desktop_releases(platform,arch) WHERE published=1;
 CREATE TABLE IF NOT EXISTS desktop_release_catalog(id INTEGER PRIMARY KEY CHECK(id=1),version TEXT NOT NULL,revision TEXT NOT NULL,updated_at TEXT NOT NULL);`;
export function initializeDesktopReleases(db){db.exec(desktopReleaseSchema);}
const decode=row=>({platform:row.platform,arch:row.arch,version:row.version,fileName:row.file_name,bytes:row.bytes,sha256:row.sha256,storageProvider:row.storage_provider,storageBucket:row.storage_bucket,storageKey:row.storage_key,minSystem:row.min_system,format:row.format,signed:false});
export const desktopCatalogRevision=db=>db.prepare('SELECT revision FROM desktop_release_catalog WHERE id=1').get()?.revision||'empty';
export function validateDesktopManifest(manifest,storage){
 if(!storage)throw new Error('客户端 OSS 尚未配置');
 if(!manifest||manifest.schemaVersion!==1||typeof manifest.version!=='string'||!Array.isArray(manifest.releases)||!manifest.releases.length||manifest.releases.length>3||Object.keys(manifest).some(key=>!['schemaVersion','version','releases'].includes(key)))throw new Error('客户端发布清单无效');
 const keys=new Set(),allowed=new Set(['platform','arch','version','fileName','bytes','sha256','minSystem','format','signed','storageProvider','storageBucket','storageKey']);
 const releases=manifest.releases.map(value=>{
  if(!value||Object.keys(value).some(key=>!allowed.has(key)))throw new Error('客户端发布清单包含未授权字段');
  const release=storage.descriptor(value),key=`${release.platform}/${release.arch}`;
  if(release.version!==manifest.version||keys.has(key))throw new Error('客户端清单版本不一致或系统重复');keys.add(key);return release;
 }).sort((a,b)=>`${a.platform}/${a.arch}`.localeCompare(`${b.platform}/${b.arch}`));
 return {schemaVersion:1,version:manifest.version,releases};
}
export async function publishDesktopManifest(db,storage,manifest,{expectedRevision}={}){
 const target=validateDesktopManifest(manifest,storage),revision=createHash('sha256').update(JSON.stringify(target)).digest('hex');
 if(typeof expectedRevision!=='string'||!(/^(?:empty|[a-f0-9]{64})$/).test(expectedRevision))throw new Error('请先读取目录 revision，再显式确认发布');
 // Verify every private object before starting the short SQLite transaction.
 for(const release of target.releases)await storage.verify(release);
 db.exec('BEGIN IMMEDIATE');
 try{
  const current=desktopCatalogRevision(db);
  if(current===revision){db.exec('COMMIT');return {published:true,changed:false,version:target.version,revision,count:target.releases.length};}
  if(current!==expectedRevision)throw new Error('客户端目录已被其他发布更新，请重新核对 revision');
  const timestamp=new Date().toISOString();
  for(const release of target.releases){
   const existing=db.prepare('SELECT * FROM desktop_releases WHERE storage_key=?').get(release.storageKey);
   if(existing){const original=decode(existing);if(Object.entries(release).some(([key,value])=>original[key]!==value))throw new Error('历史安装包的描述不可更改，请重新构建后使用新的文件哈希发布');}
  }
  db.prepare('UPDATE desktop_releases SET published=0 WHERE published=1').run();
  for(const release of target.releases){
   const id=createHash('sha256').update(release.storageKey).digest('hex');
   db.prepare(`INSERT INTO desktop_releases(id,platform,arch,version,file_name,bytes,sha256,storage_provider,storage_bucket,storage_key,min_system,format,signed,published,created_at,published_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,1,?,?) ON CONFLICT(id) DO UPDATE SET published=1,published_at=excluded.published_at`).run(id,release.platform,release.arch,release.version,release.fileName,release.bytes,release.sha256,release.storageProvider,release.storageBucket,release.storageKey,release.minSystem,release.format,timestamp,timestamp);
  }
  db.prepare('INSERT INTO desktop_release_catalog(id,version,revision,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,revision=excluded.revision,updated_at=excluded.updated_at').run(target.version,revision,timestamp);
  db.exec('COMMIT');return {published:true,changed:true,version:target.version,revision,count:target.releases.length};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function createDesktopReleaseService(db,config={}){
 const storage=config.desktopReleaseStorage||createDesktopReleaseStorage(config,config.desktopOSSClient);
 return {
  catalog(){
   const row=db.prepare('SELECT version FROM desktop_release_catalog WHERE id=1').get();
   const releases=[];
   if(storage)for(const item of db.prepare('SELECT * FROM desktop_releases WHERE published=1 ORDER BY platform,arch').all()){
    try{const release=storage.descriptor(decode(item));releases.push({platform:release.platform,arch:release.arch,version:release.version,fileName:release.fileName,bytes:release.bytes,sha256:release.sha256,minSystem:release.minSystem,format:release.format,signed:false,downloadUrl:`/api/desktop/download/${release.platform}/${release.arch}`});}catch{/* An invalid or foreign object is never advertised. */}
   }
   return {version:row?.version||desktopReleaseVersion,releases};
  },
  async download(platform,arch){
   if(!/^(?:macos|windows)$/.test(platform)||!/^(?:arm64|x64)$/.test(arch))throw Object.assign(new Error('没有对应系统的安装包'),{status:404});
   const row=db.prepare('SELECT * FROM desktop_releases WHERE platform=? AND arch=? AND published=1').get(platform,arch);
   if(!row)throw Object.assign(new Error('此系统的客户端暂未发布'),{status:404});
   if(!storage)throw Object.assign(new Error('客户端下载暂时不可用，请稍后重试'),{status:503});
   try{return await storage.downloadURL(decode(row));}catch{throw Object.assign(new Error('客户端下载暂时不可用，请稍后重试'),{status:503});}
  }
 };
}
