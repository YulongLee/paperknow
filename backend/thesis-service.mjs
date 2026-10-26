import {completionAssessment,completionInput,thesisCompletionPlan,completionManuscriptHash,assertCompletionResumeUnchanged} from './thesis-completion.mjs';
import {randomUUID} from 'node:crypto';
import {thesisCoverFields} from '../dist/workspace/thesis-delivery.mjs';
import {buildThesisBibliography} from '../dist/workspace/thesis-document.mjs';
import {createBillingService} from './billing-service.mjs';
import {writingBillingKey} from '../dist/workspace/writing-billing-catalog.mjs';
import {createModelBudget} from './model-budget.mjs';
import {agentSettingsReady} from './agent-settings.mjs';
import {sectionWordsForRuntime} from './thesis-execution-policy.mjs';
import {createThesisContinuity} from './thesis-continuity.mjs';
import {createThesisExportTemplates} from './thesis-export-template.mjs';
import {initializeThesisSchema,normalizeThesisSnapshot,thesisPlan,thesisHash,thesisLimits,thesisFullText,thesisError,thesisTransaction,assertThesisAccountQuota,assertThesisChapterCapacity,isThesisReferenceChapter,thesisManualSourceIds} from './thesis-model.mjs';

const active=new Set(['queued','running']);
const fail=(status,message)=>{throw thesisError(status,message);};
const fields=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail(400,'提交包含不支持的字段');};
const clientKey=value=>{if(typeof value!=='string'||value.length<8||value.length>100||!value.trim())fail(400,'请提供 8～100 字符的唯一提交标识');return value;};
function retainedFigures(text,versions){
 const markers=[...text.matchAll(/\[figure:([^\]]+)\]/g)];
 if((text.match(/\[figure\b/gi)||[]).length!==markers.length||[...text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g,'').matchAll(/\[figure:([^\]]+)\]/g)].length!==markers.length)fail(400,'图片标记须为本章独立正文行，不可放在代码内或修改标记格式。');
 const available=new Map(versions.flatMap(row=>JSON.parse(row.figures||'[]')).map(row=>[row.id,row])),seen=new Set(),figures=[];
 for(const match of text.matchAll(/\[figure:([^\]]+)\]/g)){
  const id=match[1],start=match.index,end=start+match[0].length;
  if(!available.has(id)||seen.has(id)||text.slice(text.lastIndexOf('\n',start-1)+1,start).trim()||text.slice(end,text.indexOf('\n',end)<0?text.length:text.indexOf('\n',end)).trim())fail(400,'图片标记无效；请保留本章已有的独立图片标记，或删除整行以移除图片。');
  seen.add(id);figures.push(available.get(id));
 }
 return figures;
}
const expected=(input,row)=>{if(!Number.isSafeInteger(input.version)||input.version<1)fail(400,'请提供当前论文版本');if(input.version!==row.version)fail(409,'论文已更新，请刷新内容后重试');};
export function assertThesisSettings(settings){if(!agentSettingsReady(settings))fail(503,'毕业论文生成服务尚未启用，请先保存研究资料');if(typeof settings.version!=='string'||!settings.version)fail(503,'请先在后台保存并测试 Agent 配置，生成任务需要可恢复的配置版本');return settings;}

export function createThesisService(db,config={}){
 initializeThesisSchema(db);
 const continuity=createThesisContinuity(db,config);
 const exportTemplates=createThesisExportTemplates(db,config);
 function expectedTemplate(input,row){
  if(!Object.hasOwn(input,'expectedTemplateFileId'))return expected(input,row);
  if(!Number.isSafeInteger(input.version)||input.version<1)fail(400,'请提供当前论文版本');
  const selected=input.expectedTemplateFileId;
  if(selected!==null&&(typeof selected!=='string'||!/^[-A-Za-z0-9_]{1,120}$/.test(selected)))fail(400,'请提供当前格式模板的原件标识，或使用 null 表示通用模板');
  // Chapter checkpoints advance the thesis version while DOCX inspection is
  // awaiting private storage. Only a competing template selection conflicts
  // with this independent export setting; body and research updates survive.
  if((exportTemplates.stored(row)?.source?.fileId??null)!==selected)fail(409,'格式模板已在其他页面更新，请读取最新状态后再选择');
 }
 const billing=config.billing||createBillingService(db,config),modelBudget=config.modelBudget||createModelBudget(db,config);
 db.exec(`CREATE TABLE IF NOT EXISTS thesis_generation_quotes(token TEXT PRIMARY KEY REFERENCES billing_quotes(token) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),thesis_id TEXT NOT NULL REFERENCES theses(id),version INTEGER NOT NULL,snapshot_hash TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN ('generate','resume')),created_at TEXT NOT NULL);`);
 db.exec(`CREATE TABLE IF NOT EXISTS thesis_completion_quotes(token TEXT PRIMARY KEY REFERENCES thesis_generation_quotes(token) ON DELETE CASCADE,plan TEXT NOT NULL); CREATE TABLE IF NOT EXISTS thesis_completion_inputs(user_id TEXT NOT NULL REFERENCES users(id),client_key TEXT NOT NULL,thesis_id TEXT NOT NULL REFERENCES theses(id) ON DELETE CASCADE,input_hash TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,client_key));`);
 const clock=()=>new Date(config.thesisNow?.()??Date.now()).toISOString();
 const own=(id,user)=>{if(!user?.id)fail(401,'请先登录');const row=db.prepare('SELECT * FROM theses WHERE id=? AND user_id=?').get(id,user.id);if(!row)fail(404,'论文不存在');return row;};
 const project=(value,user)=>{if(value===undefined||value===null||value==='')return null;if(typeof value!=='string'||!db.prepare('SELECT id FROM projects WHERE id=? AND user_id=?').get(value,user.id))fail(404,'项目不存在');return value;};
 const settings=async version=>assertThesisSettings(await config.getAgentSettings?.(version));
 function chapterVersion(thesisId,chapterId){return db.prepare('SELECT * FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=? ORDER BY version DESC LIMIT 1').get(thesisId,chapterId);}
 function serialize(row,{summary=false}={}){
  const snapshot=JSON.parse(row.snapshot),run=row.current_run_id?db.prepare('SELECT * FROM thesis_runs WHERE id=? AND user_id=?').get(row.current_run_id,row.user_id):null;
  const plan=run?JSON.parse(run.plan):[],checkpoints=run?db.prepare('SELECT * FROM thesis_checkpoints WHERE run_id=? ORDER BY position').all(run.id):[];
  const chapters=snapshot.outline.map(chapter=>{const latest=chapterVersion(row.id,chapter.id),units=checkpoints.filter(unit=>unit.chapter_id===chapter.id),completed=units.filter(unit=>unit.status==='completed').length;return {id:chapter.id,title:chapter.title,kind:chapter.kind||'body',targetWords:chapter.targetWords,version:latest?.version||0,status:active.has(row.status)&&units.length?(completed===units.length?'completed':completed?'partial':'pending'):latest?'saved':units.some(unit=>unit.status==='failed')?'failed':'pending',text:summary?'':latest?.text||'',sourceIds:latest?JSON.parse(latest.source_ids):[],...(!summary?{figures:latest?JSON.parse(latest.figures||'[]'):[]}:{}),source:latest?.source==='generated'&&isThesisReferenceChapter(chapter)?'compiled_references':latest?.source||null,stale:Boolean(latest?.run_id&&db.prepare('SELECT snapshot_hash FROM thesis_runs WHERE id=?').get(latest.run_id)?.snapshot_hash!==row.snapshot_hash),completedSections:completed,totalSections:units.length,error:units.find(unit=>unit.error)?.error||null};});
  const item={id:row.id,version:row.version,title:row.title,projectId:row.project_id,status:row.status,profile:snapshot.profile,outline:snapshot.outline,chapters,exportTemplate:exportTemplates.stored(row),exportMetadata:JSON.parse(row.export_metadata||'{}'),createdAt:row.created_at,updatedAt:row.updated_at,billingService:'agent',requiresReview:true,job:run?{id:run.id,snapshotChanged:run.snapshot_hash!==row.snapshot_hash,status:run.status,stage:run.stage,error:run.error,attempt:run.attempt,resultId:run.result_id,completedSections:checkpoints.filter(unit=>unit.status==='completed').length,totalSections:plan.length,settingsVersion:run.settings_version,inputTokens:run.usage_known?run.input_tokens:null,outputTokens:run.usage_known?run.output_tokens:null,usageIncomplete:!run.usage_known,providerCalls:run.provider_calls,missingEvidence:checkpoints.flatMap(unit=>JSON.parse(unit.missing_evidence||'[]')),canResume:!active.has(run.status)&&run.status!=='completed'&&run.snapshot_hash===row.snapshot_hash}:null};
  if(!summary){item.snapshot=snapshot;item.bibliography=buildThesisBibliography(snapshot,chapters);item.fullText=thesisFullText(snapshot,chapters);item.sections=checkpoints.map(unit=>({id:unit.unit_id,chapterId:unit.chapter_id,status:unit.status,text:unit.text,sourceIds:JSON.parse(unit.source_ids),figures:JSON.parse(unit.figures||'[]'),missingEvidence:JSON.parse(unit.missing_evidence),error:unit.error}));}
  if(run){const meta=JSON.parse(run.settings_meta);item.job.continuous=meta.continuous===true;if(meta.completion)item.job.operation='completion';const recovery=continuity.summary(run);if(recovery)item.job.recovery={automaticRetries:recovery.automaticRetries,lastReason:recovery.lastReason};if(run.quality&&!summary)item.quality={...JSON.parse(run.quality),stale:run.snapshot_hash!==row.snapshot_hash||(meta.completion?JSON.parse(run.quality).manuscriptHash!==completionManuscriptHash(chapters):chapters.some(chapter=>chapter.source==='manual'||chapter.stale))};}
  return item;
 }
 function touch(id,status){db.prepare('UPDATE theses SET version=version+1,status=?,updated_at=? WHERE id=?').run(status,clock(),id);}
 function command(user,input,hash){const old=db.prepare('SELECT * FROM thesis_commands WHERE user_id=? AND client_key=?').get(user.id,clientKey(input.clientKey));if(old&&old.input_hash!==hash)fail(409,'此提交标识已用于其他论文操作');return old;}
 function saveCommand(user,input,hash,id,runId){db.prepare('INSERT INTO thesis_commands VALUES(?,?,?,?,?,?)').run(user.id,input.clientKey,id,runId,hash,clock());}
 function admission(user,charge={}){
  modelBudget.check(user.id,charge);
  if(db.prepare("SELECT count(*) n FROM thesis_runs WHERE user_id=? AND status IN ('queued','running')").get(user.id).n>=2)fail(429,'当前账户已有两篇论文正在排队或生成，请先等待完成');
  if(db.prepare("SELECT count(*) n FROM thesis_runs WHERE status IN ('queued','running')").get().n>=50)fail(429,'生成队列当前较忙，请稍后再试');
 }
 async function capabilities(){try{await settings();return {ready:true,reason:'',limits:thesisLimits(config),billingService:'agent',requiresEvidenceConfirmation:true,onlineReferenceVerification:false,evidenceMode:'reviewable_draft_with_optional_sources'};}catch(error){return {ready:false,reason:error.message,limits:thesisLimits(config),billingService:'agent',requiresEvidenceConfirmation:true,onlineReferenceVerification:false,evidenceMode:'reviewable_draft_with_optional_sources'};}}
 async function handle({path,method,user,readBody}){
  if(path!=='/api/theses'&&!/^\/api\/theses\//.test(path))return null;
  if(!user?.id)fail(401,'请先登录');
  const response=(value,status=200)=>({status,value});
  if(path==='/api/theses/capabilities'&&method==='GET')return response(await capabilities());
  if(path==='/api/theses'){
   if(method==='GET')return response({items:db.prepare('SELECT * FROM theses WHERE user_id=? ORDER BY updated_at DESC LIMIT 200').all(user.id).map(row=>serialize(row,{summary:true})),limit:200});
   if(method!=='POST')fail(405,'不支持的论文操作');
   const input=await readBody();fields(input,['snapshot','clientKey','projectId','exportTemplateFileId']);const snapshot=normalizeThesisSnapshot(input.snapshot,config),hash=thesisHash(snapshot),key=input.clientKey===undefined?null:clientKey(input.clientKey),pid=project(input.projectId,user),templateFileId=input.exportTemplateFileId===undefined?null:input.exportTemplateFileId;
   if(input.snapshot.bodySections!==undefined&&(!Array.isArray(input.snapshot.bodySections)||input.snapshot.bodySections.length>60))fail(400,'导入正文章节格式无效');
   const imported=[];for(const section of input.snapshot.bodySections||[]){if(!section||typeof section.text!=='string'||section.text.length>200000)fail(400,'导入章节正文最多 200,000 字符');if(!section.text.trim())continue;if(/\[figure\b/i.test(section.text))fail(400,'导入正文含有无法关联的图片标记，请从已保存的论文章节继续编辑。');const chapter=snapshot.outline.find(row=>row.id===section.id)||snapshot.outline.filter(row=>row.title===section.title).length===1&&snapshot.outline.find(row=>row.title===section.title);if(!chapter)fail(400,'有已填写的正文章节未匹配当前提纲，请补充对应章节后保存');if(imported.some(row=>row.chapterId===chapter.id))fail(400,'导入正文中有重复章节，请先核对');imported.push({chapterId:chapter.id,text:section.text});}
   const createHash=thesisHash({snapshot,projectId:pid,imported,...(templateFileId===null?{}:{exportTemplateFileId:templateFileId})});
   if(key){const old=db.prepare('SELECT * FROM theses WHERE user_id=? AND client_key=?').get(user.id,key);if(old){if(old.input_hash!==createHash)fail(409,'此保存标识已用于其他内容');return response({item:serialize(old)},201);}}
   const template=await exportTemplates.inspect(templateFileId,user.id),templateJson=template?JSON.stringify(template):null;
   return response(thesisTransaction(db,()=>{if(key){const old=db.prepare('SELECT * FROM theses WHERE user_id=? AND client_key=?').get(user.id,key);if(old){if(old.input_hash!==createHash)fail(409,'此保存标识已用于其他内容');return {item:serialize(old)};}}exportTemplates.assertReference(template,user.id);if(db.prepare('SELECT count(*) n FROM theses WHERE user_id=?').get(user.id).n>=1000)fail(409,'账户论文数量已达上限，请联系支持');assertThesisAccountQuota(db,user.id,Math.max(512,Buffer.byteLength(JSON.stringify(snapshot))+Buffer.byteLength(templateJson||''))+imported.reduce((n,row)=>n+Math.max(512,Buffer.byteLength(row.text)),0),config);const at=clock(),id=randomUUID();db.prepare('INSERT INTO theses(id,user_id,project_id,title,snapshot,snapshot_hash,client_key,input_hash,export_template,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,user.id,pid,snapshot.title,JSON.stringify(snapshot),hash,key,createHash,templateJson,at,at);for(const chapter of imported)db.prepare('INSERT INTO thesis_chapter_versions(id,thesis_id,chapter_id,version,run_id,source,text,source_ids,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,chapter.chapterId,1,null,'imported',chapter.text,JSON.stringify(thesisManualSourceIds(chapter.text,snapshot)),at);return {item:serialize(own(id,user))};}),201);
  }
  const savedCommandRoute=path.match(/^\/api\/theses\/by-key\/([^/]+)$/);
  if(savedCommandRoute){if(method!=='GET')fail(405,'仅支持读取已保存论文');let key;try{key=decodeURIComponent(savedCommandRoute[1]);}catch{fail(400,'保存标识格式无效');}clientKey(key);const row=db.prepare('SELECT * FROM theses WHERE user_id=? AND client_key=?').get(user.id,key);if(!row)fail(404,'尚未找到本次保存的论文');return response({item:serialize(row)});}
  const metadataRoute=path.match(/^\/api\/theses\/([^/]+)\/export-metadata$/);
  if(metadataRoute){
   const id=metadataRoute[1],row=own(id,user);if(method!=='POST')fail(405,'封面信息仅支持保存');
   const input=await readBody();fields(input,['version','metadata']);expected(input,row);
   if(!input.metadata||typeof input.metadata!=='object'||Array.isArray(input.metadata)||Object.keys(input.metadata).some(key=>!Object.hasOwn(thesisCoverFields,key)))fail(400,'封面信息格式无效');
   const metadata={};for(const key of Object.keys(thesisCoverFields)){const value=input.metadata[key]??'';if(typeof value!=='string'||value.length>200||/[\x00-\x1f]/.test(value))fail(400,'封面信息长度或格式无效');metadata[key]=value.trim();}
   return response(thesisTransaction(db,()=>{const current=own(id,user);expected(input,current);if(active.has(current.status))fail(409,'请在生成完成后保存封面信息');const encoded=JSON.stringify(metadata);assertThesisAccountQuota(db,user.id,Math.max(0,Buffer.byteLength(encoded)-Buffer.byteLength(current.export_metadata||'')),config);db.prepare('UPDATE theses SET export_metadata=?,version=version+1,updated_at=? WHERE id=? AND user_id=?').run(encoded,clock(),id,user.id);return {item:serialize(own(id,user))};}));
  }
  const templateRoute=path.match(/^\/api\/theses\/([^/]+)\/export-template$/);
  if(templateRoute){
   const id=templateRoute[1],row=own(id,user);
   if(method==='GET'){const exportTemplate=await exportTemplates.verified(row),current=own(id,user);if(current.version!==row.version||current.export_template!==row.export_template)fail(409,'论文已更新，请读取最新状态后再导出');return response({exportTemplate,version:current.version});}
   if(method!=='POST')fail(405,'不支持的论文模板操作');
   const input=await readBody();fields(input,['version','templateFileId','expectedTemplateFileId']);expectedTemplate(input,row);
   if(!Object.hasOwn(input,'templateFileId'))fail(400,'请选择模板原件，或明确切换为通用模板');
   const selected=await exportTemplates.inspect(input.templateFileId,user.id),encoded=selected?JSON.stringify(selected):null;
   return response(thesisTransaction(db,()=>{const current=own(id,user);expectedTemplate(input,current);exportTemplates.assertReference(selected,user.id);if(encoded===current.export_template)return {item:serialize(current)};assertThesisAccountQuota(db,user.id,Math.max(512,Buffer.byteLength(current.snapshot)+Buffer.byteLength(encoded||''))-Math.max(512,Buffer.byteLength(current.snapshot)+Buffer.byteLength(current.export_template||'')),config);db.prepare('UPDATE theses SET export_template=?,version=version+1,updated_at=? WHERE id=? AND user_id=?').run(encoded,clock(),id,user.id);return {item:serialize(own(id,user))};}));
  }
  const completionPath=path.match(/^\/api\/theses\/([^/]+)\/completion$/);
  if(completionPath){const id=completionPath[1],row=own(id,user);if(method==='GET')return response({version:row.version,...completionAssessment(db,row)});if(method!=='POST')fail(405,'不支持的补充操作');const input=await readBody();clientKey(input.clientKey);const {version:inputVersion,...completionContent}=input;const inputHash=thesisHash(completionContent),prior=db.prepare('SELECT * FROM thesis_completion_inputs WHERE user_id=? AND client_key=?').get(user.id,input.clientKey);if(prior){if(prior.thesis_id!==id||prior.input_hash!==inputHash)fail(409,'此提交标识已用于其他补充内容');return response({item:serialize(row)});}expected(input,row);if(active.has(row.status))fail(409,'请等待当前任务结束后补充资料');const prepared=completionInput(row,input,config);return response(thesisTransaction(db,()=>{const current=own(id,user);expected(input,current);if(active.has(current.status))fail(409,'当前论文正在处理');const additional=Buffer.byteLength(JSON.stringify(prepared.snapshot))+Buffer.byteLength(JSON.stringify(prepared.metadata))-Buffer.byteLength(current.snapshot)-Buffer.byteLength(current.export_metadata||'{}');assertThesisAccountQuota(db,user.id,additional+512,config);db.prepare("UPDATE theses SET snapshot=?,snapshot_hash=?,export_metadata=?,version=version+1,status='draft',updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(prepared.snapshot),thesisHash(prepared.snapshot),JSON.stringify(prepared.metadata),clock(),id,user.id);db.prepare('INSERT INTO thesis_completion_inputs VALUES(?,?,?,?,?)').run(user.id,input.clientKey,id,inputHash,clock());return {item:serialize(own(id,user))};}));}
  const history=path.match(/^\/api\/theses\/([^/]+)\/chapters\/([^/]+)\/versions(?:\/(\d+))?$/);
  if(history){const [,id,chapterId,version]=history,current=own(id,user),isReferences=JSON.parse(current.snapshot).outline.some(row=>row.id===chapterId&&isThesisReferenceChapter(row)),source=value=>isReferences&&value==='generated'?'compiled_references':value;if(method!=='GET')fail(405,'章节历史仅支持读取');if(version){const row=db.prepare('SELECT * FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=? AND version=?').get(id,chapterId,Number(version));if(!row)fail(404,'章节历史版本不存在');return response({item:{id:row.id,chapterId:row.chapter_id,version:row.version,source:source(row.source),text:row.text,sourceIds:JSON.parse(row.source_ids),figures:JSON.parse(row.figures||'[]'),createdAt:row.created_at}});}return response({items:db.prepare('SELECT id,version,source,created_at AS createdAt FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=? ORDER BY version DESC LIMIT 50').all(id,chapterId).map(row=>({...row,source:source(row.source)})),limit:50});}
  const match=path.match(/^\/api\/theses\/([^/]+)(?:\/(generate|cancel|resume|quote)|\/chapters\/([^/]+))?$/);
  if(!match)return null;
  const [,id,action,chapterId]=match,row=own(id,user);
  if(method==='GET'&&!action&&!chapterId){const item=serialize(row);item.exportTemplate=await exportTemplates.verified(row);return response({item});}
  if(method!=='POST')fail(405,'不支持的论文操作');
  const input=await readBody();
  if(action==='quote'){
   fields(input,['version','action','completion','issueCodes']);if(input.completion!==undefined&&typeof input.completion!=='boolean')fail(400,'完善操作无效');if(input.completion&&input.action==='resume')fail(400,'恢复操作不重新规划完善章节');const quotedAction=input.action??'generate';if(!['generate','resume'].includes(quotedAction))fail(400,'请选择生成或恢复操作');
   expected(input,row);if(active.has(row.status))fail(409,'论文已经在生成中');const snapshot=JSON.parse(row.snapshot),runtime=await settings();const basePlan=thesisPlan(snapshot,config.thesisContinuousEnabled===true?{...config,thesisSectionWords:sectionWordsForRuntime(runtime,snapshot.profile.language,thesisLimits(config).sectionWords)}:config);
   if(quotedAction==='resume'){const run=row.current_run_id?db.prepare('SELECT * FROM thesis_runs WHERE id=? AND user_id=?').get(row.current_run_id,user.id):null;if(!run||!['failed','interrupted','cancelled','needs_materials'].includes(run.status))fail(409,'当前没有可续跑的中断任务');if(run.snapshot_hash!==row.snapshot_hash)fail(409,'研究资料或提纲已变化，请确认后重新生成；旧章节仍然保留');assertCompletionResumeUnchanged(db,row,run);}
   return response(thesisTransaction(db,()=>{const current=own(id,user);expected(input,current);if(active.has(current.status))fail(409,'论文已经在生成中');const serviceKey=writingBillingKey('thesis','draft',snapshot),quote=billing.quote(user,{type:'agent',serviceKey});admission(user,{billingToken:quote.token,billingType:'agent',serviceKey});db.prepare('INSERT INTO thesis_generation_quotes VALUES(?,?,?,?,?,?,?)').run(quote.token,user.id,id,current.version,current.snapshot_hash,quotedAction,clock());const completion=input.completion?thesisCompletionPlan(db,current,basePlan,[...(input.issueCodes||[]),...(config.supplementCheckEnabled===true?['supplement_check']:[])]):null;if(completion){assertThesisAccountQuota(db,user.id,Buffer.byteLength(JSON.stringify(completion)),config);db.prepare('INSERT INTO thesis_completion_quotes VALUES(?,?)').run(quote.token,JSON.stringify({baseline:completion.baseline,issueCodes:completion.issueCodes,fingerprint:completion.fingerprint,chapterTitles:completion.chapterTitles}));}return{...quote,...(completion?{completion:{chapterTitles:completion.chapterTitles}}:{}),thesisId:id,thesisVersion:current.version,snapshotHash:current.snapshot_hash,action:quotedAction};}));
  }
  if(!action&&!chapterId){
   fields(input,['version','snapshot','projectId']);const snapshot=normalizeThesisSnapshot(input.snapshot,config),pid=input.projectId===undefined?row.project_id:project(input.projectId,user);
   return response(thesisTransaction(db,()=>{const current=own(id,user);expected(input,current);if(active.has(current.status))fail(409,'生成过程中不能修改研究资料或提纲，请先取消任务');assertThesisAccountQuota(db,user.id,Buffer.byteLength(JSON.stringify(snapshot))-Buffer.byteLength(current.snapshot),config);const changed=thesisHash(snapshot)!==current.snapshot_hash;db.prepare('UPDATE theses SET title=?,project_id=?,snapshot=?,snapshot_hash=?,version=version+1,status=?,updated_at=? WHERE id=? AND user_id=?').run(snapshot.title,pid,JSON.stringify(snapshot),thesisHash(snapshot),changed?'draft':current.status,clock(),id,user.id);return {item:serialize(own(id,user))};}));
  }
  if(chapterId){
   fields(input,['version','text']);if(typeof input.text!=='string'||input.text.length>200000)fail(400,'章节正文最多 200,000 字符');
   return response(thesisTransaction(db,()=>{const current=own(id,user),snapshot=JSON.parse(current.snapshot);expected(input,current);if(active.has(current.status))fail(409,'生成过程中不能编辑章节，请先取消任务');if(!snapshot.outline.some(chapter=>chapter.id===chapterId))fail(404,'章节不存在');const previous=chapterVersion(id,chapterId);if((previous?.text||'')===input.text)return {item:serialize(current)};const figures=retainedFigures(input.text,db.prepare('SELECT figures FROM thesis_chapter_versions WHERE thesis_id=? AND chapter_id=? ORDER BY version').all(id,chapterId));if(figures.length+snapshot.outline.filter(chapter=>chapter.id!==chapterId).reduce((sum,chapter)=>sum+JSON.parse(chapterVersion(id,chapter.id)?.figures||'[]').length,0)>128)fail(400,'当前论文插图超过 128 张，请移除不需要的插图后再保存。');assertThesisChapterCapacity(db,id,chapterId);assertThesisAccountQuota(db,user.id,Math.max(512,Buffer.byteLength(input.text)+Buffer.byteLength(JSON.stringify(figures))),config);db.prepare('INSERT INTO thesis_chapter_versions(id,thesis_id,chapter_id,version,run_id,source,text,source_ids,created_at,figures) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,chapterId,(previous?.version||0)+1,null,'manual',input.text,JSON.stringify(thesisManualSourceIds(input.text,snapshot)),clock(),JSON.stringify(figures));touch(id,'draft');return {item:serialize(own(id,user))};}));
  }
  if(action==='cancel'){
   fields(input,['version']);let cancelled;const result=thesisTransaction(db,()=>{const current=own(id,user);if(!active.has(current.status))return {item:serialize(current)};expected(input,current);const run=current.current_run_id,at=clock();db.prepare("UPDATE thesis_runs SET status='cancelled',stage='cancelled',error='用户取消了任务，已保留完成章节',updated_at=? WHERE id=? AND status IN ('queued','running')").run(at,run);db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',error='用户取消了任务，已保留完成章节',updated_at=? WHERE id=?").run(at,run);billing.release(run);touch(id,'cancelled');cancelled=run;return {item:serialize(own(id,user))};});if(cancelled)config.cancelThesisRun?.(cancelled);return response(result);
  }
  fields(input,['version','clientKey','billingToken','consent','completion']);if(input.completion!==undefined&&typeof input.completion!=='boolean')fail(400,'完善操作无效');
  if(input.consent!==true)fail(400,'请先确认本次生成范围与权益或积分费用');
  clientKey(input.clientKey);
  const currentRun=action==='resume'&&row.current_run_id?db.prepare('SELECT * FROM thesis_runs WHERE id=? AND user_id=?').get(row.current_run_id,user.id):null;
  const hash=thesisHash({action,id,snapshotHash:row.snapshot_hash,...(input.completion?{completion:true}:{}),...(action==='resume'?{runId:currentRun?.id}: {})});
  const old=command(user,input,hash);if(old)return response({item:serialize(own(id,user))});
  expected(input,row);if(active.has(row.status))fail(409,'当前论文正在生成，请先等待或取消');
  const snapshot=JSON.parse(row.snapshot),enabled=await settings(),runtime=action==='resume'?await settings(currentRun?.settings_version):enabled;
  const validatedPlan=thesisPlan(snapshot,config.thesisContinuousEnabled===true?{...config,thesisSectionWords:sectionWordsForRuntime(runtime,snapshot.profile.language,thesisLimits(config).sectionWords)}:config);let plan=action==='generate'?validatedPlan:null;const completionQuote=input.billingToken?db.prepare('SELECT plan FROM thesis_completion_quotes WHERE token=?').get(input.billingToken):null,completion=completionQuote?JSON.parse(completionQuote.plan):null;if(Boolean(completion)!==Boolean(input.completion)||completion&&action!=='generate')fail(409,'本次操作与完善费用确认不一致，请重新获取费用');if(completion){const planned=thesisCompletionPlan(db,row,validatedPlan,completion.issueCodes);if(planned.fingerprint!==completion.fingerprint)fail(409,'原论文或处理配置已变化，请重新确认完善费用');plan=planned.plan;}
  return response(thesisTransaction(db,()=>{const current=own(id,user),existing=command(user,input,hash);if(existing)return {item:serialize(current)};expected(input,current);if(active.has(current.status))fail(409,'论文已经在生成中');admission(user,{billingToken:input.billingToken,billingType:'agent',serviceKey:writingBillingKey('thesis','draft',snapshot)});
   const confirmed=db.prepare('SELECT * FROM thesis_generation_quotes WHERE token=? AND user_id=?').get(typeof input.billingToken==='string'?input.billingToken:'',user.id);
   if(!confirmed||confirmed.thesis_id!==id||confirmed.version!==current.version||confirmed.snapshot_hash!==current.snapshot_hash||confirmed.action!==action)fail(409,'论文信息或生成操作与费用确认不一致，请重新确认');
   const at=clock();let runId;
   for(const chapter of snapshot.outline)assertThesisChapterCapacity(db,id,chapter.id);
   if(action==='resume'){
    const run=current.current_run_id?db.prepare('SELECT * FROM thesis_runs WHERE id=? AND user_id=?').get(current.current_run_id,user.id):null;
    if(!run||!['failed','interrupted','cancelled','needs_materials'].includes(run.status))fail(409,'当前没有可续跑的中断任务');
    if(run.snapshot_hash!==current.snapshot_hash)fail(409,'研究资料或提纲已变化，请确认后重新生成；旧章节仍然保留');assertCompletionResumeUnchanged(db,current,run);
    if(String(runtime.version)!==run.settings_version)fail(503,'原生成配置版本不可用，请联系管理员');
    runId=run.id;const nextAttempt=run.attempt+1;
    assertThesisAccountQuota(db,user.id,512,config);
    db.prepare("UPDATE thesis_runs SET status='queued',stage='queued',error=NULL,attempt=?,updated_at=? WHERE id=?").run(nextAttempt,at,runId);
    db.prepare("UPDATE thesis_checkpoints SET status='pending',error=NULL,missing_evidence='[]',updated_at=? WHERE run_id=? AND status!='completed'").run(at,runId);
    db.prepare("UPDATE jobs SET status='queued',stage='queued',error=NULL,updated_at=? WHERE id=?").run(at,runId);
    billing.reserve(user,runId,nextAttempt,'agent',input.billingToken,writingBillingKey('thesis','draft',snapshot));
   }else{
    assertThesisAccountQuota(db,user.id,Math.max(512,Buffer.byteLength(current.snapshot)+Buffer.byteLength(JSON.stringify(plan)))+plan.length*512+512,config);
    runId=randomUUID();
    const safeMeta={version:runtime.version,engine:String(runtime.engine||'claude-agent-sdk'),model:String(runtime.model),maxTurns:runtime.maxTurns??null,maxOutputTokens:runtime.maxOutputTokens??null,continuous:config.thesisContinuousEnabled===true,qualityReview:config.writingQualityEnabled===true,supplementCheck:config.supplementCheckEnabled===true,skillCompositionVersion:1,...(completion?{completion:{baseline:completion.baseline,chapterTitles:completion.chapterTitles}}:{})};
    db.prepare('INSERT INTO jobs(id,user_id,project_id,type,status,stage,input,idempotency_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(runId,user.id,current.project_id,'thesis','queued','queued',JSON.stringify({thesisId:id,settingsVersion:runtime.version}),`thesis:${input.clientKey}`,hash,at,at);
    db.prepare('INSERT INTO thesis_runs(id,thesis_id,user_id,snapshot,snapshot_hash,plan,settings_version,settings_meta,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(runId,id,user.id,current.snapshot,current.snapshot_hash,JSON.stringify(plan),runtime.version,JSON.stringify(safeMeta),'queued','queued',at,at);
    for(const unit of plan)db.prepare('INSERT INTO thesis_checkpoints(run_id,unit_id,chapter_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(runId,unit.id,unit.chapterId,unit.position,at,at);
    billing.reserve(user,runId,1,'agent',input.billingToken,writingBillingKey('thesis','draft',snapshot));
   }
   saveCommand(user,input,hash,id,runId);db.prepare("UPDATE theses SET current_run_id=?,status='queued',version=version+1,updated_at=? WHERE id=?").run(runId,at,id);return {item:serialize(own(id,user))};}),202);
 }
 return {handle,capabilities,get(id,user){return serialize(own(id,user));}};
}
