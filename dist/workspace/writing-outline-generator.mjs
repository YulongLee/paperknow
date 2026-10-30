import {resolveAccountProjectId} from './project-directory.mjs';
import {withStableView} from './view-stability.mjs';
import {validThesisQuote} from './thesis-online.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const active=item=>['queued','running'].includes(item?.status);
const statusText={queued:'正在排队',running:'正在生成提纲',completed:'提纲已生成',failed:'提纲生成未完成',cancelled:'已停止生成'};
const stages={queued:'等待 AI 服务处理',preparing:'整理主题与研究资料',checking_input:'检查提交内容',checking_output:'检查生成提纲',checking_outline:'正在检查提纲',repairing_outline:'正在自动完善提纲，无需重新提交',outline_ready:'提纲检查通过，正在保存',agent_running:'根据主题组织章节',agent_tools:'整理研究依据',completed:'正在填入下方提纲',failed:'未生成可用提纲，原有提纲未改动。',cancelled:'原有提纲未改动'};
const abortError=()=>Object.assign(new Error('页面已切换'),{name:'AbortError'});

// The server owns the durable job and billing. Completed results are applied
// automatically only to the unchanged context and authenticated owner.
export function mountWritingOutlineGenerator({container,ctx={},getSnapshot,getContextKey,getProjectRef=()=>'',onApply,onJobChange,onCommandChange,pendingJobId=null,pendingContextKey=null,pendingClientKey=null,isCurrent=()=>true}={}){
 if(!container)throw new TypeError('缺少提纲生成区域');
 const doc=container.ownerDocument,win=doc.defaultView;
 let alive=true,opened=false,direct=false,epoch=0,timer=null,busy=false,user=null,accountId=null,cap=null,quote=null,item=null,snapshot=null,contextKey=pendingContextKey,jobId=pendingJobId||null,clientKey=pendingClientKey||null,commandPending=!!pendingClientKey,consent=false,disclosureOpen=false,ambiguous=!!pendingClientKey&&!pendingJobId,message='',error='',loadError=false,applied=false;
 let submitting=false,startedAt=null,clockTimer=null,syncError=false,backgroundReading=false,renderedProgressSignature=null;
 let projectRef='';try{const pending=JSON.parse(pendingContextKey);if(typeof pending?.projectRef==='string'&&typeof pending?.contextKey==='string'&&Object.keys(pending).length===2)projectRef=pending.projectRef;}catch{}
 const controllers=new Set();
 const current=()=>alive&&container.isConnected&&isCurrent();
 const usable=token=>current()&&opened&&epoch===token;
 const $=selector=>container.querySelector(selector);
 const currentContextKey=(ref=String(getProjectRef()||''))=>{const base=String(getContextKey?.()??'');return ref?JSON.stringify({contextKey:base,projectRef:ref}):base;};
 const equivalentProjectRef=(before,current)=>{if(before===current){if(before)resolveAccountProjectId(before,accountId);return true;}if(!before||!current||!accountId)return false;const previousId=resolveAccountProjectId(before,accountId),currentId=resolveAccountProjectId(current,accountId);return !!previousId&&previousId===currentId;};
 const contextMatches=()=>{try{return equivalentProjectRef(projectRef,String(getProjectRef()||''))&&currentContextKey(projectRef)===String(contextKey??'');}catch{return false;}};
 const bindProject=()=>{projectRef=String(getProjectRef()||'');resolveAccountProjectId(projectRef,accountId);contextKey=currentContextKey();};
 const projectPayload=()=>{const projectId=resolveAccountProjectId(projectRef,accountId);return projectId?{projectId}:{};};
 const clearPoll=()=>{if(timer!==null)win.clearTimeout(timer);timer=null;};
 const clearClock=()=>{if(clockTimer!==null)win.clearTimeout(clockTimer);clockTimer=null;};
 const elapsedText=()=>{const seconds=Math.max(0,Math.floor((Date.now()-(startedAt??Date.now()))/1000)),minutes=Math.floor(seconds/60);return `已用时 ${String(minutes).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;};
 function updateClock(){const elapsed=$('[data-outline-ai-elapsed]');if(elapsed)elapsed.textContent=elapsedText();}
 function scheduleClock(){
  clearClock();if(!current()||!opened||doc.hidden||!(submitting||active(item)))return;
  updateClock();clockTimer=win.setTimeout(()=>{clockTimer=null;scheduleClock();},1000);
 }
 const abortRequests=()=>{for(const controller of controllers)controller.abort();controllers.clear();};
 const notifyJob=()=>{if(current())onJobChange?.(jobId,{contextKey});};
 const identity=value=>value?.user?.id?value.user:null;
 const loginHref=()=>'/auth.html?mode=login&next='+encodeURIComponent('/workspace.html'+(win.location.search||'')+(win.location.hash||''));
 const costText=()=>quote?.source==='credits'?`本次 ${quote.creditCost} 科研积分`:quote?.source==='membership'?'本次使用 1 次会员权益':quote?.source==='bundle'?'本次使用 1 次套餐权益':'本次免费';
 const setError=value=>{error=String(value?.message||value||'暂时无法完成，请稍后重试。');};
 function request(path,data,token=epoch){
  const controller=new win.AbortController();controllers.add(controller);
  let timeout,abort;const cancelled=new Promise((_,reject)=>{abort=()=>reject(abortError());controller.signal.addEventListener('abort',abort,{once:true});});const deadline=new Promise((_,reject)=>{timeout=win.setTimeout(()=>{reject(Object.assign(new Error('请求超时，请读取最新状态或重试本次提交。'),{name:'TimeoutError'}));controller.abort();},25000);});
  const perform=async()=>{
   if(ctx.api)return ctx.api(path,data,{signal:controller.signal});
   const response=await win.fetch('/api'+path,{method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:controller.signal});
   const value=await response.json().catch(()=>({error:'服务暂时无法响应，请稍后重试。'}));
   if(!response.ok){const failure=new Error(typeof value.error==='string'?value.error:value.error?.message||'请求未完成，请稍后重试。');failure.status=response.status;throw failure;}
   return value;
  };
  return Promise.race([perform(),deadline,cancelled]).then(value=>{if(!usable(token)||controller.signal.aborted)throw abortError();return value;}).finally(()=>{win.clearTimeout(timeout);controller.signal.removeEventListener('abort',abort);controllers.delete(controller);});
 }
 async function authenticate({fresh=false,token=epoch}={}){
  let value;
  try{value=!fresh&&ctx.session?(typeof ctx.session==='function'?await ctx.session():await ctx.session):await request('/auth/me',undefined,token);}
  catch(failure){if(failure.status===401)return null;throw failure;}
  if(!usable(token))throw abortError();
  if(value?.status==='guest')return null;
  if(value?.status==='error'||value?.status==='loading')throw Error('暂时无法核对登录状态，请稍后重试；原有提纲仍保留。');
  const next=identity(value);if(!next)throw Error('账户信息不完整，请重新登录后再生成提纲。');return next;
 }
 function changedAccount(){
  user=null;quote=null;consent=false;item=null;clearPoll();clearClock();setError('登录账户已变化，请重新登录并打开提纲生成。');throw Error(error);
 }
 async function owner(token=epoch){
  const next=await authenticate({fresh:true,token});
  if(!next||!accountId||String(next.id)!==accountId)changedAccount();
  user=next;
 }
 function takeItem(value,expectedId){
  if(!value?.id||!Object.hasOwn(statusText,value.status)||expectedId&&String(value.id)!==String(expectedId))throw Error('提纲任务数据不完整，请读取最新状态。');
  if(value.userId&&String(value.userId)!==String(user?.id)||value.ownerId&&String(value.ownerId)!==String(user?.id))throw Error('当前账户无法读取这份提纲，请重新打开。');
  const sameJob=String(jobId||'')===String(value.id),createdAt=Date.parse(value.createdAt||value.created_at||'');
  if(!sameJob||startedAt===null){const origin=Number.isFinite(createdAt)&&createdAt<=Date.now()?createdAt:Date.now();startedAt=submitting&&startedAt!==null?Math.min(startedAt,origin):origin;}
  item=value;jobId=value.id;syncError=false;
  if(value.status==='completed'&&(!String(value.output?.text||'').trim()))throw Error('任务已结束，但没有可用的提纲内容。原有提纲未改动。');
  notifyJob();
 }
 function progressMarkup(){
  const pending=submitting&&!active(item),phase=pending?'submitting':item?.status,working=pending||active(item),failed=phase==='failed';
  if(!phase)return '';
  const title=pending?'正在提交提纲任务':statusText[phase],stage=pending?'正在保存生成请求，请稍候…':failed?stages.failed:stages[phase==='running'?item.stage:phase]||'正在根据已确认的信息生成提纲';
  const detail=typeof item?.error==='string'?item.error:item?.error?.message,index=pending?0:phase==='queued'?1:2;
  return `<div class="writing-outline-ai-progress writing-outline-job-progress${working?' is-active':''}${syncError?' is-stale':''}" data-outline-phase="${esc(phase)}" role="status" aria-live="polite" aria-atomic="false"><div class="writing-outline-job-progress-heading">${working?'<span class="writing-outline-job-spinner" aria-hidden="true"></span>':`<span class="writing-outline-job-result-icon" aria-hidden="true">${phase==='completed'?'✓':phase==='cancelled'?'−':'!'}</span>`}<div><strong>${esc(title)}</strong><span class="writing-outline-job-stage">${esc(stage)}</span></div>${working?`<span class="writing-outline-job-elapsed" data-outline-ai-elapsed aria-live="off">${esc(elapsedText())}</span>`:''}</div>${working?`<div class="writing-outline-job-track" role="progressbar" aria-label="论文提纲生成进度" aria-valuetext="${esc(stage)}"><span></span></div><ol class="writing-outline-job-steps" aria-label="提纲生成流程">${['提交请求','等待处理','生成提纲','填入提纲'].map((label,i)=>`<li class="${i<index?'is-done':i===index?'is-current':''}"${i===index?' aria-current="step"':''}><span aria-hidden="true">${i<index?'✓':i+1}</span>${label}</li>`).join('')}</ol><p class="writing-outline-job-sync" data-outline-ai-sync>${pending?'请求确认前请稍候，无需重复点击。':syncError?'暂时无法读取最新进度，正在重试；当前为上次同步的状态。':'进度自动更新，无需重复提交。'}</p>${!pending?'<p class="writing-outline-job-background">可离开此页面，后台任务会继续；重新打开可读取进度。</p>':''}`:''}${failed||detail?`<p class="writing-outline-ai-error writing-outline-job-error" role="alert">具体原因：${esc(String(detail||'本次任务未能返回可用提纲，请重新确认费用后再试。').trim()||'本次任务未能返回可用提纲，请重新确认费用后再试。')}</p>`:''}</div>`;
 }
 function render(){
  if(!current()||!opened)return;
  const disclosure=$('[data-outline-ai-disclosure]');if(disclosure)disclosureOpen=disclosure.open;
  withStableView(container.closest('.dashboard')||container,()=>{
   container.hidden=false;
   const running=active(item),text=item?.status==='completed'?String(item.output?.text||''):'',drift=!applied&&(!!contextKey&&!contextMatches()||commandPending&&!contextKey);
   const brief=snapshot||{},profile=brief.profile||{};
   let body='';
   if(busy&&!user&&!loadError)body='<p class="writing-outline-ai-loading" role="status">正在读取账户与提纲服务…</p>';
   else if(!user&&!loadError)body=`<div class="writing-outline-ai-login"><h4>登录后，根据你的主题生成提纲</h4><p>已有提纲和当前浏览器草稿会保留；登录后才会发送生成任务。</p><a class="btn primary" href="${esc(loginHref())}">登录账户</a></div>`;
   else if(user){
    body=`<div class="writing-outline-ai-brief"><small>本次论文主题</small><h4>${esc(brief.title||'已保存的提纲生成任务')}</h4><div class="writing-outline-ai-facts"><span>${esc(profile.level||'按当前写作设置')}</span>${profile.discipline||profile.major?`<span>${esc(profile.discipline||profile.major)}</span>`:''}<span>${Array.isArray(brief.materials)?brief.materials.length:0} 份资料</span><span>${Array.isArray(brief.references)?brief.references.length:0} 篇参考文献</span></div></div>`;
    if(drift)body+='<p class="writing-outline-ai-warning" role="status">论文主题或研究资料已有变化。请先核对当前信息，再重新生成；这份结果不会直接替换当前提纲。</p>';
    if(item||submitting)body+=progressMarkup();

    if(quote&&!item&&!direct){body+=`<div class="writing-outline-ai-charge"><strong>${esc(costText())}</strong><details class="generation-disclosure" data-outline-ai-disclosure ${disclosureOpen?'open':''}><summary data-outline-ai-disclosure-summary tabindex="0">费用与资料说明<span class="generation-disclosure-hint">查看详情</span></summary><div class="generation-disclosure-body"><p>仅在确认后提交任务。成功后结算，失败或取消按实际账单释放预占；提纲生成与后续正文生成分别计费。</p><p>选中输入及生成结果会由阿里云内容安全服务审核。</p><label class="writing-outline-ai-consent"><input type="checkbox" data-outline-ai-consent ${consent?'checked':''} ${busy?'disabled':''}> 我确认有权使用上述信息，同意将论文主题、写作要求及选中资料的相关内容交由 AI 服务处理，并确认本次费用。</label></div></details></div>`;}
    body+='<div class="writing-outline-ai-actions">';
    if(running)body+=`<button type="button" class="btn secondary" data-outline-ai-refresh ${busy?'disabled':''}>读取最新状态</button><button type="button" class="btn secondary" data-outline-ai-cancel ${busy?'disabled':''}>停止生成</button>`;
    else if(text)body+=`${!drift?`<button type="button" class="btn secondary" data-outline-ai-retry ${busy?'disabled':''}>重试填入提纲</button>`:''}<button type="button" class="btn secondary" data-outline-ai-new ${busy?'disabled':''}>重新生成</button>`;
    else if(drift&&commandPending)body+=`<button type="button" class="btn secondary" data-outline-ai-new ${busy?'disabled':''}>根据当前主题重新生成</button>`;
    else if(item||loadError||!quote)body+=`<button type="button" class="btn secondary" data-outline-ai-reload ${busy?'disabled':''}>${item?'重新获取费用并生成':jobId?'重新读取任务状态':commandPending?'读取原任务并重新确认费用':'重新读取'}</button>`;
    else body+=`<button type="button" class="btn primary" data-outline-ai-start ${busy||!consent||drift?'disabled':''}>${busy?'正在提交…':ambiguous?'重试本次提交':'生成提纲'}</button>${!ambiguous?`<button type="button" class="btn secondary" data-outline-ai-requote ${busy?'disabled':''}>重新获取费用</button>`:''}`;
    body+='</div>';
    if(cap?.ready===false)body+=`<p class="writing-outline-ai-warning">${esc(cap.reason||'提纲生成服务暂未开放，仍可上传提纲或自己编辑。')}</p>`;
   }
   else body='<button type="button" class="btn secondary" data-outline-ai-reload>重新读取</button>';
   container.innerHTML=`<div class="writing-outline-ai-shell"><header class="writing-outline-ai-heading"><div><small>AI OUTLINE</small><h3>根据主题生成论文提纲</h3><p>生成完成后自动填入下方提纲，可直接修改章节与篇幅。</p></div><button type="button" class="writing-outline-ai-close" data-outline-ai-close aria-label="收起 AI 提纲生成">×</button></header>${body}<p class="writing-outline-ai-notice" data-outline-ai-notice role="status" aria-live="polite">${esc(message)}</p>${error?`<p class="writing-outline-ai-error" role="alert">${esc(error)}</p>`:''}<p class="writing-outline-ai-save-hint">生成期间保留当前提纲，成功后自动更新下方结构；可继续编辑后确认。</p></div>`;
   bind();
  });
  renderedProgressSignature=progressSignature();scheduleClock();
 }
 function bind(){
  $('[data-outline-ai-close]')?.addEventListener('click',close);
  $('[data-outline-ai-consent]')?.addEventListener('change',event=>{consent=event.target.checked;const button=$('[data-outline-ai-start]');if(button)button.disabled=busy||!consent||!contextMatches();});
  $('[data-outline-ai-start]')?.addEventListener('click',()=>void start());
  $('[data-outline-ai-requote]')?.addEventListener('click',()=>void prepare());
  $('[data-outline-ai-new]')?.addEventListener('click',()=>void prepare({newCommand:true,generate:direct}));
  $('[data-outline-ai-reload]')?.addEventListener('click',()=>void (direct?generate():!user||loadError||jobId&&!item||commandPending&&!item?open({fresh:true}):prepare()));
  $('[data-outline-ai-refresh]')?.addEventListener('click',()=>void refresh());
  $('[data-outline-ai-cancel]')?.addEventListener('click',()=>void cancel());
  $('[data-outline-ai-retry]')?.addEventListener('click',()=>void run(adoptCompleted));
 }
 function close(){
  if(!current())return;opened=false;epoch++;busy=false;backgroundReading=false;submitting=false;clearPoll();clearClock();abortRequests();withStableView(container.closest('.dashboard')||container,()=>{container.hidden=true;if(applied)container.replaceChildren();});
 }
 const progressSignature=()=>JSON.stringify([item?.id,item?.status,item?.stage,item?.error,user?.id,contextMatches(),error,syncError]);
 async function run(action,{background=false,submission=false,reading=false}={}){
  if(!current()||!opened)return;
  if(busy){if(background||!backgroundReading)return;epoch++;abortRequests();clearPoll();busy=false;backgroundReading=false;}
  const token=epoch,before=renderedProgressSignature;busy=true;backgroundReading=background;error='';if(submission){submitting=true;startedAt=Date.now();syncError=false;message='正在提交生成请求，无需重复点击。';}if(!background)render();
  try{await action(token);if(usable(token))await adoptCompleted(token);}catch(failure){if(usable(token)&&failure.name!=='AbortError'){const unavailable=reading&&active(item)&&failure.status>=400&&failure.status<500&&![408,429].includes(failure.status);if(unavailable){item=null;quote=null;consent=false;syncError=false;clearClock();}if(reading&&active(item))syncError=true;else setError(failure);}}
  finally{if(usable(token)){busy=false;backgroundReading=false;submitting=false;if(!background||before!==progressSignature())render();else updateClock();schedule();}}
 }
 async function loadQuote(token,{preserveCommand=false}={}){
  quote=null;consent=false;projectPayload();
  cap=await request('/theses/outlines/capabilities',undefined,token);
  if(!cap?.ready){quote=null;throw Error(cap?.reason||'提纲生成服务暂未开放，仍可上传提纲或自己编辑。');}
  const value=await request('/billing/quote',{type:'agent',...(cap.billingServiceKey?{serviceKey:cap.billingServiceKey}:{})},token);
  if(!validThesisQuote(value))throw Error('费用信息不完整或已过期，请重新获取费用。');
  quote=value;if(!preserveCommand)clientKey=win.crypto.randomUUID();consent=true;ambiguous=preserveCommand&&commandPending;message=preserveCommand?'上次任务尚未确认创建。请重新确认费用后重试同一任务；若后台已接收，会读取原任务。':'费用已就绪，可直接点击“生成提纲”。';
 }
 async function prepareSnapshot(token){
   const brief=getSnapshot?.();if(!brief||!String(brief.title||'').trim())throw Error('请先填写论文主题，再生成提纲。');
   if(commandPending){await onCommandChange?.(null,{contextKey});if(!usable(token))return;}
   snapshot=structuredClone(brief);snapshot.outline=[];snapshot.bodySections=[];bindProject();item=null;jobId=null;quote=null;clientKey=null;commandPending=false;ambiguous=false;applied=false;loadError=false;startedAt=null;syncError=false;notifyJob();
   await loadQuote(token);
 }
 async function prepare({newCommand=false,generate=false}={}){
  if(ambiguous&&!newCommand){message='请先读取原任务状态，避免重复创建任务。';render();return;}
  if(generate)direct=true;
  return run(async token=>{await owner(token);await prepareSnapshot(token);if(generate&&usable(token))await submit(token);},{submission:generate});
 }
 async function open({fresh=false,generate=false,reuseExisting=false}={}){
  if(!current())return;
  const reauthenticate=fresh||loadError||!!accountId;
  opened=true;epoch++;busy=true;backgroundReading=false;submitting=generate;error='';loadError=false;message='';clearPoll();clearClock();abortRequests();const token=epoch;render();
  try{
   const next=await authenticate({fresh:reauthenticate,token});if(!usable(token))return;
   if(accountId&&String(next?.id)!==accountId)changedAccount();
   user=next;if(!user){quote=null;return;}accountId=String(user.id);
   await owner(token);
   if(jobId){const value=await request('/theses/outlines/'+encodeURIComponent(jobId),undefined,token);takeItem(value.item,jobId);message='已读取保存的提纲任务；未重复提交或扣费。';}
   else if(commandPending&&clientKey){
    try{const value=await request('/theses/outlines/by-key/'+encodeURIComponent(clientKey),undefined,token);takeItem(value.item);quote=null;consent=false;ambiguous=false;message='已找回上次提交的提纲任务；未重复提交或扣费。';}
    catch(failure){
     if(failure.status!==404)throw failure;
     const brief=getSnapshot?.();if(!brief||!String(brief.title||'').trim())throw Error('请先恢复本次论文主题，再重试生成。');snapshot=structuredClone(brief);snapshot.outline=[];snapshot.bodySections=[];item=null;await loadQuote(token,{preserveCommand:true});
    }
   }
   else{
    const brief=getSnapshot?.();if(!brief||!String(brief.title||'').trim())throw Error('请先填写论文主题，再生成提纲。');
    snapshot=structuredClone(brief);snapshot.outline=[];snapshot.bodySections=[];bindProject();item=null;await loadQuote(token);
   }
   if(generate&&item&&!active(item)&&(!reuseExisting||applied))await prepareSnapshot(token);
   if(generate&&usable(token)&&quote&&!item)await submit(token);
   if(usable(token))await adoptCompleted(token);
  }catch(failure){if(usable(token)&&failure.name!=='AbortError'){loadError=true;setError(failure);}}
  finally{if(usable(token)){busy=false;submitting=false;render();schedule();}}
 }
 async function submit(token){
   await owner(token);
   if(!consent||!contextMatches())throw Error('论文信息已变化，请重新核对并生成。');
   if(!validThesisQuote(quote)&&!ambiguous){quote=null;throw Error('费用确认已过期，请重新获取费用。');}
   await onCommandChange?.(clientKey,{contextKey});if(!usable(token))return;commandPending=true;await owner(token);if(!usable(token))return;if(!contextMatches()||!validThesisQuote(quote))throw Error('保存期间论文信息或本次用量已变化，请重新生成。');
   try{
    const value=await request('/theses/outlines',{snapshot,...projectPayload(),clientKey,billingToken:quote.token,consent:true},token);takeItem(value.item);quote=null;consent=false;ambiguous=false;message='已提交提纲生成，完成后会自动填入下方提纲。';
   }catch(failure){
    if(!failure.status||failure.status>=500){ambiguous=true;message='尚未确认提交结果。重试会使用同一个任务标识，不会主动新建第二个任务。';}
    else{ambiguous=false;quote=null;consent=false;}
    throw failure;
   }
 }
 async function start(){
  if(!consent||!quote)return;if(!contextMatches()){setError('论文主题或研究资料已变化，请重新核对信息并生成。');render();return;}
  return run(submit,{submission:true});
 }
 async function generate({reuseExisting=false}={}){if(!current()||busy&&!backgroundReading)return;direct=true;return open({fresh:true,generate:true,reuseExisting});}
 async function read(token){await owner(token);if(!jobId)return;const expected=jobId,value=await request('/theses/outlines/'+encodeURIComponent(expected),undefined,token);takeItem(value.item,expected);}
 async function refresh(){return run(async token=>{await read(token);message='已读取最新任务状态。';},{reading:true});}
 async function cancel(){return run(async token=>{await owner(token);if(!jobId||!active(item))return;const expected=jobId,value=await request('/theses/outlines/'+encodeURIComponent(expected)+'/cancel',{},token);takeItem(value.item,expected);message='已发送停止请求，原有提纲保持不变。';});}
 async function adoptCompleted(token){
  if(!usable(token)||item?.status!=='completed')return;
  await owner(token);if(!usable(token))return;
  if(!applied){
   if(!contextMatches())throw Error('论文主题或研究资料已变化，未替换当前提纲；请根据当前信息重新生成。');
   const value=item,text=String(value.output?.text||'').trim();if(!text)throw Error('尚无可用提纲。');
   if(typeof onApply!=='function')throw Error('当前提纲编辑区域未就绪，请重新打开原任务后重试填入。');
   const used=await onApply?.(text,value);if(!usable(token))return;
   if(used===false)throw Error('提纲已生成，但未能保存到当前提纲。请检查下方提示后重试填入；无需重新生成或重复扣费。');
   applied=true;
  }
  await onCommandChange?.(null,{contextKey});if(!usable(token))return;
  commandPending=false;clientKey=null;message='提纲已自动填入，可直接编辑章节。';close();
 }
 function schedule(){
  clearPoll();if(!current()||!opened||busy||!user||!jobId||!active(item))return;
  timer=win.setTimeout(async()=>{timer=null;if(!current()||!opened)return;if(doc.hidden){schedule();return;}await run(async token=>{await read(token);},{background:true,reading:true});},2000);
 }
 function visibility(){if(!doc.hidden)schedule();scheduleClock();}
 doc.addEventListener('visibilitychange',visibility);
 return {open,generate,dispose(){if(!alive)return;alive=false;opened=false;epoch++;clearPoll();clearClock();abortRequests();doc.removeEventListener('visibilitychange',visibility);},busy:()=>current()&&busy,hasWork:()=>current()&&(busy||active(item))};
}
