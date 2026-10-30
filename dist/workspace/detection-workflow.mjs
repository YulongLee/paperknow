const stages=[
 ['prepare','准备论文','上传 DOCX 论文'],
 ['review','核对检测内容','核对正文与本次费用'],
 ['processing','生成检测报告','查看检测进度'],
 ['report','查看与下载','查看标注与完整报告']
];
const processingPhases=new Set(['submitting','queued','running','recovering','report_pending','failed','cancelled']);

// Guide and locate the existing controls. Navigating a step never submits a
// manuscript, starts a paid job, or recreates the form during polling.
export function createDetectionWorkflow(host,{kind='similarity',targets={}}={}){
 const doc=host.ownerDocument,ai=kind==='aigc',title=kind==='combined'?'论文联合检测':ai?'论文 AI 率检测':'论文重复率检测';
 let disposed=false,signature='',snapshot={};
 const root=doc.createElement('nav');root.className='detection-workflow';root.dataset.detectionWorkflow=kind;root.setAttribute('aria-label',title+'操作流程');
 root.innerHTML='<div class="detection-workflow-heading"><strong>操作流程</strong><span data-workflow-position></span></div><ol class="wf-stepper detection-workflow-steps">'+stages.map(([id,label,description],index)=>`<li><button type="button" data-workflow-step="${id}" disabled><span data-workflow-number aria-hidden="true">${String(index+1).padStart(2,'0')}</span><div><b>${label}</b><small>${description}</small></div></button></li>`).join('')+'</ol><p class="detection-workflow-hint" data-workflow-hint></p>';
 host.replaceChildren(root);
 function navigate(event){
  const button=event.target.closest('[data-workflow-step]');if(disposed||!button||button.disabled)return;
  const target=targets[button.dataset.workflowStep]?.();if(!target?.isConnected)return;
  target.scrollIntoView?.({block:'center',behavior:'auto'});target.focus?.({preventScroll:true});
 }
 root.addEventListener('click',navigate);
 function update({phase='prepare',hasText=false,valid=false,hasTask=false,hasReport=false,newDraft=false}={}){
  if(disposed||!root.isConnected)return;
  const next={phase,hasText,valid,hasTask,hasReport,newDraft},key=JSON.stringify(next);if(key===signature)return;signature=key;snapshot=next;
  const current=phase==='complete'?4:processingPhases.has(phase)?3:phase==='review'?2:1;
  root.dataset.phase=phase;root.dataset.currentStep=String(current);
  root.querySelector('[data-workflow-position]').textContent=`第 ${current} 步 / 共 4 步`;
  for(const [index,[id,label]] of stages.entries()){
   const button=root.querySelector(`[data-workflow-step="${id}"]`),active=index+1===current,completed=index+1<current;
   button.classList.toggle('is-active',active);button.classList.toggle('is-completed',completed);
   button.disabled=phase==='blocked'||(id==='review'?!hasText:id==='processing'?!hasTask:id==='report'?!hasReport:false);
   button.setAttribute('aria-label',`${index+1} ${label}${active?'，当前步骤':completed?'，已完成':''}`);
   if(active)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
   button.querySelector('[data-workflow-number]').textContent=completed?'✓':String(index+1).padStart(2,'0');
  }
  const messages={
   prepare:'先上传需要检测的 DOCX 论文，读取完成后即可开始检测。',
   importing:'正在读取论文文档，读取完成后请核对提取的正文。',
   review:kind==='combined'&&valid?'正文已就绪，点击“开始联合检测”即可生成两份报告。':newDraft?'当前正文已更新，尚未进行本次检测；上次报告仍可在下方查看。':valid?(ai?'正文已准备好。核对论文内容与本次费用后，点击“开始 AI 率检测”。':'正文已准备好。核对正文、检测范围与本次费用后，点击“开始重复率检测”。'):'请在正文区补充或调整内容，符合检测要求后即可开始。',
   submitting:'正在提交本次检测，请稍候。',
   queued:'论文已提交，正在等待处理；完成后会自动显示检测报告。',
   running:'论文检测中，完成后会自动显示报告。可在任务中心查看已提交的任务。',
   recovering:'提交状态待确认，请读取原提交或任务状态，避免重复提交。',
   report_pending:'检测已结束，完整报告暂未就绪；请读取任务状态继续查看，无需重新检测。',
   failed:'本次检测未完成，请查看下方具体原因，再读取任务状态或核对正文后重试。',
   cancelled:'本次检测已取消，可核对正文后重新开始。',
   complete:ai?'检测报告已生成，可查看正文标注、分段分析与逐句修改建议，并预览或下载报告。':'检测报告已生成，可查看重复率、原文标注与来源对照，并预览或下载报告。',
   blocked:'账户状态已变化，请重新登录或重新进入本功能后继续。'
  };
  root.querySelector('[data-workflow-hint]').textContent=messages[phase]||messages.prepare;
 }
 update();
 return {update,dispose(){disposed=true;root.removeEventListener('click',navigate);},getState(){return {...snapshot};}};
}
