import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('retention accepts code-only archives and rejects secrets, data and foreign roots',()=>{
 const result=spawnSync('python3',['-c',String.raw`
import importlib.util,tarfile,io,tempfile,pathlib
spec=importlib.util.spec_from_file_location('retention','deploy/retention.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
sha='a'*40
with tempfile.TemporaryDirectory() as folder:
 p=pathlib.Path(folder)/'test.tar.gz'
 def check(names):
  with tarfile.open(p,'w:gz') as t:
   for name in [sha+'/server.mjs',sha+'/package-lock.json',sha+'/node_modules/a/index.js']+names:
    v=tarfile.TarInfo(name);v.size=1;t.addfile(v,io.BytesIO(b'x'))
  return m.code_only_archive(p,sha)
 assert check([])
 for extra in [[sha+'/.env'],[sha+'/.data/paperknow.sqlite'],[sha+'/backend/paperknow.env'],['other/file'],[sha+'/../escape']]:
  assert not check(extra),extra
 print('ok')
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ok/);
});

test('retention keeps current plus two rollback builds and never selects unknown/state folders',()=>{
 const result=spawnSync('python3',['-c',String.raw`
import importlib.util,tempfile,pathlib,os
spec=importlib.util.spec_from_file_location('retention','deploy/retention.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as folder:
 b=pathlib.Path(folder);(b/'releases').mkdir();versions=[]
 for i in range(6):
  p=b/'releases'/(hex(i+1)[2:]*40)
  p.mkdir();(p/'server.mjs').touch();(p/'package-lock.json').touch();os.utime(p,(i+100,i+100));versions.append(p)
 (versions[0]/'.data').mkdir();(b/'releases'/'unknown').mkdir()
 class S:
  st_uid=0
 real=pathlib.Path.stat
 # CI need not run as root; plan fixture ownership is explicitly simulated.
 def mock(self,*a,**kw):
  v=real(self,*a,**kw)
  return type('Stat',(),{'st_uid':0,'st_mtime':v.st_mtime,'st_mode':v.st_mode})()
 pathlib.Path.stat=mock
 keep,remove=m.release_plan(b,{versions[2]})
 assert keep=={versions[2],versions[5],versions[4]}
 assert set(remove)=={versions[1],versions[3]}
 print('ok')
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ok/);
});
