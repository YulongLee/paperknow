import {installStateStore} from './state.mjs';
import {literatureKey} from './literature-model.mjs';

// Browser storage is an account-bound retry journal, never the library authority.
export function createLiteratureAccountStore({win=window,fetchImpl=(...args)=>fetch(...args)}={}){
 let scope=null,serial=0,timer=null,sessionStatus='loading';
 const key=owner=>'paperknow-literature-account:'+owner;
 let previousTab=null;const tabId=win.crypto.randomUUID();try{previousTab=win.sessionStorage.getItem('paperknow-literature-tab');win.sessionStorage.setItem('paperknow-literature-tab',tabId);}catch{}
 const journalKey=(owner,tab=tabId)=>key(owner)+':pending:'+tab;
 const current=s=>scope===s&&!s.controller.signal.aborted;
 const rows=s=>[...s.entries.values()].filter(row=>row.item&&row.id!=='@groups').map(row=>structuredClone(row.item));
 const status=(s,message,error=false)=>{if(current(s))win.dispatchEvent(new win.CustomEvent('paperknow:library-status',{detail:{ownerId:s.owner,message,error,pending:s.pending.size}}));};
 const changed=()=>win.dispatchEvent(new win.StorageEvent('storage',{key:literatureKey}));
 function persist(s,{cache=false}={}){
  // Separate tab journals prevent an idle tab from erasing another tab's unsent notes.
  win.localStorage.setItem(journalKey(s.owner),JSON.stringify({ownerId:s.owner,pending:[...s.pending.values()],conflicts:s.conflicts}));
  if(cache)try{const value=JSON.stringify({ownerId:s.owner,migrated:s.migrated,entries:[...s.entries.values()]});if(value.length<=500000)win.localStorage.setItem(key(s.owner),value);else win.localStorage.removeItem(key(s.owner));}catch{}
  if(s.previousJournal&&win.localStorage.getItem(s.previousJournal.key)===s.previousJournal.value){win.localStorage.removeItem(s.previousJournal.key);s.previousJournal=null;}
 }
 async function api(s,body){const response=await fetchImpl('/api/literature/library',{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:s.controller.signal,headers:{'X-PaperKnow-User':s.owner,...(body?{'Content-Type':'application/json'}:s.etag?{'If-None-Match':s.etag}:{})},...(body?{body:JSON.stringify({expectedUserId:s.owner,...body})}:{})});if(!current(s))throw Object.assign(Error('页面已关闭'),{name:'AbortError'});if(response.status===304)return {unchanged:true};const value=await response.json();if(response.status===401||value.code==='ACCOUNT_CHANGED'){if(current(s)){scope=null;s.controller.abort();sessionStatus='loading';if(timer)win.clearTimeout(timer);timer=null;changed();win.dispatchEvent(new win.CustomEvent('paperknow:library-owner-changed'));win.dispatchEvent(new win.CustomEvent('paperknow:session-invalidated'));}throw Object.assign(Error('登录账户已变化'),{name:'AbortError'});}if(!response.ok)throw Object.assign(Error(value.error||'文献暂时无法保存'),{status:response.status});if(value.ownerId!==s.owner)throw Object.assign(Error('登录账户已变化'),{name:'AbortError'});s.etag=body?null:response.headers.get('etag');return value;}
 async function flush(s){
  if(!current(s)||!s.loaded||s.busy||s.conflict||!s.pending.size)return;
  s.busy=true;status(s,'正在保存文献…');
  try{while(current(s)&&s.pending.size){const change=s.pending.values().next().value;const value=await api(s,change);const latest=s.pending.get(change.id);if(latest===change){s.pending.delete(change.id);s.entries.set(change.id,value.entry);}else{latest.version=value.entry.version;}persist(s,{cache:true});}
   if(current(s)){s.rebases=0;status(s,'已保存至账户');}
  }catch(error){if(current(s)&&error.name!=='AbortError'){s.conflict=error.status===409;status(s,s.conflict?error.message:'文献尚未同步，修改已保留，连接恢复后会重试。',true);}}
  finally{if(current(s)){s.busy=false;if(s.conflict&&s.rebases++<3)void refresh(s);else if(s.pending.size&&!s.conflict)schedule(s,10000);}}
 }
 function schedule(s,delay=250){if(timer)win.clearTimeout(timer);timer=win.setTimeout(()=>{timer=null;void flush(s);},delay);}
 async function refresh(s){
  if(!current(s)||s.refreshing||s.busy)return;s.refreshing=true;
  try{
   const value=await api(s);if(value.unchanged){void flush(s);return;}const remote=new Map(value.entries.map(row=>[row.id,row]));
   if(!s.migrated){let legacy=[];try{legacy=JSON.parse(win.localStorage.getItem(literatureKey)||'[]');}catch{}for(const item of Array.isArray(legacy)?legacy:[]){if(item.originalOwnerId!==s.owner||!(value.fileIds||[]).includes(item.originalFileId)||remote.has(item.id)||s.pending.has(item.id))continue;const migrated={...item,projectId:(value.projectIds||[]).includes(item.projectId)?item.projectId:''};s.pending.set(item.id,{id:item.id,version:0,item:migrated});}s.migrated=true;}
   s.conflict=false;let recovered=false;
   for(const change of [...s.pending.values()]){
    const saved=remote.get(change.id);
    if(saved&&JSON.stringify(saved.item)===JSON.stringify(change.item)){s.pending.delete(change.id);continue;}
    if(saved&&(saved.version!==change.version||saved.item===null)){
     if(saved.item===null||change.item===null){s.conflicts.push(change);s.pending.delete(change.id);recovered=true;continue;}
     const base=change.base||{},patch=Object.keys(change.item).filter(k=>JSON.stringify(change.item[k])!==JSON.stringify(base[k]));
     const clashes=patch.filter(k=>JSON.stringify(saved.item[k])!==JSON.stringify(base[k])&&JSON.stringify(saved.item[k])!==JSON.stringify(change.item[k]));
     if(!clashes.length){change.item={...saved.item,...Object.fromEntries(patch.map(k=>[k,change.item[k]]))};change.version=saved.version;change.base=saved.item;}
     else if(change.id!=='@groups'){s.pending.delete(change.id);const id=win.crypto.randomUUID();change.id=id;change.version=0;change.base=null;change.item={...change.item,id,title:String(change.item.title).slice(0,285)+'（修改副本）'};s.pending.set(id,change);recovered=true;}
     else{s.conflicts.push(change);s.pending.delete(change.id);recovered=true;continue;}
    }
    remote.set(change.id,{id:change.id,version:change.version,item:change.item});
   }
   s.entries=remote;s.loaded=true;persist(s,{cache:true});changed();win.dispatchEvent(new win.CustomEvent('paperknow:library-loaded'));status(s,recovered?'已同步其他页面的更改；冲突修改已保留，未覆盖已保存的记录。':s.pending.size?'正在保存文献…':'已保存至账户',recovered);void flush(s);
  }catch(error){if(current(s)&&error.name!=='AbortError'){s.error=true;status(s,'文献暂时无法同步，请稍后重试。',true);win.dispatchEvent(new win.CustomEvent('paperknow:library-loaded'));}}
  finally{if(current(s))s.refreshing=false;}
 }
 const adapter={read:()=>scope?rows(scope):[],owner:()=>scope?.owner||null,status:()=>scope?scope.loaded?'ready':scope.error?'error':'loading':sessionStatus,version:id=>scope?.pending.get(id)?.version??scope?.entries.get(id)?.version??0,write(value){
  const s=scope;if(!s)throw Error('请先登录，再保存文献。');if(!s.loaded)throw Error('文献正在同步，请稍后再保存。');if(!Array.isArray(value)||value.length>200)throw Error('文献库最多保存 200 篇。');
  if(value.some(item=>item.originalOwnerId&&item.originalOwnerId!==s.owner))throw Error('文献原件不属于当前账户。');
  const next=new Map(value.map(item=>[item.id,item])),entries=new Map(s.entries),pending=new Map(s.pending);if(entries.get('@groups')?.item)next.set('@groups',entries.get('@groups').item);
  for(const id of new Set([...entries.keys(),...next.keys()])){const old=entries.get(id),item=next.get(id)||null;if(JSON.stringify(old?.item??null)===JSON.stringify(item))continue;const previous=pending.get(id),change={id,version:previous?.version??old?.version??0,base:previous?.base??old?.item??null,item:structuredClone(item)};pending.set(id,change);entries.set(id,{id,version:old?.version??0,item:change.item});}
  const beforeEntries=s.entries,beforePending=s.pending;s.entries=entries;s.pending=pending;try{persist(s);}catch(error){s.entries=beforeEntries;s.pending=beforePending;throw error;}changed();schedule(s);
 }};
 const uninstall=installStateStore(literatureKey,adapter);
 const uninstallGroups=installStateStore('paperknow-literature-groups',{read:()=>structuredClone(scope?.entries.get('@groups')?.item?.groups||[]),write(groups){const s=scope;if(!s?.loaded)throw Error('文献正在同步，请稍后再保存。');const item={id:'@groups',groups:structuredClone(groups)},previous=s.entries.get('@groups'),change={id:'@groups',version:s.pending.get('@groups')?.version??previous?.version??0,base:previous?.item??null,item};s.entries.set('@groups',{id:'@groups',version:change.version,item});s.pending.set('@groups',change);persist(s);schedule(s);}});
 const reconnect=()=>{if(scope){if(scope.pending.size&&!scope.conflict)void flush(scope);else void refresh(scope);}};
 const storage=event=>{if(scope&&event.key===key(scope.owner)&&!scope.pending.size)void refresh(scope);};
 win.addEventListener('online',reconnect);win.addEventListener('focus',reconnect);win.addEventListener('storage',storage);
 return {setUser(user,options={}){const owner=user?.id||null;sessionStatus=options.status==='error'?'error':owner?'ready':'guest';if(scope?.owner===owner)return;if(!scope&&!owner){win.dispatchEvent(new win.CustomEvent('paperknow:library-loaded'));return;}const previousOwner=scope?.owner;scope?.controller.abort();if(timer)win.clearTimeout(timer);timer=null;serial++;scope=null;
   if(owner){const s={owner,serial,controller:new win.AbortController(),entries:new Map(),pending:new Map(),conflicts:[],rebases:0,loaded:false,busy:false,refreshing:false,conflict:false,migrated:false};scope=s;
    try{const cache=JSON.parse(win.localStorage.getItem(key(owner))||'null');if(cache?.ownerId===owner){s.entries=new Map(cache.entries.map(row=>[row.id,row]));s.pending=new Map((cache.pending||[]).map(row=>[row.id,row]));s.conflicts=cache.conflicts||[];s.migrated=cache.migrated===true;}
     const resumeKey=win.localStorage.getItem(journalKey(owner))?journalKey(owner):previousTab?journalKey(owner,previousTab):null,value=resumeKey?win.localStorage.getItem(resumeKey):null,journal=JSON.parse(value||'null');if(journal?.ownerId===owner){s.pending=new Map(journal.pending.map(row=>[row.id,row]));s.conflicts=journal.conflicts||[];if(resumeKey!==journalKey(owner))s.previousJournal={key:resumeKey,value};}
    }catch{}
    // Cached content may be shown only to its confirmed owner; writes wait for the server.
    void refresh(s);
   }changed();if(previousOwner)win.dispatchEvent(new win.CustomEvent('paperknow:library-owner-changed'));},refresh:reconnect,dispose(){scope?.controller.abort();scope=null;if(timer)win.clearTimeout(timer);uninstall();uninstallGroups();win.removeEventListener('online',reconnect);win.removeEventListener('focus',reconnect);win.removeEventListener('storage',storage);}};
}
