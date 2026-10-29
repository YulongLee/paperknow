import test from 'node:test';
import assert from 'node:assert/strict';
import {formatFixture,until,exampleDocx,parseDocx,applyDocx} from './fixtures/format-ui.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('format entry stays lightweight; leaving during document loading never processes or repaints the next page',async t=>{
 const loading=deferred();let loads=0,parses=0;const tools={parseDocx:async bytes=>{parses++;return parseDocx(bytes);},applyDocx};
 const f=await formatFixture(t,{loadDocument:()=>{loads++;return loading.promise;}});assert.equal(loads,0);const pending=f.upload('paper',await exampleDocx());await until(()=>loads===1);f.w.formatTest.disposeFormat();f.root.innerHTML='<h1>另一账户的页面</h1>';loading.resolve(tools);await pending;await new Promise(r=>setTimeout(r,10));assert.equal(parses,0);assert.equal(f.root.textContent,'另一账户的页面');assert.equal(f.calls.length,0);
});

test('concurrent uploads share one document loader and only the current page processes the file',async t=>{
 const loading=deferred();let loads=0,parses=0;const tools={parseDocx:async bytes=>{parses++;return parseDocx(bytes);},applyDocx};const f=await formatFixture(t,{loadDocument:()=>{loads++;return loading.promise;}}),bytes=await exampleDocx();const first=f.upload('paper',bytes);await until(()=>loads===1);await f.w.formatTest.mountFormat(f.ctx);const second=f.upload('paper',bytes);loading.resolve(tools);await Promise.all([first,second]);assert.equal(loads,1);assert.equal(parses,1);assert.ok(f.getRows()[0].formatting.original);
});

test('failed lazy loading gives a specific reason and a later upload retries without charging',async t=>{
 let loads=0;const f=await formatFixture(t,{loadDocument:()=>++loads===1?Promise.reject(Error('组件加载失败，请重试。')):Promise.resolve({parseDocx,applyDocx})}),bytes=await exampleDocx();await f.upload('paper',bytes);assert.match(f.$('[data-format-error]').textContent,/组件加载失败/);await f.upload('paper',bytes);assert.equal(loads,2);assert.equal(f.$('[data-format-error]').hidden,true);assert.ok(f.getRows()[0].formatting.original);assert.equal(f.calls.length,0);
});
