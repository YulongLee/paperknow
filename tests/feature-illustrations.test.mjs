import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {featureIllustrations,resolveFeatureIllustration} from '../dist/workspace/feature-illustrations.mjs';
import {toolBanner} from '../dist/workspace/tool-banner.mjs';

test('artwork resolution is limited to fixed product identities and cannot use user metadata as an image URL',()=>{
 const dom=new JSDOM(toolBanner('literature',{feature:'https://evil.example/track',title:'<img src="https://evil.example/track">',extraClass:'"><script>bad()</script>'}));assert.equal(dom.window.document.querySelector('header').dataset.toolArt,'reading-library');assert.equal(dom.window.document.querySelector('script,img'),null);assert.match(dom.window.document.querySelector('h1').textContent,/<img/);assert.equal(resolveFeatureIllustration('ppt','reading-answer').key,'ppt-ai');assert.equal(resolveFeatureIllustration('writing','','writing-task-banner writing-task-proposal').key,'writing-proposal');assert.equal(resolveFeatureIllustration('settings'),null);dom.window.close();
});

test('every shipped feature artwork resolves to a real transparent WebP and generated assets stay within the page budget',async()=>{
 const css=await readFile(new URL('../dist/workspace/feature-illustrations.css',import.meta.url),'utf8'),paths=new Set();for(const entry of Object.values(featureIllustrations)){assert.match(entry.path,/^\/workspace\/assets\/[a-z0-9\/-]+\.webp$/);assert.ok(css.includes('data-tool-art="'+entry.key+'"'));assert.equal(resolveFeatureIllustration(entry.category,entry.key),entry);paths.add(entry.path);}
 let generatedBytes=0;for(const path of paths){const bytes=await readFile(new URL('../dist'+path,import.meta.url));assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.equal(bytes.toString('ascii',12,16),'VP8X');assert.ok(bytes[20]&16,'transparent alpha: '+path);assert.equal(bytes.readUIntLE(24,3)+1,640);assert.equal(bytes.readUIntLE(27,3)+1,640);if(path.includes('feature-art-v1')){assert.ok(bytes.length<200000,path);generatedBytes+=bytes.length;const thumbnail=await stat(new URL('../dist'+path.replace('.webp','-320.webp'),import.meta.url));assert.ok(thumbnail.size<80000,path);}}
 assert.ok(generatedBytes<2200000);assert.equal(Object.values(featureIllustrations).filter(v=>v.category==='literature').length,7);
});

test('illustrated banners retain heading actions and mobile, dark and reduced-motion support without fetching all artwork up front',async()=>{
 const dom=new JSDOM(toolBanner('research',{feature:'research-formula',actions:'<button id="continue">继续</button>'}));assert.equal(dom.window.document.querySelector('header').dataset.toolArt,'research-formula');assert.equal(dom.window.document.querySelector('#continue').textContent,'继续');assert.equal(dom.window.document.querySelector('header img'),null);assert.equal(dom.window.document.querySelector('.tool-banner-scene').getAttribute('aria-hidden'),'true');dom.window.close();const html=await readFile(new URL('../dist/workspace.html',import.meta.url),'utf8'),css=await readFile(new URL('../dist/workspace/feature-illustrations.css',import.meta.url),'utf8');assert.match(html,/feature-illustrations\.css/);assert.match(css,/@container workspace \(max-width:740px\)/);assert.match(css,/@media\(max-width:760px\)/);assert.match(css,/hub-theme-dark/);assert.match(css,/prefers-reduced-motion:reduce/);assert.doesNotMatch(css,/url\(['"]?https?:/);
});
