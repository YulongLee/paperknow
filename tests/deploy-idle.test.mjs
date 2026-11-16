import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('release activation guard reads all asynchronous task queues and fails closed for an unavailable database',t=>{
 const root=mkdtempSync(join(tmpdir(),'pk-idle-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const code=String.raw`import sqlite3,runpy,sys
from pathlib import Path
active=runpy.run_path('deploy/wait-idle.py')['active_tasks']; p=Path(sys.argv[1])/'db.sqlite'; c=sqlite3.connect(p)
for t in ['jobs','thesis_runs','aigc_detections']: c.execute('CREATE TABLE '+t+'(status TEXT)')
c.commit(); assert active(p)==0
for t,status in [('jobs','queued'),('thesis_runs','running'),('aigc_detections','preparing')]: c.execute('INSERT INTO '+t+' VALUES(?)',(status,))
c.commit(); assert active(p)==3
for t in ['jobs','thesis_runs','aigc_detections']: c.execute('UPDATE '+t+' SET status=\'completed\'')
c.commit(); assert active(p)==0; c.close()
try: active(Path(sys.argv[1])/'missing.sqlite')
except ValueError: pass
else: raise AssertionError('missing database appeared idle')
assert not (Path(sys.argv[1])/'missing.sqlite').exists()
`;const r=spawnSync('python3',['-I','-c',code,root],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
