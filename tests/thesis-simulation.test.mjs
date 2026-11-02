import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import JSZip from 'jszip';
import {database} from '../backend/database.mjs';
import {createBillingService,billingServiceTypes} from '../backend/billing-service.mjs';
import {createThesisService} from '../backend/thesis-service.mjs';
import {createThesisMethodService} from '../backend/thesis-method-service.mjs';
import {startThesisMethodWorker} from '../backend/thesis-method-worker.mjs';
import {normalizeThesisSnapshot,selectThesisEvidence,thesisAgentTask} from '../backend/thesis-model.mjs';
import {parseThesisSimulation,thesisSimulationTask,validateThesisSimulationCandidate,simulationResearchGaps} from '../backend/thesis-simulation-model.mjs';
import {generateSimulationData,normalizeSimulationRecipe,simulationDisclosure} from '../dist/workspace/simulation-data.mjs';
import {thesisDocumentPresentation} from '../dist/workspace/thesis-document.mjs';
import {thesisExportMetadata} from '../dist/workspace/thesis-template.mjs';
import {auditThesisSubmission} from '../src/thesis-export-check.js';
import {createWritingDocx,inspectThesisExportContent} from '../src/writing-document.js';
import {assertThesisChartEvidence} from '../backend/thesis-chart-evidence.mjs';
import {supplementCheckTask,parseSupplementCheck} from '../backend/supplement-check.mjs';

export const recipe=()=>({title:'输入扰动与响应的仿真数据',purpose:'在声明的线性假设下检验分析和绘图流程，不能代表实测性能。',sampleSize:40,assumptions:['输入在 0 到 10 之间均匀分布；线性关系是模拟假设。'],variables:[{key:'x',label:'模拟输入',unit:'分',distribution:'uniform',min:0,max:10},{key:'y',label:'模拟响应',unit:'分',distribution:'linear',min:0,max:50,intercept:2,noiseSd:0,terms:[{key:'x',weight:3}]}],limitations:['不能推断真实系统、参与者或已训练模型的效果。']});
const settings={enabled:true,engine:'claude-agent-sdk',baseURL:'https://simulation.example.test',model:'simulation-fixture',apiKey:'simulation-test-key',version:'simulation-v1',maxTurns:3,maxOutputTokens:4096,maxCostUsd:.1,timeoutMs:30000};
const candidate=()=>({complete:true,synthetic:true,recipe:recipe()});
const response=()=>({text:JSON.stringify(candidate()),usage:{input:100,output:200},costUsd:.001,finishReason:'end_turn'});
const snapshot=()=>({title:'输入扰动响应的仿真研究',profile:{level:'本科',targetWords:500,method:'基于声明假设的数值仿真'},requirements:{contentMode:'rich'},materials:[],references:[],outline:[{id:'c',title:'仿真结果',targetWords:500,presentation:{image:true}}]});
function fixture(t,extra={}){
 const db=database(':memory:'),owner={id:'owner'},other={id:'other'};for(const user of [owner,other])db.prepare('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)').run(user.id,user.id,'user',new Date().toISOString());
 const config={getAgentSettings:()=>({...settings}),agentTaskRunner:async({task,validateSimulationOutput})=>{assert.equal(task.skill,'thesis-simulation');assert.equal(validateSimulationOutput(response()).valid,true);return response();},thesisMethodPollMs:60000,...extra},billing=createBillingService(db,config);config.billing=billing;
 const theses=createThesisService(db,config),methods=createThesisMethodService(db,config),worker=startThesisMethodWorker(db,config);t.after(async()=>{await worker.stop();db.close();});
 const request=async(path,body,user=owner)=>{const args={path,method:body===undefined?'GET':'POST',user,readBody:async()=>body},result=await methods.handle(args)||await theses.handle(args);return result.value;};
 const create=async(title)=>(await request('/api/theses',{clientKey:randomUUID(),snapshot:{...snapshot(),...(title?{title}:{})}})).item;
 const start=async(item,extra={},user=owner)=>{const quote=billing.quote(user,{type:'agent'});return(await request('/api/theses/methods',{operation:'simulation',thesisId:item.id,version:item.version,clientKey:randomUUID(),consent:true,billingToken:quote.token,...extra},user)).item;};
 const pay=()=>{billing.saveRules({version:billing.rules().version,services:billingServiceTypes.map(({key})=>({key,mode:'paid',creditCost:10}))});const order=randomUUID(),at=new Date().toISOString();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?)').run(order,owner.id,'credits-200','paid',at);db.prepare('INSERT INTO payment_credit_ledger VALUES(?,?,?,?,?,?)').run(order,owner.id,'credits-200',200,'purchase',at);};
 return {db,owner,other,config,billing,theses,methods,worker,request,create,start,pay};
}
test('simulation data are reproducible from declared parameters and seed, with summaries computed from actual rows',()=>{
 const value=generateSimulationData(recipe(),12345),before=recipe();assert.deepEqual(generateSimulationData(recipe(),12345),value);assert.notDeepEqual(generateSimulationData(recipe(),12346).rows,value.rows);assert.deepEqual(recipe(),before);assert.equal(value.rows.length,40);assert.ok(value.rows.every(row=>row.x>=0&&row.x<=10&&Math.abs(row.y-(2+3*row.x))<.00011));assert.equal(value.statistics[0].mean,Number((value.rows.reduce((n,row)=>n+row.x,0)/40).toFixed(4)));assert.ok(value.text.includes(simulationDisclosure));assert.ok(value.text.includes('随机种子：12345'));assert.equal(value.csv.split('\n').length,41);
});
test('simulation plans cannot execute code, invoke arbitrary expressions, contain recursive variables, or bypass bounds',()=>{
 for(const mutate of [r=>r.sampleSize=1000000,r=>r.variables[0].key='__proto__',r=>r.variables[1].terms=[{key:'y',weight:1}],r=>r.variables[0].distribution='eval',r=>r.variables[0].code='process.exit()',r=>r.variables[0].min=Infinity,r=>r.title='<script>x</script>',r=>r.variables[0].max=0,r=>r.variables[0].mean=4]){const value=recipe();mutate(value);assert.throws(()=>normalizeSimulationRecipe(value),error=>error.code==='invalid_simulation');}
 for(const seed of [0,-1,1.1,2**32])assert.throws(()=>generateSimulationData(recipe(),seed));
});
test('normal and binary simulation variables stay bounded and use the declared probabilities without inventing observed records',()=>{
 const value=recipe();value.variables=[{key:'x',label:'模拟评分',distribution:'normal',min:0,max:10,mean:5,sd:2},{key:'y',label:'模拟组别',distribution:'binary',min:0,max:1,probability:.5}];const data=generateSimulationData(value,123);assert.ok(data.rows.every(row=>row.x>=0&&row.x<=10&&[0,1].includes(row.y)));assert.equal(data.statistics[1].count,40);
});
test('AI only designs a simulation recipe and must retain the synthetic marker',()=>{
 const source=snapshot(),task=thesisSimulationTask(source);assert.equal(task.skill,'thesis-simulation');assert.deepEqual(task.materials,[]);assert.match(task.instructions,/不能虚构真实受访者/);assert.equal(parseThesisSimulation(response(),source,42).seed,42);for(const value of [{complete:true,recipe:recipe()},{...candidate(),rows:[1]}, {...candidate(),synthetic:false}])assert.equal(validateThesisSimulationCandidate({text:JSON.stringify(value)},source,42).valid,false);
});
test('simulation context covers later chapters and current checker gaps before repeating early-chapter details',()=>{
 const chapters=Array.from({length:24},(_,i)=>({title:'第'+(i+1)+'章',requests:Array.from({length:20},(_,j)=>'缺项'+j)})),check={items:[{title:'参考文献',status:'missing',missing:['尚缺可引用的正文']},{title:'封面',status:'sufficient',missing:['不要加入']}]},gaps=simulationResearchGaps({chapters},check);
 assert.equal(gaps.length,60);assert.ok(gaps.includes('第24章：缺项0'));assert.ok(gaps.includes('参考文献：尚缺可引用的正文'));assert.ok(gaps.every(text=>text.length<=400));assert.ok(gaps.every(text=>!text.startsWith('封面')));const task=thesisSimulationTask({...snapshot(),simulation:{missingInformation:gaps}});assert.deepEqual(task.context.missingInformation,gaps);
});
test('simulation tasks are owner-bound, version-bound, durable and bill once before verified adoption as marked material',async t=>{
 const f=fixture(t);f.pay();const thesis=await f.create(),key=randomUUID(),run=await f.start(thesis,{clientKey:key});assert.equal(run.operation,'simulation');assert.equal(f.billing.balance(f.owner.id).held,10);assert.equal((await f.start(thesis,{clientKey:key})).id,run.id);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_method_runs').get().n,1);
 await assert.rejects(f.request('/api/theses/methods',{operation:'simulation',thesisId:thesis.id,version:thesis.version,clientKey:randomUUID(),consent:true},f.other),error=>error.status===404);await f.worker.tick();const done=(await f.request('/api/theses/methods/'+run.id)).item;assert.equal(done.status,'completed',done.error);assert.equal(done.output.origin,'ai_simulation');assert.equal(f.billing.balance(f.owner.id).balance,190);assert.equal(f.billing.balance(f.owner.id).held,0);
 const save={version:thesis.version,clientKey:randomUUID(),simulationRunIds:[run.id]},adopted=(await f.request('/api/theses/'+thesis.id+'/completion',save)).item;assert.equal(adopted.snapshot.materials.length,1);const material=adopted.snapshot.materials[0];assert.equal(material.dataKind,'simulation');assert.equal(material.simulation.seed,done.output.seed);assert.ok(material.text.includes(simulationDisclosure));assert.equal(material.purpose,'仿真研究数据（非实测）');assert.equal((await f.request('/api/theses/'+thesis.id+'/completion',save)).item.version,adopted.version);assert.equal(f.billing.balance(f.owner.id).balance,190,'adopting material does not bill again');assert.equal((await f.start(thesis,{clientKey:key})).id,run.id,'recovery survives later thesis versions');
 const evidence=selectThesisEvidence(adopted.snapshot,{title:'仿真结果'});assert.equal(evidence.sources[0].dataKind,'simulation');assert.ok(evidence.sources[0].text.includes(simulationDisclosure));
 const updated=(await f.request('/api/theses/'+adopted.id+'/chapters/c',{version:adopted.version,text:'此前已保存的仿真结果段落，没有待填写标记。'})).item,quote=await f.request('/api/theses/'+updated.id+'/quote',{version:updated.version,action:'generate',completion:true});assert.ok(quote.completion.chapterTitles.includes('仿真结果'),'newly adopted simulation data targets existing body chapters too');
});
test('failed simulation validation releases held credits and creates no usable dataset',async t=>{
 const f=fixture(t,{agentTaskRunner:async()=>({...response(),text:JSON.stringify({...candidate(),synthetic:false})})});f.pay();const run=await f.start(await f.create());await f.worker.tick();const done=(await f.request('/api/theses/methods/'+run.id)).item;assert.equal(done.status,'failed');assert.equal(done.output,null);assert.equal(f.billing.balance(f.owner.id).balance,200);assert.equal(f.billing.balance(f.owner.id).held,0);assert.equal(f.db.prepare('SELECT count(*) n FROM results').get().n,0);
});

test('same-research completed simulations can be recovered after a lost reference, with all rows and no new charge',async t=>{
 const f=fixture(t);f.pay();const thesis=await f.create(),run=await f.start(thesis);await f.worker.tick();
 const done=(await f.request('/api/theses/methods/'+run.id)).item,read=async()=>(await f.request('/api/theses/'+thesis.id)).item;
 assert.deepEqual((await read()).simulationRecovery,{id:run.id,title:done.output.recipe.title,sampleSize:40,variableCount:2,createdAt:run.createdAt});
 const adopt=async version=>(await f.request('/api/theses/'+thesis.id+'/completion',{version,clientKey:randomUUID(),simulationRunIds:[run.id]})).item;
 const adopted=await adopt(thesis.version);assert.equal(adopted.simulationRecovery,null);assert.equal(adopted.snapshot.materials[0].text,done.output.text);
 const removed=(await f.request('/api/theses/'+thesis.id,{version:adopted.version,snapshot:snapshot()})).item;
 assert.equal(removed.simulationRecovery?.id,run.id,'an old same-context dataset is offered instead of requiring another paid generation');
 const restored=await adopt(removed.version);assert.equal(restored.snapshot.materials.length,1);assert.equal(restored.snapshot.materials[0].text,done.output.text);assert.equal(restored.snapshot.materials[0].simulation.seed,done.output.seed);assert.equal(done.output.rows.length,40);
 assert.equal(f.billing.balance(f.owner.id).balance,190);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_method_runs').get().n,1);
 const another=await f.create('不同研究');assert.equal(another.simulationRecovery,null);await assert.rejects(f.request('/api/theses/'+thesis.id,undefined,f.other),error=>error.status===404);
 const changed=(await f.request('/api/theses/'+thesis.id,{version:restored.version,snapshot:{...snapshot(),title:'完全不同的研究'}})).item;assert.equal(changed.simulationRecovery,null);
});
test('simulation data cannot be adopted by another thesis or with a changed research context',async t=>{
 const f=fixture(t),thesis=await f.create(),run=await f.start(thesis);await f.worker.tick();const another=await f.create('另一个仿真研究');await assert.rejects(f.request('/api/theses/'+another.id+'/completion',{version:another.version,clientKey:randomUUID(),simulationRunIds:[run.id]}),error=>error.status===409);await assert.rejects(f.request('/api/theses/methods/'+run.id,undefined,f.other),error=>error.status===404);
 const updated=(await f.request('/api/theses/'+thesis.id,{version:thesis.version,snapshot:{...snapshot(),title:'已经修改研究主题'}})).item;await assert.rejects(f.request('/api/theses/'+thesis.id+'/completion',{version:updated.version,clientKey:randomUUID(),simulationRunIds:[run.id]}),error=>error.status===409);await assert.rejects(f.start(thesis),error=>error.status===409);
});
test('normalized snapshots cannot strip simulated provenance or the explicit disclosure from adopted data',()=>{
 const generated=generateSimulationData(recipe(),12),material={id:'simulation:run-one',name:'模拟资料',text:generated.text,confirmed:true,dataKind:'simulation',simulation:{jobId:'run-one',seed:12,generatorVersion:1,recipe:recipe()}},value={...snapshot(),materials:[material]},normalized=normalizeThesisSnapshot(value);assert.equal(normalized.materials[0].dataKind,'simulation');assert.throws(()=>normalizeThesisSnapshot({...value,materials:[{...material,simulation:undefined}]}));assert.throws(()=>normalizeThesisSnapshot({...value,materials:[{...material,text:'伪装成真实实验结果'}]}));
});
test('simulated chart data require a disclosed caption and retain the actual point provenance',()=>{
 const data=generateSimulationData(recipe(),12),point=data.rows[0],sourceId='simulation:one',quote=data.text.split('\n').find(row=>row.startsWith('模拟序号 1；')),figure={kind:'scatter',title:'仿真响应分布',caption:'模拟数据，不是实测结果',data:{series:[{name:'模拟响应',points:[{x:point.x,y:point.y,sourceId,quote}]}]}},value={materials:[{id:sourceId,text:data.text,confirmed:true,dataKind:'simulation'}]};assert.doesNotThrow(()=>assertThesisChartEvidence([figure],{source_ids:[sourceId]},value));assert.throws(()=>assertThesisChartEvidence([{...figure,title:'真实系统性能',caption:'已测得结果'}],{source_ids:[sourceId]},value),error=>error.code==='invalid_figure_evidence');
});
test('simulated evidence cannot satisfy real-measurement gaps but can support explicitly disclosed simulation analysis',()=>{
 const text=generateSimulationData(recipe(),12).text,material={id:'sim',name:'模拟记录',text,dataKind:'simulation'},build=title=>supplementCheckTask({chapters:[{id:'c',title,text:'本节需要补充相应记录。'}],materials:[material]}),answer={text:JSON.stringify({items:[{id:'c',status:'sufficient',requirement:'结果依据',reason:'已提供对应记录',manuscriptQuote:'本节需要补充相应记录。',evidence:[{sourceId:'sim',quote:text.slice(0,30)}],missing:[]}]})};assert.throws(()=>parseSupplementCheck(answer,build('实际模型性能验证')));assert.equal(parseSupplementCheck(answer,build('仿真结果分析'))[0].status,'sufficient');
});
test('draft and final DOCX retain formal simulation methods and seed, while an export with stripped disclosure is blocked',async()=>{
 const data=generateSimulationData(recipe(),12),material={id:'simulation:one',name:'仿真资料',text:data.text,confirmed:true,dataKind:'simulation',simulation:{jobId:'one',seed:12,generatorVersion:1,recipe:recipe()}},value={...snapshot(),materials:[material]},chapters=[{id:'c',title:'仿真研究结果',text:'根据声明的假设分析模拟响应。[source:simulation:one]',sourceIds:[material.id]}],item={snapshot:value,chapters},presentation=thesisDocumentPresentation(value,chapters,{submission:true}),metadata=thesisExportMetadata(item,{submission:true});assert.ok(presentation.text.includes(simulationDisclosure));assert.ok(presentation.text.includes('随机种子：12'));assert.equal(metadata.simulationSourceCount,1);assert.equal(thesisDocumentPresentation(value,[{...chapters[0],text:chapters[0].text+'\n'+simulationDisclosure}],{submission:true}).text.split(simulationDisclosure).length-1,1,'an existing formal disclosure is not repeated');assert.ok(!auditThesisSubmission({text:presentation.text,metadata}).submission.issues.some(row=>row.code==='simulation_disclosure'));assert.ok(auditThesisSubmission({text:presentation.text.replace(simulationDisclosure,''),metadata}).submission.issues.some(row=>row.code==='simulation_disclosure'));
 const bytes=await createWritingDocx(presentation.text,{documentKind:'thesis',metadata,submission:true}),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');assert.match(xml,/模拟数据与复现说明/);assert.doesNotMatch(xml,/distribution/);assert.match(xml,/随机种子：12/);assert.match(xml,/不属于真实参与者调查/);assert.equal((await inspectThesisExportContent(bytes,presentation.text,{metadata})).status,'passed');
});


test('a disclosed simulation thesis can pass the existing final-document checks without removing its data statement',()=>{
 const generated=generateSimulationData(recipe(),33),source={id:'simulation:final',name:'仿真数据',text:generated.text,dataKind:'simulation',confirmed:true,simulation:{jobId:'final',seed:33,generatorVersion:1,recipe:recipe()}},value={title:'输入响应仿真研究',profile:{language:'中文'},materials:[source],references:[{id:'r',title:'已确认仿真方法文献',authors:'Test Author',year:'2025',confirmed:true}]},chapters=[{title:'摘要',text:'本研究在声明的线性假设下采用计算机模拟输入响应关系，说明参数、随机种子、数据生成与分析范围。'.repeat(4)+'\n关键词：仿真；参数；响应'},{title:'Abstract',text:'This study analyzes simulated input and response variables under declared assumptions with a fixed seed and reproducible generation parameters. '.repeat(3)+'\nKey words: simulation; parameters; response'},{title:'第一章 仿真方法与结果',text:'本研究明确采用计算机模拟数据，固定种子33，结果仅适用于声明的假设，不作为实测性能结论。[source:simulation:final] 相关方法依据已确认文献[source:r]。',sourceIds:['simulation:final','r']}],item={snapshot:value,chapters},document=thesisDocumentPresentation(value,chapters,{submission:true}),metadata={...thesisExportMetadata(item,{submission:true}),englishTitle:'Input Response Simulation'};
 const report=auditThesisSubmission({text:document.text,metadata});assert.equal(report.submission.ready,true,JSON.stringify(report.submission.issues));assert.ok(document.text.includes(simulationDisclosure));assert.equal(metadata.simulationSourceCount,1);
});

test('a research edit during model-setting lookup refuses stale simulation admission before reserving credits',async t=>{
 const f=fixture(t);f.pay();const thesis=await f.create(),quote=f.billing.quote(f.owner,{type:'agent'});f.config.getAgentSettings=()=>{f.db.prepare('UPDATE theses SET version=version+1 WHERE id=?').run(thesis.id);return {...settings};};await assert.rejects(f.request('/api/theses/methods',{operation:'simulation',thesisId:thesis.id,version:thesis.version,clientKey:randomUUID(),consent:true,billingToken:quote.token}),error=>error.status===409);assert.equal(f.billing.balance(f.owner.id).held,0);assert.equal(f.db.prepare('SELECT count(*) n FROM thesis_method_runs').get().n,0);
});

test('a bounded current simulation is supplied in full for completion, with explicit simulation scope and no invented measured claims',()=>{
 const plan=recipe();plan.sampleSize=60;const generated=generateSimulationData(plan,42),material={id:'simulation:all',name:'模拟研究数据',text:generated.text,dataKind:'simulation',confirmed:true,simulation:{jobId:'all',seed:42,generatorVersion:1,recipe:plan}},source=normalizeThesisSnapshot({...snapshot(),materials:[material]}),unit={id:'c::1',chapterId:'c',chapterTitle:'仿真结果',title:'仿真结果',targetWords:500,completionSourceIds:[material.id],completion:{scope:'full',originalText:'旧稿仅有实测数据的待补充位置。'}};
 const evidence=selectThesisEvidence(source,unit).sources[0];assert.ok(generated.text.length>2400);assert.ok(evidence.text.includes(generated.text),'all generated records, summaries and disclosure must reach the writing task');assert.deepEqual(evidence.fragments,[{start:0,end:generated.text.length,totalCharacters:generated.text.length}]);assert.match(evidence.text,/完整内容/);
 const task=thesisAgentTask(source,unit,[]);assert.equal(task.context.revision.simulationCompletion.mode,'disclosed_simulation_analysis');assert.deepEqual(task.context.revision.simulationCompletion.sourceIds,[material.id]);assert.equal(task.context.revision.simulationCompletion.preserveObservedFacts,true);assert.match(task.instructions,/不原样继续索要实测日志/);assert.match(task.instructions,/不补造作者、学校/);assert.ok(task.materials[0].text.includes(generated.text));assert.equal(thesisAgentTask(source,{...unit,completion:undefined},[]).context.revision,undefined);
});
