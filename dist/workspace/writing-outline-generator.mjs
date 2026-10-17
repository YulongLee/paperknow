import {withStableView} from './view-stability.mjs';
import {validThesisQuote} from './thesis-online.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const active=item=>['queued','running'].includes(item?.status);
const statusText={queued:'正在排队',running:'正在生成提纲',completed:'提纲已生成',failed:'提纲生成未完成',cancelled:'已停止生成'};
const stages={queued:'等待模型处理',preparing:'整理主题与研究资料',agent_running:'根据主题组织章节',agent_tools:'整理研究依据',completed:'请先预览，再使用提纲',failed:'请查看具体原因',cancelled:'原有提纲未改动'};
const abortError=()=>Object.assign(new Error('页面已切换'),{name:'AbortError'});

// The server owns the durable job and billing. This controller never replaces the local outline on submission or polling.
export function mountWritingOutlineGenerator({container,ctx={},getSnapshot,getContextKey,onApply,onJobChange,onCommandChange,pendingJobId=null,pendingContextKey=null,pendingClientKey=null,isCurrent=()=>true}={}){
 if(!container)throw new TypeError('缺少提纲生成区域');
 const doc=container.ownerDocument,win=doc.defaultView;
 let alive=true,opened=false,epoch=0,timer=null,busy=false,user=null,cap=null,quote=null,item=null,snapshot=null,contextKey=pendingContextKey,jobId=pendingJobId||null,clientKey=pendingClientKey||null,commandPending=!!pendingClientKey,consent=false,ambiguous=!!pendingClientKey&&!pendingJobId,message='',error='',loadError=false,applied=false;
 const controllers=new Set();
 const current=()=>alive&&container.isConnected&&isCurrent();
 const usable=token=>current()&&opened&&epoch===token;
 const $=selector=>container.querySelector(selector);
 const contextMatches=()=>String(getContextKey?.()??'')===String(contextKey??'');
 const clearPoll=()=>{if(timer!==null)win.clearTimeout(timer);timer=null;};
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
 async function owner(token=epoch){
  const next=await authenticate({fresh:true,token});
  if(!next||!user||String(next.id)!==String(user.id)){
   user=null;quote=null;item=null;clearPoll();setError('登录账户已变化，请重新登录并打开提纲生成。');throw Error(error);
  }
 }
 function takeItem(value,expectedId){
  if(!value?.id||!Object.hasOwn(statusText,value.status)||expectedId&&String(value.id)!==String(expectedId))throw Error('提纲任务数据不完整，请读取最新状态。');
  if(value.userId&&String(value.userId)!==String(user?.id)||value.ownerId&&String(value.ownerId)!==String(user?.id))throw Error('当前账户无法读取这份提纲，请重新打开。');
  item=value;jobId=value.id;
  if(value.status==='completed'&&(!String(value.output?.text||'').trim()))throw Error('任务已结束，但没有可用的提纲内容。原有提纲未改动。');
  notifyJob();
 }
 function render(){
  if(!current()||!opened)return;
  withStableView(container.closest('.dashboard')||container,()=>{
   container.hidden=false;
   const running=active(item),text=item?.status==='completed'?String(item.output?.text||''):'',drift=!!contextKey&&!contextMatches()||commandPending&&!contextKey;
   const brief=snapshot||{},profile=brief.profile||{};
   let body='';
   if(busy&&!user&&!loadError)body='<p class="writing-outline-ai-loading" role="status">正在读取账户与提纲服务…</p>';
   else if(!user&&!loadError)body=`<div class="writing-outline-ai-login"><h4>登录后，根据你的主题生成提纲</h4><p>已有提纲和当前浏览器草稿会保留；登录后才会发送生成任务。</p><a class="btn primary" href="${esc(loginHref())}">登录账户</a></div>`;
   else if(user){
    body=`<div class="writing-outline-ai-brief"><small>本次论文主题</small><h4>${esc(brief.title||'已保存的提纲生成任务')}</h4><div class="writing-outline-ai-facts"><span>${esc(profile.level||'按当前写作设置')}</span>${profile.discipline||profile.major?`<span>${esc(profile.discipline||profile.major)}</span>`:''}<span>${Array.isArray(brief.materials)?brief.materials.length:0} 份资料</span><span>${Array.isArray(brief.references)?brief.references.length:0} 篇参考文献</span></div></div>`;
    if(drift)body+='<p class="writing-outline-ai-warning" role="status">论文主题或研究资料已有变化。请先核对当前信息，再重新生成；这份结果不会直接替换当前提纲。</p>';
    if(item)body+=`<div class="writing-outline-ai-progress" role="status"><strong>${esc(statusText[item.status])}</strong><span>${esc(stages[item.stage]||stages[item.status]||'根据已确认的信息处理')}</span>${running?'<p>可离开此页面，后台任务会继续；重新打开可读取进度。</p>':''}${item.error?`<p class="writing-outline-ai-error">${esc(typeof item.error==='string'?item.error:item.error.message||'生成中断，请稍后重新生成。')}</p>`:''}</div>`;
    if(text)body+=`<div class="writing-outline-ai-preview"><label for="writing-outline-ai-result">AI 提纲预览</label><textarea id="writing-outline-ai-result" data-scroll-key="writing-outline-ai-preview" readonly rows="14">${esc(text)}</textarea><p>生成内容尚未应用。使用后，你仍可上传其他提纲或逐项编辑章节。</p></div>`;
    if(quote&&!item){body+=`<div class="writing-outline-ai-charge"><strong>${esc(costText())}</strong><p>仅在确认后提交任务。成功后结算，失败或取消按实际账单释放预占；提纲生成与后续正文生成分别计费。</p><label class="writing-outline-ai-consent"><input type="checkbox" data-outline-ai-consent ${consent?'checked':''} ${busy?'disabled':''}> 我确认有权使用上述信息，同意将论文主题、写作要求及选中资料的相关内容发送至后台配置的模型，并确认本次费用。</label></div>`;}
    body+='<div class="writing-outline-ai-actions">';
    if(running)body+=`<button type="button" class="btn secondary" data-outline-ai-refresh ${busy?'disabled':''}>读取最新状态</button><button type="button" class="btn secondary" data-outline-ai-cancel ${busy?'disabled':''}>停止生成</button>`;
    else if(text)body+=`<button type="button" class="btn primary" data-outline-ai-apply ${busy||drift?'disabled':''}>${applied?'再次使用这份 AI 提纲':'使用这份 AI 提纲'}</button><button type="button" class="btn secondary" data-outline-ai-new ${busy?'disabled':''}>重新生成</button>`;
    else if(drift&&commandPending)body+=`<button type="button" class="btn secondary" data-outline-ai-new ${busy?'disabled':''}>根据当前主题重新生成</button>`;
    else if(item||loadError||!quote)body+=`<button type="button" class="btn secondary" data-outline-ai-reload ${busy?'disabled':''}>${item?'重新获取费用并生成':commandPending?'读取原任务并重新确认费用':'重新读取'}</button>`;
    else body+=`<button type="button" class="btn primary" data-outline-ai-start ${busy||!consent||drift?'disabled':''}>${busy?'正在提交…':ambiguous?'重试本次提交':'确认费用并生成提纲'}</button>${!ambiguous?`<button type="button" class="btn secondary" data-outline-ai-requote ${busy?'disabled':''}>重新获取费用</button>`:''}`;
    body+='</div>';
    if(cap?.ready===false)body+=`<p class="writing-outline-ai-warning">${esc(cap.reason||'提纲生成服务暂未开放，仍可上传提纲或自己编辑。')}</p>`;
   }
   else body='<button type="button" class="btn secondary" data-outline-ai-reload>重新读取</button>';
   container.innerHTML=`<div class="writing-outline-ai-shell"><header class="writing-outline-ai-heading"><div><small>AI OUTLINE</small><h3>根据主题生成论文提纲</h3><p>先生成可预览的章节结构，再决定是否使用。</p></div><button type="button" class="writing-outline-ai-close" data-outline-ai-close aria-label="收起 AI 提纲生成">×</button></header>${body}<p class="writing-outline-ai-notice" data-outline-ai-notice role="status" aria-live="polite">${esc(message)}</p>${error?`<p class="writing-outline-ai-error" role="alert">${esc(error)}</p>`:''}<p class="writing-outline-ai-save-hint">原有提纲保持不变。生成结果需自行核对学术要求，点击“使用这份 AI 提纲”后才会应用。</p></div>`;
   bind();
  });
 }
 function bind(){
  $('[data-outline-ai-close]')?.addEventListener('click',close);
  $('[data-outline-ai-consent]')?.addEventListener('change',event=>{consent=event.target.checked;const button=$('[data-outline-ai-start]');if(button)button.disabled=busy||!consent||!contextMatches();});
  $('[data-outline-ai-start]')?.addEventListener('click',()=>void start());
  $('[data-outline-ai-requote]')?.addEventListener('click',()=>void prepare());
  $('[data-outline-ai-new]')?.addEventListener('click',()=>void prepare({newCommand:true}));
  $('[data-outline-ai-reload]')?.addEventListener('click',()=>void (jobId&&!item||commandPending&&!item?open():prepare()));
  $('[data-outline-ai-refresh]')?.addEventListener('click',()=>void refresh());
  $('[data-outline-ai-cancel]')?.addEventListener('click',()=>void cancel());
  $('[data-outline-ai-apply]')?.addEventListener('click',()=>void apply());
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
  cap=await request('/theses/outlines/capabilities',undefined,token);
  if(!cap?.ready){quote=null;throw Error(cap?.reason||'提纲生成服务暂未开放，仍可上传提纲或自己编辑。');}
  const value=await request('/billing/quote',{type:'agent'},token);
  if(!validThesisQuote(value))throw Error('费用信息不完整或已过期，请重新获取费用。');
  quote=value;if(!preserveCommand)clientKey=win.crypto.randomUUID();consent=false;ambiguous=preserveCommand&&commandPending;message=preserveCommand?'上次任务尚未确认创建。请重新确认费用后重试同一任务；若后台已接收，会读取原任务。':'请确认费用与资料用途；尚未开始生成。';
 }
 async function prepare({newCommand=false}={}){
  if(ambiguous&&!newCommand){message='请先重试本次提交以确认结果，避免重复创建任务。';render();return;}
  return run(async token=>{
   await owner(token);const brief=getSnapshot?.();if(!brief||!String(brief.title||'').trim())throw Error('请先填写论文主题，再生成提纲。');
   if(commandPending){await onCommandChange?.(null,{contextKey});if(!usable(token))return;}
   snapshot=structuredClone(brief);snapshot.outline=[];snapshot.bodySections=[];contextKey=String(getContextKey?.()??'');item=null;jobId=null;quote=null;clientKey=null;commandPending=false;ambiguous=false;applied=false;loadError=false;notifyJob();
   await loadQuote(token);
  });
 }
 async function open(){
  if(!current())return;
  opened=true;epoch++;busy=true;error='';loadError=false;message='';clearPoll();abortRequests();const token=epoch;render();
  try{
   const next=await authenticate({token});if(!usable(token))return;if(user&&String(user.id)!==String(next?.id)){quote=null;item=null;snapshot=null;jobId=null;clientKey=null;commandPending=false;consent=false;ambiguous=false;contextKey=null;}user=next;
   if(!user){quote=null;return;}
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
    const value=await request('/theses/outlines',{snapshot,clientKey,billingToken:quote.token,consent:true},token);takeItem(value.item);quote=null;consent=false;ambiguous=false;message='已提交提纲生成，原有提纲保持不变。';
   }catch(failure){
    if(!failure.status||failure.status>=500){ambiguous=true;message='尚未确认提交结果。重试会使用同一个任务标识，不会主动新建第二个任务。';}
    else{ambiguous=false;quote=null;consent=false;}
    throw failure;
   }
  });
 }
 async function read(token){await owner(token);if(!jobId)return;const expected=jobId,value=await request('/theses/outlines/'+encodeURIComponent(expected),undefined,token);takeItem(value.item,expected);}
 async function refresh(){return run(async token=>{await read(token);message='已读取最新任务状态。';});}
 async function cancel(){return run(async token=>{await owner(token);if(!jobId||!active(item))return;const expected=jobId,value=await request('/theses/outlines/'+encodeURIComponent(expected)+'/cancel',{},token);takeItem(value.item,expected);message='已发送停止请求，原有提纲保持不变。';});}
 async function apply(){
  if(!item||item.status!=='completed')return;if(!contextMatches()){setError('论文主题或研究资料已变化，请重新生成后再使用。');render();return;}
  return run(async token=>{
   await owner(token);if(!contextMatches())throw Error('论文主题或研究资料已变化，请重新生成后再使用。');
   const value=item,text=String(value.output?.text||'').trim();if(!text)throw Error('尚无可用提纲。');
   const used=await onApply?.(text,value);if(!usable(token))return;
   if(used!==false){await onCommandChange?.(null,{contextKey});if(!usable(token))return;commandPending=false;clientKey=null;applied=true;message='已应用这份提纲，可继续编辑章节。';close();}
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
