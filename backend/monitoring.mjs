import {stat,statfs,opendir,readFile,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import os from 'node:os';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const monitoringDefaults=Object.freeze({enabled:true,sampleIntervalSeconds:60,diskWarningPercent:80,diskCriticalPercent:90,minimumFreeGiB:2,hostMemoryWarningPercent:90,processMemoryWarningMiB:768,cpuLoadWarningPerCore:1.5,jobQueueWarningCount:20,jobStaleMinutes:20,jobFailureWarningPercent:20,minimumJobSamples:5,httpErrorWarningPercent:5,httpP95WarningMs:3000,minimumRequestSamples:20,pendingPaymentWarningCount:50,heldReservationMinutes:30,databaseWarningMiB:1024,walWarningMiB:128,releasesWarningGiB:5,backupsWarningGiB:10,cacheWarningGiB:1,artifactFailureWarningCount:1});
const ranges={sampleIntervalSeconds:[30,600],diskWarningPercent:[50,95],diskCriticalPercent:[60,99],minimumFreeGiB:[0.25,100],hostMemoryWarningPercent:[50,99],processMemoryWarningMiB:[64,32768],cpuLoadWarningPerCore:[0.5,16],jobQueueWarningCount:[1,10000],jobStaleMinutes:[1,240],jobFailureWarningPercent:[1,100],minimumJobSamples:[1,100],httpErrorWarningPercent:[1,100],httpP95WarningMs:[100,120000],minimumRequestSamples:[1,1000],pendingPaymentWarningCount:[1,10000],heldReservationMinutes:[1,1440],databaseWarningMiB:[1,102400],walWarningMiB:[1,10240],releasesWarningGiB:[0.1,1000],backupsWarningGiB:[0.1,1000],cacheWarningGiB:[0.1,100],artifactFailureWarningCount:[1,10000]};
const decimalKeys=new Set(['minimumFreeGiB','cpuLoadWarningPerCore','releasesWarningGiB','backupsWarningGiB','cacheWarningGiB']);
export function validateMonitoringSettings(input,current={...monitoringDefaults,version:0}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(monitoringDefaults,key)&&key!=='version'))fail(400,'监控设置字段不正确');
  if(!Number.isSafeInteger(input.version)||input.version!==current.version)fail(409,'监控设置已更新，请刷新后重试');
  const next={...current};delete next.updatedAt;
  for(const [key,value] of Object.entries(input)){
    if(key==='version')continue;
    if(key==='enabled'){if(typeof value!=='boolean')fail(400,'监控启停状态不正确');}
    else {const [min,max]=ranges[key];if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(!decimalKeys.has(key)&&!Number.isSafeInteger(value)))fail(400,'监控阈值超出允许范围');}
    next[key]=value;
  }
  if(next.diskCriticalPercent<=next.diskWarningPercent)fail(400,'磁盘严重阈值必须大于预警阈值');
  return {...next,version:current.version+1};
}
const GiB=1024**3,MiB=1024**2;
const finite=value=>Number.isFinite(value)?Math.round(value*100)/100:null;

// A root-produced numeric summary avoids granting the application access to
// private database/config backup directories. The pathname is bootstrap-only.
export async function readDirectorySummary(path,{at=Date.now(),openFile=open}={}){
  if(typeof path!=='string'||!isAbsolute(path))return null;
  let handle;
  try{
    handle=await openFile(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    const metadata=await handle.stat();
    if(metadata.uid!==0||!metadata.isFile()||(metadata.mode&0o022)!==0||metadata.size>65536)return null;
    const buffer=Buffer.alloc(65537);let length=0;
    while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,length);if(!bytesRead)break;length+=bytesRead;}
    if(length>65536)return null;
    const summary=JSON.parse(buffer.subarray(0,length).toString('utf8'));
    if(!summary||typeof summary.at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(summary.at)||!Number.isFinite(Date.parse(summary.at)))return null;
    const iso=new Date(summary.at).toISOString();if(iso!==summary.at&&iso.replace('.000Z','Z')!==summary.at)return null;
    const age=at-Date.parse(summary.at);if(age< -300000||!summary.directories||typeof summary.directories!=='object')return null;
    const stale=age>26*3600000,result={};
    for(const key of ['releases','backups','cache']){
      if(!Object.hasOwn(summary.directories,key))continue;
      const item=summary.directories[key];if(!item||typeof item.bytes!=='number'||!Number.isFinite(item.bytes)||item.bytes<0||item.bytes>Number.MAX_SAFE_INTEGER||typeof item.partial!=='boolean')return null;
      result[key]={bytes:item.bytes,partial:item.partial||stale,stale,checkedAt:iso,source:'root_summary'};
    }
    return Object.keys(result).length?result:null;
  }catch{return null;}finally{try{await handle?.close();}catch{/* Closing never changes trust decisions. */}}
}

// Only bootstrap-owned paths are accepted; no browser/API input can select a path.
// Symlinks are never followed. Incomplete traversals are visibly labelled lower bounds.
async function directorySize(path,{maxEntries=100000,budgetMs=2000}={}){
  let bytes=0,entries=0,partial=false;const deadline=Date.now()+budgetMs,queue=[path];
  while(queue.length){
    if(entries>=maxEntries||Date.now()>deadline){partial=true;break;}
    const current=queue.pop();let directory;
    try{directory=await opendir(current);for await(const entry of directory){
      entries++;if(entries>maxEntries||Date.now()>deadline){partial=true;break;}
      if(entry.isSymbolicLink())continue;
      const child=join(current,entry.name);
      if(entry.isDirectory())queue.push(child);else if(entry.isFile()){try{bytes+=(await stat(child)).size;}catch{partial=true;}}
    }}catch(error){if(error.code!=='ENOENT')partial=true;}
  }
  return {bytes,entries,partial};
}

export function createMonitoring(db,config={},options={}){
  db.exec(`CREATE TABLE IF NOT EXISTS monitoring_settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS monitoring_samples(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS monitoring_events(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,metric TEXT NOT NULL,severity TEXT NOT NULL,status TEXT NOT NULL);`);
  const clock=options.clock||(()=>Date.now()),system=options.system||os;
  const fsInfo=options.statfs||statfs,fileInfo=options.stat||stat;
  const dirs=Object.fromEntries(Object.entries(options.directoryTargets||{}).filter(([key,value])=>['releases','backups','cache'].includes(key)&&typeof value==='string'));
  const dbFile=options.databasePath||db.prepare('PRAGMA database_list').all().find(item=>item.name==='main')?.file;
  const volumePath=options.volumePath||dbFile||process.cwd();
  const maxHistory=1440,maxEvents=200;let timer=null,pending=null,started=false,lastErrorAt=null,lastSampleAt=0,lastProbeAt=0,lastManualAt=-Infinity,lastDirectoryAt=0,directoryCache={},storageCache=null;
  const timers=options.timers||{setTimeout,clearTimeout};
  const requests=[];
  const databaseOpen=()=>db.isOpen!==false;
  function halt(){started=false;if(timer)timers.clearTimeout(timer);timer=null;}
  const settings=()=>{if(!databaseOpen())fail(503,'运行监控已停止');const row=db.prepare('SELECT value,version,updated_at FROM monitoring_settings WHERE id=1').get();return row?{...monitoringDefaults,...JSON.parse(row.value),version:row.version,updatedAt:row.updated_at}:{...monitoringDefaults,version:0,updatedAt:null};};
  function schedule(){if(timer)timers.clearTimeout(timer);timer=null;if(!databaseOpen()){halt();return;}if(!started||!settings().enabled)return;timer=timers.setTimeout(()=>{void sample().finally(schedule);},settings().sampleIntervalSeconds*1000);timer.unref?.();}
  function save(input){const next=validateMonitoringSettings(input,settings()),at=new Date(clock()).toISOString();db.prepare('INSERT INTO monitoring_settings(id,value,version,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,version=excluded.version,updated_at=excluded.updated_at').run(JSON.stringify(Object.fromEntries(Object.keys(monitoringDefaults).map(key=>[key,next[key]]))),next.version,at);schedule();return settings();}
  const hasTable=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  function observeRequest({statusCode,durationMs}={}){
    if(!databaseOpen()){halt();return;}
    if(!settings().enabled||!Number.isInteger(statusCode)||statusCode<100||statusCode>599||!Number.isFinite(durationMs)||durationMs<0)return;
    requests.push({at:clock(),error:statusCode>=500,ms:Math.min(durationMs,600000)});while(requests.length>10000||requests[0]?.at<clock()-300000)requests.shift();
  }
  function requestMetrics(at){while(requests[0]?.at<at-300000)requests.shift();const durations=requests.map(item=>item.ms).sort((a,b)=>a-b),count=requests.length;return {windowSeconds:300,count,errors:requests.filter(item=>item.error).length,errorPercent:count?finite(requests.filter(item=>item.error).length*100/count):null,p95Ms:count?finite(durations[Math.ceil(count*.95)-1]):null,boundedAt:10000};}
  async function size(path){if(!path)return 0;try{return (await fileInfo(path)).size;}catch(error){if(error.code==='ENOENT')return 0;throw error;}}
  async function storageHealth(at){
    const storage=config.storage;
    if(!storage)return {provider:'local_server_sqlite',configured:false,ok:false,checkedAt:null,lastSuccessAt:null,reason:'尚未启用对象存储'};
    if(typeof storage.health==='function'&&(!lastProbeAt||at-lastProbeAt>=900000)){
      lastProbeAt=at;try{storageCache=await storage.health();}catch{storageCache={ok:false,checkedAt:new Date(at).toISOString(),reason:'对象存储探测失败'};}
    }else if(typeof storage.healthStatus==='function'){try{storageCache=storage.healthStatus();}catch{/* Keep the last safe snapshot. */}}
    const raw=storageCache||{},iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
    return {provider:storage.provider==='aliyun_oss'?'aliyun_oss':'local_server_sqlite',configured:storage.provider==='aliyun_oss',ok:typeof raw.ok==='boolean'?raw.ok:null,checkedAt:iso(raw.checkedAt),lastSuccessAt:iso(raw.lastSuccessAt),reason:raw.ok===false?'对象存储实际读写探测未通过':raw.ok===true?null:'已配置，尚无实际读写探测结果'};
  }
  function businessMetrics(at,s){
    const cutoff=new Date(at-86400000).toISOString(),stale=new Date(at-s.jobStaleMinutes*60000).toISOString(),heldCutoff=new Date(at-s.heldReservationMinutes*60000).toISOString(),now=new Date(at).toISOString();
    const jobs=hasTable('jobs')?db.prepare(`SELECT sum(CASE WHEN status='queued' THEN 1 ELSE 0 END) queued,sum(CASE WHEN status='running' THEN 1 ELSE 0 END) running,sum(CASE WHEN status IN ('queued','running') AND updated_at<? THEN 1 ELSE 0 END) stale,sum(CASE WHEN status='failed' AND updated_at>=? THEN 1 ELSE 0 END) failed24h,sum(CASE WHEN status IN ('failed','completed') AND updated_at>=? THEN 1 ELSE 0 END) terminal24h FROM jobs`).get(stale,cutoff,cutoff):null;
    if(jobs){for(const key of Object.keys(jobs))jobs[key]??=0;jobs.failurePercent=jobs.terminal24h?finite(jobs.failed24h*100/jobs.terminal24h):null;}
    const reservations=hasTable('billing_reservations')?db.prepare("SELECT count(*) held,COALESCE(sum(credits),0) credits,COALESCE(sum(CASE WHEN updated_at<? THEN 1 ELSE 0 END),0) stale FROM billing_reservations WHERE status='held'").get(heldCutoff):null;
    const payments=hasTable('payment_orders')&&hasTable('orders')?db.prepare("SELECT count(*) pending,COALESCE(sum(CASE WHEN p.expires_at<? THEN 1 ELSE 0 END),0) expiredPending FROM payment_orders p JOIN orders o ON o.id=p.order_id WHERE o.status='pending'").get(now):null;
    const artifacts=hasTable('artifacts')?db.prepare('SELECT status,count(*) count,COALESCE(sum(bytes),0) bytes FROM artifacts GROUP BY status').all().filter(row=>['uploading','ready','deleting','failed','deleted'].includes(row.status)):[];
    return {jobs,reservations,payments,artifacts};
  }
  function alertsFor(m,s){
    const alerts=[],add=(key,severity,title,value,threshold,unit)=>alerts.push({key,severity,title,value,threshold,unit});
    if(m.disk.usedPercent>=s.diskCriticalPercent)add('disk','critical','服务器磁盘空间严重不足',m.disk.usedPercent,s.diskCriticalPercent,'%');
    else if(m.disk.usedPercent>=s.diskWarningPercent)add('disk','warning','服务器磁盘占用偏高',m.disk.usedPercent,s.diskWarningPercent,'%');
    if(m.disk.availableBytes<s.minimumFreeGiB*GiB)add('disk-free','critical','服务器剩余可用空间不足',finite(m.disk.availableBytes/GiB),s.minimumFreeGiB,'GiB');
    if(m.host.memoryUsedPercent!==null&&m.host.memoryUsedPercent>=s.hostMemoryWarningPercent)add('memory','warning','主机内存占用偏高',m.host.memoryUsedPercent,s.hostMemoryWarningPercent,'%');
    if(m.process.rssBytes>=s.processMemoryWarningMiB*MiB)add('process-memory','warning','本站进程内存偏高',finite(m.process.rssBytes/MiB),s.processMemoryWarningMiB,'MiB');
    if(m.host.loadPerCore>=s.cpuLoadWarningPerCore)add('cpu-load','warning','主机负载偏高',m.host.loadPerCore,s.cpuLoadWarningPerCore,'每核心负载');
    if(m.database.bytes>=s.databaseWarningMiB*MiB)add('database','warning','数据库容量偏高',finite(m.database.bytes/MiB),s.databaseWarningMiB,'MiB');
    if(m.database.walBytes>=s.walWarningMiB*MiB)add('wal','warning','数据库 WAL 容量偏高',finite(m.database.walBytes/MiB),s.walWarningMiB,'MiB');
    for(const key of ['releases','backups','cache'])if(m.directories[key]?.bytes>=s[key+'WarningGiB']*GiB)add('directory-'+key,'warning',({releases:'项目发布版本占用偏高',backups:'项目备份目录占用偏高',cache:'项目缓存目录占用偏高'})[key],finite(m.directories[key].bytes/GiB),s[key+'WarningGiB'],'GiB');
    if(Object.values(m.directories).some(item=>item.stale))add('directory-summary-stale','warning','项目容量汇总已超过更新时限',26,26,'小时');
    if(m.jobs?.queued>=s.jobQueueWarningCount)add('queue','warning','任务排队积压',m.jobs.queued,s.jobQueueWarningCount,'条');
    if(m.jobs?.stale)add('stale-jobs','warning','存在长时间未更新任务',m.jobs.stale,s.jobStaleMinutes,'分钟未更新');
    if(m.jobs?.terminal24h>=s.minimumJobSamples&&m.jobs.failurePercent>=s.jobFailureWarningPercent)add('job-failures','warning','最近 24 小时任务失败比例偏高',m.jobs.failurePercent,s.jobFailureWarningPercent,'%');
    if(m.http.count>=s.minimumRequestSamples&&m.http.errorPercent>=s.httpErrorWarningPercent)add('http-errors','warning','最近 5 分钟服务端错误比例偏高',m.http.errorPercent,s.httpErrorWarningPercent,'%');
    if(m.http.count>=s.minimumRequestSamples&&m.http.p95Ms>=s.httpP95WarningMs)add('http-latency','warning','最近 5 分钟接口响应偏慢',m.http.p95Ms,s.httpP95WarningMs,'毫秒 P95');
    if(m.reservations?.stale)add('held-reservations','warning','存在长时间未结算预占',m.reservations.stale,s.heldReservationMinutes,'分钟未结算');
    if(m.payments?.pending>=s.pendingPaymentWarningCount)add('pending-payments','warning','待支付订单数量偏高',m.payments.pending,s.pendingPaymentWarningCount,'笔');
    if(m.payments?.expiredPending)add('expired-payments','warning','存在超过有效期的待支付订单',m.payments.expiredPending,0,'笔');
    if(m.storage.ok===false)add('oss','critical','对象存储未通过读写检查',0,1,'可用');
    const failed=m.artifacts.filter(row=>row.status==='failed').reduce((n,row)=>n+row.count,0);if(failed>=s.artifactFailureWarningCount)add('artifact-failures','warning','生成文件存在存储补偿待处理',failed,s.artifactFailureWarningCount,'项');
    return alerts;
  }
  function latest(){const row=db.prepare('SELECT created_at,payload FROM monitoring_samples ORDER BY id DESC LIMIT 1').get();return row?{...JSON.parse(row.payload),sampledAt:row.created_at}:null;}
  async function collect(){
    const at=clock(),s=settings();if(!s.enabled)return latest();
    const info=await fsInfo(volumePath),block=Number(info.bsize),totalBytes=Number(info.blocks)*block,availableBytes=Number(info.bavail)*block;
    if(!totalBytes||!Number.isFinite(totalBytes)||!Number.isFinite(availableBytes))throw Error('disk metric unavailable');
    const usedBytes=(Number.isFinite(Number(info.bfree))?Math.max(0,Number(info.blocks)-Number(info.bfree)):Number(info.blocks)-Number(info.bavail))*block;
    const usedPercent=100*usedBytes/(usedBytes+availableBytes);
    const memory=process.memoryUsage(),totalMemory=system.totalmem(),cores=Math.max(1,system.cpus().length),load=system.loadavg();
    let freeMemory=system.freemem(),memorySource='os_free';
    if((system===os&&process.platform==='linux')||options.readLinuxMemoryInfo){
      // Free RAM excludes reclaimable Linux cache. Missing MemAvailable must
      // remain unknown rather than producing a false high-usage alarm.
      freeMemory=null;memorySource='unavailable';
      try{const text=await (options.readLinuxMemoryInfo||(()=>readFile('/proc/meminfo','utf8')))(),available=/^MemAvailable:\s+(\d+) kB$/m.exec(text);if(available){freeMemory=Number(available[1])*1024;memorySource='linux_available';}}catch{/* Unknown availability is shown without a false high-usage alarm. */}
    }
    if(!lastDirectoryAt||at-lastDirectoryAt>=900000){
      lastDirectoryAt=at;
      const summary=await readDirectorySummary(options.directorySummaryFile,{at,openFile:options.directorySummaryOpen||open});
      if(summary)directoryCache=summary;
      else{const values=await Promise.all(Object.entries(dirs).map(async([key,path])=>[key,{...await (options.directorySize||directorySize)(path),checkedAt:new Date(at).toISOString(),source:'direct_scan'}]));directoryCache=Object.fromEntries(values);}
    }
    const m={disk:{totalBytes,availableBytes,usedPercent:finite(usedPercent)},database:{bytes:await size(dbFile),walBytes:await size(dbFile?dbFile+'-wal':null)},process:{rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,uptimeSeconds:Math.floor(process.uptime())},host:{totalMemoryBytes:totalMemory,availableMemoryBytes:freeMemory,memorySource,memoryUsedPercent:freeMemory===null?null:finite((totalMemory-freeMemory)*100/totalMemory),cores,load1:finite(load[0]),loadPerCore:finite(load[0]/cores)},http:requestMetrics(at),...businessMetrics(at,s),directories:directoryCache,storage:await storageHealth(at)};
    const alerts=alertsFor(m,s),previous=latest()?.alerts||[],keys=new Map(previous.map(item=>[item.key,item]));
    const date=new Date(at).toISOString();
    for(const alert of alerts){if(keys.get(alert.key)?.severity!==alert.severity)db.prepare('INSERT INTO monitoring_events(created_at,metric,severity,status) VALUES(?,?,?,?)').run(date,alert.key,alert.severity,'active');keys.delete(alert.key);}
    for(const key of keys.keys())db.prepare('INSERT INTO monitoring_events(created_at,metric,severity,status) VALUES(?,?,?,?)').run(date,key,'info','resolved');
    db.prepare('INSERT INTO monitoring_samples(created_at,payload) VALUES(?,?)').run(date,JSON.stringify({metrics:m,alerts}));
    db.prepare('DELETE FROM monitoring_samples WHERE id NOT IN (SELECT id FROM monitoring_samples ORDER BY id DESC LIMIT ?)').run(maxHistory);
    db.prepare('DELETE FROM monitoring_events WHERE id NOT IN (SELECT id FROM monitoring_events ORDER BY id DESC LIMIT ?)').run(maxEvents);
    lastSampleAt=at;lastErrorAt=null;return {sampledAt:date,metrics:m,alerts};
  }
  function sample(){if(pending)return pending;if(!databaseOpen()){halt();return Promise.resolve(null);}pending=collect().catch(()=>{if(!databaseOpen()){halt();return null;}lastErrorAt=new Date(clock()).toISOString();try{return latest();}catch{return null;}}).finally(()=>{pending=null;});return pending;}
  async function manualSample(){if(clock()-lastManualAt<30000)fail(429,'请等待 30 秒后再采样');lastManualAt=clock();await sample();return snapshot();}
  function snapshot(){const s=settings(),current=latest();return {settings:s,sampler:{running:started,enabled:s.enabled,lastErrorAt,stale:!current||clock()-Date.parse(current.sampledAt)>s.sampleIntervalSeconds*2500,intervalSeconds:s.sampleIntervalSeconds},latest:current,history:db.prepare('SELECT created_at,payload FROM monitoring_samples ORDER BY id DESC LIMIT 100').all().reverse().map(row=>{const data=JSON.parse(row.payload),m=data.metrics;return {at:row.created_at,diskPercent:m.disk.usedPercent,processMemoryMiB:finite(m.process.rssBytes/MiB),loadPerCore:m.host.loadPerCore,queue:m.jobs?.queued??null,errorPercent:m.http.errorPercent,p95Ms:m.http.p95Ms,alerts:data.alerts.length};}),events:db.prepare('SELECT created_at AS at,metric,severity,status FROM monitoring_events ORDER BY id DESC LIMIT 30').all(),retention:{maximumSamples:maxHistory,maximumEvents:maxEvents,historyReturned:100,directoryScanSeconds:900,storageProbeSeconds:900},scope:{host:'整台共享服务器',process:'仅本站 Node 进程',http:'本站进程最近 5 分钟；重启后重新计数，最多 10000 请求',delivery:'仅后台告警，不会自动发邮件或短信'}};}
  return {settings,save,snapshot,sample,manualSample,observeRequest,start(){if(started||!databaseOpen())return;started=true;void sample().finally(schedule);},async stop(){halt();if(pending)await pending;}};
}
