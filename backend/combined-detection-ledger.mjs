import {digest} from './auth.mjs';
const fail=()=>{throw Object.assign(Error('联合检测预占或正文核验未通过，本次未继续检测。'),{status:409});};
export function initializeCombinedDetection(db){db.exec(`CREATE TABLE IF NOT EXISTS combined_detection_runs(id TEXT PRIMARY KEY REFERENCES jobs(id),user_id TEXT NOT NULL REFERENCES users(id),text_hash TEXT NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(user_id,text_hash));
 CREATE TABLE IF NOT EXISTS combined_detection_children(parent_id TEXT NOT NULL REFERENCES jobs(id),child_id TEXT NOT NULL REFERENCES jobs(id),service_key TEXT NOT NULL CHECK(service_key IN ('detection-aigc','detection-similarity')),PRIMARY KEY(parent_id,service_key));
 CREATE TRIGGER IF NOT EXISTS combined_children_no_update BEFORE UPDATE ON combined_detection_children BEGIN SELECT RAISE(ABORT,'联合检测关联不可修改'); END;
 CREATE TRIGGER IF NOT EXISTS combined_children_no_delete BEFORE DELETE ON combined_detection_children BEGIN SELECT RAISE(ABORT,'联合检测关联不可删除'); END;`);}
export function combinedHeld(db,userId,parentId){return Boolean(db.prepare("SELECT 1 FROM jobs j JOIN billing_reservations r ON r.job_id=j.id AND r.user_id=j.user_id WHERE j.id=? AND j.user_id=? AND j.type='detection_combined' AND j.status='running' AND r.status='held' AND r.service_key='detection-combined' AND r.type='agent'").get(parentId,userId));}
export function attachCombinedChild(db,{parentId,userId,childId,key,text}){
 const parent=db.prepare('SELECT text_hash FROM combined_detection_runs WHERE id=? AND user_id=?').get(parentId,userId);
 if(!parent||parent.text_hash!==digest(text)||!combinedHeld(db,userId,parentId))fail();
 const child=db.prepare('SELECT user_id,type FROM jobs WHERE id=?').get(childId);
 if(!child||child.user_id!==userId||child.type!==({'detection-aigc':'aigc_detection','detection-similarity':'web_similarity'})[key])fail();
 db.prepare('INSERT OR IGNORE INTO combined_detection_children VALUES(?,?,?)').run(parentId,childId,key);
 if(db.prepare('SELECT child_id FROM combined_detection_children WHERE parent_id=? AND service_key=?').get(parentId,key)?.child_id!==childId)fail();
}
export function combinedChildFunded(db,userId,childId,key,{heldOnly=true}={}){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='combined_detection_children'").get())return false;
 return Boolean(db.prepare(`SELECT 1 FROM combined_detection_children c JOIN combined_detection_runs p ON p.id=c.parent_id AND p.user_id=? JOIN billing_reservations r ON r.job_id=p.id AND r.user_id=p.user_id AND r.service_key='detection-combined' AND r.type='agent' WHERE c.child_id=? AND c.service_key=? AND r.status IN (${heldOnly?"'held'":"'held','settled','released'"})`).get(userId,childId,key));
}
export function reconcileCombinedParents(db,billing,childId){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='combined_detection_children'").get())return;
 for(const row of db.prepare("SELECT DISTINCT j.id FROM combined_detection_children c JOIN jobs j ON j.id=c.parent_id WHERE c.child_id=? AND j.status='running'").all(childId)){
  const rows=db.prepare('SELECT j.status FROM combined_detection_children c JOIN jobs j ON j.id=c.child_id WHERE c.parent_id=?').all(row.id),done=rows.length===2&&rows.every(c=>c.status==='completed'),broken=rows.some(c=>['failed','cancelled'].includes(c.status));
  if(done||broken){db.prepare("UPDATE jobs SET status=?,stage=?,error=?,updated_at=? WHERE id=? AND status='running'").run(done?'completed':'failed',done?'completed':'failed',done?null:'部分检测未能完成，本次联合检测预占已释放，已完成报告保留。',new Date().toISOString(),row.id);if(done)billing.settle(row.id);else billing.release(row.id);}
 }
}
