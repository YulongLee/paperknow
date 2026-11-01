export function initializeCreditCodes(db){
 db.exec(`CREATE TABLE IF NOT EXISTS credit_code_batches(
  id TEXT PRIMARY KEY,name TEXT NOT NULL,credit_amount INTEGER NOT NULL CHECK(credit_amount BETWEEN 1 AND 1000000),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 200),expires_at TEXT NOT NULL,sealed_codes TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),command_id TEXT NOT NULL,input_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,revoked_at TEXT,revoked_by TEXT REFERENCES users(id),revoke_reason TEXT,
  UNIQUE(actor_id,command_id),CHECK(credit_amount*quantity<=10000000)
 );
 CREATE TABLE IF NOT EXISTS credit_codes(
  id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES credit_code_batches(id),code_hash TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','redeemed','revoked')),
  version INTEGER NOT NULL DEFAULT 1,revoked_at TEXT,revoked_by TEXT REFERENCES users(id),revoke_reason TEXT
 );
 CREATE INDEX IF NOT EXISTS credit_codes_batch ON credit_codes(batch_id,status,id);
 CREATE TABLE IF NOT EXISTS credit_code_redemptions(
  id TEXT PRIMARY KEY,code_id TEXT NOT NULL UNIQUE REFERENCES credit_codes(id),user_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000),created_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS credit_code_redemptions_owner ON credit_code_redemptions(user_id,created_at DESC,id DESC);
 CREATE TABLE IF NOT EXISTS credit_code_commands(
  actor_id TEXT NOT NULL REFERENCES users(id),command_id TEXT NOT NULL,input_hash TEXT NOT NULL,
  action TEXT NOT NULL,target_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(actor_id,command_id)
 );
 CREATE TABLE IF NOT EXISTS credit_code_rate_limits(
  scope TEXT NOT NULL,subject TEXT NOT NULL,window_start INTEGER NOT NULL,attempts INTEGER NOT NULL,
  PRIMARY KEY(scope,subject,window_start)
 );
 CREATE INDEX IF NOT EXISTS credit_code_rate_limits_window ON credit_code_rate_limits(window_start);
 CREATE TRIGGER IF NOT EXISTS credit_code_batch_protect BEFORE UPDATE ON credit_code_batches
 WHEN NEW.id IS NOT OLD.id OR NEW.name IS NOT OLD.name OR NEW.credit_amount IS NOT OLD.credit_amount
 OR NEW.quantity IS NOT OLD.quantity OR NEW.expires_at IS NOT OLD.expires_at OR NEW.sealed_codes IS NOT OLD.sealed_codes
 OR NEW.actor_id IS NOT OLD.actor_id OR NEW.command_id IS NOT OLD.command_id OR NEW.input_hash IS NOT OLD.input_hash
 OR NEW.created_at IS NOT OLD.created_at OR OLD.status!='active' OR NEW.status!='revoked'
 OR NEW.version!=OLD.version+1 OR NEW.revoked_by IS NULL OR NEW.revoked_at IS NULL OR NEW.revoke_reason IS NULL
 BEGIN SELECT RAISE(ABORT,'兑换码批次内容不可修改'); END;
 CREATE TRIGGER IF NOT EXISTS credit_code_protect BEFORE UPDATE ON credit_codes
 WHEN NEW.id IS NOT OLD.id OR NEW.batch_id IS NOT OLD.batch_id OR NEW.code_hash IS NOT OLD.code_hash OR NEW.hint IS NOT OLD.hint
 OR OLD.status!='active' OR NEW.status NOT IN ('redeemed','revoked') OR NEW.version!=OLD.version+1
 OR (NEW.status='revoked' AND (NEW.revoked_at IS NULL OR NEW.revoked_by IS NULL OR NEW.revoke_reason IS NULL))
 OR (NEW.status='redeemed' AND (NEW.revoked_at IS NOT OLD.revoked_at OR NEW.revoked_by IS NOT OLD.revoked_by OR NEW.revoke_reason IS NOT OLD.revoke_reason))
 BEGIN SELECT RAISE(ABORT,'兑换码内容与已处理状态不可修改'); END;
 CREATE TRIGGER IF NOT EXISTS credit_code_batches_no_delete BEFORE DELETE ON credit_code_batches BEGIN SELECT RAISE(ABORT,'兑换码批次不可删除'); END;
 CREATE TRIGGER IF NOT EXISTS credit_codes_no_delete BEFORE DELETE ON credit_codes BEGIN SELECT RAISE(ABORT,'兑换码不可删除'); END;
 CREATE TRIGGER IF NOT EXISTS credit_code_redemptions_no_update BEFORE UPDATE ON credit_code_redemptions BEGIN SELECT RAISE(ABORT,'兑换积分流水不可修改'); END;
 CREATE TRIGGER IF NOT EXISTS credit_code_redemptions_validate BEFORE INSERT ON credit_code_redemptions
 WHEN NOT EXISTS(SELECT 1 FROM credit_codes c JOIN credit_code_batches b ON b.id=c.batch_id WHERE c.id=NEW.code_id AND c.status='redeemed' AND b.credit_amount=NEW.amount)
 BEGIN SELECT RAISE(ABORT,'兑换码与积分流水不一致'); END;
 CREATE TRIGGER IF NOT EXISTS credit_code_redemptions_no_delete BEFORE DELETE ON credit_code_redemptions BEGIN SELECT RAISE(ABORT,'兑换积分流水不可删除'); END;
 CREATE TRIGGER IF NOT EXISTS credit_code_commands_no_update BEFORE UPDATE ON credit_code_commands BEGIN SELECT RAISE(ABORT,'兑换码管理记录不可修改'); END;
 CREATE TRIGGER IF NOT EXISTS credit_code_commands_no_delete BEFORE DELETE ON credit_code_commands BEGIN SELECT RAISE(ABORT,'兑换码管理记录不可删除'); END;`);
}
export const creditCodeTotal=(db,userId)=>db.prepare('SELECT COALESCE(sum(amount),0) n FROM credit_code_redemptions WHERE user_id=?').get(userId).n;
export const creditCodeLedger=(db,userId)=>db.prepare(`SELECT r.id,r.amount,r.created_at AS createdAt,c.hint AS codeHint FROM credit_code_redemptions r JOIN credit_codes c ON c.id=r.code_id WHERE r.user_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 100`).all(userId).map(row=>({...row,id:'redemption:'+row.id,title:'积分兑换码到账',kind:'redeem',origin:'redemption',source:'credits',heldDelta:0,jobId:null}));
