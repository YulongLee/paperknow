// Model routing and execution metadata belongs to operations, not customer data.
// Project only the service-owned envelopes below; never scan or rewrite a paper,
// source excerpt, saved revision, feedback message or user-defined data tree.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const privateFields=new Set(['model','modelId','modelName','aiModel','provider','aiProvider','engine','agentEngine','settingsVersion','settings_version','settings_meta','providerCalls','provider_calls','runtime','runtimeConfig','baseURL','baseUrl','endpoint','apiURL','aiURL','apiKey','api_key','aiKey','authToken','authorization','sealed_settings','sealedSettings']);
const withoutRuntime=value=>object(value)?Object.fromEntries(Object.entries(value).filter(([key])=>!privateFields.has(key))):value;
const genericError='AI 服务暂时未能完成本次处理，请稍后重试；已保存的内容会保留。';
const technicalIdentity=/(?:\b(?:codex|claude|anthropic|openai|deepseek|qwen|dashscope|bailian|gemini|gpt[-\s]?\d|sdk)(?:\b|[\d._/-])|百炼|千问|通义|智谱|豆包|Model\.[A-Za-z]+|ANTHROPIC_|OPENAI_|PK_AI_|PK_AGENT_|https?:\/\/\S+|api[-_ ]?key)/i;

// Read local configuration only; this never tests a connection or dispatches AI.
export async function configuredAIIdentityValues(config={}){
 const values=[];
 for(const read of [()=>config.getAI?.()||config,()=>config.getAgentSettings?.()]){
  let settings;try{settings=await read();}catch{continue;}if(!object(settings))continue;
  for(const key of ['aiModel','model','aiURL','baseURL','engine','aiKey','apiKey']){
   const value=settings[key];if(typeof value!=='string'||value.length<3)continue;values.push(value);
   if(key==='aiURL'||key==='baseURL')try{values.push(new URL(value).hostname);}catch{}
  }
 }
 return [...new Set(values)];
}
export function publicAIError(value,identityValues=[]){
 if(typeof value!=='string')return value;
 if(identityValues.some(identity=>typeof identity==='string'&&identity.length>=3&&value.toLowerCase().includes(identity.toLowerCase()))||technicalIdentity.test(value)||/后台.*(?:模型|Agent|连接配置)|(?:模型|Agent).*(?:配置|权限|接口|版本)/i.test(value))return genericError;
 return value.replace(/模型服务/g,'AI 服务').replace(/\bAgent\b/g,'AI');
}
const errorFields=(value,identityValues=[])=>object(value)?{...value,...(Object.hasOwn(value,'error')?{error:publicAIError(value.error,identityValues)}:{}),...(Object.hasOwn(value,'reason')?{reason:publicAIError(value.reason,identityValues)}:{})}:value;
const publicTrace=value=>Array.isArray(value)?value.filter(row=>object(row)&&['list_materials','read_material','text_statistics'].includes(row.tool)).map(row=>({tool:row.tool,status:['completed','failed','running'].includes(row.status)?row.status:'unknown',...(typeof row.materialId==='string'?{materialId:row.materialId}:{})})):value;
const taskIdentities=value=>object(value)?['model','provider','engine'].map(key=>value[key]).filter(value=>typeof value==='string'):[];
const publicTask=(value,identityValues=[])=>errorFields(withoutRuntime(value),[...identityValues,...taskIdentities(value)]);
const publicCapability=(value,identityValues=[])=>{
 const clean=publicTask(value,identityValues);
 return object(clean)&&clean.ready===false&&typeof clean.reason==='string'&&clean.reason?{...clean,reason:'AI 服务暂未开放，请稍后再试。'}:clean;
};
export function publicAIResultBody(value){
 const clean=withoutRuntime(value);if(!object(clean))return clean;
 return {...clean,...(Object.hasOwn(clean,'trace')?{trace:publicTrace(clean.trace)}:{})};
}
const publicResult=row=>object(row)?{...row,...(Object.hasOwn(row,'body')?{body:publicAIResultBody(row.body)}:{})}:row;
const publicThesis=(row,identityValues=[])=>{
 if(!object(row))return row;
 const clean=publicTask(row,identityValues);
 return {...clean,...(clean.job?{job:publicTask(clean.job,identityValues)}:{}),...(Array.isArray(clean.chapters)?{chapters:clean.chapters.map(value=>errorFields(value,identityValues))}:{}),...(Array.isArray(clean.sections)?{sections:clean.sections.map(value=>errorFields(value,identityValues))}:{})};
};
const publicWritingOutput=(value,identityValues=[])=>{
 if(!object(value))return value;
 const clean=errorFields(publicAIResultBody(value),identityValues);
 return {...clean,...(Array.isArray(clean.sections)?{sections:clean.sections.map(row=>errorFields(publicAIResultBody(row),identityValues))}:{})};
};
const publicWriting=(row,identityValues=[])=>{
 if(!object(row))return row;
 const clean=publicTask(row,identityValues);
 return {...clean,...(object(clean.output)?{output:publicWritingOutput(clean.output,identityValues)}:{}),...(Array.isArray(clean.sections)?{sections:clean.sections.map(value=>errorFields(publicAIResultBody(value),identityValues))}:{})};
};
const publicDraftPayload=payload=>{
 if(!object(payload))return payload;
 const clean=publicAIResultBody(payload);
 for(const key of ['outlineAIResult','methodSuggestion'])if(object(clean[key]))clean[key]=withoutRuntime(clean[key]);
 if(object(clean.methodPreview))clean.methodPreview=publicTask(clean.methodPreview);
 return clean;
};
const publicDraft=row=>object(row)&&object(row.payload)?{...row,payload:publicDraftPayload(row.payload)}:row;
const list=(value,key,project)=>Array.isArray(value?.[key])?{[key]:value[key].map(project)}:{};
const one=(value,project)=>object(value?.item)?{item:project(value.item)}:{};

export function publicAIResponse(path,value,{authorizedAdmin=false,identityValues=[]}={}){
 // Authorization is tied to the admin route, never just the viewer's role.
 if(authorizedAdmin&&(path==='/api/admin'||path?.startsWith('/api/admin/')))return value;
 if(!object(value))return value;
 let clean=errorFields(value,identityValues);
 const task=row=>publicTask(row,identityValues),thesis=row=>publicThesis(row,identityValues),writing=row=>publicWriting(row,identityValues);
 if(path==='/api/capabilities'){
  clean={...clean};delete clean.aiProvider;delete clean.agentEngine;
  for(const key of ['thesis','thesisOutline','thesisMethod','writing','tools'])if(object(clean[key]))clean[key]=publicCapability(clean[key],identityValues);
 }else if(path==='/api/usage')clean={...clean,...list(clean,'items',withoutRuntime)};
 else if(path==='/api/results'||/^\/api\/results\/[^/]+$/.test(path||''))clean={...clean,...one(clean,publicResult),...list(clean,'items',publicResult)};
 else if(path==='/api/jobs'||/^\/api\/jobs\//.test(path||''))clean={...clean,...one(clean,task),...list(clean,'items',task)};
 else if(path==='/api/theses'||path?.startsWith('/api/theses/'))clean={...(path.endsWith('/capabilities')?publicCapability(clean,identityValues):task(clean)),...one(clean,thesis),...list(clean,'items',thesis)};
 else if(path==='/api/tool-runs'||path?.startsWith('/api/tool-runs/'))clean={...(path.endsWith('/capabilities')?publicCapability(clean,identityValues):task(clean)),...one(clean,writing),...list(clean,'items',writing)};
 else if(path==='/api/writing'||path?.startsWith('/api/writing/'))clean={...(path.endsWith('/capabilities')?publicCapability(clean,identityValues):task(clean)),...one(clean,writing),...list(clean,'items',writing)};
 else if(path==='/api/workspace/drafts'||path?.startsWith('/api/workspace/drafts/'))clean={...clean,...one(clean,publicDraft),...list(clean,'items',publicDraft)};
 else if(/^\/api\/projects\/[^/]+$/.test(path||''))clean={...clean,...list(clean,'jobs',task),...list(clean,'results',publicResult),...list(clean,'drafts',publicDraft)};
 else if(path==='/api/account/export'){
  clean={...clean,...list(clean,'results',publicResult),...list(clean,'jobs',task),...list(clean,'drafts',publicDraft),...list(clean,'theses',thesis),...list(clean,'toolRuns',writing),...list(clean,'toolCheckpoints',row=>({...task(row),...(object(row.output)?{output:publicWritingOutput(row.output,identityValues)}:{})})),...list(clean,'writingRuns',writing),...list(clean,'writingCheckpoints',row=>({...task(row),...(object(row.output)?{output:publicWritingOutput(row.output,identityValues)}:{})})),...list(clean,'thesisRuns',task),...list(clean,'thesisOutlineRuns',task),...list(clean,'thesisMethodRuns',task),...list(clean,'thesisSections',row=>({...task(row),...(Object.hasOwn(row,'trace')?{trace:publicTrace(row.trace)}:{})}))};
 }
 return clean;
}
