import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {registerEditor,clearEditor,markEditorSaved,editorHasWork,editorRouteGuard,flushEditorDraft} from '../dist/workspace/edit-guard.mjs';

function fixture(t){
 const dom=new JSDOM('<main class="dashboard"><textarea id="draft"></textarea><a id="other" href="/other.html">其他页面</a></main><dialog id="workspace-dialog"><div id="body"></div></dialog>',{url:'https://paperknow.cn/workspace.html#tool/writing'}),w=dom.window;
 globalThis.window=w;globalThis.document=w.document;globalThis.location=w.location;
 const input=w.document.querySelector('#draft'),timers=new Map(),notices=[],modals=[],saved=[];let serial=0,manual=0,fail=false,busy=false;
 w.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;};w.clearTimeout=id=>timers.delete(id);w.document.querySelector('dialog').close=()=>{};
 registerEditor({label:'论文草稿',ctx:{notify:text=>notices.push(text),modal:(title,html)=>{modals.push(title);w.document.querySelector('#body').innerHTML=html;}},getValue:()=>({text:input.value}),save:()=>{manual++;},saveDraft:()=>{if(fail)throw Error('quota');saved.push(input.value);markEditorSaved();return true;},busy:()=>busy});
 const edit=value=>{input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const tick=()=>{const first=[...timers.entries()][0];assert.ok(first,'an autosave should be scheduled');timers.delete(first[0]);first[1].fn();};
 t.after(()=>{clearEditor();w.close();});
 return {w,input,timers,notices,modals,saved,edit,tick,setFail:value=>fail=value,setBusy:value=>busy=value,manual:()=>manual};
}

test('idle draft autosave preserves incomplete input and caret without a confirmation or manual submission',t=>{
 const f=fixture(t);f.input.focus();f.edit('a');f.input.setSelectionRange(1,1);assert.equal(editorHasWork(),true);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,800);f.tick();
 assert.deepEqual(f.saved,['a']);assert.equal(editorHasWork(),false);assert.equal(f.w.document.activeElement,f.input);assert.equal(f.input.selectionStart,1);assert.equal(f.manual(),0);assert.deepEqual(f.modals,[]);assert.deepEqual(f.notices,[]);
});
test('navigation immediately flushes the latest input once and cancels pending idle work',t=>{
 const f=fixture(t);f.edit('第一次');f.edit('最后一次修改');assert.equal(f.timers.size,1);assert.equal(editorRouteGuard('#home'),true);assert.deepEqual(f.saved,['最后一次修改']);assert.equal(f.timers.size,0);assert.deepEqual(f.modals,[]);assert.equal(editorRouteGuard('#home'),true);assert.equal(f.saved.length,1);
});
test('only a real save failure blocks navigation and retry leaves after data is persisted',t=>{
 const f=fixture(t);f.edit('仍须保留的草稿');f.setFail(true);assert.equal(editorRouteGuard('#home'),false);assert.deepEqual(f.saved,[]);assert.equal(f.input.value,'仍须保留的草稿');assert.equal(editorHasWork(),true);assert.deepEqual(f.modals,['草稿保存失败']);
 f.setFail(false);f.w.document.querySelector('#editor-save-leave').click();assert.deepEqual(f.saved,['仍须保留的草稿']);assert.equal(f.w.location.hash,'#home');assert.equal(editorHasWork(),false);
});
test('refresh saves synchronously without a browser warning, retaining the warning only on failed persistence',t=>{
 const f=fixture(t);f.edit('刷新之前的输入');let event=new f.w.Event('beforeunload',{cancelable:true});assert.equal(f.w.dispatchEvent(event),true);assert.deepEqual(f.saved,['刷新之前的输入']);assert.equal(f.timers.size,0);
 f.edit('存储失败仍保留');f.setFail(true);event=new f.w.Event('beforeunload',{cancelable:true});assert.equal(f.w.dispatchEvent(event),false);assert.equal(editorHasWork(),true);assert.equal(f.input.value,'存储失败仍保留');
});
test('normal outbound links continue after an automatic save and are blocked only when the draft cannot be saved',t=>{
 const f=fixture(t);let allowed;const link=f.w.document.querySelector('#other');link.addEventListener('click',e=>{allowed=!e.defaultPrevented;e.preventDefault();});f.edit('访问其他页面');link.click();assert.equal(allowed,true);assert.deepEqual(f.saved,['访问其他页面']);assert.deepEqual(f.modals,[]);
 f.edit('未能保存的新内容');f.setFail(true);allowed=undefined;link.click();assert.equal(allowed,undefined);assert.deepEqual(f.modals,['草稿保存失败']);assert.equal(f.input.value,'未能保存的新内容');
});
test('busy parsing waits before autosaving and blocks only until the file is ready',t=>{
 const f=fixture(t);f.setBusy(true);f.edit('解析中的资料');f.tick();assert.equal(f.saved.length,0);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,500);assert.equal(editorRouteGuard('#home'),false);assert.match(f.notices[0],/解析/);assert.deepEqual(f.modals,[]);
 f.setBusy(false);f.tick();assert.deepEqual(f.saved,['解析中的资料']);assert.equal(editorRouteGuard('#home'),true);
});
test('disposed editor timers and unload handlers cannot save into a replacement page',t=>{
 const f=fixture(t);f.edit('旧页面');const late=[...f.timers.values()][0].fn;clearEditor();assert.equal(f.timers.size,0);registerEditor({label:'新页面',ctx:{},getValue:()=>'',save:()=>{throw Error('should not be called');}});late();f.w.dispatchEvent(new f.w.Event('beforeunload',{cancelable:true}));assert.deepEqual(f.saved,[]);assert.equal(flushEditorDraft(),true);
});
test('background failure is announced once while retaining input and can recover without a modal',t=>{
 const f=fixture(t);f.setFail(true);f.edit('首次');f.tick();f.edit('继续输入');f.tick();assert.equal(f.notices.length,1);assert.deepEqual(f.modals,[]);assert.equal(f.saved.length,0);f.setFail(false);f.edit('恢复保存');f.tick();assert.deepEqual(f.saved,['恢复保存']);assert.equal(editorHasWork(),false);
});
