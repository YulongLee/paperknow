import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiteratureImportQueue} from '../dist/workspace/literature-import-queue.mjs';
const file=name=>({name,size:100});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('a mixed batch is serial, retains errors, continues after failure, and accepts additions while active',async()=>{
 let release,active=0,max=0;const calls=[],held=new Promise(r=>release=r),q=createLiteratureImportQueue({getOwner:async()=> 'one',processFile:async f=>{active++;max=Math.max(max,active);calls.push(f.name);try{if(f.name==='First.pdf')await held;if(f.name==='Bad.docx')throw Error('damaged');return{id:f.name};}finally{active--;}}});
 await q.enqueue([file('First.pdf'),file('Bad.docx'),file('Third.txt'),file('Wrong.exe')]);await tick();await q.enqueue([file('Fourth.txt')]);assert.deepEqual(calls,['First.pdf']);assert.equal(q.snapshot().rows.filter(r=>r.state==='waiting').length,3);release();await q.whenIdle();assert.equal(max,1);assert.deepEqual(calls,['First.pdf','Bad.docx','Third.txt','Fourth.txt']);assert.deepEqual(q.snapshot().rows.map(r=>r.state),['completed','failed','completed','invalid','completed']);q.dispose();
});
test('waiting files can be removed without submission and failed files are retried only explicitly',async()=>{
 let release,n=0;const held=new Promise(r=>release=r),calls=[],q=createLiteratureImportQueue({getOwner:async()=> 'owner',processFile:async f=>{calls.push(f.name);if(f.name==='first.txt')await held;if(f.name==='retry.txt'&&n++===0)throw Error('temporary');return{id:f.name};}});
 await q.enqueue([file('first.txt'),file('remove.txt'),file('retry.txt')]);q.remove(q.snapshot().rows[1].id);release();await q.whenIdle();assert.deepEqual(calls,['first.txt','retry.txt']);await q.retry(q.snapshot().rows[1].id);await q.whenIdle();assert.deepEqual(calls,['first.txt','retry.txt','retry.txt']);assert.equal(q.snapshot().rows[1].state,'completed');q.dispose();
});
test('batch approval rejection creates no rows or processing, and payload admission is bounded',async()=>{
 let processes=0;const q=createLiteratureImportQueue({getOwner:async()=> 'owner',approveBatch:async()=>{throw Error('rejected');},processFile:async()=>{processes++;}});await assert.rejects(q.enqueue([file('one.pdf')]),/rejected/);assert.equal(q.snapshot().rows.length,0);assert.equal(processes,0);await assert.rejects(q.enqueue(Array.from({length:21},()=>file('x.txt'))),/20/);await assert.rejects(q.enqueue(Array.from({length:6},(_,n)=>({name:n+'.pdf',size:20*1024*1024}))),/100MB/);q.dispose();
});
test('an account change pauses before the next file and cannot silently upload into the new account',async()=>{
 let owner='first',release;const held=new Promise(r=>release=r),calls=[],q=createLiteratureImportQueue({getOwner:async()=>owner,processFile:async f=>{calls.push(f.name);await held;return{id:f.name};}});await q.enqueue([file('one.txt'),file('two.txt')]);await tick();owner='second';release();await tick();assert.deepEqual(calls,['one.txt']);assert.equal(q.snapshot().paused,true);assert.equal(q.snapshot().rows[1].state,'waiting');await assert.rejects(q.resume(),/账户/);owner='first';await q.resume();await q.whenIdle();assert.deepEqual(calls,['one.txt','two.txt']);q.clear();q.dispose();
});
test('repeat selection of the same File joins the same submission; snapshots do not expose File objects',async()=>{
 let count=0;const f=file('same.txt'),q=createLiteratureImportQueue({getOwner:async()=> 'owner',processFile:async()=>({id:'paper-'+(++count)})});await Promise.all([q.enqueue([f]),q.enqueue([f])]);await q.whenIdle();assert.equal(count,1);assert.equal(q.snapshot().rows.length,1);assert.equal(q.snapshot().rows[0].file,undefined);q.dispose();
});
