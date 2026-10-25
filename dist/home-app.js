const icons={pen:'<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/><path d="m4 15 5 5"/>',arrow:'<path d="M4 12h15m-5-5 5 5-5 5"/>',file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8m-8 4h5"/>',book:'<path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1zm0 0v15"/><path d="M5 8h3m-3 4h3m8-4h3m-3 4h3"/>',search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/>',crown:'<path d="m3 6 4 4 5-6 5 6 4-4-3 13H6zM7 22h10"/>',play:'<path d="m8 4 12 8-12 8z"/>',scan:'<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/><circle cx="11" cy="11" r="4"/><path d="m14 14 3 3"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',edit:'<path d="M12 4H5v16h15v-8M16 3l5 5-9 9H7v-5z"/><path d="m13 6 5 5"/>',presentation:'<path d="M3 3h18v13H3zM12 16v5m-5 0 5-5 5 5M7 12l3-3 3 2 4-5"/>',chart:'<path d="M4 3v18h17M8 16v-4m5 4V6m5 10V9"/><circle cx="8" cy="8" r="1"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6"/>',download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4m-2-2h4"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',cap:'<path d="m2 9 10-6 10 6-10 6zM6 12v6c4 3 8 3 12 0v-6M22 9v8"/>',send:'<path d="m21 3-7 19-4-9-8-4zM10 13 21 3"/>'};
const svg=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.file}</svg>`;
function hydrate(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=svg(el.dataset.icon));}
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dialog=$('#home-dialog');let previousFocus=null;
function toast(text){$('#home-toast').textContent=text;$('#home-toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#home-toast').classList.remove('visible'),3000);}
function openDialog(title,html){previousFocus=document.activeElement;$('#home-dialog-title').textContent=title;$('#home-dialog-body').innerHTML=html;hydrate(dialog);dialog.showModal();document.body.classList.add('home-modal-open');}
function closeDialog(){dialog.close();}
dialog.addEventListener('close',()=>{document.body.classList.remove('home-modal-open');previousFocus?.focus();});$('#dialog-close').addEventListener('click',closeDialog);
dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();});
const examples={outline:{title:'论文大纲 · 结构示例',selector:'.mini-outline',note:'这里展示论文提纲的结构示例，当前未调用 AI 生成正文。正式写作可从研究信息、知识补充、参考文献到提纲与正文逐步确认；请核对研究证据与引用。',url:'/workspace.html#category/writing',action:'开始创建论文'},report:{title:'来源比对 · 界面示例',selector:'.mini-comparison',note:'这里展示相似片段与对照正文的呈现方式，不是一次实际检测结果。工作台支持材料比对与联网来源比对；联网来源仅覆盖本次检索取得的公开网页，不包含学校封闭数据库。',url:'/workspace.html#category/detection',action:'进入来源比对'},revision:{title:'表达调整 · 界面示例',selector:'.mini-revision',note:'这里展示同一段内容调整表达前后的呈现方式，当前未执行 AI 修改。正式任务可结合原文与修改要求生成建议，保留原意并逐段复核后保存成果。',url:'/workspace.html#category/reduce',action:'开始调整表达'}};
document.querySelectorAll('[data-example]').forEach(b=>b.addEventListener('click',()=>{const e=examples[b.dataset.example];if(!e)return;const preview=$(e.selector);openDialog(e.title,`<p>${e.note}</p>${preview?`<div class="example-modal-preview">${preview.outerHTML}</div>`:''}<div class="home-dialog-actions"><a class="button" href="${e.url}">${e.action} ${svg('arrow')}</a></div>`);}));
// The published release API is the only source of download links and file metadata.
let desktopReleases=[],desktopReleaseState='loading',desktopReleaseVersion='';
function desktopFileSize(bytes){const mb=bytes/1024/1024;return mb>=1024?(mb/1024).toFixed(2)+' GB':mb.toFixed(1)+' MB';}
function normalizeDesktopRelease(release){
 if(!release||!['macos','windows'].includes(release.platform)||!['arm64','x64'].includes(release.arch))return null;
 if(release.platform==='windows'&&release.arch!=='x64')return null;
 if(release.format!==(release.platform==='macos'?'dmg':'exe'))return null;
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version||'')||!Number.isSafeInteger(release.bytes)||release.bytes<=0||!/^[a-f0-9]{64}$/i.test(release.sha256||''))return null;
 if(typeof release.fileName!=='string'||!release.fileName||release.fileName.length>180||/[\x00-\x1f/\\]/.test(release.fileName))return null;
 if(typeof release.minSystem!=='string'||!release.minSystem.trim()||release.minSystem.length>120)return null;
 if(typeof release.signed!=='boolean'||release.downloadUrl!==`/api/desktop/download/${release.platform}/${release.arch}`)return null;
 return release;
}
function renderDesktopDownloads(){
 document.querySelectorAll('[data-desktop-card]').forEach(card=>{
  const platform=card.dataset.desktopCard,arch=platform==='macos'?$('input[name="desktop-mac-arch"]:checked')?.value:'x64';
  const release=desktopReleases.find(item=>item.platform===platform&&item.arch===arch);
  const status=card.querySelector('[data-desktop-status]'),meta=card.querySelector('[data-desktop-meta]'),action=card.querySelector('[data-desktop-action]');
  card.setAttribute('aria-busy',String(desktopReleaseState==='loading'));card.classList.toggle('ready',Boolean(release));
  if(release){
   status.textContent='v'+release.version;
   meta.innerHTML=`<strong>${esc(desktopFileSize(release.bytes))} <span>· ${esc(release.format.toUpperCase())}</span></strong><span>适用于 ${esc(release.minSystem)}</span><details class="desktop-checksum"><summary>查看文件校验信息</summary><span>${esc(release.fileName)}</span><code>SHA-256: ${esc(release.sha256)}</code></details>`;
   action.innerHTML=`<a class="button" href="${esc(release.downloadUrl)}" download="${esc(release.fileName)}" data-desktop-download="${platform}/${arch}">${svg('download')} 下载 ${platform==='macos'?'macOS':'Windows'} 客户端</a>`;
  }else{
   status.textContent=desktopReleaseState==='loading'?'查询中':desktopReleaseState==='error'?'暂时不可用':'暂未提供';
   meta.textContent=desktopReleaseState==='loading'?'正在获取版本与安装包信息…':desktopReleaseState==='error'?'安装包信息获取失败，请稍后重试。':'该设备的安装包暂未发布，请先使用网页端。';
   action.innerHTML=`<button class="button" disabled>${desktopReleaseState==='loading'?'正在获取安装包':'暂无可下载的安装包'}</button>`;
  }
 });
 const available=desktopReleases.length>0,notice=$('#desktop-download-notice'),faq=$('#desktop-faq-status');
 $('#desktop-download-retry').hidden=desktopReleaseState==='loading';
 if(desktopReleaseState==='loading')notice.textContent='正在查询已发布的客户端版本。';
 else if(desktopReleaseState==='error')notice.textContent='暂时无法获取客户端下载信息，你可以继续使用网页工作台。';
 else if(!available)notice.textContent='当前暂无已发布的安装包。网页工作台可正常使用。';
 else notice.textContent=desktopReleases.some(item=>!item.signed)?'首版安装包尚未签名，系统可能提示发布者无法验证。请从本站获取安装包。':'请按设备类型选择安装包，版本与系统要求见上方。';
 if(faq)faq.textContent=desktopReleaseState==='ready'&&available?`网页端无需安装。客户端 ${desktopReleaseVersion?'v'+desktopReleaseVersion+' ':''}已提供下载；请按设备选择版本，并核对系统要求。网页端与客户端的本地草稿分别保存在各自设备环境中，不会自动互相迁移。`:'网页端无需安装。客户端的版本、系统要求与可下载状态，请查看本页「客户端下载」。';
}
async function loadDesktopReleases(){
 if(desktopReleaseState==='loading'&&loadDesktopReleases.pending)return;
 desktopReleaseState='loading';desktopReleases=[];renderDesktopDownloads();
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 loadDesktopReleases.pending=true;
 try{
  const response=await fetch('/api/desktop/releases',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
  if(!response.ok)throw new Error('release list unavailable');
  const data=await response.json();
  if(!data||!Array.isArray(data.releases)||data.releases.length>20)throw new Error('invalid release list');
  const seen=new Set();desktopReleases=data.releases.map(normalizeDesktopRelease).filter(release=>{if(!release)return false;const key=release.platform+'/'+release.arch;if(seen.has(key))return false;seen.add(key);return true;});
  desktopReleaseVersion=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(data.version||'')?data.version:'';
  desktopReleaseState='ready';
 }catch{desktopReleases=[];desktopReleaseState='error';}
 finally{clearTimeout(timeout);loadDesktopReleases.pending=false;renderDesktopDownloads();}
}
document.querySelectorAll('input[name="desktop-mac-arch"]').forEach(input=>input.addEventListener('change',renderDesktopDownloads));
$('#desktop-download-retry')?.addEventListener('click',loadDesktopReleases);
loadDesktopReleases();
function capabilityStatus(ready){return ready===true?'当前可用':ready===false?'暂不可用':'进入功能确认';}
$('#status-button').addEventListener('click',()=>{openDialog('PaperKnow 功能与服务',`<p>从研究资料到论文与演示成果，在同一工作台完成。在线服务状态来自当前服务信息，具体额度与处理要求请在提交任务前确认。</p><div class="status-list">${[
 ['AI 写作','11 类写作流程，覆盖论文、开题、综述与日常学术写作',serviceCapabilities?.writing?.ready],
 ['毕业论文五步流程','研究信息、知识补充、参考文献、提纲与论文撰写逐步确认',serviceCapabilities?.thesis?.ready],
 ['文献检索','检索 OpenAlex、arXiv 等学术来源，整理参考文献',serviceCapabilities?.academicSearch],
 ['文献研读与改写','结合材料研读、整理摘要、润色与修改建议',serviceCapabilities?.tools?.ready],
 ['文献翻译','提交文档后核对处理状态与译文成果',serviceCapabilities?.documentTranslation?.ready],
 ['联网来源比对','覆盖本次检索取得的公开网页，不包含学校封闭数据库',serviceCapabilities?.webSimilarity?.ready],
 ['AI 文本鉴别','提供文本鉴别参考，结果不能作为学术违规的单独判定依据',serviceCapabilities?.aigcDetection?.ready],
 ['学术 PPT','生成并导出可编辑 PPTX，支持后续调整',serviceCapabilities?.tools?.presentation?.ready],
 ['科研 AI 绘图','根据研究内容与参考图创建科研图像',serviceCapabilities?.tools?.researchImages?.ready],
 ['公式识别','识别公式图像并在工作台核对结果',serviceCapabilities?.formulaOcr?.ready],
 ['格式排版','根据格式要求编辑与导出文档',true],
 ['项目、资料与成果','账户管理项目文件、任务与成果版本',serviceCapabilities?.account],
 ['会员、积分与套餐','按研究需求选择当前已发布方案，购买前确认权益',serviceCapabilities?.payment]
 ].map(([t,d,ready])=>`<div><div><b>${t}</b><small>${d}</small></div><span class="status-tag ${ready===true?'':'neutral'}">${capabilityStatus(ready)}</span></div>`).join('')}</div><div class="home-dialog-actions"><a class="button" href="/workspace.html">进入工作台 ${svg('arrow')}</a></div>`);});
$('#about-button').addEventListener('click',()=>openDialog('关于 PaperKnow','<p>PaperKnow 面向学生与科研人员，连接文献检索、论文写作、修改检测、科研绘图、排版与学术演示，让研究过程和成果留在同一工作台。</p><p>支持邮箱与手机号登录，账户可管理项目、资料、任务与成果版本。会员、科研积分与专项套餐可在工作台查看当前价格及具体权益。</p><div class="home-dialog-actions"><a class="button outline" href="/about/">阅读产品介绍</a><a class="button outline" href="/help/">查看使用帮助</a><a class="button" href="/workspace.html">开始体验</a></div>'));
// Public prices are a read-only summary of currently purchasable products.
const homePlanRoutes={membership:'/workspace.html#membership/plans',credits:'/workspace.html#membership/recharge',bundle:'/workspace.html#membership/bundles'};
function validHomePlan(product){
 if(!product||product.status!=='active'||product.purchasable!==true||product.currency!=='CNY'||!Object.hasOwn(homePlanRoutes,product.entitlementType))return false;
 if(!Number.isSafeInteger(product.priceCents)||product.priceCents<=0||product.priceCents>10000000)return false;
 if(typeof product.title!=='string'||!product.title.trim()||product.title.length>80)return false;
 if(product.entitlementType==='credits')return Number.isSafeInteger(product.creditAmount)&&product.creditAmount>0&&product.creditAmount<=1000000;
 return Number.isSafeInteger(product.durationDays)&&product.durationDays>0&&product.durationDays<=366;
}
async function loadHomePlanSummary(){
 const summary=$('[data-home-plan-summary]');if(!summary)return;
 summary.querySelectorAll('[data-home-plan-link]').forEach(link=>{const type=link.dataset.homePlanLink;if(Object.hasOwn(homePlanRoutes,type))link.href=homePlanRoutes[type];});
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch('/api/payments/options',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
  if(!response.ok)return;
  const data=await response.json();
  if(data?.enabled!==true||!Array.isArray(data.products)||data.products.length>500)return;
  const products=data.products.filter(validHomePlan);
  for(const type of Object.keys(homePlanRoutes)){
   const product=products.filter(item=>item.entitlementType===type).sort((a,b)=>a.priceCents-b.priceCents)[0];if(!product)continue;
   const price=summary.querySelector(`[data-home-plan-price="${type}"]`),detail=summary.querySelector(`[data-home-plan-detail="${type}"]`);
   const amount=(product.priceCents/100).toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
   if(price)price.textContent=`¥${amount} 起${type==='credits'?'':` / ${product.durationDays}天`}`;
   if(detail){
    const title=product.title.trim();
    if(type==='credits'){
     const credits=`${product.creditAmount.toLocaleString('zh-CN')} 科研积分`;
     const quantityTitle=[`${product.creditAmount}积分`,`${product.creditAmount}科研积分`].includes(title.replace(/[\s,，]/g,''));
     detail.textContent=quantityTitle?credits:`${title} · ${credits}`;
    }else detail.textContent=`${title} · 按所选商品权益使用`;
   }
  }
 }catch{}finally{clearTimeout(timeout);}
}
loadHomePlanSummary();
let serviceUser=null,serviceCapabilities=null;
function renderAccount(){
 const button=$('#account-button');
 const accountName=String(serviceUser?.name||serviceUser?.email||serviceUser?.phone||'我的账户');
 const displayName=Array.from(accountName).slice(0,16).join('');
 const initial=Array.from(accountName.trim())[0]?.toLocaleUpperCase()||'P';
 button.classList.toggle('is-signed-in',Boolean(serviceUser));
 button.innerHTML=serviceUser?`<span class="home-account-avatar" aria-hidden="true">${esc(initial)}</span><span class="home-account-name">${esc(displayName)}</span><svg class="home-account-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`:'登录';
 button.title=serviceUser?accountName:'登录 PaperKnow';
 button.setAttribute('aria-label',serviceUser?`打开 ${accountName} 的账户`:'登录 PaperKnow');
 document.querySelectorAll('[data-service-start]').forEach(a=>{a.href=serviceUser?'/workspace.html#home':'/auth.html?mode=register';if(a.id==='header-start')a.innerHTML=(serviceUser?'进入工作台':'开始使用')+' '+svg('arrow');});
 refreshNavigationLine();
}
$('#account-button').addEventListener('click',()=>{
 if(!serviceUser){location.href='/auth.html?mode=login';return;}
 openDialog('你的账户',`<p><b>${esc(serviceUser.name)}</b><br>${esc(serviceUser.email||serviceUser.phone||'')}</p><div class="account-links"><a class="button" href="/workspace.html#home">进入工作台 ${svg('arrow')}</a><a class="button outline" href="/workspace.html#projects?scope=account">项目与文件</a><a class="button outline" href="/workspace.html#assets?scope=account">文件管理</a><a class="button outline" href="/workspace.html#membership?scope=account">会员与订单</a>${serviceUser.role==='admin'?'<a class="button outline" href="/admin.html">管理后台</a>':''}<button class="text-button" id="service-logout">退出登录</button></div>`);
 $('#service-logout').onclick=async()=>{const b=$('#service-logout');b.disabled=true;try{const r=await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw new Error();serviceUser=null;closeDialog();location.reload();}catch{toast('退出未完成，请重试。');b.disabled=false;}};
});
async function loadServiceState(){
 await Promise.allSettled([
  (async()=>{try{const response=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});if(response.ok){const data=await response.json();serviceUser=data?.user&&typeof data.user==='object'&&!Array.isArray(data.user)?data.user:null;}}finally{renderAccount();}})(),
  (async()=>{const response=await fetch('/api/capabilities',{credentials:'same-origin',cache:'no-store'});if(response.ok)serviceCapabilities=await response.json();})()
 ]);
}
// Keep all capabilities visible, with one focused preview and direct workspace links.
const featureTabs=Array.from(document.querySelectorAll('[data-feature-tab]'));
const featurePanels=Array.from(document.querySelectorAll('[data-feature-panel]'));
const featureSection=$('#capabilities');
const featureMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const featureCompact=window.matchMedia('(max-width: 700px)');
let featureAutoplay=!featureMotion.matches,featureInView=false,featureHovered=false;
let featureTimer=null;
const featureDelay=5000;
function selectFeature(key,moveFocus=false){
 const selected=featureTabs.find(tab=>tab.dataset.featureTab===key);
 if(!selected||!featurePanels.some(panel=>panel.dataset.featurePanel===key))return;
 featureTabs.forEach(tab=>{
  const active=tab===selected;
  tab.setAttribute('aria-selected',String(active));
  tab.tabIndex=active?0:-1;
  tab.classList.toggle('is-active',active);
 });
 featurePanels.forEach(panel=>{
  const active=panel.dataset.featurePanel===key;
  panel.hidden=!active;
  panel.inert=!active;
  panel.setAttribute('aria-hidden',String(!active));
 });
 if(moveFocus)selected.focus();
 syncFeatureRotation();
}
function syncFeatureRotation(){
 clearTimeout(featureTimer);featureTimer=null;
 const focused=featureSection.contains(document.activeElement);
 const rotating=featureAutoplay&&!featureCompact.matches&&featureInView&&!featureHovered&&!focused&&!document.hidden&&!dialog.open;
 featureSection.dataset.rotation=rotating?'running':'paused';
 if(!rotating)return;
 featureTimer=setTimeout(()=>{
  const index=featureTabs.findIndex(tab=>tab.getAttribute('aria-selected')==='true');
  selectFeature(featureTabs[(index+1)%featureTabs.length].dataset.featureTab);
 },featureDelay);
}
featureTabs.forEach((tab,index)=>{
 tab.addEventListener('click',()=>selectFeature(tab.dataset.featureTab));
 tab.addEventListener('keydown',event=>{
  let next;
  if(event.key==='ArrowRight')next=(index+1)%featureTabs.length;
  else if(event.key==='ArrowLeft')next=(index-1+featureTabs.length)%featureTabs.length;
  else if(event.key==='Home')next=0;
  else if(event.key==='End')next=featureTabs.length-1;
  else return;
  event.preventDefault();
  selectFeature(featureTabs[next].dataset.featureTab,true);
 });
});
selectFeature(featureTabs.find(tab=>tab.getAttribute('aria-selected')==='true')?.dataset.featureTab||featureTabs[0]?.dataset.featureTab);
featureSection.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse'||event.pointerType==='pen'){featureHovered=true;syncFeatureRotation();}});
featureSection.addEventListener('pointerleave',()=>{featureHovered=false;syncFeatureRotation();});
featureSection.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'){featureAutoplay=false;syncFeatureRotation();}});
featureSection.addEventListener('focusin',syncFeatureRotation);
featureSection.addEventListener('focusout',()=>queueMicrotask(syncFeatureRotation));
document.addEventListener('visibilitychange',syncFeatureRotation);
new MutationObserver(syncFeatureRotation).observe(dialog,{attributes:true,attributeFilter:['open']});
featureMotion.addEventListener('change',()=>{featureAutoplay=!featureMotion.matches;syncFeatureRotation();});
featureCompact.addEventListener('change',syncFeatureRotation);
// Observe the card area rather than the full section, which is tall on mobile.
if('IntersectionObserver' in window){
 new IntersectionObserver(entries=>{featureInView=entries[0].isIntersecting&&entries[0].intersectionRatio>=.25;syncFeatureRotation();},{threshold:.25}).observe($('#feature-panels'));
}else{featureInView=true;syncFeatureRotation();}
const mainNav=$('#main-nav');
let navigationTarget=null;
function currentNavigationLink(){return mainNav.querySelector('a[aria-current="page"],a.nav-active')||mainNav.querySelector('a');}
function positionNavigationLine(link){
 navigationTarget=link;
 if(!link)return;
 const target=link.querySelector('.nav-link-label')||link;
 const targetRect=target.getBoundingClientRect(),navRect=mainNav.getBoundingClientRect();
 mainNav.style.setProperty('--nav-line-x',`${targetRect.left-navRect.left+mainNav.scrollLeft}px`);
 mainNav.style.setProperty('--nav-line-width',`${targetRect.width}px`);
}
function refreshNavigationLine(){positionNavigationLine(navigationTarget||currentNavigationLink());}
function restoreNavigationLine(){positionNavigationLine(currentNavigationLink());}
mainNav.addEventListener('pointerover',e=>{const link=e.target.closest('a');if(link&&mainNav.contains(link))positionNavigationLine(link);});
mainNav.addEventListener('focusin',e=>{const link=e.target.closest('a');if(link&&mainNav.contains(link))positionNavigationLine(link);});
mainNav.addEventListener('pointerleave',restoreNavigationLine);
mainNav.addEventListener('focusout',e=>{if(!e.relatedTarget||!mainNav.contains(e.relatedTarget))restoreNavigationLine();});
window.addEventListener('resize',refreshNavigationLine);
document.fonts?.ready?.then(refreshNavigationLine);
const productHeader=$('.product-header');
function syncHeaderScroll(){productHeader.classList.toggle('is-scrolled',window.scrollY>8);}
window.addEventListener('scroll',syncHeaderScroll,{passive:true});
restoreNavigationLine();syncHeaderScroll();
function closeMenus(restoreFocus=false){
 const open=$('#main-nav').classList.contains('mobile-open');
 $('#main-nav').classList.remove('mobile-open');
 $('#mobile-menu').setAttribute('aria-expanded','false');
 $('#mobile-menu').setAttribute('aria-label','打开菜单');
 if(open&&restoreFocus)$('#mobile-menu').focus();
}
$('#mobile-menu').addEventListener('click',()=>{const open=$('#main-nav').classList.toggle('mobile-open');$('#mobile-menu').setAttribute('aria-expanded',String(open));$('#mobile-menu').setAttribute('aria-label',open?'收起菜单':'打开菜单');});
document.addEventListener('click',e=>{if(e.target.closest('.product-header a'))closeMenus();else if(!e.target.closest('.product-header'))closeMenus();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus(true);});
// Preserve old saved-draft and tool URLs while routing them to the unified workspace.
const params=new URLSearchParams(location.search);const legacy=params.get('tool'),draft=params.get('draft');const ids=['writing','topic','proposal','summary','course','review','rewrite','reduce','aigc','reading','search','translation','ppt','format','journal','resume','research'];if(draft&&/^\d+$/.test(draft))location.replace('/workspace.html#draft/'+encodeURIComponent(draft));else if(legacy==='check')location.replace('/workspace.html#category/detection');else if(ids.includes(legacy))location.replace('/workspace.html#tool/'+legacy);
if(location.hash==='#writing')location.replace('/workspace.html#category/writing');
hydrate();renderAccount();loadServiceState();
