PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT NOT NULL,password_hash TEXT,role TEXT NOT NULL DEFAULT 'user',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,degree TEXT NOT NULL,major TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),project_id TEXT REFERENCES projects(id),name TEXT NOT NULL,kind TEXT NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,body BLOB NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),project_id TEXT REFERENCES projects(id),type TEXT NOT NULL,status TEXT NOT NULL,stage TEXT NOT NULL,input TEXT NOT NULL,error TEXT,result_id TEXT,attempt INTEGER NOT NULL DEFAULT 0,idempotency_key TEXT NOT NULL,input_hash TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,idempotency_key));
CREATE TABLE IF NOT EXISTS results(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),project_id TEXT REFERENCES projects(id),job_id TEXT UNIQUE REFERENCES jobs(id),type TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),job_id TEXT UNIQUE REFERENCES jobs(id),provider TEXT NOT NULL,model TEXT NOT NULL,input_tokens INTEGER,output_tokens INTEGER,billable INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,title TEXT NOT NULL,status TEXT NOT NULL,rules TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),product_id TEXT NOT NULL REFERENCES products(id),status TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),category TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,created_at);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(user_id,updated_at);
CREATE INDEX IF NOT EXISTS results_owner ON results(user_id,created_at);
CREATE TABLE IF NOT EXISTS result_revisions(id TEXT PRIMARY KEY,result_id TEXT NOT NULL REFERENCES results(id),user_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS service_settings(name TEXT PRIMARY KEY,value TEXT NOT NULL,updated_by TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS auth_identities(
  channel TEXT NOT NULL CHECK(channel IN ('email','phone')),
  address TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(channel,address),
  UNIQUE(user_id,channel)
);
CREATE TABLE IF NOT EXISTS auth_challenges(
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK(channel IN ('email','phone')),
  address TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('login','register','reset')),
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','sent','failed','superseded','consumed','locked')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  delivered_at INTEGER,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS auth_challenge_address ON auth_challenges(channel,address,created_at);
CREATE INDEX IF NOT EXISTS auth_challenge_expiry ON auth_challenges(expires_at);
CREATE TABLE IF NOT EXISTS auth_rate_limits(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS auth_rate_expiry ON auth_rate_limits(reset_at);

CREATE TABLE IF NOT EXISTS feedback_management(
  feedback_id TEXT PRIMARY KEY REFERENCES feedback(id),
  status TEXT NOT NULL CHECK(status IN ('open','processing','resolved')),
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_management_status ON feedback_management(status,updated_at);
CREATE TABLE IF NOT EXISTS admin_audit(
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_audit_created ON admin_audit(created_at);

CREATE TABLE IF NOT EXISTS payment_config_versions(
  id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider IN ('wechat','alipay')),
  sealed_settings TEXT NOT NULL,identity_hash TEXT NOT NULL,verification_id TEXT,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_channels(
  provider TEXT PRIMARY KEY CHECK(provider IN ('wechat','alipay')),
  version_id TEXT NOT NULL REFERENCES payment_config_versions(id),enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_orders(
  order_id TEXT PRIMARY KEY REFERENCES orders(id),provider TEXT NOT NULL CHECK(provider IN ('wechat','alipay')),
  out_trade_no TEXT NOT NULL UNIQUE,config_id TEXT NOT NULL REFERENCES payment_config_versions(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),currency TEXT NOT NULL DEFAULT 'CNY',
  title TEXT NOT NULL,entitlement TEXT NOT NULL,idempotency_key TEXT NOT NULL,input_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),qr_content TEXT,provider_trade_no TEXT,
  expires_at TEXT NOT NULL,paid_at TEXT,updated_at TEXT NOT NULL,last_queried_at INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,UNIQUE(user_id,idempotency_key),UNIQUE(provider,provider_trade_no)
);
CREATE INDEX IF NOT EXISTS payment_orders_owner ON payment_orders(user_id,updated_at);
CREATE TABLE IF NOT EXISTS payment_entitlements(
  order_id TEXT PRIMARY KEY REFERENCES orders(id),user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),type TEXT NOT NULL,
  starts_at TEXT NOT NULL,expires_at TEXT NOT NULL,granted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_entitlements_owner ON payment_entitlements(user_id,expires_at);
