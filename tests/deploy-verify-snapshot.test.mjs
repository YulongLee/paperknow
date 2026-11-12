import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {database} from '../backend/database.mjs';

const run=(...args)=>spawnSync('python3',['deploy/verify_snapshot.py',...args],{encoding:'utf8'});
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'pk-snapshot-test-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'snapshot.json'),JSON.stringify({createdAt:'20261113T000000Z',scope:'SQLite and environment; external OSS objects excluded'}));
 const init=spawnSync('python3',['-c',"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(\"CREATE TABLE users(id TEXT); CREATE TABLE jobs(id TEXT); CREATE TABLE orders(id TEXT); INSERT INTO users VALUES('private-user');\"); c.commit(); c.close()",join(dir,'paperknow.sqlite')]);
 assert.equal(init.status,0);return dir;
}
test('restores into a temporary isolated database and does not expose content or modify source',t=>{
 const dir=fixture(t),before=readFileSync(join(dir,'paperknow.sqlite'));
 const result=run(dir);assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(result.stdout);assert.equal(report.databaseRestore,'passed');assert.match(report.ossObjects,/not included/);
 assert.doesNotMatch(result.stdout+result.stderr,/private-user/);assert.deepEqual(readFileSync(join(dir,'paperknow.sqlite')),before);
});
test('rejects missing metadata, damaged database, symlinks, and live WAL sidecars',t=>{
 const dir=fixture(t),db=join(dir,'paperknow.sqlite');
 writeFileSync(db+'-wal','live');assert.notEqual(run(dir).status,0);rmSync(db+'-wal');
 writeFileSync(db,'not sqlite');assert.notEqual(run(dir).status,0);
 rmSync(db);symlinkSync('/dev/null',db);assert.notEqual(run(dir).status,0);
 rmSync(join(dir,'snapshot.json'));assert.notEqual(run(dir).status,0);
});
test('verifies a snapshot built with the application schema',t=>{
 const dir=mkdtempSync(join(tmpdir(),'pk-real-schema-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const db=database(join(dir,'paperknow.sqlite'));
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('synthetic-user','test@example.test','Test',null,'user','2026-11-13T00:00:00Z');
 db.close();
 writeFileSync(join(dir,'snapshot.json'),JSON.stringify({createdAt:'20261113T000000Z',scope:'SQLite and environment; external OSS objects excluded'}));
 const result=run(dir);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).databaseRestore,'passed');
 assert.doesNotMatch(result.stdout+result.stderr,/synthetic-user|test@example.test/);
});
test('foreign key corruption is not reported as a valid restored database',t=>{
 const dir=fixture(t);
 const mutate=spawnSync('python3',['-c',"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript('CREATE TABLE bad_parent(id INTEGER PRIMARY KEY); CREATE TABLE bad_child(id INTEGER REFERENCES bad_parent(id)); INSERT INTO bad_child VALUES(42);'); c.commit(); c.close()",join(dir,'paperknow.sqlite')]);
 assert.equal(mutate.status,0);const result=run(dir);assert.notEqual(result.status,0);assert.doesNotMatch(result.stdout+result.stderr,/bad_child|42/);
});
test('production snapshot helper includes committed records still in a live WAL',t=>{
 const dir=mkdtempSync(join(tmpdir(),'pk-wal-check-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const script=`import runpy,sqlite3,sys
from pathlib import Path
folder=Path(sys.argv[1]); source=folder/'live.sqlite'; snapshot=folder/'paperknow.sqlite'
c=sqlite3.connect(source); c.execute('PRAGMA journal_mode=WAL'); c.execute('PRAGMA wal_autocheckpoint=0')
c.executescript('CREATE TABLE users(id TEXT); CREATE TABLE jobs(id TEXT); CREATE TABLE orders(id TEXT);'); c.commit()
c.execute("INSERT INTO users VALUES('wal-committed')"); c.commit()
assert Path(str(source)+'-wal').exists()
runpy.run_path('deploy/backup.py')['snapshot_database'](source,snapshot)
assert sqlite3.connect(snapshot).execute('SELECT count(*) FROM users').fetchone()[0]==1
c.close()`;
 const result=spawnSync('python3',['-c',script,dir],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 writeFileSync(join(dir,'snapshot.json'),JSON.stringify({createdAt:'20261113T000000Z',scope:'SQLite and environment; external OSS objects excluded'}));
 const verified=run(dir);assert.equal(verified.status,0,verified.stderr);
});
