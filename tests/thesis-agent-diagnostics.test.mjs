import test from 'node:test';
import assert from 'node:assert/strict';
import {thesisAgentDiagnostic,supplementValidationCategory} from '../backend/thesis-agent-diagnostics.mjs';

test('diagnostics are opt-in and do not expose task data',()=>{
 const records=[];const config={thesisDiagnosticSink:value=>records.push(value)};
 assert.equal(thesisAgentDiagnostic(config,{id:'private-chapter'},1),undefined);
 const observe=thesisAgentDiagnostic({...config,thesisDiagnosticsEnabled:true},{id:'private-chapter'},2);
 observe({tool:'read_material',status:'completed',args:'secret',text:'sensitive'});
 observe({tool:'submit_writing_output',status:'completed',accepted:false,code:'original_object_integrity',text:'secret'});
 observe({tool:'submit_writing_output',status:'completed',accepted:false,code:'original_object_integrity'});
 observe({tool:'submit_writing_output',status:'completed',accepted:false,code:'private_source_id'});
 observe({tool:'submit_writing_output',status:'completed',accepted:false,code:'presentation_not_selected'});
 observe({tool:'review_error',status:'failed',code:'cost_budget',message:'sensitive'});
 observe({tool:'review_error',status:'failed',code:'private_source_id'});
 observe({tool:'user_supplied_tool',status:'completed',text:'secret'});
 assert.equal(records.length,7);assert.equal(records[2].count,2);assert.equal(records[3].code,'other');assert.equal(records[4].code,'presentation_not_selected');assert.equal(records[5].code,'cost_budget');assert.equal(records[6].code,'other');
 assert.equal(records[0].kind,'body');assert.equal(records[0].attempt,2);assert.match(records[0].unitId,/^[a-f0-9]{16}$/);
 assert.doesNotMatch(JSON.stringify(records),/secret|sensitive|private/);
});
test('diagnostic sink failure cannot interrupt a task',()=>{
 const observe=thesisAgentDiagnostic({thesisDiagnosticsEnabled:true,thesisDiagnosticSink(){throw Error('broken');}},{id:'test',frontMatter:true},1);
 assert.doesNotThrow(()=>observe({tool:'read_material',status:'completed'}));
});
test('supplement failure categories are predefined and never expose feedback or private fields',()=>{
 const cases=[['items[0].evidence','证据锚点不属于当前来源','evidence_anchor'],['items[2].evidence','quote 必须逐字出自原文','evidence_quote'],['items[1].checkedFigureIds','完整复制图片 ID','figure_ids'],['items[0]','evidence 和 missing 必须是数组','evidence_limit'],['items[0].manuscriptQuote','原文不一致','manuscript_quote'],['','本章节还有正文引用来源未列出对应的原文摘录','citation_coverage'],['items[1].missing','需检查资料','missing_review'],['items','结构问题','items_shape_or_count'],['items[0].id','编号错误','item_id'],['items[0].status','状态错误','item_status'],['private-id','private-text','other']];
 const records=[],observe=thesisAgentDiagnostic({thesisDiagnosticsEnabled:true,thesisDiagnosticSink:value=>records.push(value)},{id:'unit'},1);
 for(const [field,rule,expected] of cases){const category=supplementValidationCategory({code:'supplement_evidence',field,rule});assert.equal(category,expected);observe({tool:'submit_writing_output',status:'completed',accepted:false,code:'supplement_evidence',category,field,rule});}
 assert.doesNotMatch(JSON.stringify(records),/private|原文|证据|图片/);assert.equal(records.length,cases.length);
});
