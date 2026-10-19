import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountWriting} from '../dist/workspace/writing.mjs';
import {clearEditor,flushEditorDraft} from '../dist/workspace/edit-guard.mjs';
function fixture(){
 const dom=new JSDOM('<aside class="sidebar"></aside><div class="breadcrumb"><strong></strong></div><main class="dashboard"></main>',{url:'https://paperknow.test/workspace.html#tool/writing'});
 for(const name of ['window','document','localStorage','FormData','location','AbortController'])globalThis[name]=dom.window[name];
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
 const ctx={notify(){},session:async()=>({status:'guest',user:null}),modal(title,html){document.getElementById('workspace-dialog')?.remove();const modal=document.createElement('dialog');modal.id='workspace-dialog';modal.innerHTML='<h2>'+title+'</h2>'+html;modal.close=()=>modal.removeAttribute('open');modal.setAttribute('open','');document.body.append(modal);}};
 const $=selector=>document.querySelector(selector);
 return {dom,$,ctx,input(selector,value){const node=$(selector);node.value=value;node.dispatchEvent(new window.Event('input',{bubbles:true}));},start(){mountWriting(undefined,undefined,ctx);this.input('#writing-title','引文批量导入验收');$('#writing-generate').click();$('#writing-material-skip').click();},parse(text){$('#writing-citation-import').click();this.input('#writing-citation-input',text);$('#writing-citation-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));},save(){assert.equal(flushEditorDraft(),true);return JSON.parse(localStorage.getItem('paperknow-drafts'))[0];},close(){clearEditor();dom.window.close();}};
}
const citations='[1] 作者甲. 合成甲研究[J]. 演示期刊,2026.\n[2] 作者乙. 合成乙研究[D]. 演示大学,2025.';
test('thesis citation preview requires explicit adoption, preserves metadata-only evidence, order and raw text',()=>{
 const f=fixture();try{f.start();f.parse(citations);assert.equal(f.$('#writing-citation-confirm').disabled,false);assert.match(f.$('#writing-citation-preview').textContent,/合成甲研究/);assert.equal(f.save().writingReferences.length,0);f.$('#writing-citation-confirm').click();let saved=f.save();assert.equal(saved.writingReferences.length,2);assert.equal(saved.writingReferences[0].text,'');assert.match(saved.writingReferences[0].rawCitation,/\[J\]/);assert.ok(saved.writingReferences.every(row=>!row.confirmed));assert.ok(f.$('[aria-label="上移文献：合成甲研究"]').disabled);f.$('[aria-label="下移文献：合成甲研究"]').click();saved=f.save();assert.deepEqual(saved.writingReferences.map(row=>row.title),['合成乙研究','合成甲研究']);clearEditor();mountWriting(saved.id,undefined,f.ctx);assert.deepEqual(f.save().writingReferences.map(row=>row.title),['合成乙研究','合成甲研究']);assert.match(f.$('.reference-imported-citation').textContent,/合成乙研究/);
 }finally{f.close();}
});
test('editing preview invalidates adoption and malformed entry does not partially add citations',()=>{
 const f=fixture();try{f.start();f.parse(citations);f.input('#writing-citation-input',citations+'\nnot a complete citation');assert.equal(f.$('#writing-citation-confirm').disabled,true);f.$('#writing-citation-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));assert.match(f.$('#writing-citation-error').textContent,/标准引文/);assert.equal(f.save().writingReferences.length,0);
 }finally{f.close();}
});
