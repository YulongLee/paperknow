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
export function completeThesisDraft(row){return {...row,degree:row.degree||'本科',language:row.language||'中文',targetWords:row.targetWords||8000,knowledgeFiles:row.knowledgeFiles?.length?row.knowledgeFiles:[{id:'step-gate-material',name:'合成验收正文材料',text:thesisResearchText,state:'confirmed',kind:'file'}],writingReferences:row.writingReferences?.length?row.writingReferences:[{...thesisReference}]};}
