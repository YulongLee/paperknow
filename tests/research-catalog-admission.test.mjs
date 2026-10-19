import test from 'node:test';
import assert from 'node:assert/strict';
import {researchFigureChoices} from '../dist/workspace/research-figure-catalog.mjs';
import {researchFigureSelection} from '../backend/research-figure-selection.mjs';
import {normalizeToolRequest} from '../backend/tool-run-model.mjs';
import {researchImagePrompt,createResearchImageClient} from '../backend/research-image-client.mjs';
import {researchDrawingSnapshot,normalizeResearchDrawingDraft} from '../dist/workspace/research-drawing-studio.mjs';

const snapshot=(choice,mode)=>({title:'我自己命名的研究图片',text:'画出研究过程中的关键元素与关系，所有标注清晰可读。',language:'中文',mode,materials:[],context:{categoryId:choice.categoryId,figureType:choice.id,aspectRatio:'16:9',palette:'academic'}});
const input=s=>({kind:'research',operation:'image',snapshot:s});
const legacyProfessionalIds=['3d-structure','product-render','exploded','simulation-structure','simulation-field','simulation-signal','optical-path','optical-system','optical-device','reaction-mechanism','material-structure','molecular-concept','geo-workflow','geo-layers','terrain-concept','engineering-section','engineering-assembly','engineering-system','building-concept','landscape-plan','building-layers','network-architecture','ml-workflow','attention-mechanism','cell-mechanism','experimental-protocol','biomolecule-network','circuit-block','circuit-concept','pcb-structure','stat-study-design','stat-distribution','stat-causal','control-loop','industrial-process','automation-sequence'];

test('every visible image scene is accepted with its exact canonical mode and domain',()=>{
 for(const mode of ['basic','professional']){
  const choices=researchFigureChoices(mode);assert.equal(new Set(choices.map(row=>row.id)).size,choices.length);
  for(const choice of choices){
   const s=snapshot(choice,mode),normalized=normalizeToolRequest(input(s));
   assert.equal(normalized.snapshot.context.figureType,choice.id);assert.equal(researchFigureSelection(normalized.snapshot).label,choice.label);
   const prompt=researchImagePrompt(normalized.snapshot);assert.ok(prompt.includes('图表类型：'+choice.label));assert.ok(prompt.includes('科研领域：'+choice.categoryLabel));assert.ok(prompt.includes('类型要求：'+choice.description));
   if(choice.familyLabel)assert.ok(prompt.includes(choice.familyLabel));if(choice.sceneLabel)assert.ok(prompt.includes(choice.sceneLabel));if(choice.guidance)assert.ok(prompt.includes(choice.guidance));
   assert.match(prompt,/不得声称真实执行任何仿真、工程设计或实验/);
  }
 }
});

test('every catalog scene survives the real UI draft snapshot, server normalization and canonical prompt path',()=>{
 for(const mode of ['basic','professional'])for(const choice of researchFigureChoices(mode)){
  const form={title:'用户自定义名称',prompt:'科研概念图：请保留我的研究对象、结构和清晰标注。',language:'English',figureType:choice.id,aspectRatio:'4:3',palette:'nature'},ui=researchDrawingSnapshot(form,mode),recovered=normalizeResearchDrawingDraft({version:1,form,jobState:{snapshot:ui}},mode),value=normalizeToolRequest(input(ui));
  assert.equal(recovered.form.figureType,choice.id);assert.deepEqual(value.snapshot.context,{categoryId:choice.categoryId,figureType:choice.id,aspectRatio:'4:3',palette:'nature'});
  assert.equal(value.snapshot.title,form.title);assert.equal(value.snapshot.text,form.prompt);assert.equal(value.snapshot.language,'English');assert.deepEqual(value.snapshot.materials,[]);
  const selected=researchFigureSelection(value.snapshot);assert.equal(selected.categoryLabel,choice.categoryLabel);assert.equal(selected.familyId,choice.familyId);assert.equal(selected.familyLabel,choice.familyLabel);assert.equal(selected.sceneLabel,choice.sceneLabel);assert.equal(selected.guidance,choice.guidance);
  const prompt=researchImagePrompt(value.snapshot);assert.ok(prompt.includes(choice.label));assert.ok(prompt.includes(choice.description));assert.ok(prompt.includes('English'));if(choice.familyLabel)assert.ok(prompt.includes(choice.familyLabel));if(choice.sceneLabel)assert.ok(prompt.includes(choice.sceneLabel));if(choice.guidance)assert.ok(prompt.includes(choice.guidance));
 }
});

test('legacy saved professional scene ids remain usable after the catalog expansion',()=>{
 const choices=researchFigureChoices('professional');
 for(const id of legacyProfessionalIds){const choice=choices.find(row=>row.id===id);assert.ok(choice,'旧版绘图类型应保留：'+id);assert.equal(normalizeToolRequest(input(snapshot(choice,'professional'))).snapshot.context.figureType,id);}
});

test('unknown, mode-swapped and domain-swapped image types fail before billing or dispatch',async()=>{
 const basic=researchFigureChoices('basic').find(row=>row.id==='flowchart'),pro=researchFigureChoices('professional').find(row=>row.id==='cell-mechanism'),valid=snapshot(basic,'basic');
 const candidates=[{...valid,context:{...valid.context,figureType:'not-a-real-scene'}},{...valid,context:{...valid.context,categoryId:'biomedicine'}},{...valid,mode:'professional'},{...snapshot(pro,'professional'),mode:'basic'},{...snapshot(pro,'professional'),context:{...snapshot(pro,'professional').context,categoryId:'engineering'}},{...valid,context:{...valid.context,figureType:'Flowchart'}}];
 let networkCalls=0;const client=createResearchImageClient({enabled:true,model:'qwen-image-2.1-turbo',apiKey:'sk-fixture-only',version:'fixture-version',workspaceId:'ws-fixture',baseURL:'https://dashscope.aliyuncs.com',timeoutMs:1000},{lookupImpl:async()=>{networkCalls++;throw Error('invalid input must not reach DNS');}});
 for(const s of candidates){assert.equal(researchFigureSelection(s),null);assert.throws(()=>normalizeToolRequest(input(s)),{status:400});assert.throws(()=>researchImagePrompt(s),{status:400});await assert.rejects(()=>client.generate(s),{status:400});}
 assert.equal(networkCalls,0);
});

test('a custom work name cannot substitute the selected figure type or domain guidance',()=>{
 const choice=researchFigureChoices('professional').find(row=>row.familyLabel&&row.guidance);assert.ok(choice);
 const s=snapshot(choice,'professional'),prompt=researchImagePrompt(s);
 assert.ok(prompt.includes('图表类型：'+choice.label));assert.ok(prompt.includes('作品名称（仅用于保存，不代替图表类型）：'+s.title));
 assert.ok(!prompt.includes('图表类型：'+s.title));assert.match(prompt,/仅生成静态示意图片，不调用或运行该软件/);
 assert.equal(researchFigureSelection({...s,context:{...s.context,figureLabel:'伪造类型'}}).label,choice.label);
 assert.throws(()=>normalizeToolRequest(input({...s,context:{...s.context,figureLabel:'伪造类型'}})),{status:400});
});
