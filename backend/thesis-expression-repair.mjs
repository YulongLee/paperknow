import {thesisError} from './thesis-model.mjs';
const protectedText=text=>{
 const blocks=String(text).match(/```[\s\S]*?```|~~~[\s\S]*?~~~|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$(?!\$)[^$\r\n]+\$|`[^`\r\n]+`|^[ \t]*\|.*$/gm)||[];
 const tokens=String(text).match(/\[source:[^\]\r\n]+\]|\[figure:[^\]\r\n]+\]|【(?:待补充|待核对|草稿说明)[：:][^】]+】|\[(?:To be supplied|To be verified|Draft note):[^\]]+\]|https?:\/\/[^\s<>]+|[-+]?\d+(?:[.,]\d+)*(?:%|％)?/g)||[];
 return {blocks,tokens:tokens.map(token=>token.startsWith('[figure:')?'[figure]':token)};
};
export function assertExpressionRepairUnchanged(checkpoint,content){
 const before=String(checkpoint.text||''),after=String(content.text||'');
 if(before===after)throw thesisError(502,'表达修正尚未写入正文，请按定位的问题修正文句后重新提交。','invalid_output');
 if(JSON.stringify(protectedText(before))!==JSON.stringify(protectedText(after)))throw thesisError(502,'表达修正须保留原有数字、引用、公式、代码、表格和待核对标记。','invalid_output');
 const figures=value=>(value||[]).map(({id,...figure})=>figure);
 if(JSON.stringify(figures(JSON.parse(checkpoint.figures||'[]')))!==JSON.stringify(figures(content.figures)))throw thesisError(502,'表达修正不能替换论文图表或改变其中的数据。','invalid_output');
}

// Only remove explicitly enumerated discourse fillers, never change claims.
const duplicateCitationStop=/。(?:[ \t]*(?:\[source:[^\]\n]{1,200}\]|〔(?:文献|材料)\d+〕)[ \t]*)?。/gu;
export function safeExpressionReplacement(value){return String(value||'').replace(/^(显而易见|众所周知|毋庸置疑)[，,]\s*/u,'').replace(duplicateCitationStop,match=>match.slice(0,-1));}
export function canSafeExpressionEdit(text,quote){const at=String(text).indexOf(quote);if(at<0||String(text).indexOf(quote,at+1)>=0||safeExpressionReplacement(quote)===quote)return false;const start=String(text).lastIndexOf('\n',at)+1,end=String(text).indexOf('\n',at),line=String(text).slice(start,end<0?undefined:end),isDuplicate=/。(?:[ \t]*(?:\[source:[^\]\n]{1,200}\]|〔(?:文献|材料)\d+〕)[ \t]*)?。/u.test(quote);return !/^[\s]*>|[“”"「」『』]|[|`$]|\[docx:/iu.test(line)&&(isDuplicate||!/\[source:/u.test(line));}

// Apply only exact, uniquely located edits inside the server-selected findings.
// The model cannot choose another paragraph or replace the complete section.
export function normalizeExpressionPatch(candidate,checkpoint,findings){
 let body;try{body=JSON.parse(candidate.text);}catch{throw thesisError(502,'表达修正格式无效，原文已保留。','invalid_output');}
 if(!Array.isArray(body?.edits))throw thesisError(502,'表达修正须提交已定位的局部修改，原文已保留。','invalid_output');
 if(body.complete!==true||body.edits.length<1||body.edits.length>2)throw thesisError(502,'请提交一至两处已定位的完整表达修改。','invalid_output');
 let text=String(checkpoint.text||'');const originals=new Set(),positions=[];
 for(const edit of body.edits){
  if(!edit||typeof edit.old!=='string'||typeof edit.new!=='string'||edit.old.length<6||edit.old.length>500||edit.new.length<1||edit.new.length>1000||edit.old===edit.new||originals.has(edit.old))throw thesisError(502,'表达修改必须包含不同的原句和替换句。','invalid_output');
  if(safeExpressionReplacement(edit.old)!==edit.new)throw thesisError(502,'无法自动证明该表达修改不改变研究含义，请保留原文并由作者确认。','invalid_output');
  if(/\[docx:[^\]]+\]/i.test(edit.old+' '+edit.new))throw thesisError(502,'表达修改不能移动原稿图片或公式对象。','invalid_output');
  if(!(findings||[]).some(f=>typeof f.quote==='string'&&f.quote.includes(edit.old)))throw thesisError(502,'表达修改超出已定位的问题范围，原文已保留。','invalid_output');
  const at=String(checkpoint.text||'').indexOf(edit.old);if(at<0||String(checkpoint.text||'').indexOf(edit.old,at+1)>=0)throw thesisError(502,'表达修改无法唯一定位，原文已保留。','invalid_output');
  if(!canSafeExpressionEdit(checkpoint.text,edit.old))throw thesisError(502,'引用或不明确的位置不能自动修改，原文已保留。','invalid_output');
  if(positions.some(p=>at<p.end&&at+edit.old.length>p.start))throw thesisError(502,'表达修改范围重叠，原文已保留。','invalid_output');
  originals.add(edit.old);positions.push({start:at,end:at+edit.old.length,replacement:edit.new});
 }
 for(const p of positions.sort((a,b)=>b.start-a.start))text=text.slice(0,p.start)+p.replacement+text.slice(p.end);
 const figures=JSON.parse(checkpoint.figures||'[]');assertExpressionRepairUnchanged(checkpoint,{text,figures});
 const sourceIds=JSON.parse(checkpoint.source_ids||'[]'),missing=JSON.parse(checkpoint.missing_evidence||'[]'),oldTrace=JSON.parse(checkpoint.trace||'[]').filter(x=>x?.tool==='read_material'&&x.status==='completed'&&sourceIds.includes(x.materialId)).map(({tool,status,materialId})=>({tool,status,materialId}));
 const output={text,source_ids:sourceIds,missing_evidence:missing,complete:true,draft:missing.length>0,figures};
 return {...candidate,text:JSON.stringify(output),trace:[...oldTrace,...(Array.isArray(candidate.trace)?candidate.trace:[])]};
}
