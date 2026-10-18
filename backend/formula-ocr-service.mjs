import {randomUUID,createHash} from 'node:crypto';
import {createFormulaOcrClient,formulaOcrConfigured,formulaOcrLimits,formulaOcrError,validateFormulaImage,normalizeRecognizedFormula} from './formula-ocr-client.mjs';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const idValid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function initializeFormulaOcrSchema(db){
 db.exec(`CREATE TABLE IF NOT EXISTS formula_recognitions(
  id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),latex TEXT,error TEXT,
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,input_hash)
 );CREATE INDEX IF NOT EXISTS formula_recognition_owner ON formula_recognitions(user_id,created_at);
 CREATE TABLE IF NOT EXISTS formula_recognition_requests(
  user_id TEXT NOT NULL REFERENCES users(id),idempotency_key TEXT NOT NULL,
  recognition_id TEXT NOT NULL REFERENCES formula_recognitions(id),input_hash TEXT NOT NULL,
  PRIMARY KEY(user_id,idempotency_key)
 );`);
}
export function formulaOcrCapabilities(config={}){
 const ready=formulaOcrConfigured(config);
 return{ready,maxFileBytes:formulaOcrLimits.maxFileBytes,maxDimension:formulaOcrLimits.maxDimension,maxCharacters:formulaOcrLimits.maxCharacters,userDailyLimit:formulaOcrLimits.userDaily,consentRequired:true,reason:ready?'':'公式图片识别暂未开放，可继续使用公式编辑器'};
}
export function createFormulaOcrService(db,config={}, {client}={}){
 initializeFormulaOcrSchema(db);
 const cloud=client||config.formulaOcrClient||createFormulaOcrClient(config);
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 const summary=(row,cached=false)=>({id:row.id,status:row.status,...(row.status==='completed'?{latex:row.latex}:row.status==='failed'?{error:row.error}:{}),createdAt:row.created_at,updatedAt:row.updated_at,...(cached?{cached:true}:{}),notice:'识别结果需核对，可在公式编辑器中继续修改。'});
 const own=(id,user)=>{const row=db.prepare('SELECT * FROM formula_recognitions WHERE id=? AND user_id=?').get(id,user.id);if(!row)fail(404,'公式识别记录不存在');return row;};
 function expireStale(){
  const before=new Date(Date.now()-120000).toISOString();
  db.prepare("UPDATE formula_recognitions SET status='failed',error=?,updated_at=? WHERE status='running' AND updated_at<?").run('此识别请求未完成确认，为避免重复调用不会自动重新提交，请联系支持。',new Date().toISOString(),before);
 }
 return{capabilities:()=>formulaOcrCapabilities(config),async handle({path,method,user,readBody}){
  const item=path.match(/^\/api\/formula-recognitions\/([A-Za-z0-9_-]{1,120})$/);
  if(path!=='/api/formula-recognitions'&&!item)return null;
  if(!idValid(user?.id))fail(401,'请先登录后使用公式图片识别');
  if(item){if(method!=='GET')fail(405,'不支持的公式识别操作');expireStale();return{value:summary(own(item[1],user))};}
  if(method!=='POST')fail(405,'不支持的公式识别操作');
  const input=await readBody();
  if(!plain(input)||Object.keys(input).some(key=>!['imageBase64','mime','consent','expectedUserId','idempotencyKey'].includes(key)))fail(400,'公式识别请求包含不支持的内容');
  if(input.expectedUserId!==user.id)fail(409,'登录账户已变化，请刷新后重新选择图片');
  if(input.consent!==true)fail(400,'请确认将本次公式图片发送至云端识别服务');
  if(typeof input.idempotencyKey!=='string'||!/^[-A-Za-z0-9_]{8,100}$/.test(input.idempotencyKey))fail(400,'公式识别请求编号无效');
  if(typeof input.imageBase64!=='string'||!input.imageBase64.length||input.imageBase64.length%4||input.imageBase64.length>Math.ceil(formulaOcrLimits.maxFileBytes/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.imageBase64))fail(400,'公式图片编码无效，图片应不超过 2MB');
  const bytes=Buffer.from(input.imageBase64,'base64');if(bytes.toString('base64')!==input.imageBase64)fail(400,'公式图片编码无效');
  validateFormulaImage(bytes,input.mime);
  const hash=createHash('sha256').update(input.mime).update('\0').update(bytes).digest('hex');
  const admission=tx(()=>{
   expireStale();
   const alias=db.prepare('SELECT * FROM formula_recognition_requests WHERE user_id=? AND idempotency_key=?').get(user.id,input.idempotencyKey);
   if(alias){if(alias.input_hash!==hash)fail(409,'此请求编号已用于其他图片，请重新选择图片');return{row:own(alias.recognition_id,user),cached:true};}
   const prior=db.prepare('SELECT * FROM formula_recognitions WHERE user_id=? AND input_hash=?').get(user.id,hash);
   if(prior){db.prepare('INSERT INTO formula_recognition_requests VALUES(?,?,?,?)').run(user.id,input.idempotencyKey,prior.id,hash);return{row:prior,cached:true};}
   if(!formulaOcrConfigured(config)||cloud.ready===false||typeof cloud.recognize!=='function')fail(503,formulaOcrCapabilities({...config,formulaOcrEnabled:false}).reason);
   if(db.prepare("SELECT count(*) n FROM formula_recognitions WHERE user_id=? AND status='running'").get(user.id).n>=1)fail(409,'已有公式图片正在识别，请等待完成后再提交');
   if(db.prepare("SELECT count(*) n FROM formula_recognitions WHERE status='running'").get().n>=formulaOcrLimits.maxConcurrent)fail(429,'公式识别当前繁忙，请稍后再试');
   const today=new Date();today.setUTCHours(0,0,0,0);
   if(db.prepare('SELECT count(*) n FROM formula_recognitions WHERE user_id=? AND created_at>=?').get(user.id,today.toISOString()).n>=formulaOcrLimits.userDaily)fail(429,'今日公式识别次数已用完，请明天再试');
   if(db.prepare('SELECT count(*) n FROM formula_recognitions WHERE created_at>=?').get(today.toISOString()).n>=formulaOcrLimits.globalDaily)fail(429,'公式识别今日额度已用完，请稍后再试');
   const id=randomUUID(),at=new Date().toISOString();
   db.prepare("INSERT INTO formula_recognitions VALUES(?,?,?,'running',NULL,NULL,?,?)").run(id,user.id,hash,at,at);
   db.prepare('INSERT INTO formula_recognition_requests VALUES(?,?,?,?)').run(user.id,input.idempotencyKey,id,hash);
   return{row:own(id,user),cached:false};
  });
  if(admission.cached)return{value:summary(admission.row,true)};
  try{
   const result=await cloud.recognize(bytes,input.mime),latex=normalizeRecognizedFormula(result?.latex);
   db.prepare("UPDATE formula_recognitions SET status='completed',latex=?,error=NULL,updated_at=? WHERE id=? AND status='running'").run(latex,new Date().toISOString(),admission.row.id);
   return{status:201,value:summary(own(admission.row.id,user))};
  }catch(error){
   const safe=error?.formulaOcrSafe?error:formulaOcrError('formula_ocr_unavailable',503,'公式识别暂未完成，请稍后查看记录或联系支持，本次不会自动重复提交');
   db.prepare("UPDATE formula_recognitions SET status='failed',error=?,updated_at=? WHERE id=? AND status='running'").run(safe.message,new Date().toISOString(),admission.row.id);
   return{status:safe.status||503,value:summary(own(admission.row.id,user))};
  }
 }};
}
