import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export function database(path){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));for(const [id,title] of [['basic','基础会员'],['advanced','进阶会员'],['premium','尊享会员']])db.prepare('INSERT OR IGNORE INTO products VALUES(?,?,?,?)').run(id,title,'preview',JSON.stringify({unit:null,quota:null,duration:null,paymentEnabled:false}));return db;}
export const now=()=>new Date().toISOString();
