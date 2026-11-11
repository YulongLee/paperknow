export const keys={projects:'paperknow-projects',drafts:'paperknow-drafts',tasks:'paperknow-local-tasks',preferences:'paperknow-preferences',profile:'paperknow-local-profile'};
let draftScope=null;
// The old shared keys remain untouched until their owner can be established.
// Ordinary editing sessions use a separate cache for each verified account.
let editingIdentity={mode:'legacy',ownerId:undefined};
export const editingIdentityContext=()=>({...editingIdentity});
export function setEditingIdentity(user,{status='ready'}={}){
 const next=status==='ready'&&user?.id?{mode:'account',ownerId:String(user.id)}:status==='guest'?{mode:'guest',ownerId:undefined}:{mode:'pending',ownerId:undefined};
 if(editingIdentity.mode===next.mode&&editingIdentity.ownerId===next.ownerId)return false;
 editingIdentity=next;return true;
}
function editingKey(key){
 if(![keys.drafts,keys.tasks].includes(key)||editingIdentity.mode==='legacy')return key;
 if(editingIdentity.mode==='pending')return null;
 return key+':'+(editingIdentity.mode==='guest'?'guest':'account:'+encodeURIComponent(editingIdentity.ownerId));
}
const serviceStores=new Map();
export function installStateStore(key,store){serviceStores.set(key,store);return ()=>{if(serviceStores.get(key)===store)serviceStores.delete(key);};}
export const hasStateStore=key=>serviceStores.has(key);
export const stateStoreVersion=(key,id)=>serviceStores.get(key)?.version?.(id)??0;
export const stateStoreStatus=key=>serviceStores.get(key)?.status?.()||'ready';
export const stateStoreOwner=key=>serviceStores.get(key)?.owner?.()||null;
export function beginDraftScope({drafts=[],projectRows=[],ownerId}={}){draftScope={revision:0,ownerId:typeof ownerId==='string'&&ownerId?ownerId:undefined,[keys.drafts]:structuredClone(drafts),[keys.projects]:structuredClone(projectRows),[keys.tasks]:[]};}
export function endDraftScope(){draftScope=null;}
export const hasDraftScope=()=>!!draftScope;
export function read(key,fallback){if(serviceStores.has(key))return serviceStores.get(key).read();if(draftScope&&Object.hasOwn(draftScope,key))return structuredClone(draftScope[key]);const storageKey=editingKey(key);if(!storageKey)return fallback;try{const value=JSON.parse(localStorage.getItem(storageKey)||'null');return value??fallback;}catch{return fallback;}}
export function list(key){const value=read(key,[]);return Array.isArray(value)?value:[];}
export function write(key,value){if(serviceStores.has(key))return serviceStores.get(key).write(value);if(draftScope&&Object.hasOwn(draftScope,key)){if(key===keys.drafts){draftScope.lastSaved=value.find(row=>{const old=draftScope[key].find(v=>String(v.id)===String(row.id));return !old||JSON.stringify(old)!==JSON.stringify(row);})||null;draftScope.revision++;}draftScope[key]=structuredClone(value);return;}const storageKey=editingKey(key);if(!storageKey)throw Error('正在确认账户，请稍后再保存。');localStorage.setItem(storageKey,JSON.stringify(value));}
export const projects=()=>list(keys.projects);
export const preferences=()=>({...{degree:'本科',major:'',density:'comfortable',fontSize:'normal'},...read(keys.preferences,{})});
export const profile=()=>{const p=read(keys.profile,{});return {...{name:'研究者'},...(p&&typeof p==='object'?p:{})};};
export function saveProject(values,id){const rows=projects(),existing=rows.find(p=>p.id===id),now=new Date().toISOString();const item={...existing,...values,id:existing?.id||crypto.randomUUID(),status:existing?.status||'active',createdAt:existing?.createdAt||now,updatedAt:now};write(keys.projects,existing?rows.map(p=>p.id===item.id?item:p):[item,...rows]);return item;}
export function recordTask(task){const rows=list(keys.tasks);const item={id:task.id||crypto.randomUUID(),createdAt:new Date().toISOString(),...task};const index=rows.findIndex(t=>t.id===item.id);if(index>=0)rows[index]=item;else rows.unshift(item);write(keys.tasks,rows.slice(0,100));return item.id;}
export const draftScopeRevision=()=>draftScope?.revision??0;

export const lastDraftScopeRow=()=>draftScope?.lastSaved?structuredClone(draftScope.lastSaved):null;

// Account ownership stays in memory only; exports must not rediscover it from a changed cookie.
export const draftScopeOwnerId=()=>draftScope?.ownerId;
export function captureDraftScope(){const captured=draftScope,identity=editingIdentity;return {ownerId:captured?.ownerId??identity.ownerId,isCurrent:()=>draftScope===captured&&!!(captured||editingIdentity===identity)};}
