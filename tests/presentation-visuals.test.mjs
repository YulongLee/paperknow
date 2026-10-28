import test from 'node:test';
import assert from 'node:assert/strict';
import {pptMasterDesignPlan,validatePptMasterVisibleText} from '../backend/ppt-master-model.mjs';
import {presentationVisualKind,presentationChartRows,presentationVisualRetained} from '../backend/presentation-visuals.mjs';
import {validatedPresentationLayout} from '../backend/presentation-layout.mjs';
import {createPptMasterRuntime,getPptMasterRuntimeStatus} from '../backend/ppt-master-runtime.mjs';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {visualFixture} from './fixtures/presentation-visuals.mjs';

test('process, architecture, comparisons and sourced numeric bars are editable visuals with exact accepted text',()=>{
 const f=visualFixture(),kinds=['cover','process','architecture','comparison','bars','concepts','concepts',null];for(const [i,slide]of f.slides.entries()){const page=validatedPresentationLayout(f.value,slide,f.plan);assert.equal(page.visualKind,kinds[i]);assert.equal(validatePptMasterVisibleText(page.svg,slide,f.plan),true);assert.equal(presentationVisualRetained(page.svg,page.visualKind),true);assert.doesNotMatch(page.svg,/<image|href=|foreignObject|<script/);if(page.visualKind)assert.ok((page.svg.match(/<(rect|circle|line|polygon)\b/g)||[]).length>=5);if(page.visualKind==='process')assert.match(page.svg,/<polygon/);if(['comparison','concepts'].includes(page.visualKind))assert.doesNotMatch(page.svg,/<polygon/);}
});
test('a single accepted paragraph receives a topic illustration without inventing a chart or splitting its wording',()=>{
 const f=visualFixture(),slide={...f.slides[1],title:'图像识别研究背景',body:'图像识别模型通过已有样本提取特征，本次汇报围绕材料中说明的研究方法与实际应用场景展开，不加入额外的测量结果。'},page=validatedPresentationLayout(f.value,slide,f.plan);assert.equal(page.visualKind,'illustration');assert.equal(validatePptMasterVisibleText(page.svg,slide,f.plan),true);assert.equal(presentationVisualRetained(page.svg,'illustration'),true);assert.doesNotMatch(page.svg,/<polygon/);
});
test('measurements are charted only when all rows are explicit comparable values, never invented from prose',()=>{
 for(const body of ['样本量：500\n训练轮次：100','准确率达到90%，但数据集仍需核对\n样本共100个','模型甲：90%\n模型乙：20ms','模型甲：190%\n模型乙：20%','模型甲：90%\n未提供结果','模型甲：0%\n模型乙：0%']){const slide={title:'研究结果',body,layout:'content'};assert.equal(presentationChartRows(slide),null);assert.notEqual(presentationVisualKind(slide),'bars');}
 assert.deepEqual(presentationChartRows({body:'甲：82.5%\n乙：91.2%'}).map(r=>r.value),[82.5,91.2]);assert.equal(presentationVisualKind({title:'研究方法',body:'读取材料\n检查来源',layout:'content'}),'concepts');assert.equal(presentationVisualRetained('<svg><rect/></svg>','process'),false);assert.equal(presentationVisualRetained('<svg><g id="visual-process"/><rect/><circle/><path/></svg>','process'),false);
});
test('five and six real process steps retain readable diagrams instead of degrading into a text-only page',()=>{
 const f=visualFixture();for(const count of [5,6]){const slide={...f.slides[1],title:'研究处理流程',body:Array.from({length:count},(_,i)=>'处理阶段'+(i+1)+'：核对本阶段已有材料并保存原始记录').join('\n')},page=validatedPresentationLayout(f.value,slide,f.plan);assert.equal(page.visualKind,'process');assert.equal(page.body,slide.body);assert.equal(validatePptMasterVisibleText(page.svg,slide,f.plan),true);assert.equal(presentationVisualRetained(page.svg,'process'),true);assert.equal((page.svg.match(/<polygon\b/g)||[]).length,count-1);}
});
test('long titles leave a separate illustration zone and tiny original values do not break export geometry',()=>{
 const f=visualFixture(),slide={...f.slides[1],title:'图像识别研究问题'.repeat(13),body:'核对原有研究材料，围绕图像模型的实际研究范围介绍方法与应用场景。'},page=validatedPresentationLayout(f.value,slide,f.plan),doc=new DOMParser().parseFromString(page.svg,'image/svg+xml'),groups=Array.from(doc.getElementsByTagName('g')),title=groups.find(n=>n.getAttribute('id')==='slide-title').getAttribute('data-pptx-bounds').split(' ').map(Number),circle=groups.find(n=>n.getAttribute('id')==='visual-illustration').getElementsByTagName('circle')[0];assert.ok(Number(circle.getAttribute('cy'))-Number(circle.getAttribute('r'))>=title[1]+title[3]);assert.equal(validatePptMasterVisibleText(page.svg,slide,f.plan),true);
 const tiny={...f.slides[4],body:'模型甲：0.000001%\n模型乙：99.999999%'};assert.equal(validatedPresentationLayout(f.value,tiny,f.plan).visualKind,'bars');
});
test('English content keeps complete words in readable lines while preserving every accepted character',()=>{
 const f=visualFixture(),slide={...f.slides[1],title:'Image representation methodology',body:'Preparation: Standardization preserves authorized dataset dimensions\nRepresentation: Feature extraction preserves original measurement definitions\nVerification: Reproducibility requires original experimental documentation'},page=validatedPresentationLayout(f.value,slide,f.plan),doc=new DOMParser().parseFromString(page.svg,'image/svg+xml'),words=new Set(slide.body.match(/[A-Za-z]+/g));assert.ok(page.visualKind);assert.equal(validatePptMasterVisibleText(page.svg,slide,f.plan),true);for(const group of Array.from(doc.getElementsByTagName('g')).filter(n=>n.getAttribute('id').startsWith('content-')))for(const node of Array.from(group.getElementsByTagName('text')))for(const word of node.textContent.match(/[A-Za-z]+/g)||[])assert.ok(words.has(word),'Word was split: '+word);
});
test('real PPTX compilation retains every diagram, original value, editable text and speaker note',async t=>{
 if(!getPptMasterRuntimeStatus().ready)return t.skip('原生编译器未安装');const f=visualFixture(),slides=f.slides.map(slide=>validatedPresentationLayout(f.value,slide,f.plan)),rendered=await createPptMasterRuntime().render({slides,title:f.value.snapshot.title}),zip=await JSZip.loadAsync(rendered.pptx);assert.equal(rendered.validation.slideCount,8);assert.ok(rendered.validation.nativeShapeCount>150);for(const [i,slide]of slides.entries()){const xml=await zip.file('ppt/slides/slide'+(i+1)+'.xml').async('string');assert.doesNotMatch(xml,/<p:pic\b/);assert.match(xml,/<a:t>/);if(i===1)assert.match(xml,/prst="(?:chevron|triangle|rtTriangle)"|<a:custGeom/);if(i===4){assert.match(xml,/82.5%/);assert.match(xml,/91.2%/);assert.match(xml,/0%/);}assert.ok(zip.file('ppt/notesSlides/notesSlide'+(i+1)+'.xml'));}
});
