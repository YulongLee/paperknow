import {readFile} from 'node:fs/promises';
const registry=Object.freeze({'thesis-section':Object.freeze({name:'论文章节草稿',version:2,file:new URL('./thesis-section.md',import.meta.url)})});
export function registeredAgentSkills(){return Object.entries(registry).map(([id,{name,version}])=>({id,name,version}));}
export async function loadAgentSkill(id){if(!Object.hasOwn(registry,id))throw Object.assign(new Error('未注册的 Agent 技能'),{status:400});const spec=registry[id];return {id,name:spec.name,version:spec.version,instructions:await readFile(spec.file,'utf8')};}
