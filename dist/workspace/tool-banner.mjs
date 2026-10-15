import {esc,icon} from './ui.mjs';

// One heading contract for all paper and research tools, including subviews.
export const toolBannerCategories=Object.freeze({
  writing:{title:'AI 写作',icon:'pen',description:'从研究问题到论文草稿，按步骤整理资料、提纲与章节。'},
  literature:{title:'AI 研读',icon:'book',description:'管理文献、检索资料、研读正文，并整理翻译内容。'},
  reduce:{title:'降重复率',icon:'pen',description:'对照真实来源，逐段整理表达与引用，保留修改记录。'},
  aigc:{title:'降AI率',icon:'file',description:'先核对观点与来源，再逐段整理你自己的学术表达。'},
  detection:{title:'免费查重',icon:'shield',description:'将论文与自备材料比对，定位匹配段落与来源证据。'},
  ppt:{title:'PPT 创作',icon:'chart',description:'从研究材料到清晰汇报，逐页制作与编辑演示文稿。'},
  format:{title:'格式排版',icon:'file',description:'上传 DOCX，按规范检查、排版与整理文档格式。'},
  research:{title:'科研工具',icon:'grid',description:'整理研究数据，制作图表、记录专业绘图需求与编辑公式。'}
});

// Titles and descriptions can contain user-provided document metadata.
// Actions are trusted markup from the owning tool and keep their original IDs.
export function toolBanner(key,{title,description,actions='',extraClass=''}={}){
  const category=Object.hasOwn(toolBannerCategories,key)?key:'writing';
  const feature=toolBannerCategories[category];
  return `<header class="tool-banner hub-heading ${esc(extraClass)}" data-tool-category="${category}"><div class="tool-banner-scene" aria-hidden="true"><span class="tool-banner-orbit"></span><span class="tool-banner-glass"></span><span class="tool-banner-token">${icon(feature.icon,18)}</span><span class="tool-banner-spark">${icon('plus',14)}</span></div><div class="tool-banner-copy"><span class="tool-banner-label"><span class="tool-banner-label-icon">${icon(feature.icon,15)}</span><span>论文与科研 · ${esc(feature.title)}</span></span><h1>${esc(title||feature.title)}</h1><p>${esc(description??feature.description)}</p>${actions?`<div class="hub-heading-actions tool-banner-actions">${actions}</div>`:''}</div></header>`;
}
