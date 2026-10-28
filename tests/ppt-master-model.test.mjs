import test from 'node:test';
import assert from 'node:assert/strict';
import {pptMasterDesignPlan,pptMasterSlideTask,pptMasterVisibleContent,parsePptMasterSlideOutput,validatePptMasterSlideCandidate} from '../backend/ppt-master-model.mjs';

const xml=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function fixture(){
 const value={operation:'ppt',snapshot:{title:'真实研究汇报',language:'中文',mode:'thesis',context:{pages:6,theme:'focus'},materials:[{id:'paper-1',name:'真实论文',text:'给定原文：样本来自三次测量，处理流程保持原始顺序。'}]}};
 const slides=Array.from({length:6},(_,index)=>({id:'slide-'+(index+1),title:index===1?'研究结果 & <分析>':'页面标题 '+(index+1),body:'样本来自三次测量 [1]\n处理流程保持原始顺序',layout:index===0?'cover':index===5?'closing':'content',notes:'核对原始材料，不补充测量结果。'}));
 const plan=pptMasterDesignPlan(value,slides,{sourceIds:['paper-1']}),slide=slides[1],task=pptMasterSlideTask(value,slide,plan);
 const visible=pptMasterVisibleContent(slide,plan),svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" data-pptx-page-role="content"><rect id="background" data-pptx-role="background" x="0" y="0" width="1280" height="720" fill="#FFFFFF"/>'+visible.map((row,index)=>{const footer=row.role==='footer',y=footer?670:40+index*170,h=footer?40:140,size=row.role==='title'?44:footer?16:26;return '<g id="'+row.id+'" data-pptx-bounds="60 '+y+' 1160 '+h+'"><text x="72" y="'+(y+60*(footer?0.4:1))+'" font-family="Microsoft YaHei" font-size="'+size+'" fill="#173E48">'+xml(row.text)+'</text></g>';}).join('')+'</svg>';
 const candidate={complete:true,slide:structuredClone(slide),svg,sourceIds:[task.materials[0].id]},result={text:JSON.stringify(candidate),trace:[{tool:'read_material',status:'completed',materialId:task.materials[0].id,offset:0,limit:8000}]};
 return{value,slides,slide,plan,task,candidate,result};
}
function parsed(f){return parsePptMasterSlideOutput({...f.result,text:JSON.stringify(f.candidate)},f.value,f.slide,f.plan);}

test('bounded PPT Master page tasks reuse accepted content, evidence and chosen theme',()=>{
 const f=fixture();assert.equal(f.plan.theme,'focus');assert.equal(f.plan.palette.accent,'#168B89');assert.equal(f.plan.canvas.viewBox,'0 0 1280 720');assert.ok(new Set(f.plan.slides.map(row=>row.composition)).size>=4);
 assert.equal(f.task.skill,'tool-task');assert.equal(f.task.materials.length,1);assert.deepEqual(JSON.parse(f.task.materials[0].text).slide,f.slide);assert.deepEqual(f.task.context.source.evidenceSourceIds,['paper-1']);assert.equal(f.task.context.outputSchema.slide.notes,f.slide.notes);
 assert.ok(f.task.instructions.length<12000);assert.ok(JSON.stringify(f.task.context).length<40000);assert.doesNotMatch(f.task.materials[0].text,/给定原文/);assert.match(f.task.instructions,/Copyright \(c\) 2025-2026 Hugo He/);
 const out=parsed(f);assert.equal(out.title,f.slide.title);assert.equal(out.notes,f.slide.notes);assert.deepEqual(out.sourceIds,['paper-1']);assert.deepEqual(out.authorSourceIds,[f.task.materials[0].id]);assert.match(out.svg,/&amp;/);
});

test('entities and editable multiline tspan runs preserve the exact accepted text',()=>{
 const f=fixture();f.candidate.svg=f.candidate.svg.replace('样本来自三次测量 [1]','样本来自<tspan font-weight="bold">三次测量</tspan><tspan x="72" dy="40"> [1]</tspan>');const out=parsed(f);assert.match(out.svg,/<tspan/);assert.equal(out.body,f.slide.body);
});

test('the renderer cannot rewrite semantic content, fabricate results, drop text or hide it',()=>{
 for(const change of [
  f=>{f.candidate.slide.notes='模型自行添加的备注';},
  f=>{f.candidate.svg=f.candidate.svg.replace('三次测量','八次测量');},
  f=>{f.candidate.svg=f.candidate.svg.replace('处理流程保持原始顺序','');},
  f=>{f.candidate.svg=f.candidate.svg.replace('<text x="72" y="270"','<text opacity="0" x="72" y="270"');},
  f=>{f.candidate.svg=f.candidate.svg.replace('font-size="26"','font-size="8"');},
  f=>{f.candidate.svg=f.candidate.svg.replace('</svg>','<text x="60" y="650" font-size="24">显著提升90%</text></svg>');}
 ]){const f=fixture();change(f);assert.throws(()=>parsed(f));const feedback=validatePptMasterSlideCandidate({...f.result,text:JSON.stringify(f.candidate)},f.value,f.slide,f.plan);assert.equal(feedback.valid,false);assert.equal(feedback.feedback.code,'invalid_ppt_master_output');}
});

test('source reads must cover the entire immutable page and cannot cite another page',()=>{
 const f=fixture();assert.throws(()=>parsePptMasterSlideOutput({...f.result,trace:[]},f.value,f.slide,f.plan),/完整读取/);assert.throws(()=>parsePptMasterSlideOutput({...f.result,trace:[{tool:'read_material',status:'completed',materialId:f.task.materials[0].id,offset:0,limit:20}]},f.value,f.slide,f.plan),/完整读取/);
 f.candidate.sourceIds=['ppt-master-slide-3'];assert.throws(()=>parsed(f),/当前已读取/);
});

test('page and visual bounds fail closed before any export can accept the design',()=>{
 const f=fixture();f.candidate.svg=f.candidate.svg.replace('data-pptx-bounds="60 210 1160 140"','data-pptx-bounds="60 100 1160 140"');assert.throws(()=>parsed(f),/重叠/);
 const overflow=fixture();overflow.candidate.svg=overflow.candidate.svg.replace('x="72" y="270"','x="1200" y="270"');assert.throws(()=>parsed(overflow),/超出/);
 const wrongPage=fixture();wrongPage.candidate.svg=wrongPage.candidate.svg.replace('data-pptx-page-role="content"','data-pptx-page-role="cover"');assert.throws(()=>parsed(wrongPage),/页面角色/);
});

test('matching text cannot be hidden by the same paint color, a later rectangle or overlapping lines',()=>{
 const sameColor=fixture();sameColor.candidate.svg=sameColor.candidate.svg.replaceAll('fill="#173E48"','fill="#FFFFFF"');assert.throws(()=>parsed(sameColor),/对比不足/);
 const covered=fixture();covered.candidate.svg=covered.candidate.svg.replace('</svg>','<rect x="0" y="0" width="1280" height="720" fill="#FFFFFF"/></svg>');assert.throws(()=>parsed(covered),/遮挡/);
 const overlap=fixture();overlap.candidate.svg=overlap.candidate.svg.replace('样本来自三次测量 [1]','样本来自<tspan x="72" dy="0.5">三次测量 [1]</tspan>');assert.throws(()=>parsed(overlap),/文字行重叠/);
 const inverse=fixture();inverse.candidate.svg=inverse.candidate.svg.replace('fill="#FFFFFF"','fill="#173E48"').replaceAll('fill="#173E48">','fill="#FFFFFF">');assert.equal(parsed(inverse).id,inverse.slide.id);
});

test('the design lock validates evidence refs, full page count and page order',()=>{
 const f=fixture();assert.throws(()=>pptMasterDesignPlan(f.value,f.slides.slice(0,5)),/页数/);assert.throws(()=>pptMasterDesignPlan(f.value,[f.slides[1],f.slides[0],...f.slides.slice(2)]),/顺序/);assert.throws(()=>pptMasterDesignPlan(f.value,f.slides,{sourceIds:['private-other-source']}),/来源/);
 const english=pptMasterDesignPlan({...f.value,snapshot:{...f.value.snapshot,language:'英文'}},f.slides);assert.equal(english.typography.fontFamily,'Arial');
});
