export const thesisEvidenceMinCharacters=100;

// Presence and length are preflight checks, not an assessment of research quality.
// Titles, citation metadata and proposed AI research plans are not source text.
export function assessThesisEvidence(snapshot,{confirmedOnly=true}={}){
 const rows=[...(Array.isArray(snapshot?.materials)?snapshot.materials:[]),...(Array.isArray(snapshot?.references)?snapshot.references:[])];
 const characters=rows.reduce((total,row)=>{
  if(!row||confirmedOnly&&row.confirmed!==true||row.purpose==='格式要求'||typeof row.text!=='string')return total;
  return total+Array.from(row.text.replace(/[\s\p{Cf}]/gu,'')).length;
 },0);
 const minCharacters=thesisEvidenceMinCharacters,ready=characters>=minCharacters;
 const reason=ready?'':characters===0?`请先确认至少一份含正文的研究材料或文献，至少需要 ${minCharacters} 个非空白正文字符（当前 0 个）；仅有题录不能作为正文依据。`:`研究资料正文不足，至少需要 ${minCharacters} 个非空白正文字符（当前 ${characters} 个），请补充实际研究内容后继续。`;
 return {ready,characters,minCharacters,reason};
}
