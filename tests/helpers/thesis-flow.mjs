// Positive integration fixtures use explicit substantive input and an adopted citation.
export const thesisResearchText='【合成验收资料】本研究围绕学习反馈的形成与使用展开，现有资料包括课堂观察记录、课程任务说明和已核对的参考文本。研究将比较不同反馈形式，区分材料中明确记载的事实与后续需要核验的解释，保留来源线索，并如实说明研究范围和局限。';
export const thesisReference={id:'step-gate-reference',title:'合成验收：学习反馈研究资料',authors:'验收研究者',year:'2026',source:'local',confirmed:true};
const $=selector=>document.querySelector(selector);
const edit=(selector,text)=>{const field=$(selector);field.value=text;field.dispatchEvent(new window.Event('input',{bubbles:true}));};
export async function selectThesisReference(){
 edit('#writing-reference-query','');
 let button=$('[data-reference-id="'+thesisReference.id+'"]');
 if(!button){
  const input=$('#writing-reference-file'),text=JSON.stringify([thesisReference]);
  Object.defineProperty(input,'files',{configurable:true,value:[{name:'thesis-reference-fixture.json',size:new TextEncoder().encode(text).length,text:async()=>text}]});
  input.dispatchEvent(new window.Event('change',{bubbles:true}));
  for(let attempt=0;attempt<12&&!button;attempt++){await new Promise(resolve=>setImmediate(resolve));button=$('[data-reference-id="'+thesisReference.id+'"]');}
 }
 if(!button)throw Error('Expected the explicitly imported fixture reference in the reference selection step');
 if(!button.classList.contains('is-selected')&&button.getAttribute('aria-pressed')!=='true')button.click();
}
export function confirmThesisMaterials(text=thesisResearchText){edit('#knowledge-ai-input',text);$('#writing-material-confirm').click();}
export async function confirmThesisReferences(){await selectThesisReference();$('#writing-reference-confirm').click();}
export async function confirmThesisResearch(text=thesisResearchText){confirmThesisMaterials(text);await confirmThesisReferences();}
// Positive outline/editor tests explicitly paste a topic-bound synthetic structure.
// Confirming research alone must continue to open an empty outline step.
export function applyThesisOutline(text){
 const topic=String($('#writing-title')?.value||'学习反馈研究').trim();
 const outline=text||`第一章 ${topic}的问题界定\n1.1 ${topic}的资料范围\n1.2 ${topic}的研究问题\n第二章 ${topic}的分析设计\n2.1 ${topic}的材料整理方法\n2.2 ${topic}的比较维度\n第三章 ${topic}的论证与讨论\n3.1 ${topic}的证据比较\n3.2 ${topic}的解释边界\n第四章 ${topic}的研究总结\n4.1 ${topic}的限制与后续工作\n参考文献`;
 if($('.dashboard')?.dataset.writingStage!=='4')throw Error('Expected the outline step before explicitly adopting the fixture outline');
 const input=$('#outline-source-input'),drawer=input.closest('details');if(drawer)drawer.open=true;
 edit('#outline-source-input',outline);$('#outline-paste-apply').click();
 if(!$('#outline-paper .outline-row-title'))throw Error('Expected the explicitly pasted topic-specific fixture outline');
 return outline;
}
export function completeThesisDraft(row){return {...row,degree:row.degree||'本科',language:row.language||'中文',targetWords:row.targetWords||8000,knowledgeFiles:row.knowledgeFiles?.length?row.knowledgeFiles:[{id:'step-gate-material',name:'合成验收正文材料',text:thesisResearchText,state:'confirmed',kind:'file'}],writingReferences:row.writingReferences?.length?row.writingReferences:[{...thesisReference}]};}
