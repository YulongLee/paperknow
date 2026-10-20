import {DatabaseSync} from 'node:sqlite';
import {chmodSync,existsSync,statSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {specialistBundleDurationDays} from '../dist/workspace/specialist-commercial-offers.mjs';
import {planSpecialistOffers,applySpecialistOffers} from '../backend/specialist-commercial-offers.mjs';

export function parseSpecialistArguments(args){
 const result={apply:false,publish:false,database:null,expected:null,backup:null,durationDays:specialistBundleDurationDays};let durationSet=false;
 for(let index=0;index<args.length;index++){
  const flag=args[index];
  if(flag==='--apply'||flag==='--publish'){const key=flag.slice(2);if(result[key])throw new Error('参数不可重复：'+flag);result[key]=true;continue;}
  if(flag==='--duration-days'){
   const value=args[++index];if(durationSet||typeof value!=='string'||!/^[1-9]\d{0,2}$/.test(value)||Number(value)>366)throw new Error('--duration-days 应为 1～366 的整数');result.durationDays=Number(value);durationSet=true;continue;
  }
  const key={'--database':'database','--expected':'expected','--backup':'backup'}[flag];
  if(!key||result[key]!==null||!args[index+1]||args[index+1].startsWith('--'))throw new Error('参数格式无效：'+flag);result[key]=args[++index];
 }
 if(!result.database||result.database===':memory:'||!isAbsolute(result.database))throw new Error('请用 --database 指定已有 SQLite 数据库的绝对路径');
 if(result.expected!==null&&!/^[a-f0-9]{64}$/.test(result.expected))throw new Error('--expected 应为预览返回的完整哈希');
 if(result.apply&&!result.expected)throw new Error('写入前必须先预览，再用 --apply --expected <哈希> 确认');
 if(result.backup!==null&&(!result.apply||!isAbsolute(result.backup)))throw new Error('--backup 仅用于写入操作，且必须为新的绝对路径');
 return result;
}
export function configureSpecialistOffers(args){
 const options=parseSpecialistArguments(args);
 if(!existsSync(options.database)||!statSync(options.database).isFile())throw new Error('数据库文件不存在；不会创建新数据库');
 const db=new DatabaseSync(options.database,{readOnly:!options.apply});
 try{
  db.exec('PRAGMA busy_timeout=5000');const plan=planSpecialistOffers(db,{publish:options.publish,durationDays:options.durationDays});
  if(!options.apply)return {...plan,applied:false,backupRecommendation:'正式写入会先创建包含已提交 WAL 内容的完整 SQLite 备份。'};
  if(plan.expected!==options.expected)throw new Error('商品目录或目标方案已变化，请重新预览并确认');
  const backup=options.backup||`${options.database}.before-specialist-${Date.now()}.sqlite`;
  if(resolve(backup)===resolve(options.database)||existsSync(backup))throw new Error('备份路径必须是独立且不存在的新文件');
  const previousMask=process.umask(0o077);
  try{db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);}finally{process.umask(previousMask);}
  return {...applySpecialistOffers(db,{expected:options.expected,publish:options.publish,durationDays:options.durationDays}),backup};
 }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(configureSpecialistOffers(process.argv.slice(2)),null,2)+'\n');}
 catch(error){process.stderr.write((error?.message||'专项套餐配置失败')+'\n');process.exitCode=1;}
}
