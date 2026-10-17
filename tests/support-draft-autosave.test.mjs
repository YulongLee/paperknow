import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountWritingSupport} from '../dist/workspace/writing-support.mjs';
import {mountTool} from '../dist/workspace/tools.mjs';
import {mountLiteratureReader} from '../dist/workspace/literature.mjs';
import {validatePaper,literatureKey} from '../dist/workspace/literature-model.mjs';
import {clearEditor,flushEditorDraft,editorHasWork,editorRouteGuard,saveEditorWork} from '../dist/workspace/edit-guard.mjs';
import {beginDraftScope,endDraftScope,list,keys} from '../dist/workspace/state.mjs';

function fixture(t){
 const dom=new JSDOM('<aside class="sidebar"></aside><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.test/workspace.html#tool/writing'});
 for(const key of ['window','document','localStorage','FormData','location','AbortController'])globalThis[key]=dom.window[key];
 const notices=[],modals=[],ctx={notify:text=>notices.push(text),modal:(title,html)=>{modals.push(title);document.querySelector('#workspace-dialog-body').innerHTML=html;}};
 const q=s=>document.querySelector(s),input=(s,value)=>{q(s).value=value;q(s).dispatchEvent(new window.Event('input',{bubbles:true}));};
 const read=key=>JSON.parse(localStorage.getItem(key)||'[]');
 t.after(()=>{clearEditor();endDraftScope();dom.window.close();});
 return {q,input,read,ctx,notices,modals};
}
const paper=(id,notes=[])=>validatePaper({id,title:'文献 '+id,text:'真实原文',scope:'full',notes,tags:[],warnings:[]});

test('support autosave retains incomplete raw inputs and dates without validation or duplicate drafts',t=>{
 const f=fixture(t);mountWritingSupport('practice',undefined,undefined,f.ctx);
 let validations=0;f.q('#support-form').reportValidity=()=>{validations++;return false;};
 f.input('#support-title','a');f.input('#support-start','2026-10-20');f.input('#support-end','2026-10-01');f.input('#support-experience','只填写了一半的真实经历');
 assert.equal(flushEditorDraft(),true);assert.equal(validations,0);assert.equal(f.q('#support-output').value,'');
 const first=f.read(keys.drafts)[0];assert.equal(first.supportFields.title,'a');assert.equal(first.supportFields.end,'2026-10-01');assert.equal(first.text,'');
 f.q('#support-save').click();assert.equal(validations,1);
 f.input('#support-title','');assert.equal(editorRouteGuard('#home'),true);assert.deepEqual(f.modals,[]);assert.equal(f.read(keys.drafts).length,1);assert.equal(f.read(keys.drafts)[0].id,first.id);
 clearEditor();mountWritingSupport('practice',first.id,undefined,f.ctx);assert.equal(f.q('#support-title').value,'');assert.equal(f.q('#support-experience').value,'只填写了一半的真实经历');assert.equal(f.q('#support-start').value,'2026-10-20');
 f.q('#support-form').reportValidity=()=>true;f.input('#support-title','有效标题');f.q('#support-save').click();assert.match(f.q('#support-error').textContent,/结束日期不能早于/);
});

test('generic tool saves raw material before output exists and preserves its draft identity on reopen',t=>{
 const f=fixture(t);mountTool('translation',undefined,undefined,f.ctx);f.input('#integrated-text','待核对的原文和术语');
 assert.equal(flushEditorDraft(),true);const saved=f.read(keys.drafts)[0];assert.equal(saved.inputTitle,'');assert.equal(saved.material,'待核对的原文和术语');assert.equal(saved.text,'');assert.equal(f.read(keys.tasks).length,0);
 f.input('#integrated-text','待核对的原文和术语\n继续输入');assert.equal(flushEditorDraft(),true);assert.equal(f.read(keys.drafts).length,1);assert.equal(f.read(keys.drafts)[0].id,saved.id);
 clearEditor();mountTool('translation',saved.id,undefined,f.ctx);assert.equal(f.q('#integrated-title').value,'');assert.equal(f.q('#integrated-text').value,'待核对的原文和术语\n继续输入');assert.equal(f.q('#integrated-result').value,'');
});

for(const [name,mount,selector,status] of [
 ['support',ctx=>mountWritingSupport('summary',undefined,undefined,ctx),'#support-topic','#support-status'],
 ['generic tool',ctx=>mountTool('translation',undefined,undefined,ctx),'#integrated-text','#integrated-status']
])test(name+' keeps account adapter edits pending without background memory saves or false browser-save notices',async t=>{
 const f=fixture(t);beginDraftScope({drafts:[],projectRows:[]});mount(f.ctx);f.input(selector,'尚未提交到账户的输入');await new Promise(resolve=>setTimeout(resolve,900));assert.equal(list(keys.drafts).length,0);assert.equal(localStorage.getItem(keys.drafts),null);assert.doesNotMatch(f.q(status).textContent,/已自动保存|保存到当前浏览器/);assert.equal(editorHasWork(),true);
 assert.equal(saveEditorWork(),true);assert.equal(list(keys.drafts).length,1);assert.match(f.q(status).textContent,/尚未保存到账户/);assert.doesNotMatch(f.q(status).textContent,/已自动保存|保存到当前浏览器/);assert.equal(localStorage.getItem(keys.drafts),null);
});

test('literature autosave restores a per-paper note draft without publishing or resetting the form',t=>{
 const f=fixture(t);localStorage.setItem(literatureKey,JSON.stringify([paper('one'),paper('two')]));mountLiteratureReader('one',f.ctx);f.input('#note-location','第 3 段');assert.equal(flushEditorDraft(),true);
 assert.equal(f.read(literatureKey)[0].notes.length,0);assert.equal(f.read(literatureKey)[0].noteDraft.location,'第 3 段');assert.equal(f.q('#note-location').value,'第 3 段');assert.equal(f.read(literatureKey)[1].noteDraft,undefined);
 f.input('#note-text','尚在思考中的笔记');assert.equal(editorRouteGuard('#home'),true);assert.equal(f.read(literatureKey)[0].notes.length,0);assert.deepEqual(f.modals,[]);
 clearEditor();mountLiteratureReader('two',f.ctx);assert.equal(f.q('#note-text').value,'');clearEditor();mountLiteratureReader('one',f.ctx);assert.equal(f.q('#note-text').value,'尚在思考中的笔记');assert.equal(f.q('#note-location').value,'第 3 段');
 f.q('#lit-note-form').dispatchEvent(new window.Event('submit',{cancelable:true}));const saved=f.read(literatureKey)[0];assert.equal(saved.notes.length,1);assert.equal(saved.notes[0].text,'尚在思考中的笔记');assert.equal(saved.noteDraft,undefined);assert.equal(f.q('#note-text').value,'');
});

test('editing an existing literature note stays a draft until explicit save and never duplicates the note',t=>{
 const f=fixture(t);const old={id:'n1',text:'已保存版本',location:'引言',createdAt:'2026-10-17T01:00:00Z'};localStorage.setItem(literatureKey,JSON.stringify([paper('one',[old])]));mountLiteratureReader('one',f.ctx);f.q('[data-edit-note]').click();f.input('#note-text','修改中的版本');assert.equal(flushEditorDraft(),true);assert.equal(f.read(literatureKey)[0].notes[0].text,'已保存版本');
 clearEditor();mountLiteratureReader('one',f.ctx);assert.equal(f.q('#note-text').value,'修改中的版本');assert.equal(f.q('#note-cancel').hidden,false);f.q('#lit-note-form').dispatchEvent(new window.Event('submit',{cancelable:true}));const saved=f.read(literatureKey)[0];assert.equal(saved.notes.length,1);assert.equal(saved.notes[0].id,'n1');assert.equal(saved.notes[0].text,'修改中的版本');assert.equal(saved.noteDraft,undefined);
 f.q('[data-edit-note]').click();f.input('#note-text','将取消的修改');assert.equal(flushEditorDraft(),true);f.q('#note-cancel').click();assert.equal(f.read(literatureKey)[0].noteDraft,undefined);assert.equal(f.read(literatureKey)[0].notes[0].text,'修改中的版本');
});

test('literature draft failures retain current input and do not recreate a removed paper',t=>{
 const f=fixture(t);localStorage.setItem(literatureKey,JSON.stringify([paper('one')]));mountLiteratureReader('one',f.ctx);f.input('#note-text','仍需保留的修改');const original=window.Storage.prototype.setItem;window.Storage.prototype.setItem=()=>{throw Error('quota');};try{assert.equal(flushEditorDraft(),false);assert.equal(editorHasWork(),true);assert.equal(f.q('#note-text').value,'仍需保留的修改');}finally{window.Storage.prototype.setItem=original;}
 localStorage.setItem(literatureKey,'[]');assert.equal(flushEditorDraft(),false);assert.equal(f.read(literatureKey).length,0);assert.equal(f.q('#note-text').value,'仍需保留的修改');assert.equal(f.notices.length,0);
});
