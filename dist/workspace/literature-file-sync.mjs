import {literatureKey} from './literature-model.mjs';

export const fileDeletedEvent='paperknow:file-deleted';
export const fileChangeKey='paperknow-file-change';
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
export function savedLiterature(win=window){try{const rows=JSON.parse(win.localStorage.getItem(literatureKey)||'[]');return Array.isArray(rows)?rows:[];}catch{return [];}}
export function removeLiteratureRecords(ids,{win=window}={}){
 const selected=new Set(ids),before=win.localStorage.getItem(literatureKey),rows=savedLiterature(win),removed=rows.filter(row=>selected.has(row.id));
 if(!removed.length)return [];
 const value=JSON.stringify(rows.filter(row=>!selected.has(row.id)));win.localStorage.setItem(literatureKey,value);
 win.dispatchEvent(new win.StorageEvent('storage',{key:literatureKey,oldValue:before,newValue:value,storageArea:win.localStorage}));
 return removed.map(row=>row.id);
}
export function removeLiteratureForFiles(ownerId,fileIds,{win=window}={}){
 if(!validId(ownerId))return [];const files=new Set(fileIds.filter(validId));
 return removeLiteratureRecords(savedLiterature(win).filter(row=>row.originalOwnerId===ownerId&&files.has(row.originalFileId)).map(row=>row.id),{win});
}
export function publishFileDeleted({ownerId,fileId,kind='original'},{win=window}={}){
 if(!validId(ownerId)||!validId(fileId)||!['original','artifact'].includes(kind))return;
 const detail={ownerId,fileId,kind,at:Date.now(),nonce:win.crypto.randomUUID()};
 // Notify previews before removing reading entries, so disposed PDF viewers
 // cannot leave a reusable private byte cache behind.
 win.dispatchEvent(new win.CustomEvent(fileDeletedEvent,{detail}));
 try{win.localStorage.setItem(fileChangeKey,JSON.stringify(detail));}catch{}
 // The server has already confirmed deletion. A full browser store must not
 // turn that success into a failed remote operation; reconciliation retries it.
 if(kind==='original')try{removeLiteratureForFiles(ownerId,[fileId],{win});}catch{}
}
export function subscribeFileDeletions(win,callback){
 const receive=value=>{if(value&&validId(value.ownerId)&&validId(value.fileId)&&['original','artifact'].includes(value.kind))callback(value);};
 const local=event=>receive(event.detail),remote=event=>{if(event.key!==fileChangeKey||!event.newValue)return;try{receive(JSON.parse(event.newValue));}catch{}};
 win.addEventListener(fileDeletedEvent,local);win.addEventListener('storage',remote);
 return ()=>{win.removeEventListener(fileDeletedEvent,local);win.removeEventListener('storage',remote);};
}
export async function reconcileLiteratureDeletions({win=window,fetchImpl=(...args)=>fetch(...args),signal,isCurrent=()=>true}={}){
 const linked=savedLiterature(win).filter(row=>validId(row.originalOwnerId)&&validId(row.originalFileId));if(!linked.length)return [];
 const deadline=win.AbortSignal.timeout(15000),combined=signal?win.AbortSignal.any([signal,deadline]):deadline;
 const current=()=>!combined.aborted&&isCurrent();
 async function api(path,body,owner){
  if(!current())throw Object.assign(Error('页面已关闭'),{name:'AbortError'});
  const response=await fetchImpl('/api'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:combined,headers:{...(body?{'Content-Type':'application/json'}:{}),...(owner?{'X-PaperKnow-User':owner}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json();if(!response.ok)throw Error('文献删除状态暂时无法同步');return value;
 }
 const session=await api('/auth/me'),owner=session.user?.id;if(!current()||!validId(owner))return [];
 const fileIds=[...new Set(linked.filter(row=>row.originalOwnerId===owner).map(row=>row.originalFileId))];if(!fileIds.length)return [];
 const result=await api('/files/deletions/check',{expectedUserId:owner,fileIds},owner);
 if(!current()||result.ownerId!==owner||!Array.isArray(result.deletedIds)||result.deletedIds.some(id=>!fileIds.includes(id)))return [];
 const checked=await api('/auth/me',undefined,owner);if(!current()||checked.user?.id!==owner)return [];
 return removeLiteratureForFiles(owner,result.deletedIds,{win});
}
