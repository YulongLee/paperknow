import {createPptMasterRuntime,PPT_MASTER_REVISION} from './ppt-master-runtime.mjs';
import {pptMasterDesignPlan,pptMasterSlideTask,parsePptMasterSlideOutput,validatePptMasterSlideCandidate} from './ppt-master-model.mjs';
import {toolStorageCheck} from './tool-run-service.mjs';
import {savePresentationDelivery} from './presentation-delivery.mjs';
import {presentationGenerationStatus} from './presentation-readiness.mjs';
export {presentationGenerationStatus} from './presentation-readiness.mjs';

export async function generatePptMasterPresentation(db,config,{row,value,output,signal,isActive,onStage,runAuthor}){
 const readiness=presentationGenerationStatus(config);if(!readiness.ready)throw Object.assign(new Error(readiness.reason),{status:503});
 const active=()=>!signal?.aborted&&isActive();
 const check=()=>{if(!active())throw Object.assign(new Error('演示任务已停止'),{status:499});};
 check();onStage('planning');
 const plan=pptMasterDesignPlan(value,output.slides,{sourceIds:output.sourceIds}),slides=[];
 for(const [index,slide] of output.slides.entries()){
  check();onStage('authoring');const unitId='design-'+slide.id;
  const checkpoint=db.prepare('SELECT output FROM tool_checkpoints WHERE run_id=? AND unit_id=?').get(row.id,unitId);
  if(checkpoint){
   const saved=JSON.parse(checkpoint.output);
   // Resume only the same immutable page and re-run the full current validator.
   const material=pptMasterSlideTask(value,slide,plan,slides).materials[0];
   slides.push(parsePptMasterSlideOutput({text:JSON.stringify({complete:true,slide:{id:slide.id,title:slide.title,body:slide.body,layout:slide.layout,notes:slide.notes},svg:saved.svg,sourceIds:[material.id]}),trace:[{tool:'read_material',status:'completed',materialId:material.id,offset:0,limit:material.text.length}]},value,slide,plan));
   continue;
  }
  const generated=await runAuthor(pptMasterSlideTask(value,slide,plan,slides),candidate=>validatePptMasterSlideCandidate(candidate,value,slide,plan));check();
  const parsed=parsePptMasterSlideOutput(generated,value,slide,plan),json=JSON.stringify(parsed);
  toolStorageCheck(db,row.user_id,Buffer.byteLength(json),config);
  db.prepare('INSERT INTO tool_checkpoints(run_id,unit_id,position,output,created_at) VALUES(?,?,?,?,?)').run(row.id,unitId,1000+index,json,new Date().toISOString());slides.push(parsed);
 }
 check();onStage('validating');
 const renderer=config.pptMasterRenderer||((input)=>createPptMasterRuntime({runtimeRoot:config.pptMasterRuntimeRoot,pythonPath:config.pptMasterPython}).render(input));
 onStage('exporting');const rendered=await renderer({slides,signal,title:value.snapshot.title});check();
 if(!Buffer.isBuffer(rendered?.pptx))throw Object.assign(new Error('演示文件未通过导出校验，未结算本次费用'),{status:502});
 const delivery=await savePresentationDelivery(db,config,{runId:row.id,userId:row.user_id,title:value.snapshot.title,slides,pptx:rendered.pptx,revision:PPT_MASTER_REVISION,isActive,signal,onStage});check();
 return{...output,...delivery,presentationMetadata:{author:plan.metadata.author}};
}
