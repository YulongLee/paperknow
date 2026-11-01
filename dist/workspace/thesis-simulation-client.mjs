import {withStableView} from './view-stability.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const active=status=>['submitting','queued','running','recovering'].includes(status);
export const simulationPending=draft=>active(draft.simulationJob?.status);
export function simulationPanelHTML(draft,{disabled=false}={}){
 const state=draft.simulationJob,working=simulationPending(draft),ready=state?.status==='completed',stages={submitting:'正在提交模拟方案任务',recovering:'正在读取已提交任务',queued:'正在排队',running:'正在设计方案并生成模拟数据',completed:'模拟数据已加入补充资料',failed:'本次模拟数据未生成',cancelled:'已停止生成'};
 return `<section class="thesis-simulation-panel" aria-label="AI模拟数据补充"><div class="thesis-simulation-heading"><div><h4>AI模拟数据补充</h4><p>为仿真研究生成数据，保留模拟方法和数据说明。不会替代真实实验或调查记录。</p></div><button type="button" class="btn secondary" data-simulation-generate ${disabled||working?'disabled':''}>${ready?'重新生成模拟数据':'AI模拟数据补充'}</button></div>${state?`<div class="thesis-simulation-status${working?' is-active':''}" role="status" aria-live="polite">${working?'<span class="writing-method-ai-spinner" aria-hidden="true"></span>':''}<strong>${esc(stages[state.status]||'正在读取状态')}</strong>${working?'<div class="writing-method-ai-track" role="progressbar" aria-label="模拟数据生成进度" aria-valuetext="'+esc(stages[state.status]||'正在处理')+'"><span></span></div>':''}${state.error?`<p class="thesis-error">${esc(state.error)}</p>`:''}</div>`:''}${ready?`<p class="thesis-simulation-badge">模拟数据 · 非实测 · ${Number(state.sampleSize)||0} 条记录</p><label>已加入的模拟资料<textarea readonly rows="6" data-simulation-preview>${esc(state.text||'')}</textarea></label>`:''}<p class="thesis-simulation-cost">生成按现有研究规划价格使用套餐或积分；失败或取消释放预占。采用后可继续自动完善仿真研究终稿，模拟说明会保留在文档中。</p>${working&&state?.jobId?'<button type="button" class="btn secondary" data-simulation-cancel>停止生成</button>':''}</section>`;
}
export function createThesisSimulationController({api,owner,getItem,getDraft,getUserId,isCurrent,persist,render,onCompleted,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let disposed=false,busy=false,timer=null;
 const current=()=>!disposed&&isCurrent(),changed=()=>{if(current()){persist();render();}},stop=()=>{if(timer!==null)clearTimer(timer);timer=null;},schedule=()=>{stop();if(current()&&simulationPending(getDraft()))timer=setTimer(()=>void refresh(),1800);};
 function take(value){
  const draft=getDraft(),state=draft.simulationJob,item=getItem();
  if(!value?.id||value.operation!=='simulation'||value.thesisId!==state?.thesisId||String(value.userId)!==String(getUserId())||state?.jobId&&state.jobId!==value.id)throw Object.assign(Error('模拟任务不属于当前账户或请求'),{status:403});
  if(!['queued','running','completed','failed','cancelled'].includes(value.status))throw Object.assign(Error('模拟任务状态不完整'),{status:422});
  Object.assign(state,{jobId:value.id,status:value.status,error:value.error||''});
  if(value.status==='completed'){
   if(value.output?.origin!=='ai_simulation'||!String(value.output.text||'').trim())throw Object.assign(Error('未读取到带来源说明的模拟数据'),{status:422});
   if(item.id!==state.thesisId||item.version!==state.version){state.status='failed';state.error='论文信息已更新，本次数据未加入。请根据最新研究信息重新生成。';}
   else if(!(draft.simulationRunIds||[]).includes(value.id)){
    draft.simulationRunIds=[value.id];draft.dirty=true;draft.quote=null;draft.requestKey=null;state.text=value.output.text;state.sampleSize=value.output.rows?.length||0;persist();onCompleted();return;
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
  busy=true;stop();let sent=false,received=false;const state={status:'submitting',clientKey:crypto.randomUUID(),thesisId:item.id,version:item.version,jobId:null,error:'',text:''};draft.simulationJob=state;changed();
  try{await owner();const capabilities=await api('/theses/methods/capabilities');if(!capabilities.ready||capabilities.supportsSimulation!==true)throw Error(capabilities.reason||'模拟数据服务尚未就绪');const quote=await api('/billing/quote',{type:capabilities.billingService||'agent',...(capabilities.billingServiceKey?{serviceKey:capabilities.billingServiceKey}:{})});if(!quote?.token)throw Error('暂时无法确认生成费用');await owner();if(getItem().version!==state.version)throw Error('研究信息已更新，请根据最新信息生成');sent=true;const value=await api('/theses/methods',{operation:'simulation',thesisId:item.id,version:state.version,clientKey:state.clientKey,billingToken:quote.token,consent:true});received=true;if(current())take(value.item);
  }catch(error){if(current()){if(error.status||!sent||received){state.status='failed';state.error=error.message;}else{state.status='recovering';state.error=error.message||'正在核对请求是否已提交，请勿重复点击。';}changed();}}finally{busy=false;schedule();}
 }
 async function cancel(){if(!current()||busy)return;const state=getDraft().simulationJob;if(!state?.jobId)return;busy=true;stop();try{await owner();const value=await api('/theses/methods/'+encodeURIComponent(state.jobId)+'/cancel',{});if(current())take(value.item);}catch(error){if(current()){state.error=error.message;changed();}}finally{busy=false;schedule();}}
 return {start,cancel,resume:schedule,dispose(){disposed=true;stop();}};
}
export function bindSimulationPanel(root,controller){root?.querySelector('[data-simulation-generate]')?.addEventListener('click',()=>void controller.start());root?.querySelector('[data-simulation-cancel]')?.addEventListener('click',()=>void controller.cancel());}
export function replaceSimulationPanel(host,draft,options,controller){if(!host)return;withStableView(host,()=>{host.innerHTML=simulationPanelHTML(draft,options);bindSimulationPanel(host,controller);});}
