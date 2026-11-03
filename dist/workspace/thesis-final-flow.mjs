import {thesisHasDraft} from './thesis-writing-modes.mjs';
import {draftGenerationActive} from './thesis-completion-panel.mjs';
import {supplementCheckReady} from './supplement-check-panel.mjs';

export const finalWritingSteps=[['source','准备初稿','使用当前初稿或上传 DOCX'],['prepare','补充并完善','补齐资料，自动完善与检查'],['review','核对与下载','确认修改，编排 DOCX 终稿']];
export function finalWritingState(item,{dirty=false,completionRunId=null}={}){
 const hasDraft=!!item&&thesisHasDraft(item),draftActive=draftGenerationActive(item,completionRunId),active=['queued','running','cancelling'].includes(item?.job?.status)||['queued','running','cancelling'].includes(item?.status),review=item?.completionReview;
 const current=hasDraft&&!draftActive&&!active&&!dirty&&!review?.basisChanged&&!review?.suggestions?.length;
 const ready=current&&review?.status==='ready',confirmed=current&&(review?.status==='confirmed'||!review?.required&&supplementCheckReady(item?.quality));
 return {hasDraft,draftActive,active,ready,confirmed,canProceed:hasDraft&&!draftActive,recommended:!hasDraft||draftActive?'source':ready||confirmed?'review':'prepare'};
}
export function finalWritingStepsHTML(){
 return `<nav class="thesis-final-steps" aria-label="终稿撰写步骤">${finalWritingSteps.map(([key,title,description],index)=>`<button type="button" data-thesis-final-step="${key}" aria-controls="thesis-final-stage-${key}"><span class="thesis-final-step-number" aria-hidden="true">${index+1}</span><span><strong>${title}</strong><small>${description}</small></span><span class="thesis-final-step-state" data-thesis-final-step-state></span></button>`).join('')}</nav>`;
}
export function applyFinalWritingStep(root,requested,state,{busy=false}={}){
 const step=finalWritingSteps.some(([key])=>key===requested)&& (requested==='source'||state.canProceed)?requested:state.recommended;
 const index=finalWritingSteps.findIndex(([key])=>key===step);
 root.querySelectorAll('[data-thesis-final-stage]').forEach(panel=>{panel.hidden=panel.dataset.thesisFinalStage!==step;});
 root.querySelectorAll('[data-thesis-final-step]').forEach(button=>{
  const key=button.dataset.thesisFinalStep,pos=finalWritingSteps.findIndex(([name])=>name===key),complete=key==='source'&&state.canProceed||key==='prepare'&&(state.ready||state.confirmed)||key==='review'&&state.confirmed;
  button.disabled=busy||key!=='source'&&!state.canProceed;
  if(key===step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
  button.dataset.complete=String(complete);
  const label=button.querySelector('[data-thesis-final-step-state]');if(label)label.textContent=key===step?'当前步骤':complete?'已完成':pos>index?'待进行':'可返回';
 });
 root.querySelectorAll('[data-thesis-final-next]').forEach(button=>{button.disabled=busy||button.dataset.thesisFinalNext!=='source'&&!state.canProceed;});
 return step;
}
