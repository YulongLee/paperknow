import {mountToolJobPanel} from './tool-job-panel.mjs';
import {toolBanner} from './tool-banner.mjs';
import {defaultRules,checkFormatting,validateRules,rulesFromTemplate,formatAdviceSnapshot} from './format-model.mjs';
import {suggestedFormatExclusions} from './format-presets.mjs';
import {keys,list,write,hasDraftScope} from './state.mjs';
import {esc,icon,download} from './ui.mjs';

let root=null,ctx,item,doc=null,bytes=null,rules=defaultRules(),candidate=null,verification=null;
let epoch=0,controller=null,panel=null,dirty=false,busy=false,progress={},error='',operation='',scoped=false,documentPromise=null;
const $=selector=>root?.querySelector(selector),mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function loadFormatDocument(){return documentPromise||=import('./assets/format-document.js').catch(reason=>{documentPromise=null;throw reason;});}
const to64=data=>{let text='';for(let i=0;i<data.length;i+=8192)text+=String.fromCharCode(...data.slice(i,i+8192));return btoa(text);};
const from64=text=>Uint8Array.from(atob(text),char=>char.charCodeAt(0));
const current=token=>token===epoch&&!!root?.isConnected;
const active=()=>progress.submitting||progress.busy||['queued','running'].includes(progress.status);
const hasTemplate=()=>!!item?.formatSample?.name&&Array.isArray(item.formatSample.imported)&&item.formatSample.imported.length>0;
const hasDocument=()=>!!bytes&&!!doc&&item?.example!==true;
const complete=()=>!!candidate&&(item?.layoutComplete===true||item?.legacyLayout===true);

export function disposeFormat(){if(dirty)saveFormat();epoch++;controller?.abort();controller=null;panel?.dispose();panel=null;root=null;busy=false;dirty=false;progress={};}
export const formatHasWork=()=>!!root?.isConnected&&(dirty||busy||active());
export function formatRouteGuard(){if(!root)return true;if(busy){ctx.notify?.('正在读取或排版文档，请稍候。');return false;}if(dirty&&!saveFormat()){ctx.notify?.('排版进度未能保存，请先下载原件后再离开。');return false;}return true;}
window.addEventListener('beforeunload',event=>{if(root&&dirty&&!saveFormat()){event.preventDefault();event.returnValue='';}});

export async function mountFormat(context,id,projectId){
 disposeFormat();const token=epoch;ctx=context;root=document.querySelector('.dashboard');controller=new AbortController();scoped=hasDraftScope();
 const rows=list(keys.drafts),saved=rows.find(row=>String(row.id)===String(id)&&row.tool==='format')||(!id?rows.filter(row=>row.tool==='format'&&row.formatting?.autoSession).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]:null);
 item=saved?structuredClone(saved):{title:'论文排版',projectId:projectId||'',example:false};rules={...defaultRules(),...saved?.formatting?.rules};doc=null;bytes=null;candidate=null;verification=null;error='';operation='';progress={};busy=false;dirty=false;
 if(saved?.formatting?.original&&saved.example!==true){busy=true;operation='restoring';}
 draw();bind();
 if(busy)try{
  const {parseDocx}=await loadFormatDocument();if(!current(token))return;const original=from64(saved.formatting.original),parsed=await parseDocx(original);if(!current(token))return;
  bytes=original;doc=parsed;doc.paragraphs.forEach((paragraph,index)=>{const level=saved.formatting.levels?.[index];if([0,1,2,3].includes(level))paragraph.level=level;paragraph.excluded=saved.formatting.excluded?.[index]===true;});
  item.documentHash=saved.documentHash||await fingerprint(original);if(!current(token))return;
  if(saved.formatting.applied){await prepareCandidate(token);if(!current(token))return;item.legacyLayout=saved.layoutVersion!==1;}
 }catch(reason){if(current(token)){error=reason.message||'原文读取失败，请重新上传 DOCX。';candidate=null;item.layoutComplete=false;}}
 finally{if(current(token)){busy=false;operation='';update();}}
 if(!current(token))return;mountAI();update();
 if(item.formatAIJob?.itemId&&hasDocument()&&hasTemplate()&&!complete()){
  try{busy=true;operation='restoring';update();await prepareCandidate(token);if(current(token)){busy=false;operation='';update();await panel.open();}}
  catch(reason){if(current(token)){busy=false;operation='';error=reason.message;update();}}
 }
}

function draw(){
 root.innerHTML=`<section class="format-space format-simple" data-format-step="1">${toolBanner('format',{title:'格式排版',description:'上传格式模板和论文，一键完成排版与复查。',extraClass:'detail-service-banner'})}<nav class="format-simple-workflow" data-format-workflow aria-label="格式排版操作流程"><div class="format-simple-workflow-heading"><strong>操作流程</strong><span data-format-position>第 1 步 / 共 3 步</span></div><ol>${[['上传模板','读取学校或期刊格式'],['上传论文','选择待排版的 Word'],['AI 排版','自动排版，完成后下载']].map(([title,description],index)=>`<li data-format-step-item="${index+1}"><span data-format-number>${String(index+1).padStart(2,'0')}</span><div><b>${title}</b><small>${description}</small></div></li>`).join('')}</ol></nav><section class="card format-simple-workspace"><div class="format-simple-uploads">${uploadCard('template','1','上传格式模板','学校或期刊提供的 DOCX 模板','上传格式模板 DOCX')}${uploadCard('paper','2','上传论文','需要排版的 DOCX 论文原件','上传论文 DOCX')}</div><div class="format-simple-start"><div><strong>准备好后，一键开始排版</strong><p>模板格式自动读取，论文原件保留。</p></div><button type="button" class="btn primary" data-action="apply">${icon('file',18)}<span data-format-run-label>开始 AI 排版</span></button></div><p class="format-simple-error" data-format-error role="alert" hidden></p><p class="format-simple-status" id="format-status" role="status" aria-live="polite"></p><div class="format-simple-wait" data-format-wait hidden role="status"><span aria-hidden="true"></span><div><strong data-format-wait-title></strong><p data-format-wait-detail></p></div></div><div id="format-ai-task" hidden></div></section><section data-format-result hidden></section></section>`;
}
function uploadCard(kind,number,title,description,label){
 return `<section class="format-simple-file" data-format-file-card="${kind}"><header><span>${number}</span><div><h2>${title}</h2><p>${description}</p></div></header><label class="format-simple-drop"><span class="format-simple-upload-icon">${icon('upload',27)}</span><strong data-format-file-name="${kind}">${kind==='template'?'选择格式模板':'选择论文文件'}</strong><span>DOCX · 最大 2MB</span><input id="${kind==='template'?'format-sample-file':'format-file'}" type="file" data-upload-presentation="off" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-label="${label}" data-file-library-label="从文件管理选择${kind==='template'?'模板':'论文'}"></label><p data-format-file-status="${kind}" role="status">尚未上传</p></section>`;
}
function bind(){
 const signal=controller.signal;root.addEventListener('change',event=>{if(event.target.id==='format-sample-file')void readInput(event.target.files?.[0],'template');if(event.target.id==='format-file')void readInput(event.target.files?.[0],'paper');},{signal});
 root.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;if(button.dataset.action==='apply')void startLayout();if(button.dataset.action==='export')void exportOutput();if(button.dataset.action==='original'&&bytes)void download(item.fileName||item.title+'-原件.docx',bytes,mime).catch(reason=>showError(reason.message));},{signal});
 root.querySelectorAll('[data-format-file-card]').forEach(card=>{card.addEventListener('dragover',event=>event.preventDefault(),{signal});card.addEventListener('drop',event=>{event.preventDefault();if(event.dataTransfer.files.length!==1)return showError('每次请选择一个 DOCX 文件。');void readInput(event.dataTransfer.files[0],card.dataset.formatFileCard);},{signal});});
}
function showError(message){error=message||'处理未完成，请重试。';ctx.notify?.(error);update();}
function update(){
 if(!root?.isConnected)return;const locked=busy||active(),ready=hasTemplate()&&hasDocument(),done=complete(),step=!hasTemplate()?1:!hasDocument()?2:3;
 const nav=$('[data-format-workflow]');nav.dataset.currentStep=String(step);nav.dataset.phase=error?'failed':operation||(['queued','running'].includes(progress.status)?progress.status:done?'complete':'ready');$('.format-simple').dataset.formatStep=String(step);$('[data-format-position]').textContent=`第 ${step} 步 / 共 3 步`;
 nav.querySelectorAll('[data-format-step-item]').forEach((node,index)=>{const n=index+1,isDone=n<step||done;node.classList.toggle('is-active',n===step);node.classList.toggle('is-completed',isDone);node.querySelector('[data-format-number]').textContent=isDone?'✓':String(n).padStart(2,'0');if(n===step)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');});
 for(const kind of ['template','paper']){
  const present=kind==='template'?hasTemplate():hasDocument(),name=kind==='template'?item.formatSample?.name:item.fileName||item.title+'.docx';
  $('[data-format-file-name="'+kind+'"]').textContent=present?name:kind==='template'?'选择格式模板':'选择论文文件';
  $('[data-format-file-status="'+kind+'"]').textContent=present?kind==='template'?'模板已读取，格式自动应用':`${doc.paragraphs.length} 个正文段落 · 原件保留`:'尚未上传';$('[data-format-file-card="'+kind+'"]').classList.toggle('has-file',present);
 }
 root.querySelectorAll('#format-sample-file,#format-file,.stored-file-trigger').forEach(node=>node.disabled=locked);
 const run=$('[data-action="apply"]');run.disabled=locked||!ready||scoped;$('.format-simple-start').hidden=done&&!locked;$('.format-simple').dataset.layoutComplete=String(done&&!locked);$('[data-format-run-label]').textContent=locked?'正在排版…':item.formatAIJob?.itemId&&!item.layoutComplete?'继续 AI 排版':'开始 AI 排版';
 const warning=$('[data-format-error]');warning.hidden=!error;warning.textContent=error;
 $('#format-status').textContent=error?'':operation==='rules'?'正在读取模板格式…':operation==='importing'?'正在读取论文…':operation==='formatting'?'正在生成并检查排版副本…':operation==='restoring'?'正在恢复排版进度…':progress.status==='queued'?'排版任务已提交，正在排队…':progress.status==='running'?'正在进行 AI 排版复核，进度会自动更新…':progress.submitting?'正在提交 AI 排版任务…':done?'排版与复查已完成，可以下载 Word。':ready?'两个文件已就绪，点击开始 AI 排版。':hasTemplate()?'模板已就绪，请上传需要排版的论文。':'先上传学校或期刊的格式模板。';
 const wait=$('[data-format-wait]');wait.hidden=!busy;$('[data-format-wait-title]').textContent=operation==='rules'?'正在读取模板':operation==='importing'?'正在读取论文':'正在处理排版';$('[data-format-wait-detail]').textContent='处理状态会自动更新，无需重复点击。';
 if(scoped){warning.hidden=false;warning.innerHTML='请在独立格式排版页面处理文档。<a href="#category/format">打开格式排版</a>';}
 renderResult();
}

async function fingerprint(data){const hash=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');}
function invalidate(){candidate=null;verification=null;item.layoutComplete=false;item.legacyLayout=false;delete item.formatAIJob;delete item.formatAdvice;panel?.dispose();panel=null;progress={};error='';}
async function readInput(file,kind){
 if(!file||busy||active())return;const token=epoch;if(!/\.docx$/i.test(file.name)||!file.size||file.size>2*1024*1024)return showError('请选择 2MB 以内的 DOCX 文档。');
 busy=true;operation=kind==='template'?'rules':'importing';error='';update();
 try{
  const {parseDocx}=await loadFormatDocument();if(!current(token))return;const incoming=new Uint8Array(await file.arrayBuffer()),parsed=await parseDocx(incoming);if(!current(token))return;
  if(parsed.blocked)throw Error('文档包含尚未处理的修订记录，请先在 Word 中接受或拒绝修订后重新上传。');
  if(kind==='template'){
   const result=rulesFromTemplate(parsed,defaultRules());if(!result.imported.includes('font')||!result.imported.includes('size'))throw Error('模板未识别出正文样式，请上传包含正文示例的 DOCX 格式模板。');
   invalidate();rules=result.rules;item.formatSample={name:file.name,imported:result.imported,unresolved:result.unresolved};
  }else{
   const hash=await fingerprint(incoming);if(!current(token))return;invalidate();bytes=incoming;doc=parsed;
   for(const suggestion of suggestedFormatExclusions(doc.paragraphs))doc.paragraphs[suggestion.index].excluded=true;
   item.fileName=file.name;item.title=file.name.replace(/\.docx$/i,'');item.example=false;item.documentHash=hash;
  }
  dirty=true;if(!saveFormat())throw Error('文件已读取，但进度暂未保存；请释放浏览器存储空间后重试。');mountAI();
 }catch(reason){if(current(token))showError(reason.message);}
 finally{if(current(token)){busy=false;operation='';update();}}
}

async function prepareCandidate(token){
 validateRules(rules);if(!hasDocument())throw Error('请先上传论文 DOCX。');if(doc.blocked)throw Error('请先在 Word 中处理文档修订记录。');
 const {applyDocx,parseDocx}=await loadFormatDocument();if(!current(token))return;const result=await applyDocx(bytes,doc,rules);if(!current(token))return;const parsed=await parseDocx(result);if(!current(token))return;
 if(parsed.paragraphs.length!==doc.paragraphs.length||parsed.paragraphs.some((paragraph,index)=>paragraph.text!==doc.paragraphs[index].text))throw Error('排版副本的正文完整性检查未通过，原件已保留。');
 parsed.paragraphs.forEach((paragraph,index)=>paragraph.excluded=doc.paragraphs[index].excluded===true);verification=checkFormatting(parsed,rules);
 if(verification.some(issue=>issue.status==='fix'))throw Error('副本格式复查未通过，请更换包含清晰正文样式的模板后重试。');candidate=result;
}
function snapshot(){
 if(!hasTemplate()||!hasDocument()||!candidate)throw Error('请先准备模板和论文，完成格式检查。');
 const value=formatAdviceSnapshot(item,doc,rules,'smart');value.title=(item.title+' · 排版复核').slice(0,200);value.context={...value.context,inputFingerprint:item.documentHash,templateName:item.formatSample.name,remainingIssues:verification?.length||0};return value;
}
function mountAI(){
 panel?.dispose();panel=null;if(!root||!hasDocument()||!hasTemplate()||scoped)return;const token=epoch;
 panel=mountToolJobPanel({container:$('#format-ai-task'),ctx,kind:'format',operation:'format',label:'AI 排版复核',showOutputPreview:false,autoApply:true,initialState:item.formatAIJob||{},isCurrent:()=>current(token),getProjectRef:()=>item.projectId||'',getSnapshot:snapshot,
  onProgressChange:state=>{if(!current(token))return;progress=state;if(state.hasError||['failed','cancelled'].includes(state.status))error=state.status==='cancelled'?'本次排版复核已停止，模板和论文均保留。':'AI 排版复核尚未完成，请查看下方原因后继续。';else if(state.submitting||['queued','running'].includes(state.status))error='';update();},
  onStateChange:state=>{if(!current(token))return;item.formatAIJob=state;dirty=true;if(!saveFormat())throw Error('排版进度暂未保存，本次尚未提交新的生成任务。');},
  onApply:(output,job)=>{if(!current(token))return;if(typeof output?.text!=='string'||!Array.isArray(output.suggestions)||!candidate)throw Error('排版复核结果不完整，请重试读取任务。');const before=item.layoutComplete;item.formatAdvice={text:output.text,suggestions:structuredClone(output.suggestions),jobId:job.id};item.layoutComplete=true;item.legacyLayout=false;dirty=true;if(!saveFormat()){item.layoutComplete=before;throw Error('排版结果暂未保存，请重试读取，不会重复生成或扣费。');}error='';update();ctx.notify?.('排版与复查已完成，可以下载 Word。');}
 });
}
async function startLayout(){
 if(busy||active()||complete())return;const token=epoch;error='';if(!hasTemplate()||!hasDocument())return showError('请先上传格式模板和论文 DOCX。');if(scoped)return showError('请打开独立格式排版页面处理。');
 busy=true;operation='formatting';update();
 try{await prepareCandidate(token);if(!current(token))return;dirty=true;if(!saveFormat())throw Error('排版进度暂未保存，尚未提交 AI 处理。');if(!panel)mountAI();busy=false;operation='';update();await panel.generate();}
 catch(reason){if(current(token))showError(reason.message);}
 finally{if(current(token)){busy=false;operation='';update();}}
}
function saveFormat(){
 if(!item||!root||scoped!==hasDraftScope())return false;
 try{
  const rows=list(keys.drafts),old=rows.find(row=>row.id===item.id),now=new Date().toISOString(),next={...item,id:item.id||crypto.randomUUID(),tool:'format',stage:complete()?'formatted':'draft',text:doc?.paragraphs.map(paragraph=>paragraph.text).join('\n\n')||'',createdAt:old?.createdAt||now,updatedAt:now,layoutVersion:1,formatting:{autoSession:true,original:bytes?to64(bytes):'',rules:{...rules},step:!hasTemplate()?1:!hasDocument()?2:3,service:'smart',template:'custom',checked:!!candidate,applied:complete(),levels:doc?.paragraphs.map(paragraph=>paragraph.level)||[],excluded:doc?.paragraphs.map(paragraph=>paragraph.excluded===true)||[]}};
  write(keys.drafts,old?rows.map(row=>row.id===next.id?next:row):[next,...rows]);item=next;dirty=false;return true;
 }catch{return false;}
}
function renderResult(){
 const host=$('[data-format-result]');if(!host)return;host.hidden=!complete();if(host.hidden){host.replaceChildren();delete host.dataset.resultKey;return;}
 const key=JSON.stringify([item.documentHash,rules,item.formatSample?.name,item.formatAdvice?.jobId,item.legacyLayout]);if(host.dataset.resultKey===key)return;host.dataset.resultKey=key;
 host.innerHTML=`<section class="card format-simple-result"><header><span class="format-simple-result-check">${icon('check',24)}</span><div><h2>${item.legacyLayout?'已保存的排版结果':'排版完成'}</h2><p>${esc(item.fileName||item.title+'.docx')}</p></div><button class="btn primary" type="button" data-action="export">${icon('download',17)}下载排版 Word</button></header><div class="format-simple-result-summary"><span>正文 ${doc.paragraphs.length} 段</span><span>原文完整性检查通过</span><span>排版副本已复查</span></div>${verification?.length?'<p class="format-simple-result-note">部分继承样式无法自动核定，下载后请对照模板检查。</p>':''}<h3>正文预览</h3><div class="format-simple-preview">${doc.paragraphs.slice(0,12).map(paragraph=>`<p class="${paragraph.level?'is-heading':''}" style="font-size:${Math.min(paragraph.level?rules['h'+paragraph.level]:rules.size,22)}pt">${esc(paragraph.text)}</p>`).join('')}</div><footer><span>图片、表格及实际分页以下载的 Word 为准。</span><button type="button" class="btn secondary" data-action="original">下载论文原件</button></footer></section>`;
}
async function exportOutput(){if(!complete())return showError('请先完成排版。');try{await download(item.title+'-排版.docx',candidate,mime);}catch(reason){showError(reason.message);}}
