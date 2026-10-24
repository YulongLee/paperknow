export async function renderThesisDocument(bytes,{expectedUserId,signal,fetchImpl=globalThis.fetch}={}){
 if(!expectedUserId)throw Error('请先登录，再进行论文页面检查或导出同版 PDF。');
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>2*1024*1024)throw Error('论文排版文件需在 2MB 以内，请精简模板中的大图或嵌入字体后重试。');
 const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,135000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 try{
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const response=await fetchImpl('/api/theses/document-render',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-PaperKnow-User':expectedUserId},body:JSON.stringify({data:btoa(binary),expectedUserId}),signal:controller.signal});
  const value=await response.json();if(!response.ok)throw Error(value.error||'论文页面生成未完成，请稍后重试。');
  if(typeof value.data!=='string'||value.data.length>40*1024*1024||!Number.isSafeInteger(value.pages)||value.pages<1)throw Error('论文页面结果不完整，未导出未经验证的 PDF。');
  const decoded=atob(value.data),pdf=Uint8Array.from(decoded,c=>c.charCodeAt(0));if(new TextDecoder().decode(pdf.subarray(0,5))!=='%PDF-')throw Error('论文页面结果格式无效，请重试。');
  let docxBytes;
  if(value.docxData!==undefined){if(typeof value.docxData!=='string'||value.docxData.length>3*1024*1024||value.docxData.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.docxData))throw Error('更新目录后的 Word 文件格式无效，请重试。');const data=atob(value.docxData);docxBytes=Uint8Array.from(data,c=>c.charCodeAt(0));if(docxBytes[0]!==80||docxBytes[1]!==75)throw Error('更新目录后的 Word 文件无效，请重试。');}
  return {bytes:pdf,...(docxBytes?{docxBytes}:{}),...(value.fieldsRefreshed===true?{fieldsRefreshed:true}:{}),pages:value.pages,warnings:Array.isArray(value.warnings)?value.warnings.filter(x=>typeof x==='string').slice(0,10):[]};
 }catch(error){if(controller.signal.aborted)throw Error('论文页面处理超时或已取消，请稍后重试；已保存正文保持不变。');throw error;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function showThesisExportCheck(status,report,{layout=null,templateMode='default',content=null}={}){
 if(!status?.isConnected)return;
 const host=status.parentElement;let panel=host.querySelector('[data-export-check]');
 if(!panel){panel=status.ownerDocument.createElement('details');panel.setAttribute('data-export-check','');panel.className='thesis-template-details';status.before(panel);}
 const labels={explicit_slot:'按模板正文占位位置填入',recognized_body:'已识别模板正文区域并保留原有布局',rules_only:'仅使用样式规则，采用通用封面',ambiguous:'模板正文位置不明确',default:'使用通用学位论文模板'};
 const checks=Array.isArray(report?.checks)?report.checks:[],shown=new Set(checks.map(row=>row.message)),warnings=(report?.warnings||[]).map(row=>typeof row==='string'?row:row.message).concat((report?.submission?.issues||[]).map(row=>row.message),layout?.warnings||[]).filter(row=>row&&!shown.has(row));
 panel.innerHTML=`<summary tabindex="0">本次导出检查${report?.status==='review_required'?' · 有待核对事项':''}</summary><div><p>${esc(labels[templateMode]||labels.default)}</p><p>${content?`正文文字检查：${Number(content.checkedSegments)||0} 项已按段落及顺序核对。${content.formulaSegments?`另有 ${content.formulaSegments} 处公式，请核对数学显示。`:""}`:'正文文字检查未完成。'} ${layout?`已生成 ${layout.pages} 页，同版 PDF 来自本次 Word 文件。`:'页面渲染尚未完成。'}</p><ul>${checks.map(row=>`<li><strong>${esc(row.label)}</strong>：${esc(row.message)}</li>`).join('')}</ul>${warnings.length?`<ul>${[...new Set(warnings)].slice(0,16).map(row=>`<li>${esc(row)}</li>`).join('')}</ul>`:''}<p>规则检查与页面生成不代表事实核验或人工逐页审定。请结合下方 PDF 和生成检查记录核对；${layout?.fieldsRefreshed?'目录与页码已自动刷新，仍需核对最终页面。':'Word/WPS 目录仍需更新域。'}</p></div>`;
}
