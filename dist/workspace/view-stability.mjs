// Run synchronous view updates in place. Capture at render time, never before an async request.
const views=new WeakMap();
const focusable='input,textarea,select,button,a[href],[tabindex],[contenteditable="true"]';
const position=win=>({x:Number(win.scrollX)||0,y:Number(win.scrollY)||0});
function identity(node,root){
 if(!node||!root.contains(node)||!node.matches?.(focusable))return null;
 const tag=node.tagName,id=node.id,name=node.getAttribute('name');
 const data=[...node.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]);
 if(!id&&!name&&!data.length)return null;
 return {node,tag,id,name,data,label:/^(BUTTON|A)$/.test(tag)?node.textContent.trim():null,
  type:node.getAttribute('type'),start:node.selectionStart,end:node.selectionEnd,direction:node.selectionDirection,
  top:node.scrollTop,left:node.scrollLeft};
}
function replacement(saved,root){
 if(saved.node.isConnected&&root.contains(saved.node))return saved.node;
 const candidates=[...root.querySelectorAll(focusable)].filter(node=>node.tagName===saved.tag&&
  (saved.id?node.id===saved.id:saved.name?node.getAttribute('name')===saved.name:saved.data.length>0)&&
  node.getAttribute('type')===saved.type&&saved.data.every(([key,value])=>node.getAttribute(key)===value));
 if(candidates.length===1)return candidates[0];
 const labelled=candidates.filter(node=>saved.label!==null&&node.textContent.trim()===saved.label);
 return labelled.length===1?labelled[0]:null;
}
function keepFocus(saved,root){
 if(!saved)return;
 const doc=root.ownerDocument,active=doc.activeElement;
 if(active===saved.node&&saved.node.isConnected&&root.contains(saved.node))return;
 // Do not steal focus from a dialog or a control deliberately focused by the update.
 if(active&&active!==saved.node&&active!==doc.body&&active!==doc.documentElement)return;
 const node=replacement(saved,root);
 if(!node||node.disabled||node.closest('[hidden],[inert]')||node.getAttribute('aria-hidden')==='true')return;
 if(doc.activeElement!==node)node.focus({preventScroll:true});
 if(Number.isInteger(saved.start)&&typeof node.setSelectionRange==='function'){
  try{node.setSelectionRange(saved.start,saved.end,saved.direction||'none');}catch{}
 }
 node.scrollTop=saved.top;node.scrollLeft=saved.left;
}
function nestedScroll(root){
 return [...root.querySelectorAll('[id],[data-scroll-key],[role="tablist"],.writing-process-guide ol')]
  .filter(node=>node.scrollTop||node.scrollLeft)
  .map(node=>({node,id:node.id,key:node.getAttribute('data-scroll-key'),role:node.getAttribute('role'),
   path:node.className,tag:node.tagName,top:node.scrollTop,left:node.scrollLeft}));
}
function restoreNested(rows,root){
 for(const row of rows){
  const node=row.node.isConnected&&root.contains(row.node)?row.node:[...root.querySelectorAll('[id],[data-scroll-key],[role="tablist"],.writing-process-guide ol')]
   .find(n=>n.tagName===row.tag&&(row.id?n.id===row.id:row.key?n.getAttribute('data-scroll-key')===row.key:n.getAttribute('role')===row.role&&n.className===row.path));
  if(node){node.scrollTop=row.top;node.scrollLeft=row.left;}
 }
}
function reserve(root,win){
 let state=views.get(root);
 if(!state){const cssMin=win.getComputedStyle?.(root).minHeight||'0px';state={min:root.style.minHeight,anchor:root.style.overflowAnchor,cssMin:/^(auto|none|min-content|max-content|fit-content|stretch)$/.test(cssMin)?'0px':cssMin};views.set(root,state);}
 const floor=Math.max(0,Math.ceil((Number(win.innerHeight)||0)-root.getBoundingClientRect().top));
 // Reserve only the current viewport, not the previous list's full height.
 root.style.minHeight=`max(${state.min||state.cssMin||'0px'}, ${floor}px)`;
 root.style.overflowAnchor='none';
}
export function resetStableView(root){
 const state=root&&views.get(root);if(!state)return;
 root.style.minHeight=state.min;root.style.overflowAnchor=state.anchor;views.delete(root);
}
export function withStableView(root,update,{restoreFocus=true}={}){
 const win=root?.ownerDocument?.defaultView;
 if(!root?.isConnected||!win)return update();
 const before=position(win),saved=restoreFocus?identity(root.ownerDocument.activeElement,root):null,rows=nestedScroll(root);
 reserve(root,win);
 try{return update();}
 finally{
  if(root.isConnected){
   restoreNested(rows,root);keepFocus(saved,root);
   const after=position(win);
   if(Math.abs(after.x-before.x)>.5||Math.abs(after.y-before.y)>.5)win.scrollTo({left:before.x,top:before.y,behavior:'instant'});
  }
 }
}

// A surface is one feature. Parameters and its tabs may change without becoming a new page.
export function workspaceSurface(hash=''){
 const value=String(hash).replace(/^#/,''),[path]=value.split('?'),parts=path.split('/'),[route,id]=parts;
 if(route==='category'||route==='tool')return route+'/'+(id||'');
 if(['project','draft','account-draft','thesis','literature'].includes(route))return route+'/'+(id||'');
 if(route==='membership'&&(id==='pay'||id==='checkout'))return route+'/'+id;
 return route||'home';
}
export const keepsWorkspacePosition=(before,after)=>before!==null&&before!==undefined&&workspaceSurface(before)===workspaceSurface(after);

export function installStableDisclosures(root){
 const doc=root.ownerDocument;
 const click=event=>{
  if(event.defaultPrevented||event.button>0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
  const summary=event.target.closest?.('summary'),details=summary?.parentElement;
  if(!summary||!root.contains(summary)||details?.tagName!=='DETAILS'||details.querySelector('summary')!==summary)return;
  if(event.target.closest('a,button,input,select,textarea,[contenteditable="true"]'))return;
  event.preventDefault();withStableView(root,()=>{details.open=!details.open;},{restoreFocus:false});
 };
 doc.addEventListener('click',click);return ()=>doc.removeEventListener('click',click);
}
