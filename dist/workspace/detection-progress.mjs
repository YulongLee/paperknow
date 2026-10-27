// Keep one progress surface alive across polling. Provider stages and partial
// verdicts never become customer-facing progress or estimated percentages.
export function createDetectionProgress(target,{onCancel}={}){
 const doc=target.ownerDocument,win=doc.defaultView;let timer=null,started=0;
 function stop(){if(timer!==null)win.clearInterval(timer);timer=null;}
 function elapsed(){const node=target.querySelector('[data-detection-elapsed]');if(node){const seconds=Math.max(0,Math.floor((Date.now()-started)/1000));node.textContent=seconds<60?`已等待 ${seconds} 秒`:`已等待 ${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;}}
 function update({state='running',startedAt}={}){
  target.hidden=false;
  let root=target.querySelector('[data-detection-progress]');
  if(!root){
   target.innerHTML=`<section class="detection-wait" data-detection-progress><div class="detection-wait-heading"><span class="detection-wait-icon" aria-hidden="true"></span><div><h3 data-detection-progress-title role="status" aria-live="polite"></h3><p>检测完成后将自动显示完整报告，无需重复提交。</p></div><span class="detection-wait-time" data-detection-elapsed></span></div><div class="detection-wait-track" role="progressbar" aria-label="论文检测正在进行" aria-valuetext="检测中，完成时间待定"><span></span></div><ol class="detection-wait-steps" aria-label="检测状态"><li data-detection-step="submitted">已提交</li><li data-detection-step="running">检测中</li><li>报告完成</li></ol><div class="detection-wait-footer"><span>任务保存在当前账户，离开页面后可在任务中心查看。</span>${onCancel?'<button type="button" class="btn secondary" data-detection-cancel data-web-cancel>取消检测</button>':''}</div></section>`;
   root=target.querySelector('[data-detection-progress]');
   target.querySelector('[data-detection-cancel]')?.addEventListener('click',()=>onCancel());
   const date=Date.parse(startedAt);started=Number.isFinite(date)&&date<=Date.now()?date:Date.now();
  }
  const title=state==='recovering'?'提交状态待确认':state==='submitting'?'正在提交检测':state==='queued'?'检测已提交，等待处理':'论文检测中，请稍候';
  const node=root.querySelector('[data-detection-progress-title]');if(node.textContent!==title)node.textContent=title;
  const description=root.querySelector('.detection-wait-heading p'),message=state==='recovering'?'请读取原提交确认状态，不要重新创建检测。':'检测完成后将自动显示完整报告，无需重复提交。';if(description.textContent!==message)description.textContent=message;
  root.dataset.state=state;
  root.querySelector('[data-detection-step="submitted"]').setAttribute('aria-current',state==='submitting'?'step':'false');
  root.querySelector('[data-detection-step="running"]').setAttribute('aria-current',state==='running'?'step':'false');
  elapsed();if(timer===null)timer=win.setInterval(elapsed,1000);
 }
 function clear(){stop();if(target.querySelector('[data-detection-progress]')){target.replaceChildren();target.hidden=true;}}
 return{update,clear,dispose:clear};
}
export function ensureDetectionProgressStyle(doc=document){
 if(doc.querySelector('[data-detection-progress-style]'))return;
 const link=doc.createElement('link');link.rel='stylesheet';link.href='/workspace/detection-progress.css';link.dataset.detectionProgressStyle='';doc.head.append(link);
}
