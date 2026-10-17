import {withStableView} from './view-stability.mjs';
import {documentExportButtons,bindDocumentExports} from './document-export.mjs';
import {toolBanner} from './tool-banner.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const instances=new Set();
const running=item=>['queued','running','cancelling'].includes(item?.job?.status)||['queued','running','cancelling'].includes(item?.status);
const labels={draft:'待生成',queued:'排队中',running:'正在生成',completed:'已完成',failed:'生成中断',interrupted:'处理中断',needs_materials:'待补研究证据',budget_exceeded:'已达本次处理上限',cancelled:'已停止',cancelling:'正在停止',pending:'待生成',edited:'已编辑',saved:'已保存',partial:'部分完成'};
const stageLabel=value=>({queue:'等待处理',queued:'等待处理',preparing:'准备研究资料',generating_section:'逐节写作',agent_running:'正在整理论证',agent_tools:'正在读取研究依据',reading_material:'读取研究资料',read_material:'读取研究资料',needs_materials:'等待补充研究证据',budget_exceeded:'已达本次处理上限',completed:'内容已保存',failed:'处理失败',interrupted:'处理中断',cancelled:'已停止'}[value]||'章节处理中');
const thesisStatus=item=>item.status==='draft'?'draft':item.job?.status||item.status;
export function validThesisQuote(quote,now=Date.now()){
 return !!(quote&&quote.type==='agent'&&['free','membership','bundle','credits'].includes(quote.source)&&typeof quote.title==='string'&&quote.title.trim()&&typeof quote.token==='string'&&quote.token.length>0&&quote.token.length<=4096&&Number.isSafeInteger(quote.creditCost)&&quote.creditCost>=0&&(quote.source==='credits'?quote.creditCost>0:quote.creditCost===0)&&Number.isFinite(Date.parse(quote.expiresAt))&&Date.parse(quote.expiresAt)>now);
}
export function thesisDocumentText(item){
 const chapters=(item?.chapters||[]).filter(chapter=>String(chapter.text||'').trim());
 if(!chapters.length)return '';
 if(typeof item.fullText==='string'&&item.fullText.trim())return item.fullText;
 const used=new Set(chapters.flatMap(chapter=>chapter.sourceIds||[])),refs=(item.snapshot?.references||[]).filter(row=>row.confirmed===true&&used.has(row.id)),materials=(item.snapshot?.materials||[]).filter(row=>row.confirmed===true&&used.has(row.id));
 return [item.title,`${item.profile?.level||''} · ${item.profile?.discipline||''}`,...chapters.flatMap(chapter=>['',chapter.title,chapter.text]),refs.length?'\n已使用的参考来源（用户确认，需自行核验原文）':'',...refs.map(ref=>[ref.title,ref.authors,ref.year,ref.doi,ref.url].filter(Boolean).join(' · ')),materials.length?'\n已使用的用户材料（需自行核对）':'',...materials.map(row=>row.name)].filter(Boolean).join('\n');
}
export function disposeOnlineThesis(){for(const instance of [...instances])instance.dispose();}
export const thesisOnlineHasWork=()=>[...instances].some(instance=>instance.hasWork());
export function thesisOnlineRouteGuard(){
 if([...instances].some(instance=>instance.busy())){[...instances][0]?.notice('正在保存，请稍候再离开。');return false;}
 return !thesisOnlineHasWork()||window.confirm('章节修改还未保存到账户，离开后会丢失这些修改。确定离开？');
}
export function thesisOnlineSessionChanged(user){for(const instance of [...instances])instance.sessionChanged(user);}
if(typeof window!=='undefined')window.addEventListener('beforeunload',event=>{if(thesisOnlineHasWork()){event.preventDefault();event.returnValue='';}});

export function mountOnlineThesis({id,ctx={},container=document.querySelector('.dashboard')}={}){
 return mountThesisStage({id,ctx,container,standalone:true});
}
export function mountThesisLibrary({ctx={},container=document.querySelector('.dashboard')}={}){
 return mountThesisStage({ctx,container,standalone:true,library:true});
}
export function mountThesisStage({id=null,ctx={},container,getSnapshot,onSaved,onManual,standalone=false,library=false}={}){
 for(const previous of [...instances])if(previous.container===container)previous.dispose();
 let alive=true,user=null,item=null,cap=null,busy=false,timer=null,selected=null,quote=null,quoteAction='generate',message='',loadError='',items=[],editorError='',loaded=false,researchEdits=null,historyChapter=null,historyItems=null,historyPreview=null;
 const controllers=new Set(),edits=new Map();
 const saveKey=crypto.randomUUID();
 let commandKey=null,pendingFocus=null;
 const disclosureState=new Map();
 const $=selector=>container.querySelector(selector);
 const dirty=()=>edits.size>0||researchEdits!==null;
 const notice=text=>{if(!alive)return;message=String(text||'');const node=$('[data-thesis-notice]');if(node)node.textContent=message;};
 const current=()=>alive&&container.isConnected;
 const clean=()=>{alive=false;clearTimeout(timer);controllers.forEach(controller=>controller.abort());instances.delete(instance);document.removeEventListener('visibilitychange',visibility);};
 const instance={container,dispose:clean,notice,hasWork:()=>alive&&(busy||dirty()),busy:()=>alive&&busy,sessionChanged(next){if(user&&String(user.id)!==String(next?.id)){user=null;item=null;items=[];quote=null;researchEdits=null;edits.clear();message='登录账户已变化，请重新打开账户论文；本页未发送新的资料。';clean();container.innerHTML=`<section class="thesis-online-shell"><h2>账户已切换</h2><p>${escape(message)}</p><a href="#theses">重新查看账户论文</a></section>`;}}};
 instances.add(instance);
 container.classList.add('thesis-online-host');
 if(standalone){container.classList.add('creation-page');const crumb=document.querySelector('.breadcrumb strong');if(crumb)crumb.textContent='研究工作台 / 账户论文';}
 async function api(path,data){
  const controller=new AbortController();controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),25000);
  try{
   if(ctx.api){const value=await ctx.api(path,data,{signal:controller.signal});if(!current())throw new DOMException('页面已切换','AbortError');return value;}
   const response=await fetch('/api'+path,{method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:controller.signal});
   const value=await response.json().catch(()=>({error:'服务暂时无法响应，请稍后重试。'}));
   if(!current())throw new DOMException('页面已切换','AbortError');
   if(!response.ok){const error=new Error(value.error||'请求未完成，请稍后重试。');error.status=response.status;throw error;}
   return value;
  }finally{clearTimeout(timeout);controllers.delete(controller);}
 }
 async function auth({fresh=false}={}){
  let result;
  try{result=!fresh&&ctx.session?await ctx.session():await api('/auth/me');}catch(error){if(error.status===401)return null;throw error;}
  if(result?.status==='error')throw Error('暂时无法核对登录状态，请稍后重试；本地草稿仍可编辑。');
  if(result?.status==='guest')return null;
  if(result?.status==='loading')throw Error('登录状态仍在读取，请稍后重试。');
  if(!result?.user?.id)throw Error('账户信息不完整，暂时无法核对登录状态，请重新读取。');
  return result.user;
 }
 async function owner(){
  const next=await auth({fresh:true});
  if(!current())throw new DOMException('页面已切换','AbortError');
  if(!next||!user||String(next.id)!==String(user.id)){instance.sessionChanged(next);if(alive){user=null;item=null;items=[];quote=null;edits.clear();render();}throw Error('登录状态已变化，请重新登录后打开账户论文。');}
 }
 function failure(error){
  if(!current()||error.name==='AbortError')return;
  if(error.status===401){user=null;item=null;items=[];quote=null;researchEdits=null;edits.clear();clearTimeout(timer);}
  notice(error.status===409?'内容版本已更新。请读取最新状态后核对，尚未保存的章节文字仍在编辑区。':error.message||'操作未完成，请稍后重试。');
 }
 async function mutate(action){
  if(busy||!current())return;
  busy=true;render();
  try{await owner();if(current())await action();}catch(error){failure(error);}finally{busy=false;if(current())render();}
 }
 function takeItem(next){if(!next?.id)throw Error('论文数据不完整，请重新读取。');item=next;id=next.id;loaded=true;if(!selected||(next.chapters||[]).every(chapter=>chapter.id!==selected))selected=next.chapters?.[0]?.id||null;}
 async function refresh(){
  if(!user||!id)return;
  const value=await api('/theses/'+encodeURIComponent(id));if(current())takeItem(value.item);
 }
 function schedule(){
  clearTimeout(timer);
  if(!current()||!user||!item||!running(item))return;
  timer=setTimeout(async()=>{try{if(!document.hidden&&!busy){await refresh();if(current())render();}}catch(error){failure(error);if(current())render();}finally{schedule();}},4000);
 }
 function visibility(){if(!document.hidden&&running(item))schedule();}
 document.addEventListener('visibilitychange',visibility);
 function loginPanel(){const next='/workspace.html'+location.search+location.hash;return `<section class="thesis-login"><span class="thesis-symbol">↥</span><h3>登录后保存到账户，随时继续写作</h3><p>当前浏览器草稿继续保留。登录后可确认资料、逐章生成，并在其他设备找回论文。</p><a class="btn primary" href="/auth.html?mode=login&amp;next=${encodeURIComponent(next)}">登录账户</a></section>`;}
 function snapshotSummary(snapshot){
  const profile=snapshot.profile||{},materials=snapshot.materials||[],refs=snapshot.references||[];
  return `<div class="thesis-summary"><div><small>已确认的研究任务</small><strong>${escape(snapshot.title||'未填写')}</strong><p>${[profile.level,profile.discipline||profile.major,profile.language].filter(Boolean).map(escape).join(' · ')} · 目标 ${Number(profile.targetWords||0).toLocaleString('zh-CN')} 字</p></div><div class="thesis-summary-counts"><span><b>${snapshot.outline?.length||0}</b>论文章节</span><span><b>${materials.length}</b>研究资料</span><span><b>${refs.length}</b>参考来源</span></div></div><details class="thesis-sources"><summary>核对将保存与使用的研究资料</summary><p>研究问题：${escape(profile.researchQuestion||'暂未补充（可选）')}<br>研究方法：${escape(profile.method||'暂未补充（可选）')}</p>${materials.map(row=>`<div><b>${escape(row.name)}</b><small>${escape(row.purpose||'研究背景')} · ${String(row.text||'').length.toLocaleString('zh-CN')} 字符 · 用户提供</small></div>`).join('')}${refs.map(row=>`<div><b>${escape(row.title)}</b><small>${escape(row.sourceLabel||'用户导入')} · ${row.text?'含正文':'仅元数据，不代表已读取原文'} · 未经系统核验</small></div>`).join('')}${!materials.length&&!refs.length?'<p>尚无研究资料。必须补充并确认至少一份含正文的真实材料，才能开始生成。系统不会凭空补写实验、问卷或统计结果。</p>':''}</details>`;
 }
 function costText(value){return value.source==='free'?'本次免费，不扣积分或权益次数。':value.source==='credits'?`本次预占 ${value.creditCost} 科研积分。`:`本次预占${value.source==='membership'?'会员':'套餐'}权益 1 次，不扣科研积分。`;}
 function controls(){
  if(!item)return '';
  const active=running(item),hasText=(item.chapters||[]).some(chapter=>String(chapter.text||'').trim()),resumable=item.job?.canResume===true||['failed','cancelled'].includes(item.job?.status)&&item.status!=='draft';
  return `<section class="thesis-run-controls"><div><span class="thesis-service-state ${cap?.ready?'ready':''}">${cap?.ready?'分章生成可用':'分章生成暂未开放'}</span><p>${escape(cap?.ready?'确认费用与资料用途后，按已确认的提纲逐章生成。':cap?.reason||'正在核对 AI 服务状态。保存与手动编辑仍可使用。')}</p><small>最多 ${Number(cap?.limits?.maxChapters)||30} 章 · 目标上限 ${(Number(cap?.limits?.maxTargetWords)||80000).toLocaleString('zh-CN')} 字 · 需确认含正文的真实资料，研究方法可稍后补充</small><p class="thesis-source-note">分章写作基于已确认资料中的相关片段，不等同于全文研读或在线文献核验。</p></div><div class="thesis-action-row">${active?'<button type="button" class="btn secondary" data-thesis-cancel '+(busy?'disabled':'')+'>停止生成</button>':`${!hasText||item.status==='draft'?'<button type="button" class="btn primary" data-thesis-quote="generate" '+(!cap?.ready||busy||dirty()?'disabled':'')+'>'+(hasText?'生成完整新版本':'确认费用并生成')+'</button>':''}${resumable?'<button type="button" class="btn primary" data-thesis-quote="resume" '+(!cap?.ready||busy||dirty()?'disabled':'')+'>确认费用并恢复未完成章节</button>':''}`}<button type="button" class="btn secondary" data-thesis-refresh ${busy?'disabled':''}>读取最新状态</button></div>${quote?`<div class="thesis-charge" role="region" aria-label="确认任务费用"><h3>${quoteAction==='resume'?'恢复生成':'开始生成'} · ${escape(quote.title)}</h3><strong>${escape(costText(quote))}</strong>${quoteAction==='generate'&&(item.chapters||[]).some(chapter=>String(chapter.text||'').trim())?'<p>本次将按照当前资料重新生成全部章节，并更新最新正文；已经保存的历史版本继续保留。</p>':''}<p>成功后结算；失败或取消会释放本次预占。恢复任务按本次新报价结算。报价在 ${escape(new Date(quote.expiresAt).toLocaleTimeString('zh-CN'))} 到期。</p><label><input type="checkbox" data-thesis-consent> 我确认已核对选中资料，有权使用其内容，并同意将论文信息、提纲及选中资料的相关正文片段交由 AI 服务处理。生成内容需要我自行核对事实、引文与学术规范。</label><div class="thesis-action-row"><button type="button" class="btn primary" data-thesis-start disabled>确认并${quoteAction==='resume'?'恢复':'开始'}生成</button><button type="button" class="btn secondary" data-thesis-dismiss>取消</button></div></div>`:''}</section>`;
 }
 function progress(){
  const job=item.job,complete=Number(job?.completedSections)||0,total=Number(job?.totalSections)||0,percent=total?Math.min(100,Math.floor(complete/total*100)):0;
  return `<section class="thesis-progress" aria-label="章节生成进度"><div><b>${escape(labels[thesisStatus(item)]||'已保存')}</b><span>${total?`${complete} / ${total} 个写作单元`:'已保存到账户'}${job?.stage?' · '+stageLabel(job.stage):''}</span></div>${item.status==='draft'&&job?'<p>研究信息或正文已有更新；下面为上次任务进度。再次生成会建立新版本。</p>':''}${total?`<progress value="${percent}" max="100" aria-label="已完成 ${percent}%"></progress>`:''}${job?.error?`<p class="thesis-error">${escape(typeof job.error==='string'?job.error:job.error.message||'生成中断，请核对后恢复。')}</p>`:''}<p>已完成内容独立保存。${running(item)?'关闭页面后任务仍在后台继续；重新打开即可查看进度。':'请核对内容后再用于正式提交。'}</p>${job?.missingEvidence?.length?`<p class="thesis-error">待补充证据：${job.missingEvidence.map(row=>escape(row)).join('；')}</p>`:''}</section>`;
 }
 function researchForm(){
  const values=researchEdits||{method:item.profile?.method||'',researchQuestion:item.profile?.researchQuestion||'',supplement:''};
  return `<details class="thesis-research-edit" ${researchEdits?'open':''}><summary>补充研究方法与真实材料</summary><p>资料变化后需要重新确认生成；已经保存的章节版本继续保留。仅保存资料不会扣费。</p><label for="thesis-research-question">研究问题（可选）</label><textarea id="thesis-research-question" data-research-field="researchQuestion" maxlength="3000" ${busy||running(item)?'disabled':''}>${escape(values.researchQuestion)}</textarea><label for="thesis-research-method">研究方法或论证路径（可选）</label><textarea id="thesis-research-method" data-research-field="method" maxlength="1000" ${busy||running(item)?'disabled':''}>${escape(values.method)}</textarea><label for="thesis-research-supplement">新增材料正文（可选）</label><textarea id="thesis-research-supplement" data-research-field="supplement" maxlength="50000" placeholder="补充真实研究过程、结果或相关材料。" ${busy||running(item)?'disabled':''}>${escape(values.supplement)}</textarea><div class="thesis-action-row"><button type="button" class="btn secondary" data-thesis-save-research ${busy||running(item)||!researchEdits?'disabled':''}>确认并保存研究信息</button>${getSnapshot?'<button type="button" class="btn secondary" data-thesis-sync '+(busy||running(item)||dirty()?'disabled':'')+'>同步前四步已确认的资料与提纲</button>':''}</div></details>`;
 }
 function chapterEditor(){
  const chapters=item.chapters||[],chapter=chapters.find(row=>row.id===selected),edit=edits.get(selected),text=edit?.text??chapter?.text??'';
  return `<section class="thesis-chapter-workspace"><nav class="thesis-chapter-nav" aria-label="论文章节"><h3>章节目录 <small>${chapters.length} 章</small></h3>${chapters.map((row,index)=>`<button type="button" data-thesis-chapter="${escape(row.id)}" aria-current="${row.id===selected?'true':'false'}"><span>${String(index+1).padStart(2,'0')}</span><div><b>${escape(row.title)}</b><small>${edits.has(row.id)?'有未保存修改':escape(labels[row.status]||'待生成')}${row.text?' · '+String(row.text).length.toLocaleString('zh-CN')+' 字符':''}</small></div></button>`).join('')}</nav><article class="thesis-editor"><header><div><small>CHAPTER WORKSPACE</small><h3>${escape(chapter?.title||'等待章节')}</h3></div><span>账户版本 ${Number(item.version)||1}</span></header>${chapter?.sourceIds?.length?`<p class="thesis-source-note">关联资料：${chapter.sourceIds.map(source=>escape([...(item.snapshot?.materials||[]),...(item.snapshot?.references||[])].find(row=>row.id===source)?.name||[...(item.snapshot?.materials||[]),...(item.snapshot?.references||[])].find(row=>row.id===source)?.title||source)).join('、')}（关联标记，仍需核对原文）</p>`:''}${chapter?.error?`<p class="thesis-error">${escape(typeof chapter.error==='string'?chapter.error:chapter.error.message||'该章暂未完成')}</p>`:''}${completedSectionsPreview(chapter)}<label class="thesis-editor-label" for="thesis-chapter-editor">${running(item)?'已保存章节正文（生成期间只读）':'已保存章节正文（可编辑）'}</label><textarea id="thesis-chapter-editor" data-thesis-editor ${!chapter||busy?'disabled':''} ${running(item)?'readonly aria-readonly="true"':''} placeholder="生成完成后在这里核对与修改；也可以直接手动撰写。">${escape(text)}</textarea><footer><span data-thesis-edit-state>${edit?'未保存的章节修改':chapter?.version?'已保存 · 章节版本 '+Number(chapter.version):'尚无正文'}</span><button type="button" class="btn primary" data-thesis-save-chapter ${!edit||busy||running(item)?'disabled':''}>保存章节新版本</button></footer><p class="thesis-error" role="status">${escape(editorError)}</p>${chapterHistory(chapter)}${edit?'<button type="button" class="thesis-discard-edit" data-thesis-discard>放弃本章未保存修改，使用账户版本</button>':''}</article></section>`;
 }
 function completedSectionsPreview(chapter){
  if(!chapter)return '';
  const sections=(item.sections||[]).filter(row=>row.chapterId===chapter.id&&row.status==='completed'&&String(row.text||'').trim());
  if(!sections.length||sections.length>=Number(chapter.totalSections||0))return chapter.stale?'<p class="thesis-error">下方已保存正文基于此前的研究资料，尚未按当前资料重新生成，请核对版本。</p>':'';
  return `<section class="thesis-completed-sections"><h4>当前任务已完成的小节</h4><p>这些内容已保存，但当前章节尚未全部完成。下方编辑区仍显示账户中已保存的整章版本；停止或中断不会清空下列内容。</p>${sections.map((row,index)=>`<details ${sections.length===1?'open':''}><summary>已完成小节 ${index+1}<small>${String(row.text).length.toLocaleString('zh-CN')} 字符</small></summary><pre>${escape(row.text)}</pre></details>`).join('')}${chapter.stale?'<p class="thesis-error">下方整章正文来自此前的研究资料，请与本次小节区分核对。</p>':''}</section>`;
 }
 function chapterHistory(chapter){
  const history=historyChapter===chapter?.id?historyItems:null,preview=historyChapter===chapter?.id?historyPreview:null;
  const source=value=>({manual:'手动编辑',imported:'导入正文',agent:'AI 生成',generated:'AI 生成',bibliography:'已使用参考来源',compiled_references:'已使用参考来源编排'}[value]||'账户版本');
  return `<section class="thesis-history"><button type="button" class="btn secondary" data-thesis-history ${busy||!chapter?.version?'disabled':''}>查看章节历史版本</button>${history?`<div class="thesis-history-list"><h4>已保存的章节版本 <small>最多展示最近 50 版</small></h4>${history.map(row=>`<button type="button" data-thesis-history-version="${Number(row.version)}" ${busy?'disabled':''}><b>版本 ${Number(row.version)}</b><span>${source(row.source)} · ${escape(row.createdAt?new Date(row.createdAt).toLocaleString('zh-CN'):'保存时间未知')}</span>${preview?.version===row.version?'<em>查看中</em>':''}</button>`).join('')||'<p>尚无历史版本。</p>'}</div>`:''}${preview?`<div class="thesis-history-preview"><h4>版本 ${Number(preview.version)} · ${source(preview.source)}</h4><p>以下为历史内容，只读预览。载入编辑区后仍需保存为新版本，原有记录继续保留。</p><pre>${escape(preview.text)}</pre><button type="button" class="btn secondary" data-thesis-history-use ${busy||running(item)?'disabled':''}>载入此版本到编辑区</button></div>`:''}</section>`;
 }
 function captureView(){
  const active=document.activeElement;
  if(container.contains(active)){
   const attr=[...active.attributes].find(row=>/^data-thesis-[a-z-]+$/.test(row.name));
   const disclosure=active.tagName==='SUMMARY'&&active.parentElement;
   pendingFocus=active.id?{id:active.id}:attr?{attr:attr.name,value:attr.value}:disclosure?.matches('.thesis-sources,.thesis-research-edit')?{summary:disclosure.className}:null;
   if(pendingFocus&&typeof active.selectionStart==='number')Object.assign(pendingFocus,{start:active.selectionStart,end:active.selectionEnd,scroll:active.scrollTop});
  }else if(active&&active!==document.body)pendingFocus=null;
  for(const selector of ['.thesis-sources','.thesis-research-edit']){const node=$(selector);if(node)disclosureState.set(selector,node.open);}
 }
 function restoreView(){
  for(const [selector,open] of disclosureState){const node=$(selector);if(node)node.open=open;}
  if(!pendingFocus)return;
  const focus=pendingFocus,node=focus.id?[...container.querySelectorAll('[id]')].find(row=>row.id===focus.id):focus.attr?[...container.querySelectorAll('['+focus.attr+']')].find(row=>row.getAttribute(focus.attr)===focus.value):[...container.querySelectorAll('.thesis-sources,.thesis-research-edit')].find(row=>row.className===focus.summary)?.querySelector('summary');
  if(!node){pendingFocus=null;return;}
  if(node.disabled)return;
  node.focus({preventScroll:true});
  if(typeof focus.start==='number'&&typeof node.setSelectionRange==='function'){node.setSelectionRange(focus.start,focus.end);node.scrollTop=focus.scroll;}
  pendingFocus=null;
 }
 function render(){if(!current())return;return withStableView(container.closest('.dashboard')||container,renderView,{restoreFocus:false});}
 function renderView(){
  if(!current())return;
  captureView();
  const prefix=standalone?toolBanner('writing',{title:library?'我的账户论文':'毕业论文',label:library?'AI 写作 · 账户论文':'AI 写作 · 毕业论文',description:'从确认提纲，到分章写作、核对与导出。让每一步研究，都留下可以继续完善的版本。',extraClass:'writing-task-banner writing-task-writing detail-service-banner thesis-studio-banner',actions:`<a class="btn secondary" href="${library?'#tool/writing':'#theses'}">${library?'新建毕业论文':'账户论文'}</a><a class="btn secondary" href="#category/writing">返回 AI 写作</a>`}):'';
  let body='';
  if(!loaded&&!loadError)body='<div class="thesis-loading" role="status">正在读取账户与服务状态…</div>';
  else if(loadError)body=`<section class="thesis-login"><h3>暂时无法读取</h3><p>${escape(loadError)}</p><button type="button" class="btn secondary" data-thesis-reload>重新读取</button></section>`;
  else if(!user)body=loginPanel();
  else if(library)body=items.length?`<div class="thesis-library">${items.map(row=>`<a href="#thesis/${encodeURIComponent(row.id)}"><span class="thesis-symbol">▤</span><div><h2>${escape(row.title||'未命名论文')}</h2><p>${escape(row.profile?.level||'')} · ${escape(row.profile?.discipline||'')} · ${escape(labels[thesisStatus(row)]||'已保存')}</p><small>${escape(row.updatedAt?new Date(row.updatedAt).toLocaleString('zh-CN'):'账户保存')} · 版本 ${Number(row.version)||1}</small></div><span>继续写作 →</span></a>`).join('')}</div>`:'<section class="thesis-login"><span class="thesis-symbol">▤</span><h3>从第一篇账户论文开始</h3><p>完成毕业论文前四步并保存到账户，即可在这里继续写作。</p><a class="btn primary" href="#tool/writing">新建毕业论文</a></section>';
  else if(!item){
   let snapshot;try{snapshot=getSnapshot?.();}catch(error){body=`<p class="thesis-error">${escape(error.message)}</p>`;}
   if(snapshot)body=`${snapshotSummary(snapshot)}<section class="thesis-save-account"><div><h3>先保存已确认的信息</h3><p>将以上论文资料保存到当前账户，不会开始生成或扣费。原有本地草稿独立保留。</p></div><button type="button" class="btn primary" data-thesis-create ${busy?'disabled':''}>${busy?'正在保存…':'保存到账户，继续生成'}</button></section>`;
   else if(!body)body='<section class="thesis-login"><h3>请先选择一篇账户论文</h3><p>从账户论文列表打开已有论文，或从毕业论文前四步确认研究信息。</p><a class="btn secondary" href="#theses">查看账户论文</a></section>';
  }else body=`<div class="thesis-studio-overview"><section class="thesis-studio-brief" aria-label="已确认的研究信息">${snapshotSummary(item.snapshot||{title:item.title,profile:item.profile,outline:item.outline})}${researchForm()}</section><aside class="thesis-studio-run" aria-label="撰写与任务进度">${controls()}${progress()}</aside></div><div class="thesis-workspace-heading"><div><small>章节工作区</small><h2>逐章写作，逐步完善</h2></div><p>对照研究依据核对正文，保存后再导出。</p></div>${chapterEditor()}<section class="thesis-export"><div><small>文档交付</small><h3>核对完成，导出正文</h3><p>下载账户中已保存的正文；如有未保存修改，请先保存。引用来源与研究结果仍需本人核验。</p></div><div class="thesis-action-row"><button type="button" class="btn secondary" data-thesis-txt>下载 TXT</button>${documentExportButtons('thesis-online')}</div><p role="status" data-thesis-export-status></p></section>`;
  container.innerHTML=`${prefix}<div class="thesis-online-shell"><div data-thesis-notice role="status" aria-live="polite">${escape(message)}</div>${body}${!library?`<div class="thesis-bottom-actions">${onManual?'<button type="button" class="btn secondary" data-thesis-manual>继续本地手动写作</button>':''}<a href="#theses">查看账户论文 →</a></div>`:''}</div>`;
  bind();restoreView();schedule();
 }
 function bind(){
  $('[data-thesis-reload]')?.addEventListener('click',()=>void load());
  $('[data-thesis-manual]')?.addEventListener('click',()=>{if(!busy&&(!dirty()||window.confirm('账户章节尚有未保存修改，确认返回本地写作？')))onManual?.();});
  $('[data-thesis-create]')?.addEventListener('click',()=>void mutate(async()=>{
   const snapshot=getSnapshot();const value=await api('/theses',{clientKey:saveKey,snapshot});takeItem(value.item);onSaved?.(item.id);notice('已保存到账户。生成前还需确认任务费用与资料用途。');
  }));
  $('[data-thesis-refresh]')?.addEventListener('click',()=>void mutate(async()=>{await refresh();quote=null;notice(dirty()?'已读取最新状态。未保存文字仍保留，请核对后保存。':'已读取最新账户状态。');}));
  container.querySelectorAll('[data-research-field]').forEach(input=>input.addEventListener('input',()=>{
   researchEdits={method:$('#thesis-research-method').value,researchQuestion:$('#thesis-research-question').value,supplement:$('#thesis-research-supplement').value};quote=null;
   $('[data-thesis-save-research]').disabled=false;container.querySelectorAll('[data-thesis-quote],[data-thesis-start],[data-thesis-sync]').forEach(button=>button.disabled=true);updateExportButtons();
  }));
  $('[data-thesis-save-research]')?.addEventListener('click',()=>void mutate(async()=>{
   if(!researchEdits||running(item))return;
   const snapshot=structuredClone(item.snapshot),values={...researchEdits};snapshot.profile={...snapshot.profile,method:values.method.trim(),researchQuestion:values.researchQuestion.trim()};
   if(values.supplement.trim())snapshot.materials.push({id:'material:'+crypto.randomUUID(),name:'用户补充研究材料',purpose:'研究证据补充',text:values.supplement.trim(),confirmed:true});
   const value=await api('/theses/'+encodeURIComponent(id),{version:item.version,snapshot});takeItem(value.item);researchEdits=null;quote=null;notice('研究信息已保存。再次生成前请重新确认费用与资料用途。');
  }));
  $('[data-thesis-sync]')?.addEventListener('click',()=>void mutate(async()=>{
   if(dirty()||running(item))throw Error('请先保存章节和研究信息。');
   const snapshot=getSnapshot();if(!window.confirm('将前四步已确认的资料与提纲同步到账户？已有章节版本会保留，新的生成需要重新确认费用。'))return;
   const value=await api('/theses/'+encodeURIComponent(id),{version:item.version,snapshot});takeItem(value.item);quote=null;notice('已同步确认资料与提纲，原章节版本继续保留。');
  }));
  container.querySelectorAll('[data-thesis-quote]').forEach(button=>button.addEventListener('click',()=>void mutate(async()=>{
   if(!cap?.ready||running(item)||dirty())throw Error('请先保存修改并确认服务可用。');
   if(![...(item.snapshot?.materials||[]),...(item.snapshot?.references||[])].some(row=>row.confirmed===true&&String(row.text||'').trim()))throw Error('请先确认至少一份含正文的真实研究材料；仅有文献题录不足以生成论文。');
   const value=await api('/billing/quote',{type:'agent'});if(!validThesisQuote(value))throw Error('报价不完整或已过期，请重新获取费用。');quote={...value,version:item.version};quoteAction=button.dataset.thesisQuote;commandKey=crypto.randomUUID();notice('请确认费用与选中资料用途；尚未开始生成。');
  })));
  $('[data-thesis-consent]')?.addEventListener('change',event=>{const start=$('[data-thesis-start]');if(start)start.disabled=!event.target.checked||busy;});
  $('[data-thesis-dismiss]')?.addEventListener('click',()=>{quote=null;render();});
  $('[data-thesis-start]')?.addEventListener('click',()=>{
   if(!$('[data-thesis-consent]')?.checked||!quote)return;
   const agreed=quote,action=quoteAction,key=commandKey;
   void mutate(async()=>{
    if(!validThesisQuote(agreed)||agreed.version!==item.version||running(item)){quote=null;throw Error('报价或论文版本已变化，请重新确认费用。');}
    try{const value=await api('/theses/'+encodeURIComponent(id)+'/'+action,{version:item.version,clientKey:key,billingToken:agreed.token,consent:true});takeItem(value.item);notice(action==='resume'?'已提交恢复，将继续未完成章节。':'已提交分章生成，可在这里查看真实进度。');}
    catch(error){try{await refresh();}catch{}throw error;}finally{quote=null;}
   });
  });
  $('[data-thesis-cancel]')?.addEventListener('click',()=>void mutate(async()=>{const value=await api('/theses/'+encodeURIComponent(id)+'/cancel',{version:item.version});takeItem(value.item);quote=null;notice('已发送停止请求，已完成章节会保留。');}));
  container.querySelectorAll('[data-thesis-chapter]').forEach(button=>button.addEventListener('click',()=>{if(busy)return;selected=button.dataset.thesisChapter;editorError='';historyChapter=null;historyItems=null;historyPreview=null;render();}));
  $('[data-thesis-history]')?.addEventListener('click',()=>void mutate(async()=>{
   const chapterId=selected,value=await api('/theses/'+encodeURIComponent(id)+'/chapters/'+encodeURIComponent(chapterId)+'/versions');
   if(selected===chapterId){if(!Array.isArray(value.items))throw Error('历史版本数据不完整，请稍后重试。');historyChapter=chapterId;historyItems=value.items;historyPreview=null;}
  }));
  container.querySelectorAll('[data-thesis-history-version]').forEach(button=>button.addEventListener('click',()=>void mutate(async()=>{
   const chapterId=selected,value=await api('/theses/'+encodeURIComponent(id)+'/chapters/'+encodeURIComponent(chapterId)+'/versions/'+encodeURIComponent(button.dataset.thesisHistoryVersion));
   if(selected===chapterId){if(typeof value.item?.text!=='string')throw Error('历史版本内容不完整，请重新读取。');historyChapter=chapterId;historyPreview=value.item;}
  })));
  $('[data-thesis-history-use]')?.addEventListener('click',()=>{
   if(busy||running(item)||!historyPreview||historyChapter!==selected)return;
   if(edits.has(selected)&&!window.confirm('当前章节有未保存修改，载入历史版本会替换编辑区文字。确认继续？'))return;
   const chapter=item.chapters.find(row=>row.id===selected);
   if(String(chapter.text||'')===historyPreview.text)edits.delete(selected);else edits.set(selected,{text:historyPreview.text,baseText:String(chapter.text||''),baseVersion:chapter.version});
   notice('历史版本已载入编辑区，尚未保存。核对后点击“保存章节新版本”。');render();
  });
  $('[data-thesis-editor]')?.addEventListener('input',event=>{
   const chapter=item.chapters?.find(row=>row.id===selected);if(!chapter||running(item)||busy)return;
   if(event.target.value===String(chapter.text||''))edits.delete(selected);else edits.set(selected,{text:event.target.value,baseText:edits.get(selected)?.baseText??String(chapter.text||''),baseVersion:edits.get(selected)?.baseVersion??chapter.version});
   const state=$('[data-thesis-edit-state]');if(state)state.textContent=edits.has(selected)?'未保存的章节修改':'已与账户内容一致';
   const save=$('[data-thesis-save-chapter]');if(save)save.disabled=!edits.has(selected);container.querySelectorAll('[data-thesis-quote],[data-thesis-start],[data-thesis-sync]').forEach(button=>button.disabled=dirty()||!cap?.ready);updateExportButtons();
  });
  $('[data-thesis-discard]')?.addEventListener('click',()=>{if(!busy&&window.confirm('确认丢弃当前章节尚未保存的修改，使用已读取的账户正文？请先复制需要保留的文字。')){edits.delete(selected);editorError='';render();}});
  $('[data-thesis-save-chapter]')?.addEventListener('click',()=>{
   const chapterId=selected,edit=edits.get(chapterId),version=item.version;if(!edit)return;
   void mutate(async()=>{
    if(running(item))throw Error('生成结束或停止后再修改章节。');
    const chapter=item.chapters.find(row=>row.id===chapterId);
    if(String(chapter.text||'')!==edit.baseText){editorError='账户中的该章正文已变化。你的文字仍保留，请先复制备份，再重新打开该章核对版本。';throw Error(editorError);}
    const value=await api('/theses/'+encodeURIComponent(id)+'/chapters/'+encodeURIComponent(chapterId),{version,text:edit.text});takeItem(value.item);edits.delete(chapterId);editorError='';notice('已保存章节新版本，旧版本仍由账户保留。');
   });
  });
  $('[data-thesis-txt]')?.addEventListener('click',()=>{
   if(dirty()||!thesisDocumentText(item))return;
   const url=URL.createObjectURL(new Blob([thesisDocumentText(item)],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=String(item.title||'论文正文').replace(/[\\/:*?"<>|]/g,'_')+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);notice('已发起 TXT 下载。');
  });
  if(item){bindDocumentExports('thesis-online',()=>current()&&!dirty()?thesisDocumentText(item):'',()=>item.title||'论文正文',$('[data-thesis-export-status]'));updateExportButtons();}
 }
 function updateExportButtons(){const disabled=busy||dirty()||!thesisDocumentText(item);for(const selector of ['[data-thesis-txt]','#thesis-online-docx','#thesis-online-pdf']){const button=$(selector);if(button)button.disabled=disabled;}}
 async function load(){
  loadError='';loaded=false;render();
  try{
   user=await auth();if(!current())return;
   if(user){
    if(library)items=(await api('/theses')).items||[];
    else{
     if(id)await refresh();
     try{const value=await api('/capabilities');cap=value.thesis||{ready:false,reason:'论文生成服务暂未配置，仍可保存和手动编辑。'};}catch(error){if(error.status===401)throw error;cap={ready:false,reason:'暂时无法核对 AI 服务；仍可保存和手动编辑。'};}
    }
   }
   loaded=true;
  }catch(error){if(current()&&error.name!=='AbortError'){if(error.status===401){user=null;loaded=true;}else loadError=error.message||'读取失败，请稍后重试。';}}
  if(current())render();
 }
 render();const ready=load();
 const dispose=()=>clean();dispose.ready=ready;dispose.hasWork=instance.hasWork;return dispose;
}
