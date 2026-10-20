import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import JSZip from 'jszip';
import * as model from '../dist/workspace/presentation-model.mjs';
import * as parity from '../dist/workspace/presentation-parity-model.mjs';
import {withStableView} from '../dist/workspace/view-stability.mjs';
import {toolBanner} from '../dist/workspace/tool-banner.mjs';
import {esc,icon} from '../dist/workspace/ui.mjs';
import {captureDraftScope} from '../dist/workspace/state.mjs';
import {mountToolJobPanel} from '../dist/workspace/tool-job-panel.mjs';
import {exportPresentation} from '../src/presentation-export.js';
import {pptMasterDesignPlan,pptMasterVisibleContent,pptMasterSlideTask,parsePptMasterSlideOutput} from '../backend/ppt-master-model.mjs';
const source=(await readFile(new URL('../dist/workspace/presentation.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replace("import('./assets/presentation-export.js')",'loadPresentationExport()');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async check=>{for(let index=0;index<100;index++){if(check())return;await delay(4);}assert.ok(check(),'UI did not reach expected state');};
const initial={title:'Synthetic research',material:'Synthetic authorized evidence only.',prompt:'Use supplied evidence without invention.',pages:6,minutes:10,language:'中文',theme:'academic',degree:'本科',scenario:'通用汇报',author:'',school:'',advisor:'',notesMode:'concise',slides:[]};
function record(id,projectId='',mode='ai'){return{id,title:id,tool:'ppt',projectId,updatedAt:'2026-10-20T00:00:00Z',presentation:{...structuredClone(initial),title:id,projectId,autoSession:true,serviceMode:mode}};}
function fixture(t,{hash='#tool/ppt?mode=ai',rows=[],realPanel=false,extract=async()=>({text:'Synthetic imported full text.',warnings:[]})}={}){
 const dom=new JSDOM('<main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.test/workspace.html'+hash,runScripts:'outside-only'}),w=dom.window,notices=[],downloads=[],confirms=[],calls=[];let fail=false;
 w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 Object.assign(w,{...model,...parity,withStableView,toolBanner,esc,icon,captureDraftScope,hasDraftScope:()=>false,keys:{drafts:'drafts'},list:()=>JSON.parse(w.localStorage.getItem('drafts')||'[]'),write:(_key,value)=>{if(fail)throw Error('Synthetic quota');w.localStorage.setItem('drafts',JSON.stringify(value));},projects:()=>[{id:'a',name:'A'},{id:'b',name:'B'}],preferences:()=>({degree:'本科'}),recordTask:()=>{},download:async(...args)=>{downloads.push(args);return{message:'Saved'};},loadPresentationExport:async()=>({exportPresentation}),importWorkspaceDocument:extract,documentImportContinuesInBackground:()=>false,formatDate:()=>'',structuredClone,confirm:message=>{confirms.push(message);return true;},mountToolJobPanel:realPanel?mountToolJobPanel:options=>{w.lastPanel=options;return{dispose(){},open:async()=>{calls.push({action:'panel-open',snapshot:options.getSnapshot()});},inputChanged(){}};}});
 w.localStorage.setItem('drafts',JSON.stringify(rows));const ctx={notify:message=>notices.push(message),modal:(_title,html)=>{w.document.querySelector('#workspace-dialog-body').innerHTML=html;w.document.querySelector('dialog').open=true;}};
 w.eval(source+'\nwindow.pptParity={mountPresentation,disposePresentation,presentationHasWork,presentationRouteGuard};');
 const q=selector=>w.document.querySelector(selector),edit=(selector,value,type='input')=>{const node=q(selector);assert.ok(node,selector);node.value=value;node.dispatchEvent(new w.Event(type,{bubbles:true}));},click=selector=>{assert.ok(q(selector),selector);q(selector).click();};
 const f={w,ctx,q,edit,click,notices,downloads,confirms,calls,fail:value=>{fail=value;},rows:()=>JSON.parse(w.localStorage.getItem('drafts')||'[]'),mount:(...args)=>w.pptParity.mountPresentation(ctx,...args),snapshot:()=>w.lastPanel.getSnapshot(),seed(){edit('[data-field="title"]',initial.title);edit('[data-field="prompt"]',initial.prompt);edit('[data-field="material"]',initial.material);edit('[data-field="pages"]','6');}};
 f.mount();t.after(()=>{fail=false;w.pptParity.disposePresentation();w.close();});return f;
}

test('six real templates filter by complete independent attributes without inventing empty results',()=>{
 assert.equal(Object.keys(model.themes).length,6);assert.deepEqual(parity.presentationTemplateCatalog.map(row=>row.id),Object.keys(model.themes));
 assert.deepEqual(parity.filterPresentationTemplates({industry:'学术研究',style:'正式',color:'深蓝'}).map(row=>row.id),['formal']);
 assert.equal(parity.filterPresentationTemplates({style:'正式',color:'青绿'}).length,0);
 assert.equal(parity.filterPresentationTemplates({style:'all',color:'all'}).length,6);
});
test('custom outline parsing validates complete page titles and rejects mismatches or silent shortening',()=>{
 const titles=['封面','背景','问题','方法','结果','结束'];assert.deepEqual(parity.parsePresentationOutline(titles.join('\r\n')),titles);
 assert.throws(()=>parity.parsePresentationOutline('一\n二'),/6–30/);assert.throws(()=>parity.normalizePresentationOutline(titles,7),/数量/);assert.throws(()=>parity.normalizePresentationOutline([...titles.slice(0,5),'x'.repeat(121)]),/120/);
 const slides=model.buildSlides({...initial,outlineTitles:titles});assert.deepEqual(slides.map(row=>row.title),titles);assert.ok(slides.slice(1,-1).every(row=>row.body.startsWith('待补充')));
});
test('typed notes, author and outline roundtrip while historical snapshots stay unchanged',()=>{
 for(const mode of ['none','concise','detailed']){
  const deck={...initial,notesMode:mode,author:'Synthetic\r\nAuthor',outlineTitles:['Cover','Background','Question','Methods','Results','End']};deck.outlineDraft=deck.outlineTitles.join('\n');
  const snapshot=model.presentationSnapshot(deck,'ai');assert.equal(snapshot.context.notesMode,mode);assert.equal(snapshot.context.author,'Synthetic Author');assert.deepEqual(model.presentationSnapshot(model.restorePresentationSnapshot(snapshot,initial),'ai',mode==='detailed'?'premium':'basic'),snapshot);
 }
 const legacy={...initial};delete legacy.notesMode;const old=model.presentationSnapshot(legacy,'thesis','premium');assert.equal(old.context.notesMode,undefined);assert.deepEqual(model.presentationSnapshot(model.restorePresentationSnapshot(old,initial),'thesis','premium'),old);
 assert.throws(()=>model.presentationSnapshot({...initial,notesMode:'invented'}),/请选择/);assert.throws(()=>model.presentationSnapshot({...initial,outlineDraft:'unconfirmed'}),/尚未采用/);
});
test('adoption enforces confirmed titles and no-notes without changing the current deck',()=>{
 const deck={...initial,outlineTitles:['Cover','Background','Question','Methods','Results','End'],notesMode:'none'},output={slides:deck.outlineTitles.map((title,index)=>({title,body:'Authorized text',notes:'',layout:index?'content':'cover'}))};
 assert.equal(model.adoptPresentationOutput(output,deck).length,6);const before=structuredClone(deck);assert.throws(()=>model.adoptPresentationOutput({slides:output.slides.map((row,index)=>index===3?{...row,title:'Other'}:row)},deck),/提纲/);assert.throws(()=>model.adoptPresentationOutput({slides:output.slides.map(row=>({...row,notes:'Unwanted notes'}))},deck),/不生成备注/);assert.deepEqual(deck,before);
});
test('project entry and scene switching restore only the requested project own drafts',t=>{
 const f=fixture(t,{rows:[record('project-a-ai','a'),record('project-a-proposal','a','proposal')]});f.mount(undefined,'b');assert.equal(f.q('[data-field="title"]').value,'');f.seed();f.click('[data-action="generate"]');f.click('[data-action="save"]');assert.equal(f.rows().find(row=>row.title===initial.title).projectId,'b');f.click('[data-ppt-mode="proposal"]');assert.equal(f.q('[data-field="title"]').value,'');f.edit('[data-field="title"]','B proposal');f.click('[data-ppt-mode="ai"]');assert.equal(f.q('[data-field="title"]').value,initial.title);assert.equal(f.rows().find(row=>row.id==='project-a-ai').title,'project-a-ai');
});
test('late original job response preserves new input until explicit independent recovery',async t=>{
 const f=fixture(t);let release,requested=false;const pending=new Promise(resolve=>{release=resolve;}),snapshot=model.presentationSnapshot({...initial,title:'Recovered task'});
 f.ctx.api=async path=>{if(path==='/auth/me')return{user:{id:'owner'}};if(path==='/tool-runs/jobs/old-job'){requested=true;return pending;}throw Error('Unexpected call');};
 f.w.history.replaceState(null,'','#tool/ppt?job=old-job');f.mount();await until(()=>requested);f.edit('[data-field="title"]','New manual title');f.edit('[data-field="prompt"]','New manual requirements');release({item:{id:'old-job',kind:'presentation',operation:'ppt',snapshot}});await until(()=>!!f.q('[data-ppt-restore-job]'));assert.equal(f.q('[data-field="title"]').value,'New manual title');f.fail(true);f.click('[data-ppt-restore-job]');await until(()=>/未恢复/.test(f.q('[data-ppt-recovery-error]').textContent));assert.equal(f.q('[data-field="title"]').value,'New manual title');f.fail(false);f.click('[data-ppt-restore-job]');await until(()=>f.q('[data-field="title"]').value==='Recovered task');assert.equal(f.rows().length,2);assert.ok(f.rows().some(row=>row.presentation.title==='New manual title'));assert.ok(f.rows().some(row=>row.presentation.aiJob?.itemId==='old-job'));
});
test('late recovered task cannot cross a scene change',async t=>{
 const f=fixture(t);let release,requested=false;const pending=new Promise(resolve=>{release=resolve;});f.ctx.api=async path=>{if(path==='/auth/me')return{user:{id:'owner'}};requested=true;return pending;};f.w.history.replaceState(null,'','#tool/ppt?job=late');f.mount();await until(()=>requested);f.click('[data-ppt-mode="thesis"]');release({item:{id:'late',kind:'presentation',operation:'ppt',snapshot:model.presentationSnapshot(initial)}});await delay(15);assert.equal(f.q('[data-presentation-mode]').dataset.presentationMode,'thesis');assert.equal(f.q('[data-ppt-restore-job]'),null);assert.equal(f.q('[data-field="title"]').value,'');
});
test('late recovery and retry remain attached to the current panel across template and filter redraws',async t=>{
 const f=fixture(t);let release,requested=false;const pending=new Promise(resolve=>{release=resolve;}),snapshot=model.presentationSnapshot({...initial,title:'Recovered after redraw'});
 f.ctx.api=async path=>{if(path==='/auth/me')return{user:{id:'owner'}};if(path==='/tool-runs/jobs/redraw-job'){requested=true;return pending;}throw Error('Unexpected paid or unrelated call');};f.w.history.replaceState(null,'','#tool/ppt?job=redraw-job');f.mount();await until(()=>requested);const waiting=f.q('.ppt-ai-job');f.edit('[data-field="title"]','Preserved manual title');f.click('[data-ppt-template="ai-3"]');assert.equal(waiting.isConnected,false);assert.equal(f.q('.ppt-ai-job').hidden,false);release({item:{id:'redraw-job',kind:'presentation',operation:'ppt',snapshot}});await until(()=>!!f.q('[data-ppt-restore-job]'));assert.equal(f.q('.ppt-ai-job').hidden,false);const ready=f.q('.ppt-ai-job');f.edit('[data-ppt-filter="style"]','正式','change');assert.equal(ready.isConnected,false);assert.ok(f.q('[data-ppt-restore-job]'));f.fail(true);f.click('[data-ppt-restore-job]');await until(()=>/未恢复/.test(f.q('[data-ppt-recovery-error]').textContent));f.edit('[data-ppt-filter="color"]','深蓝','change');assert.match(f.q('[data-ppt-recovery-error]').textContent,/未恢复/);assert.equal(f.q('[data-field="title"]').value,'Preserved manual title');f.fail(false);f.click('[data-ppt-restore-job]');await until(()=>f.q('[data-field="title"]').value==='Recovered after redraw');assert.equal(f.q('[data-ppt-restore-job]'),null);assert.ok(f.rows().some(row=>row.presentation.title==='Preserved manual title'));assert.equal(f.calls.filter(row=>row.action==='panel-open').length,1);
});
test('delete auto-saves honestly with a recoverable complete page backup',async t=>{
 const f=fixture(t);f.seed();f.click('[data-action="generate"]');f.edit('[data-slide="body"]','Manual first-page content');f.edit('[data-slide="notes"]','Manual notes');f.click('[data-action="save"]');f.click('[data-action="remove"]');await delay(470);assert.match(f.confirms.at(-1),/自动保存.*备份/);assert.equal(f.rows()[0].presentation.slides.length,5);assert.equal(f.rows()[0].presentation.versions[0].slides[0].body,'Manual first-page content');f.click('[data-action="restore-version"]');f.click('[data-action="save"]');assert.equal(f.rows()[0].presentation.slides.length,6);assert.equal(f.rows()[0].presentation.slides[0].notes,'Manual notes');
});
test('outline edits are explicit, durable and never automatically submit a model task',t=>{
 const f=fixture(t);f.seed();f.click('[data-action="custom-outline"]');const titles=['Synthetic cover','Actual problem','Evidence scope','Method','Discussion','Question time'];f.edit('#ppt-outline-text',titles.join('\n'));assert.throws(()=>f.snapshot(),/尚未采用/);f.q('#ppt-custom-outline').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));assert.deepEqual(f.snapshot().context.outlineTitles,titles);assert.equal(f.calls.length,0);f.click('[data-action="generate"]');assert.deepEqual(f.rows()[0].presentation.outlineTitles,titles);assert.deepEqual([...f.w.document.querySelectorAll('[data-edit]')].map(button=>button.textContent.slice(2)),titles);f.click('[data-action="save"]');assert.deepEqual(f.rows()[0].presentation.slides.map(slide=>slide.title),titles);assert.equal(f.q('[data-edit="0"]').getAttribute('aria-current'),'page');
});
test('failed outline adoption retains entered titles without altering confirmed pages or outline',t=>{
 const f=fixture(t);f.seed();f.click('[data-action="custom-outline"]');f.edit('#ppt-outline-text',['One','Two','Three','Four','Five','Six','Seven'].join('\n'));f.fail(true);f.q('#ppt-custom-outline').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));assert.match(f.q('#ppt-outline-state').textContent,/暂未保存/);assert.equal(f.q('#ppt-outline-text').value.split('\n').length,7);assert.equal(f.q('[data-field="pages"]').value,'6');assert.throws(()=>f.snapshot(),/尚未采用/);
});
test('template filters preserve the selected theme and explicit preview uses its real palette',t=>{
 const f=fixture(t);f.seed();f.click('[data-ppt-template="ai-2"]');f.edit('[data-ppt-filter="style"]','正式','change');f.edit('[data-ppt-filter="color"]','青绿','change');assert.match(f.q('.ppt-template-count').textContent,/找到 0/);assert.equal(f.snapshot().context.theme,'focus');f.edit('[data-ppt-filter="color"]','all','change');f.click('[data-ppt-template-preview="indigo"]');assert.match(f.q('.ppt-parity-preview .ppt-slide').getAttribute('style'),/#6554A5/);f.click('#ppt-use-preview-theme');assert.equal(f.snapshot().context.theme,'indigo');assert.equal(f.rows()[0].presentation.theme,'indigo');
});
test('all scenes expose notes and author fields with real snapshot state and legacy premium compatibility',t=>{
 const f=fixture(t);for(const mode of ['ai','proposal','thesis']){if(mode!=='ai')f.click('[data-ppt-mode="'+mode+'"]');f.seed();f.edit('[data-field="author"]','Synthetic Owner');f.edit('[data-field="language"]','英文','change');f.edit('[data-field="notesMode"]','none','change');assert.equal(f.snapshot().context.notesMode,'none');assert.equal(f.snapshot().context.author,'Synthetic Owner');assert.equal(f.snapshot().language,'英文');assert.doesNotMatch(f.q('.dashboard').textContent,/联网搜索|AI 配图|docmee|qwen|deepseek/i);}f.click('[data-ppt-tier="premium"]');assert.equal(f.snapshot().context.notesMode,'detailed');assert.equal(f.q('[data-ppt-tier="basic"]').getAttribute('aria-pressed'),'false');
});
test('imported materials remain editable and are passed completely without a false source preview',async t=>{
 const f=fixture(t);const input=f.q('#ppt-file');Object.defineProperty(input,'files',{value:[{name:'Synthetic.txt',size:12}],configurable:true});input.dispatchEvent(new f.w.Event('change',{bubbles:true}));await until(()=>f.q('[data-field="material"]').value==='Synthetic imported full text.');f.edit('[data-field="title"]','Imported');f.edit('[data-field="material"]','User checked complete source text.');assert.equal(f.snapshot().text,'User checked complete source text.');assert.equal(f.snapshot().materials[0].text,f.snapshot().text);assert.equal(f.q('iframe'),null);
});
test('real fee panel quotes typed notes and outline but never pays on preview',async t=>{
 const f=fixture(t,{realPanel:true}),requests=[];f.seed();f.edit('[data-field="notesMode"]','none','change');f.ctx.api=async(path,data)=>{requests.push({path,data});if(path==='/auth/me')return{user:{id:'owner'}};if(path==='/tool-runs/capabilities')return{ready:true,presentation:{ready:true}};if(path==='/tool-runs/quote')return{type:'agent',source:'credits',creditCost:10,title:'Synthetic quote',token:'token',expiresAt:new Date(Date.now()+60000).toISOString()};throw Error('Paid start not permitted');};f.click('[data-action="ai-generate"]');await until(()=>!!f.q('[data-tj-consent]'));assert.equal(requests.find(row=>row.path==='/tool-runs/quote').data.snapshot.context.notesMode,'none');assert.equal(requests.some(row=>row.path==='/tool-runs/jobs'),false);assert.equal(f.q('[data-tj-start]').disabled,true);
});
test('all six basic PPTX exports contain actual theme colors, native text and independent author text',async()=>{
 for(const [id,theme]of Object.entries(model.themes)){
  const deck={...initial,theme:id,author:'Synthetic Author',slides:model.buildSlides(initial)},zip=await JSZip.loadAsync(await exportPresentation(deck)),xml=await zip.file('ppt/slides/slide1.xml').async('string');assert.match(xml,new RegExp(theme.accent));assert.match(xml,new RegExp(theme.dark));assert.match(xml,/作者：Synthetic Author/);assert.match(xml,/<p:sp>/);assert.doesNotMatch(xml,/<p:pic>/);
 }
});
test('printing exports complete escaped body with natural continuation instead of fixed-height overlapping pages',t=>{
 const f=fixture(t);f.seed();f.edit('[data-field="author"]','Print Author');f.click('[data-action="generate"]');const body='Long checked material <script>safe text</script>. '.repeat(24);f.edit('[data-slide="body"]',body);f.click('[data-action="print"]');const html=f.downloads[0][1],preview=new JSDOM(html);assert.equal(preview.window.document.querySelector('section p').textContent,body);assert.match(preview.window.document.querySelector('section').textContent,/作者：Print Author/);assert.equal(preview.window.document.querySelector('script'),null);assert.match(html,/min-height:167mm/);assert.doesNotMatch(html,/(?<!min-)height:167mm/);assert.match(html,/打印页数可能多于/);preview.window.close();
});
test('author metadata is visible and immutable on the generated cover, never leaked into other pages',()=>{
 const value={operation:'ppt',snapshot:{title:initial.title,language:'中文',mode:'ai',context:{pages:6,theme:'indigo',author:'Synthetic Author'},materials:[]}},slides=model.buildSlides(initial).map((slide,index)=>({...slide,id:'slide-'+(index+1),notes:''})),plan=pptMasterDesignPlan(value,slides);
 assert.equal(plan.palette.accent,'#6554A5');assert.deepEqual(plan.metadata,{author:'Synthetic Author'});assert.equal(pptMasterVisibleContent(slides[0],plan).find(row=>row.id==='presentation-author').text,'作者：Synthetic Author');assert.equal(pptMasterVisibleContent(slides[1],plan).some(row=>row.id==='presentation-author'),false);assert.equal(pptMasterSlideTask(value,slides[0],plan).context.design.metadata.author,'Synthetic Author');
 const visible=pptMasterVisibleContent(slides[0],plan),xml=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;'),svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" data-pptx-page-role="cover"><rect x="0" y="0" width="1280" height="720" fill="#FFFFFF"/>'+visible.map((row,index)=>{const footer=row.role==='footer',y=footer?670:30+index*145;return '<g id="'+row.id+'" data-pptx-bounds="50 '+y+' 1180 '+(footer?40:130)+'"><text x="65" y="'+(y+(footer?25:60))+'" font-family="Arial" font-size="'+(row.role==='title'?40:footer?16:24)+'" fill="#302A50">'+xml(row.text)+'</text></g>';}).join('')+'</svg>',material=pptMasterSlideTask(value,slides[0],plan).materials[0],result={text:JSON.stringify({complete:true,slide:slides[0],svg,sourceIds:[material.id]}),trace:[{tool:'read_material',status:'completed',materialId:material.id,offset:0,limit:material.text.length}]};
 assert.equal(parsePptMasterSlideOutput(result,value,slides[0],plan).svg,svg);assert.throws(()=>parsePptMasterSlideOutput({...result,text:result.text.replace('作者：Synthetic Author','作者：Different')},value,slides[0],plan),/不得省略或添加/);
 assert.throws(()=>pptMasterDesignPlan({...value,snapshot:{...value.snapshot,context:{...value.snapshot.context,author:'Bad\nAuthor'}}},slides),/单行/);
});
test('dedicated parity styles target presentation and modal classes with keyboard and narrow-screen rules',async()=>{
 const css=await readFile(new URL('../dist/workspace/presentation-parity.css',import.meta.url),'utf8');assert.match(css,/ppt-template-filters/);assert.match(css,/:focus-visible/);assert.match(css,/@media\(max-width:480px\)/);assert.doesNotMatch(css,/\.format-|\.revision-|\.detection-/);
});

