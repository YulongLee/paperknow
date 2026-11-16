// Independent of the web process: no provider calls, task changes or user text.
import {DatabaseSync} from 'node:sqlite';
import {statfs,mkdir,readFile,writeFile,rename,lstat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import nodemailer from 'nodemailer';
import {environmentConfig} from '../backend/config.mjs';

export const alertTitles=Object.freeze({health:'网站服务不可用',sampler:'运行指标停止更新',disk:'服务器磁盘空间不足',storage:'云文件存储检查异常',queue:'任务队列异常',billing:'积分预占需要核对',exports:'成果存储需要处理',backup:'数据库云备份需要检查'});
const retryMs=10*60000,reminderMs=6*3600000;
export async function deliverAlerts({previous={},signals,now=Date.now(),send,persist=async()=>{}}){
 const state={version:1,updatedAt:new Date(now).toISOString(),alerts:{}},sent=[];
 for(const key of Object.keys(alertTitles)){
  const bad=signals[key]===true,old=previous.alerts?.[key]||{},failures=bad?Math.min(100,(old.failures||0)+1):0,successes=bad?0:Math.min(100,(old.successes||0)+1);
  const row=state.alerts[key]={failures,successes,notified:old.notified===true,lastAttempt:Number(old.lastAttempt)||0,lastSent:Number(old.lastSent)||0,delivery:old.delivery||null};
  const recovery=!bad&&successes>=2&&row.notified;
  const active=bad&&failures>=2&&(!row.notified||now-row.lastSent>=reminderMs);
  if(!(recovery||active)||now-row.lastAttempt<retryMs)continue;
  row.lastAttempt=now;row.delivery='pending';
  // Save before I/O; a killed mail request cannot retry on every timer tick.
  await persist({...state,alerts:{...previous.alerts,...state.alerts}});
  try{await send({key,status:recovery?'resolved':'active',title:alertTitles[key],at:state.updatedAt});row.lastSent=now;row.notified=!recovery;row.delivery='accepted';sent.push({key,status:recovery?'resolved':'active'});}
  catch{row.delivery='failed';}
 }
 await persist(state);return {state,sent};
}

export function monitoringSignals(sample,now){
 const signals={sampler:!sample||!Number.isFinite(Date.parse(sample.created_at))||now-Date.parse(sample.created_at)>5*60000};
 // Only stable metric identifiers enter email; no database text is forwarded.
 const keys=new Set((sample?.payload?.alerts||[]).map(row=>row.key));
 signals.storage=keys.has('oss');signals.queue=keys.has('queue')||keys.has('stale-jobs')||keys.has('job-failures');
 signals.billing=keys.has('held-reservations');signals.exports=keys.has('artifact-failures');return signals;
}
export function createAlertMailer(env,createTransport=nodemailer.createTransport){
 const config=environmentConfig(env),to=String(env.PK_OPS_ALERT_EMAIL||'').trim(),from=String(config.emailFrom||'').match(/<([^<>]+)>\s*$/)?.[1]||String(config.emailFrom||'');
 const valid=s=>s.length<=254&&/^[^\s<>(),;:"\\@]+@[^\s<>(),;:"\\@]+\.[^\s<>(),;:"\\@]+$/.test(s);
 if(!valid(to)||!valid(from)||!config.emailSMTPHost||!config.emailSMTPUser||!config.emailSMTPPassword||![465,587,25,80].includes(config.emailSMTPPort))throw Error('ops email configuration unavailable');
 const transport=createTransport({host:config.emailSMTPHost,port:config.emailSMTPPort,secure:config.emailSMTPSecure,requireTLS:!config.emailSMTPSecure,tls:{minVersion:'TLSv1.2'},auth:{user:config.emailSMTPUser,pass:config.emailSMTPPassword},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
 return async({key,status,title,at,test=false})=>{
  if(!test&&(!Object.hasOwn(alertTitles,key)||!['active','resolved'].includes(status)))throw Error('invalid ops notification');
  const kind=test?'测试告警':status==='resolved'?'恢复通知':'故障告警';
  const info=await transport.sendMail({from:{name:'PaperKnow 运维',address:from},to,subject:`PaperKnow · ${kind}${test?'':` · ${alertTitles[key]}`}`,text:`${test?'这是一封经管理员授权发送的测试邮件，不表示线上发生故障。':`${title}：${status==='resolved'?'已恢复':'请检查后台运行监控及对应服务'}`}\n\n时间（UTC）：${at}\n站点：https://paperknow.cn\n\n此邮件仅含服务状态，不含论文、账户资料或访问密钥。请勿将密码或验证码回复至本邮箱。`});
  if(!info.accepted?.some(v=>String(v).toLowerCase()===to.toLowerCase())||info.rejected?.length)throw Error('ops email not accepted');
 };
}

async function main(){
 if(process.getuid?.()!==0)throw Error('run as the installed service');
 const args=process.argv.slice(2);if(args.length>1||args.some(v=>v!=='--test-email'))throw Error('unsupported argument');
 const send=createAlertMailer(process.env),now=Date.now();
 if(args[0]==='--test-email'){await send({test:true,at:new Date(now).toISOString()});console.log('PaperKnow test email accepted by mail provider. Inbox delivery must be checked separately.');return;}
 const root='/var/lib/paperknow-ops',file=root+'/alerts.json';await mkdir(root,{mode:0o700,recursive:true});
 const directory=await lstat(root);if(directory.isSymbolicLink()||directory.uid!==0||(directory.mode&0o777)!==0o700)throw Error('ops state directory invalid');
 let previous={};try{const s=await lstat(file);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o077)||s.size>65536)throw Error('unsafe state');previous=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 let sample;try{const db=new DatabaseSync('/var/lib/paperknow/paperknow.sqlite',{readOnly:true});try{const row=db.prepare('SELECT created_at,payload FROM monitoring_samples ORDER BY id DESC LIMIT 1').get();if(row)sample={created_at:row.created_at,payload:JSON.parse(row.payload)};}finally{db.close();}}catch{/* A stopped/broken collector is itself a signal. */}
 const signals=monitoringSignals(sample,now);
 try{const r=await fetch('http://127.0.0.1:5173/api/capabilities',{signal:AbortSignal.timeout(8000),redirect:'error'});const data=await r.json();signals.health=!r.ok||data.account!==true;}catch{signals.health=true;}
 const disk=await statfs('/var/lib/paperknow');signals.disk=Number(disk.bavail)*Number(disk.bsize)<2*1024**3||1-Number(disk.bavail)/Number(disk.blocks)>.90;
 if(process.env.PK_BACKUP_OSS_BUCKET){try{const status=JSON.parse(await readFile(root+'/backup-status.json','utf8'));signals.backup=!Number.isFinite(Date.parse(status.lastSuccessAt))||now-Date.parse(status.lastSuccessAt)>30*3600000||Date.parse(status.lastFailureAt)>Date.parse(status.lastSuccessAt);}catch{signals.backup=true;}}
 const persist=async state=>{const temp=file+'.'+process.pid;await writeFile(temp,JSON.stringify(state)+'\n',{mode:0o600,flag:'wx'});await rename(temp,file);};
 const result=await deliverAlerts({previous,signals,now,send,persist}),deliveryFailures=Object.values(result.state.alerts).filter(v=>v.delivery==='failed').length;console.log(JSON.stringify({checkedAt:result.state.updatedAt,active:Object.entries(signals).filter(([,v])=>v).map(([k])=>k),notifications:result.sent,deliveryFailures}));if(deliveryFailures)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('PaperKnow operations check failed; inspect private configuration and state.');process.exitCode=1;});
