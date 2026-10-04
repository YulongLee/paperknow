export const keys={projects:'paperknow-projects',drafts:'paperknow-drafts',tasks:'paperknow-local-tasks',preferences:'paperknow-preferences',profile:'paperknow-local-profile'};
export function read(key,fallback){try{const value=JSON.parse(localStorage.getItem(key)||'null');return value??fallback;}catch{return fallback;}}
export function list(key){const value=read(key,[]);return Array.isArray(value)?value:[];}
export function write(key,value){localStorage.setItem(key,JSON.stringify(value));}
export const projects=()=>list(keys.projects);
export const preferences=()=>({...{degree:'本科',major:'',density:'comfortable',fontSize:'normal'},...read(keys.preferences,{})});
export const profile=()=>{const p=read(keys.profile,{});return {...{name:'研究者'},...(p&&typeof p==='object'?p:{})};};
export function saveProject(values,id){const rows=projects(),existing=rows.find(p=>p.id===id),now=new Date().toISOString();const item={...existing,...values,id:existing?.id||crypto.randomUUID(),status:existing?.status||'active',createdAt:existing?.createdAt||now,updatedAt:now};write(keys.projects,existing?rows.map(p=>p.id===item.id?item:p):[item,...rows]);return item;}
export function recordTask(task){const rows=list(keys.tasks);const item={id:task.id||crypto.randomUUID(),createdAt:new Date().toISOString(),...task};const index=rows.findIndex(t=>t.id===item.id);if(index>=0)rows[index]=item;else rows.unshift(item);write(keys.tasks,rows.slice(0,100));return item.id;}
