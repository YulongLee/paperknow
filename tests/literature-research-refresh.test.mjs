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
 const {dom,ctx,notices}=setup(),create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=window.HTMLAnchorElement.prototype.click;let blob;
 try{
  mountResearch(ctx);assert.equal(document.querySelectorAll('.research-mode-cards [data-mode]').length,3);assert.equal(document.querySelectorAll('.research-workflow-strip li').length,3);
  input('[data-option="title"]','用户真实图表');$('[data-action="save"]').click();assert.equal(JSON.parse(localStorage.getItem('paperknow-drafts'))[0].title,'用户真实图表');
  $('[data-mode="pro"]').click();$('[data-pro-type="9"]').click();input('[data-pro-description]','绘制电源、开关与电阻串联关系，并标注电流方向。');assert.equal(researchHasWork(),true);
  $('[data-mode="formula"]').click();$('[data-mode="pro"]').click();assert.match($('[data-pro-description]').value,/电源、开关与电阻/);assert.equal($('[data-pro-type="9"]').getAttribute('aria-pressed'),'true');assert.equal($('[data-action="pro-generate"]').textContent,'检查需求');assert.match($('.research-credit').textContent,/在线生成待开放/);
  URL.createObjectURL=value=>{blob=value;return 'blob:research';};URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=()=>{};
  $('[data-action="pro-export"]').click();assert.match(await blob.text(),/电子电路/);assert.match(await blob.text(),/电流方向/);assert.equal(JSON.parse(localStorage.getItem('paperknow-drafts')).length,1);assert.doesNotMatch(notices.join(' '),/图表已生成|已扣费/);
  globalThis.confirm=()=>false;assert.equal(researchRouteGuard(),false);
 }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;window.HTMLAnchorElement.prototype.click=click;disposeResearch();delete globalThis.confirm;dom.window.close();}
});

test('formula workflow keeps editable text and never claims a copy succeeded when clipboard fails',async()=>{
 const {dom,ctx,notices}=setup();
 try{mountResearch(ctx);$('[data-mode="formula"]').click();input('[data-formula]','\\alpha + \\beta');assert.equal($('#formula-preview').textContent,'\\alpha + \\beta');$('[data-formula-token="0"]').click();assert.equal($('[data-formula]').value,'\\alpha + \\beta \\frac{a}{b}');assert.equal(document.querySelector('[data-formula-token="0"]').textContent,'分式');$('[data-action="formula-copy"]').click();await Promise.resolve();assert.match(notices.at(-1),/无法自动复制/);assert.doesNotMatch(notices.join(' '),/公式已复制/);Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('denied');}},configurable:true});$('[data-action="formula-copy"]').click();await new Promise(resolve=>setTimeout(resolve,0));assert.match(notices.at(-1),/复制未成功/);assert.doesNotMatch(notices.join(' '),/公式已复制/);$('[data-mode="basic"]').click();$('[data-mode="formula"]').click();assert.equal($('[data-formula]').value,'\\alpha + \\beta \\frac{a}{b}');}finally{disposeResearch();dom.window.close();}
});
