import {captureDraftScope} from './state.mjs';
import {download} from './ui.mjs';
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
export function bindDocumentExports(prefix,getText,getTitle,status,{expectedUserId,isCurrent=()=>true,getDocumentOptions=()=>({}),loadDocument=()=>import('./assets/writing-document.js'),loadFont=font,downloadFile=(...args)=>download(...args)}={}){
 const binding=captureDraftScope();
 for(const format of ['docx','pdf']){const b=document.getElementById(prefix+'-'+format);if(!b)continue;b.addEventListener('click',async()=>{
  const context=captureDraftScope(),current=()=>isCurrent()&&binding.isCurrent()&&context.isCurrent()&&b.isConnected&&status?.isConnected;
  if(!current())return;
  const text=getText(),title=getTitle()||'研究成果';if(!text.trim()){status.textContent='请先填写或生成需要导出的内容。';return;}
  const buttons=['docx','pdf'].map(f=>document.getElementById(prefix+'-'+f)).filter(Boolean),before=buttons.map(node=>node.disabled);buttons.forEach(node=>node.disabled=true);status.textContent=format==='pdf'?'正在生成 PDF，首次需要加载本地中文字体…':'正在生成 Word 文档…';
  try{const api=await loadDocument();if(!current())return;let bytes,options={};if(format==='pdf'){const typeface=await loadFont();if(!current())return;bytes=await api.createWritingPdf(text,typeface);}else{options=await getDocumentOptions();if(!current())return;options={...options,template:await templateBytes(options?.template,expectedUserId??context.ownerId??options?.expectedUserId)};if(!current())return;bytes=await api.createWritingDocx(text,options);}if(!current())return;const exported=await downloadFile(title+'.'+format,bytes,format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',{expectedUserId:expectedUserId??context.ownerId??options?.expectedUserId});if(current())status.textContent=exported.message+(format==='docx'&&options?.documentKind==='thesis'?' 已按'+(options.template?'上传模板':'通用学位论文模板')+'排版；目录请在 Word/WPS 中更新域，并核对最终分页。':' 请核对分页和最终格式。');}
  catch(error){if(current())status.textContent=error.message||'导出失败，请重试或使用 TXT 备份。';}
  finally{buttons.forEach((node,index)=>{if(node.isConnected&&current())node.disabled=before[index];});}
 });}
}
