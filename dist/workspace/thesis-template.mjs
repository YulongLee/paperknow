import {reuseStoredOriginal} from './file-selection.mjs';
import {thesisDocumentPresentation} from './thesis-document.mjs';
import {thesisEnglishTitle} from './thesis-delivery.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const thesisTemplateMaxBytes=2*1024*1024;
export function draftThesisTemplate(draft={}){
 const value=draft.exportTemplate;
 if(value?.status==='unavailable'&&!value.source?.fileId)return {version:1,source:null,status:'unavailable'};
 if(!value||typeof value!=='object'||!value.source||typeof value.source.fileId!=='string'||!value.source.fileId.trim())return null;
 return {version:1,source:{fileId:value.source.fileId,name:String(value.source.name||'学校格式模板.docx'),sha256:String(value.source.sha256||''),size:Number(value.source.size)||0},...(value.profile&&typeof value.profile==='object'?{profile:structuredClone(value.profile)}:{}),status:value.status==='unavailable'?'unavailable':'ready'};
}
export function thesisExportMetadata(value={},options={}){
 const snapshot=value.snapshot||value,profile=snapshot.profile||value.profile||{},requirements=snapshot.requirements||{};
 const chapterTitles=(value.chapters||snapshot.outline||value.outlineRows||[]).filter(row=>row.level===undefined||Number(row.level)===1).map(row=>String(row.title||'').trim()).filter(Boolean);
 const title=String(value.title||snapshot.title||''),presentation=Array.isArray(value.chapters)?thesisDocumentPresentation(snapshot,value.chapters,{title,...options}):null,citationRanges=presentation?.citationRanges;
 return {title,...(thesisEnglishTitle(value.chapters)?{englishTitle:thesisEnglishTitle(value.chapters)}:{}),level:String(profile.level||value.degree||''),major:String(profile.major||profile.discipline||value.major||''),institution:String(requirements.institution||value.institution||''),supervisor:String(requirements.supervisor||value.supervisor||''),author:String(value.author||requirements.author||''),...(value.exportMetadata||{}),chapterTitles,...(citationRanges?{citationRanges}:{}),...(presentation?.figures?.length?{figures:presentation.figures}:{})};
}
export function templateSelectionFailureMessage(error){
 const reason=typeof error?.message==='string'&&error.message.trim()?error.message.trim():'模板保存未完成，请重试。';
 const recovery=error?.status===409?'本次未覆盖其他页面的模板选择，请核对后重新选择 DOCX 文件。':'原有模板保持不变，可以重新选择其他 DOCX 文件。';
 return reason+(/[。！？.!?]$/.test(reason)?'':'。')+' '+recovery;
}
const openTemplateChoosers=new WeakMap();
export const thesisTemplateChooserOpen=root=>!![...(root?.querySelectorAll('[data-template-file]')||[])].find(input=>input.isConnected&&openTemplateChoosers.has(input));
export function openThesisTemplateChooser(panel,{onClose=()=>{}}={}){
 const input=panel?.querySelector('[data-template-file]'),status=panel?.querySelector('[data-template-status]');
 if(!input?.isConnected||input.disabled)return false;
 if(openTemplateChoosers.has(input))return true;
 const doc=input.ownerDocument,win=doc.defaultView;let focusTimer;
 const close=()=>{if(!openTemplateChoosers.delete(input))return;input.removeEventListener('change',close);input.removeEventListener('cancel',close);doc.removeEventListener('pointerdown',close,true);doc.removeEventListener('keydown',close,true);win.removeEventListener('focus',focused);win.removeEventListener('hashchange',close);win.removeEventListener('pagehide',close);win.clearTimeout(focusTimer);queueMicrotask(()=>{if(panel.isConnected)onClose();});};
 const focused=()=>{focusTimer=win.setTimeout(close,0);};
 openTemplateChoosers.set(input,close);input.addEventListener('change',close);input.addEventListener('cancel',close);doc.addEventListener('pointerdown',close,true);doc.addEventListener('keydown',close,true);win.addEventListener('focus',focused);win.addEventListener('hashchange',close);win.addEventListener('pagehide',close);
 try{
  input.value='';
  // Open the native picker within the original user gesture, with a fallback
  // for browsers that do not expose showPicker.
  if(typeof input.showPicker==='function')input.showPicker();else input.click();
  if(status)status.textContent='请选择新的 DOCX 学校模板；取消选择会保留当前模板。';
  return true;
 }catch{
  close();
  if(status)status.textContent='浏览器未能打开文件选择窗口，请重试，或使用“从文件管理选择”。当前模板保持不变。';
  return false;
 }
}
export function thesisTemplatePanel(template,{legacyName='',prefix='thesis',busy=false}={}){
 const placement=template?.profile?.placement;
 const selected=!!template?.source?.fileId,unavailable=template?.status==='unavailable',summary=Array.isArray(template?.profile?.summary)?template.profile.summary:[],warnings=Array.isArray(template?.profile?.warnings)?template.profile.warnings:[],legacy=!selected&&!unavailable&&String(legacyName||'').trim();
 return `<section class="thesis-template-picker" data-template-panel="${escape(prefix)}" aria-label="Word 导出模板" aria-busy="${busy?'true':'false'}"><div class="thesis-template-current"><span class="thesis-template-icon" aria-hidden="true">▤</span><div><small>Word 导出模板</small><strong title="${escape(selected?template.source.name:unavailable?'学校模板暂不可用':'通用学位论文模板（默认）')}">${escape(selected?template.source.name:unavailable?'学校模板暂不可用':'通用学位论文模板（默认）')}</strong><p>${unavailable?'所选模板暂不可读取，请重新上传或明确恢复默认后导出。':selected?(placement?.preservesTemplate?'保留模板封面与分节，在正文区域填入内容；导出前检查正文、分页、目录与页码。':placement?.mode==='rules_only'?'此文件仅提供样式规则，导出使用通用封面与目录。':placement?.mode==='ambiguous'?'未能可靠定位模板正文，请调整模板或选择其他文件后导出。':'导出时重新识别模板正文位置，并列出本次检查结果。'):'包含封面、目录与论文正文样式，可直接导出后完善。'}</p></div></div><div class="thesis-template-actions"><input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" data-template-file hidden ${busy?'disabled':''}><button type="button" class="btn secondary" data-template-choose data-thesis-template-choose ${busy?'disabled':''}>${selected||unavailable?'替换模板':'选择学校模板'}</button>${selected||unavailable||legacy?`<button type="button" class="btn secondary" data-template-clear data-thesis-template-clear ${busy?'disabled':''}>恢复默认</button>`:''}<button type="button" class="btn secondary" data-template-download data-thesis-template-download ${busy?'disabled':''}>下载通用模板</button></div>${legacy?`<p class="thesis-template-legacy" role="note">旧草稿仅记录了“${escape(legacyName)}”的文件名，尚未套用 Word 样式；如需使用，请重新上传 DOCX。</p>`:''}<details class="thesis-template-details" data-thesis-view-key="export-template-${escape(prefix)}"><summary tabindex="0" data-thesis-template-summary>模板适用范围与识别结果</summary><div><p>学校模板仅支持 DOCX，最大 2MB。格式选择不重新生成正文，不扣写作费用。</p>${summary.length?`<ul>${summary.map(row=>`<li>${escape(row)}</li>`).join('')}</ul>`:selected?'<p>导出时识别原件中的页面、字体、段落、标题与页眉页脚设置。</p>':''}${warnings.length?`<ul class="thesis-template-warnings">${warnings.map(row=>`<li>${escape(typeof row==='string'?row:row?.message||'部分模板设置需人工核对。')}</li>`).join('')}</ul>`:''}<p>系统读取 DOCX 中实际定义的样式；仅写在说明文字中的格式要求，请先落实到模板样式中。优先保留原模板包、封面、分节与页眉页脚，替换明确识别的正文样例。可使用独立段落 {{正文}} 指定填入位置；无法可靠定位时会停止套用，不会静默替换学校版式。只有纯样式文件才使用通用封面。导出时执行正文规则与文字完整性检查，核对分页并更新 Word 目录与页码，交付可编辑的 DOCX 文件。已有 AI 辅助审校的完成范围和过期状态单独显示，不会把规则检查说成 AI 审校。请在 Word/WPS 中核对目录、页码和最终版式；不同设备的字体与分页可能存在差异。</p></div></details><p data-template-status role="status" aria-live="polite"></p></section>`;
}
async function fileBytes(file){
 if(typeof file.arrayBuffer==='function')return new Uint8Array(await file.arrayBuffer());
 return new Promise((resolve,reject)=>{const Reader=globalThis.FileReader||globalThis.window?.FileReader,reader=new Reader();reader.onload=()=>resolve(new Uint8Array(reader.result));reader.onerror=()=>reject(Error('模板文件读取失败，请重新选择。'));reader.readAsArrayBuffer(file);});
}
export async function uploadThesisTemplate(file,{api,expectedUserId,projectId,isCurrent=()=>true,inspectTemplate=async bytes=>(await import('./assets/writing-document.js')).inspectThesisDocxTemplate(bytes)}={}){
 if(!expectedUserId)throw Error('请先登录，再上传学校模板。');
 if(!file||!/\.docx$/i.test(file.name))throw Error('Word 样式模板仅支持 DOCX，请选择学校提供的 DOCX 格式模板。');
 if(!file.size||file.size>thesisTemplateMaxBytes)throw Error('DOCX 格式模板最大 2MB，请精简后上传。');
 const bytes=await fileBytes(file);if(!isCurrent())throw new DOMException('页面已切换','AbortError');
 if(bytes.length!==file.size||bytes[0]!==80||bytes[1]!==75)throw Error('文件不是有效的 DOCX，请从 Word 重新另存后上传。');
 const profile=await inspectTemplate(bytes);if(!isCurrent())throw new DOMException('页面已切换','AbortError');
 if(!profile||profile.version!==1||!Array.isArray(profile.recognized)||!profile.recognized.length)throw Error('未识别到可用的 Word 排版规则，请上传含正文样式的 DOCX 模板。');
 const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);if(!isCurrent())throw new DOMException('页面已切换','AbortError');
 const sha256=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');let binary='';for(let index=0;index<bytes.length;index+=8192)binary+=String.fromCharCode(...bytes.subarray(index,index+8192));
 const value=await reuseStoredOriginal(file,{api,expectedUserId,projectId})||await api('/files',{name:file.name,data:btoa(binary),expectedUserId,...(projectId?{projectId}:{})});
 if(!isCurrent())throw new DOMException('页面已切换','AbortError');
 if(typeof value?.id!=='string'||!value.id)throw Error('模板上传未完成，原有模板保持不变，请重试。');
 return {version:1,source:{fileId:value.id,name:file.name,sha256,size:bytes.length},profile,status:'ready'};
}
