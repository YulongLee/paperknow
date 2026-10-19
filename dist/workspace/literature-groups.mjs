export const literatureGroupsKey='paperknow-literature-groups';
export function literatureGroupName(value){const name=String(value??'').trim();if(!name||name.length>80)throw Error('分组名称请填写 1～80 字符。');return name;}
export function normalizeLiteratureGroups(value=[]){if(!Array.isArray(value))throw Error('文献分组格式无效。');const names=[...new Set(value.map(literatureGroupName))];if(names.length>200)throw Error('最多保留 200 个文献分组。');return names;}
export function availableLiteratureGroups(papers,storage=localStorage){let saved=[];try{saved=normalizeLiteratureGroups(JSON.parse(storage.getItem(literatureGroupsKey)||'[]'));}catch{}return normalizeLiteratureGroups([...saved,...papers.map(p=>p.group).filter(Boolean)]);}
export function changeLiteratureGroup(papers,groups,{action,name,previous}={}){
 const current=normalizeLiteratureGroups(groups),old=previous?literatureGroupName(previous):'';
 if(action==='remove'){if(!current.includes(old))throw Error('分组已不存在，请重新打开。');return {groups:current.filter(n=>n!==old),papers:papers.map(p=>p.group===old?{...p,group:''}:p)};}
 const next=literatureGroupName(name);if(current.includes(next)&&next!==old)throw Error('该分组名称已存在。');
 if(action==='rename'){if(!current.includes(old))throw Error('分组已不存在，请重新打开。');return {groups:current.map(n=>n===old?next:n),papers:papers.map(p=>p.group===old?{...p,group:next}:p)};}
 if(action!=='create')throw Error('不支持的分组操作。');return {groups:normalizeLiteratureGroups([...current,next]),papers:[...papers]};
}
export function saveLiteratureGroups({papers,groups},{storage=localStorage}={}){
 const entries=[['paperknow-literature',JSON.stringify(papers)],[literatureGroupsKey,JSON.stringify(normalizeLiteratureGroups(groups))]],before=entries.map(([key])=>[key,storage.getItem(key)]);let touched=false;
 try{for(const [key,value]of entries){storage.setItem(key,value);touched=true;}}
 catch(error){if(touched)try{for(const [key,value]of before){if(value===null)storage.removeItem(key);else storage.setItem(key,value);}}catch{throw Error('分组保存失败，当前文献未删除；请保留备份并重新检查分组关联。');}throw error;}
}
