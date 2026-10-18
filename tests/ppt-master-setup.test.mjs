import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir,devNull} from 'node:os';
import path from 'node:path';
import {pptMasterInstallArgs,executePptMasterSetupCommand} from '../scripts/setup-ppt-master.mjs';

test('default installation uses only the fixed official PyPI index with hash-locked wheels',async()=>{
  const args=await pptMasterInstallArgs();
  assert.deepEqual(args.slice(0,7),['-I','-m','pip','--isolated','install','--only-binary=:all:','--require-hashes']);
  assert.deepEqual(args.slice(7,9),['--index-url','https://pypi.org/simple']);
  assert.equal(args.includes('--no-index'),false);assert.equal(args.includes('--extra-index-url'),false);
  assert.equal(args.at(-2),'-r');assert.match(args.at(-1),/ppt-master-requirements\.lock$/);
});

test('explicit offline wheelhouse disables indexes and preserves hashes, including paths with spaces',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'ppt-master wheelhouse-'));
  try{
    const args=await pptMasterInstallArgs({wheelDir:directory});
    assert.ok(args.includes('--require-hashes'));assert.ok(args.includes('--only-binary=:all:'));
    assert.deepEqual(args.slice(7,10),['--no-index','--find-links',await realpath(directory)]);
    assert.equal(args.includes('--index-url'),false);assert.equal(args.includes('--extra-index-url'),false);
    assert.equal(args.some(arg=>arg.startsWith('https://')),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('offline wheelhouse preflight rejects relative, missing and regular-file paths',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'ppt-master-wheelhouse-'));
  try{
    const file=path.join(directory,'not-a-directory.whl');await writeFile(file,'not a wheel directory');
    for(const wheelDir of ['relative/wheels','',path.join(directory,'missing'),file,null])await assert.rejects(()=>pptMasterInstallArgs({wheelDir}),/absolute path to an existing wheel directory/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('setup timeout reports bounded progress while removing terminal escapes and credentials',async()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();let killed,spawnOptions;
  child.kill=signal=>{killed=signal;setImmediate(()=>child.emit('close',null));};
  const pending=executePptMasterSetupCommand('/fixed/python',['-I','-m','pip'],{timeoutMs:10,spawnImpl:(_command,_args,options)=>{spawnOptions=options;return child;}});
  child.stderr.write('old output '.repeat(1000)+'\x1b[31mDownloading stalled\x1b[0m https://operator:test-password@files.example.com/wheel?token=example-token Authorization: Bearer sample-token');
  await assert.rejects(pending,error=>error.message.includes('timed out')&&error.message.includes('Downloading stalled')&&error.message.includes('[redacted]')&&!error.message.includes('test-password')&&!error.message.includes('example-token')&&!error.message.includes('sample-token')&&!error.message.includes('\x1b')&&error.message.length<3100);
  assert.equal(killed,'SIGKILL');
  assert.equal(spawnOptions.env.PIP_CONFIG_FILE,devNull);assert.equal(spawnOptions.shell,false);
});
