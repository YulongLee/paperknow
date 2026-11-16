import {esc,icon} from './ui.mjs';

// One introduction per upstream repository. No hosted Skill or execution flow.
export const plazaProjects=[
 {id:'scientific-agent-skills',title:'Scientific Agent Skills',repository:'K-Dense-AI/scientific-agent-skills',author:'K-Dense-AI',icon:'book',tone:'blue',description:'面向科学研究的开源 Skill 集合，涵盖文献检索、论文写作、引用管理、稿件审阅等研究任务。',license:'MIT',source:'https://github.com/K-Dense-AI/scientific-agent-skills'},
 {id:'humanizer',title:'Humanizer',repository:'blader/humanizer',author:'blader',icon:'pen',tone:'amber',description:'用于识别和改善文本中模板化表达的开源写作 Skill，帮助作者调整行文与语气。',license:'MIT',source:'https://github.com/blader/humanizer'}
];
function card(project){return `<a class="ap-card ap-${esc(project.tone)}" data-ap-project="${esc(project.id)}" href="${esc(project.source)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="${esc(project.title)}，查看 ${esc(project.author)} 的原项目（新标签页打开）"><div class="ap-card-top"><span class="ap-icon">${icon(project.icon,24)}</span><span class="ap-card-type">${esc(project.author)}</span></div><h2>${esc(project.title)}</h2><span class="ap-repository">${esc(project.repository)}</span><p class="ap-description">${esc(project.description)}</p><div class="ap-actions"><span class="ap-project">GitHub · ${esc(project.license)}</span><span class="ap-visit">查看原项目 <span aria-hidden="true">↗</span></span></div></a>`;}
export function mountAiPlaza(root){
 if(!root)return;
 root.innerHTML=`<main class="ai-plaza"><header class="ap-heading"><span class="ap-eyebrow">OPEN-SOURCE PROJECTS</span><h1>AI 科研广场</h1><p>分享科研与写作相关的开源项目，点击卡片直接前往原项目。</p></header><section class="ap-grid" aria-label="开源项目介绍">${plazaProjects.map(card).join('')}</section><footer class="ap-sharing-note"><p>项目由原作者维护，PaperKnow 仅作介绍与链接分享。具体使用说明、许可与效果以原项目为准。</p></footer></main>`;
}
