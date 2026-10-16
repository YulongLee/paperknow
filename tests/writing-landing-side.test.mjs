import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {writingLandingSide} from '../dist/workspace/writing-landing-side.mjs';

const render=drafts=>new JSDOM(writingLandingSide(drafts)).window.document;
test('recent writing shows genuine saved writing types in time order without hiding user titles or mutating data',()=>{
 const drafts=[
  {id:'ppt',tool:'ppt',mode:'毕业论文',title:'不属于写作的演示文稿',updatedAt:'2026-10-19T00:00:00Z'},
  {id:'old-writing',tool:'writing',title:'较早的论文',updatedAt:'2026-10-14T00:00:00Z'},
  {id:'topic',tool:'topic',title:'测试材料与评价方法研究',updatedAt:'2026-10-17T00:00:00Z'},
  {id:'legacy-mode',mode:'文献综述',name:'旧版综述',date:'2026/10/16 20:00:00'},
  {id:123,bodySections:[{title:'第一章',text:'手动正文'}],title:'旧版正文草稿',createdAt:'2026-10-15T00:00:00Z'},
  {id:'archived',tool:'writing',title:'已归档',updatedAt:'2026-10-20T00:00:00Z',archived:true},
  {tool:'writing',title:'没有编号不可打开'},
  {id:{value:'bad'},tool:'writing',title:'非法编号'},
  {id:'unknown',title:'没有写作依据的任意记录',text:'普通文本'},
  {id:'unsupported',tool:'research',outlineText:'图表说明',title:'图表不可通过正文伪装成写作'}
 ];
 const before=structuredClone(drafts),doc=render(drafts),links=[...doc.querySelectorAll('.writing-side-draft')];
 assert.deepEqual(links.map(link=>link.getAttribute('href')),['#draft/topic','#draft/legacy-mode','#draft/123']);
 assert.deepEqual(links.map(link=>link.querySelector('b').textContent),['测试材料与评价方法研究','旧版综述','旧版正文草稿']);
 assert.match(links[0].textContent,/课题思路/);assert.match(links[1].textContent,/文献综述/);assert.deepEqual(drafts,before);
 assert.equal(doc.querySelector('.writing-side-account-link').getAttribute('href'),'#assets?scope=account');
});

test('recent links escape user titles and IDs and show actual Shanghai dates or unknown time',()=>{
 const title='<img src=x onerror="alert(1)">真实题目 & 资料',id='draft/"<script>';
 const doc=render([{id,tool:'writing',title,updatedAt:'2026-10-16T12:34:00Z'},{id:'unknown-date',tool:'proposal',title:'时间未记录的真实草稿',updatedAt:'not-a-date'}]);
 const links=[...doc.querySelectorAll('.writing-side-draft')];assert.equal(links[0].querySelector('b').textContent,title);assert.equal(links[0].getAttribute('href'),'#draft/'+encodeURIComponent(id));assert.equal(doc.querySelector('img,script'),null);assert.equal(links[0].querySelector('time').getAttribute('datetime'),'2026-10-16T12:34:00.000Z');assert.match(links[0].querySelector('time').textContent,/2026\/10\/16.*20:34/);assert.match(links[1].textContent,/时间未记录/);assert.equal(links[1].querySelector('time'),null);assert.doesNotMatch(doc.body.textContent,/刚刚|自动保存/);
});

test('empty writing side is concise and preserves preparation, account and manual backup paths without invented progress',()=>{
 for(const value of [[],null,{},[{id:'ppt',tool:'ppt',title:'其他成果'}]]){
  const doc=render(value);assert.equal(doc.querySelectorAll('.writing-side-empty').length,1);assert.equal(doc.querySelectorAll('.writing-side-draft').length,0);assert.equal(doc.querySelectorAll('.writing-side-checklist-list li').length,3);assert.match(doc.body.textContent,/明确题目.*准备资料.*核对要求/);assert.match(doc.body.textContent,/点击保存后/);assert.doesNotMatch(doc.body.textContent,/自动保存|刚刚|最近保存|0%|已同步/);assert.equal(doc.querySelector('a[href="#assets?scope=account"]').textContent,'查看账户草稿 →');assert.ok(doc.querySelector('a[href="#settings/data"]'));
 }
});
