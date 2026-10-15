import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=(await readFile(new URL('../dist/workspace/format.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
test('a document parse that finishes after disposal cannot redraw another account page',async()=>{
 const dom=new JSDOM('<main class="dashboard"></main>',{url:'https://paperknow.cn/workspace.html#account-draft/a',runScripts:'outside-only'}),w=dom.window;let resolveExample,parsed=false;
 Object.assign(w,{keys:{drafts:'d'},list:()=>[],defaultRules:()=>({}),exampleDocx:()=>new Promise(resolve=>resolveExample=resolve),parseDocx:async()=>{parsed=true;return {paragraphs:[]};},esc:v=>String(v)});
 w.eval(source+'\nwindow.lifecycle={mountFormat,disposeFormat};');const pending=w.lifecycle.mountFormat({notify(){}});w.lifecycle.disposeFormat();w.document.querySelector('.dashboard').innerHTML='<h1>另一账户的项目</h1>';resolveExample(new Uint8Array([1,2]));await pending;assert.equal(parsed,false);assert.equal(w.document.querySelector('h1').textContent,'另一账户的项目');dom.window.close();
});
