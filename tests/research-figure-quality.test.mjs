import test from 'node:test';
import assert from 'node:assert/strict';
import {researchFigureChoices} from '../dist/workspace/research-figure-catalog.mjs';
import {normalizePublicationFigurePlan} from '../backend/research-figure-plan.mjs';
import {publicationChartOption,renderPublicationVector,rasterPublicationVector} from '../backend/research-native-figure.mjs';
import {createScientificFigure,normalizeFigureReview} from '../backend/research-figure-quality.mjs';
import {validateResearchImage} from '../backend/research-image-client.mjs';
import {researchIllustrationPrompt} from '../backend/research-image-client.mjs';
import {pngFixture} from './fixtures/research-image.mjs';
const settings={enabled:true,model:'qwen-image-3.0',apiKey:'sk-private-fixture',version:'test-scientific',baseURL:'https://dashscope.aliyuncs.com',timeoutMs:1000};
const snapshot=(figureType='flowchart')=>({mode:'basic',title:'Save name',text:'A→B; sample indices 1 2 3 4 5 6 7 8; counts 9,10,11,10,9,11,10,10. UCL12 CL10 LCL8. Axis8..12 step1.',language:'English',context:{categoryId:'basic',figureType,aspectRatio:'4:3',palette:'academic'}});
const review=passed=>({passed,checks:['brief_fidelity','scientific_relations','numeric_accuracy','labels_legible','no_overlap_or_clipping','figure_grammar'].map(key=>({key,passed:passed||key!=='brief_fidelity',detail:passed?'Checked exact objects and relations':'Wrong object count; use the exact required number'}))});
const illustration={complete:true,figure:{kind:'illustration',artworkDescription:'An unlabeled visual arrangement of the specified parts.',description:'Two components A and B',requiredObjects:['A','B'],labels:['A','B']}};
const labelLayout=()=>({hasText:false,annotations:[{index:0,x:250,y:300},{index:1,x:750,y:700}]});
const illustrationSnapshot=()=>({...snapshot(),mode:'professional',context:{...snapshot().context,categoryId:'rendering',figureType:'3d-structure'}});
const chart=(chartType,data,extra={})=>({complete:true,figure:{kind:'chart',chartType,data,...extra}});
test('illustration prompts contain the normalized composition and labels, never internal source headings or review text',()=>{
 const s={...illustrationSnapshot(),text:'AUTHOR BRIEF source-only instructions and private file title',title:'private file title'},plan={kind:'illustration',artworkDescription:'An unlabeled visual arrangement of the specified parts.',description:'A gray base below a blue lens housing.',requiredObjects:['gray base','blue lens housing'],labels:['Base','Lens']},prompt=researchIllustrationPrompt(s,plan,{repairKeys:['labels_legible']});
 assert.match(prompt,/gray base/);assert.doesNotMatch(prompt,/"Base"/);assert.doesNotMatch(prompt,/AUTHOR BRIEF|source-only|private file title|STRICT VISIBLE|COMPOSITION:|REQUIRED OBJECTS:/);
});
test('text-only illustration defects reuse the composition and do not copy the rejected lettering into the next image prompt',async()=>{
 let plans=0,images=0,reviews=0;const prompts=[];
 const result=await createScientificFigure(illustrationSnapshot(),{settings,jsonRunner:async(_m,{phase})=>{
  if(phase==='planning'){plans++;return{value:illustration};}if(phase==='label_layout')return{value:labelLayout()};
  const value=review(true);if(phase==='review_confirm'||!reviews++){value.passed=false;value.checks=value.checks.map(c=>c.key==='labels_legible'?{...c,passed:false,detail:'Remove the unwanted AUTHOR BRIEF footer'}:c);}return{value};
 },imageRunner:async(_s,{prompt})=>{images++;prompts.push(prompt);return{buffer:pngFixture(),imageCount:1};}});
 assert.equal(result.review.passed,true);assert.equal(plans,1);assert.equal(images,2);assert.ok(prompts.every(p=>!p.includes('AUTHOR BRIEF')));assert.match(prompts[1],/Remove ALL lettering/);
});
test('English node wrapping keeps complete words instead of breaking Motivation or Engagement',async()=>{
 const s={...snapshot('path'),text:'Learning Support -> Learning Motivation -> Learning Engagement -> Learning Outcomes. H1 H2 H3 H4.'},plan=normalizePublicationFigurePlan({complete:true,figure:{kind:'diagram',nodes:['Learning Support','Learning Motivation','Learning Engagement','Learning Outcomes'].map((label,i)=>({id:String(i),label})),edges:[{from:'0',to:'1',label:'H1'},{from:'1',to:'2',label:'H2'},{from:'2',to:'3',label:'H3'},{from:'0',to:'3',label:'H4'}]}},s),r=await renderPublicationVector(plan,s);
 assert.match(r.svg,/>Motivation<\/text>/);assert.match(r.svg,/>Engagement<\/text>/);assert.doesNotMatch(r.svg,/>Motivatio<\/text>|>Engagemen<\/text>/);
});
test('qualitative author intent removes fabricated equal weights without discarding real quantitative measurements',()=>{
 const s={...snapshot('chord'),text:'A and B have a relation, no weights, equal width.'},raw=chart('chord',{nodes:[{id:'a',label:'A'},{id:'b',label:'B'}],links:[{from:'a',to:'b',value:1}]},{qualitative:false}),p=normalizePublicationFigurePlan(raw,s);
 assert.equal(p.qualitative,true);assert.equal(p.data.links[0].value,undefined);
 const weighted=normalizePublicationFigurePlan(raw,{...s,text:'A -> B, weight 1.'});assert.equal(weighted.qualitative,false);assert.equal(weighted.data.links[0].value,1);
 assert.throws(()=>normalizePublicationFigurePlan(raw,{...s,text:'A -> B, weight 25.'}),/没有的数据/);
});
test('derived tick intervals are presentation settings while source measurements and range bounds stay verified',()=>{
 const s={...snapshot('horizontal-bar'),text:'Scores A4.5 B4.0, axis 0 to 5.'},p=normalizePublicationFigurePlan(chart('horizontal-bar',{categories:['A','B'],series:[{name:'Score',values:[4.5,4]}]},{yRange:{min:0,max:5,interval:1}}),s),o=publicationChartOption(p,s);
 assert.equal(o.xAxis.min,0);assert.equal(o.xAxis.max,5);assert.equal(o.xAxis.interval,1);
 assert.throws(()=>normalizePublicationFigurePlan(chart('horizontal-bar',{categories:['A'],series:[{name:'Score',values:[99]}]}),s),/没有的数据/);
 const radar=normalizePublicationFigurePlan(chart('radar',{categories:['A','B','C'],series:[{name:'Score',values:[4,4,4]}]},{yRange:{min:0,max:5,interval:1}}),{...snapshot('radar'),text:'Scores A4 B4 C4.'});assert.equal(radar.yRange,null);
});
test('sequence participant and message aliases retain explicit return semantics without treating asynchronous calls as returns',async()=>{
 const s=snapshot('zenuml'),p=normalizePublicationFigurePlan({complete:true,figure:{kind:'sequence',participants:[{id:'web',label:'Web Page'},{id:'library',label:'Literature Repository'}],messages:[{from:'web',to:'library',label:'Query bibliographic records',type:'async'},{from:'library',to:'web',label:'Return bibliographic records',type:'return'}]}},s),r=await renderPublicationVector(p,s);
 assert.equal(p.edges[0].kind,'directed');assert.equal(p.edges[1].kind,'return');assert.match(r.svg,/stroke-dasharray="5 4"/);
});
test('quadrant geometry helpers stay out of visible text while labels and axis positions are rendered explicitly',async()=>{
 const s={...snapshot('matrix'),text:'Four quadrants Do, Plan, Delegate, Eliminate; axes Urgency and Importance.'},raw={complete:true,figure:{kind:'diagram',layout:'grid',nodes:[{id:'o',label:'',position:'center'},{id:'x',label:'Urgency',position:'x-axis'},{id:'y',label:'Importance',position:'y-axis'},...['Do','Plan','Delegate','Eliminate'].map((label,i)=>({id:'q'+i,label,position:['top-right','top-left','bottom-right','bottom-left'][i]}))],edges:[{from:'o',to:'x'},{from:'o',to:'y'}]}};
 const p=normalizePublicationFigurePlan(raw,s),r=await renderPublicationVector(p,s);assert.equal(p.nodes.length,6);assert.equal(p.edges.length,0);assert.equal((r.svg.match(/data-quadrant=/g)||[]).length,4);assert.match(r.svg,/>Urgency<\/text>/);assert.doesNotMatch(r.svg,/>top-right<\/text>/);
 assert.throws(()=>normalizePublicationFigurePlan({...raw,figure:{...raw.figure,edges:[{from:'o',to:'x',label:'meaningful relationship'}]}},s),{code:'figure_plan_invalid'});
});
test('qualitative sunburst keeps all parent-child relations without fabricated percentages or observed weights',async()=>{
 const s=snapshot('sunburst'),tree={name:'Methods',children:[{name:'Qualitative',children:[{name:'Interview'},{name:'Case'}]},{name:'Quantitative',children:[{name:'Experiment'},{name:'Survey'}]},{name:'Mixed',children:[{name:'Mixed design'}]}]};
 const plan=normalizePublicationFigurePlan(chart('sunburst',{hierarchy:tree},{qualitative:true}),s);assert.equal(plan.data.hierarchy.value,undefined);const option=publicationChartOption(plan,s);assert.deepEqual(option.series[0].data[0].children[1].children.map(x=>x.name),['Experiment','Survey']);assert.equal(option.series[0].data[0].children[0].children[0].value,1);assert.equal(option.series[0].label.formatter,undefined);
 const vector=await renderPublicationVector(plan,s),png=await rasterPublicationVector(vector);assert.ok(vector.svg.includes('Experiment'));assert.equal(validateResearchImage(png.buffer).width,2400);
});
test('chord renders actual ribbons for exactly the declared connections',async()=>{
 const s=snapshot('chord'),data={nodes:['CS','Education','Psychology','Design'].map(id=>({id,label:id})),links:[{from:'CS',to:'Education'},{from:'Education',to:'Psychology'},{from:'CS',to:'Design'}]};
 const plan=normalizePublicationFigurePlan(chart('chord',data,{qualitative:true}),s),option=publicationChartOption(plan,s);assert.equal(option.series[0].type,'chord');assert.equal(option.series[0].links.length,3);assert.ok(option.series[0].links.every(l=>l.value===1));const rendered=await renderPublicationVector(plan,s);assert.match(rendered.svg,/Education/);assert.doesNotMatch(rendered.svg,/<script/);
});
test('control chart plots the exact ordered observations, reference limits and explicit ticks',()=>{
 const s=snapshot('line'),values=[9,10,11,10,9,11,10,10],plan=normalizePublicationFigurePlan(chart('line',{categories:values.map((_,i)=>String(i+1)),series:[{name:'Observed',values}]},{referenceLines:[{label:'UCL',value:12},{label:'CL',value:10},{label:'LCL',value:8}],yRange:{min:8,max:12,interval:1}}),s),option=publicationChartOption(plan,s);
 assert.deepEqual(option.series[0].data,values.map((value,i)=>[i+1,value]));assert.deepEqual(option.series[0].markLine.data.map(r=>r.yAxis),[12,10,8]);assert.equal(option.yAxis.interval,1);assert.equal(option.yAxis.min,8);assert.equal(option.yAxis.max,12);
 assert.throws(()=>normalizePublicationFigurePlan(chart('line',{categories:['A'],series:[{name:'x',values:[99]}]}),s),{code:'figure_plan_invalid'});
});
test('empty axis settings do not reject complete data, while invalid cartesian ranges still fail',()=>{
 const s={...snapshot('bar'),text:'A=40, B=35, C=25.'},raw=chart('bar',{categories:['A','B','C'],series:[{name:'Share',values:[40,35,25]}]},{yRange:{}}),plan=normalizePublicationFigurePlan(raw,s);
 assert.equal(plan.yRange,null);assert.equal(publicationChartOption(plan,s).series[0].data[0],40);
 for(const yRange of [{min:0},{min:0,max:50,interval:10}])assert.throws(()=>normalizePublicationFigurePlan({...raw,figure:{...raw.figure,yRange}},s),{code:'figure_plan_invalid'});
});
test('uneven numeric line samples preserve true x positions and ordinary categories remain categorical',async()=>{
 const s={...snapshot('line'),text:'FPR0,0.1,0.2,0.4,1. TPR0,0.6,0.8,0.9,1.'},plan=normalizePublicationFigurePlan(chart('line',{categories:['0','0.1','0.2','0.4','1'],series:[{name:'ROC',values:[0,0.6,0.8,0.9,1]}]}),s),option=publicationChartOption(plan,s);
 assert.equal(option.xAxis.type,'value');assert.deepEqual(option.series[0].data,[[0,0],[0.1,0.6],[0.2,0.8],[0.4,0.9],[1,1]]);assert.ok((await renderPublicationVector(plan,s)).grammarVerified);
 for(const categories of [['A','B'],['001','002']]){const categorical=normalizePublicationFigurePlan(chart('line',{categories,series:[{name:'Observed',values:[9,10]}]}),snapshot('line'));assert.equal(publicationChartOption(categorical,s).xAxis.type,'category');}
});
test('malformed, cyclic, over-dense and unsupported plans do not reach unchecked rendering',async()=>{
 const s=snapshot();assert.throws(()=>normalizePublicationFigurePlan(illustration,s),{code:'figure_plan_invalid'});assert.throws(()=>normalizePublicationFigurePlan({complete:false,needs:'实际观测数据'},s),/请补充实际观测数据/);
 assert.throws(()=>normalizePublicationFigurePlan({complete:true,figure:{kind:'diagram',nodes:[{id:'A',label:'A'},{id:'A',label:'B'}]}},s),{code:'figure_plan_invalid'});
 const cyclic={kind:'chart',chartType:'sankey',data:{nodes:[{id:'a',label:'a'},{id:'b',label:'b'}],links:[{from:'a',to:'b',value:1},{from:'b',to:'a',value:1}]}};assert.throws(()=>publicationChartOption(cyclic,s),{code:'figure_render_invalid'});
 assert.throws(()=>normalizeFigureReview({passed:true,checks:review(false).checks}),{code:'figure_review_invalid'});assert.throws(()=>normalizeFigureReview({passed:true,checks:review(true).checks.slice(1)}),{code:'figure_review_invalid'});
});
test('sequence preserves recipient direction, dashed returns, self messages and alt branches',async()=>{
 const s=snapshot('sequence'),plan=normalizePublicationFigurePlan({complete:true,figure:{kind:'sequence',nodes:['User','Web','Parser','Storage'].map(id=>({id,label:id,role:'actor'})),edges:[{from:'User',to:'Web',label:'Upload'},{from:'Web',to:'Parser',label:'Parse'},{from:'Parser',to:'Storage',label:'Save'},{from:'Parser',to:'Web',label:'Return',kind:'return'},{from:'Parser',to:'Web',label:'Error',kind:'return'}],fragments:[{label:'alt',branches:[{label:'Success',start:2,end:3},{label:'Failure',start:4,end:4}]}]}},s);const result=await renderPublicationVector(plan,s);assert.match(result.svg,/data-edge="Parser:Web"/);assert.match(result.svg,/stroke-dasharray="5 4"/);assert.match(result.svg,/\[Failure\]/);
});
test('quality rejection triggers a bounded repair with specific feedback and never bypasses final review',async()=>{
 let images=0,reviews=0;const events=[],seen=[];
 const result=await createScientificFigure(illustrationSnapshot(),{settings,audit:e=>events.push(e),jsonRunner:async(messages,{phase})=>{seen.push(messages);return{value:phase==='planning'?illustration:phase==='label_layout'?labelLayout():phase==='review_confirm'?review(false):review(++reviews===2)};},imageRunner:async()=>{images++;return{buffer:pngFixture(),imageCount:1};}});
 assert.equal(images,2);assert.equal(result.review.passed,true);assert.ok(JSON.stringify(seen).includes('Wrong object count'));assert.equal(events.filter(e=>e.phase==='image'&&e.status==='started').length,2);
 let calls=0;await assert.rejects(()=>createScientificFigure(illustrationSnapshot(),{settings,jsonRunner:async(_m,{phase})=>({value:phase==='planning'?illustration:phase==='label_layout'?labelLayout():review(false)}),imageRunner:async()=>{calls++;return{buffer:pngFixture(),imageCount:1};}}),{code:'figure_quality_rejected'});assert.equal(calls,2);
});
test('transport errors, invalid reviews, invalid image count and cancellations are not blindly retried',async()=>{
 for(const failure of ['transport','review','count','cancel']){let images=0;const abort=new AbortController();await assert.rejects(()=>createScientificFigure(illustrationSnapshot(),{settings,signal:abort.signal,jsonRunner:async(_m,{phase})=>({value:phase==='planning'?illustration:phase==='label_layout'?labelLayout():failure==='review'?{passed:true}:review(true)}),imageRunner:async()=>{images++;if(failure==='transport')throw Object.assign(Error('ambiguous transport'),{code:'transport'});if(failure==='cancel')abort.abort();return{buffer:pngFixture(),imageCount:failure==='count'?2:1};}}));assert.equal(images,1,failure);}
});
test('native drawings are reviewed too; numeric and relation extraction errors cannot bypass visual review',async()=>{
 let images=0,reviews=0;const plan={complete:true,figure:{kind:'diagram',nodes:[{id:'a',label:'A'},{id:'b',label:'B'}],edges:[{from:'a',to:'b',label:'Connect'}]}};
 const result=await createScientificFigure(snapshot(),{settings,jsonRunner:async(_m,{phase})=>({value:phase==='planning'?plan:phase==='review_plan'?{passed:true,checks:review(true).checks.slice(0,3)}:{passed:++reviews===2,checks:review(true).checks.slice(3,5).map((c,i)=>({...c,passed:reviews===2||i!==0}))}}),imageRunner:async()=>{images++;throw Error('must use native');}});assert.equal(images,0);assert.equal(reviews,2);assert.ok(result.svg);assert.equal(result.width,2400);
});
test('all visible choices still resolve to a bounded supported planning path',()=>{let count=0;for(const mode of ['basic','professional'])for(const choice of researchFigureChoices(mode)){assert.ok(choice.description);count++;}assert.equal(count,301);});
test('all controlled data renderers preserve their declared series and produce complete PNGs',async()=>{
 const nodes=[{id:'A',label:'A'},{id:'B',label:'B'}],cases={};
 for(const type of ['bar','horizontal-bar','pictorial-bar','line','area','pie','radar','funnel'])cases[type]={categories:['A','B','C'],series:[{name:'Observed',values:[3,2,1]}]};
 Object.assign(cases,{scatter:{points:[{x:1,y:2},{x:2,y:3}]},heatmap:{rows:['A','B'],columns:['C','D'],matrix:[[1,2],[3,4]]},boxplot:{series:[{name:'Observed',values:[1,2,3,4,5]}]},candlestick:{ohlc:[{name:'D1',open:2,close:3,low:1,high:4}]},gauge:{value:3,minimum:0,maximum:5},treemap:{hierarchy:{name:'All',value:5,children:[{name:'A',value:2},{name:'B',value:3}]}},sunburst:{hierarchy:{name:'All',value:5,children:[{name:'A',value:2},{name:'B',value:3}]}},sankey:{nodes,links:[{from:'A',to:'B',value:1}]},chord:{nodes,links:[{from:'A',to:'B',value:1}]},parallel:{dimensions:['X','Y'],series:[{name:'Observed',values:[[1,2],[2,3]]}]},calendar:{calendar:[{date:'2026-10-20',value:1},{date:'2026-10-21',value:2}]},river:{river:[{date:'2026-10-20',name:'A',value:2},{date:'2026-10-21',name:'A',value:3}]},histogram:{series:[{name:'Observed',values:[1,1,2,3]}]}});
 for(const [type,data]of Object.entries(cases)){const s={...snapshot('auto'),text:'Actual data values: 0 1 2 3 4 5. Dates 2026-10-20 and 2026-10-21.'},plan=normalizePublicationFigurePlan(chart(type,data,{unit:type==='gauge'?'AU':''}),s),result=await renderPublicationVector(plan,s),png=validateResearchImage((await rasterPublicationVector(result)).buffer);assert.equal(png.width,2400,type);assert.equal(result.grammarVerified,true,type);assert.match(result.svg,/<metadata>/,type);}
 const s=snapshot('auto'),plan=normalizePublicationFigurePlan(chart('gauge',{value:10,minimum:8,maximum:12},{unit:'MPa'}),s),option=publicationChartOption(plan,s);assert.equal(option.series[0].max,12);assert.equal(option.series[0].detail.formatter,'{value}MPa');
});
test('chord ribbon fill uses the requested colors in the actual SVG rather than just stroke options',async()=>{
 const s=snapshot('chord'),plan=normalizePublicationFigurePlan(chart('chord',{nodes:[{id:'A',label:'A'},{id:'B',label:'B'},{id:'C',label:'C'}],links:[{from:'A',to:'B',color:'#ffa500'},{from:'B',to:'C',color:'#0072b2'}]},{qualitative:true}),s),r=await renderPublicationVector(plan,s);assert.match(r.svg,/fill="#ffa500"/);assert.match(r.svg,/fill="#0072b2"/);assert.doesNotMatch(r.svg,/fill="#000"/);
});
test('class diagrams keep properties and methods in separate escaped compartments',async()=>{
 const s=snapshot('class'),plan=normalizePublicationFigurePlan({complete:true,figure:{kind:'diagram',nodes:[{id:'a',label:'Parent',attributes:['+ id: int','+ run(): void']},{id:'b',label:'Child',attributes:['value < limit']}],edges:[{from:'b',to:'a',kind:'inheritance'}]}},s),r=await renderPublicationVector(plan,s);assert.match(r.source,/<TABLE/);assert.match(r.source,/value &lt; limit/);assert.match(r.source,/arrowhead=empty/);assert.match(r.svg,/Parent/);assert.doesNotMatch(r.svg,/<script/);
});
test('named terminal states retain their visible labels and unrequested role metadata stays out of Chinese drawings',async()=>{
 const s={...snapshot('state'),language:'中文',text:'草稿到完成，中文标注。'},plan=normalizePublicationFigurePlan({complete:true,figure:{kind:'diagram',nodes:[{id:'a',label:'草稿',role:'state',attributes:['input']},{id:'b',label:'完成',role:'end'}],edges:[{from:'a',to:'b',label:'成功'}]}},s),r=await renderPublicationVector(plan,s);assert.deepEqual(plan.nodes[0].attributes,[]);assert.match(r.svg,/>完成<\/text>/);assert.match(r.source,/xlabel="完成"/);
});
test('selected palettes apply to native charts and diagrams while explicit author colors take precedence',async()=>{
 const s={...snapshot('line'),context:{...snapshot().context,palette:'warm'}},plan=normalizePublicationFigurePlan(chart('line',{categories:['A','B'],series:[{name:'Observed',values:[9,10],color:'blue'}]}),s),option=publicationChartOption(plan,s);assert.equal(option.color[0],'#bd5d16');assert.equal(option.series[0].lineStyle.color,'#0072B2');
 const d=normalizePublicationFigurePlan({complete:true,figure:{kind:'diagram',nodes:[{id:'a',label:'A'},{id:'b',label:'B'}],edges:[{from:'a',to:'b'}]}},snapshot()),r=await renderPublicationVector(d,s);assert.match(r.svg,/#fff4e8/);
});
test('explicit state transitions reject plausible but unrequested edges and detect missing transitions',()=>{
 const s={...snapshot('state'),language:'中文',text:'三个状态为“草稿”“完成”“取消”。起始黑点→草稿；草稿→完成；草稿→取消；完成→终点同心圆。不增加额外状态。'},f={kind:'diagram',nodes:[{id:'start',label:'',role:'start'},{id:'draft',label:'草稿',role:'state'},{id:'done',label:'完成',role:'state'},{id:'cancel',label:'取消',role:'state'},{id:'end',label:'',role:'end'}],edges:[{from:'start',to:'draft'},{from:'draft',to:'done'},{from:'draft',to:'cancel'},{from:'done',to:'end'}]};
 const plan=normalizePublicationFigurePlan({complete:true,figure:f},s);assert.equal(plan.stateEvidence.requiredTransitions,4);
 assert.throws(()=>normalizePublicationFigurePlan({complete:true,figure:{...f,edges:[...f.edges,{from:'cancel',to:'end'}]}},s),/没有作者提供的转换依据/);
 assert.throws(()=>normalizePublicationFigurePlan({complete:true,figure:{...f,edges:f.edges.slice(0,-1)}},s),/缺少作者指定的连接/);
 assert.throws(()=>normalizePublicationFigurePlan({complete:true,figure:{...f,nodes:f.nodes.filter(n=>n.id!=='cancel'),edges:f.edges.filter(e=>e.to!=='cancel')}},s),/遗漏作者指定的状态/);
});
test('closed English state graphs preserve named transitions and Chinese event labels remain exact',()=>{
 const s={...snapshot('state'),text:'States are "Draft", "Done". Initial black dot->Draft; Draft->Done; Done->End.'},f={kind:'diagram',nodes:[{id:'s',label:'',role:'start'},{id:'a',label:'Draft',role:'state'},{id:'b',label:'Done',role:'state'},{id:'e',label:'',role:'end'}],edges:[{from:'s',to:'a'},{from:'a',to:'b'},{from:'b',to:'e'}]};assert.equal(normalizePublicationFigurePlan({complete:true,figure:f},s).stateEvidence.requiredTransitions,3);
 const cn={...s,language:'中文',text:'状态为“草稿”“完成”。起始黑点→草稿；草稿→完成，事件“成功”；完成→终点同心圆。'},chinese={...f,nodes:f.nodes.map(n=>({...n,label:n.id==='a'?'草稿':n.id==='b'?'完成':''})),edges:f.edges.map(e=>({...e,label:e.from==='a'?'别的事件':''}))};assert.throws(()=>normalizePublicationFigurePlan({complete:true,figure:chinese},cn),/应标注作者给出的事件/);
});
test('scatter y limits do not clip or reject unrelated x coordinates',()=>{
 const s={...snapshot('scatter'),text:'Point x=1000, y=2. Y range 0 to 5, interval 1.'},plan=normalizePublicationFigurePlan(chart('scatter',{points:[{x:1000,y:2}]},{yRange:{min:0,max:5,interval:1}}),s),option=publicationChartOption(plan,s);assert.deepEqual(option.series[0].data,[[1000,2]]);assert.equal(option.yAxis.max,5);
});
test('hierarchy area encodings reject negative weights and children exceeding the author parent total',()=>{
 const s={...snapshot('treemap'),text:'Weights -1, 1, 2.'};for(const hierarchy of [{name:'All',value:-1},{name:'All',value:1,children:[{name:'A',value:2}]}])assert.throws(()=>normalizePublicationFigurePlan(chart('treemap',{hierarchy}),s),{code:'figure_plan_invalid'});
});
