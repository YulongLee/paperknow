import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountAiPlaza,plazaProjects} from '../dist/workspace/ai-plaza.mjs';
import {workspaceLinks} from '../dist/workspace/interface.mjs';

function setup(){const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://paperknow.cn/workspace.html'});const root=dom.window.document.querySelector('#root');mountAiPlaza(root);return {dom,root};}

test('the directory presents original projects once each rather than splitting one repository into writing features',()=>{
 const {root}=setup();
 assert.deepEqual(plazaProjects.map(p=>[p.title,p.repository]),[['Scientific Agent Skills','K-Dense-AI/scientific-agent-skills'],['Humanizer','blader/humanizer']]);
 assert.equal(root.querySelectorAll('.ap-card').length,2);
 assert.equal(new Set(plazaProjects.map(p=>p.source)).size,2);
 for(const project of plazaProjects){const card=root.querySelector(`[data-ap-project="${project.id}"]`);assert.equal(card.querySelector('h2').textContent,project.title);assert.ok(card.textContent.includes(project.repository));assert.ok(card.textContent.includes(project.author));assert.ok(card.textContent.includes(project.description));}
});

test('each complete card is a native upstream repository link opening in a new tab without an intermediate page',()=>{
 const {root}=setup();
 for(const project of plazaProjects){
  const card=root.querySelector(`[data-ap-project="${project.id}"]`);
  assert.equal(card.localName,'a');assert.equal(card.href,`https://github.com/${project.repository}`);
  assert.equal(card.target,'_blank');assert.match(card.rel,/noopener/);assert.match(card.rel,/noreferrer/);
  assert.equal(card.getAttribute('referrerpolicy'),'no-referrer');assert.match(card.getAttribute('aria-label'),/新标签页打开/);
  assert.equal(card.querySelectorAll('a,button').length,0);
  assert.doesNotMatch(card.href,/\/tree\/|\/archive\/|\.zip(?:\?|$)|\/api\//);
 }
});

test('the introduction page contains no search, category wrapper, hosted download, installer or execution flow',()=>{
 const {root}=setup();
 assert.equal(root.querySelector('dialog,form,iframe,input,button,[download],[data-ap-detail],[data-ap-group],.ap-scenario,.ap-tags,.ap-use'),null);
 assert.doesNotMatch(root.textContent,/下载完整项目|解压并安装|固定版本|开始生成|扣除积分|解锁使用|适合/);
 assert.match(root.querySelector('.ap-sharing-note').textContent,/仅作介绍与链接分享/);
 assert.match(root.querySelector('.ap-sharing-note').textContent,/以原项目为准/);
});

test('remounting remains a simple project directory and preserves its workspace navigation route',()=>{
 const {root}=setup();mountAiPlaza(root);
 assert.equal(root.querySelectorAll('main').length,1);assert.equal(root.querySelectorAll('.ap-card').length,2);
 assert.ok(workspaceLinks.flatMap(([,links])=>links).some(([route])=>route==='category/ai-plaza'));
 assert.doesNotThrow(()=>mountAiPlaza(null));
});
