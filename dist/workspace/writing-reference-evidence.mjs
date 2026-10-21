// Provider-supplied abstracts may be used as limited background only after an
// explicit user action. Search and bibliography records remain metadata by default.
const databaseSources=Object.freeze({crossref:'Crossref',europepmc:'Europe PMC',openalex:'OpenAlex',arxiv:'arXiv',aminer:'AMiner'});
const abstractLimit=12000;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export function referenceAbstractAvailability(row){
 if(!object(row))return {available:false,reason:'文献记录无法读取，请重新选择文献。',characters:0};
 if(row.text!==undefined&&row.text!==null&&typeof row.text!=='string')return {available:false,reason:'已保存的文献正文格式无法核对，不会覆盖现有内容。',characters:0};
 if(typeof row.text==='string'&&row.text.trim())return {available:false,reason:'这篇文献已有正文或已采用摘要，不会覆盖现有内容。',characters:0};
 if(!Object.hasOwn(databaseSources,row.source))return {available:false,reason:'这篇文献没有可采用的数据库摘要，可导入或粘贴有权使用的正文。',characters:0};
 const abstract=typeof row.abstract==='string'?row.abstract:'',characters=Array.from(abstract.replace(/[\s\p{Cf}]/gu,'')).length;
 if(!characters)return {available:false,reason:'数据库未提供可用摘要，请导入或粘贴有权使用的正文。',characters:0};
 if(abstract.length>abstractLimit)return {available:false,reason:'单篇摘要最多 12,000 字符，请选取相关内容后通过正文资料导入。',characters};
 return {available:true,reason:'可采用数据库摘要作为背景材料；这不代表已经读取全文。',characters};
}

export const canAdoptReferenceAbstract=row=>referenceAbstractAvailability(row).available;

export function adoptReferenceAbstract(row){
 const state=referenceAbstractAvailability(row);if(!state.available)throw Error(state.reason);
 const originalLabel=typeof row.sourceLabel==='string'?row.sourceLabel.trim():'',label=(originalLabel||databaseSources[row.source]).replace(/\s*·\s*在线题录，未读取全文\s*$/u,'');
 return {...row,text:row.abstract,scope:'abstract',sourceLabel:label+' · 来源摘要，未读取全文',fullTextRead:false,confirmed:false};
}
