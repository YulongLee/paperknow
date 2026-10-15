import {esc,icon} from './ui.mjs';

// One heading contract across the workspace, services and research tools.
export const toolBannerCategories=Object.freeze({
  writing:{title:'AI 写作',icon:'pen',description:'从研究问题到论文草稿，按步骤整理资料、提纲与章节。'},
  literature:{title:'AI 研读',icon:'book',description:'管理文献、检索资料、研读正文，并整理翻译内容。'},
  reduce:{title:'降重复率',icon:'pen',description:'对照真实来源，逐段整理表达与引用，保留修改记录。'},
  aigc:{title:'降AI率',icon:'file',description:'先核对观点与来源，再逐段整理你自己的学术表达。'},
  detection:{title:'免费查重',icon:'shield',description:'将论文与自备材料比对，定位匹配段落与来源证据。'},
  ppt:{title:'PPT 创作',icon:'chart',description:'从研究材料到清晰汇报，逐页制作与编辑演示文稿。'},
  format:{title:'格式排版',icon:'file',description:'上传 DOCX，按规范检查、排版与整理文档格式。'},
  research:{title:'科研工具',icon:'grid',description:'整理研究数据，制作图表、记录专业绘图需求与编辑公式。'},
  home:{title:'工作台',group:'工作空间',icon:'grid',description:'组织项目、管理成果，在这里继续你的论文与研究。'},
  projects:{title:'我的项目',group:'工作空间',icon:'folder',description:'整理研究目标、资料与成果，让每一项研究都有清晰的进展。'},
  assets:{title:'我的成果',group:'工作空间',icon:'file',description:'集中管理写作、检测、图表与演示成果，随时继续编辑。'},
  tasks:{title:'任务中心',group:'工作空间',icon:'clock',description:'查看研究任务和处理记录，跟进每一步的实际状态。'},
  membership:{title:'会员与用量',group:'个人与服务',icon:'diamond',description:'了解功能开放范围，查看账户权益与实际用量。'},
  settings:{title:'设置中心',group:'个人与服务',icon:'settings',description:'管理研究偏好、界面体验与数据备份。'},
  help:{title:'帮助与反馈',group:'个人与服务',icon:'help',description:'查找使用指南、记录问题并获取支持。'},
  account:{title:'账户中心',group:'个人与服务',icon:'user',description:'管理登录账户、安全信息与研究偏好。'},
  orders:{title:'订单记录',group:'个人与服务',icon:'file',description:'查看账户中的订单与实际处理状态。'},
  usage:{title:'模型用量',group:'个人与服务',icon:'chart',description:'查看当前账户的模型调用与实际用量记录。'}
});

// Titles and descriptions can contain user-provided document metadata.
// Actions are trusted markup from the owning tool and keep their original IDs.
export function toolBanner(key,{title,description,actions='',extraClass=''}={}){
  const category=Object.hasOwn(toolBannerCategories,key)?key:'writing';
  const feature=toolBannerCategories[category];
  return `<header class="tool-banner hub-heading ${esc(extraClass)}" data-tool-category="${category}"><div class="tool-banner-scene" aria-hidden="true"><span class="tool-banner-orbit"></span><span class="tool-banner-glass"></span><span class="tool-banner-token">${icon(feature.icon,18)}</span><span class="tool-banner-spark">${icon('plus',14)}</span></div><div class="tool-banner-copy"><span class="tool-banner-label"><span class="tool-banner-label-icon">${icon(feature.icon,15)}</span><span>${esc(feature.group||'论文与科研')} · ${esc(feature.title)}</span></span><h1>${esc(title||feature.title)}</h1><p>${esc(description??feature.description)}</p>${actions?`<div class="hub-heading-actions tool-banner-actions">${actions}</div>`:''}</div></header>`;
}
