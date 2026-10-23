import {captureDraftScope} from './state.mjs';
import {download} from './ui.mjs';
import {renderThesisDocument,showThesisExportCheck} from './thesis-export-render.mjs';
export const documentExportButtons=(prefix)=>`<button type="button" class="btn secondary" id="${prefix}-docx" data-document-export="docx" title="登录后保存到账户云文件并下载；游客仅本地下载">导出 DOCX</button><button type="button" class="btn secondary" id="${prefix}-pdf" data-document-export="pdf" title="登录后保存到账户云文件并下载；游客仅本地下载">导出 PDF</button>`;
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
export function bindDocumentExports(prefix,getText,getTitle,status,{expectedUserId,isCurrent=()=>true,getDocumentOptions=()=>({}),loadDocument=()=>import('./assets/writing-document.js'),loadFont=font,downloadFile=(...args)=>download(...args),renderDocument=renderThesisDocument}={}){
 const binding=captureDraftScope();
 for(const format of ['docx','pdf']){const b=document.getElementById(prefix+'-'+format);if(!b)continue;b.addEventListener('click',async()=>{
  const context=captureDraftScope(),current=()=>isCurrent()&&binding.isCurrent()&&context.isCurrent()&&b.isConnected&&status?.isConnected;
  if(!current())return;
  const text=getText(),title=getTitle()||'研究成果';if(!text.trim()){status.textContent='请先填写或生成需要导出的内容。';return;}
  const buttons=['docx','pdf'].map(f=>document.getElementById(prefix+'-'+f)).filter(Boolean),before=buttons.map(node=>node.disabled);buttons.forEach(node=>node.disabled=true);status.textContent='正在准备导出文档，请稍候…';
  const controller=new AbortController(),watch=setInterval(()=>{if(!current())controller.abort();},500);
  try{
   const api=await loadDocument();if(!current())return;let bytes,options=await getDocumentOptions();if(!current())return;options=options||{};
   const owner=expectedUserId??context.ownerId??options.expectedUserId;
   if(options.documentKind==='thesis'){
    status.textContent='正在识别模板并检查已保存正文…';
    options={...options,template:await templateBytes(options.template,owner)};if(!current())return;
    const profile=options.template?await api.inspectThesisDocxTemplate?.(options.template.bytes):api.defaultThesisTemplateProfile?.();if(!current())return;
    const report=api.auditThesisExport?.({text,metadata:options.metadata,templateProfile:profile,quality:options.quality})||{status:'review_required',checks:[],warnings:[]};
    showThesisExportCheck(status,report,{templateMode:profile?.placement?.mode||'default'});
    status.textContent='正在保留模板结构并生成 Word 文档…';const docx=await api.createWritingDocx(text,options);if(!current())return;
    const content=await api.inspectThesisExportContent?.(docx,text);if(!current())return;
    const outputPending=Number.isSafeInteger(content?.unresolvedPlaceholders)&&content.unresolvedPlaceholders>=0?content.unresolvedPlaceholders:0,pendingRow=report.checks.find(row=>row.id==='unresolved_placeholders'),pendingCount=Math.max(outputPending,Number.isSafeInteger(pendingRow?.count)?pendingRow.count:0,Number.isSafeInteger(report.counts?.unresolvedPlaceholders)?report.counts.unresolvedPlaceholders:0);
    if(pendingCount){const message=`导出文档有 ${pendingCount} 处待补充或待核对标记，含模板补入的未填写项目；请核对后再交付。`;if(pendingRow)Object.assign(pendingRow,{status:'review_required',message,count:pendingCount});else report.checks.push({id:'unresolved_placeholders',label:'待补充标记',status:'review_required',message,count:pendingCount});report.counts={...report.counts,unresolvedPlaceholders:pendingCount};report.warnings=report.warnings.filter(row=>row?.code!=='unresolved_placeholders');report.warnings.push({code:'unresolved_placeholders',message,count:pendingCount});report.status='review_required';report.summary='本次导出检查发现文档仍有待补充标记，请核对模板未填写项目后再交付。';}
    showThesisExportCheck(status,report,{content,templateMode:profile?.placement?.mode||'default'});
    let layout=null;
    try{status.textContent='正在生成实际页面并核对同版 PDF，请稍候…';layout=await renderDocument(docx,{expectedUserId:owner,signal:controller.signal});}
    catch(error){if(format==='pdf')throw error;report.warnings.push({code:'layout_not_rendered',message:error.message||'页面渲染尚未完成。'});}
    if(!current())return;showThesisExportCheck(status,report,{layout,content,templateMode:profile?.placement?.mode||'default'});
    bytes=format==='pdf'?layout.bytes:docx;
    status.textContent='检查记录已准备，正在保存导出文件…';
    const exported=await downloadFile(title+'.'+format,bytes,format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',{expectedUserId:owner});
    if(current())status.textContent=exported.message+' '+(layout?`本次已生成 ${layout.pages} 页，PDF 与 Word 使用同一排版文档。`:'本次页面渲染未完成；已保留可编辑 Word，请核对版式。')+(report.status==='review_required'?' 存在待核对事项，请展开“本次导出检查”。':' 已完成本次规则检查，请核对最终版式。');
   }else{
    if(format==='pdf'){const typeface=await loadFont();if(!current())return;bytes=await api.createWritingPdf(text,typeface);}else bytes=await api.createWritingDocx(text,options);
    if(!current())return;const exported=await downloadFile(title+'.'+format,bytes,format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',{expectedUserId:owner});if(current())status.textContent=exported.message+' 请核对分页和最终格式。';
   }
  }
  catch(error){if(current())status.textContent=error.message||'导出失败，请重试或使用 TXT 备份。';}
  finally{clearInterval(watch);controller.abort();buttons.forEach((node,index)=>{if(node.isConnected&&current())node.disabled=before[index];});}
 });}
}
