import {DatabaseSync} from 'node:sqlite';
import {chmod,readFile,stat,writeFile} from 'node:fs/promises';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {environmentConfig,loadLocalEnvironment} from '../backend/config.mjs';
import {createDesktopReleaseStorage} from '../backend/desktop-release-storage.mjs';
import {desktopCatalogRevision,publishDesktopManifest,validateDesktopManifest} from '../backend/desktop-release-service.mjs';

export function parseDesktopReleaseArguments(args){
 const command=args[0],options={command};
 if(!['upload','inspect','publish'].includes(command))throw new Error('用法：publish-desktop-release.mjs upload|inspect|publish [参数]');
 const fields={'--spec':'spec','--manifest':'manifest','--database':'database','--expected':'expected','--env-file':'envFile','--backup':'backup'};
 for(let i=1;i<args.length;i++){
  const key=fields[args[i]],value=args[i+1];
  if(!key||options[key]!==undefined||!value||value.startsWith('--'))throw new Error('发布参数无效：'+args[i]);
  options[key]=value;i++;
 }
 for(const key of ['spec','manifest','database','envFile','backup'])if(options[key]!==undefined&&!isAbsolute(options[key]))throw new Error('发布文件必须使用绝对路径：'+key);
 if(options.backup&&command!=='publish')throw new Error('--backup 仅可用于正式发布');
 if(command==='upload'&&(!options.spec||!options.manifest||options.database||options.expected))throw new Error('上传需要 --spec 和新的 --manifest 路径');
 if(command==='inspect'&&(!options.database||options.spec||options.expected))throw new Error('预览需要 --database，可选 --manifest');
 if(command==='publish'&&(!options.database||!options.manifest||options.spec||!options.expected||!(/^(?:empty|[a-f0-9]{64})$/).test(options.expected)))throw new Error('发布需要 --database、--manifest 和预览获得的 --expected revision');
 return options;
}
async function readJSON(path){
 if(!(await stat(path)).isFile()||(await stat(path)).size>65536)throw new Error('发布清单必须是 64KB 以内的 JSON 文件');
 try{return JSON.parse(await readFile(path,'utf8'));}catch{throw new Error('发布清单不是有效 JSON');}
}
export async function desktopReleaseCommand(args,{config,storage}={}){
 const options=parseDesktopReleaseArguments(args);
 if(!config){if(options.envFile)process.loadEnvFile(options.envFile);else loadLocalEnvironment();config=environmentConfig();}
 storage??=createDesktopReleaseStorage(config);
 if(options.command==='upload'){
  if(!storage)throw new Error('客户端 OSS 尚未配置');
  const spec=await readJSON(options.spec);
  if(!spec||typeof spec.version!=='string'||!Array.isArray(spec.releases)||!spec.releases.length||spec.releases.length>3)throw new Error('请提供 1～3 个客户端安装包');
  // A manifest is created only after ALL uploads verify. Partial uploads remain
  // private, are not advertised, and cannot replace the live catalogue.
  const releases=[];for(const release of spec.releases)releases.push(await storage.upload({...release,version:spec.version}));
  const manifest=validateDesktopManifest({schemaVersion:1,version:spec.version,releases},storage);
  await writeFile(options.manifest,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {uploaded:true,published:false,version:manifest.version,count:manifest.releases.length,manifest:options.manifest};
 }
 const dbStat=await stat(options.database);if(!dbStat.isFile())throw new Error('请指定已有 SQLite 数据库；不会创建新数据库');
 const db=new DatabaseSync(options.database,{readOnly:options.command==='inspect'});
 try{
  db.exec('PRAGMA busy_timeout=5000');
  const revision=desktopCatalogRevision(db);
  if(options.command==='inspect'){
   let target;if(options.manifest)target=validateDesktopManifest(await readJSON(options.manifest),storage);
   return {revision,current:db.prepare('SELECT platform,arch,version,file_name fileName,bytes,sha256,published FROM desktop_releases WHERE published=1 ORDER BY platform,arch').all(),...(target?{target:{version:target.version,releases:target.releases.map(({platform,arch,fileName,bytes,sha256})=>({platform,arch,fileName,bytes,sha256}))}}:{})};
  }
  const target=validateDesktopManifest(await readJSON(options.manifest),storage);
  if(revision!==options.expected)throw new Error('客户端目录已变化，请重新预览 revision');
  for(const release of target.releases)await storage.verify(release);
  const backup=options.backup||`${options.database}.before-desktop-${Date.now()}.sqlite`;
  if(resolve(backup)===resolve(options.database)||resolve(backup)===resolve(options.manifest))throw new Error('备份必须使用独立的新文件');
  try{await stat(backup);throw new Error('备份文件已存在，请使用新的路径');}catch(error){if(error.code!=='ENOENT')throw error;}
  const previousMask=process.umask(0o077);
  try{db.prepare('VACUUM INTO ?').run(backup);await chmod(backup,0o600);}finally{process.umask(previousMask);}
  return {...await publishDesktopManifest(db,storage,target,{expectedRevision:options.expected}),backup};
 }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(await desktopReleaseCommand(process.argv.slice(2)),null,2)+'\n');}
 catch(error){process.stderr.write((error?.message||'客户端发布未完成')+'\n');process.exitCode=1;}
}
