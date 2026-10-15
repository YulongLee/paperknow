import {feedbackKey,normalizeFeedback} from './help-model.mjs';
const statuses={open:'待处理',processing:'处理中',resolved:'已处理'};
const usageNumber=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString('zh-CN'):'未知';
export function onlineUsageSummary(items=[]){
 const sum=key=>items.reduce((total,item)=>total+(Number.isSafeInteger(item[key])&&item[key]>=0?item[key]:0),0);
 return {records:items.length,inputTokens:sum('input_tokens'),outputTokens:sum('output_tokens'),unknownRecords:items.filter(item=>!Number.isSafeInteger(item.input_tokens)||item.input_tokens<0||!Number.isSafeInteger(item.output_tokens)||item.output_tokens<0).length};
}
export function publicFeedbackStatus(value){return statuses[value]||statuses.open;}
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
  const rows=Array.isArray(data.items)?data.items:[],known=onlineUsageSummary(rows),usage=summary.usage||{},storage=summary.storage||{};
  target.innerHTML=heading('用量概况','来自当前登录账户的服务记录；本地草稿和材料比对不计入模型用量。','<a href="#membership?scope=account">账户服务与权益 →</a>')+
   `<div class="grid account-personal-metrics">${metric('成功模型调用',number(usage.records),'账户累计记录')}${metric('已知 Token 合计',number(Number.isSafeInteger(usage.inputTokens)&&Number.isSafeInteger(usage.outputTokens)?usage.inputTokens+usage.outputTokens:null),`输入 ${number(usage.inputTokens)} · 输出 ${number(usage.outputTokens)}`)}${metric('原件存储',size(storage.fileBytes),`上限 ${size(storage.maxAccountFileBytes)}`)}${metric('账户草稿存储',size(storage.draftBytes),`上限 ${size(storage.maxAccountDraftBytes)}`)}</div>`+
   `<section class="card personal-detail-card"><h2>模型调用明细</h2><p class="muted">显示最近 ${rows.length} 条记录，最多 100 条。${known.unknownRecords?`${known.unknownRecords} 条记录未提供完整 Token 数。`:''}PaperKnow 当前未启用扣费；此处不代表会员额度或应付金额，第三方模型供应商可能按自己的规则收费。</p><div class="account-personal-table"><table><thead><tr><th>模型</th><th>输入 Token</th><th>输出 Token</th><th>调用时间</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.model||'未返回模型名')}</td><td>${number(row.input_tokens)}</td><td>${number(row.output_tokens)}</td><td>${date(row.created_at)}</td></tr>`).join('')||'<tr><td colspan="4"><div class="account-empty"><b>还没有真实模型调用记录</b><p>成功调用并返回用量后，会在这里记录；保存草稿不会产生 Token 消耗。</p><a href="#tasks?scope=account">查看账户任务 →</a></div></td></tr>'}</tbody></table></div></section>`;
  return true;
 }
 if(view==='membership'){
  const [entitlements,summary,cap]=await Promise.all([api('/payments/entitlements'),api('/workspace/summary'),api('/capabilities')]);
  const counts=summary.counts||{},items=Array.isArray(entitlements.items)?entitlements.items:[];
  target.innerHTML=heading('服务概况','核对账户保存内容与已有权益。支付本次暂不开放，不会创建订单或扣款。','<a href="#account?view=usage">查看真实用量 →</a>')+
   `<div class="grid account-personal-metrics">${metric('账户项目',number(counts.projects),'独立于浏览器本地项目')}${metric('账户草稿',number(counts.drafts),'已保存的可编辑内容')}${metric('处理成果',number(counts.results),'真实任务产出的记录')}${metric('上传原件',number(counts.files),'仅你主动上传的文件')}</div><div class="grid personal-service-columns"><section class="card personal-detail-card"><h2>当前可用服务</h2><div class="row"><span>账户项目、草稿与原件</span><span class="tag completed">已开放</span></div><div class="row"><span>正文解析与自备材料比对</span><span class="tag completed">已开放</span></div><div class="row"><span>在线 AI 修改</span><span class="tag">${cap.ai?'已开放':'未配置'}</span></div><div class="row"><span>科研智能助手</span><span class="tag">${cap.agent?'已开放':'未配置'}</span></div><p class="muted">本地草稿不会自动上传。在线服务仅在提交相应任务后处理选定材料；各论文工具的能力以对应页面为准。</p><div class="actions"><a href="#projects?scope=account">管理账户内容 →</a><a href="#tasks?scope=account">查看任务 →</a></div></section><section class="card personal-detail-card"><h2>已有权益记录</h2>${items.length?items.map(item=>`<article class="account-entitlement"><div class="row"><b>${esc(item.title)}</b><span class="tag">${Date.parse(item.expires_at)>Date.now()?(Date.parse(item.starts_at)>Date.now()?'待生效':'有效'):'已到期'}</span></div><p>${esc(item.description||'')}</p><small class="muted">生效：${date(item.starts_at)}<br>到期：${date(item.expires_at)}</small></article>`).join(''):'<div class="account-empty"><b>暂无已生效的会员权益</b><p>现有免费功能可以继续使用，不显示模拟余额或虚构额度。</p></div>'}<a href="#help?scope=account">联系支持与反馈 →</a></section></div><section class="card personal-storage-note"><h2>${icon('shield',20)} 资料保存说明</h2><p class="muted">本地备份只包含当前浏览器保存的记录，不覆盖或恢复账户内容。重要原件与账户成果请分别下载保管。</p><div class="actions"><a href="#membership?scope=local">查看本地保存统计 →</a><a href="#settings/data">本地数据与备份 →</a></div></section>`;
  return true;
 }
 let records=(await api('/feedback')).items||[];
 target.innerHTML=heading('问题支持','反馈会提交到当前登录账户，后台可查看并更新处理状态。','<a href="#help?scope=local">查看使用指南与本地反馈草稿 →</a>')+
  `<div class="grid personal-feedback-columns"><section class="card personal-detail-card personal-feedback-form"><h2>提交问题或建议</h2><form id="feedback-form"><label for="feedback-category">反馈类型</label><select id="feedback-category"><option>功能问题</option><option>使用咨询</option><option>体验建议</option><option>其他</option></select><label for="feedback">问题描述</label><textarea id="feedback" required minlength="2" maxlength="3000" rows="7" placeholder="请说明所在页面、操作步骤、问题现象及期望结果"></textarea><p class="muted">请勿填写密码、验证码、支付密钥或私人研究正文。提交后可以在右侧核对状态。</p><div class="actions"><button class="primary" type="submit">提交反馈</button></div><p id="feedback-submit-status" role="status" aria-live="polite"></p></form><p class="muted">人工支持：<a href="mailto:contact@oneshowailab.com">contact@oneshowailab.com</a></p></section><section class="card personal-detail-card personal-feedback-history"><div class="account-personal-heading"><h2>我的反馈记录</h2><button type="button" id="feedback-refresh">刷新状态</button></div><p class="muted">显示最近 100 条记录；“已处理”表示后台已结束本次处理，可通过客服邮箱补充情况。</p><div id="feedback-records" aria-live="polite"></div><p id="feedback-list-status" role="status"></p></section></div>`;
 const renderRecords=()=>{$('#feedback-records').innerHTML=records.length?records.map(item=>`<article class="account-feedback-record"><div class="row"><b>${esc(item.category||'产品反馈')}</b><span class="tag ${item.status==='resolved'?'completed':''}">${publicFeedbackStatus(item.status)}</span></div><p class="account-feedback-body">${esc(item.body)}</p><small class="muted">提交：${date(item.created_at)}${item.updated_at?`<br>更新：${date(item.updated_at)}`:''}<br>编号：${esc(item.id)}</small></article>`).join(''):'<div class="account-empty"><b>还没有提交过反馈</b><p>本地保存的反馈草稿不会自动发送，请在左侧填写后主动提交。</p></div>';};
 renderRecords();
 let refreshing=false;
 const refresh=async()=>{if(refreshing)return;refreshing=true;const button=$('#feedback-refresh');button.disabled=true;try{const data=await api('/feedback');records=data.items||[];renderRecords();$('#feedback-list-status').textContent='状态已更新';}catch(error){if(error.status===401||error.name==='AbortError')throw error;$('#feedback-list-status').textContent='暂时无法刷新，已保留当前记录，请稍后重试。';}finally{refreshing=false;if(button.isConnected)button.disabled=false;}};
 $('#feedback-refresh').onclick=event=>submit(event,refresh);
 $('#feedback-form').onsubmit=event=>submit(event,async()=>{
  const form=$('#feedback-form'),text=$('#feedback').value.trim(),category=$('#feedback-category').value;
  if(text.length<2)throw new Error('请至少填写 2 个字的问题描述。');
  const controls=[...form.elements].map(element=>[element,element.disabled]);
  controls.forEach(([element])=>element.disabled=true);
  try{
   const saved=await api('/feedback',{text,category});
   if(saved.item){records=[saved.item,...records].slice(0,100);renderRecords();}
   form.reset();rememberForms(true);
   $('#feedback-submit-status').textContent=`反馈已提交${saved.id?'，编号 '+saved.id:''}。`;
   notify('反馈已提交，可在右侧查看处理状态。');
   await refresh();
  }finally{controls.forEach(([element,disabled])=>{if(element.isConnected)element.disabled=disabled;});}
 });
 if(new URLSearchParams(globalThis.location?.hash?.split('?')[1]||'').get('draft')==='local'){
  try{
   const raw=localStorage.getItem(feedbackKey),draft=normalizeFeedback(raw?JSON.parse(raw):{});
   if(draft.content.trim()){
    $('#feedback').value=draft.content;
    if([...$('#feedback-category').options].some(option=>option.value===draft.type))$('#feedback-category').value=draft.type;
    $('#feedback-submit-status').textContent=`已从当前浏览器草稿预填${draft.feature&&draft.feature!=='未选择'?'（'+draft.feature+'）':''}，请核对后点击“提交反馈”。本地草稿会保留。`;
   }
  }catch{$('#feedback-submit-status').textContent='本地草稿暂时无法读取，请保留原数据；仍可在这里重新填写。';}
 }
 return true;
}
