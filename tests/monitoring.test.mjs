import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../backend/database.mjs';
import {createMonitoring,monitoringDefaults,validateMonitoringSettings,readDirectorySummary} from '../backend/monitoring.mjs';
import {createAdminAPI} from '../backend/admin-api.mjs';
import {initializeArtifactSchema} from '../backend/artifact-service.mjs';

const GiB=1024**3;
function fixture(t,overrides={}){
 const db=database(':memory:');let at=Date.parse('2026-10-18T10:00:00Z'),directoryScans=0,probes=0;
 const config={storage:{provider:'aliyun_oss',async health(){probes++;return {ok:true,checkedAt:new Date(at).toISOString(),lastSuccessAt:new Date(at).toISOString(),apiKey:'secret-never-return'};}},...overrides.config};
 const options={clock:()=>at,volumePath:'/trusted/paperknow',databasePath:'/trusted/data.sqlite',statfs:async()=>({bsize:1,blocks:60*GiB,bavail:20*GiB}),stat:async path=>({size:path.endsWith('-wal')?0:1024}),system:{totalmem:()=>4*GiB,freemem:()=>3*GiB,cpus:()=>[{},{}],loadavg:()=>[.3,.2,.1]},directoryTargets:{releases:'/trusted/releases',backups:'/trusted/backups',untrusted:'/private/ignored'},directorySize:async()=>{directoryScans++;return {bytes:1024,entries:1,partial:false};},...overrides.options};
 const monitor=createMonitoring(db,config,options);config.monitoring=monitor;
 t.after(async()=>{await monitor.stop();if(db.isOpen)db.close();});
 return {db,monitor,config,setTime:value=>{at=value;},advance:ms=>{at+=ms;},get scans(){return directoryScans;},get probes(){return probes;}};
}
function user(db,id='admin',role='admin'){db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id+'@example.test',id,null,role,new Date().toISOString());return {id};}
function job(db,{id,status,updatedAt,userId='admin'}){db.prepare('INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,userId,'polish',status,status,JSON.stringify({private:'document-never-exposed'}),id,id,updatedAt,updatedAt);}

test('monitor settings reject target paths, notifications, nonfinite values and stale writes',()=>{
 const current={...monitoringDefaults,version:0};
 assert.equal(validateMonitoringSettings({version:0,enabled:false},current).enabled,false);
 for(const input of [{version:0,path:'/etc/passwd'},{version:0,url:'https://example.test'},{version:0,sampleIntervalSeconds:1},{version:0,enabled:'yes'},{version:0,diskCriticalPercent:80},{version:0,cpuLoadWarningPerCore:Infinity},{version:0,jobQueueWarningCount:1.5}])assert.throws(()=>validateMonitoringSettings(input,current),error=>error.status===400);
 assert.throws(()=>validateMonitoringSettings({version:1},current),error=>error.status===409);
});
test('real samples separate shared host and own process; cached directory and storage checks are bounded',async t=>{
 const f=fixture(t);await f.monitor.sample();const data=f.monitor.snapshot();
 assert.equal(data.latest.metrics.disk.usedPercent,66.67);assert.equal(data.latest.metrics.host.cores,2);
 assert.equal(data.latest.metrics.host.memoryUsedPercent,25);assert.equal(data.latest.metrics.storage.ok,true);
 assert.equal(data.latest.metrics.directories.untrusted,undefined);assert.equal(f.scans,2);assert.equal(f.probes,1);
 await f.monitor.sample();assert.equal(f.scans,2);assert.equal(f.probes,1);
 f.advance(900001);await f.monitor.sample();assert.equal(f.scans,4);assert.equal(f.probes,2);
 assert.doesNotMatch(JSON.stringify(data),/secret-never-return|trusted\/data|document-never-exposed|apiKey/);
});
test('no configuration never masquerades as verified OSS health; errors are redacted',async t=>{
 const local=fixture(t,{config:{storage:null}});await local.monitor.sample();assert.equal(local.monitor.snapshot().latest.metrics.storage.ok,false);assert.ok(local.monitor.snapshot().latest.alerts.some(row=>row.key==='oss'));
 const error=fixture(t,{config:{storage:{provider:'aliyun_oss',health:async()=>{throw Error('secret-key upstream-url');}}}});await error.monitor.sample();assert.equal(error.monitor.snapshot().latest.metrics.storage.ok,false);assert.doesNotMatch(JSON.stringify(error.monitor.snapshot()),/secret-key|upstream-url/);
 const configured=fixture(t,{config:{storage:{provider:'aliyun_oss'}}});await configured.monitor.sample();assert.equal(configured.monitor.snapshot().latest.metrics.storage.ok,null);
});
test('disk alarms persist transitions and resolve after capacity recovers',async t=>{
 let free=GiB;const f=fixture(t,{options:{statfs:async()=>({bsize:1,blocks:60*GiB,bavail:free})}});
 await f.monitor.sample();assert.equal(f.monitor.snapshot().latest.alerts.find(row=>row.key==='disk').severity,'critical');assert.equal(f.monitor.snapshot().events.length,2);
 await f.monitor.sample();assert.equal(f.monitor.snapshot().events.length,2,'repeated alert does not append a duplicate transition');
 free=30*GiB;f.advance(60000);await f.monitor.sample();assert.equal(f.monitor.snapshot().latest.alerts.length,0);assert.equal(f.monitor.snapshot().events.filter(row=>row.status==='resolved').length,2);
});
test('Linux cache is counted through MemAvailable; missing availability cannot trigger a free-memory false alarm',async t=>{
 const f=fixture(t,{options:{readLinuxMemoryInfo:async()=>`MemTotal: 4194304 kB\nMemFree: 1024 kB\nMemAvailable: 3145728 kB\n`}});
 await f.monitor.sample();assert.equal(f.monitor.snapshot().latest.metrics.host.memoryUsedPercent,25);assert.equal(f.monitor.snapshot().latest.metrics.host.memorySource,'linux_available');
 const unknown=fixture(t,{options:{readLinuxMemoryInfo:async()=>`MemTotal: 4194304 kB\nMemFree: 1 kB\n`}});await unknown.monitor.sample();
 assert.equal(unknown.monitor.snapshot().latest.metrics.host.memoryUsedPercent,null);assert.equal(unknown.monitor.snapshot().latest.alerts.some(row=>row.key==='memory'),false);
});
test('artifact aggregates use the real schema without retaining object keys or filenames',async t=>{
 const f=fixture(t);user(f.db);initializeArtifactSchema(f.db);const at='2026-10-18T09:00:00Z';
 f.db.prepare("INSERT INTO artifacts(id,user_id,name,kind,bytes,sha256,source_type,storage_provider,storage_bucket,storage_key,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'aliyun_oss',?,?,?,?,?)").run('artifact','admin','private-document.txt','txt',15,'a'.repeat(64),'writing','private-bucket','private-key','failed',at,at);
 await f.monitor.sample();const sample=f.monitor.snapshot().latest;assert.deepEqual({...sample.metrics.artifacts[0]},{status:'failed',count:1,bytes:15});assert.ok(sample.alerts.some(row=>row.key==='artifact-failures'));assert.doesNotMatch(JSON.stringify(sample),/private-document|private-key|private-bucket/);
});

function summaryOpen(value,metadata={}){
 const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));
 return async(path,flags)=>({async stat(){return {uid:0,mode:0o100644,size:bytes.length,isFile:()=>true,...metadata};},async read(buffer,offset,length,position){const count=Math.min(length,bytes.length-position);if(count>0)bytes.copy(buffer,offset,position,position+count);return {bytesRead:Math.max(0,count)};},async close(){}});
}
const summary={at:'2026-10-18T10:00:00Z',directories:{releases:{bytes:1200,partial:false},backups:{bytes:3000,partial:false},cache:{bytes:200,partial:false}}};
test('only root-owned bounded non-writable numeric summaries are trusted; malformed or oversized values fall back',async()=>{
 const at=Date.parse(summary.at),read=(value,metadata)=>readDirectorySummary('/run/paperknow-ops/storage.json',{at,openFile:summaryOpen(value,metadata)});
 const valid=await read(summary);assert.equal(valid.backups.bytes,3000);assert.equal(valid.backups.source,'root_summary');assert.equal(valid.backups.checkedAt,'2026-10-18T10:00:00.000Z');
 const absentCache=await read({...summary,directories:{releases:summary.directories.releases,backups:summary.directories.backups}});assert.equal(absentCache.backups.bytes,3000);assert.equal(absentCache.cache,undefined);
 for(const metadata of [{uid:1001},{mode:0o100666},{isFile:()=>false},{size:65537}])assert.equal(await read(summary,metadata),null);
 for(const value of ['not-json','x'.repeat(65537),{...summary,at:'2026-02-31T00:00:00Z'},{...summary,at:'2026-10-19T10:00:00Z'},{...summary,directories:{...summary.directories,backups:{bytes:-1,partial:false}}},{...summary,directories:{...summary.directories,backups:{bytes:'9000',partial:false}}}])assert.equal(await read(value),null);
 assert.equal(await readDirectorySummary('/run/paperknow-ops/storage.json',{at,openFile:async()=>{throw Object.assign(Error('link'),{code:'ELOOP'});}}),null);
 assert.equal(await readDirectorySummary('relative.json',{at,openFile:summaryOpen(summary)}),null);
 const stale=await readDirectorySummary('/run/paperknow-ops/storage.json',{at:at+27*3600000,openFile:summaryOpen(summary)});assert.equal(stale.backups.stale,true);assert.equal(stale.backups.partial,true);
});
test('trusted root summary bypasses inaccessible backup scans; stale summaries warn and untrusted summaries fall back',async t=>{
 const f=fixture(t,{options:{directorySummaryFile:'/run/paperknow-ops/storage.json',directorySummaryOpen:summaryOpen(summary)}});
 await f.monitor.sample();assert.equal(f.scans,0);assert.equal(f.monitor.snapshot().latest.metrics.directories.backups.bytes,3000);
 f.advance(27*3600000);await f.monitor.sample();assert.equal(f.monitor.snapshot().latest.metrics.directories.backups.stale,true);assert.ok(f.monitor.snapshot().latest.alerts.some(row=>row.key==='directory-summary-stale'));
 const bad=fixture(t,{options:{directorySummaryFile:'/run/paperknow-ops/storage.json',directorySummaryOpen:summaryOpen(summary,{uid:1001})}});await bad.monitor.sample();assert.equal(bad.scans,2);assert.equal(bad.monitor.snapshot().latest.metrics.directories.backups.source,'direct_scan');
});
test('HTTP rates ignore sensitive input, require sample minimum, and expire after five minutes',async t=>{
 const f=fixture(t);for(let i=0;i<19;i++)f.monitor.observeRequest({statusCode:503,durationMs:4000,path:'/secret-user-token?body=private'});
 await f.monitor.sample();assert.equal(f.monitor.snapshot().latest.alerts.filter(row=>row.key.startsWith('http')).length,0);
 f.monitor.observeRequest({statusCode:503,durationMs:4000});await f.monitor.sample();assert.equal(f.monitor.snapshot().latest.alerts.filter(row=>row.key.startsWith('http')).length,2);
 assert.doesNotMatch(JSON.stringify(f.monitor.snapshot()),/secret-user-token|private/);
 f.advance(300001);await f.monitor.sample();assert.equal(f.monitor.snapshot().latest.metrics.http.count,0);assert.equal(f.monitor.snapshot().latest.metrics.http.p95Ms,null);
});
test('task backlog, long-running tasks, failure ratio and stale preholds are measured without body data',async t=>{
 const f=fixture(t);user(f.db);const old='2026-10-18T08:00:00Z';
 f.db.exec("CREATE TABLE billing_reservations(id TEXT,job_id TEXT,credits INTEGER,status TEXT,updated_at TEXT)");
 for(let i=0;i<5;i++)job(f.db,{id:'failed-'+i,status:'failed',updatedAt:old});
 job(f.db,{id:'running',status:'running',updatedAt:old});
 f.db.prepare('INSERT INTO billing_reservations VALUES(?,?,?,?,?)').run('held','running',10,'held',old);
 await f.monitor.sample();const latest=f.monitor.snapshot().latest;
 assert.equal(latest.metrics.jobs.failed24h,5);assert.equal(latest.metrics.jobs.failurePercent,100);assert.equal(latest.metrics.jobs.stale,1);assert.equal(latest.metrics.reservations.stale,1);
 assert.ok(latest.alerts.some(row=>row.key==='job-failures'));assert.ok(latest.alerts.some(row=>row.key==='held-reservations'));
 assert.doesNotMatch(JSON.stringify(latest),/document-never-exposed|failed-0|example.test/);
});
test('history and transition retention remain bounded and payloads never contain request paths',async t=>{
 let low=false;const f=fixture(t,{options:{statfs:async()=>({bsize:1,blocks:60*GiB,bavail:(low?1:30)*GiB})}});
 for(let i=0;i<1450;i++){low=!low;f.advance(60000);await f.monitor.sample();}
 assert.equal(f.db.prepare('SELECT count(*) n FROM monitoring_samples').get().n,1440);
 assert.equal(f.db.prepare('SELECT count(*) n FROM monitoring_events').get().n,200);
 assert.equal(f.monitor.snapshot().history.length,100);assert.equal(f.monitor.snapshot().events.length,30);
});
test('settings persist with versions; paused sampler cannot collect and manual sampling is rate limited',async t=>{
 const f=fixture(t);await f.monitor.sample();const samples=f.db.prepare('SELECT count(*) n FROM monitoring_samples').get().n;
 const saved=f.monitor.save({version:0,enabled:false,sampleIntervalSeconds:120});assert.equal(saved.version,1);assert.equal(saved.sampleIntervalSeconds,120);
 assert.throws(()=>f.monitor.save({version:0,enabled:true}),error=>error.status===409);
 f.advance(60000);await f.monitor.sample();assert.equal(f.db.prepare('SELECT count(*) n FROM monitoring_samples').get().n,samples);
 await f.monitor.manualSample();await assert.rejects(f.monitor.manualSample(),error=>error.status===429);
 f.monitor.start();assert.equal(f.monitor.snapshot().sampler.running,true);await f.monitor.stop();assert.equal(f.monitor.snapshot().sampler.running,false);
});
test('sampling failures keep last successful data visibly stale rather than reporting healthy',async t=>{
 let broken=false;const f=fixture(t,{options:{statfs:async()=>{if(broken)throw Error('private absolute path');return {bsize:1,blocks:60*GiB,bavail:30*GiB};}}});
 await f.monitor.sample();const first=f.monitor.snapshot().latest.sampledAt;broken=true;f.advance(300000);await f.monitor.sample();const data=f.monitor.snapshot();
 assert.equal(data.latest.sampledAt,first);assert.equal(data.sampler.stale,true);assert.ok(data.sampler.lastErrorAt);assert.doesNotMatch(JSON.stringify(data),/private absolute path/);
});
test('automatic sampling continues without an admin page and reschedules after configuration changes',async t=>{
 let scheduled,delay,cleared=0;
 const f=fixture(t,{options:{timers:{setTimeout(fn,ms){scheduled=fn;delay=ms;return {unref(){}};},clearTimeout(){cleared++;}}}});
 f.monitor.start();await f.monitor.sample();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(delay,60000);assert.equal(f.db.prepare('SELECT count(*) n FROM monitoring_samples').get().n,1);
 f.advance(60000);scheduled();await f.monitor.sample();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.db.prepare('SELECT count(*) n FROM monitoring_samples').get().n,2);
 f.monitor.save({version:0,sampleIntervalSeconds:120});assert.equal(delay,120000);assert.ok(cleared);
 f.monitor.save({version:1,enabled:false});await f.monitor.stop();assert.equal(f.monitor.snapshot().sampler.enabled,false);
});
test('closing a database during in-flight startup sampling stops cleanly without timer or finish-hook exceptions',async t=>{
 let release,scheduled=0;const f=fixture(t,{options:{statfs:()=>new Promise(resolve=>{release=resolve;}),timers:{setTimeout(){scheduled++;return {unref(){}};},clearTimeout(){}}}});
 f.monitor.start();f.db.close();release({bsize:1,blocks:60*GiB,bavail:30*GiB});
 await f.monitor.stop();await new Promise(resolve=>setImmediate(resolve));assert.equal(scheduled,0);
 assert.doesNotThrow(()=>f.monitor.observeRequest({statusCode:200,durationMs:5}));
 assert.equal(await f.monitor.sample(),null);assert.doesNotThrow(()=>f.monitor.start());await f.monitor.stop();
});
test('admin monitor API independently rechecks role and validates parameters; saves audit safely',async t=>{
 const f=fixture(t),admin=user(f.db),ordinary=user(f.db,'ordinary','user');
 const api=createAdminAPI(f.db,{},f.config,{options:()=>({})});
 const request=(path,method='GET',input={},account=admin,query=new URLSearchParams())=>api({path,method,user:account,query,readBody:async()=>input});
 await assert.rejects(request('/api/admin/monitoring','GET',{},null),error=>error.status===401);
 await assert.rejects(request('/api/admin/monitoring','GET',{},ordinary),error=>error.status===403);
 await assert.rejects(request('/api/admin/monitoring','GET',{},admin,new URLSearchParams('path=/etc/passwd')),error=>error.status===400);
 const saved=await request('/api/admin/monitoring/settings','POST',{version:0,enabled:true});assert.equal(saved.settings.version,1);
 assert.equal(f.db.prepare("SELECT count(*) n FROM admin_audit WHERE action='monitoring.settings.update'").get().n,1);
 await assert.rejects(request('/api/admin/monitoring/sample','POST',{url:'https://private.test'}),error=>error.status===400);
 const sampled=await request('/api/admin/monitoring/sample','POST',{});assert.ok(sampled.latest.sampledAt);
 f.db.prepare("UPDATE users SET role='user' WHERE id=?").run(admin.id);await assert.rejects(request('/api/admin/monitoring'),error=>error.status===403);
});
