import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountWebSimilarity} from '../dist/workspace/web-similarity.mjs';
import {mountAigcDetection} from '../dist/workspace/aigc-detection.mjs';
import {mountCombinedDetection} from '../dist/workspace/combined-detection.mjs';
const cases=[['重复率',mountWebSimilarity,'web'],['AI 率',mountAigcDetection,'ai'],['联合检测',mountCombinedDetection,'combined']];
for(const [label,mount,view] of cases){
 test(`${label}: initial anonymous 401 offers login without claiming an expired session`,async()=>{
  const dom=new JSDOM('<main id="host"></main>',{url:`https://paperknow.cn/workspace.html#category/detection?view=${view}`});const calls=[];
  const fetchImpl=async(url)=>{calls.push(url);return new Response(JSON.stringify(url==='/api/auth/me'?{error:'请先登录服务账户'}:{}),{status:url==='/api/auth/me'?401:200,headers:{'Content-Type':'application/json'}});};
  const panel=mount({container:dom.window.document.querySelector('#host'),fetchImpl});try{await panel.ready;const host=dom.window.document.querySelector('#host');assert.match(host.textContent,/请登录后使用/);assert.match(host.textContent,/登录原账户查看/);assert.doesNotMatch(host.textContent,/登录已失效/);const link=host.querySelector('a[href^="/auth.html"]');assert.ok(link);const dest=new URL(link.href);assert.equal(dest.searchParams.get('mode'),'login');assert.equal(dest.searchParams.get('next'),`/workspace.html#category/detection?view=${view}`);assert.equal(calls.some(x=>/\/billing\/quote|detections\/reuse/.test(x)),false);}finally{panel.dispose();dom.window.close();}
 });
}
