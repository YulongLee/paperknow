export const keys={projects:'paperknow-projects',drafts:'paperknow-drafts',tasks:'paperknow-local-tasks',preferences:'paperknow-preferences',profile:'paperknow-local-profile'};
let draftScope=null;
export function beginDraftScope({drafts=[],projectRows=[]}={}){draftScope={revision:0,[keys.drafts]:structuredClone(drafts),[keys.projects]:structuredClone(projectRows),[keys.tasks]:[]};}
export function endDraftScope(){draftScope=null;}
export const hasDraftScope=()=>!!draftScope;
export function read(key,fallback){if(draftScope&&Object.hasOwn(draftScope,key))return structuredClone(draftScope[key]);try{const value=JSON.parse(localStorage.getItem(key)||'null');return value??fallback;}catch{return fallback;}}
export function list(key){const value=read(key,[]);return Array.isArray(value)?value:[];}
export function write(key,value){if(draftScope&&Object.hasOwn(draftScope,key)){if(key===keys.drafts){draftScope.lastSaved=value.find(row=>{const old=draftScope[key].find(v=>String(v.id)===String(row.id));return !old||JSON.stringify(old)!==JSON.stringify(row);})||null;draftScope.revision++;}draftScope[key]=structuredClone(value);return;}localStorage.setItem(key,JSON.stringify(value));}
export const projects=()=>list(keys.projects);
export const preferences=()=>({...{degree:'本科',major:'',density:'comfortable',fontSize:'normal'},...read(keys.preferences,{})});
export const profile=()=>{const p=read(keys.profile,{});return {...{name:'研究者'},...(p&&typeof p==='object'?p:{})};};
export function saveProject(values,id){const rows=projects(),existing=rows.find(p=>p.id===id),now=new Date().toISOString();const item={...existing,...values,id:existing?.id||crypto.randomUUID(),status:existing?.status||'active',createdAt:existing?.createdAt||now,updatedAt:now};write(keys.projects,existing?rows.map(p=>p.id===item.id?item:p):[item,...rows]);return item;}
export function recordTask(task){const rows=list(keys.tasks);const item={id:task.id||crypto.randomUUID(),createdAt:new Date().toISOString(),...task};const index=rows.findIndex(t=>t.id===item.id);if(index>=0)rows[index]=item;else rows.unshift(item);write(keys.tasks,rows.slice(0,100));return item.id;}
export const draftScopeRevision=()=>draftScope?.revision??0;

export const lastDraftScopeRow=()=>draftScope?.lastSaved?structuredClone(draftScope.lastSaved):null;
