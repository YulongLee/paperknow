import {mountRevisionReportEntry} from './revision-report-entry.mjs';
import {mountToolJobPanel} from './tool-job-panel.mjs';
import {createRevision,revisedText,snapshot} from './revision-model.mjs';
import {revisionAiSnapshot,applyRevisionAiOutput} from './revision-ai-model.mjs';
import {importWorkspaceDocument} from './document-import.mjs';
import {projectPickerOptions} from './project-directory.mjs';
import {keys,list,write,captureDraftScope} from './state.mjs';
import {documentExportButtons,bindDocumentExports} from './document-export.mjs';
import {toolBanner} from './tool-banner.mjs';
import {esc,icon} from './ui.mjs';
import {revisionProductSpec} from './revision-product-model.mjs';
import {createRevisionWorkflow} from './revision-workflow.mjs';
export {revisionProductSpec};

const modes=new Set(['report','paragraph','dual']);
export function revisionProductOutput(doc,output,source){
 const next=applyRevisionAiOutput(doc,output,source),ids=new Set(source.context.paragraphIds);
 // New tasks start from an immutable original. Only their validated output is
 // adopted; previously edited documents are never silently overwritten.
 if(next.paragraphs.some(p=>ids.has(p.id)&&p.aiCandidate))throw Error('当前内容已有修改，已保留原稿，请创建独立处理任务。');
 const paragraphs=next.paragraphs.map(p=>{if(!ids.has(p.id))return p;const trim=p.original.trim(),start=p.original.indexOf(trim),end=start+trim.length;return {...p,suggestion:p.original.slice(0,start)+p.suggestion+p.original.slice(end),accepted:true};}),text=revisedText({paragraphs});
 if(text.length>200000)throw Error('修改结果超出正文容量，原文与任务结果保留，请重新核对。');
 return {...next,paragraphs,text,productCompleted:true};
}
export function mountRevisionProduct({container,ctx={},kind='similarity',initialDocument=null,dependencies={}}={}){
 const win=container.ownerDocument.defaultView,document=container.ownerDocument,route=win.location.hash,scope=captureDraftScope();
 let initializing=false;
 let live=true,processing=false,reading=false,ticket=0,parseController=null,report,panel=null,doc=null,resultDoc=null,taskSource=null;
 let mode=modes.has(initialDocument?.revisionProduct?.mode)?initialDocument.revisionProduct.mode:'report';
 const prepared={report:{},paragraph:{},dual:{}};
 const current=()=>live&&container.isConnected&&win.location.hash===route&&scope.isCurrent();
 const parse=dependencies.importDocument||importWorkspaceDocument;
 const $=selector=>container.querySelector(selector),now=()=>new Date().toISOString();
 if(!document.querySelector('[data-revision-product-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/workspace/revision-product.css';link.dataset.revisionProductStyle='';document.head.append(link);}
 const target=kind==='aigc'?'降 AI 率':'降重复率';
 container.innerHTML=`<div id="revision-product" class="revision-product"><div id="revision-service">${toolBanner(kind==='aigc'?'aigc':'reduce',{title:target,description:'选择处理方式，提交内容，直接获取修改后的正文。',actions:'<a class="btn secondary" href="#category/detection">论文检测</a>'})}<header class="revision-entry-heading"><h2>选择处理方式</h2><p>保留论文原意、真实数据、公式和引用。</p></header><div data-revision-workflow-host></div><section class="revision-product-form"><form id="revision-entry-form"><header><h2 data-product-title></h2><p data-product-description></p></header><div class="revision-product-original"><div data-product-import-tabs role="group" aria-label="原文输入方式"><button type="button" data-product-input="file">上传原文</button><button type="button" data-product-input="paste">粘贴原文</button></div><label data-product-file-pane class="revision-product-upload">${icon('upload',26)}<strong data-product-file-label>上传论文原文</strong><span>DOCX / TXT / PDF</span><input id="revision-service-file" type="file" accept=".docx,.txt,.pdf"></label><label data-product-paste-pane hidden><span data-product-paste-label>待处理文字</span><textarea id="revision-service-text" rows="10" maxlength="100000" placeholder="粘贴需要处理的文字，保留自然段落。"></textarea></label><p id="revision-service-file-status" role="status"></p></div><div class="revision-product-meta"><label>文稿标题<input id="revision-service-title" maxlength="200" placeholder="可选，未填写时自动命名"></label><label>所属项目<select id="revision-service-project" data-project-picker data-project-ref="${esc(initialDocument?.projectId||'')}">${projectPickerOptions(initialDocument?.projectId||'')}</select></label></div><label>修改要求 <small>可选</small><textarea id="revision-service-requirements" rows="2" maxlength="2500" placeholder="例如：保留专业术语、数据和参考文献。"></textarea></label><div class="revision-entry-submit"><span>原文保留，生成完成后可直接复制或下载。</span><button type="submit" class="btn primary" data-product-start></button></div><p data-product-error role="alert"></p></form></section></div><div data-product-job hidden></div><section class="revision-product-result" data-product-result hidden><header><div><h2>处理完成</h2><p data-product-result-summary></p></div><div class="revision-product-result-actions"><button type="button" class="btn secondary" data-product-copy>复制修改后正文</button>${documentExportButtons('revision-product-export',{docxOnly:true})}</div></header><div class="revision-product-compare"><section><h3>论文原文</h3><pre data-product-original></pre></section><section><h3>修改后正文</h3><pre data-product-revised></pre></section></div><p data-product-export-status role="status"></p><p class="revision-product-note">检测结果以重新检测为准；本次处理不生成或预测检测分数。</p></section></div>`;
 const resultMarkup=$('[data-product-result]').innerHTML;
 let input='file',workflow,jobProgress={},taskInput=null,reportRevision=0,taskReportRevision=0,preparing=false,preparationFailed=false;
 workflow=createRevisionWorkflow($('[data-revision-workflow-host]'),{kind,targets:{
  prepare:()=>input==='paste'?$('#revision-service-text'):$('[data-product-file-pane]'),
  review:()=>mode==='report'?$('.revision-report-preparation'):$('#revision-service-requirements'),
  processing:()=>$('[data-product-job]').hidden?$('#revision-entry-form'):$('[data-product-job]'),result:()=>$('[data-product-result]')
 }});
 function updateWorkflow(){
  if(!live||!workflow)return;
  const inputValue=value(),hasText=!!inputValue.text.trim(),hasResult=!!resultDoc&&!$('[data-product-result]').hidden;
  const newDraft=taskInput!==null&&(JSON.stringify(inputValue)!==taskInput||mode==='report'&&reportRevision!==taskReportRevision),completed=!!doc?.productCompleted&&resultDoc?.id===doc.id;
  let phase;
  if(!scope.isCurrent()||jobProgress.auth==='changed')phase='blocked';
  else if(reading)phase='importing';
  else if(preparing)phase='checking';
  else if(jobProgress.submitting||['queued','running'].includes(jobProgress.status))phase=jobProgress.status==='queued'?'queued':'running';
  else if(newDraft)phase=hasText?'review':'prepare';
  else if(preparationFailed)phase=hasText?'blocked_start':'prepare';
  else if(jobProgress.hasError)phase=jobProgress.hasTask?'failed':hasText?'blocked_start':'prepare';
  else if(completed)phase='complete';
  else if(['failed','cancelled'].includes(jobProgress.status))phase=jobProgress.status;
  else if(jobProgress.status==='completed')phase='report_pending';
  else if(processing)phase='recovering';
  else phase=hasText?'review':'prepare';
  workflow.update({mode,phase,hasText,hasTask:!!jobProgress.hasTask,hasResult,newDraft});
 }

 function value(){return {text:input==='file'?prepared[mode].fileText||'':$('#revision-service-text').value,title:$('#revision-service-title').value,requirements:$('#revision-service-requirements').value,projectId:$('#revision-service-project').value,input,fileName:prepared[mode].fileName||''};}
 function remember(){if(!current())return true;Object.assign(prepared[mode],value());updateWorkflow();return true;}
 function busy(value){processing=value;$('#revision-entry-form').setAttribute('aria-busy',String(value));$('[data-product-start]').textContent=value?'正在处理，请稍候…':'开始'+(mode==='dual'?'整篇双降':target);$('#revision-entry-form').querySelectorAll('input,textarea,select,button').forEach(node=>node.disabled=value);container.querySelectorAll('[data-report-basis]').forEach(node=>node.disabled=value);updateWorkflow();}
 function showInput(next){if(reading){ticket++;parseController?.abort();reading=false;$('[data-product-start]').disabled=false;}input=next;const paste=next==='paste';$('[data-product-file-pane]').hidden=paste;$('[data-product-paste-pane]').hidden=!paste;container.querySelectorAll('[data-product-input]').forEach(button=>{const active=button.dataset.productInput===next;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});$('#revision-service-file-status').textContent=paste?'':prepared[mode].fileName?(prepared[mode].fileName+' · 正文已读取'):'请选择论文文件';updateWorkflow();}
 function switchMode(next){
  if(!modes.has(next))return;ticket++;parseController?.abort();reading=false;
  if(report&&!initializing)remember();mode=next;const spec=revisionProductSpec(kind,mode),prior=prepared[mode];
  $('#revision-service-text').value=prior.text||'';$('#revision-service-title').value=prior.title||'';$('#revision-service-requirements').value=prior.requirements||'';$('#revision-service-project').value=prior.projectId||'';
  $('#revision-service-file').value='';$('[data-product-title]').textContent=spec.title;$('[data-product-description]').textContent=spec.report?'提供检测报告和对应原文，系统定位标记内容并生成修改后的正文。':spec.paste?'粘贴一段或多段文字，无需检测报告。':'上传完整论文，无需检测报告，同时优化 AI 表达与重复表述。';
  $('[data-product-import-tabs]').hidden=!spec.report;$('[data-product-file-label]').textContent=mode==='dual'?'上传整篇论文':'上传论文原文';$('[data-product-paste-label]').textContent=spec.paste?'粘贴待处理文字':'论文原文';
  showInput(spec.paste?'paste':spec.report&&prior.input==='paste'?'paste':'file');$('[data-product-start]').textContent='开始'+(mode==='dual'?'整篇双降':target);$('[data-product-error]').textContent='';$('[data-product-start]').disabled=false;
  panel?.dispose();panel=null;doc=null;resultDoc=null;taskSource=null;jobProgress={};taskInput=null;preparing=false;preparationFailed=false;$('[data-product-job]').hidden=true;$('[data-product-job]').replaceChildren();$('[data-product-result]').hidden=true;$('[data-product-result]').innerHTML=resultMarkup;updateWorkflow();
 }
 report=mountRevisionReportEntry({root:$('#revision-service'),kind,ctx,productModes:true,initialMode:mode,isCurrent:current,getOriginalText:()=>value().text,getDocument:()=>createRevision({title:value().title.trim()||target+'修改稿',text:value().text,mode:revisionProductSpec(kind,mode).mode},'report-preview',now()),adoptOriginal:(text,details)=>{if(mode!=='report')return;prepared[mode].fileText=text;prepared[mode].text=text;showInput('paste');$('#revision-service-text').value=text;if(details.replace||!$('#revision-service-title').value.trim())$('#revision-service-title').value=details.title||'检测报告修改稿';remember();},onModeChange:switchMode,onStateChange:()=>{reportRevision++;remember();},...(dependencies.readReportFile?{readFile:dependencies.readReportFile}:{})});
 async function readFile(file){
  const request=++ticket,selectedMode=mode;parseController?.abort();const abort=new win.AbortController();parseController=abort;reading=true;$('[data-product-start]').disabled=true;prepared[mode].fileText='';prepared[mode].fileName='';
  $('#revision-service-file-status').textContent='正在读取论文正文…';updateWorkflow();
  try{const result=await parse(file,$('#revision-service-file-status'),{signal:abort.signal});if(!current()||request!==ticket||mode!==selectedMode)return;
   if(!result?.text?.trim()||result.text.length>100000)throw Error('正文为空或超过 100,000 字符，请检查所选文档。');
   prepared[mode].fileText=result.text;prepared[mode].fileName=file.name;
   if(!$('#revision-service-title').value.trim())$('#revision-service-title').value=file.name.replace(/\.[^.]+$/,'').slice(0,200);
   $('#revision-service-file-status').textContent=file.name+' · 已读取 '+result.text.length.toLocaleString()+' 字符';remember();
  }catch(error){if(current()&&request===ticket){prepared[mode].fileText='';$('#revision-service-file-status').textContent=error.message||'文件读取失败，请重新选择。';}}
  finally{if(current()&&request===ticket){reading=false;$('[data-product-start]').disabled=false;updateWorkflow();}}
 }
 function store(next){if(!current())throw Error('页面或账户已变化，原任务仍保留。');const rows=list(keys.drafts),at=rows.findIndex(row=>row.id===next.id);if(at<0)rows.unshift(next);else rows[at]=next;write(keys.drafts,rows);doc=next;}
 function showResult(){
  if(!current()||!doc?.productCompleted)return;const displayDoc=doc,displayId=doc.id,target=$('[data-product-result]');target.innerHTML=resultMarkup;resultDoc=doc;target.hidden=false;
  $('[data-product-original]').textContent=displayDoc.original;$('[data-product-revised]').textContent=revisedText(displayDoc);$('[data-product-result-summary]').textContent=revisionProductSpec(kind,displayDoc.revisionProduct.mode).title+' · '+displayDoc.paragraphs.length+' 段正文；原文单独保留。';
  const currentResult=()=>current()&&resultDoc?.id===displayId,status=$('[data-product-export-status]');
  $('[data-product-copy]').onclick=async()=>{try{await win.navigator.clipboard.writeText(revisedText(displayDoc));if(currentResult())status.textContent='已复制修改后正文。';}catch{if(currentResult())status.textContent='复制未成功，可直接下载 DOCX。';}};
  bindDocumentExports('revision-product-export',()=>displayDoc.title+'\n\n'+revisedText(displayDoc),()=>displayDoc.title,status,{docxOnly:true,isCurrent:currentResult,expectedUserId:scope.ownerId,getDocumentOptions:()=>({expectedUserId:displayDoc.aiJobStates?.rewrite?.ownerId}),...(dependencies.loadDocument?{loadDocument:dependencies.loadDocument}:{}),...(dependencies.downloadFile?{downloadFile:dependencies.downloadFile}:{})});updateWorkflow();
 }
 function mountPanel(initialState={}){
  panel?.dispose();$('[data-product-job]').hidden=false;
  panel=mountToolJobPanel({container:$('[data-product-job]'),ctx,kind:'revision',operation:'rewrite',label:revisionProductSpec(kind,mode).title,autoApply:true,showOutputPreview:false,onBusyChange:busy,onProgressChange:state=>{jobProgress=state;updateWorkflow();},getSnapshot:()=>structuredClone(taskSource),getProjectRef:()=>doc?.projectId||'',initialState,isCurrent:current,
   onStateChange:state=>{if(!current()||!doc)return false;store({...doc,aiJobStates:{...doc.aiJobStates,rewrite:state}});return true;},
   onApply:(output,item)=>{const next=revisionProductOutput(doc,output,taskSource);store({...next,appliedAiJobs:[...(doc.appliedAiJobs||[]),item.id]});showResult();busy(false);const completedId=doc.id,target=$('[data-product-result]');win.setTimeout(()=>{if(current()&&doc?.id===completedId&&target.isConnected&&!target.hidden)target.scrollIntoView?.({block:'start',behavior:'instant'});},0);}
  });
 }
 $('#revision-entry-form').onsubmit=async event=>{
  event.preventDefault();if(!current()||processing||reading||panel?.hasWork())return;
  $('[data-product-error]').textContent='';preparing=true;preparationFailed=false;busy(true);const selectedMode=mode,revision=value(),signature=JSON.stringify(revision);
  try{
   if(!revision.text.trim())throw Error(selectedMode==='paragraph'?'请先粘贴需要处理的文字。':'请先提供对应论文原文。');
   const spec=revisionProductSpec(kind,selectedMode),next=createRevision({title:revision.title.trim()||spec.title+'修改稿',text:revision.text,requirements:revision.requirements,projectId:revision.projectId,fileName:revision.fileName,mode:spec.mode},win.crypto.randomUUID(),now());
   const attachment=spec.report?await report.prepare(next):null;if(!current())return;if(mode!==selectedMode||JSON.stringify(value())!==signature)throw Error('内容或处理方式已变化，请重新提交。');
   const sourceDoc={...next,plan:spec.plan,reductionPath:spec.report?'sources':'direct',revisionProduct:{version:1,kind,mode:selectedMode},...(attachment?{reportRequired:true,reportAttachment:attachment,...(report.ownerId?{reportOwnerId:report.ownerId}:{}),aiSelection:{scope:'selected',paragraphIds:attachment.paragraphIds,origin:'report'}}:{aiSelection:{scope:'all',paragraphIds:next.paragraphs.map(p=>p.id)}})};
   const source=revisionAiSnapshot(sourceDoc,{scope:attachment?'selected':'all'});store(snapshot(sourceDoc,win.crypto.randomUUID(),now(),'保留处理前原文'));taskSource=source;taskInput=signature;taskReportRevision=reportRevision;preparing=false;jobProgress={};remember();mountPanel();
   await panel.generate();
  }catch(error){if(current()){preparationFailed=true;$('[data-product-error]').textContent=error.message||'未能开始处理，原文仍保留。';}}
  finally{preparing=false;if(current())busy(panel?.hasWork()||false);}
 };
 container.querySelectorAll('[data-product-input]').forEach(button=>button.onclick=()=>{if(processing||mode!=='report')return;remember();showInput(button.dataset.productInput);});
 $('#revision-service-file').onchange=event=>{const file=event.target.files?.[0];if(file)void readFile(file);};
 $('#revision-entry-form').addEventListener('input',()=>{preparationFailed=false;remember();});
 $('#revision-entry-form').addEventListener('change',event=>{if(event.target.closest('.revision-report-preparation,.revision-report-providers')){reportRevision++;remember();}});

 if(initialDocument?.revisionProduct){
  const saved=initialDocument;prepared[mode]={title:saved.title,text:saved.original,requirements:saved.requirements,projectId:saved.projectId,fileName:saved.fileName,fileText:saved.original,input:mode==='paragraph'?'paste':'file'};
  initializing=true;switchMode(mode);initializing=false;doc=saved;taskInput=JSON.stringify(value());showResult();const state=saved.aiJobStates?.rewrite;if(state?.snapshot){taskSource=structuredClone(state.snapshot);mountPanel(state);void panel.open();}
 }
 updateWorkflow();
 return {checkpoint:remember,hasWork:()=>reading||processing||panel?.hasWork()||false,dispose(){remember();live=false;ticket++;parseController?.abort();report.dispose();panel?.dispose();workflow.dispose();},getDocument:()=>doc};
}
