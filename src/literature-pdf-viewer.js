import {getDocument,GlobalWorkerOptions,TextLayer} from 'pdfjs-dist/build/pdf.mjs';

GlobalWorkerOptions.workerSrc='/precheck/assets/pdf.worker.min.mjs';

/** Render private, already-verified PDF bytes. Only nearby pages retain a bitmap. */
export async function mountPdfViewer({container,bytes,isCurrent=()=>true,signal,initialPage=1,onLocation=()=>{}}={}){
 const doc=container.ownerDocument,win=doc.defaultView;
 let live=true,scale=1,observer=null,resize=null,revision=0,documentPdf=null,scrollTimer=null,resizing=false;
 const loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,enableXfa:false,useSystemFonts:true,cMapUrl:'/workspace/assets/pdf-cmaps/',cMapPacked:true,standardFontDataUrl:'/workspace/assets/pdf-fonts/',wasmUrl:'/workspace/assets/pdf-wasm/'});
 const textTasks=new Map(),tasks=new Map(),renders=new Map(),painted=new Set(),visible=new Set();
 const current=()=>live&&!signal?.aborted&&container.isConnected&&isCurrent();
 const stop=()=>{if(!live)return;live=false;win.clearTimeout(scrollTimer);revision++;observer?.disconnect();resize?.disconnect();for(const task of tasks.values())task.cancel();for(const task of textTasks.values())task.cancel();textTasks.clear();tasks.clear();void loading.destroy().catch(()=>{});container.replaceChildren();};
 signal?.addEventListener('abort',stop,{once:true});
 try{
  documentPdf=await loading.promise;if(documentPdf.numPages>100)throw Error('PDF 超过 100 页，请拆分后研读。');if(!current()){stop();return {dispose:stop};}
  container.replaceChildren();container.classList.add('lit-pdf-viewer');
  const tools=doc.createElement('div');tools.className='lit-pdf-tools';
  const count=doc.createElement('span');count.textContent='/ '+documentPdf.numPages+' 页';let currentPage=Math.min(documentPdf.numPages,Math.max(1,(Number.isInteger(Number(initialPage))?Number(initialPage):1))),reportedPage=currentPage;const pageInput=doc.createElement('input');pageInput.type='number';pageInput.min=1;pageInput.max=documentPdf.numPages;pageInput.value=currentPage;pageInput.setAttribute('aria-label','PDF 页码');const previous=doc.createElement('button');previous.type='button';previous.textContent='‹';previous.setAttribute('aria-label','上一页 PDF');const next=doc.createElement('button');next.type='button';next.textContent='›';next.setAttribute('aria-label','下一页 PDF');
  const zoomOut=doc.createElement('button');zoomOut.type='button';zoomOut.textContent='−';zoomOut.setAttribute('aria-label','缩小 PDF');
  const zoom=doc.createElement('span');zoom.textContent='适应宽度';
  const zoomIn=doc.createElement('button');zoomIn.type='button';zoomIn.textContent='+';zoomIn.setAttribute('aria-label','放大 PDF');
  tools.append(previous,pageInput,count,next,zoomOut,zoom,zoomIn);
  const pages=doc.createElement('div');pages.className='lit-pdf-pages';pages.setAttribute('aria-label','PDF 原件页面');container.append(tools,pages);
  const first=await documentPdf.getPage(1),base=first.getViewport({scale:1}),hosts=[];
  for(let number=1;number<=documentPdf.numPages;number++){
   const host=doc.createElement('div');host.className='lit-pdf-page';host.dataset.pdfPage=String(number);host.setAttribute('aria-label','PDF 第 '+number+' 页');
   const layer=doc.createElement('div');layer.className='textLayer';const canvas=doc.createElement('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label','论文原件第 '+number+' 页');
   const label=doc.createElement('span');label.className='lit-pdf-page-number';label.textContent=String(number);host.append(canvas,layer,label);pages.append(host);hosts.push(host);
  }
  let width=0;
  function paint(number){
   if(!current()||resizing||painted.has(number))return Promise.resolve();if(renders.has(number))return renders.get(number);
   const ticket=revision,host=hosts[number-1],canvas=host.querySelector('canvas');let task,textTask;
   const render=(async()=>{try{
    const page=number===1?first:await documentPdf.getPage(number);if(!current()||ticket!==revision)return;
    const unit=page.getViewport({scale:1}),viewport=page.getViewport({scale:width*scale/unit.width}),ratio=Math.min(Math.max(1,win.devicePixelRatio||1),2);
    host.style.setProperty('--total-scale-factor',String(viewport.scale));host.style.setProperty('--scale-round-x','1px');host.style.setProperty('--scale-round-y','1px');host.style.width=viewport.width+'px';host.style.height=viewport.height+'px';canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
    task=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});tasks.set(number,task);await task.promise;
    if(current()&&ticket===revision){painted.add(number);host.dataset.rendered='true';try{const layer=host.querySelector('.textLayer');layer.replaceChildren();textTask=new TextLayer({textContentSource:page.streamTextContent(),container:layer,viewport});textTasks.set(number,textTask);await textTask.render();}catch{host.querySelector('.textLayer').replaceChildren();}}
   }catch(error){if(current()&&ticket===revision&&error.name!=='RenderingCancelledException'){host.dataset.rendered='error';host.querySelector('.lit-pdf-page-number').textContent='第 '+number+' 页暂时未能显示，可重开文献或阅读提取正文。';}}
   finally{if(tasks.get(number)===task)tasks.delete(number);if(textTasks.get(number)===textTask)textTasks.delete(number);}})();
   renders.set(number,render);void render.finally(()=>{if(renders.get(number)===render)renders.delete(number);});return render;
  }
  function release(number){tasks.get(number)?.cancel();textTasks.get(number)?.cancel();const pending=renders.get(number)||Promise.resolve();void pending.finally(()=>{if(!current())return;if(visible.has(number)){if(!resizing){painted.delete(number);void paint(number);}return;}painted.delete(number);const host=hosts[number-1],canvas=host.querySelector('canvas');canvas.width=0;canvas.height=0;host.querySelector('.textLayer').replaceChildren();delete host.dataset.rendered;});}
  async function layout(){
   if(!current()||pages.clientWidth<50)return;resizing=true;const anchor=hosts[currentPage-1],offset=width?Math.max(0,(pages.scrollTop-anchor.offsetTop)/Math.max(1,anchor.offsetHeight)):0,ticket=++revision;for(const task of tasks.values())task.cancel();for(const task of textTasks.values())task.cancel();await Promise.allSettled([...renders.values()]);if(!current()||ticket!==revision)return;tasks.clear();painted.clear();width=Math.max(180,pages.clientWidth-30);
   for(const host of hosts){host.style.width=width*scale+'px';host.style.height=width*scale*base.height/base.width+'px';host.querySelector('canvas').width=0;host.querySelector('.textLayer').replaceChildren();delete host.dataset.rendered;}
   zoom.textContent=scale===1?'适应宽度':Math.round(scale*100)+'%';zoomOut.disabled=scale<=.75;zoomIn.disabled=scale>=1.75;
   pages.scrollTop=Math.max(0,hosts[currentPage-1].offsetTop+offset*hosts[currentPage-1].offsetHeight);resizing=false;await paint(currentPage);for(const number of visible)void paint(number);
  }
  const updatePage=()=>{pageInput.value=currentPage;previous.disabled=currentPage<=1;next.disabled=currentPage>=documentPdf.numPages;if(currentPage!==reportedPage){reportedPage=currentPage;onLocation(currentPage);}};
  function go(number){if(!current())return;currentPage=Math.min(documentPdf.numPages,Math.max(1,Number.isInteger(number)?number:currentPage));pages.scrollTop=Math.max(0,hosts[currentPage-1].offsetTop-15);updatePage();void paint(currentPage);}
  previous.onclick=()=>go(currentPage-1);next.onclick=()=>go(currentPage+1);pageInput.onchange=()=>go(Number(pageInput.value));pageInput.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();go(Number(pageInput.value));pageInput.blur();}};
  pages.addEventListener('scroll',()=>{win.clearTimeout(scrollTimer);scrollTimer=win.setTimeout(()=>{if(!current()||resizing||pages.clientWidth<50||pages.clientHeight<50)return;let low=0,high=hosts.length-1;const top=pages.scrollTop+45;while(low<high){const mid=(low+high)>>1;if(hosts[mid].offsetTop+hosts[mid].offsetHeight<top)low=mid+1;else high=mid;}currentPage=low+1;updatePage();},100);});updatePage();
  zoomOut.onclick=()=>{scale=Math.max(.75,scale-.25);void layout();};zoomIn.onclick=()=>{scale=Math.min(1.75,scale+.25);void layout();};
  await layout();if(!current())return {dispose:stop};
  if(win.IntersectionObserver){observer=new win.IntersectionObserver(entries=>{for(const entry of entries){const number=Number(entry.target.dataset.pdfPage);if(entry.isIntersecting){visible.add(number);void paint(number);}else{visible.delete(number);release(number);}}},{root:pages,rootMargin:'650px 0px'});hosts.forEach(host=>observer.observe(host));}
  else for(let number=2;number<=Math.min(documentPdf.numPages,3);number++)void paint(number);
  if(win.ResizeObserver){let oldWidth=pages.clientWidth;resize=new win.ResizeObserver(()=>{if(Math.abs(pages.clientWidth-oldWidth)<2||pages.clientWidth<50)return;oldWidth=pages.clientWidth;void layout();});resize.observe(pages);}
  if(pages.clientWidth>=50&&(!hosts[currentPage-1]?.dataset.rendered||hosts[currentPage-1].dataset.rendered==='error'))throw Error('PDF 页面未能显示，请先阅读提取正文。');
  return {pageCount:documentPdf.numPages,dispose(){signal?.removeEventListener('abort',stop);stop();}};
 }catch(error){signal?.removeEventListener('abort',stop);stop();throw error;}
}
