import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createRevisionWorkflow} from '../dist/workspace/revision-workflow.mjs';

test('revision workflow changes its mode labels in place and never navigates into an unavailable result',()=>{
 const dom=new JSDOM('<main><div id="host"></div><textarea id="input">私有原文</textarea><section id="result"></section></main>'),doc=dom.window.document;
 let locations=0;doc.querySelector('#result').scrollIntoView=()=>locations++;
 const workflow=createRevisionWorkflow(doc.querySelector('#host'),{targets:{prepare:()=>doc.querySelector('#input'),result:()=>doc.querySelector('#result')}});
 try{
  const root=doc.querySelector('[data-revision-workflow]'),buttons=[...root.querySelectorAll('button')];
  buttons[3].click();assert.equal(locations,0);assert.equal(buttons[3].disabled,true);
  for(const mode of ['paragraph','dual','report']){workflow.update({mode,phase:'review',hasText:true});assert.deepEqual([...root.querySelectorAll('button')],buttons);assert.equal(root.dataset.mode,mode);}
  workflow.update({phase:'checking',hasText:true});assert.equal(root.dataset.currentStep,'2');assert.equal(buttons[2].disabled,true);assert.match(buttons[1].textContent,/添加并核对报告/);assert.doesNotMatch(root.textContent,/私有原文/);assert.doesNotMatch(JSON.stringify(workflow.getState()),/私有原文/);
  workflow.update({mode:'report',phase:'complete',hasText:true,hasTask:true,hasResult:true});buttons[3].click();assert.equal(locations,1);assert.equal(root.querySelectorAll('[aria-current="step"]').length,1);
 }finally{workflow.dispose();dom.window.close();}
});

test('a disposed or blocked revision workflow ignores navigation and late task updates',()=>{
 const dom=new JSDOM('<div id="host"></div><textarea id="input"></textarea>'),doc=dom.window.document,input=doc.querySelector('#input');let locations=0;input.scrollIntoView=()=>locations++;
 const workflow=createRevisionWorkflow(doc.querySelector('#host'),{targets:{prepare:()=>input}}),root=doc.querySelector('[data-revision-workflow]');
 try{
  workflow.update({phase:'blocked',hasText:true,hasTask:true,hasResult:true});assert.ok([...root.querySelectorAll('button')].every(button=>button.disabled));root.querySelector('button').click();assert.equal(locations,0);
  workflow.update({phase:'prepare'});workflow.dispose();root.querySelector('button').click();workflow.update({phase:'complete',hasResult:true});assert.equal(locations,0);assert.equal(root.dataset.phase,'prepare');
 }finally{workflow.dispose();dom.window.close();}
});
