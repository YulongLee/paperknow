const stages=['核对资料与模板','格式检查与编排','页面与目录核验','保存并下载'];
export function createDocumentExportProgress(status){
 const doc=status.ownerDocument,win=doc.defaultView;let root,timer=null,started=0,index=0;
 if(!doc.querySelector('[data-document-export-progress-style]')){const link=doc.createElement('link');link.rel='stylesheet';link.href='/workspace/document-export-progress.css';link.dataset.documentExportProgressStyle='';doc.head.append(link);}
 const stop=()=>{if(timer!==null)win.clearInterval(timer);timer=null;};
 function elapsed(){if(!root?.isConnected){stop();return;}const seconds=Math.max(0,Math.floor((Date.now()-started)/1000));root.querySelector('[data-export-elapsed]').textContent=seconds<60?`已用时 ${seconds} 秒`:`已用时 ${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;}
 function stage(next=0,message='正在核对资料与模板，请稍候…'){
  if(!status.isConnected)return;
  if(!root?.isConnected){root=doc.createElement('section');root.className='document-export-progress';root.dataset.documentExportProgress='';root.innerHTML='<div class="document-export-progress-heading"><span class="document-export-spinner" aria-hidden="true"></span><div><strong data-export-progress-title role="status" aria-live="polite"></strong><p data-export-progress-message></p></div><small data-export-elapsed></small></div><div class="document-export-track" role="progressbar" aria-label="文档导出进度"><span></span></div><ol aria-label="文档处理阶段">'+stages.map((label,i)=>'<li data-export-stage="'+i+'"><span>'+(i+1)+'</span>'+label+'</li>').join('')+'</ol>';status.before(root);started=Date.now();}
  if(root.dataset.state!=='running')started=Date.now();index=Math.max(0,Math.min(3,next));root.dataset.state='running';root.setAttribute('aria-busy','true');root.querySelector('[data-export-progress-title]').textContent=index===1?'正在格式检查与编排中':index===2?'正在核验页面、目录与页码':index===3?'正在保存并准备下载':'正在检查资料与模板';root.querySelector('[data-export-progress-message]').textContent=message;root.querySelector('[role=progressbar]').setAttribute('aria-valuetext',stages[index]+'，处理中');
  root.querySelectorAll('[data-export-stage]').forEach((node,i)=>{node.dataset.state=i<index?'complete':i===index?'current':'waiting';node.setAttribute('aria-current',i===index?'step':'false');});
  elapsed();if(timer===null)timer=win.setInterval(elapsed,1000);
 }
 function finish(state,message){if(!root?.isConnected){stop();return;}stop();elapsed();root.dataset.state=state;root.setAttribute('aria-busy','false');root.querySelector('[data-export-progress-title]').textContent=state==='complete'?'文档已生成':state==='needs_materials'?'请补充以下资料':state==='check_required'?'资料检查尚未完成':'本次导出未完成';root.querySelector('[data-export-progress-message]').textContent=message;root.querySelector('[role=progressbar]').setAttribute('aria-valuetext',state==='complete'?'文档已完成':message);if(state==='complete')root.querySelectorAll('[data-export-stage]').forEach(node=>{node.dataset.state='complete';node.setAttribute('aria-current','false');});}
 return{stage,finish,dispose:stop};
}
