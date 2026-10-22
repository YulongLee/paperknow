import {projectPickerOptions} from '../dist/workspace/project-directory.mjs';
import {thesisTemplatePanel,uploadThesisTemplate,thesisExportMetadata,openThesisTemplateChooser,thesisTemplateChooserOpen} from '../dist/workspace/thesis-template.mjs';
import {downloadDefaultThesisTemplate} from '../dist/workspace/document-export.mjs';
import {assessThesisEvidence} from '../dist/workspace/thesis-evidence.mjs';
import {writingQualityPanel} from '../dist/workspace/writing-quality-panel.mjs';
import {formatPresets,presetRules,ruleSummary,importFormatRules,exportFormatRules,suggestedFormatExclusions} from '../dist/workspace/format-presets.mjs';
import {createFormatReport,formatReportHtml} from '../dist/workspace/format-report.mjs';
import {captureDraftScope} from '../dist/workspace/state.mjs';
import {thesisEditorPresentation,restoreThesisEditorText,thesisEditorWordCount} from '../dist/workspace/thesis-editor-presentation.mjs';
import {isOutlineReferenceChapter} from '../dist/workspace/outline-word-budget.mjs';
import {presentThesisDocument,buildThesisBibliography} from '../dist/workspace/thesis-document.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {toolBanner} from '../dist/workspace/tool-banner.mjs';
import {withStableView} from '../dist/workspace/view-stability.mjs';
const source=(await readFile(new URL('../dist/workspace/format.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const thesisSource=(await readFile(new URL('../dist/workspace/thesis-online.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const documentExportSource=(await readFile(new URL('../dist/workspace/document-export.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
test('a document parse that finishes after disposal cannot redraw another account page',async()=>{
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.cn/workspace.html#account-draft/a',runScripts:'outside-only'}),w=dom.window;let resolveExample,parsed=false;
 Object.assign(w,{projectPickerOptions},{formatPresets,presetRules,ruleSummary,importFormatRules,exportFormatRules,suggestedFormatExclusions,createFormatReport,formatReportHtml,hasDraftScope:()=>false,withStableView,keys:{drafts:'d'},list:()=>[],defaultRules:()=>({}),loadFormatDocumentModule:async()=>({exampleDocx:()=>new Promise(resolve=>resolveExample=resolve),parseDocx:async()=>{parsed=true;return {paragraphs:[]};}}),esc:v=>String(v),toolBanner});
 w.eval(source.replace("import('./assets/format-document.js')",'loadFormatDocumentModule()')+'\nwindow.lifecycle={mountFormat,disposeFormat};');const pending=w.lifecycle.mountFormat({notify(){}});await new Promise(resolve=>setImmediate(resolve));w.lifecycle.disposeFormat();w.document.querySelector('.dashboard').innerHTML='<h1>另一账户的项目</h1>';resolveExample(new Uint8Array([1,2]));await pending;assert.equal(parsed,false);assert.equal(w.document.querySelector('h1').textContent,'另一账户的项目');dom.window.close();
});

test('real thesis polling only reads status and disposal prevents late account content from repainting another route',async()=>{
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.cn/workspace.html#thesis/t1',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,polls=new Map(),timers=new Set(),calls=[];let serial=0,delayDetail=false,resolveDetail;
 let item={id:'t1',version:1,title:'账户论文',profile:{level:'本科',discipline:'历史学',method:'文本分析'},snapshot:{title:'账户论文',profile:{level:'本科'},materials:[],references:[],outline:[]},status:'running',job:{status:'running',completedSections:0,totalSections:2},chapters:[{id:'c1',title:'第一章',text:'',status:'pending'}]};
 const json=value=>({ok:true,status:200,json:async()=>value});
 Object.assign(w,{projectPickerOptions},{captureDraftScope,thesisEditorPresentation,restoreThesisEditorText,thesisEditorWordCount,isOutlineReferenceChapter,presentThesisDocument,buildThesisBibliography,assessThesisEvidence,writingQualityPanel,thesisTemplatePanel,uploadThesisTemplate,thesisExportMetadata,openThesisTemplateChooser,thesisTemplateChooserOpen,downloadDefaultThesisTemplate,withStableView,AbortController,structuredClone,toolBanner,fetch:async(path,options)=>{calls.push({path,method:options.method});if(path==='/api/auth/me')return json({user:{id:'u1'}});if(path==='/api/capabilities')return json({thesis:{ready:true}});if(path==='/api/theses/t1'){if(delayDetail)return new Promise(resolve=>resolveDetail=()=>resolve(json({item})));return json({item});}throw Error(path);},setTimeout:(fn,delay)=>{if(delay===4000){const id=++serial;polls.set(id,fn);return id;}const timer=setTimeout(()=>{timers.delete(timer);fn();},delay);timers.add(timer);return timer;},clearTimeout:id=>{polls.delete(id);timers.delete(id);clearTimeout(id);}});
 try{
  w.eval('(function(){'+documentExportSource+'\nObject.assign(globalThis,{documentExportButtons,bindDocumentExports});})()');
  w.eval('(function(){'+thesisSource+'\nObject.assign(globalThis,{mountOnlineThesis,disposeOnlineThesis});})()');
  const cleanup=w.mountOnlineThesis({id:'t1'});await cleanup.ready;assert.ok(polls.size);
  item={...item,version:2,status:'failed',job:{status:'failed',completedSections:1,totalSections:2,error:'材料不足',canResume:true},chapters:[{id:'c1',title:'第一章',text:'已完成的真实正文',version:1,status:'saved'}]};
  await [...polls.values()][0]();assert.match(w.document.querySelector('.thesis-progress').textContent,/材料不足/);assert.equal(w.document.querySelector('[data-thesis-editor]').value,'已完成的真实正文');assert.ok(calls.every(call=>call.method==='GET'));assert.equal(polls.size,0);
  delayDetail=true;const next=w.mountOnlineThesis({id:'t1'});for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(resolveDetail);next();w.document.querySelector('.dashboard').innerHTML='<h1>另一个工作空间页面</h1>';resolveDetail();await next.ready;assert.equal(w.document.querySelector('.dashboard').textContent,'另一个工作空间页面');
 }finally{w.disposeOnlineThesis?.();timers.forEach(clearTimeout);dom.window.close();}
});
