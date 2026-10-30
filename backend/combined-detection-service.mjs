import {webSimilarityInput,planWebQueries} from './web-similarity-model.mjs';
import {prepareAigcText,aigcDetectionLimits,aigcDetectionDefaults} from './aigc-detection-client.mjs';
import {randomUUID} from 'node:crypto';
import {digest} from './auth.mjs';
import {v1CommercialEnabled} from './v1-commercial-policy.mjs';
import {initializeCombinedDetection} from './combined-detection-ledger.mjs';
import {detectionPricing,assertDetectionPrice} from './detection-entitlements.mjs';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
export function createCombinedDetectionService(db,config,{aigc,similarity}){
 initializeCombinedDetection(db);const billing=config.billing;
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}};
 const own=(id,user)=>{const row=db.prepare("SELECT j.*,r.title FROM jobs j JOIN combined_detection_runs r ON r.id=j.id WHERE j.id=? AND j.user_id=?").get(id,user.id);if(!row)fail(404,'联合检测任务不存在。');return row;};
 const children=id=>db.prepare('SELECT c.service_key,j.id,j.status,j.error FROM combined_detection_children c JOIN jobs j ON j.id=c.child_id WHERE c.parent_id=?').all(id);
 function reconcile(id,user){const row=own(id,user),rows=children(id);if(row.status==='running'){
  const broken=rows.some(r=>['failed','cancelled'].includes(r.status)),complete=rows.length===2&&rows.every(r=>r.status==='completed');
  if(broken||complete)tx(()=>{db.prepare("UPDATE jobs SET status=?,stage=?,error=?,updated_at=? WHERE id=? AND status='running'").run(complete?'completed':'failed',complete?'completed':'failed',complete?null:'部分检测未能完成，已释放本次联合检测预占；已完成报告保留。',new Date().toISOString(),id);if(complete)billing.settle(id);else billing.release(id);});
 }return summary(own(id,user));}
 const summary=row=>({id:row.id,title:row.title,status:row.status,error:row.error||null,completed:children(row.id).filter(c=>c.status==='completed').length,children:children(row.id).map(c=>({id:c.id,kind:c.service_key==='detection-aigc'?'aigc':'similarity',status:c.status})),createdAt:row.created_at});
 // Recovery never replays provider calls. Existing child workers own recovery;
 // a parent whose launch was interrupted is released rather than charged twice.
 for(const p of db.prepare("SELECT j.id,j.user_id FROM jobs j WHERE j.type='detection_combined' AND j.status='running'").all()){
  if(children(p.id).length!==2)tx(()=>{db.prepare("UPDATE jobs SET status='failed',stage='interrupted',error='联合检测启动被中断，预占已释放。' WHERE id=?").run(p.id);billing.release(p.id);});else reconcile(p.id,{id:p.user_id});
 }
 const capabilities=()=>({ready:v1CommercialEnabled(db)&&detectionPricing(billing,'detection-combined').pricingMode==='paid'&&aigc.capabilities().ready&&similarity.capabilities().ready,...detectionPricing(billing,'detection-combined'),maxCharacters:20000});
 async function cancel(row,user){tx(()=>{db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',updated_at=? WHERE id=? AND status='running'").run(new Date().toISOString(),row.id);billing.release(row.id);});for(const c of children(row.id).filter(c=>['queued','preparing','running'].includes(c.status)))try{await(c.service_key==='detection-aigc'?aigc:similarity).handle({path:(c.service_key==='detection-aigc'?'/api/aigc-detections/':'/api/web-similarity/')+c.id+'/cancel',method:'POST',user,readBody:async()=>({expectedUserId:user.id})});}catch{}tx(()=>{db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',updated_at=? WHERE id=? AND status='running'").run(new Date().toISOString(),row.id);billing.release(row.id);});return summary(own(row.id,user));}
 return{capabilities,async handle({path,method,user,readBody}){
  const match=path.match(/^\/api\/combined-detections\/([-\w]{1,120})(\/cancel)?$/);if(path!=='/api/combined-detections'&&!match)return null;
  if(!user?.id)fail(401,'请先登录。');
  if(match){const row=own(match[1],user);if(method==='GET'&&!match[2])return{value:reconcile(row.id,user)};if(method==='POST'&&match[2]){const b=await readBody();if(b.expectedUserId!==user.id||Object.keys(b).some(k=>k!=='expectedUserId'))fail(409,'登录账户已变化。');return{value:await cancel(row,user)};}fail(405,'不支持的操作。');}
  if(method==='GET')return{value:{items:db.prepare("SELECT id FROM jobs WHERE user_id=? AND type='detection_combined' ORDER BY created_at DESC LIMIT 20").all(user.id).map(r=>reconcile(r.id,user))}};
  if(method!=='POST')fail(405,'不支持的操作。');const b=await readBody();
  if(Object.keys(b).some(k=>!['text','title','expectedUserId','idempotencyKey','pricingVersion','expectedCreditCost'].includes(k))||b.expectedUserId!==user.id)fail(409,'请求或登录账户已变化。');
  if(typeof b.text!=='string'||b.text.trim().length<50||Array.from(b.text).length>20000||typeof b.title!=='string'||b.title.length>200||/[\x00-\x1f\x7f]/.test(b.title)||!/^[-\w]{8,100}$/.test(b.idempotencyKey))fail(400,'请上传含 50～20,000 字符正文的 DOCX 论文。');
  b.text=b.text.trim();const normalized=webSimilarityInput({...b,consent:true},user);planWebQueries(normalized.parsed);prepareAigcText(b.text,aigcDetectionLimits(config)||aigcDetectionDefaults);
  const hash=digest(b.text),existing=db.prepare('SELECT id FROM combined_detection_runs WHERE user_id=? AND text_hash=?').get(user.id,hash);if(existing)return{value:reconcile(existing.id,user)};
  if(!capabilities().ready)fail(503,'联合检测当前不可用，请稍后再试。');assertDetectionPrice(b,billing,'detection-combined');
  if(db.prepare('SELECT 1 FROM jobs WHERE user_id=? AND idempotency_key=?').get(user.id,'combined:'+b.idempotencyKey))fail(409,'同一请求已用于其他原文，请重新提交本篇论文。');
  const id=randomUUID(),at=new Date().toISOString();tx(()=>{const quote=billing.quote(user,{type:'agent',serviceKey:'detection-combined'});db.prepare("INSERT INTO jobs(id,user_id,type,status,stage,input,idempotency_key,input_hash,attempt,created_at,updated_at) VALUES(?,?,'detection_combined','running','detecting','{}',?,?,1,?,?)").run(id,user.id,'combined:'+b.idempotencyKey,hash,at,at);db.prepare('INSERT INTO combined_detection_runs VALUES(?,?,?,?,?)').run(id,user.id,hash,b.title,at);billing.reserve(user,id,1,'agent',quote.token,'detection-combined');});
  try{
   for(const [key,service,path]of [['detection-similarity',similarity,'/api/web-similarity'],['detection-aigc',aigc,'/api/aigc-detections']]){
    const price=detectionPricing(billing,key);await service.handle({path,method:'POST',user,fundingParent:id,readBody:async()=>({text:b.text,title:b.title,consent:true,expectedUserId:user.id,idempotencyKey:id+'-'+key,pricingVersion:price.pricingVersion,expectedCreditCost:price.creditCost})});
   }
  }catch(e){await cancel(own(id,user),user);throw e;}
  return{status:202,value:reconcile(id,user)};
 }};
}
