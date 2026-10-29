import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {formatFixture,until,exampleDocx,parseDocx} from './fixtures/format-ui.mjs';
import {checkFormatting} from '../dist/workspace/format-model.mjs';

test('format has exactly two upload inputs, three steps and one processing action without manual rule or service choices',async t=>{
 const f=await formatFixture(t);assert.equal(f.root.querySelectorAll('input[type=file]').length,2);assert.equal(f.root.querySelectorAll('[data-format-step-item]').length,3);assert.equal(f.root.querySelectorAll('[data-action="apply"]').length,1);assert.equal(f.$('[data-action="apply"]').disabled,true);assert.equal(f.root.querySelectorAll('select,input[type=checkbox],input[type=number],[data-template-choice],[data-format-service],[data-rule]').length,0);assert.equal(f.$('[data-format-result]').hidden,true);assert.equal(f.calls.length,0);
});

test('files automatically read template rules without touching the manuscript or submitting an AI task',async t=>{
 const f=await formatFixture(t),{original,target}=await f.ready();assert.equal(f.$('[data-format-workflow]').dataset.currentStep,'3');assert.equal(f.$('[data-action="apply"]').disabled,false);assert.equal(f.calls.length,0);const saved=f.getRows()[0];assert.equal(saved.formatting.rules.font,target.font);assert.equal(saved.formatting.rules.line,target.line);assert.deepEqual(Buffer.from(saved.formatting.original,'base64'),Buffer.from(original));assert.equal(saved.formatSample.name,'学校格式模板.docx');
});

test('one click verifies the DOCX, submits one AI review and delivers a faithful editable Word with no adoption or fee confirmation step',async t=>{
 const f=await formatFixture(t),{original,target}=await f.ready(),nav=f.$('[data-format-workflow]'),input=f.$('#format-file');f.click('[data-action="apply"]');f.click('[data-action="apply"]');await until(()=>f.$('[data-format-workflow]').dataset.phase==='complete');assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,1);assert.equal(f.$('[data-format-workflow]'),nav);assert.equal(f.$('#format-file'),input);assert.equal(f.$('[data-tj-consent]'),null);assert.equal(f.$('[data-tj-apply]'),null);assert.equal(f.$('[data-format-result]').hidden,false);f.click('[data-action="export"]');await until(()=>f.downloads.length===1);assert.match(f.downloads[0].name,/\.docx$/);const output=await parseDocx(f.downloads[0].content);assert.equal(checkFormatting(output,target).length,0);assert.deepEqual(output.paragraphs.map(p=>p.text),(await parseDocx(original)).paragraphs.map(p=>p.text));assert.deepEqual(Buffer.from(f.getRows()[0].formatting.original,'base64'),Buffer.from(original));assert.equal(f.getRows()[0].layoutComplete,true);assert.ok(f.snapshot().context.inputFingerprint);assert.equal(f.snapshot().context.templateName,'学校格式模板.docx');
});

test('queued and running review update in place and only saved completion unlocks the Word result',async t=>{
 const f=await formatFixture(t,{jobStatus:'queued'});await f.ready();const input=f.$('#format-sample-file'),steps=[...f.root.querySelectorAll('[data-format-step-item]')];await f.generate();await until(()=>f.$('[data-format-workflow]').dataset.phase==='queued');assert.equal(f.$('[data-format-result]').hidden,true);assert.equal(input.disabled,true);assert.equal(f.$('[data-action="apply"]').disabled,true);f.setStatus('running');await until(()=>f.$('[data-format-workflow]').dataset.phase==='running');assert.deepEqual([...f.root.querySelectorAll('[data-format-step-item]')],steps);assert.equal(f.$('#format-sample-file'),input);f.setStatus('completed');await until(()=>f.$('[data-format-workflow]').dataset.phase==='complete');assert.equal(f.$('[data-format-result]').hidden,false);assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,1);
});

for(const status of ['failed','cancelled'])test(status+' review retains both files without presenting an unfinished result as complete',async t=>{
 const f=await formatFixture(t,{jobStatus:status});await f.ready();await f.generate();await until(()=>f.$('[data-format-workflow]').dataset.phase==='failed');assert.equal(f.$('[data-format-result]').hidden,true);assert.ok(f.getRows()[0].formatting.original);assert.ok(f.getRows()[0].formatSample);assert.equal(f.getRows()[0].layoutComplete,false);
});

test('replacing the template invalidates the prior result, keeps the manuscript and never automatically starts another charged task',async t=>{
 const f=await formatFixture(t);const {original}=await f.ready();await f.generate();await until(()=>f.$('[data-format-workflow]').dataset.phase==='complete');const before=f.calls.filter(c=>c.path==='/tool-runs/jobs').length;await f.upload('template',await exampleDocx(),'另一份学校模板.docx');assert.equal(f.$('[data-format-result]').hidden,true);assert.equal(f.$('[data-action="apply"]').disabled,false);assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,before);assert.deepEqual(Buffer.from(f.getRows()[0].formatting.original,'base64'),Buffer.from(original));assert.equal(f.getRows()[0].formatSample.name,'另一份学校模板.docx');
});

test('saved files and completed output restore without another quote or task',async t=>{
 const f=await formatFixture(t);await f.ready();await f.generate();await until(()=>f.$('[data-format-workflow]').dataset.phase==='complete');const before=f.calls.length,id=f.getRows()[0].id;f.w.formatTest.disposeFormat();await f.w.formatTest.mountFormat(f.ctx,id);assert.equal(f.$('[data-format-result]').hidden,false);assert.equal(f.$('[data-format-workflow]').dataset.phase,'complete');assert.equal(f.calls.length,before);f.click('[data-action="original"]');await until(()=>f.downloads.length===1);assert.equal(f.downloads[0].name,'论文原件.docx');
});

test('an interrupted review recovers its saved task and produces a result without a second paid submission',async t=>{
 const f=await formatFixture(t,{jobStatus:'queued'});await f.ready();await f.generate();await until(()=>f.$('[data-format-workflow]').dataset.phase==='queued');const id=f.getRows()[0].id;f.w.formatTest.disposeFormat();f.setStatus('completed');await f.w.formatTest.mountFormat(f.ctx,id);await until(()=>f.$('[data-format-workflow]').dataset.phase==='complete');assert.equal(f.calls.filter(c=>c.path==='/tool-runs/jobs').length,1);assert.equal(f.calls.filter(c=>c.path==='/tool-runs/quote').length,1);
});

test('unreadable template or invalid input reports a specific reason and never calls the model',async t=>{
 const f=await formatFixture(t);await f.upload('template',new Uint8Array([1,2,3]),'坏模板.docx');assert.equal(f.$('[data-action="apply"]').disabled,true);assert.equal(f.$('[data-format-error]').hidden,false);assert.equal(f.calls.length,0);await f.upload('paper',await exampleDocx(),'不支持.pdf');assert.match(f.$('[data-format-error]').textContent,/DOCX/);assert.equal(f.calls.length,0);
});

test('a failed persistence boundary blocks new model billing while retaining the uploaded bytes in memory',async t=>{
 const f=await formatFixture(t);await f.ready();f.setStorageFailure(true);await f.generate();await until(()=>!f.$('[data-format-error]').hidden);assert.equal(f.calls.length,0);assert.equal(f.$('[data-format-result]').hidden,true);assert.equal(f.w.formatTest.formatRouteGuard(),false);f.setStorageFailure(false);assert.equal(f.w.formatTest.formatRouteGuard(),true);
});

test('legacy formatted originals remain downloadable without calling AI or needing another template',async t=>{
 const original=await exampleDocx(),f=await formatFixture(t,{saved:[{id:'legacy',tool:'format',title:'历史排版',fileName:'历史原件.docx',formatting:{autoSession:true,original:Buffer.from(original).toString('base64'),applied:true,rules:{font:'宋体',size:12,line:1.5,indent:2,top:2.5,bottom:2.5,left:2.5,right:2.5,body:true,headings:true,margins:true,h1:16,h2:14,h3:12}}}]});assert.equal(f.$('[data-format-result]').hidden,false);assert.match(f.$('[data-format-result]').textContent,/已保存的排版结果/);assert.equal(f.calls.length,0);f.click('[data-action="export"]');await until(()=>f.downloads.length===1);assert.match(f.downloads[0].name,/\.docx$/);
});

test('account scoped drafts do not submit a non-durable AI job or write across storage scopes',async t=>{
 const f=await formatFixture(t,{scoped:true});await f.ready();assert.equal(f.$('[data-action="apply"]').disabled,true);assert.match(f.$('[data-format-error]').textContent,/独立格式排版/);assert.equal(f.calls.length,0);const before=f.getRows();f.setScope(false);f.w.formatTest.disposeFormat();assert.deepEqual(f.getRows(),before);
});

test('simplified layout styles are loaded, responsive and respect reduced motion',async()=>{const html=await readFile(new URL('../dist/workspace.html',import.meta.url),'utf8'),css=await readFile(new URL('../dist/workspace/format-simple.css',import.meta.url),'utf8');assert.match(html,/workspace\/format-simple\.css/);assert.match(css,/@media\(max-width:900px\)/);assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);assert.doesNotMatch(css,/url\(['"]?https?:/);});
