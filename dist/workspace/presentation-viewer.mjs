// Read the owned delivery, never a storage URL or SVG supplied in task JSON.
let closeExpandedViewer=null;
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
const tags=new Set(['svg','g','rect','circle','ellipse','line','polyline','polygon','path','text','tspan']);
export function presentationPreviewPages(html,win,expectedPages){
 if(typeof html!=='string'||html.length>20*1024*1024)throw Error('预览文件过大，请下载 PPTX 查看。');
 // Do not parse the surrounding HTML: an inert HTML document may still load
 // resource tags. Only bounded SVG fragments from our delivery wrapper enter XML parsing.
 const fragments=[...html.matchAll(/<section\b[^>]*class=["']page["'][^>]*>\s*(<svg\b[\s\S]*?<\/svg>)/g)].map(match=>match[1]);
 const pages=fragments.map(fragment=>{if(/<!(?:DOCTYPE|ENTITY)|<\?|<(?:script|image|foreignObject|iframe|style|use)\b|\s(?:[\w-]+:)?(?:href|src|style|on[\w-]+)\s*=/i.test(fragment))throw Error('预览页面包含不支持的资源。');const doc=new win.DOMParser().parseFromString(fragment,'image/svg+xml');if(doc.querySelector('parsererror'))throw Error('预览页面格式异常，请下载 PPTX 查看。');return doc.documentElement;});
 if(!pages.length||pages.length>30||expectedPages&&pages.length!==expectedPages)throw Error('预览页数不完整，请重新打开任务后重试。');
 return pages.map(svg=>{
  if(svg.getAttribute('viewBox')!=='0 0 1280 720')throw Error('预览页面尺寸异常，请下载 PPTX 查看。');
  const elements=[svg,...svg.querySelectorAll('*')];if(elements.length>4000)throw Error('预览页面过于复杂，请下载 PPTX 查看。');
  for(const node of elements){
   if(!tags.has(node.localName)||node.namespaceURI!=='http://www.w3.org/2000/svg')throw Error('预览页面包含不支持的内容。');
   for(const attr of [...node.attributes])if(/^on/i.test(attr.name)||/href|src|style|filter|mask|clip-path|transform/i.test(attr.name)||/url\s*\(|javascript:|https?:/i.test(attr.value)&&!(attr.name==='xmlns'&&attr.value==='http://www.w3.org/2000/svg'))throw Error('预览页面包含不支持的资源。');
  }
  return new win.XMLSerializer().serializeToString(svg);
 });
}
const frameSource=svg=>`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:white}svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`;
export function mountPresentationViewer({container,artifact,ownerId,api,fetch:fetchOverride,isCurrent=()=>true}={}){
 const doc=container.ownerDocument,win=doc.defaultView,controller=new win.AbortController();let live=true,pages=[],index=0,loading=false,requestController=null,expanded=false,bodyOverflow='';
 const current=()=>live&&container.isConnected&&isCurrent();
 if(!doc.querySelector('link[data-presentation-viewer-style]')){const link=doc.createElement('link');link.rel='stylesheet';link.href='/workspace/presentation-viewer.css';link.dataset.presentationViewerStyle='';doc.head.append(link);}
 container.classList.add('presentation-viewer');container.setAttribute('aria-label','生成版 PPT 在线预览');
 container.innerHTML='<div class="presentation-viewer-heading"><strong>生成版在线预览</strong><span data-pv-status role="status" aria-live="polite">正在读取演示页面…</span></div><div class="presentation-viewer-stage" aria-busy="true"><div data-pv-wait role="status"><span class="presentation-viewer-spinner" aria-hidden="true"></span><p>正在加载预览…</p></div><iframe data-pv-frame title="生成版演示页面" sandbox="" referrerpolicy="no-referrer" hidden></iframe></div><div class="presentation-viewer-controls" hidden><button type="button" class="btn secondary" data-pv-prev>上一页</button><span data-pv-count aria-live="polite"></span><button type="button" class="btn secondary" data-pv-next>下一页</button><button type="button" class="btn secondary" data-pv-full>全屏预览</button></div><nav class="presentation-viewer-pages" aria-label="选择演示页面"></nav><button type="button" class="btn secondary" data-pv-retry hidden>重新加载预览</button><p class="presentation-viewer-note">预览对应本次生成文件；字体与 PowerPoint、WPS 的显示可能略有差异。</p>';
 const $=selector=>container.querySelector(selector),status=$('[data-pv-status]'),stage=$('.presentation-viewer-stage'),wait=$('[data-pv-wait]'),frame=$('[data-pv-frame]'),controls=$('.presentation-viewer-controls'),nav=$('.presentation-viewer-pages'),retry=$('[data-pv-retry]');
 function show(next){if(!current()||!pages.length)return;index=Math.max(0,Math.min(pages.length-1,next));frame.srcdoc=frameSource(pages[index]);frame.title='生成版演示文稿 · 第 '+(index+1)+' 页';$('[data-pv-count]').textContent=(index+1)+' / '+pages.length+' 页';$('[data-pv-prev]').disabled=index===0;$('[data-pv-next]').disabled=index===pages.length-1;for(const [i,button]of [...nav.children].entries()){button.setAttribute('aria-current',i===index?'page':'false');}}
 async function load(){
  if(loading||!current())return;loading=true;retry.hidden=true;status.textContent='正在读取演示页面…';wait.hidden=false;frame.hidden=true;controls.hidden=true;stage.setAttribute('aria-busy','true');nav.replaceChildren();
  const request=new win.AbortController();requestController=request;const timer=win.setTimeout(()=>request.abort(),25000);
  try{
   if(!safeId(artifact?.previewArtifactId)||!safeId(ownerId))throw Error('此记录暂缺在线预览，请打开原生成任务查看。');
   const fetcher=fetchOverride||win.fetch.bind(win),session=api?await api('/auth/me',undefined,{signal:request.signal}):await fetcher('/api/auth/me',{credentials:'same-origin',cache:'no-store',signal:request.signal}).then(async r=>{if(!r.ok)throw Error('请登录任务所属账户后查看预览。');return r.json();});
   if(!current())return;if(session.user?.id!==ownerId)throw Error('登录账户已变化，请切回任务所属账户查看预览。');
   const response=await fetcher('/api/artifacts/'+artifact.previewArtifactId+'/download?'+new win.URLSearchParams({expectedUserId:ownerId}),{credentials:'same-origin',cache:'no-store',signal:request.signal});
   if(!response.ok)throw Error(response.status===401?'请登录后查看预览。':response.status===404?'预览文件已删除或不存在，仍可尝试下载 PPTX。':'预览暂未加载，请稍后重试。');
   if(Number(response.headers?.get('content-length'))>20*1024*1024)throw Error('预览文件过大，请下载 PPTX 查看。');
   const html=await response.text();if(!current())return;pages=presentationPreviewPages(html,win,artifact.pageCount);wait.hidden=true;frame.hidden=false;controls.hidden=false;status.textContent='共 '+pages.length+' 页';
   pages.forEach((_,i)=>{const button=doc.createElement('button');button.type='button';button.textContent=String(i+1);button.setAttribute('aria-label','预览第 '+(i+1)+' 页');button.onclick=()=>show(i);nav.append(button);});show(0);
  }catch(error){if(current()){pages=[];frame.srcdoc='';wait.hidden=true;status.textContent=request.signal.aborted?'预览加载超时，请重新加载预览。':error.message;retry.hidden=false;}}
  finally{win.clearTimeout(timer);if(requestController===request)requestController=null;loading=false;if(current())stage.setAttribute('aria-busy','false');}
 }
 $('[data-pv-prev]').onclick=()=>show(index-1);$('[data-pv-next]').onclick=()=>show(index+1);retry.onclick=()=>void load();
 const fullButton=$('[data-pv-full]');
 function expand(value){if(value===expanded)return;if(value){closeExpandedViewer?.();bodyOverflow=doc.body.style.overflow;doc.body.style.overflow='hidden';closeExpandedViewer=collapse;}else{doc.body.style.overflow=bodyOverflow;if(closeExpandedViewer===collapse)closeExpandedViewer=null;}expanded=value;container.classList.toggle('is-expanded',expanded);fullButton.textContent=expanded?'退出全屏':'全屏预览';fullButton.setAttribute('aria-pressed',String(expanded));}
 function collapse(){expand(false);}
 fullButton.onclick=()=>expand(!expanded);

 container.addEventListener('keydown',event=>{if(event.key==='Escape'&&expanded){event.preventDefault();expand(false);return;}if(event.target.matches('input,textarea,select'))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();show(index+(event.key==='ArrowLeft'?-1:1));}},{signal:controller.signal});
 void load();return{dispose(){expand(false);live=false;controller.abort();requestController?.abort();pages=[];frame.srcdoc='';},show};
}
