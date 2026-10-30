import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfContentAlignment,pdfTextLines,pdfTextSegments} from '../dist/workspace/pdf-content-alignment.mjs';
const line=(text,page,y,x=.12)=>({text,page,y,x,h:.015});
const source=[line('Abstract',1,.15),line('A shared architecture called SheepNet solves identification using 128 samples.',1,.22),line('1 Introduction',1,.38),line('The research problem concerns stable identification.',1,.45),line('2 Method',2,.15),line('The SheepNet encoder uses a 0.25 threshold for identity matching.',2,.24),line('Table 1: Dataset split',2,.5),line('3 Results',3,.1),line('The BLEU measurement is 28.4 on the complete benchmark.',3,.3),line('References',3,.8)];
const translated=[line('摘要',1,.4),line('名为 SheepNet 的共享架构使用 128 个样本解决识别问题。',1,.55),line('1 引言',2,.1),line('研究问题涉及稳定的身份识别。',2,.25),line('2 方法',4,.35),line('SheepNet 编码器使用 0.25 的阈值进行身份匹配。',4,.6),line('表 1：数据集划分',5,.2),line('3 结果',6,.15),line('完整基准测试的 BLEU 测量值为 28.4。',6,.45),line('参考文献',7,.25)];
test('different pagination maps matching sections and paragraphs, never a page-count ratio',()=>{
 const map=createPdfContentAlignment(source,translated);assert.equal(map.mode,'content');assert.ok(map.anchors>=5);
 const method=map.map({page:2,pageCount:3,fraction:.15,scale:1.25,readingX:.12});assert.equal(method.page,4);assert.equal(method.fraction,.35);
 const paragraph=map.map({page:2,pageCount:3,fraction:.24,readingX:.12});assert.equal(paragraph.page,4);assert.equal(paragraph.fraction,.6);
 const backwards=map.map({page:4,pageCount:7,fraction:.6,readingX:.12},'reverse');assert.equal(backwards.page,2);assert.equal(backwards.fraction,.24);
});
test('equal page counts still use paragraph locations instead of assuming equal layout',()=>{
 const left=source.filter(x=>x.page===1),right=translated.filter(x=>x.page<=2).map(x=>({...x,page:1})),map=createPdfContentAlignment(left,right);assert.equal(map.map({page:1,fraction:.22,readingX:.12}).fraction,.55);
});
test('page footers and scans cannot become evidence of paragraph alignment',()=>{
 const content={items:[{str:'1',transform:[1,0,0,10,100,5],width:6,height:10},{str:'2 Method',transform:[1,0,0,10,30,700],width:80,height:10,hasEOL:true}]},viewport={width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]};const lines=pdfTextLines(content,viewport,1);assert.equal(lines.length,1);assert.equal(lines[0].text,'2 Method');assert.equal(createPdfContentAlignment([],lines).mode,'approximate');assert.equal(createPdfContentAlignment([],lines).map({page:1}),null);assert.equal(createPdfContentAlignment([line('Unrelated text.',1,.2)],[line('完全不同的文字。',1,.8)]).map({page:1}),null);
});
test('wrapped sentences and translated merged paragraphs retain their line offsets',()=>{
 const segments=pdfTextSegments([line('An identification method uses',1,.2),line('SheepNet to extract features.',1,.22)]);assert.equal(segments.length,1);assert.equal(segments[0].points.length,2);assert.ok(segments[0].points[1].offset>0);
 const a=[line('1 Method',1,.1),line('The first stage builds a stable representation.',1,.2),line('A second stage matches recorded identities.',1,.3),line('2 Results',2,.1)],b=[line('1 方法',1,.1),line('第一阶段构建稳定的表示，第二阶段匹配已记录的身份。',2,.5),line('2 结果',3,.1)],map=createPdfContentAlignment(a,b);assert.equal(map.map({page:1,fraction:.2}).page,2);assert.equal(map.map({page:1,fraction:.3}).page,2);
});
test('multiple columns use reading focus to avoid selecting another column at the same height',()=>{
 const a=[line('1 Method',1,.1),line('Use AlphaNet features.',1,.3,.1),line('Use BetaNet matching.',1,.3,.6)],b=[line('1 方法',2,.1),line('使用 AlphaNet 特征。',2,.25,.1),line('使用 BetaNet 进行匹配。',2,.6,.1)],map=createPdfContentAlignment(a,b);assert.equal(map.map({page:1,fraction:.3,readingX:.1}).fraction,.25);assert.equal(map.map({page:1,fraction:.3,readingX:.6}).fraction,.6);
});
test('repeated running headers and rotated margin labels never displace body matches',()=>{
 const rows=[line('Research journal | 2026',1,.04),line('1 Method',1,.15),line('Method body with SheepNet.',1,.3),line('Research journal | 2026',2,.04),line('2 Results',2,.15)];assert.ok(pdfTextSegments(rows).every(p=>!p.text.includes('Research journal')));
 const viewport={width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]};assert.equal(pdfTextLines({items:[{str:'arXiv margin',transform:[0,10,-10,0,20,200],width:100,height:10}]},viewport,1).length,0);
});
test('matching a heading below the viewport keeps its screen offset instead of snapping the other side to the top',()=>{
 const map=createPdfContentAlignment(source,translated),normalized=map.map({page:2,fraction:0,readingX:.12});assert.ok(Math.abs(normalized.fraction-.2)<.0001);
 const pixels=map.map({page:2,fraction:0,readingX:.12,pageHeight:1000});assert.equal(pixels.fraction,.35);assert.equal(pixels.anchorGap,-150);
});
test('page-edge margins are carried as a signed pixel gap during content synchronization',()=>{
 const map=createPdfContentAlignment(source,translated),view=map.map({page:2,fraction:0,readingX:.12,pageHeight:1000,pageOffset:-15});assert.equal(view.anchorGap,-165);
});
test('a nearby row in the other column does not override the column the user is reading',()=>{
 const a=[line('1 Method',1,.1),line('Use AlphaNet features.',1,.32,.1),line('Use BetaNet matching.',1,.3,.6)],b=[line('1 方法',2,.1),line('使用 AlphaNet 特征。',2,.25,.1),line('使用 BetaNet 进行匹配。',2,.6,.1)],map=createPdfContentAlignment(a,b);assert.ok(Math.abs(map.map({page:1,fraction:.3,readingX:.1}).fraction-.23)<.001);assert.equal(map.map({page:1,fraction:.3,readingX:.6}).fraction,.6);
});
