import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('dependency archive validator accepts internal bin links and rejects paths, links and metadata outside node_modules',t=>{
 const root=mkdtempSync(join(tmpdir(),'pk-deps-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const code=String.raw`import io,sys,tarfile,runpy
from pathlib import Path
check=runpy.run_path('deploy/verify-dependencies.py')['validate_archive']
root=Path(sys.argv[1])
def archive(name,extra):
 p=root/(name+'.tar.gz')
 with tarfile.open(p,'w:gz') as t:
  e=tarfile.TarInfo('node_modules'); e.type=tarfile.DIRTYPE; t.addfile(e)
  e=tarfile.TarInfo('node_modules/.package-lock.json'); e.size=2; t.addfile(e,io.BytesIO(b'{}'))
  for path,kind,target in extra:
   e=tarfile.TarInfo(path)
   if kind=='symlink': e.type=tarfile.SYMTYPE; e.linkname=target; t.addfile(e)
   elif kind=='hardlink': e.type=tarfile.LNKTYPE; e.linkname=target; t.addfile(e)
   else: t.addfile(e)
 return p
check(archive('valid',[('node_modules/.bin/tool','symlink','../pkg/bin.js')]))
for i,extra in enumerate([
 [('../.env','file','')],[('/etc/secret','file','')],[('node_modules/../server.mjs','file','')],
 [('node_modules/a','symlink','../../outside')],[('node_modules/a','symlink','/etc/secret')],
 [('node_modules/a','hardlink','node_modules/.package-lock.json')],
 [('node_modules/.package-lock.json','file','')],[('node_modules\\bad','file','')]
]):
 try: check(archive(str(i),extra))
 except ValueError: continue
 raise AssertionError('unsafe archive accepted')
print('archive boundaries verified')`;
 const result=spawnSync('python3',['-I','-c',code,root],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/boundaries verified/);
});
