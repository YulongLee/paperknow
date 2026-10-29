const key='paperknow-reading-layout-v1';
export function mountReadingLayout(studio,{signal}={}){
 const doc=studio.ownerDocument,win=doc.defaultView,columns=studio.querySelector('.lit-reader-columns'),widthHandle=studio.querySelector('[data-reader-divider]'),heightHandle=studio.querySelector('[data-reader-height]');
 let ratio=60,height=null,drag=null,frame=null,live=true;
 try{const value=JSON.parse(win.localStorage.getItem(key));if(Number.isFinite(value?.ratio))ratio=Math.max(35,Math.min(75,value.ratio));if(Number.isFinite(value?.height))height=Math.max(420,Math.min(1600,value.height));}catch{}
 const save=()=>{try{win.localStorage.setItem(key,JSON.stringify({ratio,height}));}catch{}};
 function apply(){studio.style.setProperty('--lit-source-track',ratio+'fr');studio.style.setProperty('--lit-assistant-track',(100-ratio)+'fr');if(height)studio.style.setProperty('--lit-reading-height',height+'px');widthHandle?.setAttribute('aria-valuenow',String(Math.round(ratio)));widthHandle?.setAttribute('aria-valuetext','原文 '+Math.round(ratio)+'%，AI 助手 '+Math.round(100-ratio)+'%');heightHandle?.setAttribute('aria-valuenow',String(Math.round(height||columns.getBoundingClientRect().height)));}
 function finish(){if(!drag)return;drag=null;studio.classList.remove('is-resizing');doc.body.classList.remove('lit-layout-dragging');save();}
 function move(event){if(!drag)return;const rect=columns.getBoundingClientRect();if(drag==='width')ratio=Math.max(35,Math.min(75,(event.clientX-rect.left)/Math.max(1,rect.width)*100));else height=Math.max(420,Math.min(1600,event.clientY-rect.top));if(frame===null)frame=win.requestAnimationFrame(()=>{frame=null;if(live)apply();});}
 const listen=(node,event,fn)=>node?.addEventListener(event,fn,{signal});
 for(const [handle,type]of [[widthHandle,'width'],[heightHandle,'height']]){
  if(!handle)continue;
  listen(handle,'pointerdown',event=>{if(event.button!==0||win.innerWidth<1000)return;event.preventDefault();drag=type;studio.classList.add('is-resizing');doc.body.classList.add('lit-layout-dragging');handle.setPointerCapture?.(event.pointerId);});
  listen(handle,'keydown',event=>{const change=['ArrowLeft','ArrowUp'].includes(event.key)?-1:['ArrowRight','ArrowDown'].includes(event.key)?1:0;if(!change)return;event.preventDefault();if(type==='width')ratio=Math.max(35,Math.min(75,ratio+change*(event.shiftKey?5:2)));else height=Math.max(420,Math.min(1600,(height||columns.getBoundingClientRect().height)+change*(event.shiftKey?100:40)));apply();save();});
  listen(handle,'dblclick',()=>{if(type==='width')ratio=60;else{height=null;studio.style.removeProperty('--lit-reading-height');win.dispatchEvent(new win.Event('resize'));}apply();save();});
 }
 listen(win,'pointermove',move);listen(win,'pointerup',finish);listen(win,'pointercancel',finish);
 listen(studio.querySelector('[data-reader-layout-reset]'),'click',()=>{ratio=60;height=null;studio.style.removeProperty('--lit-reading-height');apply();save();win.dispatchEvent(new win.Event('resize'));});
 heightHandle?.setAttribute('aria-valuemin','420');heightHandle?.setAttribute('aria-valuemax','1600');apply();
 const dispose=()=>{finish();live=false;if(frame!==null)win.cancelAnimationFrame(frame);};signal?.addEventListener('abort',dispose,{once:true});
 return {hasCustomHeight:()=>height!==null,dispose};
}
