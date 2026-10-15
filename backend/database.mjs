import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
function migrateUsers(db,path){
  const columns=db.prepare('PRAGMA table_info(users)').all();
  if(!columns.some(column=>['email','password_hash'].includes(column.name)&&column.notnull))return;
  const expected=['id','email','name','password_hash','role','created_at'];
  if(columns.length!==expected.length||columns.some((column,index)=>column.name!==expected[index])){
    throw new Error('账号数据库结构与迁移版本不符，已保留原数据库');
  }
  // VACUUM INTO includes committed WAL contents, unlike a raw database-file copy.
  if(path!==':memory:'){
    const backup=`${path}.before-auth-${Date.now()}.sqlite`;
    db.prepare('VACUUM INTO ?').run(backup);
    chmodSync(backup,0o600);
  }
  const extraSchema=db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='users' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  const oldCount=db.prepare('SELECT count(*) n FROM users').get().n;
  // Never rename the old table: SQLite would rewrite foreign keys to that name.
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
  try{
    db.exec(`CREATE TABLE users_auth_migration(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT NOT NULL,password_hash TEXT,role TEXT NOT NULL DEFAULT 'user',created_at TEXT NOT NULL);
      INSERT INTO users_auth_migration(id,email,name,password_hash,role,created_at) SELECT id,email,name,password_hash,role,created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_auth_migration RENAME TO users;`);
    for(const item of extraSchema)db.exec(item.sql);
    if(db.prepare('SELECT count(*) n FROM users').get().n!==oldCount||db.prepare('PRAGMA foreign_key_check').all().length){
      throw new Error('账号数据库迁移校验失败，已回滚');
    }
    db.exec('COMMIT;');
  }catch(error){
    db.exec('ROLLBACK;');
    throw error;
  }finally{
    db.exec('PRAGMA foreign_keys=ON;');
  }
}

export function database(path){
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const db=new DatabaseSync(path);
  try{
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
    migrateUsers(db,path);
    db.prepare(`INSERT OR IGNORE INTO auth_identities(channel,address,user_id,verified_at,created_at)
      SELECT 'email',lower(email),id,NULL,created_at FROM users WHERE email IS NOT NULL`).run();
    const columns=new Set(db.prepare('PRAGMA table_info(files)').all().map(value=>value.name));
    for(const [name,type] of [['storage_provider',"TEXT NOT NULL DEFAULT 'local_server_sqlite'"],['storage_key','TEXT'],['storage_bucket','TEXT']]){
      if(!columns.has(name))db.exec(`ALTER TABLE files ADD COLUMN ${name} ${type}`);
    }
    for(const [id,title] of [['basic','基础会员'],['advanced','进阶会员'],['premium','尊享会员']]){
      db.prepare('INSERT OR IGNORE INTO products VALUES(?,?,?,?)').run(id,title,'preview',JSON.stringify({unit:null,quota:null,duration:null,paymentEnabled:false}));
    }
    // The owner approved these recharge tiers. Existing edits are never reset on startup.
    for(const amount of [200,500,1000]){
      db.prepare('INSERT OR IGNORE INTO products(id,title,status,rules) VALUES(?,?,?,?)').run(`credits-${amount}`,`${amount} 科研积分`,'active',JSON.stringify({priceCents:amount*10,durationDays:null,creditAmount:amount,description:`支付成功后向当前账户充值 ${amount} 科研积分。积分消费服务尚未开放，当前不会自动扣除积分。`,entitlementType:'credits',paymentEnabled:true}));
    }
    db.exec(`CREATE TABLE IF NOT EXISTS payment_credit_ledger(
      order_id TEXT PRIMARY KEY REFERENCES orders(id),user_id TEXT NOT NULL REFERENCES users(id),
      product_id TEXT NOT NULL REFERENCES products(id),amount INTEGER NOT NULL CHECK(amount>0 AND amount<=1000000),
      kind TEXT NOT NULL CHECK(kind='purchase'),created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS payment_credit_ledger_owner ON payment_credit_ledger(user_id,created_at);
    CREATE TRIGGER IF NOT EXISTS payment_credit_ledger_no_update BEFORE UPDATE ON payment_credit_ledger
      BEGIN SELECT RAISE(ABORT,'积分记录不可修改'); END;
    CREATE TRIGGER IF NOT EXISTS payment_credit_ledger_no_delete BEFORE DELETE ON payment_credit_ledger
      BEGIN SELECT RAISE(ABORT,'积分记录不可删除'); END;`);
    return db;
  }catch(error){
    db.close();
    throw error;
  }
}
export const now=()=>new Date().toISOString();
