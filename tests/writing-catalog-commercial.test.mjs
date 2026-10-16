import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {catalog,catalogNav,writingHeading,retainWritingCatalog} from '../dist/workspace/writing-catalog.mjs';

test('writing catalog preserves all eleven real routes and groups while giving each capability its own output and SVG',()=>{
 const dom=new JSDOM(catalogNav('writing'));try{
  const doc=dom.window.document,links=[...doc.querySelectorAll('.capability-card')];assert.equal(links.length,11);assert.deepEqual(links.map(link=>link.getAttribute('href')),catalog.map(([key])=>'#tool/'+key));assert.equal(doc.querySelectorAll('#writing-capabilities').length,1);assert.ok(doc.querySelector('.writing-catalog.writing-capabilities.writing-catalog-commercial'));
  assert.deepEqual([...doc.querySelectorAll('.capability-group-title strong')].map(node=>node.textContent),['论文与报告','研究准备']);
  const paths=new Set();for(const link of links){assert.ok(link.querySelector('.capability-symbol svg[aria-hidden="true"]'));assert.ok(link.querySelector('.capability-output').textContent.trim());assert.ok(link.querySelector('.capability-label').textContent.trim());paths.add(link.querySelector('.capability-symbol path').getAttribute('d'));assert.equal(link.querySelector('button'),null);}
  assert.equal(paths.size,11);const analysis=doc.querySelector('a[href="#tool/analysis"]');assert.match(analysis.textContent,/分析计划/);assert.doesNotMatch(analysis.textContent,/检验结果|统计结果|计算结果/);assert.equal(doc.querySelectorAll('[aria-current="page"]').length,1);assert.equal(doc.querySelector('[aria-current="page"]').getAttribute('href'),'#tool/writing');
 }finally{dom.window.close();}
});

test('recommended workflow is a real start link with five descriptive steps and an explicitly illustrative document preview',()=>{
 const dom=new JSDOM(catalogNav('writing'));try{const doc=dom.window.document;assert.equal(doc.querySelector('.writing-recommendation-cta').getAttribute('href'),'#tool/writing');assert.deepEqual([...doc.querySelectorAll('.writing-recommendation-steps li>b')].map(node=>node.textContent),['基础信息','资料补充','文献确认','提纲确认','版本预览']);assert.match(doc.querySelector('.writing-recommendation-preview').getAttribute('aria-label'),/示意，并非已生成成果/);assert.match(doc.querySelector('.writing-preview-paper').textContent,/结构示意/);assert.equal(doc.querySelector('.writing-recommendation [aria-current="step"]'),null);assert.equal(doc.querySelector('.writing-recommendation img'),null);}finally{dom.window.close();}
});

test('catalog retention restores one current task when returning to writing without marking the promotional CTA current',()=>{
 const dom=new JSDOM('<main>'+catalogNav('article')+'</main>');const originalDocument=globalThis.document;globalThis.document=dom.window.document;try{const main=globalThis.document.querySelector('main'),previous=main.firstElementChild;main.innerHTML=catalogNav('writing');retainWritingCatalog(previous,main.firstElementChild,null);assert.equal(main.querySelectorAll('[aria-current="page"]').length,1);assert.ok(main.querySelector('.capability-card[href="#tool/writing"][aria-current="page"]'));assert.equal(main.querySelector('.writing-recommendation-cta').hasAttribute('aria-current'),false);}finally{globalThis.document=originalDocument;dom.window.close();}
});

test('writing heading keeps the unified banner while using the approved writing-focused title',()=>{
 const dom=new JSDOM(writingHeading());try{const doc=dom.window.document;assert.ok(doc.querySelector('.writing-hero.writing-landing-hero'));assert.equal(doc.querySelector('h1').textContent,'从一个题目，开始你的论文');assert.match(doc.body.textContent,/整理研究资料、搭建论文结构，让每一步写作都有清晰的方向/);assert.equal(doc.querySelector('a[href="#tool/writing"]').textContent.includes('开始毕业论文'),true);}finally{dom.window.close();}
});

test('commercial catalog style keeps large preview on landing only and includes reduced motion and container fallback',async()=>{
 const css=await readFile(new URL('../dist/workspace/writing-catalog-commercial.css',import.meta.url),'utf8');assert.match(css,/\.writing-capabilities\.writing-catalog-commercial \.writing-recommendation-preview[^{]*\{display:none\}/);assert.match(css,/\.writing-landing \.writing-catalog-commercial \.writing-recommendation-preview\{/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);assert.match(css,/@container writing-catalog \(max-width:550px\)/);assert.doesNotMatch(css,/url\(['"]?https?:/);
});
