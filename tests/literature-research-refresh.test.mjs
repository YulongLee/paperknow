import {installGuestExportSession,waitForExport} from './fixtures/artifact-session.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {validatePaper,literatureKey} from '../dist/workspace/literature-model.mjs';
function setup(){
 const dom=new JSDOM('<main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://example.test/workspace.html#category/research'});
 for(const key of ['window','document','localStorage','FormData','location','AbortController'])globalThis[key]=dom.window[key];
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true,writable:true});
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{};document.querySelector('dialog').close=()=>{};
 const notices=[],ctx={notify:value=>notices.push(value),modal:(_,html)=>{document.querySelector('#workspace-dialog-body').innerHTML=html;}};
 return {dom,ctx,notices};
}
const $=s=>document.querySelector(s);
const input=(s,value)=>{const el=$(s);el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));};
setup();
const {mountLiterature,mountLiteratureReader}=await import('../dist/workspace/literature.mjs');
const {mountResearch,disposeResearch,researchHasWork,researchRouteGuard}=await import('../dist/workspace/research.mjs');
const {clearEditor}=await import('../dist/workspace/edit-guard.mjs');

test('AI reading keeps exactly four task entries, local search, reader notes and import forms functional',()=>{
 const {dom,ctx}=setup(),paper=validatePaper({id:'paper-refresh',title:'真实文献 <script>x</script>',authors:'用户作者',year:'2025',text:'可核对的原文正文',scope:'full',tags:['教育研究'],notes:[],status:'unread'});
 try{
  localStorage.setItem(literatureKey,JSON.stringify([paper]));mountLiterature(ctx);
  assert.deepEqual([...document.querySelectorAll('.lit-feature-copy b')].map(node=>node.textContent),['我的文献','文献检索','文献研读','文献翻译']);assert.equal(document.querySelectorAll('.lit-feature-card').length,4);assert.ok($('.lit-table-scroll'));assert.equal(document.querySelector('script'),null);
  $('[data-lit-entry="search"]').click();assert.ok($('.writing-reference-search'));$('[data-ref-local]').click();input('#lit-search-query','用户作者');$('#lit-search-form').dispatchEvent(new window.Event('submit',{cancelable:true}));assert.match($('#lit-search-results').textContent,/真实文献/);
  $('[data-lit-import]').click();assert.ok($('#lit-upload'));assert.ok($('#lit-form'));
  mountLiteratureReader(paper.id,ctx);input('#note-text','根据原文记录自己的研究问题');$('#lit-note-form').dispatchEvent(new window.Event('submit',{cancelable:true}));const saved=JSON.parse(localStorage.getItem(literatureKey))[0];assert.equal(saved.notes[0].text,'根据原文记录自己的研究问题');assert.equal(saved.text,paper.text);assert.equal(document.querySelector('script'),null);assert.match($('#note-status').textContent,/已保存/);
 }finally{clearEditor();dom.window.close();}
});

test('research preserves chart save and professional descriptions across its three honest workflows',async()=>{
 const {dom,ctx,notices}=setup(),restoreExport=installGuestExportSession(),create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=window.HTMLAnchorElement.prototype.click;let blob;
 try{
  mountResearch(ctx);assert.equal(document.querySelectorAll('.research-mode-cards [data-mode]').length,3);assert.equal(document.querySelectorAll('.research-workflow-strip li').length,3);
  input('[data-option="title"]','用户真实图表');$('[data-action="save"]').click();assert.equal(JSON.parse(localStorage.getItem('paperknow-drafts'))[0].title,'用户真实图表');
  $('[data-mode="pro"]').click();$('[data-pro-type="9"]').click();input('[data-pro-description]','绘制电源、开关与电阻串联关系，并标注电流方向。');assert.equal(researchHasWork(),true);
  $('[data-mode="formula"]').click();$('[data-mode="pro"]').click();assert.match($('[data-pro-description]').value,/电源、开关与电阻/);assert.equal($('[data-pro-type="9"]').getAttribute('aria-pressed'),'true');assert.match($('[data-action="pro-generate"]').textContent,/AI 生成结构图/);assert.match($('.research-credit').textContent,/确认用量/);
  URL.createObjectURL=value=>{blob=value;return 'blob:research';};URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=()=>{};
  $('[data-action="pro-export"]').click();await waitForExport(()=>blob);assert.match(await blob.text(),/电子电路/);await waitForExport(()=>blob);assert.match(await blob.text(),/电流方向/);assert.equal(JSON.parse(localStorage.getItem('paperknow-drafts')).length,1);assert.doesNotMatch(notices.join(' '),/图表已生成|已扣费/);
  globalThis.confirm=()=>{throw Error('不应弹出离开确认');};assert.equal(researchRouteGuard(),true);
 }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;window.HTMLAnchorElement.prototype.click=click;disposeResearch();restoreExport();delete globalThis.confirm;dom.window.close();}
});

test('formula workflow keeps editable text and never claims a copy succeeded when clipboard fails',async()=>{
 const {dom,ctx,notices}=setup();
 try{mountResearch(ctx);$('[data-mode="formula"]').click();input('[data-formula]','\\alpha + \\beta');assert.equal($('[data-formula]').value,'\\alpha + \\beta');$('[data-formula-token="0"]').click();assert.equal($('[data-formula]').value,'\\alpha + \\beta \\frac{a}{b}');assert.equal(document.querySelector('[data-formula-token="0"]').textContent,'分式');$('[data-action="formula-copy"]').click();await Promise.resolve();assert.match(notices.at(-1),/无法自动复制/);assert.doesNotMatch(notices.join(' '),/公式已复制/);Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('denied');}},configurable:true});$('[data-action="formula-copy"]').click();await new Promise(resolve=>setTimeout(resolve,0));assert.match(notices.at(-1),/复制未成功/);assert.doesNotMatch(notices.join(' '),/公式已复制/);$('[data-mode="basic"]').click();$('[data-mode="formula"]').click();assert.equal($('[data-formula]').value,'\\alpha + \\beta \\frac{a}{b}');}finally{disposeResearch();dom.window.close();}
});

test('research mode, chart type, input tabs and formula insertion preserve the selected keyboard control',()=>{
 const {dom,ctx}=setup();
 try{
  mountResearch(ctx);const activate=selector=>{const node=$(selector);assert.ok(node,selector);node.focus({preventScroll:true});node.click();assert.equal(document.activeElement,$(selector),'Focus lost after '+selector);};
  activate('[data-mode="formula"]');activate('[data-formula-preset="1"]');activate('[data-formula-token="0"]');assert.match($('[data-formula]').value,/frac/);activate('[data-mode="basic"]');activate('[data-tab="paste"]');activate('[data-tab="manual"]');activate('[data-type="line"]');activate('[data-mode="pro"]');assert.ok($('.dashboard').style.minHeight);
 }finally{disposeResearch();dom.window.close();}
});

test('literature filters and reading views remain in place, while explicit note editing focuses without scrolling',()=>{
 const {dom,ctx}=setup(),paper=validatePaper({id:'stable-paper',title:'原位阅读',authors:'作者',year:'2025',text:'真实原文正文',scope:'full',tags:[],notes:[{id:'n1',text:'已保存笔记',location:'研究方法'}],status:'unread'});
 try{
  localStorage.setItem(literatureKey,JSON.stringify([paper]));mountLiterature(ctx);const filter=$('[data-lit-status="read"]');filter.focus({preventScroll:true});filter.click();assert.equal(document.activeElement,filter);assert.match($('#lit-count').textContent,/0 篇/);const query=$('#lit-query');query.focus({preventScroll:true});input('#lit-query','不存在的主题');assert.equal(document.activeElement,query);
  mountLiteratureReader(paper.id,ctx);for(const tab of ['notes','text']){const button=$('[data-read-tab="'+tab+'"]');button.focus({preventScroll:true});button.click();assert.equal(document.activeElement,button);}
  $('[data-read-tab="notes"]').click();const focusCalls=[],original=$('#note-text').focus;$('#note-text').focus=function(options){focusCalls.push(options);return original.call(this,options);};$('[data-edit-note="n1"]').click();assert.deepEqual(focusCalls,[{preventScroll:true}]);assert.equal($('#note-text').value,'已保存笔记');assert.ok($('.dashboard').style.minHeight);
 }finally{clearEditor();dom.window.close();}
});
