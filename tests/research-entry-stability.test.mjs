import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('both research studios have render-blocking styles before the workspace entry, without loading their scripts eagerly',async()=>{
 const html=await readFile(new URL('../dist/workspace.html',import.meta.url),'utf8'),dom=new JSDOM(html),doc=dom.window.document;
 try{
  const app=doc.querySelector('script[src="/workspace/app.mjs"]');
  for(const [marker,file] of [['data-research-drawing-style','research-drawing-studio.css'],['data-formula-studio-style','research-formula-studio.css']]){
   const links=doc.querySelectorAll('link['+marker+']');assert.equal(links.length,1);const link=links[0];
   assert.equal(link.rel,'stylesheet');assert.equal(link.getAttribute('href'),'/workspace/'+file);assert.equal(link.media,'');assert.ok(link.compareDocumentPosition(app)&dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  }
  assert.equal(doc.querySelector('script[src$="research-drawing-studio.mjs"],script[src$="research-formula-studio.mjs"]'),null);
 }finally{dom.window.close();}
});

test('cold studio hosts and asynchronously rendered formula boxes retain reserved geometry',async()=>{
 const [shell,formula]=await Promise.all(['research-delivery.css','research-formula-studio.css'].map(file=>readFile(new URL('../dist/workspace/'+file,import.meta.url),'utf8')));
 const dom=new JSDOM('<style>'+shell+formula+'</style><div data-research-formula-host><div class="formula-studio"><div class="fs-template-equation"></div><div class="fs-preview"></div></div></div>');
 try{
  const doc=dom.window.document,style=node=>dom.window.getComputedStyle(node);
  assert.equal(style(doc.querySelector('[data-research-formula-host]')).minHeight,'720px');
  const tile=doc.querySelector('.fs-template-equation'),before=style(tile).height;tile.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
  assert.equal(before,'80px');assert.equal(style(tile).height,before);assert.equal(style(doc.querySelector('.fs-preview')).height,'320px');
  assert.match(shell,/@media\(prefers-reduced-motion:reduce\)[\s\S]*research-studio-spinner\{animation:none\}/);
 }finally{dom.window.close();}
});
