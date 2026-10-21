// Pure admission/planning policy. These estimates never replace the runtime's
// request reservation, actual provider usage, or administrator's explicit cap.
const runFloor=400000,runCeiling=2000000;
const fail=(message,code='invalid_execution_budget')=>{throw Object.assign(new Error(message),{status:400,code});};
const integer=(value,fallback,min,max)=>{
 if(value===undefined||value===null||value==='')return fallback;
 const number=Number(value);
 if(!Number.isSafeInteger(number)||number<min||number>max)fail(`执行预算应为 ${min}～${max} 的整数`);
 return number;
};
const bytes=(value,ceiling)=>{
 let serialized;try{serialized=JSON.stringify(value??{});}catch{fail('论文预算上下文必须可序列化');}
 return Math.min(ceiling,Buffer.byteLength(serialized));
};

export function sectionWordsForRuntime(settings={},language='中文',configured=1800){
 const ceiling=integer(configured,1800,200,2500),output=integer(settings.maxOutputTokens,4096,32,16384);
 // Leave room for the full JSON envelope, evidence IDs, missing-evidence notes
 // and tokenization variation. The target's upper length tolerance is 120%.
 const reserved=640,perWord=/english|英文|英语/i.test(language)?1.65:2.75;
 const capacity=Math.floor((output-reserved)/(perWord*1.2)/50)*50;
 if(capacity<200)fail('当前模型输出预算不足以生成完整论文章节，请在后台提高单次输出上限','output_budget_too_small');
 return Math.min(ceiling,capacity);
}

export function computeThesisRunBudget({snapshot={},plan,settings={},config={}}={}){
 // Explicit operator limits always win, including a cap below the default.
 if(config.thesisMaxRunTokens!==undefined&&config.thesisMaxRunTokens!==null&&config.thesisMaxRunTokens!=='')return integer(config.thesisMaxRunTokens,runFloor,1000,runCeiling);
 if(!Array.isArray(plan)||!plan.length||plan.length>120)fail('论文生成单元数量无效');
 const turns=integer(settings.maxTurns,6,1,12),output=integer(settings.maxOutputTokens,4096,32,16384);
 const sources=[...(Array.isArray(snapshot.materials)?snapshot.materials:[]),...(Array.isArray(snapshot.references)?snapshot.references:[])].filter(row=>row?.confirmed===true&&typeof row.text==='string'&&row.text.trim());
 // The chapter selector supplies at most ten sources and two 1200-character
 // excerpts per source. Count their maximum bounded content, never whole PDFs.
 const evidence=sources.map(row=>Buffer.byteLength(row.text.slice(0,2400))).sort((a,b)=>b-a).slice(0,10).reduce((sum,size)=>sum+size,0);
 const metadata=bytes({title:snapshot.title,profile:snapshot.profile,requirements:snapshot.requirements,outline:snapshot.outline},90000);
 const priorContext=plan.length>1?12000:0;
 // A normal submitted section needs one writing turn, one material-reading
 // turn when evidence exists, and one bounded repair allowance. Four turns
 // covers a larger evidence set; configured lower limits are never exceeded.
 const expectedTurns=Math.min(turns,sources.length>4?4:sources.length?3:2);
 const requestBytes=18000+metadata+evidence+priorContext;
 const perUnit=requestBytes*expectedTurns+output*expectedTurns;
 const estimate=Math.ceil((plan.length*perUnit*1.25+perUnit)/1000)*1000;
 return Math.max(runFloor,Math.min(runCeiling,estimate));
}

export function classifyThesisRetry(error){
 const code=typeof error?.code==='string'?error.code.toLowerCase():'';
 const status=Number(error?.status);
 // Cancellation, access boundaries, moderation, evidence violations and cost
 // ceilings must not turn into an automatic second paid provider dispatch.
 const forbidden=new Set(['budget_exceeded','cost_budget','token_budget','usage_unknown','usage_incomplete','needs_materials','unknown_source','unread_source','draft_disclosure_missing','presentation_not_selected','unsupported_image','cancelled','aborted']);
 if([401,403,409,422,429,499].includes(status)||forbidden.has(code)||/(?:moderation|content_reject|permission|unauthori[sz]ed|authentication|budget)/.test(code))return {retryable:false,reason:'non_recoverable'};
 const usage=error?.usage;
 if(!usage||!Number.isSafeInteger(usage.input)||usage.input<0||!Number.isSafeInteger(usage.output)||usage.output<0||!Number.isSafeInteger(usage.input+usage.output)||usage.input+usage.output===0)return {retryable:false,reason:'usage_unknown'};
 if(['truncated','max_tokens','length'].includes(code))return {retryable:true,reason:'truncated'};
 if(['turn_limit','max_turns','error_max_turns'].includes(code))return {retryable:true,reason:'turn_limit'};
 if(['incomplete','word_limit_exceeded'].includes(code))return {retryable:true,reason:'length'};
 if(code==='invalid_json'||code==='invalid_output'&&typeof error.message==='string'&&/(?:JSON|完整性检查)/i.test(error.message))return {retryable:true,reason:'invalid_json'};
 return {retryable:false,reason:'non_recoverable'};
}
