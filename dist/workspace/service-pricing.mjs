import {esc,icon} from './ui.mjs';
import {toolBanner} from './tool-banner.mjs';

const levels=['junior','bachelor','master','doctor'];
const groups=[['writing','AI 写作','pen'],['reading','文献研读','book'],['detection','论文检测','shield'],['revision','论文修改','spark'],['presentation','PPT 创作','chart'],['format','格式排版','file'],['research','科研工具','grid'],['basic','基础服务','folder']];
const family=(prefix)=>levels.map(level=>prefix+'-'+level);
const definitions=[
 ['writing','毕业论文',[...family('thesis'),'thesis-researcher'],'中文 12,000 字以内；英文 6,000 词以内','#tool/writing'],
 ['writing','长篇论文',['thesis-long'],'中文 12,001～30,000 字；英文按对应篇幅处理','#tool/writing'],
 ['writing','开题报告',family('proposal'),'目标篇幅 6,000 字以内','#tool/proposal'],
 ['writing','文献综述',family('literature-review'),'目标篇幅 8,000 字以内','#tool/summary'],
 ['writing','期刊文章',['writing-article'],'目标篇幅 10,000 字以内','#tool/article'],
 ['writing','课程作业',['writing-course'],'目标篇幅 5,000 字以内','#tool/course'],
 ['writing','实践报告',['writing-practice'],'目标篇幅 8,000 字以内','#tool/practice'],
 ['writing','任务书',family('taskbook'),'目标篇幅 3,000 字以内','#tool/taskbook'],
 ['writing','课题思路',['writing-idea'],'目标篇幅 1,500 字以内','#tool/idea'],
 ['writing','问卷设计',['writing-questionnaire'],'根据研究要求生成问卷','#tool/questionnaire'],
 ['writing','题目、方法与提纲辅助',['writing-planning'],'在各写作流程中使用','#category/writing'],
 ['reading','文献问答、总结与片段翻译',['literature-read','literature-answer','literature-translate'],'每次选取正文最多 3,000 字符；适用会员次数优先','#category/literature'],
 ['reading','整篇文献翻译 · 标准',['literature-document'],'20 页以内；适用会员翻译页数优先','#category/literature'],
 ['reading','整篇文献翻译 · 长篇',['literature-document-long'],'21～50 页；页数额度不足时按整次积分价处理','#category/literature'],
 ['detection','论文重复率检测',['detection-similarity'],'DOCX 原文；单篇 20,000 字符以内','#category/detection?view=web'],
 ['detection','论文 AI 率检测',['detection-aigc'],'DOCX 原文；单篇 20,000 字符以内','#category/detection?view=ai'],
 ['detection','重复率＋AI 率联合检测',['detection-combined'],'同一篇原文生成两份报告；一次计费','#category/detection?view=combined'],
 ['revision','降重复率 · 原文优化',['revision-reduce'],'整篇最多 10,000 字符','#category/reduce'],
 ['revision','降 AI 率 · 原文优化',['revision-aigc'],'整篇最多 10,000 字符','#category/aigc'],
 ['revision','检测报告定向优化',['revision-targeted'],'检测报告＋DOCX 原文；最多 10,000 字符','#category/reduce'],
 ['revision','AIGC 与重复率双向优化',['revision-dual'],'整篇最多 10,000 字符','#category/reduce'],
 ['revision','段落表达优化',['revision-paragraph'],'每次最多 1,000 字符','#category/reduce'],
 ['revision','学术润色',['polish'],'局部修改，每次最多 3,000 字符','#tool/polish','base'],
 ['revision','导师意见修改',['review'],'局部修改，每次最多 3,000 字符','#tool/review','base'],
 ['presentation','PPT 创作',['presentation-ai','presentation-proposal','presentation-thesis'],'20 页以内，支持开题、答辩与研究汇报','#tool/ppt'],
 ['presentation','增强 PPT',['presentation-enhanced'],'21～30 页','#tool/ppt'],
 ['format','智能排版',['format-advice'],'DOCX 原文；20,000 字符、2 MB 以内','#category/format'],
 ['research','AI 科研绘图',['research-image'],'按当前绘图设置生成图片','#category/research'],
 ['research','科研图表',['research-chart'],'根据描述与材料生成图表配置','#category/research'],
 ['research','科研结构示意图',['research-diagram'],'按内容生成结构与流程示意图','#category/research'],
 ['research','AI 公式辅助',['research-formula'],'识别、整理与生成公式','#category/research?mode=formula']
];
const freeServices=[
 ['文献检索与阅读标注','查找文献、阅读原文并记录标注','#category/literature'],
 ['文件管理','在账户空间额度内整理、复用与下载文件','#assets'],
 ['手动公式编辑','编辑与导出公式','#category/research?mode=formula'],
 ['数据分析工具','数据统计与结果整理','#tool/analysis']
];
const validCost=n=>Number.isSafeInteger(n)&&n>0&&n<=100000;
function tariff(item){
 const mode=item.effectiveMode??item.mode,cost=item.effectiveCreditCost??item.creditCost;
 if(!['paid','free','disabled'].includes(mode)||mode==='paid'&&!validCost(cost))return {mode:'unknown',cost:null,available:false};
 return {mode,cost:mode==='paid'?cost:0,available:mode!=='disabled'&&item.available===true};
}
export function buildServicePriceCatalogue(options){
 if(!Array.isArray(options?.billing?.services)||!Array.isArray(options?.toolBilling?.services))throw Error('暂时无法读取完整价目表，请稍后重试。');
 const tools=new Map(options.toolBilling.services.map(item=>[item.key,item])),base=new Map(options.billing.services.map(item=>[item.key,item]));
 const rows=[];
 for(const [group,title,keys,range,href,source] of definitions){
  const map=source==='base'?base:tools,found=keys.map(key=>map.get(key)).filter(Boolean),variants=new Map();
  for(const item of found){const price=tariff(item),signature=JSON.stringify(price);if(!variants.has(signature))variants.set(signature,[]);variants.get(signature).push(item);}
  for(const entries of variants.values()){
   const price=tariff(entries[0]),same=variants.size===1,id=entries.map(item=>item.key).join(',');
   rows.push({id,keys:entries.map(item=>item.key),group,title:same?title:entries.map(item=>String(item.title||title)).join(' / '),range,href,...price});
  }
 }
 if(!rows.length)throw Error('当前尚无可显示的服务价格，请稍后重试。');
 for(const [title,range,href]of freeServices)rows.push({id:'free:'+href,keys:[],group:'basic',title,range,href,mode:'free',cost:0,available:true});
 return {rows,groups:groups.filter(([id])=>rows.some(row=>row.group===id)),version:options.toolBilling.version};
}
const priceText=row=>row.mode==='paid'?row.cost.toLocaleString('zh-CN')+' 积分 / 次':row.mode==='free'?'免费':row.mode==='disabled'?'已暂停':'价格待发布';
const currencyText=row=>row.mode==='paid'?'¥'+(row.cost/10).toFixed(2):row.mode==='free'?'¥0':'—';
export function servicePriceCSV(catalogue){
 const cell=value=>{let text=String(value??'');if(/^\s*[=+\-@]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const titles=new Map(groups.map(([id,title])=>[id,title]));
 return [['分类','功能','积分费用','标准折合金额','处理范围','状态'],...catalogue.rows.map(row=>[titles.get(row.group),row.title,priceText(row),currencyText(row),row.range,row.available?'可使用':'暂未开放'])].map(row=>row.map(cell).join(',')).join('\r\n');
}
function ensureStyle(doc){if(!doc||doc.querySelector('[data-service-pricing-style]'))return;const link=doc.createElement('link');link.rel='stylesheet';link.href='/workspace/service-pricing.css';link.dataset.servicePricingStyle='';doc.head.append(link);}
export function servicePricingEntry(doc){ensureStyle(doc);return `<section class="member-pricing-entry" aria-label="服务价目表"><span class="member-pricing-icon" aria-hidden="true">${icon('file',25)}</span><div><h2>服务价目表 <span>当前价格</span></h2><p>查看各功能的积分费用、处理范围与使用入口。</p></div><a class="btn secondary" href="#membership/pricing">查看价目表 ${icon('arrow',16)}</a></section>`;}
function saveCSV(doc,name,content){const win=doc.defaultView,url=win.URL.createObjectURL(new win.Blob(['\uFEFF',content],{type:'text/csv;charset=utf-8'})),a=doc.createElement('a');a.href=url;a.download=name;doc.body.append(a);a.click();a.remove();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);}
let mounted=null;
export function disposeServicePricing(){mounted?.dispose();mounted=null;}
export function mountServicePricing({container=document.querySelector('.dashboard'),fetchImpl=globalThis.fetch,session,downloadFile}={}){
 disposeServicePricing();const doc=container.ownerDocument;
 ensureStyle(doc);
 container.innerHTML=toolBanner('membership',{title:'服务价目表',description:'费用清晰，按需使用。适用会员或套餐优先抵扣，之后使用科研积分。',actions:'<a class="btn secondary" href="#membership">返回会员与用量</a><a class="btn primary" href="#membership/recharge">购买积分</a>'})+`<section class="service-pricing-page" data-service-pricing-page><header class="service-pricing-heading"><div><span class="service-pricing-eyebrow">PAPERKNOW SERVICES</span><h2>每一项服务，清晰计价</h2><p>1 科研积分 = ¥0.10 标准面值。实际扣费以提交时显示的费用为准。</p></div><div class="service-pricing-actions"><a class="btn secondary" href="/admin.html#payments" data-price-admin hidden>管理价格</a><button type="button" class="btn secondary" data-price-refresh>刷新价格</button><button type="button" class="btn primary" data-price-download disabled>${icon('download',16)}下载价目表</button></div></header><div class="service-pricing-summary"><span>${icon('diamond',17)}适用权益优先</span><span>${icon('check',17)}成功后结算</span><span>${icon('shield',17)}失败或取消释放预占</span></div><div class="service-pricing-loading" role="status" data-price-loading>正在读取最新服务价格…</div><div class="service-pricing-layout" data-price-layout hidden><nav class="service-pricing-nav" aria-label="服务分类" data-price-nav></nav><div class="service-pricing-content"><div class="service-pricing-toolbar"><label>${icon('search',18)}<input type="search" placeholder="搜索功能或处理范围" aria-label="搜索服务价目表" data-price-search></label><span data-price-count></span></div><div class="service-pricing-table-window" role="region" aria-label="服务价格列表" tabindex="0"><table class="service-pricing-table"><thead><tr><th>功能与处理范围</th><th>积分费用</th><th>使用入口</th></tr></thead><tbody data-price-rows></tbody></table><p class="service-pricing-empty" data-price-empty hidden>没有找到匹配的功能，请换个关键词。</p></div></div></div><footer class="service-pricing-footnote"><span data-price-status role="status" aria-live="polite"></span><p>查看价格、切换分类和下载价目表均不扣积分。已有任务的结算与权益记录可在会员与用量中查看。</p></footer></section>`;
 const host=container.querySelector('[data-service-pricing-page]'),$=selector=>host.querySelector(selector);let alive=true,controller=null,catalogue=null,group='all',query='',requestId=0;
 const current=()=>alive&&host.isConnected;
 function paint(){if(!current()||!catalogue)return;const filtered=catalogue.rows.filter(row=>(group==='all'||row.group===group)&&(!query||(row.title+' '+row.range).toLocaleLowerCase().includes(query)));
  $('[data-price-rows]').innerHTML=filtered.map(row=>`<tr><td><strong>${esc(row.title)}</strong><p>${esc(row.range)}</p>${!row.available?'<small class="service-price-unavailable">暂未开放</small>':''}</td><td><b class="${row.mode==='free'?'service-price-free':''}">${esc(priceText(row))}</b><small>${esc(currencyText(row))}${row.mode==='paid'?' 标准面值':''}</small></td><td>${row.available?`<a href="${row.href}" class="service-price-open" aria-label="使用${esc(row.title)}">去使用 ${icon('arrow',14)}</a>`:'<span class="service-price-muted">暂不可用</span>'}</td></tr>`).join('');
  $('[data-price-empty]').hidden=filtered.length>0;$('[data-price-count]').textContent=filtered.length+' 项服务';
  host.querySelectorAll('[data-price-group]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.priceGroup===group)));
 }
 async function load(){controller?.abort();controller=new AbortController();const requestController=controller,own=++requestId,win=doc.defaultView,timeout=win.setTimeout(()=>requestController.abort(),15000);$('[data-price-refresh]').disabled=true;$('[data-price-download]').disabled=true;$('[data-price-status]').textContent=catalogue?'正在更新价格…':'';
  try{const response=await fetchImpl('/api/payments/options',{credentials:'same-origin',cache:'no-store',signal:requestController.signal});if(!response.ok)throw Error('服务价格暂时无法读取，请稍后重试。');const next=buildServicePriceCatalogue(await response.json());if(!current()||own!==requestId)return;catalogue=next;if(group!=='all'&&!next.groups.some(([id])=>id===group))group='all';
   $('[data-price-loading]').hidden=true;$('[data-price-layout]').hidden=false;$('[data-price-nav]').innerHTML=[['all','全部服务','grid'],...next.groups].map(([id,title,ico])=>`<button type="button" data-price-group="${id}" aria-pressed="${id===group}">${icon(ico,18)}<span>${title}</span><small>${next.rows.filter(row=>id==='all'||row.group===id).length}</small></button>`).join('');
   for(const button of host.querySelectorAll('[data-price-group]'))button.onclick=()=>{group=button.dataset.priceGroup;paint();};paint();$('[data-price-download]').disabled=false;$('[data-price-status]').textContent='已读取最新发布价格 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
  }catch(error){if(!current()||own!==requestId)return;if(!catalogue)$('[data-price-loading]').textContent='暂时无法读取服务价格，请点击“刷新价格”重试。';$('[data-price-status]').textContent=catalogue?'价格更新失败，当前为上次读取的价格；请刷新后再下载。':'价格尚未核对，暂不可下载。';}finally{win.clearTimeout(timeout);if(current()&&own===requestId)$('[data-price-refresh]').disabled=false;}
 }
 $('[data-price-search]').oninput=event=>{query=event.target.value.trim().toLocaleLowerCase();paint();};$('[data-price-refresh]').onclick=()=>void load();
 $('[data-price-download]').onclick=()=>{if(!catalogue||$('[data-price-download]').disabled)return;try{(downloadFile||((name,content)=>saveCSV(doc,name,content)))('PaperKnow_服务价目表_'+new Date().toLocaleDateString('en-CA')+'.csv',servicePriceCSV(catalogue));$('[data-price-status]').textContent='价目表已发起下载，可使用 Excel 打开。';}catch{$('[data-price-status]').textContent='暂时无法下载，请稍后重试。';}};
 if(session)void Promise.resolve().then(session).then(value=>{if(current()&&value?.user?.role==='admin')$('[data-price-admin]').hidden=false;}).catch(()=>{});
 const page={ready:load(),dispose(){alive=false;requestId++;controller?.abort();}};mounted=page;return page;
}
