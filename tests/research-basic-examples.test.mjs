import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {researchFigureChoices} from '../dist/workspace/research-figure-catalog.mjs';
import {normalizePublicationFigurePlan,publicationChartTypes} from '../backend/research-figure-plan.mjs';
import {publicationFigureKind} from '../backend/research-publication-policy.mjs';
import {renderPublicationVector} from '../backend/research-native-figure.mjs';

// Real, sometimes noncanonical provider responses are retained to reproduce the
// reported failures. Each must normalize against the current public example,
// keep its source data intact and render. No paid provider is called in tests.
const records=JSON.parse(readFileSync(new URL('./fixtures/research-basic-example-plans.json',import.meta.url)));
test('all 35 basic examples have Chinese and English provider-shape regression coverage',()=>{
 assert.equal(records.length,70);assert.equal(new Set(records.map(c=>c.id)).size,70);
 for(const c of researchFigureChoices('basic'))for(const language of ['中文','English'])assert.ok(records.some(r=>r.figureType===c.id&&r.language===language),c.id+' '+language);
});
test('every selectable basic data chart maps to a supported exact chart type and rejects substitution',()=>{
 const choices=researchFigureChoices('basic').filter(c=>publicationFigureKind({categoryId:'basic',...c})==='data');
 assert.ok(choices.length>0);
 for(const choice of choices){
  assert.ok(publicationChartTypes.includes(choice.id),choice.id+' must be a supported chart type');
  const sample=records.find(c=>c.figureType===choice.id&&c.language==='中文');assert.ok(sample,choice.id);
  const snapshot={title:choice.label,text:choice.example,mode:'basic',language:sample.language,context:{categoryId:'basic',figureType:choice.id,aspectRatio:'16:9',palette:'academic'}};
  assert.equal(normalizePublicationFigurePlan(sample.raw,snapshot).chartType,choice.id);
  const other=choice.id==='bar'?'pie':'bar';
  assert.throws(()=>normalizePublicationFigurePlan({...sample.raw,figure:{...sample.raw.figure,chartType:other}},snapshot),/所选图表类型/,choice.id);
 }
});
for(const c of records)test('built-in example provider response remains drawable: '+c.id,async()=>{
 const choice=researchFigureChoices('basic').find(x=>x.id===c.figureType),snapshot={title:choice.label,text:choice.example,mode:'basic',language:c.language,context:{categoryId:'basic',figureType:choice.id,aspectRatio:'16:9',palette:'academic'}};
 const plan=normalizePublicationFigurePlan(c.raw,snapshot);
 if(plan.kind!=='illustration')assert.equal((await renderPublicationVector(plan,snapshot)).grammarVerified,true);
});
