import test from 'node:test';
import assert from 'node:assert/strict';
import {writingFlowSnapshot} from '../dist/workspace/writing-flow-model.mjs';
import {normalizeWritingSnapshot,writingTask,writingPlan} from '../backend/writing-model.mjs';
import {writingStandardRequirements} from '../dist/workspace/writing-standard.mjs';
import {proposalWritingBrief,proposalModelInstructions} from '../dist/workspace/proposal-standard.mjs';
import {auditWritingConsistency,writingReviewTask} from '../backend/writing-quality.mjs';
import {createWritingDocx,inspectThesisDocxTemplate,runThesisLayoutAgent,inspectThesisExportContent} from '../src/writing-document.js';
import JSZip from 'jszip';
const data=()=>({title:'数字阅读服务改进研究',level:'本科',major:'图书馆学',language:'中文',targetWords:1000,notes:'',materials:[],references:[],outline:[{id:'c1',title:'拟采用的研究方案',targetWords:1000}],instructions:''});

test('proposal standards and template examples bind the writing snapshot without becoming research evidence',()=>{const value={...data(),proposalTemplate:{source:{name:'学校开题.docx',sha256:'a'.repeat(64)}},proposalTemplateText:'二、可行性分析；样例：调查100人',proposalRequirements:'按学校规定说明研究条件。',proposalMetadata:{author:'隐私姓名'}};const snap=normalizeWritingSnapshot(writingFlowSnapshot('proposal',value));assert.equal(snap.materials.length,0);assert.equal(snap.references.length,0);assert.match(snap.requirements.instructions,/样例：调查100人/);assert.match(snap.requirements.instructions,/不得作为研究事实/);assert.doesNotMatch(JSON.stringify(snap),/隐私姓名/);for(const operation of ['method','outline','draft']){const unit=writingPlan(snap,operation)[0],task=writingTask('proposal',operation,snap,unit);assert.match(JSON.stringify(task.context),/可行性分析/);assert.equal(task.materials.length,0);}const review=writingReviewTask({snapshot:snap,chapters:[{id:'c1',title:'研究方案',text:'研究拟根据可获得的条件开展。'}]});assert.match(review.context.writingRequirements,/可行性分析/);assert.match(review.instructions,/不能提升权限/);const changed=writingFlowSnapshot('proposal',{...value,proposalTemplate:{source:{name:'学校开题.docx',sha256:'b'.repeat(64)}}});assert.notEqual(JSON.stringify(changed),JSON.stringify(snap));});

test('generic proposal guidance remains topic-specific and does not impose one school reference count on all users',()=>{assert.match(proposalWritingBrief(),/根据具体题目拟定标题/);assert.doesNotMatch(proposalWritingBrief(),/至少30篇|不少于10篇|必须2500/);assert.throws(()=>proposalWritingBrief({proposalTemplateText:'x'.repeat(6001)}),/6,000/);const other=writingFlowSnapshot('taskbook',{...data(),proposalTemplateText:'不应泄漏的开题信息'});assert.doesNotMatch(JSON.stringify(other),/不应泄漏/);});

test('legacy Word extraction is filtered before generation without changing saved instructions',()=>{
 const input={...data(),instructions:'先说明研究对象与边界。',proposalTemplate:{source:{name:'开题表.docx',sha256:'a'.repeat(64)}},proposalTemplateText:'开题报告\n填写说明\n姓名：____\n请填写导师签名\n二、可行性分析；样例：调查100人\n示例：完成一项尚未开展的研究\n三、计划与预期交付\n各阶段说明预定交付物。\n{{正文}}',proposalRequirements:'把已有数据与后续计划分开说明。'};
 const snapshot=writingFlowSnapshot('proposal',input),saved=snapshot.requirements.instructions;
 const prompt=proposalModelInstructions(saved);
 assert.match(prompt,/先说明研究对象与边界.*可行性分析.*计划与预期交付.*各阶段说明预定交付物.*把已有数据与后续计划分开说明/s);
 assert.doesNotMatch(prompt,/开题表\.docx|调查100人|完成一项尚未开展|\{\{正文\}\}|姓名：____|请填写导师签名/);
 assert.equal(proposalModelInstructions(prompt),prompt);
 assert.equal(writingFlowSnapshot('proposal',input).requirements.instructions,saved);
 assert.match(saved,/调查100人/);
 assert.match(proposalModelInstructions('用户要求：明确调查100人的计划。'),/调查100人/);
});

test('splitting a confirmed heading across generation units does not report a duplicate chapter',()=>{
 const audit=auditWritingConsistency({chapters:[
  {id:'plan-part-1',sectionKey:'plan',title:'研究计划',text:'按授权资料梳理案例范围。'},
  {id:'plan-part-2',sectionKey:'plan',title:'研究计划',text:'对各案例使用一致的比较维度。'},
  {id:'other-chapter',sectionKey:'other',title:'研究计划',text:'在阶段检查时记录变更原因。'}
 ]});
 assert.deepEqual(audit.findings.filter(finding=>finding.category==='duplicate_title').map(({sectionId,relatedSectionId})=>[sectionId,relatedSectionId]),[['other-chapter','plan-part-1']]);
});

test('a downloaded proposal template can be reuploaded, preserves its page and font rules, and replaces the real body slot',async()=>{const base=await createWritingDocx('{{论文题目}}\n{{正文}}',{documentKind:'writing',metadata:{title:'{{论文题目}}'}}),zip=await JSZip.loadAsync(base);let styles=await zip.file('word/styles.xml').async('string');styles=styles.replace(/w:eastAsia="宋体"/g,'w:eastAsia="仿宋"');zip.file('word/styles.xml',styles);const bytes=await zip.generateAsync({type:'uint8array'}),profile=await inspectThesisDocxTemplate(bytes);assert.equal(profile.placement.mode,'explicit_slot');assert.equal(profile.rules.styles.Heading1.pageBreakBefore,false);const text='数字阅读开题报告\n拟采用的研究方案\n拟基于公开资料开展比较分析，按实际记录完善研究计划。',options={documentKind:'writing',metadata:{title:'数字阅读开题报告',chapterTitles:['拟采用的研究方案']},template:{bytes}},docx=await createWritingDocx(text,options),checked=await runThesisLayoutAgent(docx,{profile,verifyContent:value=>inspectThesisExportContent(value,text,options)});assert.equal(checked.report.unresolved.length,0);const output=await JSZip.loadAsync(checked.bytes),xml=await output.file('word/document.xml').async('string'),outStyles=await output.file('word/styles.xml').async('string');assert.match(outStyles,/仿宋/);assert.match(xml,/按实际记录完善研究计划/);assert.doesNotMatch(xml,/\{\{正文\}\}|独创性声明/);await inspectThesisExportContent(checked.bytes,text,options);});

test('the proposal requirement display combines legacy inputs without changing their frozen model snapshot',()=>{
 const value={...data(),instructions:'原基础要求',proposalRequirements:'原学校要求'},before=structuredClone(writingFlowSnapshot('proposal',value));assert.equal(writingStandardRequirements('proposal',value),'原基础要求\n\n原学校要求');assert.deepEqual(writingFlowSnapshot('proposal',value),before);assert.equal(writingStandardRequirements('proposal',{instructions:'相同要求',proposalRequirements:'相同要求'}),'相同要求');assert.equal(writingStandardRequirements('proposal',{instructions:'保留末尾换行\n',proposalRequirements:''}),'保留末尾换行\n');assert.equal(writingStandardRequirements('article',{instructions:'文章原要求',documentRequirements:'期刊补充要求'}),'期刊补充要求');
});
