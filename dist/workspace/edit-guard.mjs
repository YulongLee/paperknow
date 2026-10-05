// Shared protection for writing, structure templates and literature notes.
let editor=null;
const $=s=>document.querySelector(s);
export function clearEditor(){editor?.dispose?.();editor=null;}
export function registerEditor({label,getValue,save,busy=()=>false,dispose,ctx}){clearEditor();editor={label,getValue,save,busy,dispose,ctx,original:JSON.stringify(getValue())};}
export const editorHasWork=()=>!!editor&&(editor.busy()||JSON.stringify(editor.getValue())!==editor.original);
export function markEditorSaved(){if(editor)editor.original=JSON.stringify(editor.getValue());}
function leave(action){const s=editor;if(!s)return true;if(s.busy()){s.ctx.notify('正在本地解析，请等待完成后再离开。');return false;}if(JSON.stringify(s.getValue())===s.original)return true;s.ctx.modal(s.label+'尚未保存',`<p class="hub-description">离开前可以保存当前内容。保存失败时会保留编辑，不会自动离开。</p><div class="settings-actions"><button class="btn secondary" id="editor-stay">继续编辑</button><button class="btn secondary" id="editor-discard">放弃修改</button><button class="btn primary" id="editor-save-leave">保存并离开</button></div>`);$('#editor-stay').onclick=()=>$('#workspace-dialog').close();$('#editor-discard').onclick=()=>{s.original=JSON.stringify(s.getValue());$('#workspace-dialog').close();action();};$('#editor-save-leave').onclick=()=>{s.save();if(!editorHasWork()){$('#workspace-dialog').close();action();}};return false;}
export function editorRouteGuard(target){return leave(()=>{location.hash=target;});}
window.addEventListener('beforeunload',e=>{if(editorHasWork()){e.preventDefault();e.returnValue='';}});
document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a||a.target==='_blank'||a.hasAttribute('download')||!editorHasWork())return;const href=a.getAttribute('href');if(!href||href.startsWith('#'))return;const destination=new URL(a.href,location.href);if(destination.origin===location.origin&&destination.pathname===location.pathname&&destination.search===location.search&&destination.hash!==location.hash)return;e.preventDefault();e.stopImmediatePropagation();leave(()=>{location.href=destination.href;});},true);
