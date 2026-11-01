import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import JSZip from 'jszip';
import {normalizeThesisFigure,renderThesisFigureSvg,thesisFigureKinds,layoutThesisFigure} from '../dist/workspace/thesis-figure.mjs';
import {normalizeThesisSnapshot,thesisPlan,thesisAgentTask,parseThesisSection,selectThesisEvidence} from '../backend/thesis-model.mjs';
import {thesisDocumentPresentation,buildThesisBibliography} from '../dist/workspace/thesis-document.mjs';
import {createWritingDocx,inspectThesisExportContent} from '../src/writing-document.js';
import {figurePngFixture} from './helpers/thesis-figure-png.mjs';

const records='合成验收记录，不能当作真实研究。方法A 准确率 84%。方法B 准确率 91%。第1轮 准确率 80%。第2轮 准确率 88%。';
const plot=(kind='bar')=>({id:'result',title:'方法准确率对比',kind,caption:'来源为合成验收记录，仅用于功能测试。',data:{xLabel:'方法',yLabel:'准确率',unit:'%',series:[{name:'准确率',points:[{x:kind==='bar'?'方法A':1,y:kind==='bar'?84:80,sourceId:'record',quote:kind==='bar'?'方法A 准确率 84%':'第1轮 准确率 80%'},{x:kind==='bar'?'方法B':2,y:kind==='bar'?91:88,sourceId:'record',quote:kind==='bar'?'方法B 准确率 91%':'第2轮 准确率 88%'}]}]}});
const diagram=(kind='architecture')=>({id:'system',kind,title:'系统组成',nodes:[{id:'a',label:'输入模块',...(kind==='architecture'?{group:'输入层'}:kind==='comparison'?{details:['读取图像','输入质量检查']}:{})},{id:'b',label:'识别模块',...(kind==='architecture'?{group:'识别层'}:kind==='comparison'?{details:['提取特征','输出分类结果']}:{})}],edges:kind==='comparison'?[]:[{from:'a',to:'b'}],caption:'依据研究方案展示组成与关系。'});
const value=()=>normalizeThesisSnapshot({title:'识别系统性能研究',profile:{level:'本科',targetWords:500},requirements:{contentMode:'rich'},materials:[{id:'record',name:'合成原始记录',text:records,confirmed:true}],references:[],outline:[{id:'c',title:'性能对比',targetWords:500,presentation:{image:true}}]});
const output=figure=>({text:JSON.stringify({complete:true,draft:false,missing_evidence:[],text:'研'.repeat(500)+'\n[figure:'+figure.id+']\n[source:record]',source_ids:['record'],figures:[figure]}),trace:[{tool:'read_material',status:'completed',materialId:'record'}]});

test('seven academic figure forms render through bounded escaped SVG without any external image or executable markup',()=>{
 const samples=[diagram('flowchart'),diagram('concept'),diagram('architecture'),diagram('comparison'),plot('bar'),plot('line'),plot('scatter')];
 assert.equal(samples.length,thesisFigureKinds.length);
 for(const sample of samples){const before=structuredClone(sample),result=renderThesisFigureSvg(sample),errors=[],doc=new DOMParser({onError:(_level,message)=>errors.push(message)}).parseFromString(result.svg,'image/svg+xml');assert.deepEqual(errors,[]);assert.equal(result.width,1000);assert.ok(result.height>100&&result.height<4096);assert.equal(doc.getElementsByTagName('script').length,0);assert.equal(doc.getElementsByTagName('image').length,0);assert.doesNotMatch(result.svg,/href=|src=|foreignObject|onload=/i);assert.deepEqual(sample,before);}
 assert.match(renderThesisFigureSvg(diagram('architecture')).svg,/输入层/);assert.match(renderThesisFigureSvg(diagram('comparison')).svg,/输入质量检查/);
 assert.notEqual(renderThesisFigureSvg(diagram('concept')).height,renderThesisFigureSvg(diagram('flowchart')).height);
});

test('bar, line and scatter figures accept real supplied point records and retain provenance through namespace assignment',()=>{
 const snapshot=value(),unit=thesisPlan(snapshot)[0];
 for(const kind of ['bar','line','scatter']){const parsed=parseThesisSection(output(plot(kind)),snapshot,unit);assert.equal(parsed.figures[0].kind,kind);assert.deepEqual(parsed.figures[0].data.series[0].points,plot(kind).data.series[0].points);assert.match(parsed.figures[0].id,/^fig-/);}
});

test('a statistical figure cannot invent values, categories, quotes, unavailable sources or unread sources',()=>{
 const snapshot=value(),unit=thesisPlan(snapshot)[0];
 for(const change of [p=>p.data.series[0].points[0].y=99,p=>p.data.series[0].points[0].x='不存在的方法',p=>p.data.series[0].points[0].quote='方法A 准确率 99%',p=>p.data.series[0].points[0].sourceId='other-account',p=>p.data.series[0].name='不存在的指标']){const candidate=plot();change(candidate);assert.throws(()=>parseThesisSection(output(candidate),snapshot,unit),error=>error.code==='invalid_figure_evidence');}
 assert.throws(()=>parseThesisSection({...output(plot()),trace:[]},snapshot,unit),error=>error.code==='unread_source');
 const format=structuredClone(snapshot);format.materials[0].purpose='格式模板';assert.throws(()=>parseThesisSection(output(plot()),format,unit),error=>error.code==='invalid_figure_evidence');
});

test('chart normalization enforces safe numeric limits, explicit evidence, unique categories and a bounded payload',()=>{
 for(const change of [p=>p.data.series[0].points[0].y=Infinity,p=>p.data.series[0].points[0].y='84',p=>delete p.data.series[0].points[0].quote,p=>p.data.series[0].points[0].x='<script>x</script>',p=>p.data.series[0].points.push({...p.data.series[0].points[0]}),p=>p.nodes=[{id:'a',label:'ignored'}],p=>p.data.series[0].name='data:image/png;base64,x']){const candidate=plot();change(candidate);assert.throws(()=>normalizeThesisFigure(candidate));}
});

test('section purpose selects architecture, comparison and measured charts instead of defaulting every image to a flowchart',()=>{
 const snapshot=value(),unit=thesisPlan(snapshot)[0];
 for(const [title,kind] of [['系统总体架构','architecture'],['方案比较','comparison'],['理论概念关系','concept'],['实验结果','bar'],['训练曲线','line'],['双变量相关性','scatter'],['System architecture','architecture'],['Experimental results','bar']])assert.equal(thesisAgentTask(snapshot,{...unit,title,chapterTitle:title},[]).context.figureContract.recommendedKind,kind);
});

test('a result chapter or explicit architecture cannot silently substitute another generic flowchart',()=>{
 const snapshot=value(),unit=thesisPlan(snapshot)[0],flow=diagram('flowchart');
 for(const title of ['系统总体架构','实验结果','训练曲线'])assert.throws(()=>parseThesisSection(output(flow),snapshot,{...unit,title}),error=>error.code==='invalid_figure');
 assert.equal(parseThesisSection(output(flow),snapshot,{...unit,title:'实验设计流程'}).figures[0].kind,'flowchart');
});

test('confirmed imported literature is retained as a standard draft bibliography without inventing inline citation provenance',async()=>{
 const snapshot={title:'文献整理验收',references:[{id:'a',title:'甲文献',authors:'甲作者',year:'2025',documentType:'journal',journal:'甲期刊',confirmed:true},{id:'b',title:'乙文献',authors:'乙作者',year:'2024',confirmed:true}],materials:[]},chapters=[{id:'c',title:'正文',text:'这段正文尚未建立文献引用。'}],before=structuredClone(snapshot),draft=thesisDocumentPresentation(snapshot,chapters),final=thesisDocumentPresentation(snapshot,chapters,{submission:true});
 assert.match(draft.text,/参考文献\n\n\[1\] 甲作者/);assert.match(draft.text,/\[2\] 乙作者/);assert.doesNotMatch(draft.text,/待引用文献|未因选中/);assert.deepEqual(draft.citationRanges,[]);assert.equal(buildThesisBibliography(snapshot,chapters).counts.citations,0);assert.doesNotMatch(final.text,/甲文献|乙文献/);assert.deepEqual(snapshot,before);
 const bytes=await createWritingDocx(draft.text,{documentKind:'thesis'}),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');assert.match(xml,/甲文献/);assert.match(xml,/乙文献/);assert.doesNotMatch(xml,/待引用文献/);
});

test('imported readable papers retain candidate slots even when many internal materials compete for the evidence window',()=>{
 const snapshot=value();snapshot.materials=Array.from({length:12},(_,i)=>({id:'m'+i,name:'识别系统性能 '+i,text:records.repeat(10),confirmed:true}));snapshot.references=[{id:'paper',title:'识别系统性能文献',text:records,confirmed:true}];
 const selected=selectThesisEvidence(snapshot,thesisPlan(snapshot)[0]);assert.equal(selected.sources.length,10);assert.ok(selected.sources.some(row=>row.id==='paper'));assert.equal(selectThesisEvidence(snapshot,{title:'性能',sourceIds:['m0']}).sources[0].id,'m0');
});

test('all expanded figure types remain actual embedded DOCX images with intact figure captions',async()=>{
 for(const figure of [diagram('architecture'),diagram('comparison'),plot('bar'),plot('line'),plot('scatter')]){const text='合成论文\n第一章 结果\n相关论述。\n[figure:'+figure.id+']\n后续说明。',metadata={title:'合成论文',figures:[figure]},bytes=await createWritingDocx(text,{documentKind:'thesis',metadata,figureRasterizer:async()=>new Uint8Array(figurePngFixture())}),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');assert.match(xml,/w:drawing/);assert.match(xml,new RegExp(figure.title));assert.doesNotMatch(xml,/\[figure:/);assert.equal((await inspectThesisExportContent(bytes,text,{metadata})).figureSegments,1);}
});


test('rich diagram relation labels remain inside the canvas for dense long-label structures',()=>{
 for(const kind of ['concept','architecture'])for(let n=2;n<=8;n++){
  const nodes=Array.from({length:n},(_,i)=>({id:'n'+i,label:'模块'+i+' 研究对象特征表达与处理条件的说明'.repeat(3),...(kind==='architecture'?{group:'系统层次'+(i%3)}:{})})),edges=[];for(let i=0;i<n;i++)for(let j=i+1;j<n&&edges.length<12;j++)edges.push({from:'n'+i,to:'n'+j,label:'依据原始资料核对关联方向'});
  const layout=layoutThesisFigure({id:'dense',kind,title:'长标签验收',nodes,edges});for(const edge of layout.edges){assert.ok(edge.labelX>=105&&edge.labelX<=layout.width-105);assert.ok(edge.labelY>=24);assert.ok(edge.labelY+edge.labelLines.length*24<=layout.height);}
 }
});
