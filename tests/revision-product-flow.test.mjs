import {projectPickerOptions} from '../dist/workspace/project-directory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {esc,icon,formatDate} from '../dist/workspace/ui.mjs';
import {toolBanner,updateToolBannerWorkflow} from '../dist/workspace/tool-banner.mjs';
import {withStableView} from '../dist/workspace/view-stability.mjs';
import {documentExportButtons,bindDocumentExports} from '../dist/workspace/document-export.mjs';
import {mountRevisionAi} from '../dist/workspace/revision-ai.mjs';
import {revisionStrategy} from '../dist/workspace/revision-strategy.mjs';
import {openRevisionReport} from '../dist/workspace/revision-report.mjs';
import {revisionComparisonMarkup,openRevisionSources} from '../dist/workspace/revision-source-ui.mjs';
import {normalizeRevisionComparison,compareRevisionDocument} from '../dist/workspace/revision-comparison-model.mjs';
import {loadRevisionComparisonHandoff,hasRevisionComparisonHandoff} from '../dist/workspace/revision-comparison-handoff.mjs';
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
function fixture(t,{aigc=false,outputTransform=value=>value,exportDependencies,entryPreparation}={}){
 const dom=new JSDOM('<main class="dashboard"></main><dialog id="workspace-dialog"><div id="workspace-dialog-body"></div></dialog>',{url:'https://paperknow.test/workspace.html#category/'+(aigc?'aigc':'reduce'),runScripts:'outside-only'}),w=dom.window,$=selector=>w.document.querySelector(selector),notices=[],calls=[],downloads=[],jobs=new Map();let fail=false;
 globalThis.document=w.document;
 Object.assign(w,{projectPickerOptions},{withStableView,esc,icon,formatDate,toolBanner,updateToolBannerWorkflow,mountRevisionAi,revisionStrategy,openRevisionReport,revisionComparisonMarkup,openRevisionSources,normalizeRevisionComparison,compareRevisionDocument,loadRevisionComparisonHandoff,hasRevisionComparisonHandoff,normalizeConfirmedRevisionReport,reportSources,validateRevisionProtection,mountAigcDetection,ensureAigcStyle,documentExportButtons,bindDocumentExports:(...args)=>bindDocumentExports(...args,exportDependencies),...model,importWorkspaceDocument:async()=>{throw Error('No parsing expected');},documentImportContinuesInBackground:()=>false,keys:{drafts:'test-drafts'},projects:()=>[],list:key=>JSON.parse(w.localStorage.getItem(key)||'[]'),write:(key,rows)=>{if(fail)throw Error('Synthetic save failure');w.localStorage.setItem(key,JSON.stringify(rows));},recordTask:()=>{},download:(...args)=>downloads.push(args)});
 $('dialog').close=()=>{$('dialog').removeAttribute('open');$('dialog').dispatchEvent(new w.Event('close'));};w.confirm=()=>false;
 const ctx={mode:'reduce',notify:value=>notices.push(value),modal:(_title,html)=>{$('#workspace-dialog-body').innerHTML=html;$('dialog').setAttribute('open','');},api:async(path,data)=>{calls.push({path,data:data?structuredClone(data):data});if(path==='/auth/me')return{user:{id:'owner'}};if(path==='/tool-runs/capabilities')return{ready:true};if(path==='/tool-runs/quote')return{type:'agent',source:'credits',creditCost:10,title:'Synthetic quote',token:'quote',expiresAt:new Date(Date.now()+600000).toISOString()};if(path==='/tool-runs/jobs'){const parts=data.snapshot.text.split('\n\n'),output=outputTransform({text:'完整候选预览',paragraphs:data.snapshot.context.paragraphIds.map((id,i)=>({id,original:parts[i],revised:revised(parts[i]),action:'revise',reason:'调整段落衔接，并保留原有证据边界。'}))}),item={id:'job-'+(jobs.size+1),kind:'revision',operation:'rewrite',status:'completed',output,completedUnits:1,totalUnits:1};jobs.set(item.id,item);return{item};}if(jobs.has(path.split('/').at(-1)))return{item:jobs.get(path.split('/').at(-1))};throw Error('Unexpected API '+path);}};
 if(entryPreparation)w.localStorage.setItem('paperknow-revision-entry',JSON.stringify({reduce:entryPreparation}));
 w.eval(source+'\nwindow.revisionProduct={mountRevision,disposeRevision};');w.revisionProduct.mountRevision(ctx);
 t.after(()=>{fail=false;w.revisionProduct.disposeRevision();dom.window.close();});
 return{w,$,ctx,calls,notices,downloads,fail:value=>{fail=value;},draft:()=>JSON.parse(w.localStorage.getItem('test-drafts')||'[]')[0],input(selector,value){const el=$(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));},click(selector){assert.ok($(selector),selector);$(selector).click();},submit(selector){$(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));},create(){if(this.$('[data-reduction-path="direct"]'))this.click('[data-reduction-path="direct"]');this.click('[data-revision-input="paste"]');this.input('#revision-service-title','自有合成修改稿');this.input('#revision-service-text',paragraphs.join('\n\n'));this.submit('#revision-entry-form');assert.ok($('#revision-space'));},async generate(){this.click('[data-rev-ai-open]');await until(()=>!!$('[data-tj-consent]'));const box=$('[data-tj-consent]');box.checked=true;box.dispatchEvent(new w.Event('change',{bubbles:true}));this.click('[data-tj-start]');await until(()=>!!$('[data-tj-apply]')&&!$('[data-tj-apply]').disabled);},async apply(){this.click('[data-tj-apply]');await until(()=>!!this.draft().appliedAiJobs?.length);},pickParagraph(index){const node=$('#rev-paragraph');node.value=String(index);node.dispatchEvent(new w.Event('change',{bubbles:true}));}};
}
function prepareReport(f,{source='other'}={}){
 f.click('[data-rev-action="report"]');const select=f.$('[data-rr-source]');select.value=source;select.dispatchEvent(new f.w.Event('change',{bubbles:true}));f.input('[data-rr-text]','PRIVATE REPORT HEADER MUST NOT BE SAVED\n原文片段：'+paragraphs[1]);f.click('[data-rr-preview]');assert.ok(f.$('[data-rr-pick]'));f.click('[data-rr-pick]');
}

test('both product entries retain fixed plans and clearly separate creation, fee confirmation and generation',t=>{
 for(const aigc of [false,true]){const f=fixture(t,{aigc});assert.equal(f.$('.tool-banner h1').textContent,aigc?'降 AI 率':'降重复率');assert.equal(f.$('[data-revision-bundle-offers]'),null,'购买套餐集中在会员与用量，功能页只保留修改策略');assert.deepEqual([...f.w.document.querySelectorAll('[data-revision-plan]')].map(n=>n.dataset.revisionPlan),aigc?['strong','english','dual']:['strong','dual','bundle']);assert.match(f.$('[data-revision-service-action="start"]').textContent,aigc?/继续确认范围/:/确认重复依据/);f.create();assert.equal(f.calls.length,0);assert.ok(f.$('[data-rev-action="report"]'));assert.ok(f.$('[data-rev-ai-select]'));assert.match(f.$('[data-rev-ai-open]').textContent,/确认范围与费用/);assert.doesNotMatch(f.$('.dashboard').textContent,/qwen|deepseek|claude|降至\s*\d+\s*%|保证通过/i);}
});

test('explicit checkbox and numeric range selection persist in original document order and restore on reopening',t=>{
 const f=fixture(t);f.create();f.click('[data-rev-ai-select]');f.click('[data-rev-select-paragraph="p2"]');f.click('[data-rev-select-paragraph="p0"]');assert.deepEqual(f.draft().aiSelection,{scope:'selected',paragraphIds:['p0','p2']});assert.match(f.$('[data-rev-selection-count]').textContent,/已选 2 段/);f.input('[data-rev-range-from]','2');f.input('[data-rev-range-to]','3');f.click('[data-rev-range-select]');assert.deepEqual(f.draft().aiSelection.paragraphIds,['p1','p2']);const id=f.draft().id;f.w.revisionProduct.mountRevision(f.ctx,id);assert.equal(f.$('[data-rev-ai-scope]').value,'selected');assert.equal(f.$('[data-rev-select-paragraph="p0"]').checked,false);assert.equal(f.$('[data-rev-select-paragraph="p1"]').checked,true);assert.equal(f.calls.length,0);
});

test('source reduction requires an actual comparison or confirmed report while explicit direct reduction needs neither',async t=>{
 const f=fixture(t);assert.equal(f.$('[data-reduction-path="sources"]').getAttribute('aria-pressed'),'true');assert.equal(f.$('.revision-secondary-plans').open,false);
 f.create();f.click('[data-rev-action="source-path"]');f.click('[data-rev-ai-open]');assert.equal(f.calls.length,0);assert.match(f.$('[data-rev-selection-status]').textContent,/添加对照文章或导入查重报告/);
 f.click('[data-rev-action="direct-path"]');await f.generate();assert.equal(f.calls.filter(call=>call.path==='/tool-runs/jobs').length,1);assert.equal(f.$('.rev-source-metrics'),null);assert.match(f.$('.rev-source-empty').textContent,/未与其他文章比对/);
});

test('an explicitly chosen direct path stays direct when a restored preparation already contains imported comparison sources',async t=>{
 const comparison={version:1,sources:[{id:'existing-source',name:'已读取的对照文章',text:paragraphs[1]}]},f=fixture(t,{entryPreparation:{title:'已有检测的论文',text:paragraphs.join('\n\n'),comparison,reductionPath:'sources'}});
 assert.equal(f.$('[data-reduction-path="sources"]').getAttribute('aria-pressed'),'true');f.click('[data-reduction-path="direct"]');f.submit('#revision-entry-form');assert.equal(f.draft().reductionPath,'direct');assert.deepEqual(f.draft().comparison,comparison);await f.generate();assert.deepEqual(f.calls.find(call=>call.path==='/tool-runs/jobs').data.snapshot.materials,[]);
});

test('source article comparison selects real hits and candidate edits cannot change the accepted-text comparison until adoption',async t=>{
 const f=fixture(t);f.create();const original=f.draft().original;
 f.click('[data-rev-action="sources"]');f.input('#rev-source-name','合成对照文章');f.input('#rev-source-url','https://example.org/source');f.input('#rev-source-text','对照文章正文：'+paragraphs[1]);f.click('[data-source-confirm]');await until(()=>!f.$('dialog').open);
 assert.equal(f.draft().original,original);assert.equal(f.draft().reductionPath,'sources');assert.deepEqual(f.draft().aiSelection,{scope:'selected',paragraphIds:['p1'],origin:'comparison'});assert.match(f.$('.rev-source-metrics').textContent,/本次来源范围内/);assert.equal(f.$('[data-rev-ai-scope]').value,'selected');assert.equal(f.$('[data-rev-ai-scope] option[value="all"]').disabled,true);assert.equal(f.$('[data-rev-select-paragraph="p0"]').disabled,true);assert.equal(f.calls.length,0);
 f.pickParagraph(1);assert.match(f.$('.rev-source-evidence').textContent,/合成对照文章/);assert.match(f.$('.rev-source-evidence').textContent,/对照文章中的片段/);const baseline=compareRevisionDocument(f.draft());assert.equal(baseline.after.ratio,baseline.before.ratio);
 await f.generate();const request=f.calls.find(call=>call.path==='/tool-runs/jobs').data.snapshot;assert.equal(request.text,paragraphs[1]);assert.equal(request.materials.length,1);assert.match(request.materials[0].text,/第二部分说明授权材料/);assert.deepEqual(request.context.paragraphIds,['p1']);
 await f.apply();assert.equal(compareRevisionDocument(f.draft()).after.ratio,baseline.before.ratio,'unaccepted candidates never enter the comparison');f.click('[data-rev-action="accept"]');const compared=compareRevisionDocument(f.draft());assert.ok(compared.after.ratio<compared.before.ratio);assert.equal(f.draft().paragraphs[0].suggestion,paragraphs[0]);assert.equal(f.draft().paragraphs[2].suggestion,paragraphs[2]);assert.match(f.$('.rev-source-metrics').textContent,/(同一来源范围|已采纳稿)/);
 f.click('[data-rev-action="direct-path"]');f.click('[data-rev-ai-open]');await until(()=>!!f.$('[data-tj-new]'));f.click('[data-tj-new]');await until(()=>f.calls.filter(call=>call.path==='/tool-runs/quote').length===2);assert.deepEqual(f.calls.filter(call=>call.path==='/tool-runs/quote').at(-1).data.snapshot.materials,[]);assert.equal(f.draft().comparison.sources.length,1,'switching to direct keeps the reviewed sources');
});

test('failed source persistence keeps the previous manuscript and selected evidence until a successful explicit retry',async t=>{
 const f=fixture(t);f.create();const before=f.draft();f.click('[data-rev-action="sources"]');f.input('#rev-source-name','失败后重试的对照文章');f.input('#rev-source-text',paragraphs[2]);f.fail(true);f.click('[data-source-confirm]');await until(()=>/未能保存/.test(f.$('[data-source-error]').textContent));assert.equal(f.$('dialog').open,true);assert.deepEqual(f.draft(),before);assert.match(f.$('[data-source-existing]').textContent,/失败后重试/);f.fail(false);f.click('[data-source-confirm]');await until(()=>!f.$('dialog').open);assert.equal(f.draft().original,before.original);assert.deepEqual(f.draft().aiSelection.paragraphIds,['p2']);assert.equal(f.calls.length,0);
});

test('changing source evidence or processing path preserves accepted text but removes old AI qualification and alternatives',async t=>{
 for(const change of ['source','path']){
  const f=fixture(t);f.create();await f.generate();await f.apply();f.click('[data-rev-action="accept"]');const prior=f.draft(),body=prior.paragraphs[0].suggestion,reason=prior.paragraphs[0].reason;
  prior.paragraphs[0].aiCandidate={text:paragraphs[0]+' 这是旧依据生成的另存候选。',action:'revise',reason:'旧来源候选，不能继续归入新来源。'};f.w.localStorage.setItem('test-drafts',JSON.stringify([prior]));f.w.revisionProduct.mountRevision(f.ctx,prior.id);assert.ok(f.$('.rev-alternative-candidate'));
  if(change==='source'){f.click('[data-rev-action="sources"]');f.input('#rev-source-name','新的对照来源');f.input('#rev-source-text',paragraphs[0]);f.click('[data-source-confirm]');await until(()=>!f.$('dialog').open);}else f.click('[data-rev-action="source-path"]');
  const current=f.draft();assert.equal(current.paragraphs[0].suggestion,body);assert.equal(current.paragraphs[0].accepted,true);assert.equal(current.paragraphs[0].reason,reason);assert.equal(current.paragraphs[0].aiCandidate,null);assert.equal(current.paragraphs[0].aiAction,null);assert.equal(current.paragraphs[0].aiGeneratedText,null);assert.equal(current.aiJobStates.rewrite.itemId,prior.aiJobStates.rewrite.itemId);assert.equal(f.$('.rev-alternative-candidate'),null);assert.equal(f.$('.rev-candidate-status'),null);assert.match(f.$('.rev-stale-candidate').textContent,/旧 AI 结果不再作为本次来源的候选/);assert.equal(model.revisedText(current),model.revisedText(prior));
  if(change==='source'){f.click('[data-rev-ai-open]');await until(()=>!!f.$('[data-tj-preview]'));assert.equal(f.$('[data-tj-apply]').disabled,true);assert.match(f.$('.tool-job-notice').textContent,/输入已有修改/);assert.equal(f.calls.filter(call=>call.path==='/tool-runs/jobs').length,1,'source changes never auto-create another paid job');}
 }
});

test('returning from direct reduction to a confirmed report restores only the report-marked paragraph selection',async t=>{
 const f=fixture(t);f.create();prepareReport(f,{source:'vip'});f.click('[data-rr-confirm]');await until(()=>!f.$('dialog').open);f.click('[data-rev-action="direct-path"]');assert.equal(f.draft().aiSelection.scope,'all');f.click('[data-rev-action="source-path"]');assert.deepEqual(f.draft().aiSelection,{scope:'selected',paragraphIds:['p1'],origin:'report'});assert.match(f.$('.rev-ai-title h3').textContent,/报告标记段落/);assert.equal(f.$('[data-rev-ai-scope]').value,'selected');assert.equal(f.$('.rev-source-metrics'),null);await f.generate();assert.equal(f.calls.find(call=>call.path==='/tool-runs/jobs').data.snapshot.text,paragraphs[1]);
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
