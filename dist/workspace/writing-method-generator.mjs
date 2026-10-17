import {withStableView} from './view-stability.mjs';
import {validThesisQuote} from './thesis-online.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const active=item=>['queued','running'].includes(item?.status);
const statusText={queued:'正在排队',running:'正在生成方法建议',completed:'方法建议已生成',failed:'方法建议生成未完成',cancelled:'已停止生成'};
const stages={queued:'等待 AI 服务处理',preparing:'整理主题与研究资料',agent_running:'设计拟开展的研究路径',agent_tools:'核对方法适用条件',completed:'请先预览，再填入补充说明',failed:'请查看具体原因',cancelled:'原有补充说明未改动'};
const abortError=()=>Object.assign(new Error('页面已切换'),{name:'AbortError'});

// The server owns durable jobs and billing. Suggestions stay proposed plans and are never applied or confirmed as research evidence by this controller.
export function mountWritingMethodGenerator({container,ctx={},getSnapshot,getContextKey,onApply,onJobChange,onCommandChange,onPreviewChange,pendingPreview=null,pendingJobId=null,pendingContextKey=null,pendingClientKey=null,isCurrent=()=>true}={}){
 if(!container)throw new TypeError('缺少方法建议生成区域');
 const doc=container.ownerDocument,win=doc.defaultView;
 let alive=true,opened=false,epoch=0,timer=null,busy=false,user=null,cap=null,quote=null,item=null,snapshot=null,contextKey=pendingContextKey,jobId=pendingJobId||null,clientKey=pendingClientKey||null,commandPending=!!pendingClientKey,consent=false,ambiguous=!!pendingClientKey&&!pendingJobId,message='',error='',loadError=false,applied=false,previewText=typeof pendingPreview?.text==='string'?pendingPreview.text:'',previewJobId=pendingPreview?.jobId?String(pendingPreview.jobId):null;
 const controllers=new Set();
 const current=()=>alive&&container.isConnected&&isCurrent();
 const usable=token=>current()&&opened&&epoch===token;
 const $=selector=>container.querySelector(selector);
 const contextMatches=()=>String(getContextKey?.()??'')===String(contextKey??'');
 const clearPoll=()=>{if(timer!==null)win.clearTimeout(timer);timer=null;};
 const abortRequests=()=>{for(const controller of controllers)controller.abort();controllers.clear();};
 const notifyJob=()=>{if(current())onJobChange?.(jobId,{contextKey});};
 const notifyPreview=()=>{if(current())onPreviewChange?.(previewJobId?{jobId:previewJobId,text:previewText}:null);};
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
  if(value?.status==='error'||value?.status==='loading')throw Error('暂时无法核对登录状态，请稍后重试；原有补充说明仍保留。');
  const next=identity(value);if(!next)throw Error('账户信息不完整，请重新登录后再生成方法建议。');return next;
 }
 async function owner(token=epoch){
  const next=await authenticate({fresh:true,token});
  if(!next||!user||String(next.id)!==String(user.id)){
   user=null;quote=null;item=null;clearPoll();setError('登录账户已变化，请重新登录并打开方法建议生成。');throw Error(error);
  }
 }
 function takeItem(value,expectedId){
  if(!value?.id||!Object.hasOwn(statusText,value.status)||expectedId&&String(value.id)!==String(expectedId))throw Error('方法建议任务数据不完整，请读取最新状态。');
  if(value.userId&&String(value.userId)!==String(user?.id)||value.ownerId&&String(value.ownerId)!==String(user?.id))throw Error('当前账户无法读取这份方法建议，请重新打开。');
  item=value;jobId=value.id;
  if(value.status==='completed'&&previewJobId!==String(value.id)){previewText=String(value.output?.text||'');previewJobId=String(value.id);notifyPreview();}
  if(value.status==='completed'&&(!String(value.output?.text||'').trim()))throw Error('任务已结束，但没有可用的方法建议内容。原有补充说明未改动。');
  notifyJob();
 }
 function render(){
  if(!current()||!opened)return;
  withStableView(container.closest('.dashboard')||container,()=>{
   container.hidden=false;
   const running=active(item),completed=item?.status==='completed',text=completed?previewText:'',drift=!!contextKey&&!contextMatches()||commandPending&&!contextKey;
   const brief=snapshot||{},profile=brief.profile||{};
   let body='';
   if(busy&&!user&&!loadError)body='<p class="writing-outline-ai-loading writing-method-ai-loading" role="status">正在读取账户与方法建议服务…</p>';
   else if(!user&&!loadError)body=`<div class="writing-outline-ai-login writing-method-ai-login"><h4>登录后，根据你的主题梳理研究方法</h4><p>已有补充说明和当前浏览器草稿会保留；登录后才会发送生成任务。</p><a class="btn primary" href="${esc(loginHref())}">登录账户</a></div>`;
   else if(user){
    body=`<div class="writing-outline-ai-brief writing-method-ai-brief"><small>本次论文主题</small><h4>${esc(brief.title||'已保存的方法建议生成任务')}</h4><div class="writing-outline-ai-facts writing-method-ai-facts"><span>${esc(profile.level||'按当前写作设置')}</span>${profile.discipline||profile.major?`<span>${esc(profile.discipline||profile.major)}</span>`:''}<span>${Array.isArray(brief.materials)?brief.materials.length:0} 份资料</span><span>${Array.isArray(brief.references)?brief.references.length:0} 篇参考文献</span></div></div>`;
    if(drift)body+='<p class="writing-outline-ai-warning writing-method-ai-warning" role="status">论文主题或研究资料已有变化。请先核对当前信息，再重新生成；这份结果不会直接替换当前补充说明。</p>';
    if(item)body+=`<div class="writing-outline-ai-progress writing-method-ai-progress" role="status"><strong>${esc(statusText[item.status])}</strong><span>${esc(stages[item.stage]||stages[item.status]||'根据已确认的信息处理')}</span>${running?'<p>可离开此页面，后台任务会继续；重新打开可读取进度。</p>':''}${item.error?`<p class="writing-outline-ai-error writing-method-ai-error">${esc(typeof item.error==='string'?item.error:item.error.message||'生成中断，请稍后重新生成。')}</p>`:''}</div>`;
    if(completed)body+=`<div class="writing-outline-ai-preview writing-method-ai-preview"><label for="writing-method-ai-result">拟开展的研究方法建议（可编辑）</label><textarea id="writing-method-ai-result" data-scroll-key="writing-method-ai-preview" rows="12" maxlength="12000">${esc(text)}</textarea><p>生成内容尚未应用。你可以先修改建议，再点击“填入补充说明”。该方案仅供拟开展研究参考，不代表已经完成研究。</p></div>`;
    if(quote&&!item){body+=`<div class="writing-outline-ai-charge writing-method-ai-charge"><strong>${esc(costText())}</strong><p>仅在确认后提交任务。成功后结算，失败或取消按实际账单释放预占；方法建议与后续提纲、正文生成分别计费。</p><label class="writing-outline-ai-consent writing-method-ai-consent"><input type="checkbox" data-method-ai-consent ${consent?'checked':''} ${busy?'disabled':''}> 我确认有权使用上述信息，同意将论文主题、写作要求及选中资料的相关内容交由 AI 服务处理以生成拟开展的研究方案，并确认本次费用。</label></div>`;}
    body+='<div class="writing-outline-ai-actions writing-method-ai-actions">';
    if(running)body+=`<button type="button" class="btn secondary" data-method-ai-refresh ${busy?'disabled':''}>读取最新状态</button><button type="button" class="btn secondary" data-method-ai-cancel ${busy?'disabled':''}>停止生成</button>`;
    else if(completed)body+=`<button type="button" class="btn primary" data-method-ai-apply ${busy||drift||!text.trim()?'disabled':''}>${applied?'再次填入补充说明':'填入补充说明'}</button><button type="button" class="btn secondary" data-method-ai-new ${busy?'disabled':''}>重新生成</button>`;
    else if(drift&&commandPending)body+=`<button type="button" class="btn secondary" data-method-ai-new ${busy?'disabled':''}>根据当前主题重新生成</button>`;
    else if(item||loadError||!quote)body+=`<button type="button" class="btn secondary" data-method-ai-reload ${busy?'disabled':''}>${item?'重新获取费用并生成':commandPending?'读取原任务并重新确认费用':'重新读取'}</button>`;
    else body+=`<button type="button" class="btn primary" data-method-ai-start ${busy||!consent||drift?'disabled':''}>${busy?'正在提交…':ambiguous?'重试本次提交':'确认费用并生成方法建议'}</button>${!ambiguous?`<button type="button" class="btn secondary" data-method-ai-requote ${busy?'disabled':''}>重新获取费用</button>`:''}`;
    body+='</div>';
    if(cap?.ready===false)body+=`<p class="writing-outline-ai-warning writing-method-ai-warning">${esc(cap.reason||'方法建议生成服务暂未开放，仍可自行填写补充说明。')}</p>`;
   }
   else body='<button type="button" class="btn secondary" data-method-ai-reload>重新读取</button>';
   container.innerHTML=`<div class="writing-outline-ai-shell writing-method-ai-shell"><header class="writing-outline-ai-heading writing-method-ai-heading"><div><small>AI RESEARCH METHODS</small><h3>让 AI 帮你梳理研究方法</h3><p>根据论文题目与已有说明生成拟开展的研究方案，预览、修改后再填入。</p></div><button type="button" class="writing-outline-ai-close writing-method-ai-close" data-method-ai-close aria-label="收起 AI 方法建议生成">×</button></header>${body}<p class="writing-outline-ai-notice writing-method-ai-notice" data-method-ai-notice role="status" aria-live="polite">${esc(message)}</p>${error?`<p class="writing-outline-ai-error writing-method-ai-error" role="alert">${esc(error)}</p>`:''}<p class="writing-outline-ai-save-hint writing-method-ai-save-hint">建议必须结合导师要求与实际条件核对。拟开展的方案不属于已完成的实验、调查或研究结果，点击“填入补充说明”后才会应用。</p></div>`;
   bind();
  });
 }
 function bind(){
  $('#writing-method-ai-result')?.addEventListener('input',event=>{previewText=event.target.value;try{notifyPreview();}catch(failure){setError(failure);const notice=$('[data-method-ai-notice]');if(notice)notice.textContent=error;}const button=$('[data-method-ai-apply]');if(button)button.disabled=busy||!contextMatches()||!previewText.trim();});
  $('[data-method-ai-close]')?.addEventListener('click',close);
  $('[data-method-ai-consent]')?.addEventListener('change',event=>{consent=event.target.checked;const button=$('[data-method-ai-start]');if(button)button.disabled=busy||!consent||!contextMatches();});
  $('[data-method-ai-start]')?.addEventListener('click',()=>void start());
  $('[data-method-ai-requote]')?.addEventListener('click',()=>void prepare());
  $('[data-method-ai-new]')?.addEventListener('click',()=>void prepare({newCommand:true}));
  $('[data-method-ai-reload]')?.addEventListener('click',()=>void (jobId&&!item||commandPending&&!item?open():prepare()));
  $('[data-method-ai-refresh]')?.addEventListener('click',()=>void refresh());
  $('[data-method-ai-cancel]')?.addEventListener('click',()=>void cancel());
  $('[data-method-ai-apply]')?.addEventListener('click',()=>void apply());
 }
 function close(){
  if(!current())return;opened=false;epoch++;busy=false;clearPoll();abortRequests();withStableView(container.closest('.dashboard')||container,()=>{container.hidden=true;});
 }
 async function run(action){
  if(!current()||!opened||busy)return;
  const token=epoch;busy=true;error='';render();
  try{await action(token);}catch(failure){if(usable(token)&&failure.name!=='AbortError')setError(failure);}
  finally{if(usable(token)){busy=false;render();schedule();}}
 }
 async function loadQuote(token,{preserveCommand=false}={}){
  cap=await request('/theses/methods/capabilities',undefined,token);
  if(!cap?.ready){quote=null;throw Error(cap?.reason||'方法建议生成服务暂未开放，仍可自行填写补充说明。');}
  const value=await request('/billing/quote',{type:'agent'},token);
  if(!validThesisQuote(value))throw Error('费用信息不完整或已过期，请重新获取费用。');
  quote=value;if(!preserveCommand)clientKey=win.crypto.randomUUID();consent=false;ambiguous=preserveCommand&&commandPending;message=preserveCommand?'上次任务尚未确认创建。请重新确认费用后重试同一任务；若后台已接收，会读取原任务。':'请确认费用与资料用途；尚未开始生成。';
 }
 async function prepare({newCommand=false}={}){
  if(ambiguous&&!newCommand){message='请先重试本次提交以确认结果，避免重复创建任务。';render();return;}
  return run(async token=>{
   await owner(token);const brief=getSnapshot?.();if(!brief||!String(brief.title||'').trim())throw Error('请先填写论文主题，再生成方法建议。');
   if(commandPending){await onCommandChange?.(null,{contextKey});if(!usable(token))return;}
   snapshot=structuredClone(brief);snapshot.outline=[];snapshot.bodySections=[];contextKey=String(getContextKey?.()??'');item=null;jobId=null;quote=null;clientKey=null;commandPending=false;ambiguous=false;applied=false;loadError=false;previewText='';previewJobId=null;notifyPreview();notifyJob();
   await loadQuote(token);
  });
 }
 async function open(){
  if(!current())return;
  opened=true;epoch++;busy=true;error='';loadError=false;message='';clearPoll();abortRequests();const token=epoch;render();
  try{
   const next=await authenticate({token});if(!usable(token))return;if(user&&String(user.id)!==String(next?.id)){quote=null;item=null;snapshot=null;jobId=null;clientKey=null;commandPending=false;consent=false;ambiguous=false;contextKey=null;previewText='';previewJobId=null;}user=next;
   if(!user){quote=null;return;}
   await owner(token);
   if(jobId){const value=await request('/theses/methods/'+encodeURIComponent(jobId),undefined,token);takeItem(value.item,jobId);message='已读取保存的方法建议任务；未重复提交或扣费。';}
   else if(commandPending&&clientKey){
    try{const value=await request('/theses/methods/by-key/'+encodeURIComponent(clientKey),undefined,token);takeItem(value.item);quote=null;consent=false;ambiguous=false;message='已找回上次提交的方法建议任务；未重复提交或扣费。';}
    catch(failure){
     if(failure.status!==404)throw failure;
     const brief=getSnapshot?.();if(!brief||!String(brief.title||'').trim())throw Error('请先恢复本次论文主题，再重试生成。');snapshot=structuredClone(brief);snapshot.outline=[];snapshot.bodySections=[];item=null;await loadQuote(token,{preserveCommand:true});
    }
   }
   else{
    const brief=getSnapshot?.();if(!brief||!String(brief.title||'').trim())throw Error('请先填写论文主题，再生成方法建议。');
    snapshot=structuredClone(brief);snapshot.outline=[];snapshot.bodySections=[];contextKey=String(getContextKey?.()??'');item=null;await loadQuote(token);
   }
  }catch(failure){if(usable(token)&&failure.name!=='AbortError'){loadError=true;setError(failure);}}
  finally{if(usable(token)){busy=false;render();schedule();}}
 }
 async function start(){
  if(!consent||!quote)return;if(!contextMatches()){setError('论文主题或研究资料已变化，请重新核对信息并生成。');render();return;}
  return run(async token=>{
   await owner(token);
   if(!consent||!contextMatches())throw Error('论文信息已变化，请重新核对并生成。');
   if(!validThesisQuote(quote)&&!ambiguous){quote=null;throw Error('费用确认已过期，请重新获取费用。');}
   await onCommandChange?.(clientKey,{contextKey});if(!usable(token))return;commandPending=true;if(!contextMatches())throw Error('保存期间论文信息已变化，请重新核对后再生成。');
   try{
    const value=await request('/theses/methods',{snapshot,clientKey,billingToken:quote.token,consent:true},token);takeItem(value.item);quote=null;consent=false;ambiguous=false;message='已提交方法建议生成，原有补充说明保持不变。';
   }catch(failure){
    if(!failure.status||failure.status>=500){ambiguous=true;message='尚未确认提交结果。重试会使用同一个任务标识，不会主动新建第二个任务。';}
    else{ambiguous=false;quote=null;consent=false;}
    throw failure;
   }
  });
 }
 async function read(token){await owner(token);if(!jobId)return;const expected=jobId,value=await request('/theses/methods/'+encodeURIComponent(expected),undefined,token);takeItem(value.item,expected);}
 async function refresh(){return run(async token=>{await read(token);message='已读取最新任务状态。';});}
 async function cancel(){return run(async token=>{await owner(token);if(!jobId||!active(item))return;const expected=jobId,value=await request('/theses/methods/'+encodeURIComponent(expected)+'/cancel',{},token);takeItem(value.item,expected);message='已发送停止请求，原有补充说明保持不变。';});}
 async function apply(){
  if(!item||item.status!=='completed')return;if(!contextMatches()){setError('论文主题或研究资料已变化，请重新生成后再使用。');render();return;}
  return run(async token=>{
   await owner(token);if(!contextMatches())throw Error('论文主题或研究资料已变化，请重新生成后再使用。');
   const value=item,text=String($('#writing-method-ai-result')?.value??previewText).trim();if(!text)throw Error('请保留需要填入的方法建议内容。');
   const used=await onApply?.(text,value);if(!usable(token))return;
   if(used!==false){await onCommandChange?.(null,{contextKey});if(!usable(token))return;commandPending=false;clientKey=null;applied=true;message='已填入补充说明，可继续修改；仍属于拟开展的研究方案。';close();}
  });
 }
 function schedule(){
  clearPoll();if(!current()||!opened||busy||!user||!jobId||!active(item))return;
  timer=win.setTimeout(async()=>{timer=null;if(!current()||!opened)return;if(doc.hidden){schedule();return;}await run(async token=>{await read(token);});},2000);
 }
 function visibility(){if(!doc.hidden)schedule();}
 doc.addEventListener('visibilitychange',visibility);
 return {open,dispose(){if(!alive)return;alive=false;opened=false;epoch++;clearPoll();abortRequests();doc.removeEventListener('visibilitychange',visibility);},busy:()=>current()&&busy,hasWork:()=>current()&&busy};
}
