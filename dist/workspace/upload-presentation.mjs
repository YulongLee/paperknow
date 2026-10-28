import {icon} from './ui.mjs';

const zones='label.revision-product-upload,label.revision-report-upload,label.analysis-upload,label.det-upload,label.document-service-upload,label.ppt-mode-drop,label.ppt-drop,label.research-drop,label.knowledge-dropzone,label.rdc-literature-upload,label.lit-upload,label.format-source-drop,label.web-similarity-file,label.drop-zone';
const mimeExtensions={'application/pdf':'PDF','text/plain':'TXT','text/csv':'CSV','text/tab-separated-values':'TSV','application/json':'JSON','application/zip':'ZIP','text/html':'HTML','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'DOCX','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'XLSX','image/png':'PNG','image/jpeg':'JPG','image/webp':'WebP','image/*':'图片'};
export function uploadFormatLabel(accept=''){
 return [...new Set(String(accept).split(',').map(part=>part.trim().toLowerCase()).map(part=>part.startsWith('.')?part.slice(1).toUpperCase():mimeExtensions[part]).filter(Boolean))].join(' · ');
}
export function uploadFileSize(bytes){
 const value=Math.max(0,Number(bytes)||0);
 return value>=1048576?(value/1048576).toFixed(1)+' MB':value>=1024?Math.ceil(value/1024)+' KB':value+' B';
}

// Presentation only. Keep the original input, its validators, native picker,
// keyboard behaviour and change handlers; never read or submit file contents.
export function installUploadPresentation(root){
 const doc=root.ownerDocument,win=doc.defaultView,records=new WeakMap();
 function refresh(input){
  const view=records.get(input);if(!view)return;
  const files=Array.from(input.files||[]),file=files[0],selected=!!file;
  view.host.classList.toggle('pk-has-file',selected);
  view.host.classList.toggle('pk-upload-disabled',input.disabled);
  view.action.textContent=input.disabled?'暂不可选':selected?'重新选择':'选择文件';
  if(view.zone){
   view.selection.hidden=!selected;
   view.name.textContent=selected?file.name+(files.length>1?' 等 '+files.length+' 个文件':''):'';
   view.size.textContent=selected?uploadFileSize(files.reduce((sum,row)=>sum+row.size,0)):'';
   view.name.title=selected?files.map(row=>row.name).join('\n'):'';
  }else{
   view.name.textContent=selected?file.name+(files.length>1?' 等 '+files.length+' 个文件':''):'点击选择文件';
   view.name.title=selected?files.map(row=>row.name).join('\n'):'';
   view.size.textContent=selected?uploadFileSize(files.reduce((sum,row)=>sum+row.size,0)):(uploadFormatLabel(input.accept)||'选择当前功能需要的材料');
  }
 }
 function decorate(input){
  if(records.has(input)){refresh(input);return;}
  // Existing button-triggered inputs must stay hidden, including outline and
  // template uploads. Do not create a second entry for them.
  const label=input.closest('label'),zone=label?.matches(zones)?label:null;
  if(input.hidden||input.matches('.ppt-inline-file,[data-upload-presentation="off"]'))return;
  // Button-shaped upload labels already have their own visible action. Keep
  // their native input over that action rather than nesting a second picker.
  if(!zone&&label?.matches('.btn,.format-upload')){
   label.classList.add('pk-upload-button');input.classList.add('pk-upload-button-native');return;
  }
  if(!input.hasAttribute('aria-label')&&!input.labels?.length)input.setAttribute('aria-label','选择文件');
  input.classList.add('pk-upload-native');
  let host,action,name,size,selection;
  if(zone){
   host=zone;host.classList.add('pk-upload-zone');
   let symbol=Array.from(host.children).find(node=>node!==input&&(node.matches('svg')||node.matches('[class*=icon],[class*=symbol]')));
   if(!symbol){symbol=doc.createElement('span');symbol.innerHTML=icon('upload',24);host.prepend(symbol);}
   else if(symbol.matches('svg')){const wrapper=doc.createElement('span');symbol.replaceWith(wrapper);wrapper.append(symbol);symbol=wrapper;}
   symbol.classList.add('pk-upload-symbol');symbol.setAttribute('aria-hidden','true');
   host.querySelector('b,strong')?.classList.add('pk-upload-title');
   action=doc.createElement('span');action.className='pk-upload-action';action.setAttribute('aria-hidden','true');
   selection=doc.createElement('span');selection.className='pk-upload-selection';selection.setAttribute('aria-hidden','true');
   name=doc.createElement('span');name.className='pk-upload-name';size=doc.createElement('small');size.className='pk-upload-size';
   selection.append(name,size);host.append(action,selection);
  }else{
   host=doc.createElement('span');host.className='pk-file-control';
   const visual=doc.createElement('span');visual.className='pk-file-visual';visual.setAttribute('aria-hidden','true');
   const symbol=doc.createElement('span');symbol.className='pk-file-symbol';symbol.innerHTML=icon('file',21);
   const copy=doc.createElement('span');copy.className='pk-file-copy';
   name=doc.createElement('span');name.className='pk-upload-name';size=doc.createElement('small');size.className='pk-upload-size';copy.append(name,size);
   action=doc.createElement('span');action.className='pk-file-action';visual.append(symbol,copy,action);
   input.before(host);host.append(visual,input);
  }
  records.set(input,{host,zone:!!zone,action,name,size,selection});refresh(input);
 }
 function scan(node){
  if(node.nodeType!==1)return;
  if(node.matches('input[type=file]'))decorate(node);
  for(const input of node.querySelectorAll('input[type=file]'))decorate(input);
 }
 function changed(event){if(event.target.matches?.('input[type=file]'))refresh(event.target);}
 function reset(event){win.queueMicrotask(()=>{for(const input of event.target.querySelectorAll('input[type=file]'))refresh(input);});}
 scan(root);
 const observer=new win.MutationObserver(changes=>{
  for(const change of changes){
   if(change.type==='attributes'){if(change.target.matches('input[type=file]'))decorate(change.target);}
   else for(const node of change.addedNodes)scan(node);
  }
 });
 observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','disabled','accept','type']});
 root.addEventListener('change',changed,true);root.addEventListener('reset',reset,true);
 return {dispose(){observer.disconnect();root.removeEventListener('change',changed,true);root.removeEventListener('reset',reset,true);}};
}
