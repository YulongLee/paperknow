import test from 'node:test';
import assert from 'node:assert/strict';
import {visualFixture} from './fixtures/presentation-visuals.mjs';
import {pptMasterDesignPlan,pptMasterSlideTask,parsePptMasterSlideOutput} from '../backend/ppt-master-model.mjs';
import {validatedPresentationLayout} from '../backend/presentation-layout.mjs';
import {restorePresentationDesignCheckpoint} from '../backend/presentation-generation.mjs';

test('historical accepted checkpoints reflow into the selected family without another model call or changed wording',()=>{
 const f=visualFixture(),slide=f.slides[1],saved=validatedPresentationLayout(f.value,slide,f.plan);
 f.value.snapshot.context.theme='indigo';const plan=pptMasterDesignPlan(f.value,f.slides,{sourceIds:f.plan.sourceIds});plan.enforceTheme=true;
 const restored=restorePresentationDesignCheckpoint(f.value,slide,plan,saved);
 assert.equal(restored.title,slide.title);assert.equal(restored.body,slide.body);assert.equal(restored.notes,slide.notes);assert.deepEqual(restored.sourceIds,plan.sourceIds);assert.equal(restored.layoutMethod,'validated');assert.match(restored.svg,/fill="#0D1E35"/);
 assert.throws(()=>restorePresentationDesignCheckpoint(f.value,slide,plan,{...saved,svg:saved.svg.replace('读取','替换')}));
});

test('complex model pages cannot silently replace the chosen background with another template',()=>{
 const f=visualFixture(),slide=f.slides[1];f.value.snapshot.context.theme='indigo';const plan=pptMasterDesignPlan(f.value,f.slides,{sourceIds:f.plan.sourceIds});plan.enforceTheme=true;
 const page=validatedPresentationLayout(f.value,slide,plan),material=pptMasterSlideTask(f.value,slide,plan).materials[0];
 const result=svg=>({text:JSON.stringify({complete:true,slide:{id:slide.id,title:slide.title,body:slide.body,layout:slide.layout,notes:slide.notes},svg,sourceIds:[material.id]}),trace:[{tool:'read_material',status:'completed',materialId:material.id,offset:0,limit:material.text.length}]});
 assert.equal(parsePptMasterSlideOutput(result(page.svg),f.value,slide,plan).title,slide.title);
 assert.throws(()=>parsePptMasterSlideOutput(result(page.svg.replace('fill="#0D1E35"','fill="#FFFFFF"')),f.value,slide,plan));
});
