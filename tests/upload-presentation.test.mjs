import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installUploadPresentation,uploadFormatLabel,uploadFileSize} from '../dist/workspace/upload-presentation.mjs';
import {installStoredFilePickers} from '../dist/workspace/file-picker.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,html){const dom=new JSDOM('<div id="app">'+html+'</div>'),root=dom.window.document.querySelector('#app'),view=installUploadPresentation(root);t.after(()=>{view.dispose();dom.window.close();});return {dom,w:dom.window,root,view};}
function choose(w,input,names){Object.defineProperty(input,'files',{configurable:true,value:names.map(name=>new w.File(['材料正文'],name))});input.dispatchEvent(new w.Event('change',{bubbles:true}));}

test('upload presentation preserves original controls, receiving labels, file restrictions and feature change handlers',t=>{
 const {w,root}=fixture(t,'<form><label for="source">研究材料</label><input id="source" name="material" type="file" accept=".docx,.pdf" required></form>');
 const input=root.querySelector('#source'),control=root.querySelector('.pk-file-control');let received=0;
 input.addEventListener('change',()=>received++);choose(w,input,['研究材料.docx']);
 assert.equal(control.querySelector('input'),input);assert.equal(input.labels[0].textContent,'研究材料');assert.equal(input.name,'material');assert.equal(input.accept,'.docx,.pdf');assert.equal(input.required,true);
 assert.equal(received,1);assert.equal(control.querySelector('.pk-upload-name').textContent,'研究材料.docx');assert.equal(control.querySelector('.pk-file-action').textContent,'重新选择');
 assert.equal(input.hidden,false);assert.equal(control.querySelector('[role=button]'),null);
});
test('all large upload variants receive the shared design without duplicating controls or losing instructions',async t=>{
 const classes=['revision-product-upload','revision-report-upload','analysis-upload','det-upload','document-service-upload','ppt-mode-drop','ppt-drop','research-drop','knowledge-dropzone','rdc-literature-upload','lit-upload','format-source-drop','web-similarity-file','drop-zone'];
 const {w,root}=fixture(t,classes.map((name,index)=>`<label class="${name}"><b>上传材料 ${index}</b><small>最大 2MB</small><input type="file" accept=".docx,.pdf"></label>`).join(''));
 assert.equal(root.querySelectorAll('.pk-upload-zone').length,classes.length);assert.equal(root.querySelectorAll('input[type=file]').length,classes.length);
 for(const label of root.querySelectorAll('label')){assert.equal(label.querySelectorAll('.pk-upload-symbol').length,1);assert.equal(label.querySelectorAll('.pk-upload-action').length,1);assert.match(label.textContent,/最大 2MB/);assert.equal(label.querySelector('.pk-upload-selection').hidden,true);}
 const input=root.querySelector('input');choose(w,input,['原文.pdf']);root.append(root.firstElementChild);await flush();
 assert.equal(root.querySelectorAll('.pk-upload-action').length,classes.length);assert.equal(input.closest('label').querySelector('.pk-upload-selection').hidden,false);
 assert.equal(input.closest('label').querySelector('.pk-upload-name').textContent,'原文.pdf');
});
test('new dialogs, disabled controls and re-enabled uploads update without re-mounting or submitting',async t=>{
 const {root,w}=fixture(t,'');let changes=0,submissions=0;
 root.addEventListener('change',()=>changes++);root.addEventListener('submit',()=>submissions++);
 root.innerHTML='<form><label class="revision-product-upload"><strong>上传原文</strong><input type="file" accept=".txt" disabled></label></form>';await flush();
 const input=root.querySelector('input');assert.equal(root.querySelector('.pk-upload-action').textContent,'暂不可选');input.disabled=false;input.accept='.txt,.docx';await flush();
 assert.equal(root.querySelector('.pk-upload-action').textContent,'选择文件');assert.equal(root.querySelector('.pk-upload-zone').classList.contains('pk-upload-disabled'),false);
 choose(w,input,['测试.txt']);assert.equal(changes,1);assert.equal(submissions,0);assert.equal(input.accept,'.txt,.docx');
 root.innerHTML='<input type="file" accept=".csv">';await flush();assert.equal(root.querySelectorAll('.pk-file-control').length,1);
});
test('hidden outline/template buttons retain their single entry, and filenames are inert text',async t=>{
 const {root,w}=fixture(t,'<input type="file" hidden id="outline"><input class="ppt-inline-file" type="file"><label class="btn">上传模板<input type="file" hidden data-template-file></label><label class="btn secondary format-upload">上传DOCX样例<input type="file" id="sample" accept=".docx"></label><input type="file" id="visible" multiple>');
 assert.equal(root.querySelectorAll('.pk-file-control').length,1);assert.equal(root.querySelector('#outline').parentElement,root);assert.equal(root.querySelector('[data-template-file]').hidden,true);
 assert.equal(root.querySelector('#sample').parentElement.classList.contains('pk-upload-button'),true);assert.equal(root.querySelector('#sample').closest('.pk-file-control'),null);assert.equal(root.querySelector('#sample').accept,'.docx');assert.equal(root.querySelector('#sample').hidden,false);
 choose(w,root.querySelector('#visible'),['<img src=x onerror=alert(1)>.txt','第二份.txt']);
 assert.equal(root.querySelector('img'),null);assert.match(root.querySelector('.pk-upload-name').textContent,/等 2 个文件/);
 root.querySelector('#outline').hidden=false;await flush();assert.equal(root.querySelectorAll('.pk-file-control').length,2);
});
test('cloud-file actions stay outside native input overlays regardless of installer order',async t=>{
 for(const order of ['presentation-first','library-first']){
  const dom=new JSDOM('<div id="app"><input type="file" accept=".txt"><label class="revision-product-upload"><strong>上传原文</strong><input type="file" accept=".docx"></label></div>'),root=dom.window.document.querySelector('#app');
  const first=order==='presentation-first'?installUploadPresentation(root):installStoredFilePickers(root),second=order==='presentation-first'?installStoredFilePickers(root):installUploadPresentation(root);
  try{await flush();assert.equal(root.querySelectorAll('.stored-file-trigger').length,2);assert.equal(root.querySelector('.pk-file-control .stored-file-trigger'),null);assert.equal(root.querySelector('label .stored-file-trigger'),null);assert.equal(root.querySelector('.pk-file-control').nextElementSibling.classList.contains('stored-file-trigger'),true);}
  finally{first.dispose();second.dispose();dom.window.close();}
 }
});
test('format metadata uses supported extensions, and disposal stops observing detached workflows',async t=>{
 assert.equal(uploadFormatLabel('.docx,application/pdf,.PDF,image/jpeg'),'DOCX · PDF · JPG');assert.equal(uploadFileSize(0),'0 B');assert.equal(uploadFileSize(1048576),'1.0 MB');
 const {root,view}=fixture(t,'');view.dispose();root.innerHTML='<input type="file" accept=".txt">';await flush();assert.equal(root.querySelector('.pk-file-control'),null);
});
