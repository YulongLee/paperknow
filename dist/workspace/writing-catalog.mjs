import {toolBanner} from './tool-banner.mjs';
import {writingFeatureIdentities,getWritingFeatureIdentity,writingFeatureStyle} from './writing-feature-identities.mjs';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const catalog=[['writing','毕业论文','论文与报告'],['proposal','开题报告','论文与报告'],['summary','文献综述','论文与报告'],['taskbook','任务书','论文与报告'],['article','期刊文章','论文与报告'],['course','课程作业','论文与报告'],['practice','实践报告','论文与报告'],['idea','课题思路','研究准备'],['questionnaire','问卷设计','研究准备'],['analysis','数据分析','研究准备']];
const descriptions=Object.fromEntries(Object.values(writingFeatureIdentities).map(feature=>[feature.title,feature.description]));
const capabilityGlyphs={
 writing:{path:'M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h5'},
 proposal:{path:'M8 3h8v3H8zM6 5H4v16h16V5h-2M8 11h8M8 15h6M8 18h4'},
 summary:{path:'M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1zm0 0v15M5 8h3M16 8h3'},
 taskbook:{path:'M5 3h14v18H5zM8 8l1 1 2-2M13 8h3M8 13l1 1 2-2M13 13h3M8 18h8'},
 article:{path:'M4 3h16v18H4zM8 7h8M8 11h8M8 15h4M15 15h1M8 18h8'},
 course:{path:'m2 9 10-5 10 5-10 5zM6 11v6c4 3 8 3 12 0v-6M22 9v8'},
 practice:{path:'M4 7h16v14H4zM8 7V3h8v4M4 12c5 3 11 3 16 0M10 13h4v3h-4z'},
 idea:{path:'M8 15c-5-4-3-12 4-12s9 8 4 12l-1 3H9zM9 21h6M12 8v6M9 11h6'},
 questionnaire:{path:'M5 3h14v18H5zM8 8h1M12 8h4M8 12h1M12 12h4M8 16h1M12 16h4'},
 analysis:{path:'M3 3v18h18M7 17v-5M12 17V7M17 17V4M6 8l5-4 5 1 4-3'}
};
function capabilityIcon(key,size=23){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${capabilityGlyphs[key]?.path||capabilityGlyphs.writing.path}"/></svg>`;}
const workflowSteps=['基础信息','资料补充','文献确认','提纲确认','版本预览'];
function recommendationPreview(){return `<div class="writing-recommendation-preview" aria-label="论文结构示意，并非已生成成果"><span class="writing-preview-orbit" aria-hidden="true"></span><div class="writing-preview-back" aria-hidden="true"></div><div class="writing-preview-paper"><div class="writing-preview-paper-head"><span aria-hidden="true">${capabilityIcon('writing',16)}</span><b>论文结构</b><small>结构示意</small></div><div class="writing-preview-paper-title" aria-hidden="true"></div><div class="writing-preview-paper-subtitle" aria-hidden="true"></div><div class="writing-preview-chapter"><span>01</span><b>绪论与研究背景</b></div><div class="writing-preview-lines" aria-hidden="true"><i></i><i></i></div><div class="writing-preview-chapter"><span>02</span><b>研究设计与方法</b></div><div class="writing-preview-lines" aria-hidden="true"><i></i><i></i></div><div class="writing-preview-chapter"><span>03</span><b>研究发现与讨论</b></div><div class="writing-preview-paper-foot">章节可调整 · 正文由你完善</div></div><div class="writing-preview-note"><span aria-hidden="true">${capabilityIcon('taskbook',17)}</span><span>先理清结构，再展开写作</span></div></div>`;}
export function catalogNav(id){return `<section id="writing-capabilities" class="writing-catalog writing-capabilities writing-catalog-commercial writing-independent-catalog" aria-label="全部写作能力"><div class="capabilities-head"><div><span class="capabilities-kicker">WRITE WITH CLARITY</span><h2>选择你要完成的写作任务</h2><p>从论文与报告，到研究准备，让每一种写作都有合适的起点。</p></div><span class="capabilities-count">${catalog.length} 项写作能力</span></div><div class="writing-recommendation"><div class="writing-recommendation-main"><div class="writing-recommendation-copy"><span class="writing-recommendation-eyebrow"><i aria-hidden="true">${capabilityIcon('writing',16)}</i>推荐流程 · 毕业论文</span><h3>把研究思路，写成有章可循的论文</h3><p>从题目与资料开始，核对文献、搭建提纲，逐步完善你的论文草稿。</p></div><div class="writing-recommendation-meta"><span><b>5</b> 步清晰流程</span><span>保存进度</span><span>编辑与导出</span></div><ol class="writing-recommendation-steps" aria-label="毕业论文五步写作流程">${workflowSteps.map((step,i)=>`<li><span>${String(i+1).padStart(2,'0')}</span><b>${step}</b></li>`).join('')}</ol><a class="btn primary writing-recommendation-cta" href="#tool/writing">开始毕业论文 <span aria-hidden="true">→</span></a></div>${recommendationPreview()}</div><div class="capability-groups">${['论文与报告','研究准备'].map((group,gi)=>`<div class="capability-group ${gi===0?'capability-group-writing':'capability-group-preparation'}"><div class="capability-group-title"><span class="capability-group-icon" aria-hidden="true">${capabilityIcon(gi===0?'summary':'idea',22)}</span><div><strong>${group}</strong><small>${gi===0?'组织研究内容，逐步完善表达':'明确问题，准备材料与研究计划'}</small></div><span class="capability-group-count">${catalog.filter(t=>t[2]===group).length} 项</span></div><div class="capability-list">${catalog.filter(t=>t[2]===group).map(([key,label])=>{const visual=getWritingFeatureIdentity(key),selected=visual.key===getWritingFeatureIdentity(id).key;return `<a class="capability-card capability-tone-${visual.tone}" data-writing-task="${key}" style="${writingFeatureStyle(key)}" href="#tool/${key}" ${selected?'aria-current="page"':''}><span class="capability-symbol" aria-hidden="true">${capabilityIcon(key)}</span><span class="capability-art" aria-hidden="true"><img class="writing-feature-art" src="${visual.art}" width="160" height="160" loading="lazy" decoding="async" alt="" aria-hidden="true"></span><span class="capability-copy"><strong>${label}${key==='writing'?'<em>推荐</em>':''}</strong><small>${descriptions[label]||'按步骤完成研究写作'}</small><span class="capability-output">${visual.output}</span></span><span class="capability-label">${visual.tag}</span><span class="capability-arrow" aria-hidden="true">→</span></a>`;}).join('')}</div></div>`).join('')}</div></section>`;}

const common=[['填写研究信息','填写题目、学段和研究要求；目标字数是规划值，不会自动补齐内容。'],['核对文献与材料','导入有权使用的材料，核对解析正文。可推荐和检索真实文献题录；生成前核对可使用的摘要、全文和资料。'],['确认结构','按主题生成、上传或编辑提纲，确认章节顺序与字数分配。'],['编辑并保存','点击生成即可获得可编辑草稿，核对事实、引用并保存版本。'],['导出与核对','导出当前已填写内容，再核对事实、引用及学校格式。']];
const specific={questionnaire:[['填写研究目标','说明主题、目标人群及维度。'],['编辑问卷草稿','填写问题、选项与答题说明；先进行小范围试填。'],['导出问卷','发布独立问卷链接并收集真实答卷，按发布版本查看分布。']],analysis:[['填写分析计划','记录研究问题、变量、数据来源和预期方法。'],['准备真实数据','说明缺失值、样本与变量类型；不能把计划当成计算结果。'],['保存分析计划','上传CSV或TSV后计算真实描述统计、频数与相关，结果口径可核对。']],practice:[['记录真实经历','填写单位、岗位、时间及实际工作内容。'],['整理报告','在框架中补充过程、发现与反思，不编造实践经历。'],['保存与导出','保存草稿，逐项核对单位、日期和成果。']],idea:[['明确研究问题','输入专业、兴趣、研究问题和可获得的数据。'],['讨论研究可行性','核对研究范围、方法与资料来源。'],['保存计划','获得候选题目与拟研究思路，核对可行性后保存。']]};
export function guideMarkup(id){const item=catalog.find(t=>t[0]===id)||(id==='topic'?catalog.find(t=>t[0]==='idea'):null),name=item?.[1]||'写作任务',steps=specific[id]||(id==='topic'?specific.idea:null)||common;return `<section class="writing-guide-shell"><div class="writing-guide-top"><div><span class="capabilities-kicker">STEP 02 · YOUR WORKFLOW</span><h2>${escape(name)}的完成路径</h2><p>每一步都可以保存和返回，先核对输入，再开始下一步。</p></div><button class="btn secondary guide-toggle" type="button" aria-expanded="true" aria-controls="writing-guide">收起步骤</button></div><section id="writing-guide" class="writing-guide" aria-label="${escape(name)}操作指南"><ol>${steps.map(([title,desc],i)=>`<li><span>${i+1}</span><div><b>${title}</b><p>${desc}</p></div></li>`).join('')}</ol><p class="guide-boundary">本地数据保存在当前浏览器，请及时导出。AI 服务、在线检索、发布与收费状态以页面说明为准。</p></section></section>`;}
export function bindGuide(){const button=document.querySelector('.guide-toggle'),panel=document.querySelector('#writing-guide');if(!button||!panel)return;let open=true;try{open=localStorage.getItem('paperknow-writing-guide')!=='hidden';}catch{}const apply=()=>{panel.hidden=!open;button.setAttribute('aria-expanded',String(open));button.textContent=open?'隐藏操作指南':'操作指南';};apply();button.onclick=()=>{open=!open;apply();try{localStorage.setItem('paperknow-writing-guide',open?'visible':'hidden');}catch{}};}

export const writingHeading=()=>toolBanner('writing',{extraClass:'writing-hero writing-landing-hero',title:'从一个题目，开始你的论文',description:'整理研究资料、搭建论文结构，让每一步写作都有清晰的方向。',actions:'<a class="btn primary" href="#tool/writing">开始毕业论文 <span aria-hidden="true">→</span></a><button class="btn secondary" type="button" data-scroll-to="writing-capabilities">查看其他能力 <span aria-hidden="true">↓</span></button>'});
export const writingDetailHeading=id=>{const feature=getWritingFeatureIdentity(id);return toolBanner('writing',{extraClass:`writing-task-banner writing-task-${feature.key} writing-detail-hero`,title:feature.title,label:`AI 写作 · ${feature.title}`,description:feature.description,actions:'<a class="btn secondary writing-back-link" href="#category/writing">← 返回 AI 写作</a>'});};

// Detail styling is scoped to the current task. The existing controls keep their
// IDs and their event listeners; grouping changes presentation only.
export function decorateWritingDetail(root,id){
 const feature=getWritingFeatureIdentity(id);
 root.classList.remove('writing-landing');
 for(const name of [...root.classList])if(name.startsWith('writing-detail-theme-'))root.classList.remove(name);
 root.classList.add('writing-detail-commercial','writing-detail-page','writing-detail-theme-'+feature.key);
 for(const [name,value] of Object.entries({'--detail-accent':feature.accent,'--detail-soft':feature.soft,'--detail-ink':feature.ink,'--detail-art':`url("${feature.art}")`}))root.style.setProperty(name,value);
 const form=root.querySelector('#writing-form');
 const group=(nodes,{name,description,key})=>{
  const present=nodes.filter(node=>node?.parentElement===form);if(!present.length)return null;
  const fieldset=document.createElement('fieldset');fieldset.className='writing-detail-fieldset writing-detail-fieldset-'+key;
  const legend=document.createElement('legend');legend.textContent=name;fieldset.append(legend);
  if(description){const hint=document.createElement('p');hint.className='writing-detail-fieldset-hint';hint.textContent=description;fieldset.append(hint);}
  form.insertBefore(fieldset,present[0]);for(const node of present)fieldset.append(node);return fieldset;
 };
 if(form){
  const title=form.querySelector('label[for="writing-title"]'),topic=group([title,title?.nextElementSibling],{name:'写作主题',description:'用一个清楚的题目，确定这次写作的方向。',key:'topic'});
  if(topic)form.prepend(topic);
  const project=form.querySelector('#writing-project'),language=form.querySelector('#writing-language'),degree=form.querySelector('#writing-degree')?.closest('.creation-row');
  const profileGroup=group([project?.previousElementSibling,project,language?.previousElementSibling,language,degree],{name:'研究信息',description:'选择研究归属与写作语言，补充适合当前任务的基础信息。',key:'profile'});
  if(profileGroup)for(const control of [project,language]){const label=control?.previousElementSibling;if(!label||label.parentElement!==profileGroup)continue;const field=document.createElement('div');field.className='writing-detail-field';profileGroup.insertBefore(field,label);field.append(label,control);}
  if(feature.key==='writing'&&profileGroup){const options=form.querySelector(':scope > .writing-options');if(options){options.classList.add('writing-detail-profile-options');profileGroup.append(options);}}
  const detail=form.querySelector('.thesis-profile-fields');
  if(detail){detail.classList.add('writing-detail-research-fields');if(!detail.querySelector('summary')){const heading=document.createElement('div');heading.className='writing-detail-group-title';heading.innerHTML='<b>研究问题与方法</b><small>写清楚你要研究什么，以及如何展开论证。</small>';detail.prepend(heading);}}
  const extra=[...form.children].filter(node=>node.matches('.practice-basic-fields,.topic-basic-fields,.questionnaire-basic-fields,.analysis-basic-fields,.quick-basic-fields,.article-basic-fields'));
  group(extra,{name:feature.title+'要求',description:'围绕真实任务补充要求，让后续结构更有针对性。',key:'requirements'});
  const input=root.querySelector('.creation-input');input?.classList.add('writing-detail-input');
  const actions=input?.querySelector(':scope > .creation-actions');
  if(actions){actions.classList.add('writing-detail-actionbar');const copy=document.createElement('div');copy.className='writing-detail-action-copy';copy.innerHTML='<b>准备好，进入下一步</b><small>先保存草稿，随时继续完善</small>';actions.prepend(copy);}
  const kicker=document.createElement('span');kicker.className='writing-detail-panel-kicker';kicker.textContent='STEP 01 · YOUR RESEARCH BRIEF';input?.prepend(kicker);
 }
 const output=root.querySelector('.creation-output');output?.classList.add('writing-detail-output');
 root.querySelector('.writing-process-guide')?.classList.add('writing-detail-stepper');
 root.querySelector('.writing-guide-shell')?.classList.add('writing-detail-guide');
}
export function retainWritingCatalog(previous,current,focused=previous?.contains(document.activeElement)?document.activeElement:null){if(!previous||!current)return;const selected=current.querySelector('[aria-current="page"]')?.getAttribute('href');for(const link of previous.querySelectorAll('a')){if(link.classList.contains('capability-card')&&link.getAttribute('href')===selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}current.replaceWith(previous);focused?.focus({preventScroll:true});}
