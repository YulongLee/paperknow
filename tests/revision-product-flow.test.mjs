import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {esc,icon,formatDate} from '../dist/workspace/ui.mjs';
import {toolBanner} from '../dist/workspace/tool-banner.mjs';
import {withStableView} from '../dist/workspace/view-stability.mjs';
import {documentExportButtons,bindDocumentExports} from '../dist/workspace/document-export.mjs';
import {mountRevisionAi} from '../dist/workspace/revision-ai.mjs';
import {revisionStrategy} from '../dist/workspace/revision-strategy.mjs';
import {openRevisionReport} from '../dist/workspace/revision-report.mjs';
import {normalizeConfirmedRevisionReport,reportSources} from '../dist/workspace/revision-report-model.mjs';
import {validateRevisionProtection} from '../dist/workspace/revision-protection.mjs';
import {mountAigcDetection,ensureAigcStyle} from '../dist/workspace/aigc-detection.mjs';
import * as model from '../dist/workspace/revision-model.mjs';
import JSZip from 'jszip';
import {createWritingDocx,documentLines} from '../src/writing-document.js';
const source=(await readFile(new URL('../dist/workspace/revision.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const paragraphs=['本合成研究纳入 24 名参与者[1]，只描述给定材料中的现象，不构成普遍因果结论。','第二部分说明授权材料的整理步骤与证据边界，所有记录均用于功能验收，仍须人工核对。','第三部分保留 3.5 mg/mL 与公式 $x=2y$，讨论只限于本次给定材料[2]，不补造未知结果。'];
const revised=original=>original+' 本次调整仅改善表述衔接，证据范围保持原样。';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const until=async check=>{for(let i=0;i<100;i++){if(check())return;await tick();}assert.ok(check(),'UI did not settle');};
function fixture(t,{aigc=false,outputTransform=value=>value,exportDependencies}={}){
 const dom=new JSDOM('<main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.test/workspace.html#category/'+(aigc?'aigc':'reduce'),runScripts:'outside-only'}),w=dom.window,$=selector=>w.document.querySelector(selector),notices=[],calls=[],downloads=[],jobs=new Map();let fail=false;
 globalThis.document=w.document;
 Object.assign(w,{withStableView,esc,icon,formatDate,toolBanner,mountRevisionAi,revisionStrategy,openRevisionReport,normalizeConfirmedRevisionReport,reportSources,validateRevisionProtection,mountAigcDetection,ensureAigcStyle,documentExportButtons,bindDocumentExports:(...args)=>bindDocumentExports(...args,exportDependencies),...model,importWorkspaceDocument:async()=>{throw Error('No parsing expected');},documentImportContinuesInBackground:()=>false,keys:{drafts:'test-drafts'},projects:()=>[],list:key=>JSON.parse(w.localStorage.getItem(key)||'[]'),write:(key,rows)=>{if(fail)throw Error('Synthetic save failure');w.localStorage.setItem(key,JSON.stringify(rows));},recordTask:()=>{},download:(...args)=>downloads.push(args)});
 $('dialog').close=()=>{$('dialog').removeAttribute('open');$('dialog').dispatchEvent(new w.Event('close'));};w.confirm=()=>false;
 const ctx={mode:'reduce',notify:value=>notices.push(value),modal:(_title,html)=>{$('#workspace-dialog-body').innerHTML=html;$('dialog').setAttribute('open','');},api:async(path,data)=>{calls.push({path,data:data?structuredClone(data):data});if(path==='/auth/me')return{user:{id:'owner'}};if(path==='/tool-runs/capabilities')return{ready:true};if(path==='/tool-runs/quote')return{type:'agent',source:'credits',creditCost:10,title:'Synthetic quote',token:'quote',expiresAt:new Date(Date.now()+600000).toISOString()};if(path==='/tool-runs/jobs'){const parts=data.snapshot.text.split('\n\n'),output=outputTransform({text:'完整候选预览',paragraphs:data.snapshot.context.paragraphIds.map((id,i)=>({id,original:parts[i],revised:revised(parts[i]),action:'revise',reason:'调整段落衔接，并保留原有证据边界。'}))}),item={id:'job-'+(jobs.size+1),kind:'revision',operation:'rewrite',status:'completed',output,completedUnits:1,totalUnits:1};jobs.set(item.id,item);return{item};}if(jobs.has(path.split('/').at(-1)))return{item:jobs.get(path.split('/').at(-1))};throw Error('Unexpected API '+path);}};
 w.eval(source+'\nwindow.revisionProduct={mountRevision,disposeRevision};');w.revisionProduct.mountRevision(ctx);
 t.after(()=>{fail=false;w.revisionProduct.disposeRevision();dom.window.close();});
 return{w,$,ctx,calls,notices,downloads,fail:value=>{fail=value;},draft:()=>JSON.parse(w.localStorage.getItem('test-drafts')||'[]')[0],input(selector,value){const el=$(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));},click(selector){assert.ok($(selector),selector);$(selector).click();},submit(selector){$(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));},create(){this.click('[data-revision-input="paste"]');this.input('#revision-service-title','自有合成修改稿');this.input('#revision-service-text',paragraphs.join('\n\n'));this.submit('#revision-entry-form');assert.ok($('#revision-space'));},async generate(){this.click('[data-rev-ai-open]');await until(()=>!!$('[data-tj-consent]'));const box=$('[data-tj-consent]');box.checked=true;box.dispatchEvent(new w.Event('change',{bubbles:true}));this.click('[data-tj-start]');await until(()=>!!$('[data-tj-apply]')&&!$('[data-tj-apply]').disabled);},async apply(){this.click('[data-tj-apply]');await until(()=>!!this.draft().appliedAiJobs?.length);},pickParagraph(index){const node=$('#rev-paragraph');node.value=String(index);node.dispatchEvent(new w.Event('change',{bubbles:true}));}};
}
function prepareReport(f,{source='other'}={}){
 f.click('[data-rev-action="report"]');const select=f.$('[data-rr-source]');select.value=source;select.dispatchEvent(new f.w.Event('change',{bubbles:true}));f.input('[data-rr-text]','PRIVATE REPORT HEADER MUST NOT BE SAVED\n原文片段：'+paragraphs[1]);f.click('[data-rr-preview]');assert.ok(f.$('[data-rr-pick]'));f.click('[data-rr-pick]');
}

test('both product entries retain fixed plans and clearly separate creation, fee confirmation and generation',t=>{
 for(const aigc of [false,true]){const f=fixture(t,{aigc});assert.equal(f.$('.tool-banner h1').textContent,aigc?'降 AI 率':'降重复率');assert.deepEqual([...f.w.document.querySelectorAll('[data-revision-plan]')].map(n=>n.dataset.revisionPlan),aigc?['strong','english','dual']:['strong','dual','bundle']);assert.match(f.$('[data-revision-service-action="start"]').textContent,/继续确认范围/);f.create();assert.equal(f.calls.length,0);assert.ok(f.$('[data-rev-action="report"]'));assert.ok(f.$('[data-rev-ai-select]'));assert.match(f.$('[data-rev-ai-open]').textContent,/确认范围与费用/);assert.doesNotMatch(f.$('.dashboard').textContent,/qwen|deepseek|claude|降至\s*\d+\s*%|保证通过/i);}
});

test('explicit checkbox and numeric range selection persist in original document order and restore on reopening',t=>{
 const f=fixture(t);f.create();f.click('[data-rev-ai-select]');f.click('[data-rev-select-paragraph="p2"]');f.click('[data-rev-select-paragraph="p0"]');assert.deepEqual(f.draft().aiSelection,{scope:'selected',paragraphIds:['p0','p2']});assert.match(f.$('[data-rev-selection-count]').textContent,/已选 2 段/);f.input('[data-rev-range-from]','2');f.input('[data-rev-range-to]','3');f.click('[data-rev-range-select]');assert.deepEqual(f.draft().aiSelection.paragraphIds,['p1','p2']);const id=f.draft().id;f.w.revisionProduct.mountRevision(f.ctx,id);assert.equal(f.$('[data-rev-ai-scope]').value,'selected');assert.equal(f.$('[data-rev-select-paragraph="p0"]').checked,false);assert.equal(f.$('[data-rev-select-paragraph="p1"]').checked,true);assert.equal(f.calls.length,0);
});

test('the English entry plan persists through document creation and reaches the quote without automatic submission',async t=>{
 const f=fixture(t,{aigc:true});f.click('[data-revision-plan="english"]');f.create();assert.equal(f.draft().plan,'english');assert.equal(f.draft().mode,'reduce');assert.match(f.$('.rev-ai-title').textContent,/英文学术优化/);f.click('[data-rev-ai-open]');await until(()=>!!f.$('[data-tj-consent]'));const quote=f.calls.find(c=>c.path==='/tool-runs/quote');assert.equal(quote.data.snapshot.context.plan,'english');assert.equal(quote.data.snapshot.language,'en');assert.equal(f.calls.some(c=>c.path==='/tool-runs/jobs'),false);
});

test('selected generation sends only the checked complete original, preserves others, and still requires paragraph acceptance for export',async t=>{
 const f=fixture(t);f.create();f.click('[data-rev-ai-select]');f.click('[data-rev-select-paragraph="p1"]');await f.generate();const start=f.calls.find(c=>c.path==='/tool-runs/jobs');assert.equal(start.data.snapshot.context.scope,'selected');assert.deepEqual(start.data.snapshot.context.paragraphIds,['p1']);assert.equal(start.data.snapshot.text,paragraphs[1]);await f.apply();assert.equal(f.draft().paragraphs[0].suggestion,paragraphs[0]);assert.equal(f.draft().paragraphs[2].suggestion,paragraphs[2]);assert.equal(f.draft().paragraphs[1].accepted,false);assert.equal(model.revisedText(f.draft()),paragraphs.join('\n\n'));f.pickParagraph(1);assert.match(f.$('.rev-candidate-status').textContent,/调整段落衔接/);assert.equal(f.$('.rev-candidate-status b').textContent,'候选已进入编辑区 · 尚需人工核对');f.click('[data-rev-action="accept"]');assert.equal(f.$('.rev-candidate-status b').textContent,'本段修改已采纳');assert.doesNotMatch(f.$('.rev-candidate-status').textContent,/尚需人工核对/);f.click('[data-rev-action="export"]');f.click('#rev-export-confirm');assert.equal(f.downloads[0][1],[paragraphs[0],revised(paragraphs[1]),paragraphs[2]].join('\n\n'));
});

test('single-paragraph revision DOCX and PDF receive a separate single-line title while TXT remains accepted body only',async t=>{
 for(const format of ['docx','pdf']){
  const generated=[],files=[],body='The study describes the supplied observations without making an unsupported causal claim.',accepted=body+' The evidence boundary remains unchanged.';
  const f=fixture(t,{exportDependencies:{loadDocument:async()=>({createWritingDocx:async text=>{generated.push({format:'docx',text});return createWritingDocx(text);},createWritingPdf:async(text,font)=>{generated.push({format:'pdf',text,font});return new Uint8Array([1]);}}),loadFont:async()=>new Uint8Array([2]),downloadFile:async(...args)=>{files.push(args);return {message:'Saved'};}}});
  const doc=model.createRevision({title:'Actual study\r\nEnglish revision\u2028final',text:body,mode:'reduce'},'single-export','2026-10-20T00:00:00Z');
  f.create();f.w.localStorage.setItem('test-drafts',JSON.stringify([doc]));f.w.revisionProduct.mountRevision(f.ctx,doc.id);f.input('#rev-suggestion',accepted);f.click('[data-rev-action="accept"]');f.click('[data-rev-action="export"]');f.click('#rev-result-'+format);await until(()=>files.length===1);
  assert.equal(generated.length,1);assert.equal(generated[0].format,format);assert.equal(generated[0].text,'Actual study English revision final\n\n'+accepted);
  const lines=documentLines(generated[0].text);assert.deepEqual(lines.map(line=>line.level),[0,3,3]);assert.equal(lines[2].text,accepted);
  if(format==='docx'){
   const zip=await JSZip.loadAsync(files[0][1]),xml=await zip.file('word/document.xml').async('string'),document=new JSDOM(xml,{contentType:'application/xml'}).window.document,paragraphs=[...document.getElementsByTagName('w:p')];
   assert.equal(paragraphs[0].textContent,'Actual study English revision final');assert.match(paragraphs[0].innerHTML,/w:jc w:val="center"/);assert.equal(paragraphs[2].textContent,accepted);assert.doesNotMatch(paragraphs[2].innerHTML,/w:jc|<w:b\b|w:val="36"/);
  }else assert.deepEqual(generated[0].font,new Uint8Array([2]));
  f.click('#rev-export-confirm');assert.equal(f.downloads.length,1);assert.equal(f.downloads[0][1],accepted);assert.equal(f.draft().original,body);
 }
});

test('empty or invalid ranges never create a quote and failed selection persistence preserves its prior visible scope',t=>{
 const f=fixture(t);f.create();f.click('[data-rev-ai-select]');f.click('[data-rev-ai-open]');assert.match(f.$('[data-rev-selection-status]').textContent,/勾选/);assert.equal(f.calls.length,0);f.input('[data-rev-range-from]','3');f.input('[data-rev-range-to]','1');f.click('[data-rev-range-select]');assert.match(f.$('[data-rev-selection-status]').textContent,/有效/);f.fail(true);f.click('[data-rev-select-paragraph="p0"]');assert.equal(f.$('[data-rev-select-paragraph="p0"]').checked,false);assert.deepEqual(f.draft().aiSelection.paragraphIds,[]);assert.equal(f.calls.length,0);
});

test('report confirmation persists only verified excerpts and original IDs, selects them, and opens no paid task',async t=>{
 const f=fixture(t);f.create();const original=f.draft().original;prepareReport(f,{source:'cnki'});f.click('[data-rr-confirm]');await until(()=>!f.$('dialog').open);const saved=f.draft();assert.equal(saved.original,original);assert.equal(saved.reportAttachment.source,'cnki');assert.deepEqual(saved.reportAttachment.paragraphIds,['p1']);assert.equal(saved.reportAttachment.evidence[0].excerpt,paragraphs[1]);assert.equal(JSON.stringify(saved.reportAttachment).includes('PRIVATE REPORT HEADER'),false);assert.equal(saved.aiSelection.origin,'report');assert.equal(f.$('[data-rev-ai-scope]').value,'selected');assert.equal(f.$('[data-rev-select-paragraph="p1"]').checked,true);assert.match(f.$('.rev-report-entry').textContent,/知网（用户声明）/);assert.equal(f.calls.length,0);await f.generate();const snapshot=f.calls.find(c=>c.path==='/tool-runs/jobs').data.snapshot;assert.equal(snapshot.text,paragraphs[1]);assert.equal(JSON.stringify(snapshot).includes('PRIVATE REPORT HEADER'),false);assert.equal(snapshot.context.reportAttachment,undefined);
});

test('report storage failure retains dialog selection and cannot show successful attachment or change manuscript',async t=>{
 const f=fixture(t);f.create();const original=f.draft();prepareReport(f);f.fail(true);f.click('[data-rr-confirm]');await until(()=>/未能保存/.test(f.$('[data-rr-error]').textContent));assert.equal(f.$('dialog').open,true);assert.equal(f.$('[data-rr-pick]').checked,true);assert.equal(f.draft().reportAttachment,undefined);assert.equal(f.draft().original,original.original);assert.equal(f.$('[data-rr-confirm]').disabled,false);f.fail(false);f.click('[data-rr-confirm]');await until(()=>!f.$('dialog').open);assert.deepEqual(f.draft().reportAttachment.paragraphIds,['p1']);assert.equal(f.calls.length,0);
});

test('a stale restored report cannot silently keep its old generation selection',t=>{
 const f=fixture(t);f.create();const doc=f.draft();doc.reportAttachment={version:1,source:'other',paragraphIds:['p0'],evidence:[{paragraphId:'p0',excerpt:'This no longer equals the manuscript.',start:0,end:36}],confirmedAt:'2026-10-20T00:00:00.000Z'};doc.aiSelection={scope:'selected',paragraphIds:['p0'],origin:'report'};f.w.localStorage.setItem('test-drafts',JSON.stringify([doc]));f.w.revisionProduct.mountRevision(f.ctx,doc.id);assert.equal(f.$('[data-rev-select-paragraph="p0"]').checked,false);assert.match(f.$('[data-rev-selection-status]').textContent,/不一致/);f.click('[data-rev-ai-open]');assert.equal(f.calls.length,0);assert.match(f.$('.rev-report-entry').textContent,/重新核对/);
});

test('accepted manual edits remain intact while a new AI alternative waits for explicit load and re-acceptance',async t=>{
 const f=fixture(t);f.create();const manual=paragraphs[0]+' 这是用户核对后补充的人工表达。';f.input('#rev-suggestion',manual);f.click('[data-rev-action="accept"]');await f.generate();await f.apply();assert.equal(f.$('#rev-suggestion').value,manual);assert.equal(f.draft().paragraphs[0].accepted,true);assert.equal(f.draft().paragraphs[0].aiCandidate.text,revised(paragraphs[0]));assert.match(f.$('.rev-alternative-candidate').textContent,/当前编辑完整保留/);assert.equal(model.revisedText(f.draft()),[manual,...paragraphs.slice(1)].join('\n\n'));f.click('[data-rev-action="load-ai"]');assert.equal(f.$('#rev-suggestion').value,revised(paragraphs[0]));assert.ok(f.draft().versions.some(version=>version.paragraphs[0].suggestion===manual&&version.paragraphs[0].accepted));assert.equal(f.draft().paragraphs[0].accepted,false);assert.equal(model.revisedText(f.draft()),paragraphs.join('\n\n'));f.click('[data-rev-action="accept"]');assert.equal(model.revisedText(f.draft()),[revised(paragraphs[0]),...paragraphs.slice(1)].join('\n\n'));
});

test('retain is displayed with its actual reason and remains the unchanged original, rather than fabricated revision success',async t=>{
 const f=fixture(t,{outputTransform:out=>({...out,paragraphs:out.paragraphs.map((p,i)=>i===1?{...p,revised:p.original,action:'retain',reason:'本段材料边界已经明确，无需调整。'}:p)})});f.create();const scope=f.$('[data-rev-ai-scope]');scope.value='all';scope.dispatchEvent(new f.w.Event('change'));await f.generate();await f.apply();f.pickParagraph(1);assert.match(f.$('.rev-candidate-status').textContent,/建议保留原文.*无需改写/);assert.match(f.$('.rev-candidate-status').textContent,/本段材料边界已经明确/);assert.equal(f.$('#rev-reason').value,'本段材料边界已经明确，无需调整。');assert.equal(f.draft().paragraphs[1].suggestion,paragraphs[1]);assert.equal(f.draft().paragraphs[1].accepted,false);
});

test('an alternative cannot replace accepted manual content when its before-load version cannot be saved',async t=>{
 const f=fixture(t);f.create();const manual=paragraphs[0]+' 人工核对后的有效补充。';f.input('#rev-suggestion',manual);f.click('[data-rev-action="accept"]');await f.generate();await f.apply();const history=f.draft().versions.length;f.fail(true);f.click('[data-rev-action="load-ai"]');assert.equal(f.$('#rev-suggestion').value,manual);assert.equal(f.draft().paragraphs[0].accepted,true);assert.equal(f.draft().paragraphs[0].aiCandidate.text,revised(paragraphs[0]));assert.equal(f.draft().versions.length,history);assert.match(f.notices.join(''),/save failure/);
});

test('a changed protected token in one late paragraph rejects the whole UI adoption without partial candidates',async t=>{
 const f=fixture(t,{outputTransform:out=>({...out,paragraphs:out.paragraphs.map((p,i)=>i===2?{...p,revised:p.revised.replace('3.5 mg/mL','9.5 mg/mL')}:p)})});f.create();const scope=f.$('[data-rev-ai-scope]');scope.value='all';scope.dispatchEvent(new f.w.Event('change'));await f.generate();f.click('[data-tj-apply]');await until(()=>/整批尚未采用/.test(f.$('.tool-job-error')?.textContent||''));assert.equal(f.draft().appliedAiJobs,undefined);assert.ok(f.draft().paragraphs.every((p,i)=>p.suggestion===paragraphs[i]&&!p.aiCandidate&&!p.accepted));assert.equal(f.draft().aiJobStates.rewrite.appliedJobId,undefined);
});

test('revision-specific report and review styles remain scoped and provide narrow-screen fallbacks',async()=>{
 const css=await readFile(new URL('../dist/workspace/revision-detection-refresh.css',import.meta.url),'utf8'),selection=await readFile(new URL('../dist/workspace/revision-ai.css',import.meta.url),'utf8');assert.match(css,/\.dashboard\.revision-refresh \.rev-report-entry\{/);assert.match(css,/\.dashboard\.revision-refresh \.rev-alternative-candidate\{/);assert.match(css,/@media\(max-width:760px\).*rev-report-entry/s);assert.match(selection,/\.rev-ai-card \.rev-selection-list\{max-height:300px;overflow:auto/);assert.match(selection,/\.rev-ai-card \.rev-selection :is\(button,input\):focus-visible/);
});
