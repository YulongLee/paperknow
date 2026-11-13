import {withStableView} from './view-stability.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validQuote=(q,type)=>!!(q&&q.type===type&&['free','membership','bundle','credits'].includes(q.source)&&typeof q.title==='string'&&q.title.trim()&&typeof q.token==='string'&&q.token.length>0&&q.token.length<=4096&&Number.isSafeInteger(q.creditCost)&&q.creditCost>=0&&(q.source==='credits'?q.creditCost>0:q.creditCost===0)&&Number.isFinite(Date.parse(q.expiresAt))&&Date.parse(q.expiresAt)>Date.now());
const quoteLabel=q=>q.source==='credits'?`本次消耗 ${q.creditCost} 科研积分`:q.source==='membership'?'本次使用 1 次会员权益':q.source==='bundle'?'本次使用 1 次套餐权益':'本次免费';
const active=status=>['submitting','queued','running','recovering'].includes(status);
const panelMarkup=new WeakMap();
export const simulationPending=draft=>active(draft.simulationJob?.status)||['pending','saving'].includes(draft.simulationJob?.adoptionStatus);
export function mergeThesisSupplements(incoming,account={}){
 const merged=structuredClone(incoming),protectedMaterial=row=>row?.dataKind==='simulation'||String(row?.id||'').startsWith('simulation:')||['研究证据补充','致谢事实','文献补充片段（作者提供，未核验为全文）'].includes(row?.purpose),protectedReference=row=>['作者终稿补充文献','自动获取摘要（非全文）','自动补充文献摘要（非全文）'].includes(row?.sourceLabel);
 for(const [key,protectedRow]of [['materials',protectedMaterial],['references',protectedReference]]){
  const rows=Array.isArray(merged[key])?merged[key]:[];
  for(const saved of account[key]||[])if(protectedRow(saved)){const at=rows.findIndex(row=>row.id===saved.id);if(at<0)rows.push(structuredClone(saved));else rows[at]=structuredClone(saved);}
  merged[key]=rows;
 }
 if(account.requirements?.deliveryVersion===1)merged.requirements={...merged.requirements,deliveryVersion:1};
 return merged;
}
export function completionHasUnsavedInputs(draft){return !!(draft.supplement?.trim()||draft.acknowledgements?.trim()||Object.keys(draft.metadata||{}).length||draft.materials?.length||draft.references?.length||draft.simulationRunIds?.length||Object.values(draft.reference||{}).some(value=>String(value).trim()));}
export function synchronizeSimulationState(draft,item){
 const rows=(item?.snapshot?.materials||[]).filter(row=>row.dataKind==='simulation'),state=draft.simulationJob;
 const saved=state?.jobId?rows.find(row=>row.simulation?.jobId===state.jobId):!state?rows.at(-1):null;
 if(saved){
  draft.simulationJob={...state,clientKey:state?.clientKey||'saved-'+saved.simulation.jobId,status:'completed',jobId:saved.simulation.jobId,thesisId:item.id,version:item.version,adoptionStatus:'saved',error:'',text:saved.text,sampleSize:saved.simulation.recipe?.sampleSize||0,variableCount:saved.simulation.recipe?.variables?.length||0};
  draft.simulationRunIds=(draft.simulationRunIds||[]).filter(id=>id!==saved.simulation.jobId);draft.dirty=completionHasUnsavedInputs(draft);
 }else if(state?.status==='completed'&&state.adoptionStatus==='saved'){state.adoptionStatus='missing';state.error='这份模拟资料未保存在当前论文中，可恢复后继续使用。';}
}
export function simulationPanelHTML(draft,{disabled=false,recovery=null,allowGenerate=true}={}){
 if(!allowGenerate&&!draft.simulationJob&&!recovery)return '';
 const state=draft.simulationJob,working=simulationPending(draft),ready=state?.status==='completed',stages={quoted:'费用已核对，请确认后生成',submitting:'正在提交模拟方案任务',recovering:'正在读取已提交任务',queued:'正在排队',running:'正在设计方案并生成模拟数据',completed:state?.adoptionStatus==='saved'?'模拟资料已保存到当前论文':['pending','saving'].includes(state?.adoptionStatus)?'正在保存模拟资料':state?.adoptionStatus==='failed'?'模拟资料已生成，保存待重试':'模拟资料已生成，待保存',failed:'本次模拟数据未生成',cancelled:'已停止生成'};
 return `<section class="thesis-simulation-panel" aria-label="仿真研究数据"><div class="thesis-simulation-heading"><div><h4>${allowGenerate?'仿真研究数据':'已有模拟资料'}</h4><p>${allowGenerate?'为仿真研究生成数据，保留模拟方法和数据说明。不会替代真实实验或调查记录。':'已保存或正在处理的模拟资料可继续使用，原有模拟方法与数据说明会保留。'}</p></div>${allowGenerate?`<button type="button" class="btn secondary" data-simulation-generate ${disabled||working?'disabled':''}>${state?.status==='quoted'?'确认费用并生成':ready?'重新生成仿真数据':'生成仿真数据'}</button>`:''}</div>${state?`<div class="thesis-simulation-status${working?' is-active':''}" role="status" aria-live="polite">${working?'<span class="writing-method-ai-spinner" aria-hidden="true"></span>':''}<strong>${esc(stages[state.status]||'正在读取状态')}</strong>${working?'<div class="writing-method-ai-track" role="progressbar" aria-label="模拟数据生成进度" aria-valuetext="'+esc(stages[state.status]||'正在处理')+'"><span></span></div>':''}${state.costLabel?`<p>${esc(state.costLabel)} · 成功后结算，失败或取消释放预占</p>`:''}${state.error?`<p class="thesis-error">${esc(state.error)}</p>`:''}</div>`:''}${ready?`<p class="thesis-simulation-badge">模拟数据 · 非实测 · ${Number(state.sampleSize)||0} 条记录${state.variableCount?' · '+Number(state.variableCount)+' 类指标':''}</p><label>模拟资料预览<textarea readonly rows="6" data-simulation-preview>${esc(state.text||'')}</textarea></label>`:''}${ready&&!working&&state.adoptionStatus!=='saved'?'<button type="button" class="btn secondary" data-simulation-save>保存模拟资料并继续</button>':''}${recovery&&!working&&recovery.id!==state?.jobId?`<div class="thesis-simulation-recovery"><p>找到已生成的模拟资料：${esc(recovery.title)} · ${Number(recovery.sampleSize)||0} 条记录。可直接恢复使用。</p><button type="button" class="btn secondary" data-simulation-restore>恢复已生成的模拟资料</button></div>`:''}<p class="thesis-simulation-cost">${allowGenerate?'生成按现有研究规划价格使用套餐或积分；保存和恢复已有模拟资料不再次扣费。模拟数据用于仿真方法与分析，文献、封面信息等剩余缺项将单独检查。':'保存和恢复已有资料不再次扣费。模拟资料仅用于明确披露的仿真分析。'}</p>${active(state?.status)&&state?.jobId?'<button type="button" class="btn secondary" data-simulation-cancel>停止生成</button>':''}</section>`;
}
export function createThesisSimulationController({api,owner,getItem,getDraft,getUserId,isCurrent,persist,render,onCompleted,onSave,onRestore,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let disposed=false,busy=false,timer=null,approved=null;
 const current=()=>!disposed&&isCurrent(),changed=()=>{if(current()){persist();render();}},stop=()=>{if(timer!==null)clearTimer(timer);timer=null;},schedule=()=>{stop();if(current()&&active(getDraft().simulationJob?.status))timer=setTimer(()=>void refresh(),1800);};
 function take(value){
  const draft=getDraft(),state=draft.simulationJob,item=getItem();
  if(!value?.id||value.operation!=='simulation'||value.thesisId!==state?.thesisId||String(value.userId)!==String(getUserId())||state?.jobId&&state.jobId!==value.id)throw Object.assign(Error('模拟任务不属于当前账户或请求'),{status:403});
  if(!['queued','running','completed','failed','cancelled'].includes(value.status))throw Object.assign(Error('模拟任务状态不完整'),{status:422});
  Object.assign(state,{jobId:value.id,status:value.status,error:value.error||''});
  if(value.status==='completed'){
   if(value.output?.origin!=='ai_simulation'||!String(value.output.text||'').trim())throw Object.assign(Error('未读取到带来源说明的模拟数据'),{status:422});
   if(item.id!==state.thesisId||item.version!==state.version){state.status='failed';state.error='论文信息已更新，本次数据未加入。请根据最新研究信息重新生成。';}
   else if(!(draft.simulationRunIds||[]).includes(value.id)){
    draft.simulationRunIds=[...(draft.simulationRunIds||[]),value.id];draft.dirty=true;draft.quote=null;draft.requestKey=null;state.text=value.output.text;state.sampleSize=value.output.rows?.length||0;state.variableCount=value.output.recipe?.variables?.length||value.output.statistics?.length||0;persist();onCompleted();return;
   }
  }
  changed();
 }
 async function refresh(){
  if(!current()||busy)return;const state=getDraft().simulationJob;if(!state||!active(state.status))return;
  busy=true;try{await owner();const value=await api(state.jobId?'/theses/methods/'+encodeURIComponent(state.jobId):'/theses/methods/by-key/'+encodeURIComponent(state.clientKey));if(current())take(value.item);}catch(error){if(current()){state.error=error.status===404?'未找到这次模拟任务，请重新点击生成。':'暂时无法读取进度，正在重新同步。';if(error.status===404||error.status===401||error.status===403||error.status===409||error.status===422)state.status='failed';changed();}}finally{busy=false;schedule();}
 }
 async function start(){
  if(!current()||busy||simulationPending(getDraft()))return;const draft=getDraft(),item=getItem();if((draft.simulationRunIds||[]).length>=3){if(draft.simulationJob)draft.simulationJob.error='本次最多加入 3 份模拟数据，请先保存当前补充资料。';changed();return;}
  busy=true;stop();let sent=false,received=false;let state=draft.simulationJob;try{
   await owner();const actor=String(getUserId()||'');if(!actor)throw Error('请先登录');
   if(!approved||!validQuote(approved.quote,approved.type)||approved.owner!==actor||approved.thesisId!==item.id||approved.version!==item.version){
    approved=null;const capabilities=await api('/theses/methods/capabilities');if(!capabilities.ready||capabilities.supportsSimulation!==true)throw Error(capabilities.reason||'模拟数据服务尚未就绪');const type=capabilities.billingService||'agent',quote=await api('/billing/quote',{type,...(capabilities.billingServiceKey?{serviceKey:capabilities.billingServiceKey}:{})});if(!validQuote(quote,type))throw Error('暂时无法确认生成费用');await owner();if(!current()||String(getUserId()||'')!==actor||getItem().id!==item.id||getItem().version!==item.version)throw Error('研究信息或登录账户已更新，请重新核对费用');approved={quote,type,owner:actor,thesisId:item.id,version:item.version};state={status:'quoted',clientKey:crypto.randomUUID(),thesisId:item.id,version:item.version,jobId:null,error:'',text:'',costLabel:quoteLabel(quote)};draft.simulationJob=state;changed();return;
   }
   const charge=approved;approved=null;state={status:'submitting',clientKey:state?.status==='quoted'?state.clientKey:crypto.randomUUID(),thesisId:item.id,version:item.version,jobId:null,error:'',text:''};draft.simulationJob=state;changed();await owner();if(!validQuote(charge.quote,charge.type)||String(getUserId()||'')!==charge.owner||getItem().id!==charge.thesisId||getItem().version!==charge.version)throw Error('研究信息、登录账户或费用已更新，请重新核对');sent=true;const value=await api('/theses/methods',{operation:'simulation',thesisId:item.id,version:state.version,clientKey:state.clientKey,billingToken:charge.quote.token,consent:true});received=true;if(current())take(value.item);
  }catch(error){if(current()){approved=null;if(!state||state.status==='quoted')state=draft.simulationJob={status:'failed',thesisId:item.id,version:item.version,error:'',text:''};if(error.status||!sent||received){state.status='failed';state.error=error.message;}else{state.status='recovering';state.error=error.message||'正在核对请求是否已提交，请勿重复点击。';}changed();}}finally{busy=false;schedule();}
 }
 async function cancel(){if(!current()||busy)return;const state=getDraft().simulationJob;if(!state?.jobId)return;busy=true;stop();try{await owner();const value=await api('/theses/methods/'+encodeURIComponent(state.jobId)+'/cancel',{});if(current())take(value.item);}catch(error){if(current()){state.error=error.message;changed();}}finally{busy=false;schedule();}}
 return {start,cancel,resume:schedule,save:()=>{if(current()&&!busy)void onSave?.();},restore:()=>{if(current()&&!busy)void onRestore?.();},dispose(){disposed=true;stop();}};
}
export function bindSimulationPanel(root,controller){root?.querySelector('[data-simulation-generate]')?.addEventListener('click',()=>void controller.start());root?.querySelector('[data-simulation-cancel]')?.addEventListener('click',()=>void controller.cancel());root?.querySelector('[data-simulation-save]')?.addEventListener('click',()=>controller.save());root?.querySelector('[data-simulation-restore]')?.addEventListener('click',()=>controller.restore());}
export function replaceSimulationPanel(host,draft,options,controller){
 if(!host)return;
 const markup=simulationPanelHTML(draft,options);if(panelMarkup.get(host)===markup&&host.firstElementChild)return;
 const doc=host.ownerDocument,win=doc.defaultView,root=host.closest('.dashboard')||host.closest('.thesis-online-host')||host.parentElement||host,focused=doc.activeElement;
 // Keep a field being edited below this panel in the same visible position.
 // The small panel must never inherit the viewport reservation of the workspace.
 const candidate=focused&&root.contains(focused)&&!host.contains(focused)?focused:null,rect=candidate?.getBoundingClientRect(),anchor=rect&&rect.bottom>0&&rect.top<(win?.innerHeight||0)?candidate:null,top=anchor?rect.top:null;
 withStableView(root,()=>{host.innerHTML=markup;bindSimulationPanel(host,controller);panelMarkup.set(host,markup);});
 if(anchor?.isConnected){const delta=anchor.getBoundingClientRect().top-top;if(Math.abs(delta)>.5)win.scrollTo({left:win.scrollX,top:win.scrollY+delta,behavior:'instant'});}
}
