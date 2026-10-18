const unavailable=()=>Object.assign(new Error('内容审核服务暂不可用，请稍后重试；本次结果未发布。'),{status:503,moderationSafe:true});
export async function moderateTextOrFail(config,text,{kind='input',signal}={}){
 if(config.moderationEnabled!==true)return;
 if(!config.moderation?.ready||typeof config.moderation.checkText!=='function')throw unavailable();
 let result;try{result=await config.moderation.checkText(text,{kind,signal});}catch(error){if(error?.moderationSafe)throw error;throw unavailable();}
 if(result?.allowed===true)return;
 if(result?.allowed===false)throw Object.assign(new Error(kind==='output'?'本次生成内容未通过安全审核，结果未保存，预占权益将释放。':'提交内容未通过安全审核，请调整材料或联系支持；本次任务未执行生成。'),{status:400,moderationSafe:true,code:'content_rejected'});
 throw unavailable();
}
export function createModeratedAgentRunner(runner,config){
 return async args=>{
  if(config.moderationEnabled!==true)return runner(args);
  args.onStage?.('checking_input');
  // Only the selected task context and authorized materials are shared with the
  // moderation service. Credentials, deployment settings and other users' files
  // are not part of this payload. No silent truncation or sampling is allowed.
  await moderateTextOrFail(config,JSON.stringify({context:args.task?.context,materials:args.task?.materials}),{kind:'input',signal:args.signal});
  const result=await runner(args);args.onStage?.('checking_output');
  if(typeof result?.text!=='string'||!result.text.trim())throw unavailable();
  try{await moderateTextOrFail(config,result.text,{kind:'output',signal:args.signal});}catch(error){error.usage=result.usage;throw error;}
  return result;
 };
}
