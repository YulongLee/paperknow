import {esc} from './ui.mjs';

const workflows=Object.freeze({
 library:{name:'我的文献',steps:[['准备文献','导入文档或添加资料'],['整理文献信息','核对题录、分组与材料'],['开始原文研读','选择文献与研读方式'],['笔记与结果','继续阅读、核对与导出']]},
 discovery:{name:'文献检索',steps:[['填写检索主题','输入关键词、标题或 DOI'],['检索与筛选','等待结果，调整筛选'],['选择文献','核对题录与可用摘要'],['保存与研读','保存文献或开始摘要研读']]},
 read:{name:'AI 研读',steps:[['核对原文','确认正文或摘要范围'],['选择研读方式','设置段落与研读深度'],['AI 研读','处理状态自动更新'],['核对与导出','对照原文，保存理解']]},
 answer:{name:'原文问答',steps:[['核对原文','确认本次回答的依据'],['填写问题','选择段落并提出问题'],['AI 回答','处理状态自动更新'],['核对与导出','查看回答与原文依据']]},
 translate:{name:'原文对照翻译',steps:[['选择原文','准备正文或摘要'],['设置目标语言','核对段落与翻译语言'],['生成对照译文','处理状态自动更新'],['对照与导出','核对术语，保存译文']]},
 document:{name:'整篇文档翻译',steps:[['选择原件','上传或选择已有文档'],['核对翻译设置','选择原文与目标语言'],['文档翻译','等待处理，自动更新'],['核对与下载','下载可编辑 Word 译文']]}
});

export function readingWorkflowMarkup(kind){
 const config=workflows[kind];if(!config)throw Error('Unknown reading workflow');
 return `<nav class="tool-operation-workflow literature-operation-workflow" data-reading-workflow="${kind}" aria-label="${esc(config.name)}操作流程"><div class="tool-workflow-heading"><strong>操作流程</strong><span data-reading-workflow-position></span></div><ol class="tool-workflow-steps">${config.steps.map(([title,detail],i)=>`<li><button type="button" data-reading-workflow-step="${i+1}"><span data-reading-workflow-number>${String(i+1).padStart(2,'0')}</span><div><b>${title}</b><small>${detail}</small></div></button></li>`).join('')}</ol><p class="tool-workflow-hint" data-reading-workflow-hint role="status" aria-live="polite"></p></nav>`;
}
export function updateReadingWorkflow(nav,{step=1,phase='prepare',hint='',disabled=[],completed}={}){
 if(!nav)return;const config=workflows[nav.dataset.readingWorkflow];if(!config)return;
 step=Math.max(1,Math.min(4,Number(step)||1));const signature=JSON.stringify({step,phase,hint,disabled,completed});if(nav.dataset.readingState===signature)return;
 nav.dataset.readingState=signature;nav.dataset.currentStep=String(step);nav.dataset.phase=phase;
 nav.querySelector('[data-reading-workflow-position]').textContent=`第 ${step} 步 / 共 4 步`;
 nav.querySelector('[data-reading-workflow-hint]').textContent=hint;
 nav.querySelectorAll('[data-reading-workflow-step]').forEach((button,index)=>{const n=index+1,active=n===step,done=Array.isArray(completed)?completed.includes(n):n<step;button.classList.toggle('is-active',active);button.classList.toggle('is-completed',done);button.disabled=disabled.includes(n);button.setAttribute('aria-label',`${n} ${config.steps[index][0]}${active?'，当前步骤':done?'，已完成':''}`);if(active)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');button.querySelector('[data-reading-workflow-number]').textContent=done?'✓':String(n).padStart(2,'0');});
}
export function bindReadingWorkflow(nav,navigate){
 if(!nav)return;const doc=nav.ownerDocument;if(!doc.querySelector('[data-literature-workflow-style]')){const link=doc.createElement('link');link.rel='stylesheet';link.href='/workspace/literature-workflow.css';link.dataset.literatureWorkflowStyle='';doc.head.append(link);}
 nav.onclick=event=>{const button=event.target.closest('[data-reading-workflow-step]');if(!button||!nav.contains(button)||button.disabled)return;navigate(Number(button.dataset.readingWorkflowStep));};
}
export function focusReadingTarget(target){if(!target)return;target.scrollIntoView?.({block:'center',behavior:'auto'});target.focus?.({preventScroll:true});}
