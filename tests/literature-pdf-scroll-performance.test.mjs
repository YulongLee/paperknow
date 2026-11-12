import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

// Exercise the real viewer with deterministic PDF.js and geometry, without network or billing.
test('PDF scrolling reuses nearby pages, retains annotations and keeps page navigation and text selection working',async()=>{
 const result=await build({entryPoints:['src/literature-pdf-viewer.js'],bundle:true,write:false,format:'esm',platform:'browser',plugins:[{name:'mock-pdfjs',setup(b){b.onResolve({filter:/^pdfjs-dist\/build\/pdf\.mjs$/},()=>({path:'mock',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const GlobalWorkerOptions={}; export const getDocument=(options)=>globalThis.__pdfScrollMock.getDocument(options); export class TextLayer { constructor(options){this.options=options} async render(){const span=this.options.container.ownerDocument.createElement("span");span.textContent="selected scientific text";this.options.container.append(span)} cancel(){} }',loader:'js'}));}}]});
 const {mountPdfViewer}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const dom=new JSDOM('<main id="viewer"></main>',{url:'https://paperknow.test',pretendToBeVisual:true}),win=dom.window,container=win.document.querySelector('#viewer'),counts=new Map();let intersection,resolveSlow,cancelledRenders=0;const slowPages=new Promise(resolve=>resolveSlow=resolve);
 Object.defineProperty(win.HTMLElement.prototype,'clientWidth',{get(){return 650}});Object.defineProperty(win.HTMLElement.prototype,'clientHeight',{get(){return 700}});
 Object.defineProperty(win.HTMLElement.prototype,'offsetHeight',{get(){return parseFloat(this.style.height)||0}});Object.defineProperty(win.HTMLElement.prototype,'offsetTop',{get(){let y=0;for(let n=this.previousElementSibling;n;n=n.previousElementSibling)y+=n.offsetHeight+16;return y}});
 win.HTMLCanvasElement.prototype.getContext=()=>({});win.Range.prototype.getClientRects=()=>[{left:10,top:10,right:60,bottom:30}];
 win.IntersectionObserver=class{constructor(callback){this.callback=callback;intersection=this}observe(){}disconnect(){}set(host,visible){this.callback([{target:host,isIntersecting:visible}])}};
 const page=number=>({getViewport:({scale})=>({scale,width:600*scale,height:(number===3?900:800)*scale}),getTextContent:async()=>({items:[]}),render(){counts.set(number,(counts.get(number)||0)+1);if(number===12||number===13){let reject;const promise=new Promise((_,r)=>reject=r);return{promise,cancel(){cancelledRenders++;const error=new Error('cancelled');error.name='RenderingCancelledException';reject(error);}};}return{promise:Promise.resolve(),cancel(){}}}});
 globalThis.__pdfScrollMock={getDocument:()=>({promise:Promise.resolve({numPages:14,getPage:async n=>{if(n===9||n===10)await slowPages;return page(n)}}),destroy:async()=>{}})};
 const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setTimeout(resolve,2));};
 let viewer;try{
  viewer=await mountPdfViewer({container,bytes:new Uint8Array([1])});const pages=container.querySelector('.lit-pdf-pages'),hosts=[...container.querySelectorAll('.lit-pdf-page')];
  intersection.set(hosts[0],true);intersection.set(hosts[1],true);await flush();assert.equal(counts.get(1),1);assert.equal(counts.get(2),1);
  viewer.setAnnotations([{id:'saved',page:1,color:'yellow',quote:'selected scientific text',note:'',rects:[{x:.1,y:.1,width:.2,height:.02}]}]);
  pages.scrollTop=hosts[1].offsetTop+80;pages.dispatchEvent(new win.Event('scroll'));intersection.set(hosts[0],false);await new Promise(resolve=>setTimeout(resolve,40));assert.equal(container.querySelector('input[type=number]').value,'2');
  intersection.set(hosts[0],true);pages.scrollTop=0;pages.dispatchEvent(new win.Event('scroll'));await new Promise(resolve=>setTimeout(resolve,40));assert.equal(counts.get(1),1,'returning to a recent page must not rerender');assert.ok(hosts[0].querySelector('[data-annotation-id="saved"]'));assert.equal(container.querySelector('input[type=number]').value,'1');
  let selected;viewer.subscribeSelection(groups=>selected=groups);const span=hosts[0].querySelector('.textLayer span'),range=win.document.createRange();range.selectNodeContents(span);range.getClientRects=()=>[{left:10,top:10,right:60,bottom:30}];hosts[0].getBoundingClientRect=()=>({left:0,top:0,right:600,bottom:800,width:600,height:800});const sel=win.getSelection();sel.removeAllRanges();sel.addRange(range);pages.dispatchEvent(new win.MouseEvent('mouseup',{bubbles:true}));assert.equal(selected?.[0]?.page,1);
  // Rendering an equal-height page must not rewrite the position while the user is reading.
  pages.scrollTop=120;intersection.set(hosts[2],true);await flush();assert.equal(pages.scrollTop,120);
  container.querySelector('[aria-label="下一页 PDF"]').click();await flush();assert.equal(container.querySelector('input[type=number]').value,'2');
  // A resize/zoom immediately after a fast scroll uses the real position, not the delayed page update.
  pages.scrollTop=hosts[3].offsetTop+hosts[3].offsetHeight*.3;pages.dispatchEvent(new win.Event('scroll'));container.querySelector('[aria-label="放大 PDF"]').click();await new Promise(resolve=>setTimeout(resolve,45));await flush();assert.equal(container.querySelector('input[type=number]').value,'4');assert.ok(Math.abs(viewer.getView().fraction-.3)<.02);
  // Eight sequential pages still keep at most six offscreen rendered pages.
  for(let i=1;i<8;i++){intersection.set(hosts[i-1],false);intersection.set(hosts[i],true);pages.scrollTop=hosts[i].offsetTop;pages.dispatchEvent(new win.Event('scroll'));await new Promise(resolve=>setTimeout(resolve,35));}await flush();assert.ok(hosts.filter(host=>host.dataset.rendered==='true').length<=6);assert.ok(hosts[0].querySelector('[data-annotation-id="saved"]'),'eviction must not remove annotation marks');
  // Two offscreen pages whose PDF page data is slow must not block the next visible page.
  intersection.set(hosts[8],true);intersection.set(hosts[9],true);await flush();intersection.set(hosts[8],false);intersection.set(hosts[9],false);intersection.set(hosts[10],true);await flush();assert.equal(counts.get(11),1,'latest visible page must render without waiting for stale page reads');resolveSlow();await flush();assert.equal(counts.get(9),undefined);assert.equal(counts.get(10),undefined);
  // Actual in-progress renders are cancelled when the user leaves them.
  intersection.set(hosts[11],true);intersection.set(hosts[12],true);await flush();assert.equal(counts.get(12),1);assert.equal(counts.get(13),1);intersection.set(hosts[11],false);intersection.set(hosts[12],false);intersection.set(hosts[13],true);await flush();assert.equal(cancelledRenders,2);assert.equal(counts.get(14),1);assert.equal(hosts[11].querySelector('canvas').width,0);assert.equal(hosts[12].querySelector('canvas').height,0);
 }finally{viewer?.dispose();delete globalThis.__pdfScrollMock;win.close();}
});
