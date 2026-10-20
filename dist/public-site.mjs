const $=selector=>document.querySelector(selector);
const nav=$('#main-nav'),menu=$('#mobile-menu'),header=$('.product-header');
const icons={menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',arrow:'<path d="M4 12h15m-5-5 5 5-5 5"/>',download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',crown:'<path d="m3 6 4 4 5-6 5 6 4-4-3 13H6zM7 22h10"/>'};
document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[el.dataset.icon]||icons.arrow}</svg>`;});
const category=document.body.dataset.category;
if(category)nav.querySelector(`[data-research-category="${category}"]`)?.classList.add('nav-active');
function closeMenu(restoreFocus=false){const open=nav.classList.contains('mobile-open');nav.classList.remove('mobile-open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','打开菜单');if(open&&restoreFocus)menu.focus();}
menu.addEventListener('click',()=>{const open=nav.classList.toggle('mobile-open');menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'收起菜单':'打开菜单');});
document.addEventListener('click',event=>{if(!event.target.closest('.product-header')||event.target.closest('.product-header a'))closeMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu(true);});
function positionLine(link){if(!link){nav.style.setProperty('--nav-line-width','0px');return;}const label=link.querySelector('.nav-link-label')||link,r=label.getBoundingClientRect(),parent=nav.getBoundingClientRect();nav.style.setProperty('--nav-line-width',`${r.width}px`);nav.style.setProperty('--nav-line-x',`${r.left-parent.left+nav.scrollLeft}px`);}
const selected=()=>nav.querySelector('.nav-active');
nav.addEventListener('pointerover',event=>{const link=event.target.closest('a');if(link)positionLine(link);});
nav.addEventListener('focusin',event=>{const link=event.target.closest('a');if(link)positionLine(link);});
nav.addEventListener('pointerleave',()=>positionLine(selected()));
nav.addEventListener('focusout',event=>{if(!nav.contains(event.relatedTarget))positionLine(selected());});
window.addEventListener('resize',()=>positionLine(selected()));
document.fonts?.ready?.then(()=>positionLine(selected()));
const syncScroll=()=>header.classList.toggle('is-scrolled',window.scrollY>8);
window.addEventListener('scroll',syncScroll,{passive:true});syncScroll();
let signedIn=false;
$('#account-button').addEventListener('click',()=>{location.href=signedIn?'/workspace.html#home':'/auth.html?mode=login';});
try{const response=await fetch('/api/auth/me',{credentials:'same-origin'});if(response.ok){const {user}=await response.json();if(user){signedIn=true;$('#account-button').textContent='我的账户';$('#account-button').setAttribute('aria-label','进入我的账户工作台');$('#header-start').href='/workspace.html#home';$('#header-start').textContent='进入工作台 →';}}}catch{/* Public reading and tool links remain available offline. */}
