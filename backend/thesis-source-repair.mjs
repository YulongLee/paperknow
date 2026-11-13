import {thesisError} from './thesis-model.mjs';
import {assertExpressionRepairUnchanged} from './thesis-expression-repair.mjs';
const repairError=(reason,message)=>Object.assign(thesisError(502,message,'invalid_output'),{repairReason:reason});

// Only a single, uniquely located sentence with exactly one confirmed source
// is eligible. Original document objects, formulas and quoted text stay locked.
export function sourceRepairCandidate(checkpoint,finding,snapshot){
 const text=String(checkpoint?.text||''),quote=String(finding?.quote||'');
 if(finding?.category!=='source_support'||quote.length<6||quote.length>500||quote.includes('\n')||/[`$|“”"「」『』]|\[docx:|\[figure:/u.test(quote))return null;
 const at=text.indexOf(quote);if(at<0||text.indexOf(quote,at+1)>=0)return null;
 // Unique location alone does not make a sentence: leaving a preceding
 // assertion outside the replaced span can attribute the quote incorrectly.
 const before=text.slice(0,at),after=text.slice(at+quote.length);
 if(before&&!/[。！？；;\n]\s*$/u.test(before))return null;
 if(!/(?:[。！？；;]|[。！？；;]\s*\[source:[^\]\n]+\])\s*$/u.test(quote)&&after&&!/^\s*[。！？；;\n]/u.test(after))return null;
 const line=text.slice(text.lastIndexOf('\n',at)+1,text.indexOf('\n',at)<0?undefined:text.indexOf('\n',at));
 if(/^[\s]*>|[`$|“”"「」『』]|\[docx:|\[figure:/iu.test(line))return null;
 const markers=[...quote.matchAll(/\[source:([^\]\n]+)\]/gu)];if(markers.length!==1)return null;
 const source=[...(snapshot.materials||[]),...(snapshot.references||[])].find(row=>row.id===markers[0][1]&&row.confirmed===true&&typeof row.text==='string'&&row.text.trim().length>=10);
 // User-uploaded files can explicitly say they are simulated without the
 // structured dataKind flag; do not quote their contents out of context.
 if(!source||source.dataKind==='simulation'||source.simulation||/(?:本(?:研究|文|实验|数据|材料).{0,20}(?:模拟|仿真)|(?:以下|本次|该|本).{0,12}(?:模拟|仿真).{0,12}(?:数据|实验|结果|研究)|(?:模拟|仿真)(?:数据|样本|实验|结果)|(?:synthetic|simulated)\s+(?:data|dataset|samples|experiment|results))/iu.test(source.text)||!JSON.parse(checkpoint.source_ids||'[]').includes(source.id))return null;
 return {quote,sourceId:source.id};
}

// Quotes prove where an authorized excerpt came from, not that the candidate
// is semantically supported. The caller must perform independent final review.
export function normalizeSourceRepair(candidate,checkpoint,finding,snapshot,task){
 const eligible=sourceRepairCandidate(checkpoint,finding,snapshot);if(!eligible)throw repairError('location','来源修订无法定位，原文已保留。');
 let body;try{body=JSON.parse(candidate.text);}catch{throw repairError('format','来源修订格式无效。');}
 if(body?.complete!==true||!Array.isArray(body.edits)||body.edits.length!==1)throw repairError('shape','来源修订须提交一处已定位修改。');
 const edit=body.edits[0],proof=edit?.evidence,source=task.materials?.find(row=>row.id===eligible.sourceId);
 if(edit?.old!==eligible.quote||typeof edit.new!=='string'||!edit.new.trim()||edit.new.length>1000||edit.new.includes('\n')||edit.old===edit.new||/[`$|]|\[docx:|\[figure:/iu.test(edit.new)||proof?.sourceId!==eligible.sourceId||typeof proof.quote!=='string'||proof.quote.trim().length<10||proof.quote.length>500||!source?.text?.includes(proof.quote))throw repairError('evidence','来源或修改依据无效，原文已保留。');
 const read=(candidate.trace||[]).some(row=>row.tool==='read_material'&&row.status==='completed'&&row.materialId===eligible.sourceId&&Number.isSafeInteger(row.offset)&&row.offset>=0&&Number.isSafeInteger(row.limit)&&row.limit>0&&source.text.slice(row.offset,row.offset+row.limit).includes(proof.quote));
 if(!read)throw repairError('read','修订依据尚未实际读取，原文已保留。');
 // Do not allow a model-generated paraphrase to introduce new claims under a
 // real citation. The replacement's factual words must be the exact excerpt;
 // matching text still requires independent context/semantic review afterward.
 const cited=edit.new.replace(/\[source:[^\]\n]+\]/gu,'').trim(),quoted=/^“([^”]+)”[。！？]?$/u.exec(cited);
 if(!quoted||quoted[1]!==proof.quote)throw repairError('quotation','修订须直接引用已读取的连续来源原文并保留引号，原文已保留。');
 const qualifiers=value=>(String(value).match(/模拟|仿真|真实|实际|实测|拟|计划|尚未|未实施/gu)||[]).sort();
 if(JSON.stringify(qualifiers(edit.old))!==JSON.stringify(qualifiers(edit.new)))throw repairError('research_status','不能改变模拟或实际研究状态。');
 const text=checkpoint.text.replace(edit.old,edit.new),figures=JSON.parse(checkpoint.figures||'[]');try{assertExpressionRepairUnchanged(checkpoint,{text,figures});}catch(error){throw repairError('protected_content',error.message);}
 const sourceIds=JSON.parse(checkpoint.source_ids||'[]'),missing=JSON.parse(checkpoint.missing_evidence||'[]'),oldTrace=JSON.parse(checkpoint.trace||'[]').filter(x=>x?.tool==='read_material'&&x.status==='completed'&&sourceIds.includes(x.materialId));
 return {...candidate,text:JSON.stringify({text,source_ids:sourceIds,missing_evidence:missing,complete:true,draft:missing.length>0,figures}),trace:[...oldTrace,...(candidate.trace||[])]};
}
