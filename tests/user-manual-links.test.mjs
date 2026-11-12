import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {updateUserManualLinks,userManualUrl} from '../dist/workspace/interface.mjs';

test('manual links use configured HTTPS address and retain default when unavailable or unsafe',async()=>{
 const doc=new JSDOM(`<a data-user-manual href="${userManualUrl}"></a><a data-user-manual href="${userManualUrl}"></a>`).window.document;
 const original=globalThis.fetch;try{
  globalThis.fetch=async()=>({ok:true,json:async()=>({url:'https://docs.example.org/manual'})});
  await updateUserManualLinks(doc);assert.deepEqual([...doc.querySelectorAll('a')].map(a=>a.href),['https://docs.example.org/manual','https://docs.example.org/manual']);
  globalThis.fetch=async()=>({ok:true,json:async()=>({url:'javascript:alert(1)'})});await updateUserManualLinks(doc);assert.equal(doc.querySelector('a').href,'https://docs.example.org/manual');
  globalThis.fetch=async()=>{throw Error('offline')};await updateUserManualLinks(doc);assert.equal(doc.querySelector('a').href,'https://docs.example.org/manual');
 }finally{globalThis.fetch=original;doc.defaultView.close();}
});
