// Local draft editors persist synchronously before navigation. Generation and account submissions stay explicit.
let editor=null;
const snapshot=s=>JSON.stringify(s.getValue());
const dirty=s=>{try{return snapshot(s)!==s.original;}catch{return true;}};
function cancelTimer(s){if(s.timer!==null)s.win.clearTimeout(s.timer);s.timer=null;}
export function clearEditor(){const previous=editor;editor=null;if(!previous)return;cancelTimer(previous);previous.cleanup();previous.dispose?.();}
export function saveEditorWork(){return editor?.save?.();}
export const editorIsActive=()=>!!editor;
export const editorHasWork=()=>!!editor&&(editor.busy()||dirty(editor));
export function markEditorSaved(){if(!editor)return;editor.original=snapshot(editor);editor.failed=false;cancelTimer(editor);}

function persist(s){
 if(!s||s!==editor)return !s;
 cancelTimer(s);if(s.busy())return false;if(!dirty(s))return true;
 try{
  const result=(s.saveDraft||s.save)();
  // A page-unload save cannot await a server response. Only local synchronous persistence is supported here.
  if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});return false;}
  return result!==false&&s===editor&&!dirty(s);
 }catch{return false;}
}
export function flushEditorDraft(){return persist(editor);}
function schedule(s,delay=800){
 if(s!==editor||!s.saveDraft)return;cancelTimer(s);if(!dirty(s))return;
 s.timer=s.win.setTimeout(()=>{s.timer=null;if(s!==editor)return;if(s.busy()){schedule(s,500);return;}if(!persist(s)&&!s.failed){s.failed=true;s.ctx.notify?.('草稿暂未保存，请检查浏览器存储空间；当前编辑仍保留。');}},delay);
}
function leave(action){
 const s=editor;if(!s)return true;
 if(s.busy()){s.ctx.notify?.('正在本地解析，请等待完成后再离开。');return false;}
 if(persist(s))return true;
 const $=selector=>s.doc.querySelector(selector);
 s.ctx.modal?.('草稿保存失败',`<p class="hub-description">自动保存未成功，当前内容仍保留。请重试保存，或继续编辑并导出备份。</p><div class="settings-actions"><button class="btn secondary" id="editor-stay">继续编辑</button><button class="btn secondary" id="editor-discard">放弃本次修改并离开</button><button class="btn primary" id="editor-save-leave">重试保存并离开</button></div>`);
 if($('#editor-stay'))$('#editor-stay').onclick=()=>$('#workspace-dialog')?.close();
 if($('#editor-discard'))$('#editor-discard').onclick=()=>{if(s!==editor)return;s.original=snapshot(s);cancelTimer(s);$('#workspace-dialog')?.close();action();};
 if($('#editor-save-leave'))$('#editor-save-leave').onclick=()=>{if(s===editor&&persist(s)){$('#workspace-dialog')?.close();action();}};
 return false;
}
export function editorRouteGuard(target){return leave(()=>{location.hash=target;});}
export function registerEditor({label,getValue,save,saveDraft,busy=()=>false,dispose,ctx={}}){
 clearEditor();
 const doc=document,win=doc.defaultView||window,root=doc.querySelector('.dashboard')||doc;
 const s={label,getValue,save,saveDraft,busy,dispose,ctx,doc,win,timer:null,failed:false,original:JSON.stringify(getValue())};editor=s;
 const queue=()=>schedule(s);
 const unload=e=>{if(s===editor&&!persist(s)){e.preventDefault();e.returnValue='';}};
 const hide=()=>{if(s===editor&&doc.hidden&&!s.busy())persist(s);};
 const pagehide=()=>{if(s===editor&&!s.busy())persist(s);};
 const outbound=e=>{
  const a=e.target?.closest?.('a[href]');if(s!==editor||!a||a.target==='_blank'||a.hasAttribute('download')||e.button>0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||!editorHasWork())return;
  const href=a.getAttribute('href');if(!href||href.startsWith('#'))return;
  const destination=new URL(a.href,win.location.href);
  if(destination.origin===win.location.origin&&destination.pathname===win.location.pathname&&destination.search===win.location.search&&destination.hash!==win.location.hash)return;
  if(!leave(()=>{win.location.href=destination.href;})){e.preventDefault();e.stopImmediatePropagation();}
 };
 root.addEventListener('input',queue);root.addEventListener('change',queue);root.addEventListener('click',queue);
 win.addEventListener('beforeunload',unload);win.addEventListener('pagehide',pagehide);doc.addEventListener('visibilitychange',hide);doc.addEventListener('click',outbound,true);
 s.cleanup=()=>{root.removeEventListener('input',queue);root.removeEventListener('change',queue);root.removeEventListener('click',queue);win.removeEventListener('beforeunload',unload);win.removeEventListener('pagehide',pagehide);doc.removeEventListener('visibilitychange',hide);doc.removeEventListener('click',outbound,true);};
}
