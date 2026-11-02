// A single, accessible confirmation for the selected batch. No service routing
// or provider diagnostics belong in this customer-facing dialog.
export function confirmDocumentImport(message,{documentObject=globalThis.document}={}){
 const doc=documentObject,win=doc?.defaultView;
 if(!doc?.body||!win)return Promise.resolve(false);
 if(!doc.querySelector('link[data-document-import-confirm-style]')){const link=doc.createElement('link');link.rel='stylesheet';link.href='/workspace/document-import-confirm.css';link.dataset.documentImportConfirmStyle='';doc.head.append(link);}
 return new Promise(resolve=>{
  const previous=doc.activeElement,dialog=doc.createElement('dialog');dialog.className='document-import-confirm';dialog.setAttribute('aria-labelledby','document-import-confirm-title');
  const brand=doc.createElement('span');brand.className='document-import-confirm-brand';brand.textContent='PAPERKNOW · 文件处理';
  const heading=doc.createElement('h2');heading.id='document-import-confirm-title';
  const [title,...paragraphs]=String(message).split(/\n\s*\n/);heading.textContent=title;
  const body=doc.createElement('div');body.className='document-import-confirm-body';for(const text of paragraphs){const p=doc.createElement('p');p.textContent=text;body.append(p);}
  const policy=doc.createElement('p');policy.className='document-import-confirm-policy';policy.append('点击开始处理，即表示你有权使用所选文件，并同意按');const link=doc.createElement('a');link.href='/privacy/';link.target='_blank';link.rel='noopener';link.textContent='隐私政策';policy.append(link,'处理文件。');
  const actions=doc.createElement('div');actions.className='document-import-confirm-actions';const cancel=doc.createElement('button'),start=doc.createElement('button');cancel.type=start.type='button';cancel.className='btn secondary';start.className='btn primary';cancel.textContent='取消';start.textContent='开始处理';actions.append(cancel,start);dialog.append(brand,heading,body,policy,actions);
  let settled=false;const finish=accepted=>{if(settled)return;settled=true;win.removeEventListener('hashchange',leave);dialog.remove();if(previous?.isConnected&&!doc.querySelector('dialog[open]'))previous.focus?.({preventScroll:true});resolve(accepted);};const leave=()=>finish(false);
  cancel.onclick=()=>finish(false);start.onclick=()=>finish(true);dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});dialog.addEventListener('close',()=>finish(false));win.addEventListener('hashchange',leave,{once:true});doc.body.append(dialog);
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');cancel.focus({preventScroll:true});
 });
}
