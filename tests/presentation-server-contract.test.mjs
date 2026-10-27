import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeToolRequest,toolRunPlan,toolRunTask,parseToolOutput,validateToolCandidate,joinToolOutputs} from '../backend/tool-run-model.mjs';
import {presentationSnapshot,restorePresentationSnapshot} from '../dist/workspace/presentation-model.mjs';

const titles=count=>Array.from({length:count},(_,index)=>`第${index+1}页 已确认标题`);
const request=(context={},mode='ai')=>({kind:'presentation',operation:'ppt',snapshot:{title:'【合成合同验收】研究汇报',text:'本资料仅用于离线合同测试，研究步骤和引用均来自本次合成输入。',mode,language:'中文',context:{pages:12,...context}}});
function response(value,unit,{notes='',slideTitles=value.snapshot.context.outlineTitles}={}){return {text:JSON.stringify({complete:true,sourceIds:value.snapshot.materials.map(source=>source.id),slides:Array.from({length:unit.count},(_,index)=>{const page=unit.start+index+1;return {id:'slide-'+page,title:slideTitles?.[page-1]||`第${page}页`,body:'仅依据本次合成资料整理页面内容，保留所提供的研究计划，不编造已经完成的结果。',layout:page===1?'cover':page===value.snapshot.context.pages?'closing':'content',notes};})}),trace:value.snapshot.materials.map(source=>({tool:'read_material',status:'completed',materialId:source.id,offset:0,limit:source.text.length}))};}
const change=(result,mutate)=>{const body=JSON.parse(result.text);mutate(body);return {...result,text:JSON.stringify(body)};};

for(const [mode,limit]of [['none',0],['concise',120],['detailed',500]]){
 test(`presentation ${mode} propagates the exact ${limit}-character note contract into each server task`,()=>{const value=normalizeToolRequest(request({notesMode:mode})),plan=toolRunPlan(value);for(const unit of plan){const task=toolRunTask(value,unit);assert.equal(task.context.presentationRequirements.notesMode,mode);assert.equal(task.context.presentationRequirements.maxNotesCharacters,limit);assert.equal(task.context.options.notesMode,mode);assert.match(task.instructions,mode==='none'?/notes必须为空字符串/:new RegExp('不超过'+limit+'字符'));}assert.equal(value.snapshot.context.notesMode,mode);});
 test(`presentation ${mode} accepts notes at its boundary and rejects an excess without truncation`,()=>{const value=normalizeToolRequest(request({notesMode:mode})),unit=toolRunPlan(value)[0],good=response(value,unit,{notes:'注'.repeat(limit)}),before=good.text,out=parseToolOutput(good,value,unit);assert.equal(out.slides[0].notes.length,limit);assert.equal(good.text,before);const excess=response(value,unit,{notes:'注'.repeat(limit+1)});assert.throws(()=>parseToolOutput(excess,value,unit),/生成结果结构/);assert.equal(validateToolCandidate(excess,value,unit).valid,false);assert.equal(JSON.parse(excess.text).slides[0].notes.length,limit+1);});
}

test('presentation rejects unsupported typed note modes and scene modes before a quote is created',()=>{for(const mode of ['',null,0,false,[],{},'verbose','NONE','__proto__'])assert.throws(()=>normalizeToolRequest(request({notesMode:mode})),/演讲备注/,JSON.stringify(mode));for(const mode of ['unknown','writing','',null])assert.throws(()=>normalizeToolRequest(request({},mode)),/演示场景/,String(mode));});

test('confirmed custom outlines need exactly one trimmed single-line title per requested page',()=>{const exact=titles(12),value=normalizeToolRequest(request({outlineTitles:exact}));assert.deepEqual(value.snapshot.context.outlineTitles,exact);const invalid=[exact.slice(1),[...exact,'extra'],[],null,'not-an-array',exact.map((title,index)=>index===3?'':title),exact.map((title,index)=>index===3?'   ':title),exact.map((title,index)=>index===3?3:title),exact.map((title,index)=>index===3?'A'.repeat(121):title)];for(const outlineTitles of invalid)assert.throws(()=>normalizeToolRequest(request({outlineTitles})),/自定义提纲/);for(const character of ['\n','\r','\t','\u2028','\u2029','\u0000','\u001f']){const outlineTitles=[...exact];outlineTitles[2]='标题'+character+'后续';assert.throws(()=>normalizeToolRequest(request({outlineTitles})),/单行标题/,JSON.stringify(character));}for(const whitespace of [' 前导','尾随 ']){const outlineTitles=[...exact];outlineTitles[1]=whitespace;assert.throws(()=>normalizeToolRequest(request({outlineTitles})),/单行标题/);}});

test('confirmed titles are retained exactly through task context and parsing, including punctuation and a 120-character title',()=>{const outlineTitles=['用户确认的封面：研究计划','A'.repeat(120),'Methods & Materials <研究>','结果与边界 [1]','讨论 / 限制','致谢与问答'],value=normalizeToolRequest(request({pages:6,outlineTitles,notesMode:'concise'})),unit=toolRunPlan(value)[0],task=toolRunTask(value,unit),result=response(value,unit);assert.deepEqual(task.context.presentationRequirements.titles,outlineTitles);assert.match(task.instructions,/title必须逐字等于/);assert.deepEqual(parseToolOutput(result,value,unit).slides.map(slide=>slide.title),outlineTitles);for(const title of ['更改后的标题',outlineTitles[1].toLowerCase(),outlineTitles[1]+' ']){const changed=change(result,body=>{body.slides[1].title=title;});assert.throws(()=>parseToolOutput(changed,value,unit),/提纲不一致|生成结果结构/);}});

test('the second six-page unit uses global page numbers and only its own confirmed title slice',()=>{const outlineTitles=titles(12),value=normalizeToolRequest(request({outlineTitles,notesMode:'detailed'})),plan=toolRunPlan(value);assert.deepEqual(plan.map(unit=>({id:unit.id,start:unit.start,count:unit.count})),[{id:'unit-0',start:0,count:6},{id:'unit-1',start:6,count:6}]);const second=plan[1],task=toolRunTask(value,second,[{slides:[{title:outlineTitles[0]}]}]);assert.deepEqual(task.context.presentationRequirements.titles,outlineTitles.slice(6));assert.equal(task.context.unit.start,6);const result=response(value,second,{notes:'本页演讲备注'}),out=parseToolOutput(result,value,second);assert.deepEqual(out.slides.map(slide=>slide.id),['slide-7','slide-8','slide-9','slide-10','slide-11','slide-12']);assert.deepEqual(out.slides.map(slide=>slide.title),outlineTitles.slice(6));assert.equal(out.slides.at(-1).layout,'closing');const wrongId=change(result,body=>{body.slides[0].id='slide-1';});assert.throws(()=>parseToolOutput(wrongId,value,second),/页码/);const wrongTitle=change(result,body=>{body.slides[0].title=outlineTitles[0];});assert.throws(()=>parseToolOutput(wrongTitle,value,second),/提纲不一致/);const joined=joinToolOutputs('ppt',[parseToolOutput(response(value,plan[0]),value,plan[0]),out],plan);assert.equal(joined.slides.length,12);assert.deepEqual(joined.slides.map(slide=>slide.title),outlineTitles);});

test('partial final unit retains its own title count and final closing page',()=>{const value=normalizeToolRequest(request({pages:7,outlineTitles:titles(7),notesMode:'none'})),plan=toolRunPlan(value),second=plan[1];assert.equal(second.start,6);assert.equal(second.count,1);assert.deepEqual(toolRunTask(value,second).context.presentationRequirements.titles,['第7页 已确认标题']);const out=parseToolOutput(response(value,second),value,second);assert.equal(out.slides.length,1);assert.equal(out.slides[0].id,'slide-7');assert.equal(out.slides[0].layout,'closing');});

test('author metadata is bounded single-line text and is not silently shortened',()=>{for(const author of ['', '合成作者', 'a'.repeat(100)]){const value=normalizeToolRequest(request({author}));assert.equal(value.snapshot.context.author,author);assert.equal(toolRunTask(value,toolRunPlan(value)[0]).context.options.author,author);}for(const author of ['a'.repeat(101),null,1,false,{},[],...['\n','\r','\t','\u2028','\u2029','\u0000','\u001f'].map(character=>'作者'+character+'后续')])assert.throws(()=>normalizeToolRequest(request({author})),/作者署名/,JSON.stringify(author));});

test('new metadata normalization does not mutate the caller and is stable across snapshot restore requests',()=>{const input=request({notesMode:'detailed',outlineTitles:titles(12),author:'Synthetic Author'}),before=structuredClone(input),first=normalizeToolRequest(input),second=normalizeToolRequest({kind:first.kind,operation:first.operation,snapshot:structuredClone(first.snapshot)});assert.deepEqual(input,before);assert.deepEqual(second.snapshot,first.snapshot);assert.equal(second.inputHash,first.inputHash);});

test('historical snapshots preserve absent new fields, stable hashes and the previous note parser allowance',()=>{const input=request(),first=normalizeToolRequest(input),second=normalizeToolRequest({kind:first.kind,operation:first.operation,snapshot:structuredClone(first.snapshot)});for(const field of ['notesMode','outlineTitles','author'])assert.equal(Object.hasOwn(first.snapshot.context,field),false);assert.deepEqual(second.snapshot,first.snapshot);assert.equal(second.inputHash,first.inputHash);const unit=toolRunPlan(first)[0],task=toolRunTask(first,unit);assert.equal(task.context.presentationRequirements.notesMode,'concise');assert.equal(task.context.presentationRequirements.maxNotesCharacters,120);assert.equal(task.context.presentationRequirements.titles,undefined);assert.equal(parseToolOutput(response(first,unit,{notes:'注'.repeat(1600)}),first,unit).slides[0].notes.length,1600);assert.throws(()=>parseToolOutput(response(first,unit,{notes:'注'.repeat(1601)}),first,unit),/生成结果结构/);});

test('historical client snapshots still round trip with no implicit new note or outline setting',()=>{const base={title:'合成旧版答辩',material:'用户提供的合成论文材料，用于验证历史任务恢复。',prompt:'依据输入材料制作汇报。',pages:6,minutes:10,author:'旧版作者',school:'',advisor:'',theme:'academic',degree:'本科',scenario:'毕业论文答辩',language:'中文',slides:[]},snapshot=presentationSnapshot(base,'thesis','premium'),restored=restorePresentationSnapshot(snapshot,base),again=presentationSnapshot(restored,'thesis','premium');assert.equal(Object.hasOwn(snapshot.context,'notesMode'),false);assert.equal(Object.hasOwn(snapshot.context,'outlineTitles'),false);assert.deepEqual(again,snapshot);assert.equal(normalizeToolRequest({kind:'presentation',operation:'ppt',snapshot}).snapshot.context.author,'旧版作者');});

test('explicit note contracts reject non-string generated notes instead of coercing them to empty text',()=>{for(const mode of ['none','concise','detailed']){const value=normalizeToolRequest(request({notesMode:mode})),unit=toolRunPlan(value)[0];for(const notes of [false,0,null]){const result=response(value,unit,{notes});assert.throws(()=>parseToolOutput(result,value,unit),/备注|结构/,mode+' '+String(notes));}}});

test('second content batch unambiguously submits six global pages with a current-batch completion flag',()=>{
 const input=request({notesMode:'concise'});input.snapshot.text='合'.repeat(13392);
 const value=normalizeToolRequest(input),unit=toolRunPlan(value)[1],task=toolRunTask(value,unit,[{slides:[{title:'以前批次'}]}]);
 const {batch,totalDeckPages}=task.context.presentationRequirements;
 assert.equal(totalDeckPages,12);assert.equal(batch.outputSlideCount,6);assert.equal(batch.firstPage,7);assert.equal(batch.lastPage,12);
 assert.deepEqual(batch.requiredSlideIds,['slide-7','slide-8','slide-9','slide-10','slide-11','slide-12']);
 assert.deepEqual(task.context.outputSchema.slides.map(s=>s.id),batch.requiredSlideIds);
 assert.deepEqual(batch.pages.map(s=>s.allowedLayouts),[...Array.from({length:5},()=>['content','twoColumn']),['closing']]);
 assert.equal(task.context.outputSchema.complete,true);assert.match(task.instructions,/complete是“当前批次/);assert.match(task.instructions,/每个分段读取一次/);
 assert.doesNotMatch(task.instructions,/翻译|改写|Mermaid|LaTeX|target\/count/);
 assert.deepEqual(task.context.sourceReadPlan,[{id:'original',offset:0,limit:8000},{id:'original',offset:8000,limit:5392}]);
 assert.equal(task.context.previous[0].titles[0],'以前批次');assert.deepEqual(task.materials,value.snapshot.materials);
});

test('batch validation points to exact missing pages, completion, identity and oversized field without changing output',()=>{
 const value=normalizeToolRequest(request({notesMode:'concise'})),unit=toolRunPlan(value)[1],good=response(value,unit),ids=JSON.parse(good.text).slides.map(s=>s.id);
 for(const count of [1,5,12]){
  const bad=change(good,b=>{b.slides=Array.from({length:count},()=>b.slides[0]);}),before=bad.text,checked=validateToolCandidate(bad,value,unit);
  assert.equal(checked.valid,false);assert.deepEqual(checked.feedback.presentation,{code:'ppt_page_count',expectedCount:6,actualCount:count,requiredSlideIds:ids,firstPage:7,lastPage:12});assert.equal(bad.text,before);
 }
 for(const complete of [false,'true',undefined]){
  const checked=validateToolCandidate(change(good,b=>{b.complete=complete;}),value,unit);
  assert.equal(checked.feedback.presentation.code,'ppt_completion');assert.equal(checked.feedback.presentation.requiredComplete,true);assert.equal(checked.feedback.presentation.completionScope,'current_batch');assert.equal(checked.feedback.presentation.expectedCount,6);
 }
 for(const mutate of [b=>{b.slides[0].id='slide-1';},b=>{b.slides[0].layout='closing';}]){
  const checked=validateToolCandidate(change(good,mutate),value,unit);assert.deepEqual(checked.feedback.presentation,{code:'ppt_page_identity',page:7,expectedId:'slide-7',allowedLayouts:['content','twoColumn']});
 }
 const oversized=change(good,b=>{b.slides[2].notes='注'.repeat(121);}),before=oversized.text,checked=validateToolCandidate(oversized,value,unit);
 assert.deepEqual(checked.feedback.presentation,{code:'ppt_field',page:9,field:'notes',maxCharacters:120,minCharacters:0,actualCharacters:121});assert.equal(oversized.text,before);
 assert.equal(validateToolCandidate(good,value,unit).valid,true);
});

test('missing source feedback requests only unread spans and cannot turn an unread candidate into a pass',()=>{
 const input=request();input.snapshot.text='合'.repeat(13392);const value=normalizeToolRequest(input),unit=toolRunPlan(value)[1],good=response(value,unit);
 const partial={...good,trace:[{tool:'read_material',status:'completed',materialId:'original',offset:0,limit:8000},{tool:'read_material',status:'completed',materialId:'original',offset:10000,limit:3392}]};
 const checked=validateToolCandidate(partial,value,unit);assert.equal(checked.valid,false);assert.deepEqual(checked.feedback.presentation,{code:'ppt_source_read',missingReads:[{id:'original',offset:8000,limit:2000}]});
 assert.equal(validateToolCandidate({...partial,trace:[...partial.trace,{tool:'read_material',status:'completed',materialId:'original',offset:8000,limit:2000}]},value,unit).valid,true);
 const forged={...good,trace:good.trace.map(r=>({...r,materialId:'another-source'}))};assert.equal(validateToolCandidate(forged,value,unit).valid,false);
});
