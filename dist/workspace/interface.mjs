// Shared interaction primitives for workspace and report pages.
export function mountNavigation({sidebar,toggle,backdrop,main,media=window.matchMedia('(max-width:760px)')}){
 let open=false;
 sidebar.id ||= 'workspace-navigation';toggle.setAttribute('aria-controls',sidebar.id);
 const apply=()=>{sidebar.classList.toggle('mobile-open',open&&media.matches);sidebar.inert=media.matches&&!open;main.inert=media.matches&&open;toggle.setAttribute('aria-expanded',String(media.matches&&open));if(backdrop)backdrop.hidden=!(media.matches&&open);};
 const close=()=>{const inside=sidebar.contains(document.activeElement);open=false;apply();if(inside&&media.matches)toggle.focus();};
 const toggleOpen=()=>{open=!open;apply();if(open&&media.matches)sidebar.querySelector('a,button')?.focus();};
 const key=e=>{if(!media.matches)return;if(e.key==='Escape'&&open){e.preventDefault();close();}if(e.key==='Tab'&&open){const items=[...sidebar.querySelectorAll('a[href],button:not(:disabled)')].filter(el=>!el.hidden);if(!items.length)return;const first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||!sidebar.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||!sidebar.contains(document.activeElement))){e.preventDefault();first.focus();}}};
 const resize=()=>{open=false;apply();if(media.matches&&sidebar.contains(document.activeElement))toggle.focus();};
 toggle.addEventListener('click',toggleOpen);backdrop?.addEventListener('click',close);document.addEventListener('keydown',key);media.addEventListener('change',resize);apply();
 return {close,dispose(){toggle.removeEventListener('click',toggleOpen);backdrop?.removeEventListener('click',close);document.removeEventListener('keydown',key);media.removeEventListener('change',resize);main.inert=false;}};
}
function formValue(form){return JSON.stringify([...form.elements].filter(e=>e.name||e.id).map(e=>[e.name||e.id,e.type==='checkbox'||e.type==='radio'?e.checked:e.type==='file'?[...e.files].map(f=>[f.name,f.size,f.lastModified]):e.value]));}
export function trackDialogForm(dialog){
 const form=dialog.querySelector('form:not([data-unprotected])');const baseline=form?formValue(form):'';
 return ()=>{
 if(!form||formValue(form)===baseline){dialog.close();return;}
 const existing=dialog.querySelector('.dialog-leave-confirm');if(existing){existing.querySelector('button').focus();return;}
 const box=document.createElement('section');box.className='dialog-leave-confirm';box.setAttribute('role','alert');box.innerHTML='<b>填写内容尚未保存</b><p>关闭后会丢弃当前输入。你可以继续填写。</p><div><button type="button" class="btn primary">继续填写</button><button type="button" class="btn secondary">放弃输入并关闭</button></div>';
 const previous=document.activeElement;box.querySelectorAll('button')[0].onclick=()=>{box.remove();previous?.focus();};box.querySelectorAll('button')[1].onclick=()=>dialog.close();dialog.append(box);box.querySelector('button').focus();
 };
}
export const workspaceLinks=[['工作空间',[['home','工作台首页','grid'],['projects','我的项目','folder'],['assets','我的成果','file'],['tasks','任务中心','clock']]],['论文与科研',[['category/writing','AI 写作','pen'],['category/literature','文献与研读','book'],['category/revision','修改与润色','pen'],['category/detection','论文检测','shield'],['category/ppt','PPT 创作','chart'],['category/research','科研工具','chart'],['category/format','格式排版','file'],['category/more','更多工具','grid']]],['个人与服务',[['membership','会员与用量','diamond'],['settings','设置中心','settings'],['help','帮助与反馈','help']]]];
