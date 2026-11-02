import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {thesisPreviewItem,readerTextHTML,thesisReaderHTML} from '../dist/workspace/thesis-generation-reader.mjs';
test('saved chapters take priority over checkpoint drafts and the preview never mutates the authoritative manuscript',()=>{
 const item={id:'t',chapters:[{id:'a',title:'A',text:'原章'},{id:'b',title:'B',text:''}],sections:[{chapterId:'a',status:'completed',text:'未发布的修订'},{chapterId:'b',status:'completed',text:'已保存小节',sourceIds:['r'],figures:[]},{chapterId:'b',status:'running',text:'未完成内容'}]},before=structuredClone(item),preview=thesisPreviewItem(item);assert.equal(preview.chapters[0].text,'原章');assert.equal(preview.chapters[1].text,'已保存小节');assert.equal(preview.chapters[1].draftFromSections,true);assert.deepEqual(item,before);
});
test('reader renders tables, headings and code while escaping all manuscript HTML',()=>{
 const dom=new JSDOM('<main></main>');dom.window.document.querySelector('main').innerHTML=readerTextHTML('## 理论\n\n**重要** <script>bad()</script>\n\n|方法|值|\n|---|---|\n|<img src=x>|3|\n\n```js\nwindow.bad = true\n```');const doc=dom.window.document;assert.equal(doc.querySelector('h4').textContent,'理论');assert.equal(doc.querySelectorAll('td').length,2);assert.equal(doc.querySelector('td').textContent,'<img src=x>');assert.equal(doc.querySelector('strong').textContent,'重要');assert.equal(doc.querySelector('script,img'),null);assert.match(doc.querySelector('code').textContent,/window.bad/);dom.window.close();
});
test('the empty and generating preview do not invent manuscript text or completion',()=>{
 const item={id:'t',chapters:[{id:'a',title:'<不执行>',text:''}]};const html=thesisReaderHTML(item,'a',{active:true});const dom=new JSDOM(html);assert.match(dom.window.document.body.textContent,/正在撰写/);assert.equal(dom.window.document.querySelector('.thesis-reader-paper'),null);assert.match(dom.window.document.querySelector('nav').textContent,/<不执行>/);dom.window.close();
});
