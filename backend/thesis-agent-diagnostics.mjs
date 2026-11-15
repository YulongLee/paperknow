import {createHash} from 'node:crypto';

// A deliberately opt-in, process-local diagnostic hook for isolated tests.
// Never forward model content, tool arguments, source IDs, messages or secrets.
const tools=new Set(['read_material','submit_writing_output','review_error']);
const codes=new Set(['invalid_output','original_object_integrity','unsupported_window_formula','completion_heading_mismatch','needs_materials','unknown_source','unread_source','metadata_citation_changed','original_citations_changed','draft_disclosure_missing','presentation_not_selected','invalid_figure','invalid_abstract','incomplete','word_limit_exceeded','supplement_evidence']);
const reviewErrors=new Set(['turn_limit','truncated','timeout','invalid_review_output','invalid_supplement_check','cost_budget','budget_exceeded','review_budget_exhausted','review_usage_unknown','permission_denied','unauthorized_tool','cancelled','review_changed']);
const supplementCategories=new Set(['citation_coverage','figure_ids','evidence_limit','evidence_anchor','evidence_quote','manuscript_quote','items_shape_or_count','item_id','item_status','missing_review','other']);
// Derive a fixed label locally. Never return or store source text or feedback.
export function supplementValidationCategory(value){
 if(value?.code!=='supplement_evidence')return undefined;
 const field=String(value.field||''),rule=String(value.rule||'');
 if(rule.includes('正文引用来源未列出'))return 'citation_coverage';
 if(field.endsWith('.checkedFigureIds'))return 'figure_ids';
 if(/evidence 和 missing 必须是数组/.test(rule))return 'evidence_limit';
 if(field.endsWith('.evidence'))return /锚点/.test(rule)?'evidence_anchor':'evidence_quote';
 if(field.endsWith('.manuscriptQuote'))return 'manuscript_quote';
 if(field.endsWith('.missing'))return 'missing_review';
 if(field==='items')return 'items_shape_or_count';
 if(field.endsWith('.id'))return 'item_id';
 if(field.endsWith('.status'))return 'item_status';
 return 'other';
}
export function thesisAgentDiagnostic(config,unit,attempt){
 if(config?.thesisDiagnosticsEnabled!==true||typeof config.thesisDiagnosticSink!=='function')return undefined;
 const unitId=createHash('sha256').update(String(unit?.id||'')).digest('hex').slice(0,16);
 const kind=unit?.frontMatter?'front_matter':unit?.personalMatter?'personal':'body';
 const started=Date.now(),counts=new Map();
 return event=>{try{
  if(!event||!tools.has(event.tool)||!['completed','failed'].includes(event.status))return;
  const code=event.tool==='review_error'&&event.status==='failed'?(reviewErrors.has(event.code)?event.code:'other'):event.status==='completed'&&event.tool==='submit_writing_output'&&event.accepted===false?(codes.has(event.code)?event.code:'other'):undefined;
  const category=supplementCategories.has(event.category)?event.category:undefined;
  const key=[event.tool,event.status,code||'',category||'',event.accepted===true?'accepted':''].join(':');
  const count=(counts.get(key)||0)+1;counts.set(key,count);
  config.thesisDiagnosticSink({unitId,kind,attempt,tool:event.tool,status:event.status,...(typeof event.accepted==='boolean'?{accepted:event.accepted}:{}),...(code?{code}:{}),...(category?{category}:{}),count,elapsedMs:Math.max(0,Date.now()-started)});
 }catch{/* diagnostics must never affect task execution */}};
}
