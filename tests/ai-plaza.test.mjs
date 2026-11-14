import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountAiPlaza,plazaSkills} from '../dist/workspace/ai-plaza.mjs';
import {workspaceLinks} from '../dist/workspace/interface.mjs';

const ids=['scientific-writing','literature-review','peer-review','citation-management','research-lookup','humanizer'];
function setup(){
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://paperknow.cn/workspace.html'});
 const root=dom.window.document.querySelector('#root'); mountAiPlaza(root); return {dom,root};
}
function input(dom,element,value){element.value=value;element.dispatchEvent(new dom.window.Event('input',{bubbles:true}));}
function cards(root){return [...root.querySelectorAll('[data-ap-grid] .ap-card')];}

test('广场展示六项上游开源 Skill 与固定版本',()=>{
 const {root}=setup();
 assert.deepEqual(new Set(plazaSkills.map(skill=>skill.id)),new Set(ids));
 assert.equal(cards(root).length,6);
 assert.equal(root.querySelector('[data-ap-count]').textContent,'6 个 Skill');
 assert.ok(!root.textContent.includes('PaperKnow 原创'));
 assert.match(root.querySelector('.ap-section-heading').textContent,/第三方开源项目/);
 assert.match(root.querySelector('.ap-section-heading').textContent,/未接入 PaperKnow 站内服务/);
 assert.match(root.querySelector('.ap-section-heading').textContent,/自行核对功能、效果与适用性/);
 assert.equal(root.querySelector('.ap-other'),null);
 for(const skill of plazaSkills){
  const button=root.querySelector(`[data-ap-detail="${skill.id}"]`);
  assert.ok(button,`${skill.id} 详情入口`);
  const card=button.closest('article');
  assert.ok(card.textContent.includes(skill.title));
  assert.ok(card.textContent.includes(skill.author));
  assert.match(card.textContent,/MIT/i);
  assert.match(skill.version,/^[a-f0-9]{40}$/);
  const repository=skill.id==='humanizer'?'https://github.com/blader/humanizer':'https://github.com/K-Dense-AI/scientific-agent-skills';
  const expectedSource=skill.id==='humanizer'?`${repository}/tree/${skill.version}`:`${repository}/tree/${skill.version}/skills/${skill.id}`;
  assert.equal(skill.source,expectedSource);
  assert.equal(skill.downloadUrl,`${repository}/archive/${skill.version}.zip`);
  assert.equal(skill.license,'MIT');
  button.click();
  const dialog=root.querySelector('[data-ap-dialog]');
  assert.ok(dialog.hasAttribute('open'));
  assert.ok(dialog.textContent.includes(skill.version.slice(0,12)));
  assert.match(dialog.textContent,/MIT/i);
  assert.match(dialog.textContent,/K-Dense|blader/i);
  const links=[...dialog.querySelectorAll('a[href]')].map(link=>link.getAttribute('href'));
  assert.ok(links.some(url=>/^https:\/\/github\.com\//.test(url)&&url.includes(skill.id)),`${skill.id} 的上游源码`);
  assert.ok(links.some(url=>/^https:\/\/github\.com\/.+\/archive\/[a-f0-9]{40}\.zip$/.test(url)),`${skill.id} 的固定版本上游项目压缩包`);
  assert.match(dialog.textContent,/整个|完整|项目|仓库/);
  assert.match(dialog.textContent,/第三方开源项目提供并维护/);
  assert.match(dialog.textContent,/仅整理分享，未接入站内服务/);
  assert.match(dialog.textContent,/自行核对功能、效果及适用性/);
  for(const link of dialog.querySelectorAll('a[target="_blank"]')) assert.match(link.rel,/noopener.*noreferrer/);
  dialog.querySelector('[data-ap-close]').click();
  assert.equal(dialog.hasAttribute('open'),false);
 }
});

test('搜索、分类和空结果重置可以组合使用',()=>{
 const {dom,root}=setup(); const search=root.querySelector('[data-ap-search]');
 input(dom,search,'literature-review');
 assert.equal(cards(root).length,1);
 assert.ok(cards(root)[0].querySelector('[data-ap-detail="literature-review"]'));
 root.querySelector('[data-ap-group="文献与引用"]').click();
 assert.equal(cards(root).length,1);
 input(dom,search,'没有匹配的技能 87654321');
 assert.equal(cards(root).length,0);
 assert.equal(root.querySelector('[data-ap-empty]').hidden,false);
 root.querySelector('[data-ap-reset]').click();
 assert.equal(search.value,''); assert.equal(cards(root).length,6);
 assert.equal(root.querySelector('[data-ap-empty]').hidden,true);
 assert.equal(root.querySelector('[data-ap-group="全部"]').getAttribute('aria-pressed'),'true');
});

test('反复挂载后新界面仍可筛选和打开详情',()=>{
 const {dom,root}=setup(); input(dom,root.querySelector('[data-ap-search]'),'论文');
 mountAiPlaza(root); assert.equal(cards(root).length,6);
 root.querySelector('[data-ap-detail="peer-review"]').click();
 assert.ok(root.querySelector('[data-ap-dialog]').textContent.includes('科研稿件审阅'));
 root.querySelector('[data-ap-close]').click();
 assert.equal(root.querySelector('[data-ap-dialog]').hasAttribute('open'),false);
});

test('导航与第三方来源分别准确标识',()=>{
 const {root}=setup();
 const categoryRoutes=new Set(workspaceLinks.flatMap(([,links])=>links.map(([id])=>id)));
 for(const link of root.querySelectorAll('a[href^="#"]')){
  const [path]=link.getAttribute('href').slice(1).split('?');
  assert.ok(categoryRoutes.has(path),`未知分类：${path}`);
 }
 for(const link of root.querySelectorAll('a[target="_blank"]')){
  assert.match(link.getAttribute('href'),/^https:\/\//);
  assert.match(link.getAttribute('rel'),/noopener/);
  assert.match(link.getAttribute('rel'),/noreferrer/);
 }
 assert.match(root.textContent,/开源/);
});
