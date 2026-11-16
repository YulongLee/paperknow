import {isMainModule} from './entrypoint.mjs';
// Database recovery points in private SSE-OSS; originals/exports remain in their
// source OSS bucket. This is not a cross-account backup of those objects.
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,lstat,statfs,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSseDestination} from './oss-cloud-sse-snapshot.mjs';

const maxDatabaseBytes=100*1024*1024,hex=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest=b=>createHash('sha256').update(b).digest('hex');
const key=(id,name)=>`paperknow-metadata-v1/${id}/${name}`;
export function inspectDatabase(path){
 // immutable=1 prevents SQLite from creating WAL/SHM beside a completed copy.
 // Never use it for the live source: snapshot_database first includes its WAL.
 const script=`import sqlite3,json,sys
from pathlib import Path
p=Path(sys.argv[1])
for suffix in ('-wal','-journal'):
 q=Path(str(p)+suffix)
 if q.is_symlink() or q.exists() and (suffix=='-journal' or q.stat().st_size): raise ValueError('live sidecar')
c=sqlite3.connect(p.resolve().as_uri()+'?mode=ro&immutable=1',uri=True)
try:
 if c.execute('PRAGMA integrity_check').fetchall()!=[('ok',)] or c.execute('PRAGMA foreign_key_check').fetchone(): raise ValueError('integrity')
 tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
 if not {'users','jobs','orders'}.issubset(tables): raise ValueError('missing application tables')
 print(json.dumps({t:c.execute('SELECT count(*) FROM "'+t+'"').fetchone()[0] for t in ['users','projects','jobs','orders','payment_orders','payment_credit_ledger','billing_reservations','theses','thesis_chapter_versions','files','workspace_files','artifacts'] if t in tables}))
finally: c.close()`;
 const result=spawnSync('python3',['-I','-c',script,path],{encoding:'utf8',timeout:120000,maxBuffer:65536});
 if(result.status!==0)throw Error('database recovery verification failed');return JSON.parse(result.stdout);
}
async function privateDirectory(path){const p=resolve(path),s=await lstat(p);if(s.isSymbolicLink()||!s.isDirectory()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700)throw Error('private directory required');return p;}
export async function publishMetadata({path,destination,now=new Date().toISOString(),release}){
 const s=await lstat(path);if(s.isSymbolicLink()||!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)||s.size>maxDatabaseBytes||s.size<1)throw Error('private completed snapshot required');
 if(!/^[a-f0-9]{40}$/.test(release||''))throw Error('release identity required');
 const counts=inspectDatabase(path),bytes=await readFile(path),id=randomUUID();
 const manifest={version:1,id,createdAt:now,release,bytes:bytes.length,sha256:digest(bytes),counts,scope:'SQLite metadata only; application secrets and external OSS objects excluded'};
 await destination.putNew(key(id,'database'),bytes);
 const checked=await destination.get(key(id,'database'),bytes.length);if(!checked.equals(bytes))throw Error('cloud database read-back failed');
 const meta=Buffer.from(JSON.stringify(manifest)+'\n');await destination.putNew(key(id,'manifest'),meta);
 if(!(await destination.get(key(id,'manifest'),65536)).equals(meta))throw Error('cloud manifest read-back failed');
 return manifest;
}
export async function verifyMetadataRestore({id,destination,root}){
 if(!uuid.test(id||''))throw Error('invalid snapshot identity');await privateDirectory(root);
 const m=JSON.parse((await destination.get(key(id,'manifest'),65536)).toString('utf8'));
 if(m.version!==1||m.id!==id||!hex.test(m.sha256||'')||!Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>maxDatabaseBytes||!m.counts||Object.keys(m.counts).length>20)throw Error('invalid snapshot manifest');
 const bytes=await destination.get(key(id,'database'),m.bytes);if(bytes.length!==m.bytes||digest(bytes)!==m.sha256)throw Error('cloud database hash mismatch');
 const temp=await mkdtemp(join(root,'restore-'));try{
  const path=join(temp,'restored.sqlite');await writeFile(path,bytes,{mode:0o600,flag:'wx'});
  const counts=inspectDatabase(path);if(JSON.stringify(counts)!==JSON.stringify(m.counts))throw Error('restored application counts mismatch');
  return {id,sha256:m.sha256,bytes:m.bytes,structure:'passed',foreignKeys:'passed',recordCounts:'passed',scope:m.scope};
 }finally{await rm(temp,{recursive:true,force:true});}
}
async function main(){
 if(process.getuid?.()!==0||process.platform!=='linux')throw Error('installed root service required');
 const command=process.argv[2];if(command!=='backup'&&command!=='verify')throw Error('choose backup or verify');
 if(command==='backup'&&process.argv.length!==3||command==='verify'&&process.argv.length!==4)throw Error('unsupported arguments');
 const destination=createSseDestination(process.env);await destination.preflight();
 // tmpfs avoids leaving plaintext copies of account metadata on a normal disk.
 if(Number((await statfs('/dev/shm')).type)!==0x01021994)throw Error('private memory filesystem unavailable');
 const temp=await mkdtemp('/dev/shm/paperknow-cloud-backup-');await privateDirectory(temp);
 try{
  if(command==='verify'){console.log(JSON.stringify(await verifyMetadataRestore({id:process.argv[3],destination,root:temp})));return;}
  const path=join(temp,'snapshot.sqlite'),helper=fileURLToPath(new URL('./backup.py',import.meta.url));
  const script="import runpy,sys; from pathlib import Path; runpy.run_path(sys.argv[1])['snapshot_database'](Path('/var/lib/paperknow/paperknow.sqlite'),Path(sys.argv[2]))";
  const copied=spawnSync('/usr/bin/python3',['-I','-c',script,helper,path],{timeout:135000,encoding:'utf8'});if(copied.status!==0)throw Error('SQLite snapshot failed');
  const release=(await readFile('/opt/paperknow/current/.paperknow-commit','utf8')).trim();
  const manifest=await publishMetadata({path,destination,release});
  const verified=await verifyMetadataRestore({id:manifest.id,destination,root:temp});
  const stateRoot='/var/lib/paperknow-ops';await mkdir(stateRoot,{mode:0o700,recursive:true});await privateDirectory(stateRoot);
  const status={lastSuccessAt:new Date().toISOString(),...verified},file=stateRoot+'/backup-status.json',pending=file+'.'+process.pid;
  await writeFile(pending,JSON.stringify(status)+'\n',{mode:0o600,flag:'wx'});await rename(pending,file);
  console.log(JSON.stringify(status));
 }finally{await rm(temp,{recursive:true,force:true});}
}
if(isMainModule(import.meta.url))main().catch(async()=>{
 if(process.getuid?.()===0&&process.argv[2]==='backup')try{const root='/var/lib/paperknow-ops';await privateDirectory(root);const file=root+'/backup-status.json';let previous={};try{const s=await lstat(file);if(s.isSymbolicLink()||(s.mode&0o077)||s.uid!==0)throw Error('invalid state');previous=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}const temp=file+'.'+process.pid;await writeFile(temp,JSON.stringify({...previous,lastFailureAt:new Date().toISOString()})+'\n',{mode:0o600,flag:'wx'});await rename(temp,file);}catch{/* The service also exits failed; never expose provider diagnostics. */}
 console.error('PaperKnow cloud metadata backup/restore check failed. No live data was restored; remote partial objects may remain.');process.exitCode=1;
});
