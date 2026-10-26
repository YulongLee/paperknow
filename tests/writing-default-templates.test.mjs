import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {writingDefaultTemplates,writingDefaultTemplateSpec} from '../dist/workspace/writing-template-catalog.mjs';
import {createWritingDocx,createWritingTemplateDocx,inspectThesisDocxTemplate,inspectThesisExportContent,defaultWritingTemplateProfile,runThesisLayoutAgent} from '../src/writing-document.js';
import {writingStandardPanel} from '../dist/workspace/writing-standard-panel.mjs';
import {writingExportTemplate} from '../dist/workspace/writing-standard.mjs';
const xmlOf=async bytes=>(await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');

test('each writing capability has an explicit versioned generic format without imposing a common outline',()=>{
 assert.deepEqual(Object.keys(writingDefaultTemplates).sort(),['writing','proposal','summary','taskbook','article','course','practice','idea','quick','questionnaire','analysis'].sort());
 for(const [kind,spec]of Object.entries(writingDefaultTemplates)){assert.equal(spec.kind,kind);assert.equal(spec.id,'paperknow-'+kind+'-v1');assert.ok(spec.name.includes('模板'));assert.equal(spec.outline,undefined);}
 assert.equal(writingDefaultTemplateSpec('__proto__'),null);assert.equal(writingDefaultTemplateSpec('constructor'),null);assert.equal(writingDefaultTemplateSpec('topic').kind,'idea');assert.equal(writingDefaultTemplateSpec('thesis').kind,'writing');
});

for(const kind of Object.keys(writingDefaultTemplates).filter(kind=>kind!=='writing'))test(kind+' has a real downloadable DOCX template with one recognized body slot and reusable styles',async()=>{
 const spec=writingDefaultTemplates[kind],bytes=await createWritingTemplateDocx(kind),profile=await inspectThesisDocxTemplate(bytes),xml=await xmlOf(bytes);
 assert.ok(bytes.byteLength>1000);assert.equal(profile.placement.mode,'explicit_slot');assert.equal((xml.match(/\{\{正文\}\}/g)||[]).length,1);assert.ok(xml.includes('{{标题}}'));
 const selected={version:1,status:'ready',bytes},text='合成'+spec.title+'验收\n任务分析\n这是用于验证通用格式的合成内容，不代表已经开展真实研究。';
 const options={documentKind:'writing',writingKind:kind,template:selected,metadata:{title:'合成'+spec.title+'验收',institution:'测试学校',author:'测试作者',major:'测试专业',supervisor:'测试教师',chapterTitles:['任务分析']}},output=await createWritingDocx(text,options),actual=await xmlOf(output);
 assert.ok(actual.includes('测试作者'));assert.equal(actual.includes('{{正文}}'),false);assert.equal(actual.includes('{{论文题目}}'),false);assert.equal(actual.includes('{{学校}}'),false);assert.equal(actual.includes('{{单位}}'),false);assert.equal(actual.includes('{{标题}}'),false);await inspectThesisExportContent(output,text,options);
});

for(const kind of ['proposal','summary','taskbook','article','course','practice','idea','quick','analysis'])test(kind+' uses its generic format automatically and passes the same format checks as an uploaded template',async()=>{
 const profile=defaultWritingTemplateProfile(kind),spec=writingDefaultTemplates[kind],title='通用格式合成验收',text=title+'\n问题分析\n本段只用于排版功能验收，实际文章按用户确认的提纲组织。\n方法讨论\n讨论已有资料的适用范围和需要核对的研究条件。',options={documentKind:'writing',writingKind:kind,metadata:{title,chapterTitles:['问题分析','方法讨论']}},bytes=await createWritingDocx(text,options);
 assert.equal(profile.templateId,spec.id);assert.equal(profile.templateName,spec.name);
 const result=await runThesisLayoutAgent(bytes,{profile,verifyContent:value=>inspectThesisExportContent(value,text,options)});assert.equal(result.report.unresolved.length,0);
 const zip=await JSZip.loadAsync(result.bytes),styles=await zip.file('word/styles.xml').async('string'),xml=await xmlOf(result.bytes);
 assert.ok(styles.includes('w:val="'+(spec.format.bodySize||24)+'"'));assert.equal(xml.includes('{{'),false);assert.equal(xml.includes('TOC \\o'),false);assert.equal(xml.includes('独创性声明'),false);
});

test('an uploaded template overrides the type default and resetting explicitly returns to the generic format',async()=>{
 const original=await createWritingTemplateDocx('course'),zip=await JSZip.loadAsync(original);zip.file('word/styles.xml',(await zip.file('word/styles.xml').async('string')).replaceAll('宋体','仿宋'));const template={version:1,status:'ready',bytes:await zip.generateAsync({type:'uint8array'})},text='自定义格式验收\n栏目分析\n实际正文按用户确认的文章结构生成。',options={documentKind:'writing',writingKind:'article',template,metadata:{title:'自定义格式验收',institution:'实际单位',author:'实际作者',major:'专业',chapterTitles:['栏目分析']}};
 const bytes=await createWritingDocx(text,options),used=await JSZip.loadAsync(bytes);assert.ok((await used.file('word/styles.xml').async('string')).includes('仿宋'));
 const selected=writingExportTemplate('article',{documentTemplate:template});assert.equal(selected,template);assert.equal(writingExportTemplate('article',{documentTemplate:template,documentExportTemplateSelectionMade:true,documentExportTemplate:null}),null);
 const panel=writingStandardPanel('practice',{}, {compact:true});assert.equal(panel,'','legacy delivery summaries cannot show another template entry');
});
