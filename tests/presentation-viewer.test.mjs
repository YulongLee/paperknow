import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountPresentationViewer,presentationPreviewPages} from '../dist/workspace/presentation-viewer.mjs';
const svg=text=>'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect x="0" y="0" width="1280" height="720" fill="#FFFFFF"/><text x="72" y="90" font-size="44">'+text+'</text></svg>';
const html=[svg('图文版第1页'),svg('图文版第2页')].map(s=>'<section class="page">'+s+'</section>').join('');
const until=async check=>{for(let i=0;i<40;i++){if(check())return;await new Promise(r=>setTimeout(r,2));}assert.ok(check());};
function fixture(t,{owner='alice',body=html,status=200,fetcher}={}){
 const dom=new JSDOM('<main><section id="viewer"></section></main>',{url:'https://paperknow.cn/workspace.html'}),container=dom.window.document.querySelector('#viewer'),calls=[];
 dom.window.fetch=fetcher||(async(url,options)=>{calls.push({url,options});return{ok:status===200,status,headers:new Headers(),text:async()=>body};});
 const viewer=mountPresentationViewer({container,artifact:{previewArtifactId:'owned-preview',pageCount:2},ownerId:'alice',api:async path=>{calls.push({path});return{user:{id:owner}};}});
 t.after(()=>{viewer.dispose();dom.window.close();});return{dom,container,calls,viewer};
}
test('actual owned delivery renders directly, changes all pages and stays isolated from the editor origin',async t=>{
 const f=fixture(t);await until(()=>!f.container.querySelector('[data-pv-frame]').hidden);const frame=f.container.querySelector('iframe');assert.match(frame.srcdoc,/图文版第1页/);assert.equal(frame.getAttribute('sandbox'),'');assert.equal(frame.getAttribute('referrerpolicy'),'no-referrer');assert.match(frame.srcdoc,/default-src 'none'/);assert.equal(f.calls.filter(c=>c.url).length,1);assert.equal(f.calls[1].url,'/api/artifacts/owned-preview/download?expectedUserId=alice');assert.equal(f.calls[1].options.credentials,'same-origin');assert.equal(f.calls[1].options.cache,'no-store');
 f.container.querySelector('[data-pv-next]').click();assert.match(frame.srcdoc,/图文版第2页/);assert.equal(f.container.querySelector('[data-pv-next]').disabled,true);f.container.querySelector('.presentation-viewer-pages button').click();assert.match(frame.srcdoc,/图文版第1页/);assert.equal(f.calls.filter(c=>c.url).length,1);assert.equal(f.container.querySelectorAll('.presentation-viewer-pages button').length,2);
 f.container.querySelector('[data-pv-full]').click();assert.equal(f.container.classList.contains('is-expanded'),true);assert.equal(f.dom.window.document.body.style.overflow,'hidden');f.container.querySelector('[data-pv-full]').dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(f.container.classList.contains('is-expanded'),false);f.container.querySelector('[data-pv-full]').click();f.viewer.dispose();assert.equal(f.dom.window.document.body.style.overflow,'');assert.equal(frame.srcdoc,'');
});
test('account switch blocks any artifact read and deleted previews give a recoverable message',async t=>{
 const switched=fixture(t,{owner:'bob'});await until(()=>switched.container.textContent.includes('登录账户已变化'));assert.equal(switched.calls.some(c=>c.url),false);assert.equal(switched.container.querySelector('iframe').srcdoc,'');
 const deleted=fixture(t,{status:404});await until(()=>deleted.container.textContent.includes('已删除'));assert.equal(deleted.container.querySelector('[data-pv-retry]').hidden,false);
});
test('navigation aborts preview reads and ignores late content without displaying old account pages',async t=>{
 let release,signal;const f=fixture(t,{fetcher:async(url,options)=>{signal=options.signal;return new Promise(r=>{release=()=>r({ok:true,headers:new Headers(),text:async()=>html});});}});await until(()=>release);const frame=f.container.querySelector('iframe');f.viewer.dispose();assert.equal(signal.aborted,true);release();await new Promise(r=>setTimeout(r,10));assert.equal(frame.srcdoc,'');assert.equal(f.container.querySelectorAll('.presentation-viewer-pages button').length,0);
});
test('untrusted SVG resources and incomplete or mismatching page deliveries never reach the frame',async t=>{
 const dom=new JSDOM('');t.after(()=>dom.window.close());for(const bad of [html.replace('<rect','<image href="https://evil.invalid/track"/><rect'),html.replace('<rect','<script>alert(1)</script><rect'),html.replace('<rect','<rect onload="alert(1)"'),html.replace('<rect','<foreignObject/><rect'),html.replace('fill="#FFFFFF"','fill="url(https://evil.invalid/)"'),html.replace('width="1280"','style="background:url(https://evil.invalid/)" width="1280"')])assert.throws(()=>presentationPreviewPages(bad,dom.window,2));assert.throws(()=>presentationPreviewPages(html,dom.window,3),/页数/);assert.throws(()=>presentationPreviewPages('<svg/>',dom.window));
 const f=fixture(t,{body:html.replace('<rect','<script>alert(1)</script><rect')});await until(()=>f.container.textContent.includes('不支持'));assert.equal(f.container.querySelector('iframe').srcdoc,'');
});
