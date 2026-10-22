import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountProjectHistoryImport} from '../dist/workspace/project-history-import.mjs';
import {beginDraftScope,endDraftScope} from '../dist/workspace/state.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const stored=[{id:'old-one',name:'历史本科项目',degree:'本科',major:'教育学',stage:'writing',description:'研究说明',status:'active'},{id:'old-two',name:'历史归档项目',degree:'硕士',status:'archived'}];
const response=items=>({mappings:items.map(item=>({localId:item.localId,projectId:'cloud-'+item.localId})),imported:items.length,reused:0});
async function settle(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('history importer did not settle');}
function fixture(t,{rows=stored,owner='alice',api=async(_path,body)=>response(body.items),selectedLegacyId}={}){
 const dom=new JSDOM('<main id="root"></main>',{url:'https://paperknow.cn/workspace.html#projects',pretendToBeVisual:true}),w=dom.window,root=w.document.querySelector('#root'),prior=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{value:w.localStorage,writable:true,configurable:true});endDraftScope();
 w.localStorage.setItem('paperknow-projects',JSON.stringify(rows));
 const calls=[],events=[],notices=[],user=owner?{id:owner}:null,options={user,selectedLegacyId,api:async(path,body)=>{calls.push({path,body});return api(path,body);},onBusyChange:value=>events.push(['busy',value]),onImported:data=>events.push(['imported',data]),notify:text=>notices.push(text)};
 const dispose=mountProjectHistoryImport(root,options);
 t.after(()=>{dispose();endDraftScope();w.close();if(prior)Object.defineProperty(globalThis,'localStorage',prior);else delete globalThis.localStorage;});
 const change=(index,checked=true)=>{root.querySelectorAll('input[type=checkbox]')[index].checked=checked;root.querySelector('form').dispatchEvent(new w.Event('change',{bubbles:true}));};
 const submit=()=>root.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 return{w,root,user,calls,events,notices,dispose,change,submit,options};
}

test('historical projects never upload until explicitly selected and confirmed; only selected metadata is sent',async t=>{
 const{w,root,calls,events,change,submit}=fixture(t),original=w.localStorage.getItem('paperknow-projects');
 assert.equal(root.querySelector('details').open,false);assert.equal(root.querySelector('[type=submit]').disabled,true);assert.ok([...root.querySelectorAll('[type=checkbox]')].every(input=>!input.checked));assert.equal(calls.length,0);
 submit();assert.equal(calls.length,0);change(1);assert.equal(calls.length,0);submit();await settle(()=>events.some(event=>event[0]==='imported'));
 assert.deepEqual(calls,[{path:'/projects/import-local',body:{expectedUserId:'alice',items:[{localId:'old-two',title:'历史归档项目',degree:'硕士',major:'',stage:'准备中',description:'',status:'archived'}]}}]);
 assert.deepEqual(events.map(event=>event[0]==='busy'?event:['imported']),[['busy',true],['busy',false],['imported']]);assert.equal(w.localStorage.getItem('paperknow-projects'),original);assert.match(root.textContent,/历史原记录仍保留/);assert.match(root.textContent,/文件管理/);
});

test('a legacy deep link opens and highlights the project without preselecting or uploading it',t=>{
 const{root,calls}=fixture(t,{selectedLegacyId:'old-two'});assert.equal(root.querySelector('details').open,true);assert.equal(root.querySelector('[data-highlighted=true] input').value,'old-two');assert.equal(root.querySelector('[data-highlighted=true] input').checked,false);assert.equal(calls.length,0);
});

test('project names and legacy identifiers are treated as text, never executable markup',t=>{
 const attack='</label><img src=x onerror="alert(1)">';
 const{root}=fixture(t,{rows:[{id:attack,name:attack,description:attack}]});assert.equal(root.querySelector('img'),null);assert.equal(root.querySelector('b').textContent,attack);assert.equal(root.querySelector('[type=checkbox]').value,attack);
});

test('cancel clears the selection and closes the panel without changing old records',t=>{
 const{w,root,change,calls}=fixture(t),original=w.localStorage.getItem('paperknow-projects');root.querySelector('details').open=true;change(0);root.querySelector('[type=button]').click();assert.equal(root.querySelector('details').open,false);assert.equal(root.querySelector('[type=checkbox]').checked,false);assert.equal(root.querySelector('[type=submit]').disabled,true);assert.equal(calls.length,0);assert.equal(w.localStorage.getItem('paperknow-projects'),original);
});

test('network failure preserves the selected project for an idempotent retry and never changes browser records',async t=>{
 let attempts=0;const{w,root,calls,events,change,submit}=fixture(t,{api:async(_path,body)=>{if(++attempts===1)throw Error('网络暂不可用');return response(body.items);}}),original=w.localStorage.getItem('paperknow-projects');
 change(0);submit();await settle(()=>root.querySelector('[role=status]').textContent==='网络暂不可用');assert.equal(root.querySelector('[type=checkbox]').checked,true);assert.equal(root.querySelector('[type=submit]').disabled,false);assert.equal(w.localStorage.getItem('paperknow-projects'),original);
 submit();await settle(()=>events.some(event=>event[0]==='imported'));assert.deepEqual(calls[0].body,calls[1].body);assert.equal(w.localStorage.getItem('paperknow-projects'),original);
});

test('duplicate clicks while the request is running submit only one batch',async t=>{
 const gate=deferred();const{root,calls,change,submit,events}=fixture(t,{api:()=>gate.promise});change(0);submit();submit();assert.equal(calls.length,1);assert.equal(root.querySelector('[type=checkbox]').disabled,true);assert.equal(root.querySelector('[type=button]').disabled,true);gate.resolve(response(calls[0].body.items));await settle(()=>events.some(event=>event[0]==='imported'));assert.equal(calls.length,1);
});

test('disposed or detached importers ignore late results and release their busy state',async t=>{
 const gate=deferred();const{root,calls,change,submit,events,notices,dispose}=fixture(t,{api:()=>gate.promise});change(0);submit();dispose();root.remove();gate.resolve(response(calls[0].body.items));await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(events,[['busy',true],['busy',false]]);assert.deepEqual(notices,[]);
});

test('an account change cannot submit or publish results under the original owner',async t=>{
 const gate=deferred();const{root,user,calls,change,submit,events,notices}=fixture(t,{api:()=>gate.promise});change(0);submit();assert.equal(calls[0].body.expectedUserId,'alice');user.id='bob';gate.resolve(response(calls[0].body.items));await new Promise(resolve=>setTimeout(resolve,5));submit();assert.equal(calls.length,1);assert.equal(events.some(event=>event[0]==='imported'),false);assert.deepEqual(notices,[]);
});

test('guest, empty source, and active account draft scope do not expose a legacy import panel',t=>{
 const{root,w,options,dispose}=fixture(t,{owner:null});assert.equal(root.children.length,0);dispose();
 const ownerOptions={...options,user:{id:'alice'}};w.localStorage.setItem('paperknow-projects','[]');let stop=mountProjectHistoryImport(root,ownerOptions);assert.equal(root.children.length,0);stop();
 w.localStorage.setItem('paperknow-projects',JSON.stringify(stored));beginDraftScope({ownerId:'alice',projectRows:[{id:'account-row',name:'账户草稿项目'}]});stop=mountProjectHistoryImport(root,ownerOptions);assert.equal(root.children.length,0);stop();
});

test('more than 100 checked projects cannot be submitted; invalid long metadata is disabled without altering it',t=>{
 const rows=Array.from({length:101},(_,i)=>({id:String(i),name:'历史项目'+i}));rows.push({id:'long',name:'过长说明',description:'字'.repeat(5001)});
 const{root,w,calls,submit}=fixture(t,{rows}),inputs=[...root.querySelectorAll('[type=checkbox]')],original=w.localStorage.getItem('paperknow-projects');assert.equal(inputs.at(-1).disabled,true);for(const check of inputs.slice(0,101))check.checked=true;root.querySelector('form').dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(root.querySelector('[type=submit]').disabled,true);submit();assert.equal(calls.length,0);assert.match(root.querySelector('[role=status]').textContent,/最多导入 100/);assert.equal(w.localStorage.getItem('paperknow-projects'),original);
});

test('an incomplete response cannot claim success and keeps a safe retry available',async t=>{
 const{root,calls,events,change,submit}=fixture(t,{api:async()=>({mappings:[]})});change(0);submit();await settle(()=>root.querySelector('[role=status]').textContent.includes('导入结果尚未确认'));assert.equal(calls.length,1);assert.equal(events.some(event=>event[0]==='imported'),false);assert.equal(root.querySelector('[type=checkbox]').checked,true);assert.equal(root.querySelector('[type=submit]').disabled,false);
});
