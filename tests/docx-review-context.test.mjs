import test from 'node:test';
import assert from 'node:assert/strict';
import {attachDocxReviewContext} from '../backend/docx-review-context.mjs';
import {runSupplementCheck} from '../backend/supplement-check.mjs';
import {createWritingQualityRunner} from '../backend/writing-quality-runner.mjs';
const eq='obj-aaaaaaaaaaaaaaaaaaaaaaaa',image='obj-bbbbbbbbbbbbbbbbbbbbbbbb',privateId='obj-cccccccccccccccccccccccc';
const mathML='<math><mfrac><mi>x</mi><mi>y</mi></mfrac></math>';
const objects=[{id:eq,kind:'formula',mathML,plaintext:'xy',xml:'PRIVATE XML'}, {id:image,kind:'image',label:'不能当作图像内容',media:[{data:'PRIVATE IMAGE'}]}, {id:privateId,kind:'formula',mathML:'PRIVATE OTHER'}];
const text=`理论表达 [docx:${eq}]。\n\n| 输入 | 输出 |\n| --- | --- |\n| 2 | 4 |\n\n[docx:${image}]`;
const chapter={id:'chapter',title:'算例',text};
test('only matching structured equation is provided; no images, foreign data or mistaken arithmetic from flattened text',()=>{
 const task={context:{},instructions:''};attachDocxReviewContext(task,[chapter],objects);
 assert.deepEqual(task.context.importedDocxObjects,[{id:eq,kind:'formula',mathML,conversion:'from_uploaded_word_equation'},{id:image,kind:'image',visualContent:'not_provided'}]);
 assert.doesNotMatch(JSON.stringify(task.context),/PRIVATE|不能当作图像内容|"plaintext"/);
 assert.match(task.instructions,/没有读取图片像素/);assert.match(task.instructions,/用户陈述而非视觉识别/);assert.match(task.instructions,/普通表格已以正文文本提供/);
});
test('large formulas and unavailable objects are never presented as complete equations',()=>{
 const task={context:{},instructions:''};attachDocxReviewContext(task,[{text:`[docx:${eq}] [docx:${privateId}]`}],[{id:eq,kind:'formula',mathML:'x'.repeat(6001)}]);
 assert.deepEqual(task.context.importedDocxObjects,[{id:eq,kind:'formula',status:'structured_expression_unavailable'},{id:privateId,status:'unavailable'}]);
});
test('supplement audit dispatch sees formula and table but no image pixels',async()=>{
 let observed;const report=await runSupplementCheck({snapshot:{materials:[],references:[]},chapters:[chapter],docxObjects:objects,kind:'thesis',dispatch:async({task})=>{observed=task;return {text:JSON.stringify({items:task.context.chapters.map(c=>({id:c.id,status:'not_required',requirement:'理论算例',reason:'仅为理论表达。',manuscriptQuote:c.text.slice(0,30),evidence:[],missing:[]}))})};}});
 assert.equal(report.status,'final_ready');assert.match(observed.context.chapters[0].text,/\| 2 \| 4 \|/);assert.equal(observed.context.importedDocxObjects[0].mathML,mathML);assert.equal(observed.context.importedDocxObjects[1].visualContent,'not_provided');assert.deepEqual(report.imageLimitations,[{version:1,kind:'visual_not_read',objectId:image,chapterId:'chapter',offset:text.indexOf('[docx:'+image+']')}]);assert.match(observed.instructions,/具体关系、数据或正文事实缺乏依据/);assert.doesNotMatch(JSON.stringify(observed),/PRIVATE/);
});
test('quality audit retains image review limitation while forwarding equation',async()=>{
 let seen;const verifier={verify:async()=>({items:[],summary:{},limitations:[]})};
 const runner=createWritingQualityRunner({citationVerifier:verifier});const result=await runner({chapters:[chapter],docxObjects:objects,checkSupplements:false,dispatch:async({task})=>{seen=task;return {text:JSON.stringify({complete:true,findings:[],limitations:[]})};}});
 assert.equal(seen.context.importedDocxObjects[0].mathML,mathML);assert.match(result.limitations.join(''),/未读取图片内容/);assert.doesNotMatch(JSON.stringify(seen),/PRIVATE/);
});
