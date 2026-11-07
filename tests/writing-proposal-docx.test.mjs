import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {createWritingDocx,createWritingTemplateDocx,inspectThesisDocxTemplate,inspectThesisExportContent,runThesisLayoutAgent} from '../src/writing-document.js';

const word='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const title='开放街区步行研究',heading='研究范围与取样方法';
const body='以三个既有街区为案例，拟使用公开街网与现场踏勘比较步行连通性。';
const text=[title,heading,body].join('\n');
const report={documentKind:'writing',writingKind:'proposal',submission:true,metadata:{title,chapterTitles:[heading]}};
const fields={college:'城市设计学院',studentId:'20260108',author:'测试作者'};
async function inspect(bytes){
 const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
 const doc=new DOMParser().parseFromString(xml,'application/xml');
 return {zip,xml,paragraphs:[...doc.getElementsByTagNameNS(word,'p')].map(paragraph=>paragraph.textContent)};
}
function options(extra={}){return {...report,metadata:{...report.metadata,...extra}};}

test('default proposal uses only provided cover values and one copy of the approved text',async()=>{
 const empty=await inspect(await createWritingDocx(text,report));
 assert.deepEqual(empty.paragraphs,[title,heading,body]);
 const details=await inspect(await createWritingDocx(text,options(fields)));
 assert.deepEqual(details.paragraphs,[title,'学院：城市设计学院','作者：测试作者','学号：20260108',heading,body]);
 assert.doesNotMatch(details.xml,/TOC|毕业论文|独创性声明|\{\{/);
});

test('the downloadable generic proposal template can be reused without empty optional metadata lines',async()=>{
 const template={bytes:await createWritingTemplateDocx('proposal')},profile=await inspectThesisDocxTemplate(template.bytes);
 assert.equal(profile.placement.mode,'explicit_slot');
 const original=await inspect(template.bytes);
 assert.ok(original.paragraphs.includes('学院：{{学院}}'));
 assert.ok(original.paragraphs.includes('学号：{{学号}}'));
 const selected={...options({author:fields.author}),template};
 const bytes=await createWritingDocx(text,selected),result=await inspect(bytes);
 assert.deepEqual(result.paragraphs,[title,'作者：测试作者',heading,body]);
 assert.equal((await inspectThesisExportContent(bytes,text,selected)).unresolvedPlaceholders,0);
});

test('school proposal body slot removes only labeled samples and a duplicated opening heading',async()=>{
 const source=['{{课题名称}}','学院：{{学院}}','学号：{{学号}}','指导教师：{{指导教师}}','【填写说明：示例段落，请删去】',heading,'{{正文}}','模板示例：示范段落','导师评审意见','导师签字：________'].join('\n');
 const original=await createWritingDocx(source,{...report,metadata:{title:'{{课题名称}}',chapterTitles:[heading]}});
 const archive=await JSZip.loadAsync(original),sample=await archive.file('word/document.xml').async('string');
 archive.file('word/document.xml',sample.replace('学院：{{学院}}','学院：</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>{{学</w:t></w:r><w:r><w:t>院}}').replace(/w:left="\d+"/g,'w:left="1984"').replace('<w:r><w:t xml:space="preserve">'+heading,'<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">'+heading));
 const template={bytes:await archive.generateAsync({type:'uint8array'})},selected={...options(fields),template};
 const result=await createWritingDocx(text,selected),checked=await inspect(result);
 assert.deepEqual(checked.paragraphs,[title,'学院：城市设计学院','学号：20260108','指导教师：',heading,body,'导师评审意见','导师签字：________']);
 assert.match(checked.xml,/<w:b\/><\/w:rPr><w:t>城市设计学院<\/w:t>/);
 assert.match(checked.xml,new RegExp('<w:i\\s*/></w:rPr><w:t xml:space="preserve">'+heading));
 assert.match(checked.xml,/w:left="1984"/);
 const profile=await inspectThesisDocxTemplate(template.bytes),verifyContent=bytes=>inspectThesisExportContent(bytes,text,selected);
 const layout=await runThesisLayoutAgent(result,{profile,verifyContent});
 assert.equal(layout.report.unresolved.length,0);
 assert.equal((await verifyContent(layout.bytes)).unresolvedPlaceholders,0);
 assert.match((await inspect(template.bytes)).xml,/填写说明/,'template original is unchanged');
});

test('format-only proposal template applies its style and does not discard provided metadata',async()=>{
 const original=await createWritingDocx('格式样例\n示例仅供确认字号。'),archive=await JSZip.loadAsync(original);
 archive.file('word/styles.xml',(await archive.file('word/styles.xml').async('string')).replaceAll('宋体','仿宋'));
 const template={bytes:await archive.generateAsync({type:'uint8array'})},selected={...options(fields),template};
 const profile=await inspectThesisDocxTemplate(template.bytes);
 assert.equal(profile.placement.mode,'rules_only');
 const bytes=await createWritingDocx(text,selected),result=await inspect(bytes);
 assert.deepEqual(result.paragraphs,[title,'学院：城市设计学院','作者：测试作者','学号：20260108',heading,body]);
 assert.match(await result.zip.file('word/styles.xml').async('string'),/仿宋/);
 assert.equal((await inspectThesisExportContent(bytes,text,selected)).unresolvedPlaceholders,0);
});

test('recognized school proposal body preserves the final approval form',async()=>{
 const original='{{标题}}\n学院：{{学院}}\n一、研究范围\n这里是学校模板的正文样例，用于确认正文区域和版式。\n指导教师评审意见\n指导教师签字：________';
 const template={bytes:await createWritingDocx(original,{...report,metadata:{title:'{{标题}}'}})},selected={...options(fields),template};
 const profile=await inspectThesisDocxTemplate(template.bytes);
 assert.equal(profile.placement.mode,'recognized_body');
 const bytes=await createWritingDocx(text,selected),result=await inspect(bytes);
 assert.deepEqual(result.paragraphs,[title,'学院：城市设计学院',heading,body,'指导教师评审意见','指导教师签字：________']);
 assert.equal((await inspectThesisExportContent(bytes,text,selected)).unresolvedPlaceholders,0);
});

test('export check reports unknown school template fields and leaves brace syntax in author text alone',async()=>{
 const source='{{标题}}\n{{正文}}\n项目编号：{{项目编号}}';
 const template={bytes:await createWritingDocx(source,{...report,metadata:{title:'{{标题}}'}})};
 const revised=text+'\n界面将 {{记录字段}} 显示为研究变量占位语法。';
 const selected={...report,template},bytes=await createWritingDocx(revised,selected);
 const check=await inspectThesisExportContent(bytes,revised,selected);
 assert.equal(check.unresolvedPlaceholders,1);
 const draft=await createWritingDocx(revised,{...selected,submission:false});
 assert.ok((await inspect(draft)).paragraphs.some(line=>line.includes('{{记录字段}}')));
});
