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
      const description=`支付成功后向当前账户充值 ${amount} 科研积分，用于已开放的计费任务。提交前确认，成功扣减；失败或取消释放预占。`;
      db.prepare('INSERT OR IGNORE INTO products(id,title,status,rules) VALUES(?,?,?,?)').run(`credits-${amount}`,`${amount} 科研积分`,'active',JSON.stringify({priceCents:amount*10,durationDays:null,creditAmount:amount,description,entitlementType:'credits',paymentEnabled:true}));
      // Only update the exact obsolete seed copy. Preserve every merchant edit and paid order snapshot.
      const existing=db.prepare('SELECT rules FROM products WHERE id=?').get(`credits-${amount}`);let rules;try{rules=JSON.parse(existing.rules);}catch{}
      if(rules?.entitlementType==='credits'&&rules.creditAmount===amount&&rules.description===`支付成功后向当前账户充值 ${amount} 科研积分。积分消费服务尚未开放，当前不会自动扣除积分。`){rules.description=description;db.prepare('UPDATE products SET rules=? WHERE id=?').run(JSON.stringify(rules),`credits-${amount}`);}
    }
    // Reference bundles stay unpublished until an administrator confirms delivery and validity.
    const checks=[['similarity-check','旗舰版查重',2],['aigc-check','AIGC 检测',2],['revision-advice','修改建议',2]];
    const bundleSeeds=[
      ['rewrite','强力查降套餐',9900,[...checks,['reduce-duplication','一键强力降重',2]]],
      ['reduce','超值降 AI 套餐',12900,[...checks,['reduce-aigc','一键降 AIGC',2]]],
      ['dual','AIGC+重复率双降套餐',15900,[...checks,['reduce-dual','AIGC+重复率双降',2]]]
    ];
    for(const [level,title,price,edits] of [['junior','专科',15900,5],['bachelor','本科',23900,7],['master','硕士',36900,10],['doctor','博士',48900,15]]){
      bundleSeeds.push([level,`${title}写作套餐`,price,[[`thesis-${level}`,`毕业论文-${title}`,1],['proposal-ppt','开题 PPT',1],['online-revision','在线修改',edits],[`taskbook-${level}`,`任务书-${title}`,1],[`proposal-${level}`,`开题报告-${title}`,1],[`literature-review-${level}`,`文献综述-${title}`,1],['defense-ppt-basic','答辩 PPT 基础版',1]]]);
    }
    for(const [id,title,priceCents,items] of bundleSeeds){
      db.prepare('INSERT OR IGNORE INTO products(id,title,status,rules) VALUES(?,?,?,?)').run(`bundle-${id}`,title,'preview',JSON.stringify({priceCents,durationDays:null,bundleItems:items.map(([key,title,quantity])=>({key,title,quantity})),description:'参考方案，服务范围、有效期与交付规则待确认；当前未上架销售。',entitlementType:'bundle',paymentEnabled:false}));
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
      BEGIN SELECT RAISE(ABORT,'积分记录不可删除'); END;
    CREATE TABLE IF NOT EXISTS payment_bundle_entitlements(
      order_id TEXT PRIMARY KEY REFERENCES orders(id),user_id TEXT NOT NULL REFERENCES users(id),
      product_id TEXT NOT NULL REFERENCES products(id),starts_at TEXT NOT NULL,expires_at TEXT NOT NULL,
      granted_at TEXT NOT NULL,items TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS payment_bundle_entitlements_owner ON payment_bundle_entitlements(user_id,expires_at);`);
    return db;
  }catch(error){
    db.close();
    throw error;
  }
}
export const now=()=>new Date().toISOString();
