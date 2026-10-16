import {randomUUID} from 'node:crypto';
import {safeUser,digest} from './auth.mjs';
import {now} from './database.mjs';

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
 const own=(table,id,user)=>{const row=db.prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=?`).get(id,user.id);if(!row)error(404,'记录不存在');return row;};
 const projectId=(id,user)=>{if(id===undefined||id===null||id==='')return null;if(typeof id!=='string')error(400,'项目编号无效');own('projects',id,user);return id;};
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(cause){db.exec('ROLLBACK');throw cause;}};
 const projectSelect=`SELECT p.*,coalesce(d.status,'active') status,coalesce(d.stage,'准备中') stage,coalesce(d.description,'') description,coalesce(d.version,0) version FROM projects p LEFT JOIN workspace_project_details d ON d.project_id=p.id`;
 const projectRow=(id,user)=>{const row=db.prepare(projectSelect+' WHERE p.id=? AND p.user_id=?').get(id,user.id);if(!row)error(404,'记录不存在');return row;};
 const draftColumns='id,user_id,project_id,title,tool,version,bytes,created_at,updated_at';
 const draftRow=(id,user,full=true)=>{const row=db.prepare(`SELECT ${draftColumns}${full?',payload':''} FROM workspace_drafts WHERE id=? AND user_id=?`).get(id,user.id);if(!row)error(404,'记录不存在');if(full)row.payload=JSON.parse(row.payload);return row;};
 const draftQuota=(user,bytes,replacing=0)=>{const total=db.prepare('SELECT coalesce(sum(bytes),0) bytes FROM workspace_drafts WHERE user_id=?').get(user.id).bytes;if(total-replacing+bytes>maxAccountBytes)error(409,'账户草稿总量最多 50MB，请先下载备份并整理已有草稿');};
 const feedbackItem=(id,user)=>db.prepare(`SELECT f.id,f.category,f.body,f.created_at,coalesce(m.status,'open') status,coalesce(m.updated_at,f.created_at) updated_at FROM feedback f LEFT JOIN feedback_management m ON m.feedback_id=f.id WHERE f.id=? AND f.user_id=?`).get(id,user.id);
 return async({path,method,user,readBody})=>{
  const result=(value,status=200)=>({value,status});
  if(path==='/api/account/profile'){
   if(method==='GET')return result({user:safeUser(db,user.id)});
   const input=await readBody();fields(input,['name','expectedUserId']);if(input.expectedUserId!==undefined&&input.expectedUserId!==user.id)error(409,'登录账户已变化，请重新读取账户资料后再修改');const name=text(input.name,50,1);if(/[\u0000-\u001f\u007f]/.test(name))error(400,'昵称不能包含控制字符');db.prepare('UPDATE users SET name=? WHERE id=?').run(name,user.id);return result({user:safeUser(db,user.id)});
  }
  if(path==='/api/workspace/summary'&&method==='GET'){
   const count=table=>db.prepare(`SELECT count(*) n FROM ${table} WHERE user_id=?`).get(user.id).n;
   const archived=db.prepare("SELECT count(*) n FROM projects p JOIN workspace_project_details d ON d.project_id=p.id WHERE p.user_id=? AND d.status='archived'").get(user.id).n;
   const jobs=Object.fromEntries(db.prepare('SELECT status,count(*) n FROM jobs WHERE user_id=? GROUP BY status').all(user.id).map(row=>[row.status,row.n]));
   const usage=db.prepare('SELECT count(*) records,coalesce(sum(input_tokens),0) inputTokens,coalesce(sum(output_tokens),0) outputTokens,coalesce(sum(CASE WHEN billable!=0 THEN 1 ELSE 0 END),0) billableRecords FROM usage WHERE user_id=?').get(user.id);
   return result({counts:{projects:count('projects'),activeProjects:count('projects')-archived,archivedProjects:archived,files:count('files'),drafts:count('workspace_drafts'),results:count('results'),jobs:count('jobs'),queuedJobs:jobs.queued||0,runningJobs:jobs.running||0,completedJobs:jobs.completed||0,failedJobs:jobs.failed||0,cancelledJobs:jobs.cancelled||0},storage:{fileBytes:db.prepare('SELECT coalesce(sum(bytes),0) n FROM files WHERE user_id=?').get(user.id).n,draftBytes:db.prepare('SELECT coalesce(sum(bytes),0) n FROM workspace_drafts WHERE user_id=?').get(user.id).n,maxFileBytes:2*1024*1024,maxAccountFileBytes:maxAccountBytes,maxDraftBytes,maxAccountDraftBytes:maxAccountBytes},usage:{...usage,billingEnabled:billing?.rules().services.some(item=>item.mode==='paid'&&item.available)||false}});
  }
  if(path==='/api/projects'){
   if(method==='GET')return result({items:db.prepare(projectSelect+' WHERE p.user_id=? ORDER BY p.updated_at DESC').all(user.id)});
   const input=await readBody(),title=text(input.title,200,1),degree=text(input.degree||'本科',20,1),major=text(input.major||'',100),description=input.description===undefined?'':text(input.description,5000),stage=input.stage===undefined?'准备中':text(input.stage,50,1);
   return result(transaction(()=>{if(db.prepare('SELECT count(*) n FROM projects WHERE user_id=?').get(user.id).n>=1000)error(409,'项目数量达到限制');const id=randomUUID(),at=now();db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run(id,user.id,title,degree,major,at,at);db.prepare('INSERT INTO workspace_project_details(project_id,status,stage,description,version) VALUES(?,?,?,?,?)').run(id,'active',stage,description,0);return {id,item:projectRow(id,user)};}),201);
  }
  const project=path.match(/^\/api\/projects\/([^/]+)(\/delete)?$/);
  if(project){const id=project[1],row=projectRow(id,user);
   if(method==='GET'&&!project[2])return result({item:row,files:db.prepare('SELECT id,project_id,name,kind,bytes,created_at FROM files WHERE user_id=? AND project_id=? ORDER BY created_at DESC').all(user.id,id),jobs:db.prepare('SELECT id,project_id,type,status,stage,error,result_id,attempt,created_at,updated_at FROM jobs WHERE user_id=? AND project_id=? ORDER BY created_at DESC LIMIT 100').all(user.id,id),results:db.prepare('SELECT id,project_id,job_id,type,title,created_at FROM results WHERE user_id=? AND project_id=? ORDER BY created_at DESC LIMIT 500').all(user.id,id),drafts:db.prepare(`SELECT ${draftColumns} FROM workspace_drafts WHERE user_id=? AND project_id=? ORDER BY updated_at DESC`).all(user.id,id)});
   if(method!=='POST')error(405,'不支持的项目操作');const input=await readBody();
   if(project[2]){fields(input,['version']);return result(transaction(()=>{expectedVersion(input,projectRow(id,user).version);for(const table of ['files','jobs','results','workspace_drafts'])if(db.prepare(`SELECT 1 FROM ${table} WHERE project_id=? LIMIT 1`).get(id))error(409,'项目仍有关联内容，请使用归档保留资料');db.prepare('DELETE FROM workspace_project_details WHERE project_id=?').run(id);db.prepare('DELETE FROM projects WHERE id=? AND user_id=?').run(id,user.id);return {ok:true};}));}
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
   const input=await readBody();if(db.prepare('SELECT count(*) n FROM feedback WHERE user_id=?').get(user.id).n>=100)error(409,'反馈数量达到限制');const id=randomUUID();db.prepare('INSERT INTO feedback VALUES(?,?,?,?,?)').run(id,user.id,text(input.category||'产品建议',30,1),text(input.text,3000,1),now());return result({id,item:feedbackItem(id,user)},201);
  }
  return null;
 };
}
