import {assertThesisAccountQuota} from './thesis-model.mjs';
import {randomUUID} from 'node:crypto';
import {safeUser,digest} from './auth.mjs';
import {now} from './database.mjs';
import {artifactVisibilityConditions,serializeArtifact} from './artifact-service.mjs';
import {createThesisExportTemplates} from './thesis-export-template.mjs';

const maxDraftBytes=750*1024,maxAccountBytes=50*1024*1024;
const tools=new Set(['writing','taskbook','article','practice','idea','questionnaire','analysis','quick','topic','proposal','summary','course','review','rewrite','reduce','aigc','reading','search','translation','ppt','format','research','posting','resume']);
const error=(status,message)=>{throw Object.assign(new Error(message),{status});};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max,min=0)=>{if(typeof value!=='string'||value.trim().length<min||value.length>max)error(400,`请输入 ${min}～${max} 字符的有效内容`);return value.trim();};
function fields(input,allowed){if(!object(input)||Object.keys(input).some(key=>!allowed.includes(key)))error(400,'包含不支持的字段');}
function expectedVersion(input,current){if(!Number.isSafeInteger(input.version)||input.version<0)error(400,'请提供当前记录版本');if(input.version!==current)error(409,'内容已在其他页面更新，请重新读取后再保存');}
// Account snapshots are user content, never identity, permission or paid-access evidence.
const authority=/^(?:__proto__|prototype|constructor|exportUnlocked|unlocked|isPaid|paid|payment|payments|paymentStatus|paymentOrder|purchase|purchased|entitlement|entitlements|membership|auth|session|token|password|password_hash|role|userId|user_id|accountId|account_id|cloudAccount|cloudDraft|cloudVersion)$/i;
function cleanTree(value,depth=0,key=''){
 if(depth>32)error(400,'草稿结构过深');
 if(Array.isArray(value)){if(value.length>20000)error(400,'草稿列表过长');return value.map(item=>cleanTree(item,depth+1));}
 if(object(value)){const clean={};for(const [name,item]of Object.entries(value)){if(authority.test(name))continue;clean[name]=cleanTree(item,depth+1,name);}return clean;}
 if(typeof value==='number'&&!Number.isFinite(value))error(400,'草稿包含无效数值');
 if(typeof value==='string'&&/html$/i.test(key))return value.replace(/<[^>]*>/g,tag=>/^<\/?(?:p|h[1-6]|strong|em|b|i|ul|ol|li|br)\s*\/?\s*>$/i.test(tag)?tag:'');
 return value;
}
function payloadJSON(value){if(!object(value))error(400,'请提供草稿内容');const clean=cleanTree(value);for(const key of ['id','projectId','project_id','clientKey'])delete clean[key];const json=JSON.stringify(clean);if(Buffer.byteLength(json)>maxDraftBytes)error(413,'单份账户草稿最多 750KB，请导出本地备份或分章节保存');return json;}

export function createWorkspaceService(db,{billing}={}){
 const thesisExportTemplates=createThesisExportTemplates(db);
 const own=(table,id,user)=>{const row=db.prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=?`).get(id,user.id);if(!row)error(404,'记录不存在');return row;};
 const projectId=(id,user)=>{if(id===undefined||id===null||id==='')return null;if(typeof id!=='string')error(400,'项目编号无效');own('projects',id,user);return id;};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(cause){db.exec('ROLLBACK');throw cause;}};
 const projectSelect=`SELECT p.*,coalesce(d.status,'active') status,coalesce(d.stage,'准备中') stage,coalesce(d.description,'') description,coalesce(d.version,0) version FROM projects p LEFT JOIN workspace_project_details d ON d.project_id=p.id`;
 const projectRow=(id,user)=>{const row=db.prepare(projectSelect+' WHERE p.id=? AND p.user_id=?').get(id,user.id);if(!row)error(404,'记录不存在');return row;};
 const emptyProjectCounts=()=>({files:0,jobs:0,results:0,drafts:0,theses:0,artifacts:0});
 const publishedArtifactsWhere=()=>["user_id=?","status='ready'",...artifactVisibilityConditions(db)].join(' AND ');
 const projectCounts=(id,user)=>({...Object.fromEntries(['files','jobs','results','workspace_drafts','theses'].map(table=>[table==='workspace_drafts'?'drafts':table,db.prepare(`SELECT count(*) n FROM ${table} WHERE user_id=? AND project_id=?`).get(user.id,id).n])),artifacts:tableExists('artifacts')?db.prepare(`SELECT count(*) n FROM artifacts WHERE ${publishedArtifactsWhere()} AND project_id=?`).get(user.id,id).n:0});
 const projectItems=user=>{
  const counts=new Map(),add=(project,key,n)=>{if(!counts.has(project))counts.set(project,emptyProjectCounts());counts.get(project)[key]=n;};
  for(const table of ['files','jobs','results','workspace_drafts','theses'])for(const row of db.prepare(`SELECT project_id,count(*) n FROM ${table} WHERE user_id=? AND project_id IS NOT NULL GROUP BY project_id`).all(user.id))add(row.project_id,table==='workspace_drafts'?'drafts':table,row.n);
  if(tableExists('artifacts'))for(const row of db.prepare(`SELECT project_id,count(*) n FROM artifacts WHERE ${publishedArtifactsWhere()} AND project_id IS NOT NULL GROUP BY project_id`).all(user.id))add(row.project_id,'artifacts',row.n);
  return db.prepare(projectSelect+' WHERE p.user_id=? ORDER BY p.updated_at DESC,p.id DESC').all(user.id).map(row=>({...row,counts:counts.get(row.id)||emptyProjectCounts()}));
 };
 const draftColumns='id,user_id,project_id,title,tool,version,bytes,created_at,updated_at';
 const draftRow=(id,user,full=true)=>{const row=db.prepare(`SELECT ${draftColumns}${full?',payload':''} FROM workspace_drafts WHERE id=? AND user_id=?`).get(id,user.id);if(!row)error(404,'记录不存在');if(full)row.payload=JSON.parse(row.payload);return row;};
 const draftQuota=(user,bytes,replacing=0)=>{try{assertThesisAccountQuota(db,user.id,bytes-replacing);}catch(cause){if(cause.code==='storage_limit')error(409,'账户草稿、论文资料与章节历史合计最多 50MB，请先下载备份并整理内容');throw cause;}};
 // New feature tables are initialized by their services. Standalone workspace instances
 // and older databases must remain exportable before those services are installed.
 const tableExists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
 const projectArtifacts=(id,user)=>{
  if(!tableExists('artifacts'))return [];
  const version=db.prepare('PRAGMA table_info(artifacts)').all().some(column=>column.name==='version')?'version':'1 AS version';
  return db.prepare(`SELECT id,project_id,name,kind,bytes,sha256,source_type,source_id,status,created_at,updated_at,${version} FROM artifacts WHERE ${publishedArtifactsWhere()} AND project_id=? ORDER BY created_at DESC,id DESC LIMIT 500`).all(user.id,id).map(serializeArtifact);
 };
 const optionalRows=(table,sql,userId)=>tableExists(table)?db.prepare(sql).all(userId):[];
 const optionalBytes=(table,sql,userId)=>tableExists(table)?db.prepare(sql).get(userId).n:0;
 const hasThesisExportTemplate=()=>db.prepare('PRAGMA table_info(theses)').all().some(row=>row.name==='export_template');
 const newExportBytes=userId=>
  (hasThesisExportTemplate()?db.prepare("SELECT coalesce(sum(length(CAST(coalesce(export_template,'') AS BLOB))),0) n FROM theses WHERE user_id=?").get(userId).n:0)+
  optionalBytes('tool_runs',"SELECT coalesce(sum(length(CAST(snapshot AS BLOB))+length(CAST(plan AS BLOB))+length(CAST(coalesce(output,'') AS BLOB))),0) n FROM tool_runs WHERE user_id=?",userId)+
  (tableExists('tool_runs')?optionalBytes('tool_checkpoints','SELECT coalesce(sum(length(CAST(c.output AS BLOB))),0) n FROM tool_checkpoints c JOIN tool_runs r ON r.id=c.run_id WHERE r.user_id=?',userId):0)+
  optionalBytes('writing_runs',"SELECT coalesce(sum(length(CAST(snapshot AS BLOB))+length(CAST(plan AS BLOB))+length(CAST(coalesce(output,'') AS BLOB))),0) n FROM writing_runs WHERE user_id=?",userId)+
  (tableExists('writing_runs')?optionalBytes('writing_checkpoints','SELECT coalesce(sum(length(CAST(c.output AS BLOB))),0) n FROM writing_checkpoints c JOIN writing_runs r ON r.id=c.run_id WHERE r.user_id=?',userId):0)+
  optionalBytes('questionnaires','SELECT coalesce(sum(length(CAST(content AS BLOB))),0) n FROM questionnaires WHERE user_id=?',userId)+
  (tableExists('questionnaires')?optionalBytes('questionnaire_publications','SELECT coalesce(sum(length(CAST(p.content AS BLOB))),0) n FROM questionnaire_publications p JOIN questionnaires q ON q.id=p.questionnaire_id WHERE q.user_id=?',userId):0)+
  (tableExists('questionnaires')&&tableExists('questionnaire_publications')?optionalBytes('questionnaire_responses','SELECT coalesce(sum(length(CAST(r.answers AS BLOB))),0) n FROM questionnaire_responses r JOIN questionnaire_publications p ON p.id=r.publication_id JOIN questionnaires q ON q.id=p.questionnaire_id WHERE q.user_id=?',userId):0);
 const feedbackItem=(id,user)=>db.prepare(`SELECT f.id,f.category,f.body,f.created_at,coalesce(m.status,'open') status,coalesce(m.updated_at,f.created_at) updated_at FROM feedback f LEFT JOIN feedback_management m ON m.feedback_id=f.id WHERE f.id=? AND f.user_id=?`).get(id,user.id);
 return async({path,method,user,readBody})=>{
  const result=(value,status=200)=>({value,status});
  if(path==='/api/account/export'){
   if(method!=='GET')error(405,'账户资料归档仅支持下载');
   const contentBytes=db.prepare('SELECT coalesce(sum(bytes),0) n FROM workspace_drafts WHERE user_id=?').get(user.id).n+
    db.prepare('SELECT coalesce(sum(length(CAST(body AS BLOB))),0) n FROM results WHERE user_id=?').get(user.id).n+
    db.prepare('SELECT coalesce(sum(length(CAST(body AS BLOB))),0) n FROM result_revisions WHERE user_id=?').get(user.id).n+
    db.prepare('SELECT coalesce(sum(length(CAST(snapshot AS BLOB))),0) n FROM theses WHERE user_id=?').get(user.id).n+
    db.prepare('SELECT coalesce(sum(length(CAST(snapshot AS BLOB))+length(CAST(plan AS BLOB))),0) n FROM thesis_runs WHERE user_id=?').get(user.id).n+
    db.prepare('SELECT coalesce(sum(length(CAST(v.text AS BLOB))),0) n FROM thesis_chapter_versions v JOIN theses t ON t.id=v.thesis_id WHERE t.user_id=?').get(user.id).n+
    db.prepare('SELECT coalesce(sum(length(CAST(c.text AS BLOB))+length(CAST(c.trace AS BLOB))),0) n FROM thesis_checkpoints c JOIN thesis_runs r ON r.id=c.run_id WHERE r.user_id=?').get(user.id).n+
    db.prepare("SELECT coalesce(sum(length(CAST(snapshot AS BLOB))+length(CAST(coalesce(output,'') AS BLOB))),0) n FROM thesis_outline_runs WHERE user_id=?").get(user.id).n+
    db.prepare("SELECT coalesce(sum(length(CAST(snapshot AS BLOB))+length(CAST(coalesce(output,'') AS BLOB))),0) n FROM thesis_method_runs WHERE user_id=?").get(user.id).n+newExportBytes(user.id);
   if(contentBytes>100*1024*1024)error(413,'账户资料超过单次归档大小，请按项目下载原件与成果');
   const profile=safeUser(db,user.id);
   const projects=db.prepare(projectSelect+' WHERE p.user_id=? ORDER BY p.created_at,p.id').all(user.id);
   const drafts=db.prepare('SELECT '+draftColumns+',payload FROM workspace_drafts WHERE user_id=? ORDER BY created_at,id').all(user.id).map(row=>({...row,payload:JSON.parse(row.payload)}));
   const files=db.prepare("SELECT f.id,f.project_id,f.name,f.kind,f.bytes,f.sha256,f.created_at,CASE WHEN d.status='pending' THEN 'pending' ELSE NULL END AS deletionStatus FROM files f LEFT JOIN workspace_file_deletions d ON d.file_id=f.id WHERE f.user_id=? ORDER BY f.created_at,f.id").all(user.id).map(row=>({...row,downloadPath:row.deletionStatus?null:'/api/files/'+encodeURIComponent(row.id)+'/download'}));
   const revisions=db.prepare('SELECT r.id,r.result_id,r.body,r.created_at FROM result_revisions r JOIN results s ON s.id=r.result_id WHERE r.user_id=? AND s.user_id=? ORDER BY r.created_at,r.id').all(user.id,user.id);
   const revisionsByResult=new Map();for(const revision of revisions){if(!revisionsByResult.has(revision.result_id))revisionsByResult.set(revision.result_id,[]);revisionsByResult.get(revision.result_id).push(revision);}
   const results=db.prepare('SELECT id,project_id,job_id,type,title,body,created_at FROM results WHERE user_id=? ORDER BY created_at,id').all(user.id).map(row=>({...row,body:JSON.parse(row.body),revisions:revisionsByResult.get(row.id)||[]}));
   const jobs=db.prepare('SELECT id,project_id,type,status,stage,error,result_id,attempt,created_at,updated_at FROM jobs WHERE user_id=? ORDER BY created_at,id').all(user.id);
   const feedback=db.prepare("SELECT f.id,f.category,f.body,f.created_at,coalesce(m.status,'open') status,coalesce(m.updated_at,f.created_at) updated_at FROM feedback f LEFT JOIN feedback_management m ON m.feedback_id=f.id WHERE f.user_id=? ORDER BY f.created_at,f.id").all(user.id);
   const theses=db.prepare(`SELECT id,project_id,title,snapshot,version,status,current_run_id,created_at,updated_at,${hasThesisExportTemplate()?'export_template':'NULL AS export_template'} FROM theses WHERE user_id=? ORDER BY created_at,id`).all(user.id).map(({export_template,...row})=>({...row,snapshot:JSON.parse(row.snapshot),exportTemplate:thesisExportTemplates.stored({...row,user_id:user.id,export_template})}));
   const thesisRuns=db.prepare('SELECT id,thesis_id,snapshot,plan,status,stage,error,attempt,result_id,input_tokens,output_tokens,created_at,updated_at FROM thesis_runs WHERE user_id=? ORDER BY created_at,id').all(user.id).map(row=>({...row,snapshot:JSON.parse(row.snapshot),plan:JSON.parse(row.plan)}));
   const thesisChapters=db.prepare('SELECT v.* FROM thesis_chapter_versions v JOIN theses t ON t.id=v.thesis_id WHERE t.user_id=? ORDER BY v.thesis_id,v.chapter_id,v.version').all(user.id).map(row=>({...row,source_ids:JSON.parse(row.source_ids)}));
   const thesisSections=db.prepare('SELECT c.* FROM thesis_checkpoints c JOIN thesis_runs r ON r.id=c.run_id WHERE r.user_id=? ORDER BY c.run_id,c.position').all(user.id).map(row=>({...row,source_ids:JSON.parse(row.source_ids),missing_evidence:JSON.parse(row.missing_evidence),trace:JSON.parse(row.trace)}));
   const thesisOutlineRuns=db.prepare('SELECT id,snapshot,input_hash,status,stage,error,output,result_id,input_tokens,output_tokens,usage_known,created_at,updated_at FROM thesis_outline_runs WHERE user_id=? ORDER BY created_at,id').all(user.id).map(row=>({...row,snapshot:JSON.parse(row.snapshot),output:row.output?JSON.parse(row.output):null}));
   const thesisMethodRuns=db.prepare('SELECT id,snapshot,input_hash,status,stage,error,output,result_id,input_tokens,output_tokens,usage_known,created_at,updated_at FROM thesis_method_runs WHERE user_id=? ORDER BY created_at,id').all(user.id).map(row=>({...row,snapshot:JSON.parse(row.snapshot),output:row.output?JSON.parse(row.output):null}));
   const writingRuns=optionalRows('writing_runs','SELECT id,kind,operation,snapshot,input_hash,status,stage,error,plan,output,result_id,attempt,input_tokens,output_tokens,usage_known,created_at,updated_at FROM writing_runs WHERE user_id=? ORDER BY created_at,id',user.id).map(row=>({...row,snapshot:JSON.parse(row.snapshot),plan:JSON.parse(row.plan),output:row.output?JSON.parse(row.output):null}));
   const writingCheckpoints=tableExists('writing_runs')?optionalRows('writing_checkpoints','SELECT c.run_id,c.unit_id,c.position,c.output,c.created_at FROM writing_checkpoints c JOIN writing_runs r ON r.id=c.run_id WHERE r.user_id=? ORDER BY c.run_id,c.position',user.id).map(row=>({...row,output:JSON.parse(row.output)})):[];
   const toolRuns=optionalRows('tool_runs','SELECT id,kind,operation,snapshot,input_hash,status,stage,error,plan,output,result_id,input_tokens,output_tokens,usage_known,created_at,updated_at FROM tool_runs WHERE user_id=? ORDER BY created_at,id',user.id).map(row=>({...row,snapshot:JSON.parse(row.snapshot),plan:JSON.parse(row.plan),output:row.output?JSON.parse(row.output):null}));
   const toolCheckpoints=tableExists('tool_runs')?optionalRows('tool_checkpoints','SELECT c.run_id,c.unit_id,c.position,c.output,c.created_at FROM tool_checkpoints c JOIN tool_runs r ON r.id=c.run_id WHERE r.user_id=? ORDER BY c.run_id,c.position',user.id).map(row=>({...row,output:JSON.parse(row.output)})):[];
   const questionnaires=optionalRows('questionnaires','SELECT id,project_id,version,content,created_at,updated_at FROM questionnaires WHERE user_id=? ORDER BY created_at,id',user.id).map(row=>({...row,content:JSON.parse(row.content)}));
   const questionnairePublications=tableExists('questionnaires')?optionalRows('questionnaire_publications','SELECT p.id,p.questionnaire_id,p.token,p.version,p.content,p.status,p.created_at,p.closed_at FROM questionnaire_publications p JOIN questionnaires q ON q.id=p.questionnaire_id WHERE q.user_id=? ORDER BY p.created_at,p.id',user.id).map(row=>({...row,content:JSON.parse(row.content)})):[];
   const questionnaireResponses=tableExists('questionnaires')&&tableExists('questionnaire_publications')?optionalRows('questionnaire_responses','SELECT r.id,r.publication_id,r.answers,r.created_at FROM questionnaire_responses r JOIN questionnaire_publications p ON p.id=r.publication_id JOIN questionnaires q ON q.id=p.questionnaire_id WHERE q.user_id=? ORDER BY r.created_at,r.id',user.id).map(row=>({...row,answers:JSON.parse(row.answers)})):[];
   const artifacts=optionalRows('artifacts',"SELECT id,project_id,name,kind,bytes,sha256,source_type,source_id,status,created_at FROM artifacts WHERE user_id=? AND status!='deleted' ORDER BY created_at,id",user.id).map(row=>({...row,downloadPath:row.status==='ready'?'/api/artifacts/'+encodeURIComponent(row.id)+'/download':null}));
   const aigcDetections=optionalRows('aigc_detections','SELECT id,status,characters,part_count,completed_parts,parts,error,created_at,updated_at FROM aigc_detections WHERE user_id=? ORDER BY created_at,id',user.id).map(row=>({...row,parts:JSON.parse(row.parts)}));
   const webSimilarityRuns=optionalRows('web_similarity_runs','SELECT r.id,r.title,r.characters,r.report_artifact_id,r.html_artifact_id,r.coverage,j.status,j.stage,j.error,r.created_at,r.updated_at FROM web_similarity_runs r JOIN jobs j ON j.id=r.id AND j.user_id=r.user_id WHERE r.user_id=? ORDER BY r.created_at,r.id',user.id).map(row=>({...row,coverage:JSON.parse(row.coverage)}));
   const archive={format:'paperknow-account-archive',version:1,exportedAt:now(),scope:'account',account:{id:profile.id,name:profile.name,email:profile.email,phone:profile.phone},projects,drafts,files,artifacts,results,jobs,feedback,aigcDetections,webSimilarityRuns,theses,thesisRuns,thesisChapters,thesisSections,thesisOutlineRuns,thesisMethodRuns,writingRuns,writingCheckpoints,toolRuns,toolCheckpoints,questionnaires,questionnairePublications,questionnaireResponses,includesOriginalFiles:false,includesGeneratedFileBytes:false,restoreSupported:false};
   if(Buffer.byteLength(JSON.stringify(archive))>100*1024*1024)error(413,'账户资料超过单次归档大小，请按项目下载原件与成果');
   return result(archive);
  }
  if(path==='/api/account/profile'){
   if(method==='GET')return result({user:safeUser(db,user.id)});
   const input=await readBody();fields(input,['name','expectedUserId']);if(input.expectedUserId!==undefined&&input.expectedUserId!==user.id)error(409,'登录账户已变化，请重新读取账户资料后再修改');const name=text(input.name,50,1);if(/[\u0000-\u001f\u007f]/.test(name))error(400,'昵称不能包含控制字符');db.prepare('UPDATE users SET name=? WHERE id=?').run(name,user.id);return result({user:safeUser(db,user.id)});
  }
  if(path==='/api/workspace/summary'&&method==='GET'){
   const count=table=>db.prepare(`SELECT count(*) n FROM ${table} WHERE user_id=?`).get(user.id).n;
   const archived=db.prepare("SELECT count(*) n FROM projects p JOIN workspace_project_details d ON d.project_id=p.id WHERE p.user_id=? AND d.status='archived'").get(user.id).n;
   const jobs=Object.fromEntries(db.prepare('SELECT status,count(*) n FROM jobs WHERE user_id=? GROUP BY status').all(user.id).map(row=>[row.status,row.n]));
   const usage=db.prepare('SELECT count(*) records,CASE WHEN count(*)=count(input_tokens) THEN coalesce(sum(input_tokens),0) ELSE NULL END inputTokens,CASE WHEN count(*)=count(output_tokens) THEN coalesce(sum(output_tokens),0) ELSE NULL END outputTokens,coalesce(sum(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL THEN 1 ELSE 0 END),0) unknownUsageRecords,coalesce(sum(CASE WHEN input_tokens IS NOT NULL AND output_tokens IS NOT NULL THEN 1 ELSE 0 END),0) knownUsageRecords,coalesce(sum(CASE WHEN billable!=0 THEN 1 ELSE 0 END),0) billableRecords FROM usage WHERE user_id=?').get(user.id);
   return result({counts:{projects:count('projects'),activeProjects:count('projects')-archived,archivedProjects:archived,files:count('files'),drafts:count('workspace_drafts'),results:count('results'),jobs:count('jobs'),queuedJobs:(jobs.queued||0)+(jobs.preparing||0),preparingJobs:jobs.preparing||0,runningJobs:jobs.running||0,completedJobs:jobs.completed||0,failedJobs:jobs.failed||0,cancelledJobs:jobs.cancelled||0},storage:{fileBytes:db.prepare('SELECT coalesce(sum(bytes),0) n FROM files WHERE user_id=?').get(user.id).n,draftBytes:db.prepare('SELECT coalesce(sum(bytes),0) n FROM workspace_drafts WHERE user_id=?').get(user.id).n,maxFileBytes:2*1024*1024,maxAccountFileBytes:maxAccountBytes,maxDraftBytes,maxAccountDraftBytes:maxAccountBytes},usage:{...usage,unknownRecords:usage.unknownUsageRecords,usageIncomplete:usage.unknownUsageRecords>0,billingEnabled:billing?.rules().services.some(item=>item.mode==='paid'&&item.available)||false}});
  }
  if(path==='/api/projects'){
   if(method==='GET')return result({items:projectItems(user)});
   const input=await readBody(),title=text(input.title,200,1),degree=text(input.degree||'本科',20,1),major=text(input.major||'',100),description=input.description===undefined?'':text(input.description,5000),stage=input.stage===undefined?'准备中':text(input.stage,50,1);
   return result(transaction(()=>{if(db.prepare('SELECT count(*) n FROM projects WHERE user_id=?').get(user.id).n>=1000)error(409,'项目数量达到限制');const id=randomUUID(),at=now();db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run(id,user.id,title,degree,major,at,at);db.prepare('INSERT INTO workspace_project_details(project_id,status,stage,description,version) VALUES(?,?,?,?,?)').run(id,'active',stage,description,0);return {id,item:projectRow(id,user)};}),201);
  }
  const project=path.match(/^\/api\/projects\/([^/]+)(\/delete)?$/);
  if(project){const id=project[1],row=projectRow(id,user);
   if(method==='GET'&&!project[2]){
    const resultMetadata=[['writing_runs','kind','writing_kind'],['writing_runs','operation','writing_operation'],['tool_runs','kind','tool_kind'],['tool_runs','operation','tool_operation']].map(([table,column,alias])=>tableExists(table)?`(SELECT ${column} FROM ${table} WHERE ${table}.id=results.job_id AND ${table}.user_id=results.user_id) AS ${alias}`:`NULL AS ${alias}`).join(',');
    const metadata=[['thesis_runs','thesis_id','thesis_id'],['writing_runs','kind','writing_kind'],['writing_runs','operation','writing_operation'],['tool_runs','kind','tool_kind'],['tool_runs','operation','tool_operation']].map(([table,column,alias])=>tableExists(table)?`(SELECT ${column} FROM ${table} WHERE ${table}.id=jobs.id AND ${table}.user_id=jobs.user_id) AS ${alias}`:`NULL AS ${alias}`).join(',');
    return result({item:{...row,counts:projectCounts(id,user)},artifacts:projectArtifacts(id,user),theses:db.prepare('SELECT id,title,project_id AS projectId,status,updated_at AS updatedAt,created_at AS createdAt FROM theses WHERE user_id=? AND project_id=? ORDER BY updated_at DESC,id DESC LIMIT 500').all(user.id,id),files:db.prepare("SELECT f.id,f.project_id,f.name,f.kind,f.bytes,f.sha256,f.created_at,CASE WHEN d.status='pending' THEN 'pending' ELSE NULL END AS deletionStatus FROM files f LEFT JOIN workspace_file_deletions d ON d.file_id=f.id WHERE f.user_id=? AND f.project_id=? ORDER BY f.created_at DESC,f.id DESC").all(user.id,id),jobs:db.prepare(`SELECT id,project_id,type,status,stage,error,result_id,attempt,created_at,updated_at,${metadata} FROM jobs WHERE user_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT 100`).all(user.id,id),results:db.prepare(`SELECT id,project_id,job_id,type,title,created_at,CASE WHEN json_valid(body) THEN json_extract(body,'$.thesisId') END thesis_id,${resultMetadata} FROM results WHERE user_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT 500`).all(user.id,id),drafts:db.prepare(`SELECT ${draftColumns} FROM workspace_drafts WHERE user_id=? AND project_id=? ORDER BY updated_at DESC,id DESC`).all(user.id,id)});
   }
   if(method!=='POST')error(405,'不支持的项目操作');const input=await readBody();
   if(project[2]){fields(input,['version']);return result(transaction(()=>{expectedVersion(input,projectRow(id,user).version);for(const table of ['files','jobs','results','workspace_drafts','theses'])if(db.prepare(`SELECT 1 FROM ${table} WHERE project_id=? LIMIT 1`).get(id))error(409,'项目仍有关联内容，请使用归档保留资料');if(tableExists('artifacts')&&db.prepare("SELECT 1 FROM artifacts WHERE project_id=? AND status!='deleted' LIMIT 1").get(id))error(409,'项目仍有云端文件，请先移出文件或归档项目');if(db.prepare('SELECT 1 FROM workspace_file_uploads WHERE project_id=? AND expires_at>? LIMIT 1').get(id,now()))error(409,'该项目仍有文件正在上传，请等待上传完成');db.prepare('DELETE FROM workspace_file_uploads WHERE project_id=? AND expires_at<=?').run(id,now());db.prepare('DELETE FROM workspace_project_details WHERE project_id=?').run(id);db.prepare('DELETE FROM projects WHERE id=? AND user_id=?').run(id,user.id);return {ok:true};}));}
   fields(input,['version','title','degree','major','description','stage','status']);return result(transaction(()=>{const current=projectRow(id,user);expectedVersion(input,current.version);const title=input.title===undefined?current.title:text(input.title,200,1),degree=input.degree===undefined?current.degree:text(input.degree,20,1),major=input.major===undefined?current.major:text(input.major,100),description=input.description===undefined?current.description:text(input.description,5000),stage=input.stage===undefined?current.stage:text(input.stage,50,1),status=input.status??current.status;if(!['active','archived'].includes(status))error(400,'项目状态无效');const at=now();db.prepare('UPDATE projects SET title=?,degree=?,major=?,updated_at=? WHERE id=? AND user_id=?').run(title,degree,major,at,id,user.id);db.prepare('INSERT INTO workspace_project_details(project_id,status,stage,description,version) VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET status=excluded.status,stage=excluded.stage,description=excluded.description,version=excluded.version').run(id,status,stage,description,current.version+1);return {item:projectRow(id,user)};}));
  }
  if(path==='/api/workspace/drafts'){
   if(method==='GET')return result({items:db.prepare(`SELECT ${draftColumns} FROM workspace_drafts WHERE user_id=? ORDER BY updated_at DESC`).all(user.id)});
   const input=await readBody();fields(input,['title','tool','projectId','payload','clientKey']);const title=text(input.title,200,1),tool=text(input.tool,30,1);if(!tools.has(tool))error(400,'草稿工具类型不支持');const pid=projectId(input.projectId,user),payload=payloadJSON(input.payload),bytes=Buffer.byteLength(payload),key=input.clientKey===undefined?null:text(input.clientKey,100,8);const hash=digest(JSON.stringify({title,tool,projectId:pid,payload}));
   return result(transaction(()=>{if(key){const old=db.prepare('SELECT id,input_hash FROM workspace_drafts WHERE user_id=? AND client_key=?').get(user.id,key);if(old){if(old.input_hash!==hash)error(409,'此保存标识已用于其他内容，请读取账户草稿后继续');return {item:draftRow(old.id,user)};}}if(db.prepare('SELECT count(*) n FROM workspace_drafts WHERE user_id=?').get(user.id).n>=1000)error(409,'账户草稿数量达到限制');draftQuota(user,bytes);const id=randomUUID(),at=now();db.prepare('INSERT INTO workspace_drafts(id,user_id,project_id,title,tool,payload,bytes,version,client_key,input_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,user.id,pid,title,tool,payload,bytes,1,key,hash,at,at);return {item:draftRow(id,user)};}),201);
  }
  const draft=path.match(/^\/api\/workspace\/drafts\/([^/]+)(\/delete)?$/);
  if(draft){const row=draftRow(draft[1],user);if(method==='GET'&&!draft[2])return result({item:row});if(method!=='POST')error(405,'不支持的草稿操作');const input=await readBody();
   if(draft[2]){fields(input,['version']);return result(transaction(()=>{expectedVersion(input,draftRow(row.id,user,false).version);db.prepare('DELETE FROM workspace_drafts WHERE id=? AND user_id=?').run(row.id,user.id);return {ok:true};}));}
   fields(input,['version','title','projectId','payload']);return result(transaction(()=>{const current=draftRow(row.id,user);expectedVersion(input,current.version);const title=input.title===undefined?current.title:text(input.title,200,1),pid=input.projectId===undefined?current.project_id:projectId(input.projectId,user),payload=input.payload===undefined?JSON.stringify(current.payload):payloadJSON(input.payload),bytes=Buffer.byteLength(payload);draftQuota(user,bytes,current.bytes);db.prepare('UPDATE workspace_drafts SET title=?,project_id=?,payload=?,bytes=?,version=version+1,updated_at=? WHERE id=? AND user_id=?').run(title,pid,payload,bytes,now(),row.id,user.id);return {item:draftRow(row.id,user)};}));
  }
  const resultPath=path.match(/^\/api\/results\/([^/]+)$/);
  if(resultPath&&method==='POST'){const row=own('results',resultPath[1],user),input=await readBody();fields(input,['projectId','title']);const pid=input.projectId===undefined?row.project_id:projectId(input.projectId,user),title=input.title===undefined?row.title:text(input.title,200,1);db.prepare('UPDATE results SET project_id=?,title=? WHERE id=? AND user_id=?').run(pid,title,row.id,user.id);return result({item:{...own('results',row.id,user),body:JSON.parse(row.body)}});}
  if(path==='/api/feedback'){
   if(method==='GET')return result({items:db.prepare(`SELECT f.id,f.category,f.body,f.created_at,coalesce(m.status,'open') status,coalesce(m.updated_at,f.created_at) updated_at FROM feedback f LEFT JOIN feedback_management m ON m.feedback_id=f.id WHERE f.user_id=? ORDER BY f.created_at DESC LIMIT 100`).all(user.id)});
   const input=await readBody();if(db.prepare('SELECT count(*) n FROM feedback WHERE user_id=? AND created_at>=?').get(user.id,new Date(Date.now()-86400000).toISOString()).n>=20)error(429,'今天提交的反馈较多，请稍后再试；紧急问题可联系人工支持');const id=randomUUID();db.prepare('INSERT INTO feedback VALUES(?,?,?,?,?)').run(id,user.id,text(input.category||'产品建议',30,1),text(input.text,3000,1),now());return result({id,item:feedbackItem(id,user)},201);
  }
  return null;
 };
}
