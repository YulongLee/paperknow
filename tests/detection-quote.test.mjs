import test from 'node:test';
import assert from 'node:assert/strict';
import {createDetectionQuote,detectionQuoteText,detectionPriceText} from '../dist/workspace/detection-billing.mjs';

const expires=()=>new Date(Date.now()+60000).toISOString();
test('detection quote displays the actual funding source and expiry requires review',async()=>{
 const el={textContent:''};let count=0,source='bundle';const billing=createDetectionQuote({request:async()=>({token:'token-'+(++count),source,creditCost:source==='credits'?500:0,expiresAt:count===1?expires():expires()}),checkOwner:async()=>{},current:()=>true,element:()=>el,onChange:()=>{},serviceKey:'detection-aigc'});
 await billing.refresh();assert.equal(el.textContent,'本次使用专项套餐 1 次');assert.equal(await billing.token(),'token-1');source='credits';await billing.refresh();assert.equal(el.textContent,'本次消耗 500 积分');assert.equal(await billing.token(),'token-2');assert.equal(detectionQuoteText({source:'membership',entitlementUnits:1}),'本次使用会员权益 1 次');assert.match(detectionPriceText({pointsCharged:false}),/无需消耗积分或套餐次数/);
});
test('no quote or insufficient balance never enables a charge; stale async response cannot overwrite latest quote',async()=>{
 let release,req=0;const el={textContent:''};const billing=createDetectionQuote({request:()=>++req===1?new Promise(r=>release=r):Promise.resolve({token:'fresh',source:'credits',creditCost:5,expiresAt:expires()}),checkOwner:async()=>{},current:()=>true,element:()=>el,onChange:()=>{},serviceKey:'detection-similarity'});
 const pending=billing.refresh();await billing.refresh();release({token:'old',source:'bundle',creditCost:0,expiresAt:expires()});await pending;assert.equal(await billing.token(),'fresh');assert.match(el.textContent,/5 积分/);
 const empty=createDetectionQuote({request:async()=>{throw Object.assign(Error('no credits'),{status:402});},checkOwner:async()=>{},current:()=>true,element:()=>el,onChange:()=>{},serviceKey:'detection-aigc'});await empty.refresh();assert.equal(empty.ready,false);assert.match(el.textContent,/积分或对应权益不足/);await assert.rejects(empty.token(),/费用已更新/);
});

test('an expired visible quote is refreshed but never automatically submitted',async()=>{
 const originalNow=Date.now;let time=originalNow(),calls=0;Date.now=()=>time;
 try{const el={textContent:''},billing=createDetectionQuote({request:async()=>({token:`token-${++calls}`,source:calls===1?'bundle':'credits',creditCost:calls===1?0:500,expiresAt:new Date(time+1000).toISOString()}),checkOwner:async()=>{},current:()=>true,element:()=>el,onChange:()=>{},serviceKey:'detection-aigc'});await billing.refresh();assert.match(el.textContent,/套餐/);time+=1500;await assert.rejects(billing.token(),/查看后再次点击/);assert.match(el.textContent,/消耗 500 积分/);assert.equal(await billing.token(),'token-2');}finally{Date.now=originalNow;}
});
