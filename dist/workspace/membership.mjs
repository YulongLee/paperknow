import {keys,list,projects,profile} from './state.mjs';
import {literatureKey} from './literature-model.mjs';
import {esc,icon} from './ui.mjs';
const $=s=>document.querySelector(s);
export function membershipSnapshot({projectRows=[],drafts=[],papers=[],reports=[],reportError=false}={}){
 // Counts are persisted records, never requests, credits, billable usage or completion claims.
 return {projects:projectRows.length,assets:reportError?null:drafts.length+reports.length,papers:papers.length,reports:reportError?null:reports.length};
}
const features=[
 ['pen','写作与修改','大纲、草稿与修改记录',[['#category/writing','开始写作'],['#category/revision','修改稿件']]],
 ['book','文献与笔记','导入原文、整理阅读笔记',[['#category/literature','打开文献库']]],
 ['search','论文查重','与自备材料比对并核对来源',[['#category/detection','查看论文检测']]],
 ['chart','演示与科研图表','编辑 PPT、按真实数据绘图',[['#category/ppt','创作 PPT'],['#category/research','科研绘图']]],
 ['file','DOCX 格式排版','保留原件、检查并导出副本',[['#category/format','开始排版']]],
 ['user','投稿与学术简历','整理清单与真实经历',[['#category/more','打开更多工具']]]
];
export function mountMembership({modal,reportRows=[],reportError=false}){
 const counts=membershipSnapshot({projectRows:projects(),drafts:list(keys.drafts),papers:list(literatureKey),reports:reportRows,reportError}),name=profile().name;
 const stats=[['folder','项目',counts.projects,'#projects'],['file','成果',counts.assets,'#assets?category=all'],['book','文献',counts.papers,'#category/literature'],['search','比对报告',counts.reports,'#assets?category=detection']];
 // My Assets currently uses in-memory filters; use an explicit route filter for the report shortcut.
 $('.dashboard').innerHTML=`<div class="hub-heading"><div><h1>会员与用量</h1><p>了解当前权益、可用功能与使用情况。</p></div><a class="btn secondary" href="#orders">订单记录 ${icon('arrow',16)}</a></div>
 <section class="member-account" aria-label="当前账户权益"><div class="member-identity"><span class="member-avatar">${esc(name.slice(0,1)||'研')}</span><div><div class="member-name"><h2>${esc(name)}</h2><span class="member-pill">本地体验用户</span></div><p>当前使用本地功能，在线会员与计费服务尚未启用。</p></div></div><div class="member-status"><div>${icon('shield',22)}<span>会员状态<b>尚未开放</b></span></div><div>${icon('chart',22)}<span>在线额度<b>尚未启用</b></span></div><div>${icon('folder',22)}<span>云端同步<b>尚未接入</b></span></div></div><a class="member-account-link" href="#membership?section=features">查看可用功能 ${icon('arrow',15)}</a></section>
 <div class="member-layout"><div class="member-main"><section class="card member-card"><header><h2>使用概况</h2><div class="member-switch" aria-label="统计范围"><span>本地记录</span><button disabled title="在线计量服务尚未接入，不显示虚构用量">在线用量 <small>待接入</small></button></div></header><div class="member-stats">${stats.map(([ico,label,value,url])=>`<a href="${url}" aria-label="${label}${value===null?'数量暂时无法读取':value+(label==='项目'?'个':label==='文献'?'篇':'份')}"><span>${icon(ico,22)}${label}</span><b>${value===null?'—':value.toLocaleString('zh-CN')}</b></a>`).join('')}</div><p class="member-caption">当前浏览器中的保存记录，包含已归档项目与历史成果；不代表 AI 调用或付费消耗。</p>${reportError?'<p class="member-warning" role="status">比对报告暂时无法读取，成果总数与报告数暂不显示。其他本地记录不受影响。</p>':''}</section>
 <section class="card member-card member-features" id="member-features"><header><h2>当前可用权益</h2><span class="member-pill mint">本地可用</span></header><div class="member-feature-grid">${features.map(([ico,title,desc,links])=>`<article><span class="member-feature-icon">${icon(ico,25)}</span><div><h3>${title}</h3><p>${desc}</p><div>${links.map(([url,label])=>`<a href="${url}">${label} ${icon('arrow',12)}</a>`).join('')}</div></div></article>`).join('')}</div><footer><p>支持的导出格式以各工具页面为准。</p><a href="#home">查看全部工具 ${icon('arrow',15)}</a></footer></section></div>
 <aside class="member-side"><section class="card member-card"><header><h2>在线服务与套餐</h2><span class="member-pill">筹备中</span></header><p class="member-description">服务接入后，将公布套餐权益、计量单位与有效期。</p><div class="member-services">${[['pen','AI 写作与研读'],['search','开放学术来源检索'],['diamond','支付与在线额度']].map(([ico,title])=>`<div>${icon(ico,19)}<span>${title}</span><small>待接入</small></div>`).join('')}</div><p class="member-caption">当前不收费，不展示虚构余额或用量。</p></section><section class="card member-card"><header><h2>订单与帮助</h2></header><div class="member-help"><a href="#orders">${icon('file',19)}<span>订单记录</span>${icon('arrow',16)}</a><button id="member-policy">${icon('help',19)}<span>权益与计费说明</span>${icon('arrow',16)}</button><a href="#help">${icon('help',19)}<span>帮助与反馈</span>${icon('arrow',16)}</a></div><p class="member-caption">支付与售后规则将在开放前公布。</p></section></aside></div>
 <section class="card member-card member-usage"><header><h2>在线用量记录</h2><div><select disabled aria-label="筛选在线用量功能"><option>全部功能 · 待启用</option></select><a href="#tasks">查看任务中心 ${icon('arrow',15)}</a></div></header><div class="member-table-wrap"><table><thead><tr>${['任务','功能','消耗','状态','时间'].map(label=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody><tr><td colspan="5"><div class="member-usage-empty">${icon('clock',36)}<h3>暂无在线用量记录</h3><p>在线服务启用后，可在这里核对每次任务的实际消耗。</p><small>本地保存与材料比对记录可在任务中心查看，不属于在线计费。</small></div></td></tr></tbody></table></div></section>
 <div class="member-backup">${icon('shield',26)}<div><b>本地内容，请及时备份</b><p>更换设备或清理浏览器数据不会自动保留当前材料。</p></div><button class="btn secondary" data-workspace-backup>导出工作空间备份</button></div>`;
 $('#member-policy').onclick=()=>modal('权益与计费说明',`<div class="member-policy"><h3>当前本地体验</h3><p>当前没有付费会员、在线余额或计费额度。本地保存数量仅表示此浏览器中保留的记录，不是 AI 使用次数。</p><h3>当前功能边界</h3><p>写作、修改、演示与材料整理以工具页面的可用能力为准。论文材料比对仅覆盖你提供的对照文本，检测结果不等同于知网、万方或维普。AI 翻译、在线学术检索、正式账号及支付尚未接入。</p><h3>正式服务开放前公布</h3><ul><li>套餐权益、价格、有效期与计量单位。</li><li>额度重置、超额使用及任务失败、取消、重试的费用处理规则。</li><li>订单、支付、发票、退款与售后支持范围。</li></ul><p>以上规则目前尚未生效，不提供模拟购买或支付成功记录。</p><a class="btn secondary" href="#help">帮助与反馈</a></div>`);
}
