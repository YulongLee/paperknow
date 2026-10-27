import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceJobLabel,workspaceJobStatusLabel,workspaceJobActive,workspaceJobHref} from '../dist/workspace/workspace-job-model.mjs';

test('specialized research jobs retain truthful names and their exact recovery route',()=>{
 for(const [row,label,href]of[
  [{id:'web-owned',type:'web_similarity'},'论文重复率检测','#category/detection?view=web&report=web-owned'],
  [{id:'aigc-owned',type:'aigc_detection'},'AI 文本鉴别','#category/detection?view=ai&report=aigc-owned'],
  [{id:'thesis-job',type:'thesis',thesis_id:'owned-thesis'},'毕业论文撰写','#thesis/owned-thesis'],
  [{type:'writing',writing_kind:'proposal',writing_operation:'outline'},'开题报告 · 提纲生成','#tool/proposal'],
  [{id:'ppt-job',type:'tool_run',tool_kind:'presentation',tool_operation:'ppt'},'演示文稿创作','#tool/ppt?job=ppt-job'],
  [{type:'document_translation'},'整篇文档翻译','#tool/translation'],
  [{type:'document_parse'},'PDF 云解析','#projects?scope=account'],
 ]){assert.equal(workspaceJobLabel(row),label);assert.equal(workspaceJobHref(row),href);}
 assert.equal(workspaceJobLabel({type:'unknown-provider-secret'}),'研究任务');
 assert.equal(workspaceJobHref({type:'web_similarity',id:'javascript:alert(1)'}),'#tasks?scope=account');
});
test('preparing remains active and has a readable state without pretending a task has started',()=>{
 assert.equal(workspaceJobStatusLabel('preparing'),'保存中');assert.equal(workspaceJobActive({status:'preparing'}),true);
 for(const status of ['queued','running'])assert.equal(workspaceJobActive(status),true);
 for(const status of ['completed','failed','cancelled'])assert.equal(workspaceJobActive({status}),false);
 assert.equal(workspaceJobStatusLabel('draft'),'草稿');
 assert.equal(workspaceJobStatusLabel('opaque-provider-status'),'状态待核对');
});
test('completed jobs open saved results while specialized evidence and editable job routes retain priority',()=>{
 for(const row of[
  {type:'parse'},
  {type:'writing',writing_kind:'proposal'},
  {type:'document_translation'},
  {type:'tool_run',tool_kind:'literature',tool_operation:'read'},
  {type:'thesis_outline'},
 ])assert.equal(workspaceJobHref({...row,status:'completed',result_id:'owned-result_1'}),'#assets?scope=account&result=owned-result_1');
 assert.equal(workspaceJobHref({type:'web_similarity',id:'web-task',status:'completed',result_id:'owned-result'}),'#category/detection?view=web&report=web-task');
 assert.equal(workspaceJobHref({type:'thesis',id:'thesis-task',thesis_id:'saved-thesis',status:'completed',result_id:'owned-result'}),'#thesis/saved-thesis');
 assert.equal(workspaceJobHref({type:'tool_run',id:'ppt-task',tool_operation:'ppt',status:'completed',result_id:'owned-result'}),'#tool/ppt?job=ppt-task');
 for(const status of ['running','failed'])assert.equal(workspaceJobHref({type:'writing',writing_kind:'proposal',status,result_id:'owned-result'}),'#tool/proposal');
 assert.equal(workspaceJobHref({type:'parse',status:'completed',result_id:'javascript:alert(1)'}),'#projects?scope=account');
});
