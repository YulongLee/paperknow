import {withStableView} from './view-stability.mjs';
import {membershipPurchaseTiles} from './membership-summary.mjs';
import {feedbackKey,parseFeedbackDraft} from './help-model.mjs';
import {supportContactsMarkup,bindSupportContacts} from './support-contacts.mjs';
const statuses={open:'待处理',processing:'处理中',resolved:'已处理'};
const usageNumber=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString('zh-CN'):'未知';
export function onlineUsageSummary(items=[]){
 const sum=key=>{const values=items.map(item=>item[key]).filter(value=>Number.isSafeInteger(value)&&value>=0);return items.length&&!values.length?null:values.reduce((total,value)=>total+value,0);};
 return {records:items.length,inputTokens:sum('input_tokens'),outputTokens:sum('output_tokens'),unknownRecords:items.filter(item=>!Number.isSafeInteger(item.input_tokens)||item.input_tokens<0||!Number.isSafeInteger(item.output_tokens)||item.output_tokens<0).length};
}
export function publicFeedbackStatus(value){return statuses[value]||statuses.open;}

const countValue=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString('zh-CN'):'—';
function sizeMemberRecordLists(target,onDispose){
 const win=target.ownerDocument.defaultView,lists=[...target.querySelectorAll('.member-record-scroll')];
 const resize=()=>{for(const list of lists){
  if(!list.isConnected)continue;
  const table=list.querySelector('table'),rows=table?.tBodies[0]?.rows;
  if(!rows||rows.length<=5)continue;
  // Use actual row heights: held-credit details and long titles can wrap.
  const height=rows[4].getBoundingClientRect().bottom-table.getBoundingClientRect().top;
  if(height>0)list.style.maxHeight=Math.ceil(height+list.offsetHeight-list.clientHeight)+'px';
 }};
 resize();
 if(!lists.length||typeof onDispose!=='function')return;
 if(win.ResizeObserver){const observer=new win.ResizeObserver(resize);for(const list of lists)observer.observe(list.querySelector('table'));onDispose(()=>observer.disconnect());}
 else{win.addEventListener('resize',resize);onDispose(()=>win.removeEventListener('resize',resize));}
}
const serviceRoutes={
 polish:'#tasks?scope=account&type=polish',review:'#tasks?scope=account&type=review',
 'literature-read':'#category/literature?view=reading','literature-answer':'#category/literature?view=reading','literature-translate':'#category/literature?view=translation',
 'revision-reduce':'#category/reduce','revision-aigc':'#category/aigc','revision-dual':'#category/reduce',
 'presentation-ai':'#tool/ppt','presentation-proposal':'#tool/ppt?mode=proposal','presentation-thesis':'#tool/ppt?mode=thesis',
 'research-chart':'#category/research','research-diagram':'#category/research','research-formula':'#category/research','format-advice':'#category/format'
};
const runtimeReady=cap=>cap.thesis?.ready===true||cap.writing?.ready===true||cap.tools?.ready===true;
export function personalServiceState(cap,key){
 if(key==='agent'&&runtimeReady(cap)&&Array.isArray(cap.toolBilling?.services)&&cap.toolBilling.services.some(item=>personalServiceState(cap,item.key).ready))return {ready:true,label:'已开放'};
 const child=Object.hasOwn(serviceRoutes,key)&&!['polish','review'].includes(key);
 const configured=child?cap.tools?.ready===true:key==='agent'?(runtimeReady(cap)||cap.ai===true&&cap.agent===true):cap.ai===true;
 const rules=child?cap.toolBilling?.services:cap.billing?.services;
 if(!Array.isArray(rules))return {ready:configured,label:configured?'已开放':'未配置'};
 const rule=rules.find(item=>item?.key===key),mode=rule?.effectiveMode??rule?.mode;
 if(mode==='disabled')return {ready:false,label:'已暂停'};
 const ready=configured&&['free','paid'].includes(mode)&&rule.available===true;
 return {ready,label:ready?'已开放':'待配置'};
}
const taskLink=(key,cap={})=>key==='agent'?(runtimeReady(cap)?'#category/writing':cap.agent===true?'#tasks?scope=account&view=agent':''):serviceRoutes[key]||'';
function quotaRows(items,esc,{usable=true,cap={}}={}){
 const rows=Array.isArray(items)?items:[];
 return rows.length?`<ul class="member-quota-rows">${rows.map(item=>`<li><span>${esc(item?.title||'服务项目')}</span><span>包含 ${countValue(item?.quantity)} 次 · 已用 ${countValue(item?.used)} · 预占 ${countValue(item?.held)} · 剩余 ${countValue(item?.remaining)}</span>${usable&&personalServiceState(cap,item?.key).ready&&Number.isSafeInteger(item?.remaining)&&item.remaining>0&&taskLink(item?.key,cap)?`<a href="${taskLink(item.key,cap)}">使用服务 →</a>`:''}</li>`).join('')}</ul>`:'<p class="muted">次数使用记录暂不可用，请稍后刷新核对。</p>';
}
function billingActivity(billing,esc,date){
 const rows=Array.isArray(billing?.reservations)?billing.reservations:[];
 const states={held:'预占中',reserved:'预占中',settled:'已结算',consumed:'已结算',committed:'已结算',released:'已释放'};
 const sources={free:'免费任务',membership:'会员次数',bundle:'套餐次数',credits:'科研积分'};
 return `<section class="card personal-detail-card member-billing-activity"><header><div><h2>任务结算记录</h2><p class="muted">提交时先预占，成功后结算；失败或取消释放预占。重试会重新报价，未确认不会再次提交。</p></div><a href="#tasks?scope=account">查看账户任务 →</a></header>${rows.length?`<div class="account-personal-table${rows.length>5?' member-record-scroll':''}"${rows.length>5?' tabindex="0" role="region" aria-label="任务结算记录，上下滚动查看更多" data-scroll-key="member-billing-records"':''}><table><thead><tr><th>任务服务</th><th>结算来源</th><th>本次额度</th><th>状态</th><th>时间</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.title||({polish:'学术润色',review:'导师意见修改',agent:'科研智能助手'}[row.type||row.service_key]||'账户任务'))}</td><td>${esc(sources[row.source]||'来源待核对')}</td><td>${row.source==='credits'?`${countValue(row.creditCost??row.credit_cost)} 积分`:['membership','bundle'].includes(row.source)?'1 次':row.source==='free'?'免费':'—'}</td><td>${esc(states[row.status]||'状态待核对')}</td><td>${esc(date(row.updatedAt||row.updated_at||row.createdAt||row.created_at))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="account-empty"><b>暂无任务结算记录</b><p>使用已开放的账户 AI 服务并确认费用后，可在这里核对预占与结算。</p></div>'}</section>`;
}
function creditLedger(credits,esc,date){
 const ledger=Array.isArray(credits?.ledger)?credits.ledger:[];
 return `<section class="card personal-detail-card member-credit-ledger"><header><div><h2>科研积分流水</h2><p class="muted">仅展示当前账户的实际积分变动。未完成付款不入账；任务预占单独记录，成功后才结算。</p></div><a href="#orders">全部订单 →</a></header><div class="grid account-personal-metrics">${[['账户余额',credits?.balance],['当前可用',credits?.available],['任务预占',credits?.held]].map(([title,value])=>`<article class="account-personal-metric"><p class="muted">${title}</p><h3>${countValue(value)}</h3></article>`).join('')}</div>${ledger.length?`<div class="account-personal-table${ledger.length>5?' member-record-scroll':''}"${ledger.length>5?' tabindex="0" role="region" aria-label="科研积分流水，上下滚动查看更多" data-scroll-key="member-credit-records"':''}><table><thead><tr><th>交易内容</th><th>积分变动 / 预占变动</th><th>记录时间</th><th>来源记录</th></tr></thead><tbody>${ledger.map(item=>`<tr><td>${esc(item.title||({purchase:'科研积分充值',consume:'任务积分消费',reserve:'任务额度预占',settle:'任务积分结算',release:'任务额度释放',refund:'退款调整'}[item.kind]||'账户积分记录'))}</td><td class="${Number.isSafeInteger(item.amount)&&item.amount<0?'member-credit-decrease':'member-credit-increase'}">${Number.isSafeInteger(item.amount)?(item.amount>0?'+':'')+item.amount:'—'}${Number.isSafeInteger(item.heldDelta)&&item.heldDelta!==0?`<small>预占 ${item.heldDelta>0?'+':''}${item.heldDelta}</small>`:''}</td><td>${esc(date(item.createdAt||item.created_at))}</td><td>${item.orderId?`<a href="#membership/pay?order=${encodeURIComponent(item.orderId)}">查看订单</a>`:item.jobId?'<a href="#tasks?scope=account">查看任务</a>':'—'}</td></tr>`).join('')}</tbody></table></div>`:`<div class="account-empty"><b>${credits?'暂无积分流水':'积分记录暂不可用'}</b><p>付款到账与任务结算后，积分变动会显示在这里。</p><a href="#membership/recharge">查看积分方案 →</a></div>`}</section>`;
}
function purchasedBundleRecords(bundles,esc,date,billing={},cap={}){
 const rows=Array.isArray(bundles)?bundles.filter(bundle=>bundle&&typeof bundle.orderId==='string'&&bundle.orderId):[];
 const state=bundle=>{const start=Date.parse(bundle.startsAt),end=Date.parse(bundle.expiresAt);return !Number.isFinite(start)||!Number.isFinite(end)?'时间待核对':end<=Date.now()?'已到期':start>Date.now()?'待生效':'有效';};
 return `<section class="card personal-detail-card member-bundle-records" id="purchased-bundles"><header><div><h2>已购套餐记录 <span>${rows.length}</span></h2><p class="muted">核对已购服务、实际已用与预占次数。剩余次数仅在套餐有效期内且对应服务已开放时可用。</p></div><a href="#membership/bundles">查看套餐方案 →</a></header>${rows.length?`<div class="member-bundle-grid">${rows.map(bundle=>`<article class="member-bundle-record"><div class="row"><h3>${esc(bundle.title||'已购套餐')}</h3><span class="tag">${state(bundle)}</span></div><p class="member-bundle-description">${esc(bundle.description||'')}</p><dl><div><dt>生效时间</dt><dd>${esc(date(bundle.startsAt))}</dd></div><div><dt>到期时间</dt><dd>${esc(date(bundle.expiresAt))}</dd></div></dl><div class="member-bundle-item-heading"><span>已购服务与次数</span></div>${quotaRows(billing.bundleUsage?.[bundle.orderId]||bundle.items,esc,{usable:state(bundle)==='有效',cap})}<a href="#membership/pay?order=${encodeURIComponent(bundle.orderId)}">查看原订单 →</a></article>`).join('')}</div>`:'<div class="account-empty"><b>暂无已购套餐</b><p>套餐付款经服务器核验并发放后，会在这里记录服务次数和有效期。</p></div>'}</section>`;
}
export async function renderOnlinePersonal(view,ctx){
 if(!['usage','membership','help'].includes(view))return false;
 ctx.target.classList.add('personal-service-view');ctx.target.dataset.personalView=view;
 const {target,api,notify,submit,rememberForms,esc,date,icon,$}=ctx;
 const number=usageNumber;
 const size=value=>Number.isFinite(value)&&value>=0?`${(value/1024/1024).toFixed(2)} MB`:'未知';
 const metric=(title,value,note='')=>`<article class="card account-personal-metric"><p class="muted">${title}</p><h2>${value}</h2>${note?`<small class="muted">${note}</small>`:''}</article>`;
 const heading=(title,text,actions='')=>`<div class="account-personal-heading"><div><h2>${title}</h2><p class="muted">${text}</p></div>${actions?`<div class="actions">${actions}</div>`:''}</div>`;
 if(view==='usage'){
  const [data,summary]=await Promise.all([api('/usage'),api('/workspace/summary')]);
  const rows=Array.isArray(data.items)?data.items:[],known=onlineUsageSummary(rows),usage=summary.usage||{},storage=summary.storage||{},incomplete=usage.usageIncomplete===true||usage.unknownRecords>0||known.unknownRecords>0||!Number.isSafeInteger(usage.unknownRecords)&&usage.records>rows.length;
  const tokenTotal=Number.isSafeInteger(usage.inputTokens)&&Number.isSafeInteger(usage.outputTokens)?usage.inputTokens+usage.outputTokens:null;
  const tokenValue=incomplete?(tokenTotal>0?number(tokenTotal)+'（已知部分）':'未知'):number(tokenTotal);
  withStableView(target.closest('.dashboard')||target,()=>{target.innerHTML=heading('用量概况','来自当前登录账户的服务记录；本地草稿和材料比对不计入 AI 服务用量。','<a href="#membership?scope=account">账户服务与权益 →</a>')+
   `<div class="grid account-personal-metrics">${metric('AI 服务用量记录',number(usage.records),'账户累计记录')}${metric('Token 用量',tokenValue,`输入 ${number(usage.inputTokens)} · 输出 ${number(usage.outputTokens)}${incomplete?'；部分调用未返回完整用量，合计不代表实际全部消耗':''}`)}${metric('原件存储',size(storage.fileBytes),`上限 ${size(storage.maxAccountFileBytes)}`)}${metric('账户草稿存储',size(storage.draftBytes),`普通草稿上限 ${size(storage.maxAccountDraftBytes)}；不含论文章节历史与生成云文件`)}</div>`+
   `<section class="card personal-detail-card"><h2>AI 服务调用明细</h2><p class="muted">显示最近 ${rows.length} 条记录，最多 100 条。${known.unknownRecords?`${known.unknownRecords} 条记录未提供完整 Token 数。`:''}${data.billingEnabled?'账户 AI 任务已启用费用核验。':'当前未启用积分扣减。'}Token 用量不直接等于积分费用；本次费用以提交前报价及任务结算记录为准。</p><div class="account-personal-table"><table><thead><tr><th>服务</th><th>输入 Token</th><th>输出 Token</th><th>调用时间</th></tr></thead><tbody>${rows.map(row=>`<tr><td>AI 服务</td><td>${number(row.input_tokens)}</td><td>${number(row.output_tokens)}</td><td>${esc(date(row.created_at))}</td></tr>`).join('')||'<tr><td colspan="4"><div class="account-empty"><b>还没有 AI 服务使用记录</b><p>服务用量会在这里记录；未返回完整用量的项目单独标注，保存草稿不会产生 Token 消耗。</p><a href="#tasks?scope=account">查看账户任务 →</a></div></td></tr>'}</tbody></table></div></section>`+billingActivity(data.billing,esc,date);sizeMemberRecordLists(target,ctx.onDispose);});
  return true;
 }
 if(view==='membership'){
  const [entitlements,summary,cap,options]=await Promise.all([api('/payments/entitlements'),api('/workspace/summary'),api('/capabilities'),api('/payments/options').catch(error=>{if(error.status===401||error.code==='ACCOUNT_CHANGED'||error.name==='AbortError')throw error;return null;})]);
  cap.toolBilling=options?.toolBilling||cap.toolBilling||{services:[]};
  const billing=entitlements.billing||{},counts=summary.counts||{},items=Array.isArray(entitlements.items)?entitlements.items.filter(item=>item&&(item.type||item.entitlementType)==='membership'):[],bundles=Array.isArray(entitlements.bundles)?entitlements.bundles:[];
  withStableView(target.closest('.dashboard')||target,()=>{target.innerHTML=heading('我的权益与用量','会员、科研积分与已购套餐分别记录，按你的研究节奏选择。','<a href="#account?view=usage">查看真实用量 →</a>')+membershipPurchaseTiles({account:true,credits:entitlements.credits,items,bundles})+
   `<div class="grid account-personal-metrics">${metric('账户项目',number(counts.projects),'独立于浏览器本地项目')}${metric('账户草稿',number(counts.drafts),'已保存的可编辑内容')}${metric('处理成果',number(counts.results),'真实任务产出的记录')}${metric('上传原件',number(counts.files),'仅你主动上传的文件')}</div><div class="grid personal-service-columns"><section class="card personal-detail-card"><h2>当前可用服务</h2><div class="row"><span>账户项目、草稿与原件</span><span class="tag completed">已开放</span></div><div class="row"><span>正文解析与自备材料比对</span><span class="tag completed">已开放</span></div>${[['polish','学术润色'],['review','导师意见修改'],['agent',runtimeReady(cap)?'AI 写作与科研工具':'科研智能助手']].map(([key,title])=>`<div class="row"><span>${title}</span><span class="tag">${personalServiceState(cap,key).label}</span></div>`).join('')}${Array.isArray(cap.toolBilling?.services)?`<details><summary>查看分项工具服务状态</summary>${cap.toolBilling.services.map(item=>`<div class="row"><span>${esc(item.title||'工具服务')}</span><span class="tag">${personalServiceState(cap,item.key).label}</span></div>`).join('')}</details>`:''}<p class="muted">本地草稿不会自动上传。在线服务仅在提交相应任务后处理选定材料；各论文工具的能力以对应页面为准。</p><div class="actions"><a href="#projects?scope=account">管理账户内容 →</a><a href="#tasks?scope=account">查看任务 →</a></div></section><section class="card personal-detail-card"><h2>会员权益记录</h2><p class="muted">配额为每笔订单有效期内的总次数，不按月自动重置。</p>${items.length?items.map(item=>`<article class="account-entitlement"><div class="row"><b>${esc(item.title)}</b><span class="tag">${Date.parse(item.expires_at)>Date.now()?(Date.parse(item.starts_at)>Date.now()?'待生效':'有效'):'已到期'}</span></div><p>${esc(item.description||'')}</p><small class="muted">生效：${date(item.starts_at)}<br>到期：${date(item.expires_at)}</small>${quotaRows(item.usage||billing.membershipUsage?.[item.order_id]||item.membershipItems,esc,{usable:Date.parse(item.starts_at)<=Date.now()&&Date.parse(item.expires_at)>Date.now(),cap})}</article>`).join(''):'<div class="account-empty"><b>暂无已生效的会员权益</b><p>现有免费功能可以继续使用，不显示模拟余额或虚构额度。</p></div>'}<a href="#help?scope=account">联系支持与反馈 →</a></section></div>${purchasedBundleRecords(bundles,esc,date,billing,cap)}${creditLedger(entitlements.credits,esc,date)}${billingActivity(billing,esc,date)}<section class="card personal-storage-note"><h2>${icon('shield',20)} 资料保存说明</h2><p class="muted">本地备份只包含当前浏览器保存的记录，不覆盖或恢复账户内容。重要原件与账户成果请分别下载保管。</p><div class="actions"><a href="#membership?scope=local">查看本地保存统计 →</a><a href="#settings/data">本地数据与备份 →</a></div></section>`;sizeMemberRecordLists(target,ctx.onDispose);});
  return true;
 }
 let records=[],listError='';try{const data=await api('/feedback');if(!Array.isArray(data.items))throw Error('invalid_feedback_list');records=data.items;}catch(error){if(error.status===401||error.code==='ACCOUNT_CHANGED'||error.name==='AbortError')throw error;listError='反馈记录暂时无法读取，仍可填写问题或联系支持；点击刷新重新读取。';}
 withStableView(target.closest('.dashboard')||target,()=>{target.innerHTML=heading('问题支持','反馈会提交到当前登录账户，后台可查看并更新处理状态。','<a href="#help?scope=local">查看使用指南与本地反馈草稿 →</a>')+
  `<div class="grid personal-feedback-columns"><section class="card personal-detail-card personal-feedback-form"><h2>提交问题或建议</h2><form id="feedback-form"><label for="feedback-category">反馈类型</label><select id="feedback-category"><option>功能问题</option><option>使用咨询</option><option>体验建议</option><option>其他</option></select><label for="feedback">问题描述</label><textarea id="feedback" required minlength="2" maxlength="3000" rows="7" placeholder="请说明所在页面、操作步骤、问题现象及期望结果"></textarea><p class="muted">请勿填写密码、验证码、支付密钥或私人研究正文。提交后可以在右侧核对状态。</p><div class="actions"><button class="primary" type="submit">提交反馈</button></div><p id="feedback-submit-status" role="status" aria-live="polite"></p></form><section class="personal-feedback-support" aria-label="人工支持"><h3>人工支持</h3><p class="muted">也可以通过邮箱或微信联系我们。</p>${supportContactsMarkup()}</section></section><section class="card personal-detail-card personal-feedback-history"><div class="account-personal-heading"><h2>我的反馈记录</h2><button type="button" id="feedback-refresh">刷新状态</button></div><p class="muted">显示最近 100 条记录；“已处理”表示后台已结束本次处理，可通过客服邮箱或微信补充情况。</p><div id="feedback-records" aria-live="polite"></div><p id="feedback-list-status" role="status"></p></section></div>`;});
 bindSupportContacts(target);
 const renderRecords=()=>withStableView(target.closest('.dashboard')||target,()=>{$('#feedback-records').innerHTML=records.length?records.map(item=>`<article class="account-feedback-record"><div class="row"><b>${esc(item.category||'产品反馈')}</b><span class="tag ${item.status==='resolved'?'completed':''}">${publicFeedbackStatus(item.status)}</span></div><p class="account-feedback-body">${esc(item.body)}</p><small class="muted">提交：${date(item.created_at)}${item.updated_at?`<br>更新：${date(item.updated_at)}`:''}<br>编号：${esc(item.id)}</small></article>`).join(''):'<div class="account-empty"><b>还没有提交过反馈</b><p>本地保存的反馈草稿不会自动发送，请在左侧填写后主动提交。</p></div>';});
 renderRecords();
 if(listError){$('#feedback-records').innerHTML='<div class="account-empty"><b>反馈记录暂时无法读取</b><p>这不代表没有已提交的反馈，请刷新重试。</p></div>';$('#feedback-list-status').textContent=listError;}
 let refreshPromise=null,recordsRevision=0;
 const refresh=()=>{if(refreshPromise)return refreshPromise;const button=$('#feedback-refresh'),revision=recordsRevision;button.disabled=true;refreshPromise=(async()=>{try{const data=await api('/feedback');if(!Array.isArray(data.items))throw Error('invalid_feedback_list');if(revision!==recordsRevision)return;records=data.items;renderRecords();$('#feedback-list-status').textContent='状态已更新';}catch(error){if(error.status===401||error.code==='ACCOUNT_CHANGED'||error.name==='AbortError')throw error;$('#feedback-list-status').textContent='暂时无法刷新，已保留当前记录，请稍后重试。';}finally{refreshPromise=null;if(button.isConnected)button.disabled=false;}})();return refreshPromise;};
 $('#feedback-refresh').onclick=event=>submit(event,refresh);
 $('#feedback-form').onsubmit=event=>submit(event,async()=>{
  const form=$('#feedback-form'),text=$('#feedback').value.trim(),category=$('#feedback-category').value;
  if(text.length<2)throw new Error('请至少填写 2 个字的问题描述。');
  const controls=[...form.elements].map(element=>[element,element.disabled]);
  controls.forEach(([element])=>element.disabled=true);
  try{
   const saved=await api('/feedback',{text,category});
   recordsRevision++;if(saved.item){records=[saved.item,...records.filter(item=>item.id!==saved.item.id)].slice(0,100);renderRecords();}
   form.reset();rememberForms(true);
   $('#feedback-submit-status').textContent=`反馈已提交${saved.id?'，编号 '+saved.id:''}。`;
   notify('反馈已提交，可在右侧查看处理状态。');
   if(refreshPromise)await refreshPromise;await refresh();
  }finally{controls.forEach(([element,disabled])=>{if(element.isConnected)element.disabled=disabled;});}
 });
 if(new URLSearchParams(globalThis.location?.hash?.split('?')[1]||'').get('draft')==='local'){
  try{
   const raw=localStorage.getItem(feedbackKey),draft=parseFeedbackDraft(raw);
   if(draft.content.trim()){
    $('#feedback').value=draft.content;
    if([...$('#feedback-category').options].some(option=>option.value===draft.type))$('#feedback-category').value=draft.type;
    $('#feedback-submit-status').textContent=`已从当前浏览器草稿预填${draft.feature&&draft.feature!=='未选择'?'（'+draft.feature+'）':''}，请核对后点击“提交反馈”。本地草稿会保留。`;
   }
  }catch{$('#feedback-submit-status').textContent='本地草稿暂时无法读取，请保留原数据；仍可在这里重新填写。';}
 }
 return true;
}
