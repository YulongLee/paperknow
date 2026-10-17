import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import 'fake-indexeddb/auto';
import {backupLimit,validateBackup} from '../dist/workspace/backup-model.mjs';
import {currentBackup,restoreBackup,fingerprint} from '../dist/workspace/backup-service.mjs';
import {repository} from '../dist/precheck/store.mjs';
import {analyzeDocument,parseDocument} from '../dist/precheck/engine.mjs';

const raw=data=>({format:'paperknow-workspace-backup',version:1,...data});
const makeReport=(text='科研工作需要以真实数据和有效引用为基础进行分析与讨论',sourceText=text)=>analyzeDocument(parseDocument(text),[{id:'backup-source',title:'备份验收材料',authors:[],text:sourceText,provider:'user',kind:'user'}]);
class MemoryStorage{map=new Map();getItem(k){return this.map.get(k)??null;}setItem(k,v){this.map.set(k,v);}removeItem(k){this.map.delete(k);}}

test('large exact-match backup validates and restores all original evidence within existing limits',async()=>{
  const report=makeReport('甲'.repeat(16000),'甲'.repeat(20000));
  report.id='backup-long-matches-report';
  const matches=report.sections[0].paragraphs[0].matches;
  assert.ok(matches.length>15000&&matches.length<=20000);
  const encoded=JSON.stringify(raw({reports:[report]}));
  assert.ok(Buffer.byteLength(encoded)<backupLimit);
  const canonical=JSON.parse(encoded).reports[0];
  const start=performance.now();
  const incoming=validateBackup(JSON.parse(encoded));
  const elapsed=performance.now()-start;
  assert.ok(elapsed<5000,`validation took ${Math.round(elapsed)} ms`);
  assert.deepEqual(incoming.reports[0],canonical);
  const storage=new MemoryStorage(),before=await currentBackup(storage);
  try{
    const summary=await restoreBackup(incoming,fingerprint(before),{storage});
    assert.equal(summary.find(x=>x.key==='reports').added,1);
    const saved=await repository.get('reports',report.id);
    assert.deepEqual(saved,canonical);
    const after=await currentBackup(storage);
    const repeated=await restoreBackup(incoming,fingerprint(after),{storage});
    assert.equal(repeated.find(x=>x.key==='reports').added,0);
  }finally{await repository.remove('reports',report.id);}
});

test('cached source bounds preserve Unicode codepoint lengths, strict IDs and first source semantics',()=>{
  const report=makeReport(),paragraph=report.sections[0].paragraphs[0];
  paragraph.matches=paragraph.matches.slice(0,1);
  const match=paragraph.matches[0];
  report.sources[0].text='😀甲';
  match.sourceRange=[0,2];
  assert.doesNotThrow(()=>validateBackup(raw({reports:[report]})));
  match.sourceRange=[0,3];
  assert.throws(()=>validateBackup(raw({reports:[report]})),/对照区间/);
  report.sources.push({...report.sources[0],text:'甲'.repeat(20)});
  assert.throws(()=>validateBackup(raw({reports:[report]})),/对照区间/);
  match.sourceRange=[0,2];
  report.sources[0].id=1;report.sources[1].id='1';
  match.sourceId='1';match.sourceRange=[0,20];
  assert.doesNotThrow(()=>validateBackup(raw({reports:[report]})));
  match.sourceId=1;
  assert.throws(()=>validateBackup(raw({reports:[report]})),/对照区间/);
  match.sourceId='missing';
  assert.throws(()=>validateBackup(raw({reports:[report]})),/对照区间/);
});

test('long report backups keep the existing list and payload bounds',()=>{
  assert.equal(backupLimit,50*1024*1024);
  const report=makeReport(),paragraph=report.sections[0].paragraphs[0],match=paragraph.matches[0];
  paragraph.matches=Array.from({length:20001},()=>({...match}));
  assert.throws(()=>validateBackup(raw({reports:[report]})),/列表过长/);
});
