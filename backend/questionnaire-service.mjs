import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {normalizeScaleOptions} from '../dist/workspace/questionnaire-model.mjs';
const fail=(status,message)=>{const error=new Error(message);error.status=status;throw error;};
const hash=value=>createHash('sha256').update(value).digest('hex');
const object=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail(400,'问卷包含不支持的字段');return value;};
const text=(value,max=200,required=false)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||required&&!value.trim())fail(400,'请检查问卷文字长度和必填项');return value.trim();};
const version=value=>{if(!Number.isSafeInteger(value)||value<1)fail(400,'问卷版本无效');return value;};
export function initializeQuestionnaireSchema(db){db.exec(`
 CREATE TABLE IF NOT EXISTS questionnaires(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,version INTEGER NOT NULL DEFAULT 1,content TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS questionnaires_owner ON questionnaires(user_id,updated_at);
 CREATE TABLE IF NOT EXISTS questionnaire_publications(id TEXT PRIMARY KEY,questionnaire_id TEXT NOT NULL REFERENCES questionnaires(id),token TEXT UNIQUE NOT NULL,version INTEGER NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','closed')),created_at TEXT NOT NULL,closed_at TEXT);
 CREATE INDEX IF NOT EXISTS questionnaire_publications_questionnaire ON questionnaire_publications(questionnaire_id,created_at);
 CREATE TABLE IF NOT EXISTS questionnaire_responses(id TEXT PRIMARY KEY,publication_id TEXT NOT NULL REFERENCES questionnaire_publications(id),participant_hash TEXT NOT NULL,answers TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(publication_id,participant_hash));
 CREATE INDEX IF NOT EXISTS questionnaire_responses_publication ON questionnaire_responses(publication_id,created_at);
 CREATE TABLE IF NOT EXISTS questionnaire_rate_limits(key_hash TEXT PRIMARY KEY,count INTEGER NOT NULL,until_ms INTEGER NOT NULL);
 `);}
export function normalizeQuestionnaireContent(input,{publish=false}={}){
 object(input,['title','audience','purpose','introduction','questions','aiState','step','questionCount','scalePoints','targetSampleSize','researchDimensions','analysisFocus']);
 const title=text(input.title??'',200,publish),audience=text(input.audience??'',300),purpose=text(input.purpose??'',2000),introduction=text(input.introduction??'',2000);
 if(!Array.isArray(input.questions)||input.questions.length>60||publish&&!input.questions.length)fail(400,'发布前请填写 1～60 道问题');
 const ids=new Set();const questions=input.questions.map(item=>{object(item,['id','type','title','options','required']);const id=text(item.id,80,true);if(!/^[a-zA-Z0-9_-]+$/.test(id)||['__proto__','constructor','prototype'].includes(id)||ids.has(id))fail(400,'问题标识重复或无效');ids.add(id);if(!['single','multiple','scale','text'].includes(item.type)||typeof item.required!=='boolean')fail(400,'问题类型或必填设置无效');const title=text(item.title??'',500,publish);let options=[];if(item.type==='scale'){try{options=normalizeScaleOptions(item.options,{legacyDefault:true});}catch(error){fail(400,error.message);}}else if(['single','multiple'].includes(item.type)){if(!Array.isArray(item.options)||item.options.length>20||publish&&item.options.length<2)fail(400,'选择题请填写 2～20 个选项');options=item.options.map(v=>text(v,150,publish));if(publish&&new Set(options).size!==options.length)fail(400,'同一道题不能有重复选项');}return{id,type:item.type,title,options,required:item.required};});
 let aiState=null;if(input.aiState!==undefined&&input.aiState!==null){const state=object(input.aiState,['commandKey','itemId','ownerId','contextKey','snapshot','resumeFromJobId','projectRef','projectId','adoptionKey']);if(Buffer.byteLength(JSON.stringify(state))>20000)fail(413,'生成任务状态过长');aiState={};for(const key of ['commandKey','itemId','ownerId','resumeFromJobId'])if(state[key])aiState[key]=text(state[key],120);for(const [key,max]of [['projectRef',300],['projectId',100]])if(state[key]!==undefined&&state[key]!==null&&state[key]!==''){const value=text(state[key],max);if(value)aiState[key]=value;}if(state.adoptionKey!==undefined){const key=text(state.adoptionKey,80);if(!/^q1:\d{1,6}:[0-9a-f]{1,8}:[0-9a-f]{1,8}$/.test(key))fail(400,'问卷编辑状态不正确');aiState.adoptionKey=key;}if(state.contextKey)aiState.contextKey=text(state.contextKey,12000);if(state.snapshot){object(state.snapshot,['title','profile','requirements','materials','references','outline']);if(state.snapshot.materials?.length||state.snapshot.references?.length||state.snapshot.outline?.length)fail(400,'问卷任务状态不应附带私人材料');aiState.snapshot=state.snapshot;}}
 const step=Number.isInteger(input.step)&&input.step>=0&&input.step<=3?input.step:0;
 const generation={};for(const [field,min,max]of [['questionCount',3,60],['scalePoints',2,10],['targetSampleSize',1,1000]])if(input[field]!==undefined&&input[field]!==null&&input[field]!==''){if(!Number.isSafeInteger(input[field])||input[field]<min||input[field]>max)fail(400,field==='questionCount'?'AI 题数应为 3～60 的整数':field==='targetSampleSize'?'目标样本量应为 1～1,000 的整数':'量表级数应为 2～10 的整数');generation[field]=input[field];}
 for(const field of ['researchDimensions','analysisFocus'])if(input[field]!==undefined)generation[field]=text(input[field],2000);
 const content={title,audience,purpose,introduction,questions,step,...generation,...(aiState?{aiState}:{})};if(Buffer.byteLength(JSON.stringify(content))>60000)fail(413,'问卷内容过长，请精简后保存');return content;
}
export function normalizeQuestionnaireAnswers(content,input){
 object(input,['participantId','answers','consent']);if(input.consent!==true)fail(400,'请先确认自愿匿名参与');if(typeof input.participantId!=='string'||!/^[a-zA-Z0-9_-]{20,100}$/.test(input.participantId))fail(400,'答卷标识无效，请刷新后重试');
 const answers=object(input.answers,content.questions.map(q=>q.id)),result={};
 for(const q of content.questions){const answer=answers[q.id],empty=answer===undefined||answer===null||answer===''||Array.isArray(answer)&&!answer.length;if(empty){if(q.required)fail(400,`请完成必填问题：${q.title}`);continue;}
  if(q.type==='text')result[q.id]=text(answer,2000,true);
  else if(q.type==='multiple'){if(!Array.isArray(answer)||answer.length>q.options.length||new Set(answer).size!==answer.length||answer.some(v=>typeof v!=='string'||!q.options.includes(v)))fail(400,'多选答案包含无效选项');result[q.id]=answer;}
  else {if(typeof answer!=='string'||!q.options.includes(answer))fail(400,'单选或量表答案无效');result[q.id]=answer;}
 }
 if(Buffer.byteLength(JSON.stringify(result))>30000)fail(413,'答卷内容过长');return result;
}
// Navigation progress and AI recovery metadata do not change the published survey.
const semanticContent=content=>JSON.stringify({title:content.title,audience:content.audience,purpose:content.purpose,introduction:content.introduction,questions:content.questions});
export function questionnaireCsvCell(value){let content=String(value??'');if(/^[\s\uFEFF]*[=+@\-]/.test(content)||/^[\t\r\n]/.test(content))content="'"+content;return '"'+content.replaceAll('"','""')+'"';}
export function questionnaireReport(content,responses){
 const rows=responses.map(row=>({...row,answers:typeof row.answers==='string'?JSON.parse(row.answers):row.answers})),total=rows.length;
  return{title:content.title,total,generatedAt:new Date().toISOString(),method:'descriptive',limitations:'仅统计本次发布版本收到的答卷；自愿匿名样本不代表总体，不提供因果结论或显著性检验。',questions:content.questions.map(q=>{const answered=rows.filter(row=>Object.hasOwn(row.answers,q.id));const item={id:q.id,title:q.title,type:q.type,answered:answered.length,missing:total-answered.length};if(q.type==='text')return{...item,textAnswers:answered.slice(-50).map(row=>row.answers[q.id]),textAnswersLimited:answered.length>50};const distribution=q.options.map(option=>{const count=answered.filter(row=>Array.isArray(row.answers[q.id])?row.answers[q.id].includes(option):row.answers[q.id]===option).length;return{option,count,percent:answered.length?Math.round(count/answered.length*10000)/100:0};});return{...item,distribution,...(q.type==='scale'?{mean:answered.length?Math.round(answered.reduce((sum,row)=>sum+q.options.indexOf(row.answers[q.id])+1,0)/answered.length*100)/100:null,note:`量表按本发布版本的选项顺序计 1～${q.options.length} 分，保留各选项原始含义。`}:{}),...(q.type==='multiple'?{note:'多选题按已答此题人数计算比例，合计可能超过 100%。'}:{})};})};
}
export function createQuestionnaireService(db,config={}){
 initializeQuestionnaireSchema(db);const clock=()=>Number(config.questionnaireNow?.()??Date.now()),at=()=>new Date(clock()).toISOString();
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 const own=(id,user)=>{if(!user?.id)fail(401,'请先登录');const row=db.prepare('SELECT * FROM questionnaires WHERE id=? AND user_id=?').get(id,user.id);if(!row)fail(404,'问卷不存在');return row;};
 const project=(value,user)=>{if(value===undefined||value===null||value==='')return null;const id=text(value,100,true);if(!db.prepare('SELECT 1 FROM projects WHERE id=? AND user_id=?').get(id,user.id))fail(404,'所属项目不存在');return id;};
 const publications=(id,currentContent)=>{const draft=currentContent||JSON.parse(db.prepare('SELECT content FROM questionnaires WHERE id=?').get(id).content),fingerprint=semanticContent(draft);return db.prepare('SELECT p.id,p.token,p.version,p.content,p.status,p.created_at,p.closed_at,(SELECT count(*) FROM questionnaire_responses r WHERE r.publication_id=p.id) response_count FROM questionnaire_publications p WHERE questionnaire_id=? ORDER BY rowid DESC').all(id).map(row=>({id:row.id,token:row.token,version:row.version,status:row.status,createdAt:row.created_at,closedAt:row.closed_at,responseCount:row.response_count,matchesDraft:semanticContent(JSON.parse(row.content))===fingerprint,url:'/questionnaire.html?token='+encodeURIComponent(row.token)}));};
 const serialize=row=>({id:row.id,version:row.version,projectId:row.project_id||'',content:JSON.parse(row.content),createdAt:row.created_at,updatedAt:row.updated_at,publications:publications(row.id,JSON.parse(row.content))});
 const rate=(key,limit=30,windowMs=3600000)=>{const now=clock(),keyHash=hash(key);db.prepare('DELETE FROM questionnaire_rate_limits WHERE until_ms<?').run(now);let row=db.prepare('SELECT * FROM questionnaire_rate_limits WHERE key_hash=?').get(keyHash);if(row&&row.count>=limit)fail(429,'提交较频繁，请稍后重试');db.prepare('INSERT INTO questionnaire_rate_limits(key_hash,count,until_ms) VALUES(?,?,?) ON CONFLICT(key_hash) DO UPDATE SET count=count+1').run(keyHash,1,row?.until_ms||now+windowMs);};
 const response=(value,status=200)=>({status,value});
 async function handle({path,method,user,query=new URLSearchParams(),readBody,clientKey=''}){
  if(path!=='/api/questionnaires'&&!path.startsWith('/api/questionnaires/'))return null;
  const publicRoute=path.match(/^\/api\/questionnaires\/public\/([A-Za-z0-9_-]{43})(?:\/(responses))?$/);
  if(path.startsWith('/api/questionnaires/public/')){
   if(!publicRoute)fail(404,'问卷链接不存在');const pub=db.prepare('SELECT * FROM questionnaire_publications WHERE token=?').get(publicRoute[1]);if(!pub)fail(404,'问卷链接不存在');if(pub.status!=='open')fail(410,'此问卷已停止收集');const content=JSON.parse(pub.content);
   if(!publicRoute[2]&&method==='GET')return response({questionnaire:{title:content.title,introduction:content.introduction,questions:content.questions,version:pub.version},privacy:'匿名自愿参与，请勿提交姓名、联系方式、身份证件、健康等敏感信息。答卷仅供问卷创建者查看与统计。'});
   if(publicRoute[2]==='responses'&&method==='POST'){
    const input=await readBody(),answers=normalizeQuestionnaireAnswers(content,input),participant=hash(pub.id+':'+input.participantId);
    return transaction(()=>{rate('submit:'+pub.id+':'+String(clientKey),config.questionnaireSubmitHourlyLimit||10);const current=db.prepare('SELECT status FROM questionnaire_publications WHERE id=?').get(pub.id);if(current.status!=='open')fail(410,'此问卷已停止收集');if(db.prepare('SELECT 1 FROM questionnaire_responses WHERE publication_id=? AND participant_hash=?').get(pub.id,participant))fail(409,'此浏览器已提交该问卷，请勿重复填写');if(db.prepare('SELECT count(*) n FROM questionnaire_responses WHERE publication_id=?').get(pub.id).n>=(config.questionnaireResponseLimit||1000))fail(409,'此版本已达到答卷数量上限，请联系问卷创建者');if(db.prepare('SELECT count(*) n FROM questionnaire_responses r JOIN questionnaire_publications p ON r.publication_id=p.id WHERE p.questionnaire_id=?').get(pub.questionnaire_id).n>=5000)fail(409,'问卷已达到答卷保存上限');db.prepare('INSERT INTO questionnaire_responses VALUES(?,?,?,?,?)').run(randomUUID(),pub.id,participant,JSON.stringify(answers),at());return response({ok:true,message:'答卷已提交，感谢参与。'},201);});
   }
   fail(405,'不支持的问卷操作');
  }
  if(!user?.id)fail(401,'请先登录');
  if(method==='GET'){const expected=query.get?.('expectedUserId');if(expected!==null&&expected!==undefined&&expected!==user.id)fail(409,'登录账户已变化，请重新打开问卷设计');}
  if(path==='/api/questionnaires'){
   if(method==='GET'){const expected=query.get?.('expectedUserId');if(expected!==null&&expected!==undefined&&expected!==user.id)fail(409,'登录账户已变化，请重新打开问卷设计');return response({items:db.prepare('SELECT * FROM questionnaires WHERE user_id=? ORDER BY updated_at DESC LIMIT 100').all(user.id).map(serialize)});}
   if(method!=='POST')fail(405,'不支持的问卷操作');const input=object(await readBody(),['content','projectId','expectedUserId']);if(input.expectedUserId!==undefined&&input.expectedUserId!==user.id)fail(409,'登录账户已变化，问卷未保存，请切回原账户后重试');const content=normalizeQuestionnaireContent(input.content),projectId=project(input.projectId,user);return transaction(()=>{rate('create:'+user.id,20);if(db.prepare('SELECT count(*) n FROM questionnaires WHERE user_id=?').get(user.id).n>=100)fail(409,'最多保存 100 份问卷，请联系支持整理');const id=randomUUID(),time=at();db.prepare('INSERT INTO questionnaires VALUES(?,?,?,?,?,?,?)').run(id,user.id,projectId,1,JSON.stringify(content),time,time);return response({item:serialize(own(id,user))},201);});
  }
  const route=path.match(/^\/api\/questionnaires\/([^/]+)(?:\/(publish|close|report|responses\.csv))?$/);if(!route)fail(404,'问卷接口不存在');const row=own(route[1],user),action=route[2];
  if(!action&&method==='GET')return response({item:serialize(row)});
  if(!action&&method==='POST'){
   const input=object(await readBody(),['content','version','projectId','expectedUserId']);if(input.expectedUserId!==undefined&&input.expectedUserId!==user.id)fail(409,'登录账户已变化，问卷未保存，请切回原账户后重试');version(input.version);const content=normalizeQuestionnaireContent(input.content);return transaction(()=>{rate('save:'+user.id,300,600000);const current=own(row.id,user);if(current.version!==input.version)fail(409,'问卷已在其他页面更新，请重新读取后再保存');const projectId=input.projectId===undefined?current.project_id:project(input.projectId,user);db.prepare('UPDATE questionnaires SET content=?,project_id=?,version=version+1,updated_at=? WHERE id=? AND user_id=?').run(JSON.stringify(content),projectId,at(),row.id,user.id);return response({item:serialize(own(row.id,user))});});
  }
  if(['publish','close'].includes(action)&&method==='POST'){
   const input=object(await readBody(),['version','expectedUserId']);if(input.expectedUserId!==undefined&&input.expectedUserId!==user.id)fail(409,'登录账户已变化，问卷发布状态未修改');version(input.version);return transaction(()=>{rate('publish:'+user.id,30);const current=own(row.id,user);if(current.version!==input.version)fail(409,'问卷版本已变化，请重新确认后发布');if(action==='publish'){
    const content=normalizeQuestionnaireContent(JSON.parse(current.content),{publish:true}),existing=publications(row.id,content).find(pub=>pub.status==='open'&&pub.matchesDraft);if(existing)return response({item:serialize(current)});
    if(db.prepare('SELECT count(*) n FROM questionnaire_publications WHERE questionnaire_id=?').get(row.id).n>=50)fail(409,'此问卷已达到 50 个发布版本上限');db.prepare("UPDATE questionnaire_publications SET status='closed',closed_at=? WHERE questionnaire_id=? AND status='open'").run(at(),row.id);delete content.aiState;delete content.step;db.prepare('INSERT INTO questionnaire_publications VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),row.id,randomBytes(32).toString('base64url'),current.version,JSON.stringify(content),'open',at(),null);
   }else db.prepare("UPDATE questionnaire_publications SET status='closed',closed_at=? WHERE questionnaire_id=? AND status='open'").run(at(),row.id);return response({item:serialize(own(row.id,user))});});
  }
  if(['report','responses.csv'].includes(action)&&method==='GET'){
   const publicationId=query.get?.('publication')||publications(row.id)[0]?.id,pub=db.prepare('SELECT * FROM questionnaire_publications WHERE id=? AND questionnaire_id=?').get(publicationId||'',row.id);if(!pub)return response({report:null,message:'尚未发布问卷，暂无答卷统计。'});const content=JSON.parse(pub.content),rows=db.prepare('SELECT id,answers,created_at FROM questionnaire_responses WHERE publication_id=? ORDER BY rowid').all(pub.id);
   if(action==='report')return response({report:{...questionnaireReport(content,rows),publicationId:pub.id,version:pub.version,status:pub.status}});
   rate('csv:'+user.id,20);const csv='\uFEFF'+[['答卷编号','提交时间',...content.questions.map(q=>q.title)],...rows.map((row,index)=>{const answers=JSON.parse(row.answers);return[index+1,row.created_at,...content.questions.map(q=>Array.isArray(answers[q.id])?answers[q.id].join('；'):answers[q.id]??'')];})].map(values=>values.map(questionnaireCsvCell).join(',')).join('\r\n');return{status:200,body:csv,headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="questionnaire-responses.csv"'}};
  }
  fail(405,'不支持的问卷操作');
 }
 return{handle,get:(id,user)=>serialize(own(id,user))};
}
