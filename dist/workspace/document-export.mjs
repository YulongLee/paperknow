import {captureDraftScope} from './state.mjs';
import {download} from './ui.mjs';
import {renderThesisDocument,showThesisExportCheck} from './thesis-export-render.mjs';
export const documentExportButtons=(prefix,{submission=false,docxOnly=submission}={})=>`<button type="button" class="btn secondary" id="${prefix}-docx" data-document-export="docx" title="登录后保存到账户云文件并下载；游客仅本地下载">${submission?'终稿检查并导出 DOCX':'导出 DOCX'}</button>${docxOnly?'':`<button type="button" class="btn secondary" id="${prefix}-pdf" data-document-export="pdf" title="登录后保存到账户云文件并下载；游客仅本地下载">${submission?'终稿检查并导出 PDF':'导出 PDF'}</button>`}${submission?`<button type="button" class="btn secondary" id="${prefix}-draft" data-document-export="draft">下载可编辑初稿</button>`:''}`;
let fontPromise;
async function font(){if(!fontPromise)fontPromise=fetch('/workspace/assets/fonts/NotoSansSC-Regular.otf').then(r=>{if(!r.ok)throw Error('中文字体加载失败，请稍后重试。');return r.arrayBuffer();}).catch(e=>{fontPromise=null;throw e;});return fontPromise;}
async function templateBytes(template,ownerId){
 if(!template)return null;
 if(template.status==='unavailable'||!template.source?.fileId||!ownerId)throw Error('所选模板原件不可用，请重新上传或明确切换为通用模板。');
 const response=await fetch('/api/files/'+encodeURIComponent(template.source.fileId)+'/download?'+new URLSearchParams({expectedUserId:ownerId}),{credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw Error('无法读取所选模板，请重新登录并核对模板原件，或切换为通用模板。');
 const limit=2*1024*1024;if(Number(response.headers.get('Content-Length'))>limit)throw Error('DOCX 模板不能超过 2 MB。');
 const reader=response.body?.getReader();let bytes;
 if(reader){const chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('DOCX 模板不能超过 2 MB。');}chunks.push(value);}}finally{reader.releaseLock();}bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}}
 else bytes=new Uint8Array(await response.arrayBuffer());
 if(!bytes.length||bytes.length>limit||bytes.length!==template.source.size)throw Error('所选模板文件大小已变化，请重新上传。');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
 if(hash!==template.source.sha256)throw Error('所选模板完整性核验失败，请重新上传。');
 return {...template,bytes};
}
export async function downloadDefaultThesisTemplate({expectedUserId,metadata={},status,isCurrent=()=>true,loadDocument=()=>import('./assets/writing-document.js'),downloadFile=(...args)=>download(...args)}={}){
 const scope=captureDraftScope(),current=()=>isCurrent()&&scope.isCurrent()&&(!status||status.isConnected);
 try{if(status)status.textContent='正在准备通用论文模板…';const api=await loadDocument();if(!current())return;const bytes=await api.createWritingDocx('{{论文题目}}\n{{正文}}',{documentKind:'thesis',metadata:{...metadata,title:'{{论文题目}}',institution:'{{学校}}',author:'{{作者}}',major:'{{专业}}',supervisor:'{{指导教师}}'}});if(!current())return;const result=await downloadFile('通用学位论文模板.docx',bytes,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',{expectedUserId:expectedUserId??scope.ownerId});if(current()&&status)status.textContent=result.message+' 可调整样式后上传；请保留 {{正文}} 占位符。';return result;}
 catch(error){if(current()&&status)status.textContent=error.message||'模板下载失败，请稍后重试。';}
}
export function bindDocumentExports(prefix,getText,getTitle,status,{expectedUserId,docxOnly=false,isCurrent=()=>true,getDocumentOptions=()=>({}),loadDocument=()=>import('./assets/writing-document.js'),loadFont=font,downloadFile=(...args)=>download(...args),renderDocument=renderThesisDocument,onNeedsCompletion}={}){
 const binding=captureDraftScope(),keys=docxOnly?['docx','draft']:['docx','pdf','draft'];
 for(const key of keys){const format=key==='draft'?'docx':key,draft=key==='draft',b=document.getElementById(prefix+'-'+key);if(!b)continue;b.addEventListener('click',async()=>{
  const context=captureDraftScope(),current=()=>isCurrent()&&binding.isCurrent()&&context.isCurrent()&&b.isConnected&&status?.isConnected;
  if(!current())return;
  const text=getText({draft}),title=getTitle()||'研究成果';if(!text.trim()){status.textContent='请先填写或生成需要导出的内容。';return;}
  const buttons=keys.map(f=>document.getElementById(prefix+'-'+f)).filter(Boolean),before=buttons.map(node=>node.disabled);buttons.forEach(node=>node.disabled=true);status.textContent='正在准备导出文档，请稍候…';
  const controller=new AbortController(),watch=setInterval(()=>{if(!current())controller.abort();},500);
  try{
   const api=await loadDocument();if(!current())return;let bytes,options=await getDocumentOptions({draft});if(!current())return;options=options||{};
   const owner=expectedUserId??context.ownerId??options.expectedUserId;
   if(options.documentKind==='thesis'){
    status.textContent='1 / 3 · 正在读取模板要求并检查已保存正文…';
    options={...options,template:await templateBytes(options.template,owner)};if(!current())return;
    const profile=options.template?await api.inspectThesisDocxTemplate?.(options.template.bytes):api.defaultThesisTemplateProfile?.();if(!current())return;
    const formal=options.submission===true&&!draft;
    if(formal&&profile?.requirements?.ambiguities?.length)throw Error('模板中存在相互冲突的格式要求，请确认后重新选择模板；可下载初稿继续修改。');
    if(formal&&typeof api.auditThesisSubmission!=='function')throw Error('终稿检查组件尚未就绪，请刷新后重试，或下载可编辑初稿。');
    const report=(formal?api.auditThesisSubmission:api.auditThesisExport)?.({text,metadata:options.metadata,templateProfile:profile,quality:options.quality})||{status:'review_required',checks:[],warnings:[]};
    showThesisExportCheck(status,report,{templateMode:profile?.placement?.mode||'default'});
    if(formal&&!report.submission?.ready){const panel=status.parentElement.querySelector('[data-export-check]');if(panel)panel.open=!onNeedsCompletion;if(onNeedsCompletion){await onNeedsCompletion({report});if(!current())return;throw Error('终稿还需要补充资料。已展开下方补充窗口，系统会根据新增材料完善正文并重新检查。');}throw Error('尚未满足终稿导出条件：'+(report.submission?.issues||[]).slice(0,3).map(row=>row.message).join('；')+' 可下载可编辑初稿继续修改。');}
    status.textContent='2 / 3 · 正在按模板排版正文、标题、图表与公式…';let docx=await api.createWritingDocx(text,options);if(!current())return;
    let formatting=null;const verifyContent=bytes=>api.inspectThesisExportContent?.(bytes,text,options);const progress=event=>{if(current())status.textContent=event.stage==='repair'?`3 / 3 · 第 ${event.pass} 轮修正：正在处理 ${event.count} 项格式差异…`:`3 / 3 · 第 ${event.pass} 轮检查：核对字体、字号、行距、标题、页边距和表格…`;};if(api.runThesisLayoutAgent){formatting=await api.runThesisLayoutAgent(docx,{profile,verifyContent,onProgress:progress,signal:controller.signal});docx=formatting.bytes;if(formal&&formatting.report.unresolved.length){if(onNeedsCompletion)await onNeedsCompletion({report,formatting:formatting.report});throw Error('尚有模板要求未完成：'+formatting.report.unresolved.slice(0,3).map(row=>row.message).join('；')+' 请在补充窗口提供资料，由系统完善后重新检查。');}}
    const content=await verifyContent(docx);if(!current())return;
    const outputPending=Number.isSafeInteger(content?.unresolvedPlaceholders)&&content.unresolvedPlaceholders>=0?content.unresolvedPlaceholders:0,pendingRow=report.checks.find(row=>row.id==='unresolved_placeholders'),pendingCount=Math.max(outputPending,Number.isSafeInteger(pendingRow?.count)?pendingRow.count:0,Number.isSafeInteger(report.counts?.unresolvedPlaceholders)?report.counts.unresolvedPlaceholders:0);
    if(pendingCount){const message=`导出文档有 ${pendingCount} 处待补充或待核对标记，含模板补入的未填写项目；请核对后再交付。`;if(pendingRow)Object.assign(pendingRow,{status:'review_required',message,count:pendingCount});else report.checks.push({id:'unresolved_placeholders',label:'待补充标记',status:'review_required',message,count:pendingCount});report.counts={...report.counts,unresolvedPlaceholders:pendingCount};report.warnings=report.warnings.filter(row=>row?.code!=='unresolved_placeholders');report.warnings.push({code:'unresolved_placeholders',message,count:pendingCount});report.status='review_required';report.summary='本次导出检查发现文档仍有待补充标记，请核对模板未填写项目后再交付。';}
    showThesisExportCheck(status,report,{content,templateMode:profile?.placement?.mode||'default'});
    if(formal&&pendingCount){if(onNeedsCompletion)await onNeedsCompletion({report,additional:[`模板中仍有 ${pendingCount} 处未填写内容，请补充对应信息。`]});throw Error('终稿还有未填写内容，请在补充窗口提供信息，系统将重新处理。');}
    let layout=null;
    try{for(let round=1;round<=3;round++){status.textContent=`3 / 3 · 第 ${round} 轮页面检查：正在生成实际页面并更新目录与页码…`;layout=await renderDocument(docx,{expectedUserId:owner,signal:controller.signal});if(!current())return;if(!layout?.docxBytes||!api.runThesisLayoutAgent)break;const checked=await api.runThesisLayoutAgent(layout.docxBytes,{profile,verifyContent,onProgress:progress,signal:controller.signal});formatting=checked;if(checked.report.iterations.length===1){layout.docxBytes=checked.bytes;break;}if(round===3)throw Error('页面生成后的格式仍有变化，已保留正文；请核对模板后重新导出。');docx=checked.bytes;layout=null;}}
    catch(error){if(format==='pdf'||formal)throw error;report.warnings.push({code:'layout_not_rendered',message:error.message||'页面渲染尚未完成。'});}
    if(formatting?.report){report.checks.push({id:'template_layout',label:'模板排版核对',status:formatting.report.unresolved.length?'review_required':'checked',message:`已核对 ${formatting.report.checks.paragraphs} 段、${formatting.report.checks.sections} 个正文分节和 ${formatting.report.checks.tables} 个表格；明确规则内的格式差异已检查并修正。`});if(formatting.report.unresolved.length){report.status='review_required';report.warnings.push(...formatting.report.unresolved.map(row=>({code:row.id||'layout_rule_unresolved',message:row.message})));}}if(!current())return;showThesisExportCheck(status,report,{layout,content,templateMode:profile?.placement?.mode||'default'});
    if(formal&&(!layout?.fieldsRefreshed||format==='docx'&&!layout?.docxBytes))throw Error('目录与页码的 Word 更新尚未完成，暂不交付终稿；请稍后重试，或下载可编辑初稿。');
    bytes=format==='pdf'?layout.bytes:layout?.docxBytes||docx;
    status.textContent='检查记录已准备，正在保存导出文件…';
    const exported=await downloadFile(title+(draft?'（初稿）':'')+'.'+format,bytes,format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',{expectedUserId:owner});
    if(current())status.textContent=exported.message+' '+(layout?`本次已生成 ${layout.pages} 页，请核对 Word 中的最终版式。`:'本次页面渲染未完成；已保留可编辑 Word，请核对版式。')+(report.status==='review_required'?' 存在待核对事项，请展开“本次导出检查”。':' 已完成本次规则检查，请核对最终版式。');
   }else if(options.documentKind==='writing'&&format==='docx'){
    status.textContent='1 / 3 · 正在检查文档内容并整理结构…';
    let docx=await api.createWritingDocx(text,options);if(!current())return;
    const profile=api.defaultWritingTemplateProfile?.(),verifyContent=bytes=>api.inspectThesisExportContent?.(bytes,text,options);
    if(!profile||!api.runThesisLayoutAgent||!api.inspectThesisExportContent)throw Error('文档检查组件未就绪，请刷新后重试。');
    const progress=event=>{if(current())status.textContent=`2 / 3 · 第 ${event.pass} 轮${event.stage==='repair'?'修正':'检查'}：整理标题、正文、行距与表格…`;};
    let checked=await api.runThesisLayoutAgent(docx,{profile,verifyContent,onProgress:progress,signal:controller.signal});docx=checked.bytes;if(!current())return;
    if(!draft&&checked.report.unresolved.length){await onNeedsCompletion?.({additional:checked.report.unresolved.map(row=>row.message)});throw Error('文档仍有待完善内容，已保留原稿，请在补充窗口提供资料后由系统继续处理。');}
    await verifyContent(docx);if(!current())return;
    let layout=null;if(!draft){for(let round=1;round<=3;round++){status.textContent=`3 / 3 · 第 ${round} 轮实际页面检查，请稍候…`;layout=await renderDocument(docx,{expectedUserId:owner,signal:controller.signal});if(!current())return;if(!layout?.docxBytes||!layout.fieldsRefreshed)throw Error('实际页面检查尚未完成，请稍后重试；当前内容已保留，也可下载可编辑初稿。');checked=await api.runThesisLayoutAgent(layout.docxBytes,{profile,verifyContent,onProgress:progress,signal:controller.signal});if(checked.report.iterations.length===1&&!checked.report.unresolved.length){layout.docxBytes=checked.bytes;break;}if(round===3)throw Error('页面格式尚未稳定，请稍后重试；已保存内容仍保留。');docx=checked.bytes;}await verifyContent(layout.docxBytes);}
    if(!current())return;const exported=await downloadFile(title+(draft?'（初稿）':'')+'.docx',layout?.docxBytes||docx,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',{expectedUserId:owner});if(current())status.textContent=exported.message+(layout?` 已完成内容与实际页面检查，共 ${layout.pages} 页。`:' 已保留可编辑初稿。');
   }else{
    if(format==='pdf'){const typeface=await loadFont();if(!current())return;bytes=await api.createWritingPdf(text,typeface);}else bytes=await api.createWritingDocx(text,options);
    if(!current())return;const exported=await downloadFile(title+'.'+format,bytes,format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',{expectedUserId:owner});if(current())status.textContent=exported.message+' 请核对分页和最终格式。';
   }
  }
  catch(error){if(current())status.textContent=error.message||(docxOnly?'导出失败，请稍后重试，已保存正文仍保留。':'导出失败，请重试或使用 TXT 备份。');}
  finally{clearInterval(watch);controller.abort();buttons.forEach((node,index)=>{if(node.isConnected&&current())node.disabled=before[index];});}
 });}
}
