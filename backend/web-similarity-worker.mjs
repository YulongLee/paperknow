import {concurrentDetection} from './detection-concurrency.mjs';
import {randomUUID} from 'node:crypto';
import {parseDocument,countChars} from '../dist/precheck/engine.mjs';
import {reportHtml} from '../dist/precheck/export.mjs';
import {compute} from './compute.mjs';
import {moderateTextOrFail} from './moderated-agent.mjs';
import {createBillingService} from './billing-service.mjs';
import {createWebSimilaritySearch} from './web-similarity-search.mjs';
import {createWebSourceReader} from './web-similarity-source.mjs';
import {initializeWebSimilaritySchema,webSimilarityReady,readWebSimilarityArtifact,saveWebSimilarityArtifact,removeWebSimilarityArtifacts} from './web-similarity-service.mjs';
import {includedDetectionHeld,detectionWasFunded,detectionPricing,detectionTrialSearchCount} from './detection-entitlements.mjs';
import {webSimilarityLimits,webSimilarityVersion,planWebQueries,webSimilarityDay,webSimilarityFileName} from './web-similarity-model.mjs';

const safeError=message=>Object.assign(new Error(message),{webSimilaritySafe:true});
export function startWebSimilarityWorker(db,config={}){
 initializeWebSimilaritySchema(db);
 const billing=config.billing||createBillingService(db,config);
 const clock=()=>new Date().toISOString(),tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}};
 let busy=false,stopped=false;const controllers=new Map();
 // An interrupted search may already be billable upstream. Never replay it.
 tx(()=>{const interrupted=db.prepare("SELECT id FROM jobs WHERE type='web_similarity' AND status IN ('preparing','running')").all();db.prepare("UPDATE jobs SET status='failed',stage='interrupted',error='服务切换中断了本次查重，未自动重复检索，也未生成完整相似度。请查看记录后联系支持。',updated_at=? WHERE type='web_similarity' AND status IN ('preparing','running')").run(clock());for(const job of interrupted)billing.release(job.id);});
 const active=id=>!stopped&&db.prepare("SELECT 1 FROM jobs WHERE id=? AND type='web_similarity' AND status='running'").get(id);
 const stage=(id,value)=>db.prepare("UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND status='running'").run(value,clock(),id);
 const saveCoverage=(id,value)=>db.prepare('UPDATE web_similarity_runs SET coverage=?,updated_at=? WHERE id=?').run(JSON.stringify(value),clock(),id);
 async function tick(){
  if(busy||stopped)return;
  const job=db.prepare("SELECT j.*,r.title,r.input_artifact_id FROM jobs j JOIN web_similarity_runs r ON r.id=j.id WHERE j.type='web_similarity' AND j.status='queued' ORDER BY j.created_at LIMIT 1").get();
  if(!job){
   const pending=db.prepare("SELECT j.id,j.user_id,j.status FROM jobs j JOIN web_similarity_runs r ON r.id=j.id WHERE r.created_artifacts!='[]' AND r.updated_at<? AND (j.status IN ('failed','cancelled') OR (j.status='completed' AND EXISTS (SELECT 1 FROM json_each(r.created_artifacts) WHERE value=r.input_artifact_id))) ORDER BY r.updated_at LIMIT 1").get(new Date(Date.now()-60000).toISOString());
   if(pending){busy=true;try{await removeWebSimilarityArtifacts(db,config,pending,{inputOnly:pending.status==='completed'});}finally{busy=false;}}
   return;
  }
  busy=true;const controller=new AbortController(),signal=controller.signal;controllers.set(job.id,controller);
  const timer=setTimeout(()=>controller.abort(),300000);timer.unref?.();let attempted=0;const usages=[];
  try{
   if(!db.prepare("UPDATE jobs SET status='running',stage='reading_input',attempt=attempt+1,updated_at=? WHERE id=? AND status='queued'").run(clock(),job.id).changes)return;
   if(detectionPricing(config.billing,'detection-similarity').pointsCharged&&!includedDetectionHeld(db,job.user_id,job.id,'detection-similarity'))throw safeError('本次检测费用预占已失效；请查看原任务。');
   if(!webSimilarityReady(config))throw safeError('论文重复率检测暂不可用，请稍后查看任务或联系支持。');
   const payload=await readWebSimilarityArtifact(db,config,job.input_artifact_id,job.user_id);
   if(payload.version!==1||payload.runId!==job.id||typeof payload.text!=='string'||Array.from(payload.text).length>webSimilarityLimits.maxCharacters||payload.title!==job.title)throw safeError('查重输入文件校验未通过，请重新确认正文。');
   const parsed=parseDocument(payload.text,payload.title),plan=planWebQueries(parsed),search=config.webSimilaritySearch||createWebSimilaritySearch(config),reader=config.webSimilaritySourceReader||createWebSourceReader();
   const readSource=typeof reader==='function'?reader:(url,options)=>reader.read(url,options);
   const coverage={sampledParagraphs:plan.sampledParagraphs,totalParagraphs:plan.totalParagraphs,queries:plan.queries.length,candidateSources:0,fetchedSources:0,failedSources:0,searchComplete:false};
   stage(job.id,'checking_input');await moderateTextOrFail(config,plan.queries.map(x=>x.excerpt).join('\n'),{kind:'input',signal});
   const candidates=new Map(),searches=[],searchResults=[];
   stage(job.id,'searching');
   await concurrentDetection(plan.queries,2,async(query,i)=>{
    if(!active(job.id)||signal.aborted)return;
    tx(()=>{
     if(!includedDetectionHeld(db,job.user_id,job.id,'detection-similarity')){
      if(detectionPricing(config.billing,'detection-similarity').pointsCharged||detectionWasFunded(db,job.user_id,job.id,'detection-similarity'))throw safeError('本次检测费用预占已失效，请重新提交。');
      const day=webSimilarityDay(),window={since:day.start,until:day.end};
      if(detectionTrialSearchCount(db,{...window,userId:job.user_id})>=webSimilarityLimits.userDailyLimit*webSimilarityLimits.maxQueries)throw safeError('今日试用次数已用完，请稍后再试。');
      if(detectionTrialSearchCount(db,window)>=webSimilarityLimits.globalDailyLimit*webSimilarityLimits.maxQueries)throw safeError('今日试用额度已用完，请稍后再试。');
     }
     db.prepare('INSERT INTO web_similarity_attempts VALUES(?,?,?,?)').run(job.id,i,job.user_id,clock());
     db.prepare('UPDATE web_similarity_runs SET queries_attempted=queries_attempted+1,updated_at=? WHERE id=?').run(clock(),job.id);
    });
    attempted++;usages[i]=null;
    try{const result=await search.search(query.excerpt,{signal});usages[i]=result.usage||null;searchResults[i]=result.sources||[];searches[i]={paragraphId:query.paragraphId,searched:result.searched===true,sourceCount:result.sources?.length||0};}
    catch(error){if(signal.aborted||!active(job.id))return;searches[i]={paragraphId:query.paragraphId,searched:false,sourceCount:0};}
   });
   if(!active(job.id)||signal.aborted)return;
   // Stable query order prevents response timing from choosing the report's evidence.
   for(const result of searchResults)for(const source of (result||[]).slice(0,10)){
    try{const u=new URL(source.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)continue;u.hash='';if(!candidates.has(u.href))candidates.set(u.href,{title:String(source.title||'公开网页').slice(0,300),url:u.href});}catch{}
   }
   coverage.candidateSources=candidates.size;saveCoverage(job.id,coverage);
   if(!candidates.size)throw safeError('本次检测未取得足够的比对资料，未生成检测结论。请稍后重试。');
   stage(job.id,'reading_sources');const sources=[],sourceStates=[],readResults=[];
   const selected=[...candidates.values()].slice(0,webSimilarityLimits.maxSources);
   await concurrentDetection(selected,3,async(candidate,index)=>{
    if(!active(job.id)||signal.aborted)return;
    try{const source=await readSource(candidate.url,{signal});if(typeof source?.text!=='string'||source.text.length>100000||countChars(source.text)<40)throw safeError('网页正文不足，未纳入比对');readResults[index]={source,candidate};}
    catch(error){if(signal.aborted||!active(job.id))return;readResults[index]={candidate,invalidURL:error?.code==='web_source_invalid_url'};}
   });
   if(!active(job.id)||signal.aborted)return;
   for(const result of readResults){if(!result)continue;const {source,candidate}=result;
    if(source){if(!sources.some(s=>s.contentHash===source.contentHash&&s.contentHash))sources.push({...source,id:'web-source-'+(sources.length+1),title:source.title||candidate.title,authors:[],year:null,doi:null,kind:'web',provider:'本次可访问的公开网页'});sourceStates.push({url:source.url,title:source.title||candidate.title,status:'fetched',fetchedAt:source.fetchedAt});}
    else sourceStates.push({url:result.invalidURL?'':candidate.url,title:candidate.title,status:'unavailable',error:'未能取得可比对正文，未计入相似度。'});
   }
   coverage.fetchedSources=sources.length;coverage.failedSources=sourceStates.filter(s=>s.status==='unavailable').length;saveCoverage(job.id,coverage);
   if(!sources.length)throw safeError('本次检测未取得足够的比对资料，未生成检测结论。请稍后重试。');
   if(!active(job.id)||signal.aborted)return;
   coverage.searchComplete=searches.length===plan.queries.length&&searches.every(s=>s.searched)&&!coverage.failedSources&&candidates.size<=webSimilarityLimits.maxSources;
   stage(job.id,'comparing');
   const report=await (config.webSimilarityCompute||compute)('webSimilarity',{text:payload.text,title:payload.title,sources,id:job.id},signal);
   if(!active(job.id)||signal.aborted)return;
   report.id=job.id;report.createdAt=clock();report.mode='web';report.scope='public-web-sources';report.algorithm=webSimilarityVersion;report.semanticStatus='not_calculated';
   report.citationPolicy='未自动扣除引用；请人工核对规范引用，避免将有引用的文字直接视为不当使用。';
   report.web={...coverage,querySamples:plan.queries,searches,sources:sourceStates,limitations:[
    `本次从 ${plan.totalParagraphs} 个正文段落中选取 ${plan.sampledParagraphs} 段、${plan.queries.length} 个片段进行检索；不是逐句穷尽检索。`,
    `只对实际取得的 ${sources.length} 份网页正文与送检正文进行文字比对；每页最多读取 50,000 字符。`,
    '未覆盖学校封闭数据库、需要登录或付费的正文、未被检索到的网页及本期不支持的 PDF 来源。',
    '相似占比由实际文字匹配区间合并去重计算，不是大模型估算；未发现匹配不代表全网无重复。',
    ...(!coverage.searchComplete?['部分检索或网页读取未完成，或候选数量超出本次读取上限；本结果的来源范围受限。']:[])
   ]};
   stage(job.id,'saving_report');saveCoverage(job.id,coverage);
   const jsonId=await saveWebSimilarityArtifact(db,config,job,Buffer.from(JSON.stringify({version:1,report})),webSimilarityFileName(job.title,'_'+job.id+'_论文重复率检测.json'));
   db.prepare('UPDATE web_similarity_runs SET report_artifact_id=? WHERE id=?').run(jsonId,job.id);
   if(!active(job.id)||signal.aborted)return;
   const htmlId=await saveWebSimilarityArtifact(db,config,job,Buffer.from(reportHtml(report)),webSimilarityFileName(job.title,'_'+job.id+'_论文重复率检测.html'));
   db.prepare('UPDATE web_similarity_runs SET html_artifact_id=? WHERE id=?').run(htmlId,job.id);
   if(!active(job.id)||signal.aborted)return;
   tx(()=>{
    if(!active(job.id))return;
    const id=randomUUID(),at=clock();
    db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)').run(id,job.user_id,null,job.id,'web_similarity',job.title+' · 论文重复率检测',JSON.stringify({webSimilarityId:job.id,reportId:job.id,characters:report.totalChars,ratio:report.ratio,matchedCharacters:report.similarChars,sourceCount:report.sourceCount,coverage,scope:'本次纳入的比对资料；不保证覆盖全部文献'}),at);
    db.prepare("UPDATE jobs SET status='completed',stage='completed',result_id=?,updated_at=? WHERE id=? AND status='running'").run(id,at,job.id);
    billing.settle(job.id);
   });
  }catch(error){
   const message=signal.aborted?'本次检测超时或中断，未生成完整报告，预占权益将释放。':error?.webSimilaritySafe||error?.moderationSafe?error.message:'论文重复率检测未能完成，请稍后查看记录或联系支持；未生成不完整相似度。';
   tx(()=>{db.prepare("UPDATE jobs SET status='failed',stage='failed',error=?,updated_at=? WHERE id=? AND status='running'").run(message.slice(0,240),clock(),job.id);billing.release(job.id);});
  }finally{
   clearTimeout(timer);
   tx(()=>{if(db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id)?.status==='running')db.prepare("UPDATE jobs SET status='failed',stage='interrupted',error='本次检测被中断，未生成完整报告，预占权益将释放。',updated_at=? WHERE id=?").run(clock(),job.id);if(db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id)?.status!=='completed')billing.release(job.id);});
   if(attempted){
    db.prepare('UPDATE web_similarity_runs SET usage=?,updated_at=? WHERE id=?').run(JSON.stringify(usages),clock(),job.id);
    const tokens=key=>usages.length===attempted&&usages.every(u=>Number.isSafeInteger(u?.[key])&&u[key]>=0)?usages.reduce((n,u)=>n+u[key],0):null;
    db.prepare('INSERT OR IGNORE INTO usage VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),job.user_id,job.id,'configured_search_endpoint',config.webSimilarityModel||'qwen3.8-flash',tokens('inputTokens'),tokens('outputTokens'),0,clock());
   }
   const completed=db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id)?.status==='completed';
   try{await removeWebSimilarityArtifacts(db,config,job,{inputOnly:completed});}catch{/* owned cleanup metadata remains for the next maintenance tick */}
   controllers.delete(job.id);busy=false;
  }
 }
 const timer=setInterval(()=>void tick().catch(()=>{}),1000);timer.unref?.();
 return{tick,cancel(id){controllers.get(id)?.abort();},async stop(){stopped=true;clearInterval(timer);for(const c of controllers.values())c.abort();while(busy)await new Promise(r=>setTimeout(r,10));}};
}
