import {esc,icon} from './ui.mjs';

const labels={writing:'毕业论文',proposal:'开题报告',summary:'文献综述',taskbook:'任务书',article:'期刊文章',course:'课程作业',practice:'实践报告',idea:'课题思路',topic:'课题思路',questionnaire:'问卷设计',analysis:'数据分析',quick:'快速写作'};
const legacyModes=new Map([...Object.values(labels).map(label=>[label,label]),['论文初稿','毕业论文'],['论文大纲','毕业论文']]);
const dateFormatter=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

function draftId(value){
 if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0?String(value):null;
 if(typeof value!=='string'||!value.trim()||value.length>200||/[\u0000-\u001f\u007f]/.test(value))return null;
 try{encodeURIComponent(value);return value;}catch{return null;}
}
function timestamp(value){
 if(typeof value==='number')return Number.isFinite(value)&&!Number.isNaN(new Date(value).getTime())?value:null;
 if(typeof value!=='string'||!value.trim())return null;
 const raw=value.trim(),local=raw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
 const input=local?`${local[1]}-${local[2].padStart(2,'0')}-${local[3].padStart(2,'0')}T${(local[4]||'00').padStart(2,'0')}:${local[5]||'00'}:${local[6]||'00'}+08:00`:raw;
 const parsed=Date.parse(input);return Number.isFinite(parsed)?parsed:null;
}
function savedTime(draft){for(const value of [draft.updatedAt,draft.createdAt,draft.date]){const time=timestamp(value);if(time!==null)return time;}return null;}
function writingType(draft){
 if(typeof draft.tool==='string'&&draft.tool.trim())return Object.hasOwn(labels,draft.tool)?labels[draft.tool]:null;
 if(draft.tool!==undefined&&draft.tool!==null&&draft.tool!=='')return null;
 if(legacyModes.has(draft.mode))return legacyModes.get(draft.mode);
 const oldBody=Array.isArray(draft.bodySections)&&draft.bodySections.some(section=>section&&typeof section.title==='string'&&typeof section.text==='string');
 return typeof draft.outlineText==='string'&&draft.outlineText.trim()||oldBody||draft.outlineConfirmed===true&&typeof draft.text==='string'?'写作草稿':null;
}
function recentDrafts(drafts){
 const rows=[];
 for(const [index,draft]of (Array.isArray(drafts)?drafts:[]).entries()){
  if(!draft||typeof draft!=='object'||Array.isArray(draft)||draft.archived===true||draft.status==='archived'||draft.stage==='archived')continue;
  const id=draftId(draft.id),title=typeof draft.title==='string'&&draft.title.trim()?draft.title.trim():typeof draft.name==='string'?draft.name.trim():'',type=writingType(draft);
  if(id===null||!title||!type)continue;
  rows.push({id,title,type,time:savedTime(draft),index});
 }
 return rows.sort((a,b)=>(b.time??-Infinity)-(a.time??-Infinity)||a.index-b.index).slice(0,3);
}

export function writingLandingSide(drafts){
 const recent=recentDrafts(drafts);
 return `<aside class="writing-landing-side" aria-label="写作草稿与准备事项"><section class="writing-side-card writing-side-continue"><header class="writing-side-head"><h2>继续写作</h2><span class="writing-side-scope">当前浏览器</span></header>${recent.length?`<div class="writing-side-draft-list">${recent.map(draft=>`<a class="writing-side-draft" href="#draft/${encodeURIComponent(draft.id)}"><span class="writing-side-draft-icon">${icon('file',19)}</span><span class="writing-side-draft-copy"><b>${esc(draft.title)}</b><span class="writing-side-draft-meta"><span>${draft.type}</span>${draft.time===null?'<span class="writing-side-date">时间未记录</span>':`<time class="writing-side-date" datetime="${new Date(draft.time).toISOString()}">${dateFormatter.format(draft.time)}</time>`}</span></span><span class="writing-side-draft-arrow">${icon('arrow',15)}</span></a>`).join('')}</div>`:`<div class="writing-side-empty"><span>${icon('pen',24)}</span><b>还没有保存的写作草稿</b><p>选择写作类型开始，保存后可在这里继续。</p></div>`}<div class="writing-side-links">${recent.length?'<a href="#assets?scope=local">全部本地成果 →</a>':''}<a class="writing-side-account-link" href="#assets?scope=account">查看账户草稿 →</a></div></section><section class="writing-side-card writing-side-checklist"><header class="writing-side-head"><h2>写作准备清单</h2>${icon('check',19)}</header><ol class="writing-side-checklist-list">${[['明确题目','整理研究问题与写作目标'],['准备资料','收集有权使用的文献与研究材料'],['核对要求','确认学段、字数与学校格式规范']].map(([title,description],index)=>`<li><span>${String(index+1).padStart(2,'0')}</span><div><b>${title}</b><p>${description}</p></div></li>`).join('')}</ol><footer class="writing-side-save-note">${icon('shield',18)}<div><p>点击保存后，草稿留在当前浏览器。换设备前请先备份。</p><a href="#settings/data">导出备份 →</a></div></footer></section></aside>`;
}
