import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {withStableView,resetStableView,workspaceSurface,keepsWorkspacePosition,installStableDisclosures} from '../dist/workspace/view-stability.mjs';

function fixture(t,{html='<main id="main"></main>',x=0,y=0,height=800,rootTop=80}={}){
 const dom=new JSDOM(html,{url:'https://example.test/workspace.html#category/research',pretendToBeVisual:true}),win=dom.window,doc=win.document,root=doc.querySelector('main'),scrolls=[];
 const position={x,y};
 Object.defineProperties(win,{scrollX:{get:()=>position.x},scrollY:{get:()=>position.y},innerHeight:{value:height,writable:true,configurable:true}});
 win.scrollTo=options=>{scrolls.push(options);position.x=options.left??position.x;position.y=options.top??position.y;};
 root.getBoundingClientRect=()=>({top:rootTop-position.y,left:-position.x,width:1000,height:1600,bottom:rootTop+1600-position.y,right:1000-position.x});
 t.after(()=>{resetStableView(root);dom.window.close();});
 return {dom,win,doc,root,position,scrolls,$:selector=>doc.querySelector(selector)};
}
const pixels=value=>Math.max(0,...[...String(value).matchAll(/(-?\d+(?:\.\d+)?)px/g)].map(match=>Number(match[1])));
function click(f,target,options={}){const event=new f.win.MouseEvent('click',{bubbles:true,cancelable:true,button:0,...options});target.dispatchEvent(event);return event;}

test('a synchronous update returns its value and restores both viewport axes without smooth scrolling',t=>{
 const f=fixture(t,{x:35,y:640});
 const result=withStableView(f.root,()=>{f.root.textContent='shorter result';f.position.x=0;f.position.y=100;return {updated:true};});
 assert.deepEqual(result,{updated:true});assert.deepEqual(f.position,{x:35,y:640});assert.deepEqual(f.scrolls,[{left:35,top:640,behavior:'instant'}]);
});

test('height reservation is the current viewport requirement and can shrink instead of retaining the historical longest page',t=>{
 const f=fixture(t,{y:1300,height:800});f.root.style.minHeight='64px';f.root.style.overflowAnchor='auto';Object.defineProperty(f.root,'scrollHeight',{value:20000});
 withStableView(f.root,()=>{});assert.equal(pixels(f.root.style.minHeight),2020);assert.equal(f.root.style.overflowAnchor,'none');
 f.position.y=150;withStableView(f.root,()=>{});assert.equal(pixels(f.root.style.minHeight),870);assert.ok(pixels(f.root.style.minHeight)<20000);
 resetStableView(f.root);assert.equal(f.root.style.minHeight,'64px');assert.equal(f.root.style.overflowAnchor,'auto');
 f.position.y=0;withStableView(f.root,()=>{});assert.equal(pixels(f.root.style.minHeight),720);resetStableView(f.root);assert.equal(f.root.style.minHeight,'64px');
});

test('a short-content browser clamp is prevented by reserving the visible viewport before the mutation',t=>{
 const plain=fixture(t,{y:850,height:700,rootTop:100}),stable=fixture(t,{y:850,height:700,rootTop:100});
 const shorten=f=>{f.root.textContent='three filtered rows';const documentHeight=100+Math.max(200,pixels(f.root.style.minHeight));f.position.y=Math.min(f.position.y,Math.max(0,documentHeight-f.win.innerHeight));};
 shorten(plain);assert.equal(plain.position.y,0,'the same short list normally clamps the viewport to the top');
 withStableView(stable.root,()=>shorten(stable));assert.equal(stable.position.y,850);assert.equal(stable.scrolls.length,0,'no after-the-fact scrolling is needed when space was reserved first');
});

test('an untouched active input keeps native focus and selection during composition without being reset',t=>{
 const f=fixture(t,{html:'<main id="main"><textarea id="entry">研究输入中的文本</textarea><div id="result"></div></main>'}),input=f.$('#entry');input.focus({preventScroll:true});input.setSelectionRange(2,4,'backward');input.scrollTop=24;
 let focusCalls=0,selectionCalls=0;const focus=input.focus.bind(input),range=input.setSelectionRange.bind(input);input.focus=options=>{focusCalls++;focus(options);};input.setSelectionRange=(...args)=>{selectionCalls++;range(...args);};
 input.dispatchEvent(new f.win.CompositionEvent('compositionstart',{bubbles:true,data:'研'}));
 withStableView(f.root,()=>{f.$('#result').textContent='Updated preview only';input.dispatchEvent(new f.win.InputEvent('input',{bubbles:true,isComposing:true,data:'究'}));});
 assert.equal(f.doc.activeElement,input);assert.equal(focusCalls,0);assert.equal(selectionCalls,0);assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,4);assert.equal(input.selectionDirection,'backward');assert.equal(input.scrollTop,24);
});

test('a recreated input with the same id restores its selection, internal scroll and focus with preventScroll',t=>{
 const f=fixture(t,{html:'<main id="main"><textarea id="entry">abcdefghijk</textarea></main>'}),previous=f.$('#entry');previous.focus({preventScroll:true});previous.setSelectionRange(3,8,'backward');previous.scrollTop=75;previous.scrollLeft=12;const calls=[];
 withStableView(f.root,()=>{f.root.innerHTML='<textarea id="entry" placeholder="Changed hint">abcdefghijk</textarea>';const next=f.$('#entry'),focus=next.focus.bind(next);next.focus=options=>{calls.push(options);focus(options);};});
 const next=f.$('#entry');assert.notEqual(next,previous);assert.equal(f.doc.activeElement,next);assert.equal(next.selectionStart,3);assert.equal(next.selectionEnd,8);assert.equal(next.selectionDirection,'backward');assert.equal(next.scrollTop,75);assert.equal(next.scrollLeft,12);assert.deepEqual(calls,[{preventScroll:true}]);
});

test('a unique data identity survives a changed selected-state label',t=>{
 const f=fixture(t,{html:'<main id="main"><button data-service="format">选择模板</button></main>'});f.$('button').focus({preventScroll:true});
 withStableView(f.root,()=>{f.root.innerHTML='<button data-service="format">已选择模板</button>';});assert.equal(f.doc.activeElement,f.$('button'));assert.equal(f.doc.activeElement.textContent,'已选择模板');
});

test('ambiguous data identities use a unique old label and never guess among indistinguishable controls',t=>{
 const f=fixture(t,{html:'<main id="main"><button data-action="save">保存正文</button><button data-action="save">保存摘要</button></main>'});f.$('button').focus({preventScroll:true});
 withStableView(f.root,()=>{f.root.innerHTML='<button data-action="save">保存摘要</button><button data-action="save">保存正文</button>';});assert.equal(f.doc.activeElement,f.root.lastElementChild);
 f.root.innerHTML='<button data-action="save">保存</button>';f.$('button').focus({preventScroll:true});withStableView(f.root,()=>{f.root.innerHTML='<button data-action="save">保存</button><button data-action="save">保存</button>';});assert.equal(f.doc.activeElement,f.doc.body);
});

test('a uniquely named input can be restored, but ambiguous named inputs are left alone',t=>{
 const f=fixture(t,{html:'<main id="main"><input name="keyword" value="research"></main>'});f.$('input').focus({preventScroll:true});withStableView(f.root,()=>{f.root.innerHTML='<input name="keyword" value="research" placeholder="A new hint">';});assert.equal(f.doc.activeElement,f.$('input'));
 withStableView(f.root,()=>{f.root.innerHTML='<input name="keyword"><input name="keyword">';});assert.equal(f.doc.activeElement,f.doc.body);
});

test('disabled, hidden, inert and aria-hidden replacement controls are never focused',t=>{
 for(const markup of ['<button id="entry" disabled>继续</button>','<section hidden><button id="entry">继续</button></section>','<section inert><button id="entry">继续</button></section>','<button id="entry" aria-hidden="true">继续</button>']){
  const f=fixture(t,{html:'<main id="main"><button id="entry">继续</button></main>'});f.$('#entry').focus({preventScroll:true});withStableView(f.root,()=>{f.root.innerHTML=markup;});assert.equal(f.doc.activeElement,f.doc.body);
 }
});

test('a dialog or intentionally focused new control keeps focus after an update',t=>{
 const f=fixture(t,{html:'<main id="main"><button id="entry">继续</button></main><dialog open><input id="dialog-input"></dialog>'});f.$('#entry').focus({preventScroll:true});
 withStableView(f.root,()=>{f.root.innerHTML='<button id="entry">继续</button>';f.$('#dialog-input').focus({preventScroll:true});});assert.equal(f.doc.activeElement,f.$('#dialog-input'));
 f.$('#entry').focus({preventScroll:true});withStableView(f.root,()=>{f.root.innerHTML='<button id="entry">继续</button><input id="new-row">';f.$('#new-row').focus({preventScroll:true});});assert.equal(f.doc.activeElement,f.$('#new-row'));
});

test('restoreFocus false preserves the viewport without focusing a recreated control',t=>{
 const f=fixture(t,{html:'<main id="main"><button id="entry">继续</button></main>',y:500});f.$('#entry').focus({preventScroll:true});withStableView(f.root,()=>{f.root.innerHTML='<button id="entry">继续</button>';f.position.y=40;},{restoreFocus:false});assert.equal(f.doc.activeElement,f.doc.body);assert.equal(f.position.y,500);
});

test('inner vertical and horizontal scrolling survive a redraw by id, stable data key and tablist identity',t=>{
 const markup='<div id="paper">paper</div><div data-scroll-key="table">table</div><nav role="tablist" class="mode-tabs">tabs</nav>';
 const f=fixture(t,{html:'<main id="main">'+markup+'</main>'});const original=[...f.root.children];original.forEach((node,index)=>{node.scrollTop=30+index;node.scrollLeft=90+index;});
 withStableView(f.root,()=>{f.root.innerHTML=markup;});[...f.root.children].forEach((node,index)=>{assert.notEqual(node,original[index]);assert.equal(node.scrollTop,30+index);assert.equal(node.scrollLeft,90+index);});
});

test('disconnected roots still run the mutation without changing style or viewport',t=>{
 const f=fixture(t,{y:600});f.root.remove();let updates=0;assert.equal(withStableView(f.root,()=>{updates++;return 42;}),42);assert.equal(updates,1);assert.equal(f.root.style.minHeight,'');assert.equal(f.scrolls.length,0);assert.equal(f.position.y,600);
});

test('removing the root during mutation does not restore stale focus or scroll over the next page',t=>{
 const f=fixture(t,{html:'<main id="main"><input id="entry"></main>',y:600});f.$('#entry').focus({preventScroll:true});withStableView(f.root,()=>{f.root.remove();f.doc.body.innerHTML='<main id="next"><input id="next-entry"></main>';f.$('#next-entry').focus({preventScroll:true});f.position.y=0;});assert.equal(f.position.y,0);assert.equal(f.scrolls.length,0);assert.equal(f.doc.activeElement,f.$('#next-entry'));
});

test('an exception propagates after focus and viewport restoration, and reset cleans the temporary styles',t=>{
 const f=fixture(t,{html:'<main id="main" style="min-height:40px;overflow-anchor:auto"><button id="entry">继续</button></main>',y:600}),error=Error('Render failed');f.$('#entry').focus({preventScroll:true});
 assert.throws(()=>withStableView(f.root,()=>{f.root.innerHTML='<button id="entry">继续</button>';f.position.y=20;throw error;}),value=>value===error);assert.equal(f.position.y,600);assert.equal(f.doc.activeElement,f.$('#entry'));
 resetStableView(f.root);assert.equal(f.root.style.minHeight,'40px');assert.equal(f.root.style.overflowAnchor,'auto');resetStableView(f.root);assert.equal(f.root.style.minHeight,'40px');
});

test('surface identity keeps query and subsection changes within a feature but separates different records and tools',()=>{
 for(const [before,after] of [['#projects','#projects?scope=account'],['#assets?status=all','#assets?status=draft'],['#category/ppt?mode=ai','#category/ppt?mode=proposal'],['#tool/writing?step=1','#tool/writing?step=4'],['#membership/plans','#membership/recharge'],['#membership/pay?order=one','#membership/pay?order=two'],['#literature/p1?tab=text','#literature/p1?tab=notes'],['#thesis/t1?chapter=one','#thesis/t1?chapter=two']])assert.equal(keepsWorkspacePosition(before,after),true,before+' → '+after);
 for(const [before,after] of [['#projects','#assets'],['#category/ppt','#category/research'],['#tool/writing','#tool/proposal'],['#project/a','#project/b'],['#draft/a','#draft/b'],['#account-draft/a','#account-draft/b'],['#thesis/t1','#thesis/t2'],['#literature/p1','#literature/p2'],['#membership/pay','#membership/checkout']])assert.equal(keepsWorkspacePosition(before,after),false,before+' → '+after);
 assert.equal(workspaceSurface(''),'home');assert.equal(workspaceSurface('#home'),'home');assert.equal(keepsWorkspacePosition(null,'#home'),false);assert.equal(keepsWorkspacePosition(undefined,'#home'),false);
});

test('native disclosure activation toggles once in place and removing the listener restores normal event handling',t=>{
 const f=fixture(t,{html:'<main id="main"><details><summary><span>更多设置</span></summary><p>Additional content</p></details></main>',y:450}),stop=installStableDisclosures(f.root),details=f.$('details');
 const first=click(f,f.$('summary span'));assert.equal(first.defaultPrevented,true);assert.equal(details.open,true);assert.equal(f.position.y,450);assert.ok(f.root.style.minHeight);
 const second=click(f,f.$('summary'));assert.equal(second.defaultPrevented,true);assert.equal(details.open,false);assert.equal(f.position.y,450);
 stop();resetStableView(f.root);const third=click(f,f.$('summary'));assert.equal(third.defaultPrevented,false);assert.equal(f.root.style.minHeight,'');
});

test('disclosure handling does not override links, buttons, form controls or editable children inside a summary',t=>{
 const children=['<a href="#source">来源</a>','<button>帮助</button>','<input value="keyword">','<select><option>选项</option></select>','<textarea>note</textarea>','<span contenteditable="true">编辑</span>'];
 for(const child of children){const f=fixture(t,{html:'<main id="main"><details><summary>'+child+'</summary><p>content</p></details></main>'}),stop=installStableDisclosures(f.root);t.after(stop);const event=click(f,f.$('summary').firstElementChild);assert.equal(event.defaultPrevented,false,child);assert.equal(f.root.style.minHeight,'',child);}
});

test('prevented, modified, secondary and outside disclosure events are not intercepted',t=>{
 const f=fixture(t,{html:'<main id="main"><details><summary>设置</summary><p>content</p></details></main><details id="outside"><summary>外部设置</summary></details>'}),stop=installStableDisclosures(f.root);t.after(stop);
 for(const options of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{button:1},{button:2}])assert.equal(click(f,f.$('main summary'),options).defaultPrevented,false);
 const prevented=new f.win.MouseEvent('click',{bubbles:true,cancelable:true});prevented.preventDefault();f.$('main summary').dispatchEvent(prevented);assert.equal(f.root.style.minHeight,'');
 assert.equal(click(f,f.$('#outside summary')).defaultPrevented,false);assert.equal(f.root.style.minHeight,'');
});
