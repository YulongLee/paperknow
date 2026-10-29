import {mountLiteratureLanding} from '../dist/workspace/literature-pages.mjs';
import {installGuestExportSession,waitForExport} from './fixtures/artifact-session.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {validatePaper,literatureKey} from '../dist/workspace/literature-model.mjs';
function setup(){
 const dom=new JSDOM('<main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://example.test/workspace.html#category/research'});
 for(const key of ['window','document','localStorage','FormData','location','AbortController','DOMParser','XMLSerializer'])globalThis[key]=dom.window[key];
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true,writable:true});
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{};document.querySelector('dialog').close=()=>{};
 const notices=[],ctx={notify:value=>notices.push(value),modal:(_,html)=>{document.querySelector('#workspace-dialog-body').innerHTML=html;}};
 return {dom,ctx,notices};
}
const $=s=>document.querySelector(s);
const until=async check=>{for(let i=0;i<120;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.ok(check(),'界面未达到预期状态');};
const input=(s,value)=>{const el=$(s);el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));};
setup();
const {mountLiterature,mountLiteratureReader,openLiteratureSearch}=await import('../dist/workspace/literature.mjs');
const {mountResearch,disposeResearch,researchHasWork,researchRouteGuard}=await import('../dist/workspace/research.mjs');
const {clearEditor}=await import('../dist/workspace/edit-guard.mjs');

test('AI reading has separate feature links while library and search preserve saved papers',()=>{
 const {dom,ctx}=setup(),paper=validatePaper({id:'paper-refresh',title:'真实文献 <script>x</script>',authors:'用户作者',year:'2025',text:'可核对的原文正文',scope:'full',tags:['教育研究'],notes:[],status:'unread'});
 try{
  localStorage.setItem(literatureKey,JSON.stringify([paper]));mountLiteratureLanding(ctx);
  assert.deepEqual([...document.querySelectorAll('.lit-feature-copy b')].map(node=>node.textContent),['我的文献','文献检索','文献研读','原文问答','文献翻译','文献综述']);assert.equal(document.querySelectorAll('.lit-feature-card').length,6);assert.equal($('.lit-table-scroll'),null);assert.equal(document.querySelector('script'),null);assert.match($('[data-reading-feature="search"]').getAttribute('href'),/view=search/);
  mountLiterature(ctx);assert.ok($('.lit-table-scroll'));openLiteratureSearch(ctx);assert.ok($('.writing-reference-search'));assert.equal($('[data-ref-local]'),null);assert.ok($('#lit-library'));assert.match($('#lit-rows').textContent,/真实文献/);
  $('[data-lit-import]').click();assert.ok($('#lit-upload'));assert.ok($('#lit-form'));
  mountLiteratureReader(paper.id,ctx);input('#note-text','根据原文记录自己的研究问题');$('#lit-note-form').dispatchEvent(new window.Event('submit',{cancelable:true}));const saved=JSON.parse(localStorage.getItem(literatureKey))[0];assert.equal(saved.notes[0].text,'根据原文记录自己的研究问题');assert.equal(saved.text,paper.text);assert.equal(document.querySelector('script'),null);assert.match($('#note-status').textContent,/已保存/);
 }finally{clearEditor();dom.window.close();}
});

test('research preserves chart save and professional descriptions across its three honest workflows',async()=>{
 const {dom,ctx,notices}=setup(),restoreExport=installGuestExportSession(),create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=window.HTMLAnchorElement.prototype.click;let blob;
 try{
  await mountResearch(ctx);assert.equal(document.querySelectorAll('.research-mode-cards [data-mode]').length,3);assert.equal(document.querySelectorAll('.research-workflow-strip li').length,0);$('[data-mode="data"]').click();assert.equal(document.querySelectorAll('.research-workflow-strip li').length,3);
  input('[data-option="title"]','用户真实图表');$('[data-action="save"]').click();assert.equal(JSON.parse(localStorage.getItem('paperknow-drafts'))[0].title,'用户真实图表');
  $('[data-mode="structure"]').click();$('[data-pro-type="9"]').click();input('[data-pro-description]','绘制电源、开关与电阻串联关系，并标注电流方向。');assert.equal(researchHasWork(),true);
  $('[data-mode="formula"]').click();$('[data-mode="structure"]').click();assert.match($('[data-pro-description]').value,/电源、开关与电阻/);assert.equal($('[data-pro-type="9"]').getAttribute('aria-pressed'),'true');assert.match($('[data-action="pro-generate"]').textContent,/AI 生成结构图/);assert.match($('.research-credit').textContent,/确认用量/);
  URL.createObjectURL=value=>{blob=value;return 'blob:research';};URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=()=>{};
  $('[data-action="pro-export"]').click();await waitForExport(()=>blob);assert.match(await blob.text(),/电子电路/);await waitForExport(()=>blob);assert.match(await blob.text(),/电流方向/);assert.equal(JSON.parse(localStorage.getItem('paperknow-drafts')).length,1);assert.doesNotMatch(notices.join(' '),/图表已生成|已扣费/);
  globalThis.confirm=()=>{throw Error('不应弹出离开确认');};assert.equal(researchRouteGuard(),true);
 }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;window.HTMLAnchorElement.prototype.click=click;disposeResearch();restoreExport();delete globalThis.confirm;dom.window.close();}
});

test('formula workbench keeps editable text and never claims a copy succeeded when clipboard fails',async()=>{
 const {dom,ctx,notices}=setup();
 try{await mountResearch(ctx);$('[data-mode="formula"]').click();await until(()=>!!$('[data-fs-editor]'));input('[data-fs-editor]','\\alpha + \\beta');const editor=$('[data-fs-editor]');editor.setSelectionRange(editor.value.length,editor.value.length);$('[data-fs-token="0"]').click();const inserted='\\alpha + \\beta\\frac{}{}';assert.equal(editor.value,inserted);assert.match($('[data-fs-token="0"]').textContent,/分数/);$('[data-fs-action="copy"]').click();await Promise.resolve();assert.match($('[data-fs-status]').textContent,/无法自动复制/);assert.doesNotMatch(notices.join(' '),/已复制/);Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('denied');}},configurable:true});$('[data-fs-action="copy"]').click();await new Promise(resolve=>setTimeout(resolve,0));assert.match($('[data-fs-status]').textContent,/复制未成功/);assert.doesNotMatch(notices.join(' '),/已复制/);$('[data-mode="data"]').click();$('[data-mode="formula"]').click();assert.equal($('[data-fs-editor]').value,inserted);}finally{disposeResearch();dom.window.close();}
});

test('research mode and data controls preserve focus, while formula insertions focus the unchanged editor without scrolling',async()=>{
 const {dom,ctx}=setup();
 try{
  await mountResearch(ctx);const activate=selector=>{const node=$(selector);assert.ok(node,selector);node.focus({preventScroll:true});node.click();assert.equal(document.activeElement,$(selector),'Focus lost after '+selector);};
  activate('[data-mode="formula"]');await until(()=>!!$('[data-fs-editor]'));const editor=$('[data-fs-editor]'),focusCalls=[],original=editor.focus;editor.focus=function(options){focusCalls.push(options);return original.call(this,options);};$('[data-fs-template="triangle"]').click();assert.equal(document.activeElement,editor);assert.equal($('[data-fs-editor]'),editor);$('[data-fs-token="0"]').click();assert.match(editor.value,/frac/);assert.deepEqual(focusCalls,[{preventScroll:true},{preventScroll:true}]);activate('[data-mode="data"]');activate('[data-tab="paste"]');activate('[data-tab="manual"]');activate('[data-type="line"]');activate('[data-mode="structure"]');assert.ok($('.dashboard').style.minHeight);
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

test('saved OpenAlex records preserve their actual provider and distinguish links from an imported full text',()=>{
 const {dom,ctx}=setup(),paper=validatePaper({id:'openalex-metadata',title:'开放题录',source:'openalex',sourceId:'W123456',url:'https://openalex.org/W123456',scope:'metadata',text:'',tags:[],notes:[],status:'unread'});
 try{localStorage.setItem(literatureKey,JSON.stringify([paper]));mountLiteratureReader(paper.id,ctx);assert.doesNotMatch($('.lit-source-info').textContent,/OpenAlex|题录来源|未导入本地文件/);assert.match($('.lit-source-info').textContent,/题录 · 全文未读取/);assert.equal($('.lit-source-info a').href,'https://openalex.org/W123456');assert.match($('.lit-read-notice').textContent,/尚未选定 AI 研读材料/);assert.match($('.lit-read-text').textContent,/选择正文或摘要范围/);assert.equal($('.lit-database-abstract'),null);}finally{clearEditor();dom.window.close();}
});

test('saved AMiner records show their source and abstract while keeping AI reading material unselected',()=>{
 const {dom,ctx}=setup(),paper=validatePaper({id:'aminer-metadata',title:'AMiner 学术题录',source:'aminer',sourceId:'507f1f77bcf86cd799439011',url:'https://www.aminer.cn/pub/507f1f77bcf86cd799439011',abstract:'实际提供的摘要 <script>unsafe()</script>',scope:'metadata',text:'',tags:[],notes:[],status:'unread',confirmed:false,fullTextRead:false});
 try{
  localStorage.setItem(literatureKey,JSON.stringify([paper]));mountLiteratureReader(paper.id,ctx);assert.doesNotMatch($('.lit-source-info').textContent,/AMiner|题录来源|未导入本地文件/);assert.match($('.lit-source-info').textContent,/题录 · 全文未读取/);assert.equal($('.lit-source-info a').href,paper.url);assert.match($('.lit-database-abstract p').textContent,/实际提供的摘要 <script>/);assert.equal(document.querySelector('script'),null);assert.match($('.lit-database-abstract small').textContent,/不会自动成为 AI 研读材料/);assert.match($('.lit-read-notice').textContent,/尚未选定 AI 研读材料/);assert.equal($('.lit-read-text .lit-ai-paragraph-label'),null);
  const saved=JSON.parse(localStorage.getItem(literatureKey))[0];assert.equal(saved.source,'aminer');assert.equal(saved.status,'unread');assert.equal(saved.scope,'metadata');assert.equal(saved.text,'');assert.equal(saved.confirmed,false);assert.equal(saved.fullTextRead,false);
 }finally{clearEditor();dom.window.close();}
});
test('saved PubMed and Semantic Scholar records retain honest source information and unread abstract scope',()=>{
 for(const [source,label,url]of [['pubmed','PubMed','https://pubmed.ncbi.nlm.nih.gov/12345678/'],['semantic_scholar','Semantic Scholar','https://www.semanticscholar.org/paper/1234567890abcdef']]){
  const {dom,ctx}=setup(),paper=validatePaper({id:source+'-metadata',title:label+' 学术题录',source,sourceId:'real-source-record',url,abstract:'实际来源摘要，尚未作为研读正文。',scope:'metadata',text:'',tags:[],notes:[],status:'unread',confirmed:false,fullTextRead:false});
  try{localStorage.setItem(literatureKey,JSON.stringify([paper]));mountLiteratureReader(paper.id,ctx);assert.ok(!$('.lit-source-info').textContent.includes(label+' · 在线题录，未读取全文'));assert.match($('.lit-source-info').textContent,/题录 · 全文未读取/);assert.equal($('.lit-source-info a').href,url);assert.match($('.lit-database-abstract').textContent,/不会自动成为 AI 研读材料/);assert.match($('.lit-read-notice').textContent,/尚未选定 AI 研读材料/);assert.equal($('.lit-read-text .lit-ai-paragraph-label'),null);if(source==='pubmed'){assert.equal($('.lit-data-use').open,false);assert.equal($('.lit-pubmed-notice a').closest('details').querySelector('summary').textContent,'数据使用说明');assert.equal($('.lit-pubmed-notice a').href,'https://www.ncbi.nlm.nih.gov/About/disclaimer.html');assert.equal($('.lit-pubmed-notice a').rel,'noopener noreferrer');}const saved=JSON.parse(localStorage.getItem(literatureKey))[0];assert.equal(saved.text,'');assert.equal(saved.scope,'metadata');assert.equal(saved.fullTextRead,false);assert.equal(saved.confirmed,false);}
  finally{clearEditor();dom.window.close();}
 }
});
test('PubMed disclaimer remains visible for an aggregated record whose primary provider is different',()=>{
 const {dom,ctx}=setup(),paper=validatePaper({id:'merged-pubmed',title:'聚合题录',source:'openalex',sourceId:'W123',url:'https://openalex.org/W123',sourceProvenance:[{source:'openalex',sourceId:'W123'},{source:'pubmed',sourceId:'12345678'}],scope:'metadata',text:'',tags:[],notes:[],status:'unread'});
 try{localStorage.setItem(literatureKey,JSON.stringify([paper]));mountLiteratureReader(paper.id,ctx);assert.equal($('.lit-pubmed-notice a').href,'https://www.ncbi.nlm.nih.gov/About/disclaimer.html');assert.match($('.lit-source-info').textContent,/题录 · 全文未读取/);assert.doesNotMatch($('.lit-source-info').textContent,/OpenAlex/);assert.equal($('.lit-data-use').open,false);}
 finally{clearEditor();dom.window.close();}
});
test('saved arXiv metadata shows submission and update dates, preprint scope and canonical PDF without auto-reading',()=>{
 const {dom,ctx}=setup(),paper=validatePaper({id:'arxiv-metadata',title:'An arXiv preprint',authors:'A. Author',source:'arxiv',arxivId:'2610.12345v2',sourceId:'2610.12345',publishedDate:'2026-10-18T09:30:00Z',updatedDate:'2026-10-19T10:00:00Z',categories:['cs.AI'],abstract:'Actual abstract <script>unsafe()</script>',scope:'metadata',text:'',tags:[],notes:[],status:'unread',confirmed:false,fullTextRead:false});
 try{
  localStorage.setItem(literatureKey,JSON.stringify([paper]));mountLiteratureReader(paper.id,ctx);assert.match($('.lit-source-info').textContent,/题录 · 全文未读取/);assert.doesNotMatch($('.lit-source-info').textContent,/题录来源|未导入本地文件/);assert.equal($('.lit-data-use').open,false);assert.match($('.lit-arxiv-metadata').textContent,/预印本.*未必经过同行评审.*2610.12345v2.*首次提交：2026-10-18（UTC）.*最近更新：2026-10-19（UTC）.*cs.AI/);assert.equal($('.lit-public-fulltext').href,'https://arxiv.org/pdf/2610.12345v2');assert.equal($('.lit-public-fulltext').rel,'noopener noreferrer');assert.match($('.lit-database-abstract p').textContent,/Actual abstract <script>/);assert.equal($('.lit-source-info script'),null);assert.match($('.lit-source-info').textContent,/Thank you to arXiv for use of its open access interoperability\./);assert.match($('.lit-read-notice').textContent,/尚未选定 AI 研读材料/);
  const saved=JSON.parse(localStorage.getItem(literatureKey))[0];assert.equal(saved.scope,'metadata');assert.equal(saved.status,'unread');assert.equal(saved.text,'');assert.equal(saved.confirmed,false);assert.equal(saved.fullTextRead,false);assert.equal(saved.lastReadAt,undefined);
 }finally{clearEditor();dom.window.close();}
});

test('saved database abstracts and public original links remain viewable without turning metadata into AI reading material',()=>{
 const {dom,ctx}=setup(),paper=validatePaper({id:'openalex-abstract',title:'题录与摘要',source:'openalex',sourceId:'W123457',url:'https://openalex.org/W123457',fullTextUrl:'https://repository.example.test/paper.pdf',abstract:'Database abstract <img src=x onerror=alert(1)>\nSecond paragraph.',scope:'metadata',text:'',tags:[],notes:[{id:'own-note',text:'自己的笔记'}],status:'unread'});
 try{
  localStorage.setItem(literatureKey,JSON.stringify([paper]));mountLiteratureReader(paper.id,ctx);assert.match($('.lit-database-abstract summary').textContent,/文献摘要（非全文）/);assert.match($('.lit-database-abstract p').textContent,/Database abstract <img/);assert.match($('.lit-database-abstract small').textContent,/不会自动成为 AI 研读材料/);assert.equal($('.lit-database-abstract img'),null);
  assert.equal($('.lit-public-fulltext').href,paper.fullTextUrl);assert.equal($('.lit-public-fulltext').target,'_blank');assert.equal($('.lit-public-fulltext').rel,'noopener noreferrer');assert.match($('.lit-source-info').textContent,/不会自动将全文加入研读材料/);assert.equal($('.lit-read-text .lit-ai-paragraph-label'),null);
  const saved=JSON.parse(localStorage.getItem(literatureKey))[0];assert.equal(saved.scope,'metadata');assert.equal(saved.text,'');assert.equal(saved.abstract,paper.abstract);assert.equal(saved.fullTextUrl,paper.fullTextUrl);assert.deepEqual(saved.notes,paper.notes);assert.equal(saved.status,'unread');
 }finally{clearEditor();dom.window.close();}
});

test('source information omits unsafe public links and does not invent missing database abstracts',()=>{
 const {dom,ctx}=setup();
 try{for(const fullTextUrl of ['javascript:alert(1)','data:text/html,unsafe','https://user:secret@example.test/private','']){
  const paper=validatePaper({id:'unsafe-oa',title:'无摘要题录',source:'openalex',sourceId:'W123458',fullTextUrl,scope:'metadata',text:'',tags:[],notes:[],status:'unread'});localStorage.setItem(literatureKey,JSON.stringify([paper]));mountLiteratureReader(paper.id,ctx);assert.equal($('.lit-public-fulltext'),null);assert.equal($('.lit-database-abstract'),null);assert.equal(document.querySelector('script'),null);assert.doesNotMatch($('.lit-source-info').innerHTML,/javascript:|data:text|user:secret/);
 }}finally{clearEditor();dom.window.close();}
});
