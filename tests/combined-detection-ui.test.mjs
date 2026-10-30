import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountCombinedDetection} from '../dist/workspace/combined-detection.mjs';
const wait=()=>new Promise(r=>setImmediate(r));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,3));}throw Error('Combined UI did not settle');}
async function setup(t){
 const dom=new JSDOM('<main id="root"></main>',{url:'https://paperknow.cn/workspace.html#category/detection?view=combined'}),w=dom.window,root=w.document.querySelector('#root');
 let owner='alice',state='running',fail=false;const calls=[];
 const task=()=>({id:'joint-1',title:'Synthetic manuscript',status:state,createdAt:new Date().toISOString(),children:state==='completed'?[{id:'web-1',kind:'similarity',status:'completed'},{id:'ai-1',kind:'aigc',status:'completed'}]:[]});
 const fetchImpl=async(path,options={})=>{const body=options.body?JSON.parse(options.body):null;calls.push({path,body});let data;
 if(path==='/api/auth/me')data={user:{id:owner}};
 else if(path==='/api/capabilities')data={combinedDetection:{ready:true,pricingMode:'paid',pointsCharged:true,creditCost:149,pricingVersion:3}};
 else if(path==='/api/combined-detections'&&!body)data={items:[]};
 else if(path==='/api/combined-detections'&&body){if(fail)return{ok:false,status:402,json:async()=>({error:'可用积分不足'})};data=task();}
 else if(path==='/api/combined-detections/joint-1')data=task();
 else throw Error('Unexpected route '+path);
 return{ok:true,status:200,json:async()=>data};};
 const ui=mountCombinedDetection({container:root,fetchImpl,pollInterval:15,importDocument:async()=>({text:'Synthetic research manuscript with methods and verified references. '.repeat(5)})});
 t.after(()=>{ui.dispose();w.close();});await ui.ready;
 async function upload(name='manuscript.docx'){const input=root.querySelector('[data-joint-file]');Object.defineProperty(input,'files',{configurable:true,value:[new w.File(['synthetic DOCX fixture'],name)]});input.dispatchEvent(new w.Event('change'));await until(()=>!root.querySelector('[data-joint-start]').disabled);}
 return{root,w,calls,upload,setOwner(value){owner=value;},fail(){fail=true;},complete(){state='completed';}};
}
test('joint detection imports once, shows real tariff and stable progress, and opens both completed reports',async t=>{
 const f=await setup(t);assert.match(f.root.textContent,/149/);assert.match(f.root.textContent,/14\.9/);assert.equal(f.root.querySelector('input[type=checkbox]'),null);
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
