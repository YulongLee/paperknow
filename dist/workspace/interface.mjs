// Shared interaction primitives for workspace and report pages.
export function mountNavigation({sidebar,toggle,backdrop,main,media=window.matchMedia('(max-width:760px)'),desktop}){
 let open=false,collapsed=false,width=256,drag=null;
 const root=desktop?.root,handle=desktop?.handle,collapse=desktop?.collapse,keyName='paperknow.navigation';
 const limit=value=>Math.max(240,Math.min(360,Number.isFinite(value)?value:256));
 if(desktop)try{const saved=JSON.parse(window.localStorage.getItem(keyName)||'{}');width=limit(saved.width);collapsed=saved.collapsed===true;}catch{}
 const save=()=>{if(desktop)try{window.localStorage.setItem(keyName,JSON.stringify({width,collapsed}));}catch{}};
 sidebar.id ||= 'workspace-navigation';toggle.setAttribute('aria-controls',sidebar.id);
 const apply=()=>{
  const hidden=media.matches?!open:!!desktop&&collapsed;
  sidebar.classList.toggle('mobile-open',open&&media.matches);sidebar.inert=hidden;main.inert=media.matches&&open;
  toggle.setAttribute('aria-expanded',String(desktop?!hidden:media.matches&&open));
  if(backdrop)backdrop.hidden=!(media.matches&&open);
  if(desktop){
   root.classList.toggle('navigation-hidden',collapsed);root.style.setProperty('--navigation-width',Math.min(width,Math.max(240,window.innerWidth-480))+'px');
   toggle.setAttribute('aria-label',hidden?'展开菜单':'收起菜单');toggle.title=hidden?'展开菜单':'收起菜单';
   if(collapse){collapse.setAttribute('aria-label',media.matches?'关闭菜单':'收起菜单');collapse.title=media.matches?'关闭菜单':'收起菜单';}
   if(handle){handle.setAttribute('aria-valuenow',String(width));handle.setAttribute('aria-valuetext',width+' 像素');handle.tabIndex=media.matches||collapsed?-1:0;}
  }
 };
 const close=()=>{const inside=sidebar.contains(document.activeElement);open=false;apply();if(inside&&media.matches)toggle.focus();};
 const toggleOpen=()=>{if(!media.matches&&desktop){collapsed=!collapsed;save();apply();if(collapsed)toggle.focus();return;}open=!open;apply();if(open&&media.matches)sidebar.querySelector('a,button')?.focus();};
 const collapseMenu=()=>{if(media.matches){close();return;}collapsed=true;save();apply();toggle.focus();};
 const key=e=>{if(!media.matches)return;if(e.key==='Escape'&&open){e.preventDefault();close();}if(e.key==='Tab'&&open){const items=[...sidebar.querySelectorAll('a[href],button:not(:disabled)')].filter(el=>!el.hidden);if(!items.length)return;const first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||!sidebar.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||!sidebar.contains(document.activeElement))){e.preventDefault();first.focus();}}};
 const finish=e=>{if(!drag||e&&e.pointerId!==drag.id)return;const id=drag.id;drag=null;root?.classList.remove('navigation-resizing');if(handle?.hasPointerCapture?.(id))handle.releasePointerCapture(id);save();};
 const start=e=>{if(media.matches||collapsed||e.button!==0)return;e.preventDefault();drag={id:e.pointerId,x:e.clientX,width};handle.setPointerCapture?.(e.pointerId);handle.focus();root.classList.add('navigation-resizing');};
 const move=e=>{if(!drag||e.pointerId!==drag.id)return;width=limit(drag.width+e.clientX-drag.x);apply();};
 const resizeKey=e=>{if(media.matches||collapsed)return;const steps={ArrowLeft:-16,ArrowRight:16};if(e.key in steps){width=limit(width+steps[e.key]);}else if(e.key==='Home')width=240;else if(e.key==='End')width=360;else return;e.preventDefault();save();apply();};
 const resetWidth=()=>{width=256;save();apply();};
 const resize=()=>{finish();open=false;apply();if(sidebar.inert&&sidebar.contains(document.activeElement))toggle.focus();};
 const windowResize=()=>{if(desktop)apply();};
 toggle.addEventListener('click',toggleOpen);collapse?.addEventListener('click',collapseMenu);backdrop?.addEventListener('click',close);document.addEventListener('keydown',key);media.addEventListener('change',resize);window.addEventListener('resize',windowResize);
 handle?.addEventListener('pointerdown',start);handle?.addEventListener('pointermove',move);handle?.addEventListener('pointerup',finish);handle?.addEventListener('pointercancel',finish);handle?.addEventListener('lostpointercapture',finish);handle?.addEventListener('keydown',resizeKey);handle?.addEventListener('dblclick',resetWidth);apply();
 return {close,dispose(){finish();toggle.removeEventListener('click',toggleOpen);collapse?.removeEventListener('click',collapseMenu);backdrop?.removeEventListener('click',close);document.removeEventListener('keydown',key);media.removeEventListener('change',resize);window.removeEventListener('resize',windowResize);for(const [event,fn] of [['pointerdown',start],['pointermove',move],['pointerup',finish],['pointercancel',finish],['lostpointercapture',finish],['keydown',resizeKey],['dblclick',resetWidth]])handle?.removeEventListener(event,fn);main.inert=false;}};
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
export const workspaceLinks=[['工作空间',[['home','工作台','grid'],['projects','我的项目','folder'],['assets','我的成果','file'],['tasks','任务中心','clock']]],['论文与科研',[['category/writing','AI 写作','pen'],['category/literature','文献与研读','book'],['category/revision','修改与润色','pen'],['category/detection','论文检测','shield'],['category/ppt','PPT 创作','chart'],['category/research','科研工具','chart'],['category/format','格式排版','file'],['category/more','更多工具','grid']]],['个人与服务',[['membership','会员与用量','diamond'],['settings','设置中心','settings'],['help','帮助与反馈','help']]]];

// Hash events can queue up during rapid navigation; only the current destination may render.
export const isCurrentRouteChange=(event,url)=>event.newURL===url;
