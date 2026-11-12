import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountCombinedDetection} from '../dist/workspace/combined-detection.mjs';
const wait=()=>new Promise(r=>setImmediate(r));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,3));}throw Error('Combined UI did not settle');}
async function setup(t,{recent=null,quoteError=false}={}){
 const dom=new JSDOM('<main id="root"></main>',{url:'https://paperknow.cn/workspace.html#category/detection?view=combined'}),w=dom.window,root=w.document.querySelector('#root');
 let owner='alice',state='running',fail=false;const calls=[];
 const task=()=>({id:'joint-1',title:'Synthetic manuscript',status:state,createdAt:new Date().toISOString(),children:state==='completed'?[{id:'web-1',kind:'similarity',status:'completed'},{id:'ai-1',kind:'aigc',status:'completed'}]:[]});
 const fetchImpl=async(path,options={})=>{const body=options.body?JSON.parse(options.body):null;if(path==='/api/billing/quote'&&quoteError)return{ok:false,status:402,json:async()=>({error:'积分不足'})};if(path==='/api/billing/quote')return{ok:true,status:200,json:async()=>({token:'quote-test',source:'credits',creditCost:149,expiresAt:new Date(Date.now()+300000).toISOString()})};calls.push({path,body});let data;
 if(path==='/api/auth/me')data={user:{id:owner}};
 else if(path==='/api/capabilities')data={combinedDetection:{ready:true,pricingMode:'paid',pointsCharged:true,creditCost:149,pricingVersion:3}};
 else if(path==='/api/combined-detections'&&!body)data={items:recent?[recent]:[]};
 else if(path==='/api/combined-detections'&&body){if(fail)return{ok:false,status:402,json:async()=>({error:'可用积分不足'})};data=task();}
 else if(path==='/api/combined-detections/reuse')data={item:task()};
 else if(path==='/api/combined-detections/joint-1')data=task();
 else throw Error('Unexpected route '+path);
 return{ok:true,status:200,json:async()=>data};};
 const ui=mountCombinedDetection({container:root,fetchImpl,pollInterval:15,importDocument:async()=>({text:'Synthetic research manuscript with methods and verified references. '.repeat(5)})});
 t.after(()=>{ui.dispose();w.close();});await ui.ready;
 async function upload(name='manuscript.docx'){const input=root.querySelector('[data-joint-file]');Object.defineProperty(input,'files',{configurable:true,value:[new w.File(['synthetic DOCX fixture'],name)]});input.dispatchEvent(new w.Event('change'));await until(()=>!root.querySelector('[data-joint-start]').disabled);}
 return{root,w,calls,upload,setOwner(value){owner=value;},fail(){fail=true;},complete(){state='completed';}};
}
test('joint detection imports once, shows real tariff and stable progress, and opens both completed reports',async t=>{
 const f=await setup(t);assert.match(f.root.textContent,/149/);assert.match(f.root.textContent,/本次消耗 149 积分/);assert.equal(f.root.querySelector('input[type=checkbox]'),null);
 await f.upload();assert.equal(f.calls.filter(c=>c.body?.text).length,0);f.root.querySelector('[data-joint-start]').click();await until(()=>f.root.querySelector('[data-detection-progress]'));
 const progress=f.root.querySelector('[data-detection-progress]');await new Promise(r=>setTimeout(r,40));assert.equal(f.root.querySelector('[data-detection-progress]'),progress);assert.equal(f.calls.filter(c=>c.body?.text).length,1);
 f.complete();await until(()=>f.root.querySelectorAll('[data-joint-result] a').length===2);assert.equal(f.root.querySelector('[data-detection-progress]'),null);
 assert.deepEqual([...f.root.querySelectorAll('[data-joint-result] a')].map(a=>a.hash),['#category/detection?view=web&report=web-1','#category/detection?view=ai&report=ai-1']);
 await f.upload('next.docx');assert.equal(f.root.querySelector('[data-joint-start]').disabled,false);
});
test('insufficient credits preserve the imported manuscript and show the concrete server reason',async t=>{
 const f=await setup(t);await f.upload();f.fail();f.root.querySelector('[data-joint-start]').click();await until(()=>f.root.querySelector('[data-joint-status]').textContent.includes('积分不足'));assert.match(f.root.querySelector('[data-joint-name]').textContent,/manuscript/);assert.equal(f.root.querySelector('[data-joint-start]').disabled,false);
});
test('an account change clears the original filename and reports before any generation request',async t=>{
 const f=await setup(t);await f.upload('private.docx');f.setOwner('bob');f.root.querySelector('[data-joint-start]').click();await until(()=>f.root.textContent.includes('账户已变化'));assert.doesNotMatch(f.root.textContent,/private/);assert.equal(f.calls.filter(c=>c.body?.text).length,0);
});

test('restored joint partial results offer both reports and explain the fee was released',async t=>{
 const item={id:'joint-1',status:'completed',partial:true,createdAt:new Date().toISOString(),children:[{id:'web-1',kind:'similarity',status:'completed'},{id:'ai-1',kind:'aigc',status:'completed',partial:true}]};
 const f=await setup(t,{recent:item}),result=f.root.querySelector('[data-joint-result]');assert.match(result.textContent,/两份报告已生成/);assert.match(result.textContent,/未扣费/);assert.match(result.textContent,/AI 率报告（部分结果）/);assert.deepEqual([...result.querySelectorAll('a')].map(a=>a.hash),['#category/detection?view=web&report=web-1','#category/detection?view=ai&report=ai-1']);
 await f.upload();assert.equal(result.querySelectorAll('a').length,0);assert.equal(f.root.querySelector('[data-joint-start]').disabled,false);
});
test('a failed child shows its safe reason and keeps the available report accessible',async t=>{
 const item={id:'joint-1',status:'failed',error:'本次联合检测未扣费。',children:[{id:'web-1',kind:'similarity',status:'completed'},{id:'ai-1',kind:'aigc',status:'failed',error:'检测服务暂不可用。'}]};const f=await setup(t,{recent:item}),result=f.root.querySelector('[data-joint-result]');assert.match(result.textContent,/未扣费/);assert.match(result.textContent,/AI 率检测未完成：检测服务暂不可用/);assert.equal(result.querySelectorAll('a').length,1);assert.match(result.textContent,/重新上传论文/);
});

test('completed joint reports have distinct, accessible cards and independently addressable reports',async t=>{
 const item={id:'joint-1',status:'completed',children:[{id:'web-1',kind:'similarity',status:'completed'},{id:'ai-1',kind:'aigc',status:'completed'}]};
 const f=await setup(t,{recent:item}),result=f.root.querySelector('[data-joint-result]'),region=result.querySelector('section[aria-label="联合检测结果"]');
 assert.ok(region);const cards=[...region.querySelectorAll('article')];assert.equal(cards.length,2);assert.deepEqual(cards.map(card=>card.getAttribute('aria-label')),['重复率报告','AI 率报告']);
 assert.deepEqual(cards.map(card=>card.querySelector('a')?.hash),['#category/detection?view=web&report=web-1','#category/detection?view=ai&report=ai-1']);
 for(const card of cards){assert.ok(card.querySelector('h4'));assert.match(card.textContent,/已生成/);assert.ok(card.querySelector('a').textContent.trim());}
 assert.doesNotMatch(region.textContent,/未扣费|未完成|部分结果/);assert.equal(f.calls.filter(call=>call.body?.text).length,0);
});
test('partial report and failed report have separate accurate accessible state without duplicate fee notes',async t=>{
 const item={id:'joint-1',status:'completed',partial:true,error:'AI 检测部分正文暂无法判定，已展示两份报告，本次未扣费。',children:[{id:'web-1',kind:'similarity',status:'completed'},{id:'ai-1',kind:'aigc',status:'completed',partial:true}]};
 const f=await setup(t,{recent:item}),region=f.root.querySelector('[aria-label="联合检测结果"]'),cards=[...region.querySelectorAll('article')];
 assert.equal((region.textContent.match(/未扣费/g)||[]).length,1);assert.match(cards[1].textContent,/部分结果/);assert.doesNotMatch(cards[0].textContent,/部分结果/);assert.equal(cards[1].querySelector('a').hash,'#category/detection?view=ai&report=ai-1');
 await f.upload('new.docx');assert.equal(f.root.querySelector('[aria-label="联合检测结果"]'),null);
});
test('failure keeps working report usable while unavailable card has no clickable report and escapes the reason',async t=>{
 const item={id:'joint-1',status:'failed',error:'本次联合检测未扣费。',children:[{id:'web-1',kind:'similarity',status:'completed'},{id:'ai-1',kind:'aigc',status:'failed',error:'检测暂不可用 <img src=x>'}]};
 const f=await setup(t,{recent:item}),region=f.root.querySelector('[aria-label="联合检测结果"]'),cards=[...region.querySelectorAll('article')];
 assert.equal(cards.length,2);assert.ok(cards[0].querySelector('a'));assert.equal(cards[1].querySelector('a'),null);assert.match(cards[1].textContent,/未完成/);assert.match(cards[1].textContent,/<img src=x>/);assert.equal(cards[1].querySelector('img'),null);assert.match(region.textContent,/重新上传论文/);
});

test('joint detection opens an owned existing task despite insufficient credits without another submission',async t=>{
 const f=await setup(t,{quoteError:true});await f.upload();f.root.querySelector('[data-joint-start]').click();await until(()=>f.root.querySelector('[data-detection-progress]'));assert.match(f.root.querySelector('[data-joint-status]').textContent,/未扣费/);assert.equal(f.calls.filter(c=>c.path==='/api/combined-detections'&&c.body).length,0);assert.equal(f.calls.find(c=>c.path==='/api/combined-detections/reuse').body.expectedUserId,'alice');
});
