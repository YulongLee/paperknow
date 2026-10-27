const codes=new Set(['ppt_completion','ppt_page_count','ppt_page_identity','ppt_field','ppt_outline_title','ppt_source_read']);
// Persist only controlled rule IDs and bounded counts/positions. Never retain
// rejected candidate text, material names, provider errors or credentials.
export function presentationValidationRecord(result,{phase='planning',unitId=''}={}){
 const feedback=result?.feedback||{},p=feedback.presentation||{},rule=typeof feedback.rule==='string'?feedback.rule:'';
 const fallback=/读取|来源/.test(rule)?'ppt_source_read':/重叠/.test(rule)?'ppt_layout_overlap':/越界|画布|区域|坐标/.test(rule)?'ppt_layout_bounds':/字号|对比|透明|隐藏|遮挡/.test(rule)?'ppt_layout_readability':/文字|内容组|遗漏/.test(rule)?'ppt_layout_content':'ppt_contract';
 const record={phase:phase==='authoring'?'authoring':'planning',code:codes.has(p.code)?p.code:fallback};
 if(/^(?:unit-\d{1,2}|design-slide-\d{1,2})$/.test(unitId))record.unitId=unitId;
 for(const key of ['page','firstPage','lastPage','expectedCount','actualCount','maxCharacters','minCharacters','actualCharacters'])if(Number.isSafeInteger(p[key])&&p[key]>=0&&p[key]<=100000)record[key]=p[key];
 if(['title','body','notes'].includes(p.field))record.field=p.field;
 if(p.invalidType===true)record.invalidType=true;
 if(Array.isArray(p.missingReads))record.missingReadCount=Math.min(p.missingReads.length,100);
 return record;
}
