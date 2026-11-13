import test from 'node:test';
import assert from 'node:assert/strict';
import {manuscriptFigures,manuscriptPart,assertCheckedFigures} from '../dist/workspace/manuscript-figures.mjs';
import {writingReviewTask,parseWritingReview} from '../backend/writing-quality.mjs';
import {layoutThesisFigure} from '../dist/workspace/thesis-figure.mjs';
import {createWritingQualityRunner} from '../backend/writing-quality-runner.mjs';
import {supplementCheckTask,parseSupplementCheck,runSupplementCheck} from '../backend/supplement-check.mjs';
import {thesisCompletionNeeds,safeCompletionIssues} from '../dist/workspace/thesis-completion-model.mjs';
import {auditThesisSubmission} from '../src/thesis-export-check.js';
import {normalizeThesisSnapshot,thesisAgentTask} from '../backend/thesis-model.mjs';

const figure=(id='flow')=>({id,title:'识别系统结构',kind:'flowchart',nodes:[{id:'a',label:'图像输入'},{id:'b',label:'识别与结果输出'}],edges:[{from:'a',to:'b'}],caption:'解释系统输入与输出关系。'});
const chapter=(id='flow')=>({id:'c-'+id,title:'系统设计',text:'本系统按图中的输入输出关系组织识别流程。\n[figure:'+id+']\n',figures:[figure(id)]});
const result=value=>({text:JSON.stringify(value),usage:{input:100,output:100},costUsd:.001,trace:[]});
const reviewed=task=>result({complete:true,findings:[],limitations:[],checkedFigureIds:task.context.manuscriptExcerpts.flatMap(row=>(row.figures||[]).map(f=>f.id))});
const runtime={maxTurns:6,maxOutputTokens:4096,timeoutMs:30000,maxCostUsd:.5};
const runner=()=>createWritingQualityRunner({citationVerifier:{verify:async()=>({version:1,status:'completed',items:[],summary:{},limitations:[]})}});
test('recovered thesis review retains diagrams and requires their acknowledgement',async()=>{
 const input={...chapter(),text:'首段。'+'甲'.repeat(1800)+'\n\n[figure:flow]\n'+ '乙'.repeat(1800)+'\n\n结尾。'+'丙'.repeat(1200)},calls=[];
 const quality=await runner()({kind:'thesis',checkSupplements:false,recoverSupplements:true,chapters:[input],runtime,dispatch:async({task,unitId})=>{calls.push({task,unitId});if(calls.length===1)throw Object.assign(Error('turn limit'),{code:'turn_limit',status:502});return reviewed(task);}});
 assert.equal(quality.coverage.complete,true);assert.equal(quality.figureReview.status,'completed');assert.deepEqual(quality.figureReview.checkedFigureIds,['flow']);assert.equal(calls.slice(1).flatMap(x=>x.task.context.manuscriptExcerpts).map(x=>x.text).join(''),input.text);
});
function supplementResult(task,{status='not_required',checked=true}={}){return result({items:task.context.chapters.map(row=>({id:row.id,status,requirement:'本节图文所需资料',reason:'仅说明结构关系，无实测结果。',manuscriptQuote:row.text.slice(0,25),evidence:[],missing:status==='missing'?['原始实验记录和样本范围']:[],...(checked?{checkedFigureIds:(row.figures||[]).map(f=>f.id)}:{})}))});}

test('review receives actual diagram nodes, relationships and captions and requires exact image coverage',()=>{
 const original=chapter(),before=structuredClone(original),task=writingReviewTask({chapters:[original]});
 const enriched=task.context.manuscriptExcerpts[0].figures;const {renderedPositions,...actualFigure}=enriched[0];assert.deepEqual(actualFigure,original.figures[0]);assert.deepEqual(renderedPositions,layoutThesisFigure(original.figures[0]).nodes.map(({id,x,y,width,height})=>({id,x,y,width,height})));assert.match(task.instructions,/实际渲染位置/);assert.match(task.instructions,/表头、单位|表格以 table_consistency/);
 assert.deepEqual(parseWritingReview(reviewed(task),task).checkedFigureIds,['flow']);
 for(const checkedFigureIds of [undefined,[],['other'],['flow','flow']])assert.throws(()=>parseWritingReview(result({complete:true,findings:[],limitations:[],checkedFigureIds}),task),/图片/);
 assert.deepEqual(original,before);assert.throws(()=>assertCheckedFigures(['foreign'],[]));
});

test('diagram and table findings must still be grounded to the provided body, not invented text',()=>{
 const input=chapter(),task=writingReviewTask({chapters:[input]}),base={sectionId:input.id,quote:'[figure:flow]',category:'figure_consistency',severity:'warning',explanation:'图中输入输出与段落描述需要核对。',suggestion:'依据实际系统方案统一输入输出。'};
 const output=rows=>result({complete:true,checkedFigureIds:['flow'],findings:rows,limitations:[]});
 assert.equal(parseWritingReview(output([base]),task).findings[0].category,'figure_consistency');
 assert.throws(()=>parseWritingReview(output([{...base,quote:'图中不存在的研究结论'}]),task));
 for(const category of ['table_consistency','data_support'])assert.equal(parseWritingReview(output([{...base,quote:input.text.split('\n')[0],category}]),task).findings[0].category,category);
});

test('long manuscript batches retain full diagram markers and all diagram content within the actual context allowance',async()=>{
 const input=chapter(),prefix='文'.repeat(21995);input.text=prefix+input.text;const tasks=[];
 const quality=await runner()({chapters:[input],runtime,dispatch:async({task})=>{tasks.push(task);assert.ok(JSON.stringify(task.context).length<=39000);return reviewed(task);}});
 assert.equal(quality.coverage.complete,true);assert.deepEqual(quality.figureReview.checkedFigureIds,['flow']);assert.equal(quality.figureReview.status,'completed');
 assert.equal(tasks.flatMap(task=>task.context.manuscriptExcerpts).map(row=>row.text).join(''),input.text);
 const crossing={...chapter(),text:'文'.repeat(21995)+'[figure:flow]后文'};const first=manuscriptPart(crossing,0,22000),next=manuscriptPart(crossing,first.end,22000);
 assert.equal(first.text.length,21995);assert.equal(first.figures.length,0);assert.equal(next.figures[0].id,'flow');assert.equal(first.text+next.text,crossing.text);
 const citation={text:'文。'.repeat(10995)+'重要研究结论。[source:reference-id]后文',figures:[]},before=manuscriptPart(citation,0,22000),after=manuscriptPart(citation,before.end,22000);assert.ok(after.text.startsWith('重要研究结论。[source:reference-id]'));assert.equal(before.text+after.text,citation.text);
 for(const gap of [0,1,5]){const prefix='文。'.repeat(100)+'本句保留数字3.14与英文缩写e.g.，最后引用';const input={text:prefix+' '.repeat(gap)+'[source:ref]继续',figures:[]},limit=prefix.length+gap,part=manuscriptPart(input,0,limit),nextPart=manuscriptPart(input,part.end,limit);assert.equal(part.text+nextPart.text,input.text);assert.ok(nextPart.text.startsWith('本句保留数字3.14与英文缩写e.g.，最后引用'));}
 assert.throws(()=>manuscriptPart({text:'长'.repeat(22000)+'[source:ref]',figures:[]},0,22000),/单句及其引用超过/);
 assert.throws(()=>manuscriptPart({text:'Data 3.14 and e.g. '.repeat(1500)+'[source:ref]',figures:[]},0,22000),/单句及其引用超过/);
 assert.throws(()=>manuscriptFigures({text:'[figure:unknown]',figures:input.figures}));
});

test('missing or partial diagram acknowledgements never become a completed visual review',async()=>{
 const quality=await runner()({chapters:[chapter()],runtime,dispatch:async()=>result({complete:true,findings:[],limitations:[]})});
 assert.equal(quality.coverage.complete,false);assert.equal(quality.figureReview.status,'partial');assert.match(quality.limitations.join(''),/图片内容审校尚未完整/);
});

test('many detailed diagrams remain fully covered without silently dropping graphics to fit the context',async()=>{
 const input=Array.from({length:25},(_,i)=>{const row=chapter('flow'+i);row.figures[0].caption='说明研究流程的适用范围与条件。'.repeat(25);row.text='正文论证。'.repeat(350)+'\n[figure:flow'+i+']\n';return row;});
 let calls=0;const quality=await runner()({chapters:input,runtime,dispatch:async({task})=>{calls++;assert.ok(JSON.stringify(task.context).length<=39000);return reviewed(task);}});
 assert.ok(calls>1);assert.equal(quality.coverage.complete,true);assert.equal(quality.figureReview.status,'completed');assert.equal(quality.figureReview.checkedFigureIds.length,25);
});

test('supplement checks read image contents and cannot skip missing data hidden inside a node',async()=>{
 const input=chapter();input.figures[0].nodes[1].label='【待补充：准确率及测试样本】';
 const task=supplementCheckTask({chapters:[input]}),value=supplementResult(task);
 assert.equal(task.context.chapters[0].figures[0].nodes[1].label,input.figures[0].nodes[1].label);
 assert.throws(()=>parseSupplementCheck(value,task));assert.throws(()=>parseSupplementCheck(supplementResult(task,{status:'missing',checked:false}),task));
 const report=await runSupplementCheck({chapters:[input],runtime,dispatch:async({task})=>supplementResult(task,{status:'missing'})});
 assert.equal(report.status,'needs_materials');assert.deepEqual(report.items[0].checkedFigureIds,['flow']);assert.match(report.items[0].missing.join(''),/原始实验记录/);
 const needs=thesisCompletionNeeds({chapters:[input]});assert.match(needs.chapters[0].requests.join(''),/准确率及测试样本/);
});

test('conceptual diagrams remain allowed without forcing fabricated experimental evidence',async()=>{
 const report=await runSupplementCheck({chapters:[chapter()],runtime,dispatch:async({task})=>supplementResult(task)});
 assert.equal(report.status,'final_ready');assert.equal(report.items[0].status,'not_required');assert.deepEqual(report.items[0].checkedFigureIds,['flow']);
});

test('formal export blocks old, stale and incomplete visual review and material graph or table findings',()=>{
 const input=chapter(),base={text:input.text,metadata:{figures:input.figures},quality:{coverage:{complete:true},figureReview:{version:1,status:'completed',figureIds:['flow'],checkedFigureIds:['flow']},reviews:[]}};
 const codes=value=>auditThesisSubmission(value).submission.issues.map(row=>row.code);
 assert.ok(!codes(base).includes('figure_review'));
 for(const change of [{figureReview:undefined},{stale:true},{coverage:{complete:false}},{figureReview:{...base.quality.figureReview,checkedFigureIds:[]}},{figureReview:{...base.quality.figureReview,figureIds:['old']}}])assert.ok(codes({...base,quality:{...base.quality,...change}}).includes('figure_review'));
 for(const category of ['figure_consistency','table_consistency','data_support'])assert.ok(codes({...base,quality:{...base.quality,reviews:[{findings:[{severity:'warning',category}]}]}}).includes('review_findings'));
 assert.deepEqual(safeCompletionIssues(['figure_review','unsafe']),['figure_review']);
});

test('completion context retains existing diagrams as manuscript data and stays bounded',()=>{
 const input=chapter(),snapshot=normalizeThesisSnapshot({title:'识别系统设计研究',profile:{level:'本科',targetWords:500},requirements:{contentMode:'rich'},materials:[],references:[],outline:[{id:'c',title:'系统设计',targetWords:500,presentation:{image:true}}]}),unit={id:'u',chapterId:'c',chapterTitle:'系统设计',title:'系统设计',targetWords:500,part:1,parts:1,presentation:{image:true},completion:{originalText:input.text,originalFigures:input.figures,findings:[]}};
 const task=thesisAgentTask(snapshot,unit,[]);assert.deepEqual(task.context.revision.originalFigures,input.figures);assert.match(task.instructions,/不能只保留图片占位符/);assert.ok(JSON.stringify(task.context).length<35000);
});

test('formal export does not bypass a deterministic mathematical consistency warning',()=>{
 const text='完全配对定义 C(n)=n²。连续变化率为 $$\\frac{dC}{dn}=2n$$，说明长度每增加一个单位，新增配对数量随当前长度线性增大。';
 const finding={sectionId:'math',severity:'warning',category:'method_result_consistency',quote:'长度每增加一个单位，新增配对数量随当前长度线性增大'};
 const report=auditThesisSubmission({text,quality:{consistency:{findings:[finding]},reviews:[]}});assert.ok(report.submission.issues.some(row=>row.code==='review_findings'));
});
