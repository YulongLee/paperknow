import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {catalog,catalogNav,writingHeading,writingDetailHeading,retainWritingCatalog} from '../dist/workspace/writing-catalog.mjs';
import {toolBanner} from '../dist/workspace/tool-banner.mjs';
import {writingFeatureIdentities,writingFeatureKeys,getWritingFeatureIdentity,writingFeatureStyle} from '../dist/workspace/writing-feature-identities.mjs';

test('writing catalog preserves all ten real routes and groups while giving each capability its own output and SVG',()=>{
 const dom=new JSDOM(catalogNav('writing'));try{
  const doc=dom.window.document,links=[...doc.querySelectorAll('.capability-card')];assert.equal(doc.querySelector('[href="#tool/quick"]'),null);assert.equal(links.length,10);assert.deepEqual(links.map(link=>link.getAttribute('href')),catalog.map(([key])=>'#tool/'+key));assert.equal(doc.querySelectorAll('#writing-capabilities').length,1);assert.ok(doc.querySelector('.writing-catalog.writing-capabilities.writing-catalog-commercial'));
  assert.deepEqual([...doc.querySelectorAll('.capability-group-title strong')].map(node=>node.textContent),['论文与报告','研究准备']);
  const paths=new Set();for(const link of links){assert.ok(link.querySelector('.capability-symbol svg[aria-hidden="true"]'));assert.ok(link.querySelector('.capability-output').textContent.trim());assert.ok(link.querySelector('.capability-label').textContent.trim());paths.add(link.querySelector('.capability-symbol path').getAttribute('d'));assert.equal(link.querySelector('button'),null);}
  assert.equal(paths.size,10);assert.ok(doc.querySelector('.writing-independent-catalog'));const artPaths=new Set();for(const link of links){const key=link.dataset.writingTask,feature=writingFeatureIdentities[key],image=link.querySelector('.capability-art img');assert.ok(feature);assert.ok(image);assert.equal(image.getAttribute('src'),feature.art);assert.equal(image.getAttribute('width'),'160');assert.equal(image.getAttribute('height'),'160');assert.equal(image.getAttribute('loading'),'lazy');assert.equal(image.getAttribute('decoding'),'async');assert.equal(image.getAttribute('alt'),'');assert.equal(image.getAttribute('aria-hidden'),'true');assert.equal(link.querySelectorAll('a,button').length,0);assert.equal(link.getAttribute('style'),writingFeatureStyle(key));assert.ok(link.classList.contains('capability-tone-'+feature.tone));artPaths.add(image.getAttribute('src'));}assert.equal(artPaths.size,10);const analysis=doc.querySelector('a[href="#tool/analysis"]');assert.match(analysis.textContent,/真实数据.*描述统计报告/);assert.match(analysis.textContent,/核对统计与分析结果/);assert.doesNotMatch(analysis.textContent,/显著性检验|因果结论|自动验证/);assert.equal(doc.querySelectorAll('[aria-current="page"]').length,1);assert.equal(doc.querySelector('[aria-current="page"]').getAttribute('href'),'#tool/writing');
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


test('all writing task identities are distinct fixed product metadata with safe canonical aliases',()=>{
 assert.deepEqual(writingFeatureKeys,catalog.map(([key])=>key));assert.equal(Object.isFrozen(writingFeatureIdentities),true);assert.equal(Object.isFrozen(writingFeatureKeys),true);assert.equal(new Set(Object.values(writingFeatureIdentities).map(feature=>feature.tone)).size,10);
 for(const [key,title,group] of catalog){const feature=getWritingFeatureIdentity(key);assert.equal(feature.key,key);assert.equal(feature.title,title);assert.equal(feature.group,group);assert.equal(Object.isFrozen(feature),true);assert.equal(feature.art,`/workspace/assets/writing-${key}-v1.webp`);for(const color of [feature.accent,feature.soft,feature.ink])assert.match(color,/^#[0-9a-f]{6}$/);assert.match(writingFeatureStyle(key),/^--task-accent:#[0-9a-f]{6};--task-soft:#[0-9a-f]{6};--task-ink:#[0-9a-f]{6}$/);}
 assert.equal(getWritingFeatureIdentity('topic'),writingFeatureIdentities.idea);assert.equal(getWritingFeatureIdentity('constructor'),writingFeatureIdentities.writing);assert.equal(getWritingFeatureIdentity('<img src=x onerror=alert(1)>'),writingFeatureIdentities.writing);
});

test('each writing detail gets its own banner class and label without changing routes or the unified banner layout',()=>{
 for(const [key,title] of [...catalog,['topic','课题思路']]){const canonical=key==='topic'?'idea':key,dom=new JSDOM(writingDetailHeading(key));try{const doc=dom.window.document,banner=doc.querySelector('header.tool-banner');assert.ok(banner);assert.equal(banner.dataset.toolCategory,'writing');assert.ok(banner.classList.contains('writing-task-banner'));assert.ok(banner.classList.contains('writing-task-'+canonical));assert.equal(doc.querySelector('h1').textContent,title);assert.equal(doc.querySelector('.tool-banner-label').textContent,'AI 写作 · '+title);assert.equal(doc.querySelector('p').textContent,writingFeatureIdentities[canonical].description);assert.equal(doc.querySelector('.writing-back-link').getAttribute('href'),'#category/writing');assert.equal(doc.querySelectorAll('.tool-banner-scene').length,1);}finally{dom.window.close();}}
});

test('tool banner optional labels are escaped while all existing default labels remain unchanged',()=>{
 for(const [key,label] of [['writing','论文与科研 · AI 写作'],['home','工作空间 · 工作台'],['settings','个人与服务 · 设置中心']]){const dom=new JSDOM(toolBanner(key));try{assert.equal(dom.window.document.querySelector('.tool-banner-label').textContent,label);}finally{dom.window.close();}}
 const label='<img src=x onerror=alert(1)> & 安全标签',dom=new JSDOM(toolBanner('writing',{label}));try{assert.equal(dom.window.document.querySelector('.tool-banner-label').textContent,label);assert.equal(dom.window.document.querySelectorAll('img,script').length,0);}finally{dom.window.close();}
});
