import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync,symlinkSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database} from '../backend/database.mjs';
import {publishMetadata,verifyMetadataRestore} from '../deploy/cloud-metadata-backup.mjs';

function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'pk-metadata-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'db.sqlite'),db=database(path);
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('synthetic','private@example.test','Private record',null,'user','2026-11-16T00:00:00Z');db.close();chmodSync(path,0o600);
 const objects=new Map(),destination={async putNew(k,b){assert.equal(objects.has(k),false);objects.set(k,Buffer.from(b));},async get(k,max){if(!objects.has(k))throw Error('missing');const b=objects.get(k);assert.ok(b.length<=max);return b;}};
 return {root,path,destination,objects,release:'a'.repeat(40)};
}
test('private database recovery point verifies cloud bytes, integrity, foreign keys and application counts without changing source',async t=>{
 const f=fixture(t),before=readFileSync(f.path),m=await publishMetadata(f),result=await verifyMetadataRestore({...f,id:m.id});
 assert.equal(result.structure,'passed');assert.equal(result.recordCounts,'passed');assert.equal(m.counts.users,1);assert.equal(f.objects.size,2);
 assert.doesNotMatch(JSON.stringify(result),/private@example|Private record/);assert.deepEqual(readFileSync(f.path),before);assert.deepEqual(readdirSync(f.root),['db.sqlite']);
});
test('incomplete cloud upload has no completion manifest and cannot be restored',async t=>{
 const f=fixture(t);f.destination.get=async()=>Buffer.from('bad');await assert.rejects(publishMetadata(f));assert.equal(f.objects.size,1);assert.ok([...f.objects.keys()].every(k=>k.endsWith('/database')));
});
test('modified bytes and a tampered manifest cannot produce a successful restore receipt',async t=>{
 const f=fixture(t),m=await publishMetadata(f),dbKey=[...f.objects.keys()].find(k=>k.endsWith('/database')),manifestKey=[...f.objects.keys()].find(k=>k.endsWith('/manifest'));
 const original=f.objects.get(dbKey);f.objects.set(dbKey,Buffer.from('damaged'));await assert.rejects(verifyMetadataRestore({...f,id:m.id}));f.objects.set(dbKey,original);
 f.objects.set(manifestKey,Buffer.from(JSON.stringify({...m,counts:{...m.counts,users:99}})));await assert.rejects(verifyMetadataRestore({...f,id:m.id}));assert.deepEqual(readdirSync(f.root),['db.sqlite']);
});
test('source symlinks, publicly readable snapshots, invalid release and invalid restore identifiers are rejected before upload',async t=>{
 const f=fixture(t);chmodSync(f.path,0o644);await assert.rejects(publishMetadata(f));chmodSync(f.path,0o600);
 await assert.rejects(publishMetadata({...f,release:'main'}));const link=join(f.root,'alias.sqlite');symlinkSync(f.path,link);await assert.rejects(publishMetadata({...f,path:link}));
 await assert.rejects(verifyMetadataRestore({...f,id:'../../paperknow.sqlite'}));assert.equal(f.objects.size,0);
});
