import {captureDraftScope} from './state.mjs';
import {download} from './ui.mjs';
export const documentExportButtons=(prefix)=>`<button type="button" class="btn secondary" id="${prefix}-docx" data-document-export="docx" title="登录后保存到账户云文件并下载；游客仅本地下载">导出 DOCX</button><button type="button" class="btn secondary" id="${prefix}-pdf" data-document-export="pdf" title="登录后保存到账户云文件并下载；游客仅本地下载">导出 PDF</button>`;
let fontPromise;
async function font(){if(!fontPromise)fontPromise=fetch('/workspace/assets/fonts/NotoSansSC-Regular.otf').then(r=>{if(!r.ok)throw Error('中文字体加载失败，请稍后重试。');return r.arrayBuffer();}).catch(e=>{fontPromise=null;throw e;});return fontPromise;}
export function bindDocumentExports(prefix,getText,getTitle,status,{expectedUserId,isCurrent=()=>true,loadDocument=()=>import('./assets/writing-document.js'),loadFont=font,downloadFile=(...args)=>download(...args)}={}){
 const binding=captureDraftScope();
 for(const format of ['docx','pdf']){const b=document.getElementById(prefix+'-'+format);if(!b)continue;b.addEventListener('click',async()=>{
  const context=captureDraftScope(),current=()=>isCurrent()&&binding.isCurrent()&&context.isCurrent()&&b.isConnected&&status?.isConnected;
  if(!current())return;
  const text=getText(),title=getTitle()||'研究成果';if(!text.trim()){status.textContent='请先填写或生成需要导出的内容。';return;}
  const buttons=['docx','pdf'].map(f=>document.getElementById(prefix+'-'+f)).filter(Boolean),before=buttons.map(node=>node.disabled);buttons.forEach(node=>node.disabled=true);status.textContent=format==='pdf'?'正在生成 PDF，首次需要加载本地中文字体…':'正在生成 Word 文档…';
  try{const api=await loadDocument();if(!current())return;let bytes;if(format==='pdf'){const typeface=await loadFont();if(!current())return;bytes=await api.createWritingPdf(text,typeface);}else bytes=await api.createWritingDocx(text);if(!current())return;const exported=await downloadFile(title+'.'+format,bytes,format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',{expectedUserId:expectedUserId??context.ownerId});if(current())status.textContent=exported.message+' 请核对分页和最终格式。';}
  catch(error){if(current())status.textContent=error.message||'导出失败，请重试或使用 TXT 备份。';}
  finally{buttons.forEach((node,index)=>{if(node.isConnected&&current())node.disabled=before[index];});}
 });}
}
