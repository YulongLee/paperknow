// Short citation labels are a reversible view of this exact chapter and source
// snapshot. Canonical chapter text and recovery drafts always retain raw IDs.
const citationPattern=/\[source:([^\]]+)\]/g;
const shortPattern=/〔(?:材料|文献|待核对来源)\d+〕/g;
const shortLabels=text=>[...new Set(String(text).match(shortPattern)||[])];
export function thesisEditorPresentation(snapshot={},raw=''){
 const original=String(raw),known=new Map();
 for(const [rows,kind,prefix] of [[snapshot.materials||[],'material','材料'],[snapshot.references||[],'reference','文献']]){
  rows.forEach((row,index)=>{if(typeof row?.id==='string'&&!known.has(row.id))known.set(row.id,{token:`〔${prefix}${index+1}〕`,name:String(row.name||row.title||'未命名来源'),kind,hasText:Boolean(String(row.text||'').trim()),confirmed:row.confirmed===true});});
 }
 const sourceMap=new Map(),unknown=new Map();
 for(const match of original.matchAll(citationPattern)){
  const id=match[1];if(sourceMap.has(id))continue;
  let source=known.get(id);if(!source){if(!unknown.has(id))unknown.set(id,unknown.size+1);source={token:`〔待核对来源${unknown.get(id)}〕`,name:'未匹配到当前已保存的资料，请核对来源',kind:'unknown',hasText:false,confirmed:false};}
  sourceMap.set(id,{...source,marker:match[0]});
 }
 const sources=[...sourceMap.values()],collision=sources.some(source=>original.includes(source.token));
 if(collision)return {text:original,sources:[],bindings:[],collision:true,unmatched:[]};
 const bindings=sources.map(({token,marker})=>({token,marker})),tokens=new Map([...sourceMap].map(([id,source])=>[id,source.token]));
 const text=original.replace(citationPattern,(_,id)=>tokens.get(id));
 return {text,sources,bindings,collision:false,unmatched:shortLabels(original).filter(token=>!bindings.some(row=>row.token===token))};
}
export function restoreThesisEditorText(display,presentation){
 const original=String(display);
 if(presentation?.collision)return {text:original,unmatched:[]};
 const bindings=new Map((presentation?.bindings||[]).map(row=>[row.token,row.marker]));
 const unmatched=shortLabels(original).filter(token=>!bindings.has(token));
 const text=original.replace(shortPattern,token=>bindings.get(token)||token);
 return {text,unmatched};
}

export function thesisEditorWordCount(text,language='中文'){
 if(typeof text!=='string')throw new TypeError('统计正文必须是文本');
 const prose=text.replace(/\[source:[^\]]+\]/g,'');
 return /english|英文|英语/i.test(language)?(prose.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)||[]).length:Array.from(prose.replace(/\s/g,'')).length;
}
