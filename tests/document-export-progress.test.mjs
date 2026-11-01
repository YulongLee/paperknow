import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDocumentExportProgress} from '../dist/workspace/document-export-progress.mjs';
import {bindDocumentExports,documentExportButtons} from '../dist/workspace/document-export.mjs';
import {beginDraftScope,endDraftScope} from '../dist/workspace/state.mjs';
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
test('export progress keeps the same accessible surface through formatting and paging without invented percentages',()=>{
 const dom=new JSDOM('<main><p id="status"></p></main>'),status=dom.window.document.querySelector('p'),progress=createDocumentExportProgress(status);
 try{progress.stage(0);const root=status.previousElementSibling;progress.stage(1,'正在格式检查与编排中');assert.equal(status.previousElementSibling,root);assert.match(root.textContent,/正在格式检查与编排中/);assert.equal(root.querySelector('[role=progressbar]').hasAttribute('aria-valuenow'),false);progress.stage(2,'正在核验目录与页码');assert.equal(root.querySelectorAll('li[data-state=complete]').length,2);progress.finish('complete','已保存并下载');assert.equal(root.dataset.state,'complete');assert.equal(root.getAttribute('aria-busy'),'false');assert.equal(root.querySelectorAll('li[data-state=complete]').length,4);}finally{progress.dispose();dom.window.close();}
});
for(const missing of [false,true])test('final export distinguishes '+(missing?'specific missing evidence':'an incomplete checker')+' and restores controls for continuation',async()=>{
 const dom=new JSDOM('<main>'+documentExportButtons('progress',{submission:true})+'<p id="status"></p></main>',{url:'https://paperknow.test/workspace.html'});for(const key of ['window','document','location'])globalThis[key]=dom.window[key];beginDraftScope({ownerId:'isolated',drafts:[]});const states=[],requests=[];let downloads=0;
 try{bindDocumentExports('progress',()=> '已保存的合成稿件',()=> '合成文稿',document.querySelector('#status'),{docxOnly:true,loadDocument:async()=>({}),getDocumentOptions:()=>({documentKind:'thesis',requireSupplementCheck:true,quality:{supplementCheck:{status:missing?'needs_materials':'unavailable',coverage:{complete:missing}}}}),onNeedsCompletion:request=>{requests.push(request);},onStateChange:state=>{states.push(state);},downloadFile:()=>{downloads++;}});document.querySelector('#progress-docx').click();assert.ok(document.querySelector('[data-document-export-progress]'));await settle();assert.equal(downloads,0);assert.equal(document.querySelector('#progress-docx').disabled,false);assert.equal(requests[0].reason,missing?'needs_materials':'check_required');assert.equal(states[0].active,true);assert.equal(states[1].active,false);const root=document.querySelector('[data-document-export-progress]');assert.equal(root.dataset.state,missing?'needs_materials':'check_required');assert.match(root.textContent,missing?/具体缺项/:/无需重复上传/);}finally{endDraftScope();dom.window.close();}
});
