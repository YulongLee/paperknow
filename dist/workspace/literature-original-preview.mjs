// Preview only an authenticated account original. Never fetch a paper's public URL here.
export function mountLiteratureOriginalPreview({container,paper,isCurrent=()=>true,fetchImpl=(...args)=>fetch(...args),signal,onReady=()=>{},onLocation=()=>{},loadViewer=()=>import('/workspace/assets/literature-pdf-viewer.js')}={}){
 const win=container.ownerDocument.defaultView,controller=new win.AbortController(),pages=container.querySelector('[data-reader-pdf-pages]'),status=container.querySelector('[data-reader-pdf-status]');
 let live=true,pending=null,viewer=null,ready=false;
 const fallback=container.querySelector('[data-reader-text-fallback]'),retry=container.querySelector('[data-reader-pdf-retry]');
 const current=()=>live&&container.isConnected&&!controller.signal.aborted&&isCurrent();
 const abort=()=>{controller.abort();viewer?.dispose();viewer=null;pages.replaceChildren();};
 signal?.addEventListener('abort',abort,{once:true});
 async function request(path,binary=false){
  const response=await fetchImpl(path,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'X-PaperKnow-User':paper.originalOwnerId}});
  if(!current())throw Object.assign(Error('阅读页已关闭'),{name:'AbortError'});
  if(!response.ok)throw Error(response.status===401?'请登录上传这份原件的账户后查看 PDF。':'PDF 原件暂时无法读取，请重新加载原件。');
  if(!binary)return response.json();
  if(Number(response.headers?.get('content-length'))>20*1024*1024)throw Error('PDF 原件超过可预览大小，请下载原件查看。');
  return response.arrayBuffer();
 }
 function load(){
  if(ready)return Promise.resolve(true);if(pending)return pending;if(!current())return Promise.resolve(false);
  if(fallback)fallback.hidden=true;if(retry)retry.hidden=true;pending=(async()=>{
   const timer=win.setTimeout(()=>controller.abort(),45000);container.setAttribute('aria-busy','true');status.textContent='正在打开 PDF 原件…';
   try{
    if(!paper.originalFileId||!paper.originalOwnerId)throw Error('这篇文献尚未关联 PDF 原件，请重新选择文件。');
    const owner=await request('/api/auth/me');if(owner.user?.id!==paper.originalOwnerId)throw Error('请登录上传这份原件的账户后查看 PDF；当前正文与笔记仍保留。');
    const bytes=await request('/api/files/'+encodeURIComponent(paper.originalFileId)+'/download?expectedUserId='+encodeURIComponent(paper.originalOwnerId),true);
    if(!current())return false;const data=new Uint8Array(bytes);if(data.length>20*1024*1024||String.fromCharCode(...data.subarray(0,5))!=='%PDF-')throw Error('原件不是有效的 PDF，请重新选择正确的原件。');
    const checked=await request('/api/auth/me');if(!current())return false;if(checked.user?.id!==paper.originalOwnerId)throw Error('登录账户已变化，请重新打开文献。');
    const module=await loadViewer();if(!current())return false;viewer=await module.mountPdfViewer({container:pages,bytes,isCurrent:current,signal:controller.signal,initialPage:paper.readingPosition?.pdfPage||1,onLocation});if(!current()){viewer?.dispose();return false;}ready=true;status.textContent='PDF 原件 · '+viewer.pageCount+' 页';container.dataset.previewState='ready';onReady();return true;
   }catch(error){if(live&&container.isConnected&&isCurrent()){status.textContent=controller.signal.aborted?'原件读取已停止，请重新打开文献。':error.message||'PDF 原件暂时无法读取。';container.dataset.previewState='error';if(fallback)fallback.hidden=false;if(retry)retry.hidden=false;}return false;}
   finally{win.clearTimeout(timer);if(live&&container.isConnected)container.setAttribute('aria-busy','false');pending=null;}
  })();return pending;
 }
 return {load,dispose(){if(!live)return;live=false;signal?.removeEventListener('abort',abort);abort();}};
}
