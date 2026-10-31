import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {researchFigureChoices} from '../dist/workspace/research-figure-catalog.mjs';
import {researchDrawingSnapshot} from '../dist/workspace/research-drawing-studio.mjs';
import {normalizePublicationFigurePlan} from '../backend/research-figure-plan.mjs';
import {renderPublicationVector} from '../backend/research-native-figure.mjs';

// Recorded qwen3.6-flash responses to public synthetic example briefs. No paid
// calls, production accounts or credentials are used by this regression test.
const recorded=JSON.parse(readFileSync(new URL('./fixtures/research-example-plans.json',import.meta.url)));
test('all 301 examples contain concrete briefs instead of asking for an unspecified research subject',()=>{
 const choices=['basic','professional'].flatMap(researchFigureChoices);assert.equal(choices.length,301);
 for(const c of choices){assert.ok(c.example.length>20&&c.example.length<=6000,c.id);assert.doesNotMatch(c.example,/请先根据我的研究内容确定|请填写|待补充|请提供数据/,c.id);}
});
for(const c of recorded)test('recorded example preserves author data or requires a separate clean artwork brief: '+c.id,async()=>{
 const choice=researchFigureChoices(c.mode).find(x=>x.id===c.id);assert.ok(choice);
 const snapshot=researchDrawingSnapshot({figureType:c.id,prompt:choice.example,title:'示例兼容性验收',language:'中文',aspectRatio:'4:3',palette:'academic'},c.mode);
 if(c.plan.figure?.kind==='illustration'&&!c.plan.figure.artworkDescription){assert.throws(()=>normalizePublicationFigurePlan(c.plan,snapshot),{code:'figure_plan_invalid'});return;}
 const plan=normalizePublicationFigurePlan(c.plan,snapshot);assert.ok(plan.kind);
 if(plan.kind!=='illustration'){const r=await renderPublicationVector(plan,snapshot);assert.equal(r.grammarVerified,true);assert.ok(r.svg.includes('<svg'));}
});
