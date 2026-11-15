import test from 'node:test';
import assert from 'node:assert/strict';
import {templateReferenceRequirementsHTML,completionPanelHTML,createCompletionDraft} from '../dist/workspace/thesis-completion-panel.mjs';

test('final preparation displays only the current selected template requirements',()=>{
 const item={chapters:[],snapshot:{},exportTemplate:{status:'ready',profile:{submission:{minimumReferences:10,minimumForeignReferences:3}}}};
 const content=()=>completionPanelHTML(item,createCompletionDraft(),{guided:true});
 assert.match(content(),/文献至少 10 条；外文文献至少 3 篇/);
 item.exportTemplate={status:'ready',profile:{submission:{minimumReferences:5}}};
 assert.match(content(),/文献至少 5 条/);assert.doesNotMatch(content(),/至少 10 条|至少 3 篇/);
 item.exportTemplate={status:'ready',profile:{}};assert.match(content(),/数量要求待识别/);assert.doesNotMatch(content(),/至少 5 条/);
 item.exportTemplate={status:'unavailable',profile:{submission:{minimumReferences:10}}};assert.match(content(),/模板暂不可用/);assert.doesNotMatch(content(),/至少 10 条/);
 item.exportTemplate=null;assert.doesNotMatch(content(),/学校模板识别到/);
});

test('empty recognized requirements do not invent a rule and invalid numbers are not displayed',()=>{
 assert.match(templateReferenceRequirementsHTML({status:'ready',profile:{submission:{}}}),/未从学校模板识别到明确/);
 assert.doesNotMatch(templateReferenceRequirementsHTML({status:'ready',profile:{submission:{minimumReferences:'<img>'}}}),/<img>/);
});
