import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceRepairCandidate,normalizeSourceRepair} from '../backend/thesis-source-repair.mjs';
const source='这里说明相关模型的基本原理与其适用范围，不能证明真实实验效果。';
const snap={materials:[],references:[{id:'r1',confirmed:true,text:source}]};
const quote='该文献证明模型适用于所有情境。[source:r1]',checkpoint={text:'首句。'+quote+'其余正文保持不变。',source_ids:'["r1"]',figures:'[]',missing_evidence:'[]',trace:'[]'};
const finding={category:'source_support',quote},task={materials:[{id:'r1',text:source}]};
const candidate=(changes={})=>({text:JSON.stringify({complete:true,edits:[{old:quote,new:'“这里说明相关模型的基本原理与其适用范围”。[source:r1]',evidence:{sourceId:'r1',quote:'这里说明相关模型的基本原理与其适用范围'}}],...changes}),trace:[{tool:'read_material',status:'completed',materialId:'r1',offset:0,limit:6000}]});
test('source correction only edits a located statement and preserves markers, identifiers and surrounding text',()=>{
 assert.ok(sourceRepairCandidate(checkpoint,finding,snap));const normalized=normalizeSourceRepair(candidate(),checkpoint,finding,snap,task),body=JSON.parse(normalized.text);assert.equal(body.text,'首句。“这里说明相关模型的基本原理与其适用范围”。[source:r1]其余正文保持不变。');assert.deepEqual(body.source_ids,['r1']);
});
test('source correction requires a confirmed full source and exact range actually read',()=>{
 assert.equal(sourceRepairCandidate(checkpoint,finding,{materials:[],references:[{id:'r1',confirmed:true}]}),null);
 assert.equal(sourceRepairCandidate(checkpoint,finding,{materials:[],references:[{id:'r1',confirmed:false,text:source}]}),null);
 const noRead={...candidate(),trace:[]},badRange={...candidate(),trace:[{tool:'read_material',status:'completed',materialId:'r1',offset:20,limit:2}]};for(const value of [noRead,badRange])assert.throws(()=>normalizeSourceRepair(value,checkpoint,finding,snap,task));
 for(const evidence of [{sourceId:'r2',quote:source},{sourceId:'r1',quote:'伪造的文章内容与结论记录'}]){const body=JSON.parse(candidate().text);body.edits[0].evidence=evidence;assert.throws(()=>normalizeSourceRepair({...candidate(),text:JSON.stringify(body)},checkpoint,finding,snap,task));}
});
test('source correction refuses changing evidence markers, figures, numbers, or simulation status',()=>{
 for(const replacement of ['模型结果为95%。[source:r1]','模型适用于任何条件。[source:other]','模型在实际实验成功。[source:r1]','模型说明[figure:a][source:r1]']){const body=JSON.parse(candidate().text);body.edits[0].new=replacement;assert.throws(()=>normalizeSourceRepair({...candidate(),text:JSON.stringify(body)},checkpoint,finding,snap,task));}
 assert.equal(sourceRepairCandidate({...checkpoint,text:checkpoint.text+quote},finding,snap),null);
});

test('simulation materials cannot be quoted out of context as real evidence',()=>{
 const simulated={materials:[{id:'r1',confirmed:true,dataKind:'simulation',text:source}],references:[]};assert.equal(sourceRepairCandidate(checkpoint,finding,simulated),null);assert.throws(()=>normalizeSourceRepair(candidate(),checkpoint,finding,simulated,task));
 const simulationFlag={materials:[{id:'r1',confirmed:true,simulation:{jobId:'synthetic'},text:source}],references:[]};assert.equal(sourceRepairCandidate(checkpoint,finding,simulationFlag),null);
});

test('unique source snippets must cover a full sentence, not preserve an asserting prefix or suffix',()=>{
 const partial={text:'研究证明'+quote+'其余正文。',source_ids:'["r1"]',figures:'[]',missing_evidence:'[]',trace:'[]'};assert.equal(sourceRepairCandidate(partial,finding,snap),null);
 const inner='该模型适用[source:r1]',suffix={...partial,text:'该模型适用[source:r1]任何数据集。'};assert.equal(sourceRepairCandidate(suffix,{category:'source_support',quote:inner},snap),null);
});

test('simulation declarations in ordinary uploads also prevent source repair',()=>{
 for(const declaration of ['以下为模拟数据，并非真实实验。','本研究采用仿真结果。','This report contains simulated data.']){const stated={materials:[{id:'r1',confirmed:true,text:declaration+source}],references:[]};assert.equal(sourceRepairCandidate(checkpoint,finding,stated),null);assert.throws(()=>normalizeSourceRepair(candidate(),checkpoint,finding,stated,task));}
});
