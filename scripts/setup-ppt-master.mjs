import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,stat,realpath,rm,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir,devNull} from 'node:os';
import {PPT_MASTER_COMMIT,runPptMasterCompiler,validatePptMasterPackage} from '../backend/ppt-master-runtime.mjs';

const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const officialRoot=path.join(repositoryRoot,'backend/vendor/ppt-master');
const requirements=path.join(repositoryRoot,'backend/vendor/ppt-master-requirements.lock');

function safeSetupOutput(output){
  return output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'')
    .replace(/\b(https?:\/\/)[^\s/@]+:[^\s/@]*@/gi,'$1[redacted]@')
    .replace(/([?&](?:token|api[_-]?key|password|secret|signature|credential|x-(?:amz|oss)-[^=\s&]+)=)[^&\s]+/gi,'$1[redacted]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi,'$1[redacted]').slice(-3000).trim();
}

export function executePptMasterSetupCommand(command,args,{cwd,timeoutMs=180000,spawnImpl=spawn}={}){
  return new Promise((resolve,reject)=>{
    const child=spawnImpl(command,args,{cwd,shell:false,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',PIP_DISABLE_PIP_VERSION_CHECK:'1',PIP_CONFIG_FILE:devNull}});
    let output='',count=0,finished=false;
    const diagnostic=message=>new Error(message+(safeSetupOutput(output)?': '+safeSetupOutput(output):''));
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(diagnostic('PPT Master setup command timed out'));},timeoutMs);
    const finish=(error)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(output.trim());};
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{count+=chunk.length;if(count>512*1024){child.kill('SIGKILL');finish(new Error('PPT Master setup output limit exceeded'));}else output+=chunk.toString();});
    child.once('error',()=>finish(new Error('Python setup command is unavailable')));
    child.once('close',code=>finish(code===0?null:diagnostic('PPT Master setup failed')));
  });
}
const execute=executePptMasterSetupCommand;

export async function pptMasterInstallArgs({wheelDir}={}){
  const args=['-I','-m','pip','--isolated','install','--only-binary=:all:','--require-hashes'];
  if(wheelDir!==undefined){
    if(typeof wheelDir!=='string'||!path.isAbsolute(wheelDir)||wheelDir.includes('\0'))throw new Error('--wheel-dir must be an absolute path to an existing wheel directory');
    let directory;
    try{directory=await realpath(wheelDir);if(!(await stat(directory)).isDirectory())throw new Error();}
    catch{throw new Error('--wheel-dir must be an absolute path to an existing wheel directory');}
    args.push('--no-index','--find-links',directory);
  }else args.push('--index-url','https://pypi.org/simple');
  return [...args,'-r',requirements];
}

export async function verifyPptMasterSources(){
  const lock=JSON.parse(await readFile(path.join(officialRoot,'source-lock.json'),'utf8'));
  if(lock.commit!==PPT_MASTER_COMMIT||lock.repository!=='https://github.com/hugohe3/ppt-master'||!Array.isArray(lock.files)||lock.files.length>500)throw new Error('Unexpected PPT Master source lock');
  let sourceBytes=0;
  for(const item of lock.files){
    if(!/^[A-Za-z0-9_./-]+$/.test(item.path)||item.path.split('/').some(p=>p==='.'||p==='..')||path.isAbsolute(item.path))throw new Error('Invalid source lock path');
    const target=path.join(officialRoot,item.path);
    if(await realpath(target)!==target||!(await stat(target)).isFile())throw new Error('PPT Master source must be a regular file');
    const data=await readFile(target);sourceBytes+=data.length;
    if(data.length!==item.bytes||createHash('sha256').update(data).digest('hex')!==item.sha256)throw new Error('PPT Master official source checksum mismatch: '+item.path);
  }
  if(sourceBytes>16*1024*1024)throw new Error('PPT Master source bundle unexpectedly large');
  return{files:lock.files.length,bytes:sourceBytes};
}

/** Installation uses fixed PyPI or an explicit offline wheelhouse. Export is offline. */
export async function setupPptMaster({runtimeRoot=path.join(repositoryRoot,'.data/ppt-master'),python='python3',wheelDir}={}){
  if(process.platform==='win32')throw new Error('PPT Master server runtime requires Linux or macOS resource limits');
  const installArgs=await pptMasterInstallArgs({wheelDir});
  runtimeRoot=path.resolve(runtimeRoot);
  const source=await verifyPptMasterSources();
  const hostPython=await execute(python,['-I','-c','import sys; assert sys.version_info >= (3, 10); print(sys.executable)']);
  if(!path.isAbsolute(hostPython))throw new Error('Python executable could not be resolved');
  await mkdir(runtimeRoot,{recursive:true,mode:0o700});
  await rm(path.join(runtimeRoot,'ready.json'),{force:true});
  const venv=path.join(runtimeRoot,'venv'),pythonPath=path.join(venv,'bin/python');
  await execute(hostPython,['-I','-m','venv',venv]);
  await execute(pythonPath,installArgs);
  const versions=JSON.parse(await execute(pythonPath,['-I','-c',"import importlib.metadata as m,json; print(json.dumps({p:m.version(p) for p in ['python-pptx','Pillow','lxml','XlsxWriter','typing_extensions']}))"]));
  let workspace;
  try{
    workspace=await mkdtemp(path.join(tmpdir(),'paperknow-ppt-master-probe-'));
    await mkdir(path.join(workspace,'slides'),{mode:0o700});
    await writeFile(path.join(workspace,'slides/001.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect x="0" y="0" width="1280" height="720" fill="#ffffff"/><text x="80" y="160" font-family="Arial" font-size="48" fill="#123456">PaperKnow native export</text></svg>');
    await writeFile(path.join(workspace,'manifest.json'),JSON.stringify({slides:[{file:'001.svg',title:'Runtime probe',notes:'Native editable export verified.'}],maxOutputBytes:20*1024*1024}));
    await runPptMasterCompiler({pythonPath,workspace,timeoutMs:30000});
    await validatePptMasterPackage(await readFile(path.join(workspace,'presentation.pptx')),{slideCount:1});
    await writeFile(path.join(runtimeRoot,'ready.json'),JSON.stringify({commit:PPT_MASTER_COMMIT,pythonPath,versions,source},null,2)+'\n',{mode:0o600});
    return{runtimeRoot,pythonPath,commit:PPT_MASTER_COMMIT,versions,source};
  }finally{if(workspace)await rm(workspace,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--runtime-root'&&args[i+1])options.runtimeRoot=args[++i];
    else if(args[i]==='--python'&&args[i+1])options.python=args[++i];
    else if(args[i]==='--wheel-dir'&&args[i+1])options.wheelDir=args[++i];
    else throw new Error('Usage: node scripts/setup-ppt-master.mjs [--runtime-root /absolute/private/path] [--python /path/to/python3] [--wheel-dir /absolute/wheel/directory]');
  }
  try{console.log(JSON.stringify(await setupPptMaster(options),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
