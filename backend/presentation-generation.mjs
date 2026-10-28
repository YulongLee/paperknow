import {createPptMasterRuntime,PPT_MASTER_REVISION} from './ppt-master-runtime.mjs';
import {pptMasterDesignPlan,pptMasterSlideTask,parsePptMasterSlideOutput,validatePptMasterSlideCandidate} from './ppt-master-model.mjs';
import {toolStorageCheck} from './tool-run-service.mjs';
import {savePresentationDelivery} from './presentation-delivery.mjs';
import {validatedPresentationLayout} from './presentation-layout.mjs';
import {presentationGenerationStatus} from './presentation-readiness.mjs';
export {presentationGenerationStatus} from './presentation-readiness.mjs';

export async function generatePptMasterPresentation(db,config,{row,value,output,signal,isActive,onStage,runAuthor,onLayout=()=>{}}){
 const readiness=presentationGenerationStatus(config);if(!readiness.ready)throw Object.assign(new Error(readiness.reason),{status:503});
 const active=()=>!signal?.aborted&&isActive();
 const check=()=>{if(!active())throw Object.assign(new Error('演示任务已停止'),{status:499});};
 check();onStage('planning');
 const plan=pptMasterDesignPlan(value,output.slides,{sourceIds:output.sourceIds}),slides=[];let validatedOnly=false,recoveryReason=null;
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
  let baseline=null;try{baseline=validatedPresentationLayout(value,slide,plan);}catch(error){if(error.code!=='ppt_layout_capacity')throw error;}
  const task=pptMasterSlideTask(value,slide,plan,slides);if(baseline){task.context.startingSvg=baseline.svg;task.instructions+='\ncontext.startingSvg 是已通过完整校验的当前页面。以它为起点调整视觉；保持 data-pptx-page-role、所有内容组 ID、文字和 bounds 契约。先确保页面可交付，再改善构图；不要反复重新设计。';}
  let parsed;
  try{if(validatedOnly){if(!baseline)throw Object.assign(Error('当前页文字过密，无法安全完成排版'),{code:'ppt_layout_capacity',status:422});parsed=baseline;onLayout({method:'validated',page:index+1,reason:recoveryReason});}else{const generated=await runAuthor(task,candidate=>validatePptMasterSlideCandidate(candidate,value,slide,plan));check();parsed=parsePptMasterSlideOutput(generated,value,slide,plan);onLayout({method:'ai',page:index+1});}}
  catch(error){check();if(error.presentationFallbackSafe!==true||!baseline)throw error;parsed=baseline;validatedOnly=true;recoveryReason=error.code;onLayout({method:'validated',page:index+1,reason:error.code});}
  const json=JSON.stringify(parsed);
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
