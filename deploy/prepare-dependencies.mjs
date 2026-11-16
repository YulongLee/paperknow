// Run only in a disposable Linux build environment with the target Node/npm.
// Installs from the exact lockfile, packages dependencies only; never application config.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve(process.argv[2]||'');
if(process.argv.length!==3||process.platform!=='linux'||process.arch!=='x64'||!output.endsWith('.tar.gz'))throw Error('Use a fresh Linux x64 build and an explicit output archive.');
try{await lstat('node_modules');throw Error('Dependencies already exist; use a clean build directory.');}catch(e){if(e.code!=='ENOENT')throw e;}
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{stdio:'inherit',env:{...process.env,NODE_ENV:'development'}});if(r.status!==0)throw Error('Dependency preparation failed.');};
const hash=async p=>{const h=createHash('sha256');for await(const c of createReadStream(p))h.update(c);return h.digest('hex');};
const packageSha256=await hash('package.json'),lockSha256=await hash('package-lock.json');
const npm=spawnSync('npm',['--version'],{encoding:'utf8'});if(npm.status!==0)throw Error('npm unavailable');
run('npm',['ci','--no-audit','--no-fund']);
if(await hash('package.json')!==packageSha256||await hash('package-lock.json')!==lockSha256)throw Error('Package inputs changed during installation.');
run('tar',['--hard-dereference','-czf',output,'--','node_modules']);
const manifest={version:1,node:process.version,npm:npm.stdout.trim(),abi:process.versions.modules,platform:process.platform,arch:process.arch,runtimeSha256:await hash(process.execPath),packageSha256,lockSha256,archiveSha256:await hash(output)};
await writeFile(output+'.json',JSON.stringify(manifest)+'\n',{mode:0o644,flag:'wx'});console.log(JSON.stringify(manifest));
