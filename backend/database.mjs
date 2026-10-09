import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export function database(path){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));const columns=new Set(db.prepare('PRAGMA table_info(files)').all().map(v=>v.name));for(const [name,type] of [['storage_provider',"TEXT NOT NULL DEFAULT 'local_server_sqlite'"],['storage_key','TEXT'],['storage_bucket','TEXT']])if(!columns.has(name))db.exec(`ALTER TABLE files ADD COLUMN ${name} ${type}`);for(const [id,title] of [['basic','基础会员'],['advanced','进阶会员'],['premium','尊享会员']])db.prepare('INSERT OR IGNORE INTO products VALUES(?,?,?,?)').run(id,title,'preview',JSON.stringify({unit:null,quota:null,duration:null,paymentEnabled:false}));return db;}
export const now=()=>new Date().toISOString();
