import {randomUUID} from 'node:crypto';
import {sessionUser,sessionCookie,digest} from './auth.mjs';
import {createAuthService} from './auth-service.mjs';
import {createAuthDelivery} from './auth-delivery.mjs';
import {createAdminAPI} from './admin-api.mjs';
import {createPaymentService} from './payment-service.mjs';
import {createWorkspaceService} from './workspace-service.mjs';
import {createBillingService} from './billing-service.mjs';
import {createModelBudget} from './model-budget.mjs';
import {createThesisService} from './thesis-service.mjs';
import {createThesisOutlineService} from './thesis-outline-service.mjs';
import {createQuestionnaireService} from './questionnaire-service.mjs';
import {createToolRunService} from './tool-run-service.mjs';
import {createWritingService} from './writing-service.mjs';
import {createThesisMethodService} from './thesis-method-service.mjs';
import {aiReady} from './config.mjs';
import {configuredAIIdentityValues,publicAIResponse} from './public-ai-metadata.mjs';
import {createFileService} from './file-service.mjs';
import {createArtifactService} from './artifact-service.mjs';
import {createDocumentParseService} from './document-parse-service.mjs';
import {createDocumentTranslationService} from './document-translation-service.mjs';
import {createFormulaOcrService} from './formula-ocr-service.mjs';
import {createLiteratureSearch} from './literature-search.mjs';
import {createDesktopReleaseService} from './desktop-release-service.mjs';
import {now} from './database.mjs';
import {clientAddress} from './client-address.mjs';
class APIError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new APIError(status,message);};
const text=(v,max=200,min=1)=>{if(typeof v!=='string'||v.trim().length<min||v.length>max)fail(400,`请输入 ${min}～${max} 字符的有效内容`);return v.trim();};
const url=v=>{if(!v)return '';try{const u=new URL(v);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw 0;return u.href;}catch{fail(400,'来源网址必须是有效的 HTTP/HTTPS 链接');}};
async function body(req,maxBytes=3*1024*1024){if(!req.headers['content-type']?.startsWith('application/json'))fail(415,'请提交 JSON 内容');let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>maxBytes)fail(413,maxBytes===3*1024*1024?'请求超过 3MB 限制':'生成文件请求超过 28MB 限制');chunks.push(chunk);}try{const v=JSON.parse(Buffer.concat(chunks).toString());if(!v||Array.isArray(v)||typeof v!=='object')throw 0;return v;}catch{fail(400,'请求内容不是有效 JSON');}}
export function createAPI(db,worker,config={}){
const auth=createAuthService(db,{secret:config.authCodeSecret,dailyLimit:config.authDailyLimit,ownerEmail:config.ownerEmail,delivery:config.authDelivery||createAuthDelivery(config)});
const billing=createBillingService(db,config);
const modelBudget=createModelBudget(db,config);
const theses=createThesisService(db,{...config,billing,modelBudget,worker,cancelThesisRun:id=>worker.cancel(id)});
const thesisOutlines=createThesisOutlineService(db,{...config,billing,modelBudget,cancelThesisOutline:id=>worker.cancel(id)});
const thesisMethods=createThesisMethodService(db,{...config,billing,modelBudget,cancelThesisMethod:id=>worker.cancel(id)});
const writing=createWritingService(db,{...config,billing,modelBudget,cancelWriting:id=>worker.cancel(id)});
const tools=createToolRunService(db,{...config,billing,modelBudget,cancelToolRun:id=>worker.cancel(id)});
const questionnaires=createQuestionnaireService(db,config);
const payments=createPaymentService(db,{...config,billing});
const workspace=createWorkspaceService(db,{billing});
const files=createFileService(db,config);
const artifacts=createArtifactService(db,config);
const documentParses=createDocumentParseService(db,{...config,cancelDocumentParse:id=>worker.cancel(id)});
const documentTranslations=createDocumentTranslationService(db,{...config,cancelDocumentTranslation:id=>worker.cancel(id)});
const formulaRecognitions=createFormulaOcrService(db,config);
const literatureSearch=createLiteratureSearch({fetchImpl:config.literatureFetch,openAlexApiKey:config.openAlexApiKey,openAlexDailyLimit:config.openAlexDailyLimit});
const desktopReleases=createDesktopReleaseService(db,config);
const admin=createAdminAPI(db,worker,{...config,payments,billing},auth);
const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
const archiveAttempts=new Map();
const attempts=new Map();function rate(req,limit){const key=clientAddress(req,config);const t=Date.now();if(attempts.size>10000)for(const [k,v]of attempts)if(v.until<t)attempts.delete(k);const item=attempts.get(key)||{count:0,until:t+600000};if(item.until<t){item.count=0;item.until=t+600000;}item.count++;attempts.set(key,item);if(item.count>limit)fail(429,'请求过于频繁，请稍后重试');}
function own(table,id,user){const row=db.prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=?`).get(id,user.id);if(!row)fail(404,'记录不存在');if(table==='files'&&db.prepare("SELECT 1 FROM workspace_file_deletions WHERE file_id=? AND status='pending'").get(id))fail(409,'原件正在删除，请重新选择可用原件');return row;}
function project(id,user){if(id)own('projects',id,user);return id||null;}
return async(req,res)=>{let responsePath='',authorizedAdmin=false,identityValues=[];const send=(status,value,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(publicAIResponse(responsePath,value,{authorizedAdmin,identityValues})));};try{
const requestURL=new URL(req.url,'http://localhost');const path=requestURL.pathname;const method=req.method;
responsePath=path;
const adminRequest=path==='/api/admin'||path.startsWith('/api/admin/');
let adminUser;
if(adminRequest){adminUser=sessionUser(db,req,config.ownerEmail);if(!adminUser)fail(401,'请先登录');if(adminUser.role!=='admin')fail(403,'需要管理员权限');authorizedAdmin=true;}
if(!adminRequest&&/^\/api\/(?:capabilities|usage|jobs|results|theses|writing|tool-runs|projects|workspace\/drafts|account\/export)(?:\/|$)/.test(path))identityValues=await configuredAIIdentityValues(config);
if(!['GET','POST'].includes(method))fail(405,'不支持的请求方式');
const notification=path.match(/^\/api\/payments\/notify\/(wechat|alipay)$/);
if(notification&&method==='POST'){
 const provider=notification[1];
 try{
  const contentType=req.headers['content-type']||'';
  if(!(provider==='wechat'?contentType.startsWith('application/json'):contentType.startsWith('application/x-www-form-urlencoded')))fail(415,'支付回调格式不正确');
  const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>262144)fail(413,'支付回调内容过大');chunks.push(chunk);}
  await payments.notify(provider,{headers:req.headers,rawBody:Buffer.concat(chunks)});
  res.writeHead(provider==='wechat'?204:200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(provider==='wechat'?undefined:'success');
 }catch(error){const status=error.status>=400&&error.status<=599?error.status:400;res.writeHead(status,{'Content-Type':provider==='wechat'?'application/json; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end(provider==='wechat'?JSON.stringify({code:'FAIL',message:'支付通知尚未确认'}):'failure');}
 return;
}
if(method==='POST'){const origin=req.headers.origin;if(!origin||origin!==`${config.secure?'https':'http'}://${req.headers.host}`)fail(403,'请求来源不匹配');}
if(path==='/api/desktop/releases'&&method==='GET'){send(200,desktopReleases.catalog());return;}
const desktopDownload=path.match(/^\/api\/desktop\/download\/([^/]+)\/([^/]+)$/);
if(desktopDownload&&method==='GET'){rate(req,120);const location=await desktopReleases.download(desktopDownload[1],desktopDownload[2]);res.writeHead(302,{'Location':location,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}).end();return;}
if(path.startsWith('/api/questionnaires/public/')){if(method==='POST')rate(req,120);const response=await questionnaires.handle({path,method,user:null,query:requestURL.searchParams,readBody:()=>body(req),clientKey:clientAddress(req,config)});if(response){send(response.status,response.value);return;}fail(404,'问卷链接不存在');}
if(path==='/api/literature/search'&&method==='GET'){
 try{send(200,await literatureSearch.search(requestURL.searchParams,{clientKey:clientAddress(req,config)}));}
 catch(error){send(error.status||503,{error:error.message,...error.response},error.retryAfter?{'Retry-After':String(error.retryAfter)}:{});}
 return;
}
if(path==='/api/capabilities'&&method==='GET'){send(200,{account:true,storage:config.storage?.provider||'local_server_sqlite',emailVerified:auth.options().emailCode,auth:auth.options(),ai:aiReady(config.getAI()),agent:Boolean(config.agentEnabled&&aiReady(config.getAI())),billing:billing.rules(),payment:payments.options().enabled,academicSearch:true,academicSearchSources:literatureSearch.listSources(),academicSearchSourceStatus:literatureSearch.sourceStatus(),thesis:await theses.capabilities(),thesisOutline:await thesisOutlines.capabilities(),thesisMethod:await thesisMethods.capabilities(),writing:await writing.capabilities(),tools:await tools.capabilities(),documentParsing:documentParses.capabilities(),documentTranslation:documentTranslations.capabilities(),formulaOcr:formulaRecognitions.capabilities(),detection:{local:true,external:false,scope:'用户提供的对照材料；不含学校数据库或全网全文'},maxFileBytes:2*1024*1024,maxPDFFileBytes:20*1024*1024});return;}
if(path==='/api/payments/options'&&method==='GET'){send(200,payments.options());return;}
if(path==='/api/auth/options'&&method==='GET'){send(200,auth.options());return;}
const authRoutes={
  '/api/auth/login':(b,ip)=>auth.passwordLogin(b,ip),
  '/api/auth/code/send':(b,ip)=>auth.sendCode(b,ip),
  '/api/auth/code/login':b=>auth.codeLogin(b),
  '/api/auth/register':b=>auth.register(b),
  '/api/auth/password/reset':b=>auth.resetPassword(b),
};
if(method==='POST'&&Object.hasOwn(authRoutes,path)){
  rate(req,30);const result=await authRoutes[path](await body(req),clientAddress(req,config));
  if(result.token){send(200,{user:result.user},{'Set-Cookie':sessionCookie(result.token,config.secure)});}
  else send(200,result,path==='/api/auth/password/reset'?{'Set-Cookie':sessionCookie('',config.secure)}:{});
  return;
}
const user=adminUser||sessionUser(db,req,config.ownerEmail);if(!user)fail(401,'请先登录服务账户');
if(adminRequest){send(200,await admin({path,method,query:requestURL.searchParams,readBody:()=>body(req),user}));return;}
if(path==='/api/document-translations'||path.startsWith('/api/document-translations/')){if(method==='POST')rate(req,30);const response=await documentTranslations.handle({path,method,user,readBody:()=>body(req)});if(!response)fail(404,'文档翻译接口不存在');send(response.status||200,response.value);return;}
if(path==='/api/formula-recognitions'||path.startsWith('/api/formula-recognitions/')){if(method==='POST')rate(req,30);const response=await formulaRecognitions.handle({path,method,user,readBody:()=>body(req)});if(!response)fail(404,'公式识别接口不存在');send(response.status||200,response.value);return;}
if(path==='/api/document-parses'||path.startsWith('/api/document-parses/')){if(method==='POST')rate(req,30);const response=await documentParses.handle({path,method,user,readBody:()=>body(req)});if(!response)fail(404,'文档解析接口不存在');send(response.status||200,response.value);return;}
if(path==='/api/artifacts'||path.startsWith('/api/artifacts/')){
 if(method==='POST')rate(req,30);
 const response=await artifacts({path,method,user,query:requestURL.searchParams,readBody:()=>body(req,path==='/api/artifacts'?28*1024*1024:3*1024*1024)});
 if(!response)fail(404,'生成文件接口不存在');
 if(response.body!==undefined){
  const release=response.release||(()=>{});
  if(res.destroyed||res.writableEnded){release();return;}
  res.once('finish',release);res.once('close',release);res.once('error',release);
  try{res.writeHead(response.status||200,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...response.headers});res.end(response.body);}catch(error){release();throw error;}
 }
 else send(response.status||200,response.value);
 return;
}
if(path==='/api/auth/me'&&method==='GET'){send(200,{user});return;}
if(path==='/api/auth/logout'&&method==='POST'){const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('pk_session='))?.slice(11);if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));send(200,{ok:true},{'Set-Cookie':sessionCookie('',config.secure)});return;}
if(path==='/api/billing/rules'&&method==='GET'){send(200,billing.rules());return;}
if(path==='/api/billing/quote'&&method==='POST'){rate(req,60);send(200,billing.quote(user,await body(req)));return;}
if(path==='/api/account/export'&&method==='GET'){const t=Date.now();for(const [id,item] of archiveAttempts)if(item.until<=t)archiveAttempts.delete(id);const item=archiveAttempts.get(user.id)||{count:0,until:t+600000};if(item.count>=5)fail(429,'账户资料导出较频繁，请十分钟后再试');item.count++;archiveAttempts.set(user.id,item);}
if(path==='/api/questionnaires'||path.startsWith('/api/questionnaires/')){if(method==='POST')rate(req,300);const response=await questionnaires.handle({path,method,user,query:requestURL.searchParams,readBody:()=>body(req),clientKey:clientAddress(req,config)});if(response?.body!==undefined){res.writeHead(response.status||200,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...response.headers});res.end(response.body);return;}if(response){send(response.status,response.value);return;}fail(404,'问卷接口不存在');}
if(path==='/api/tool-runs'||path.startsWith('/api/tool-runs/')){if(method==='POST')rate(req,60);const response=await tools.handle({path,method,user,readBody:()=>body(req)});if(response){send(response.status,response.value);return;}fail(404,'科研工具接口不存在');}
if(path==='/api/writing'||path.startsWith('/api/writing/')){if(method==='POST')rate(req,60);const response=await writing.handle({path,method,user,readBody:()=>body(req)});if(response){send(response.status,response.value);return;}fail(404,'写作接口不存在');}
if(path==='/api/theses'||path.startsWith('/api/theses/')){if(method==='POST')rate(req,60);const response=await thesisMethods.handle({path,method,user,readBody:()=>body(req)})||await thesisOutlines.handle({path,method,user,readBody:()=>body(req)})||await theses.handle({path,method,user,readBody:()=>body(req)});if(response){send(response.status,response.value);return;}fail(404,'论文接口不存在');}
const workspaceResponse=await workspace({path,method,user,readBody:()=>body(req)});if(workspaceResponse){send(workspaceResponse.status,workspaceResponse.value);return;}
const fileResponse=await files({path,method,user,readBody:()=>body(req,path==='/api/files'?28*1024*1024:3*1024*1024)});
if(fileResponse){if(fileResponse.body){res.writeHead(fileResponse.status||200,{...fileResponse.headers,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(fileResponse.body);}else send(fileResponse.status||200,fileResponse.value);return;}
if(path==='/api/jobs'){
if(method==='GET'){send(200,{items:db.prepare('SELECT id,project_id,type,status,stage,error,result_id,attempt,created_at,updated_at,(SELECT thesis_id FROM thesis_runs WHERE thesis_runs.id=jobs.id AND thesis_runs.user_id=jobs.user_id) thesis_id,(SELECT kind FROM writing_runs WHERE writing_runs.id=jobs.id AND writing_runs.user_id=jobs.user_id) writing_kind,(SELECT operation FROM writing_runs WHERE writing_runs.id=jobs.id AND writing_runs.user_id=jobs.user_id) writing_operation,(SELECT kind FROM tool_runs WHERE tool_runs.id=jobs.id AND tool_runs.user_id=jobs.user_id) tool_kind,(SELECT operation FROM tool_runs WHERE tool_runs.id=jobs.id AND tool_runs.user_id=jobs.user_id) tool_operation FROM jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(user.id)});return;}
rate(req,60);const b=await body(req);const type=b.type;if(!['parse','polish','review','compare','agent'].includes(type))fail(400,'不支持的任务');if(['polish','review','agent'].includes(type)&&!aiReady(config.getAI()))fail(503,'AI 服务尚未配置');if(type==='agent'&&!config.agentEnabled)fail(503,'Codex 智能任务未启用');const projectId=project(b.projectId,user);let input;
if(type==='parse'){const file=own('files',b.fileId||'',user);if(projectId&&file.project_id&&projectId!==file.project_id)fail(400,'文件与任务所属项目不一致');input={fileId:file.id};}
else{input={text:(text(b.text,type==='compare'?8000:6000),b.text),requirements:text(b.requirements||'',2000,0)};if(type==='agent'){const ids=b.fileIds??[];if(!Array.isArray(ids)||ids.length>5||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)fail(400,'请最多选择 5 份不同材料');input.fileIds=ids.map(id=>{const file=own('files',id,user);if(projectId&&file.project_id&&file.project_id!==projectId)fail(400,'材料与任务所属项目不一致');return file.id;});}if(type==='compare'){if(!Array.isArray(b.sources)||!b.sources.length||b.sources.length>5)fail(400,'需要 1～5 份实际对照材料');input.title=text(b.title||'论文正文');input.sources=b.sources.map((s,i)=>({id:`source-${i+1}`,title:text(s.title),text:(text(s.text,8000),s.text),authors:Array.isArray(s.authors)?s.authors.slice(0,10).map(a=>text(a,100)):[],year:s.year?text(String(s.year),4):null,doi:text(s.doi||'',200,0),url:url(s.url),provider:'user_provided',sourceStatus:'unverified_user_material'}));}}
const key=text(b.idempotencyKey,100);const hash=digest(JSON.stringify({type,input,projectId}));const existing=db.prepare('SELECT id,input_hash FROM jobs WHERE user_id=? AND idempotency_key=?').get(user.id,key);if(existing){if(existing.input_hash!==hash)fail(409,'重复请求标识已用于其他内容');send(200,{id:existing.id});return;}if(db.prepare("SELECT count(*) n FROM jobs WHERE user_id=? AND status IN ('queued','running')").get(user.id).n>=3)fail(409,'最多同时提交 3 个待处理任务');const id=randomUUID(),t=now();transaction(()=>{if(['polish','review','agent'].includes(type))modelBudget.check(user.id);db.prepare('INSERT INTO jobs(id,user_id,project_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,user.id,projectId,type,'queued','queued',JSON.stringify(input),key,hash,t,t);if(['polish','review','agent'].includes(type))billing.reserve(user,id,1,type,b.billingQuote);});send(201,{id});return;}
const action=path.match(/^\/api\/jobs\/([^/]+)\/(cancel|retry)$/);if(action&&method==='POST'){
 if(action[2]==='retry')rate(req,60);const input=await body(req);const job=own('jobs',action[1],user);
 if(job.type==='document_translation'){if(action[2]==='retry')fail(409,'请返回文献翻译，核对原件与处理状态后重新确认提交；本站不会自动重复翻译。');const response=await documentTranslations.handle({path:'/api/document-translations/'+job.id+'/cancel',method:'POST',user,readBody:async()=>({})});send(response.status||200,response.value);return;}
 if(job.type==='document_parse'){if(action[2]==='retry')fail(409,'请从 PDF 原件重新确认云端解析，本站不会自动重复提交。');const response=await documentParses.handle({path:'/api/document-parses/'+job.id+'/cancel',method:'POST',user,readBody:async()=>({})});send(response.status||200,response.value);return;}
 if(job.type==='tool_run'){if(action[2]==='retry')fail(409,'请返回对应科研工具，保留已完成内容并重新确认费用后继续');const response=await tools.handle({path:'/api/tool-runs/jobs/'+job.id+'/cancel',method:'POST',user,readBody:async()=>({})});send(response.status,response.value);return;}
 if(job.type==='writing'){if(action[2]==='retry')fail(409,'请返回对应AI写作功能，核对已保存草稿并重新确认本次费用后继续');const response=await writing.handle({path:'/api/writing/jobs/'+job.id+'/cancel',method:'POST',user,readBody:async()=>({})});send(response.status,response.value);return;}
 if(job.type==='thesis_method'){if(action[2]==='retry')fail(409,'请返回研究方法建议页面，重新确认本次费用后生成');const response=await thesisMethods.handle({path:'/api/theses/methods/'+job.id+'/cancel',method:'POST',user,readBody:async()=>({})});send(response.status,response.value);return;}
 if(job.type==='thesis_outline'){if(action[2]==='retry')fail(409,'请返回论文提纲页面，重新确认本次费用后生成');const response=await thesisOutlines.handle({path:'/api/theses/outlines/'+job.id+'/cancel',method:'POST',user,readBody:async()=>({})});send(response.status,response.value);return;}
 if(job.type==='thesis'){if(action[2]==='retry')fail(409,'请进入账户论文，从已保存的章节继续生成并确认本次费用');const run=db.prepare('SELECT thesis_id FROM thesis_runs WHERE id=? AND user_id=?').get(job.id,user.id);if(!run)fail(409,'论文任务记录不可用，请联系支持');const response=await theses.handle({path:'/api/theses/'+run.thesis_id+'/cancel',method:'POST',user,readBody:async()=>({version:db.prepare('SELECT version FROM theses WHERE id=? AND user_id=?').get(run.thesis_id,user.id)?.version})});send(response.status,response.value);return;}
 if(action[2]==='retry'&&['parse','agent'].includes(job.type)){
  const original=JSON.parse(job.input),ids=job.type==='parse'?[original.fileId]:(original.fileIds||[]);
  try{for(const id of ids)own('files',id,user);}catch{fail(409,'任务引用的原件已移除或正在删除，请重新上传后新建任务');}
 }

 transaction(()=>{
  if(action[2]==='cancel'){
   if(!['queued','running'].includes(job.status))fail(409,'任务已结束');
   db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',updated_at=? WHERE id=?").run(now(),job.id);billing.release(job.id);
  }else{
   if(job.status!=='failed')fail(409,'仅失败任务可重试');
   if(db.prepare("SELECT count(*) n FROM jobs WHERE user_id=? AND status IN ('queued','running')").get(user.id).n>=3)fail(409,'等待任务已达到上限');
   if(['polish','review','agent'].includes(job.type)){modelBudget.check(user.id,{excludeJobId:job.id});billing.reserve(user,job.id,job.attempt+1,job.type,input.billingQuote);}
   db.prepare("UPDATE jobs SET status='queued',stage='queued',error=NULL,updated_at=? WHERE id=?").run(now(),job.id);
  }
 });if(action[2]==='cancel')worker.cancel(job.id);send(200,{ok:true});return;
}
if(path==='/api/results'&&method==='GET'){send(200,{items:db.prepare('SELECT id,project_id,job_id,type,title,created_at FROM results WHERE user_id=? ORDER BY created_at DESC LIMIT 500').all(user.id)});return;}
const revision=path.match(/^\/api\/results\/([^/]+)\/revisions$/);if(revision){const result=own('results',revision[1],user);if(method==='GET'){send(200,{items:db.prepare('SELECT id,body,created_at FROM result_revisions WHERE result_id=? AND user_id=? ORDER BY created_at DESC').all(result.id,user.id)});return;}const b=await body(req);const id=randomUUID();db.prepare('INSERT INTO result_revisions VALUES(?,?,?,?,?)').run(id,result.id,user.id,(text(b.text,100000),b.text),now());send(201,{id});return;}
const result=path.match(/^\/api\/results\/([^/]+)$/);if(result&&method==='GET'){const row=own('results',result[1],user);send(200,{item:{...row,body:JSON.parse(row.body)}});return;}
if(path==='/api/usage'&&method==='GET'){send(200,{items:db.prepare('SELECT * FROM usage WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(user.id),billingEnabled:billing.rules().services.some(item=>item.mode==='paid'&&item.available),modelBudget:modelBudget.summary(user.id),billing:{...billing.balance(user.id),...billing.entitlements(user.id)}});return;}
if(path==='/api/products'&&method==='GET'){send(200,{items:payments.options().products,paymentEnabled:payments.options().enabled});return;}
if(path==='/api/payments/entitlements'&&method==='GET'){send(200,payments.entitlements(user));return;}
if(path==='/api/orders'){if(method==='POST'){rate(req,60);send(201,await payments.create(user,await body(req)));}else send(200,payments.list(user));return;}
const paymentOrder=path.match(/^\/api\/orders\/([^/]+)(\/query)?$/);if(paymentOrder){if(paymentOrder[2]&&method==='POST')send(200,await payments.query(user,paymentOrder[1]));else if(!paymentOrder[2]&&method==='GET')send(200,payments.getOrder(user,paymentOrder[1]));else fail(405,'不支持的订单操作');return;}
fail(404,'接口不存在');
}catch(e){send(e.status||500,{error:e.status?e.message:'服务暂时无法完成请求'});}};
}
