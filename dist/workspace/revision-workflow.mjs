// Reuse the paper-service stepper presentation without adding submission steps.
export function createRevisionWorkflow(host,{kind='similarity',targets={}}={}){
 const doc=host.ownerDocument,target=kind==='aigc'?'降 AI 率':'降重复率';
 if(!doc.querySelector('link[href="/workspace/detection-flow.css"]')){
  const link=doc.createElement('link');link.rel='stylesheet';link.href='/workspace/detection-flow.css';doc.head.append(link);
 }
 const root=doc.createElement('nav');root.className='detection-workflow revision-workflow';root.dataset.revisionWorkflow=kind;root.setAttribute('aria-label',target+'操作流程');
 const ids=['prepare','review','processing','result'];
 root.innerHTML='<div class="detection-workflow-heading"><strong>操作流程</strong><span data-revision-workflow-position></span></div><ol class="wf-stepper detection-workflow-steps">'+ids.map((id,index)=>`<li><button type="button" data-revision-workflow-step="${id}" disabled><span data-revision-workflow-number aria-hidden="true">${index+1}</span><div><b></b><small></small></div></button></li>`).join('')+'</ol><p class="detection-workflow-hint" data-revision-workflow-hint></p>';
 host.replaceChildren(root);let disposed=false,signature='',snapshot={};
 function navigate(event){
  const button=event.target.closest('[data-revision-workflow-step]');if(disposed||!button||button.disabled)return;
  const node=targets[button.dataset.revisionWorkflowStep]?.();if(!node?.isConnected)return;
  node.scrollIntoView?.({block:'center',behavior:'auto'});node.focus?.({preventScroll:true});
 }
 root.addEventListener('click',navigate);
 function update({mode='report',phase='prepare',hasText=false,hasTask=false,hasResult=false,newDraft=false}={}){
  if(disposed||!root.isConnected)return;const next={mode,phase,hasText,hasTask,hasResult,newDraft},key=JSON.stringify(next);if(key===signature)return;signature=key;snapshot=next;
  const report=mode==='report',dual=mode==='dual',steps=[
   [report?'准备论文原文':dual?'上传整篇论文':'粘贴待处理正文',report?'上传论文或粘贴正文':dual?'上传需要双降的完整文稿':'保留原文自然段落'],
   [report?'添加并核对报告':'核对内容与要求',report?'上传报告，核对标记位置':dual?'核对全文与修改要求':'核对正文与修改要求'],
   ['AI 优化正文',dual?'同时优化 AI 表达与重复表述':'按所选模式处理正文'],
   ['对照与下载','核对修改结果，复制或下载']
  ];
  const activePhases=['preparing','queued','running','recovering','report_pending','failed','cancelled'];
  const current=phase==='complete'?4:activePhases.includes(phase)?3:['review','checking','blocked_start'].includes(phase)?2:1;
  root.dataset.phase=phase;root.dataset.currentStep=String(current);root.dataset.mode=mode;
  root.querySelector('[data-revision-workflow-position]').textContent=`第 ${current} 步 / 共 4 步`;
  for(const [index,id] of ids.entries()){
   const button=root.querySelector(`[data-revision-workflow-step="${id}"]`),active=index+1===current,completed=index+1<current;
   button.querySelector('b').textContent=steps[index][0];button.querySelector('small').textContent=steps[index][1];
   button.classList.toggle('is-active',active);button.classList.toggle('is-completed',completed);
   button.disabled=phase==='blocked'||(id==='review'?!hasText:id==='processing'?!hasTask&&current!==3:id==='result'?!hasResult:false);
   button.setAttribute('aria-label',`${index+1} ${steps[index][0]}${active?'，当前步骤':completed?'，已完成':''}`);
   if(active)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
   button.querySelector('[data-revision-workflow-number]').textContent=completed?'✓':String(index+1).padStart(2,'0');
  }
  const start=dual?'开始整篇双降':'开始'+target;
  const messages={
   prepare:report?'先上传论文原文或粘贴正文，再添加对应的全文检测报告。':dual?'先上传完整论文，系统将同时优化 AI 表达与重复表述。':'先粘贴一段或多段文字，保留自然段落，无需检测报告。',
   importing:'正在读取论文正文，读取完成后可核对内容与修改要求。',
   review:newDraft?('当前内容或要求已更新，尚未重新处理'+(hasResult?'；上次修改结果仍可在下方查看。':'，请核对后开始本次处理。')):report?`原文已准备好。请提供对应的全文检测报告，核对标记位置后点击“${start}”。`:`内容已准备好。核对正文与修改要求后，点击“${start}”。`,
   blocked_start:'本次尚未开始处理，请查看下方具体原因，完成调整后再开始。',
   checking:'正在核对本次原文与处理资料，请稍候，无需重复提交。',
   preparing:'正在准备处理，请稍候，无需重复提交。',
   queued:'任务已提交，正在等待处理；完成后会自动显示修改结果。',
   running:'正在优化正文，进度会自动更新；原文保留，完成后可直接对照和下载。',
   recovering:'正在读取原任务状态，已提交的内容仍保留，无需重新提交。',
   report_pending:'生成已结束，修改结果仍在核对与保存中，请查看下方任务状态。',
   failed:'本次修改未完成，请查看下方具体原因；原文与已保存的结果仍保留。',
   cancelled:'本次处理已停止，原文保留；可核对内容后重新开始。',
   complete:'修改结果已生成并保存。请对照原文核对事实、数据与引用，再复制或下载 DOCX。',
   blocked:'账户状态已变化，请重新进入本功能后继续。'
  };
  root.querySelector('[data-revision-workflow-hint]').textContent=messages[phase]||messages.prepare;
 }
 update();return {update,getState:()=>({...snapshot}),dispose(){disposed=true;root.removeEventListener('click',navigate);}};
}
