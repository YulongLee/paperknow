import {thesisPreviewItem} from './thesis-generation-reader.mjs';

export const thesisHasDraft=item=>thesisPreviewItem(item).chapters.some(chapter=>String(chapter.text||'').trim());
export function thesisTaskMode(item){
 if(item?.status==='draft'||item?.job?.snapshotChanged===true)return 'draft';
 if(item?.job?.purpose==='draft')return 'draft';
 return item?.job?.purpose==='completion'||['completion','recheck'].includes(item?.job?.operation)?'final':'draft';
}
export function initialThesisWritingMode(item){
 if(!thesisHasDraft(item))return 'draft';
 if(['queued','running','cancelling'].includes(item?.job?.status))return thesisTaskMode(item);
 return item?.importedDraft||item?.completionReview?.required||thesisTaskMode(item)==='final'?'final':'draft';
}
export function thesisWritingModesHTML(mode){
 return `<div class="thesis-writing-modes" role="tablist" aria-label="选择论文撰写任务">${[['draft','01','初稿撰写','按已确认的提纲撰写，预览并下载可编辑初稿'],['final','02','终稿撰写','补充缺项、自动修正并检查，确认后编排终稿']].map(([key,number,title,description])=>`<button type="button" role="tab" id="thesis-writing-${key}-tab" data-thesis-writing-mode="${key}" aria-controls="thesis-writing-${key}-panel" aria-selected="${mode===key}" tabindex="${mode===key?0:-1}"><span class="thesis-writing-mode-number" aria-hidden="true">${number}</span><span><strong>${title}</strong><small>${description}</small></span><span class="thesis-writing-mode-check" aria-hidden="true">${mode===key?'✓':'→'}</span></button>`).join('')}</div>`;
}
// Move the existing reader/editor, rather than remounting them: input, selection,
// history and inner scroll positions must survive a task-mode switch.
export function applyThesisWritingMode(root,mode,{taskMode='draft'}={}){
 if(!['draft','final'].includes(mode))return;
 const shared=root.querySelector('[data-thesis-shared-workspace]');
 const scrolls=shared?[...shared.querySelectorAll('[data-scroll-key],textarea')].map(node=>({node,top:node.scrollTop,left:node.scrollLeft,start:node.selectionStart,end:node.selectionEnd,direction:node.selectionDirection})):[];
 root.dataset.thesisSelectedMode=mode;
 for(const button of root.querySelectorAll('[data-thesis-writing-mode]')){
  const selected=button.dataset.thesisWritingMode===mode;
  button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
  button.querySelector('.thesis-writing-mode-check').textContent=selected?'✓':'→';
 }
 for(const panel of root.querySelectorAll('[data-thesis-writing-panel]'))panel.hidden=panel.dataset.thesisWritingPanel!==mode;
 const slot=root.querySelector(`[data-thesis-workspace-slot="${mode}"]`);
 if(shared&&slot&&shared.parentElement!==slot)slot.append(shared);
 const task=root.querySelector('[data-thesis-task-workspace]'),taskSlot=root.querySelector(`[data-thesis-task-slot="${taskMode}"]`);
 if(task&&taskSlot&&task.parentElement!==taskSlot)taskSlot.append(task);
 for(const {node,top,left,start,end,direction} of scrolls){node.scrollTop=top;node.scrollLeft=left;if(typeof start==='number')node.setSelectionRange(start,end,direction);}
}
