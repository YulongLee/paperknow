import {thesisRunTokenCeiling} from './thesis-execution-policy.mjs';

// SQLite cannot alter a CHECK constraint. Rebuild only this parent table,
// without renaming the old table (which would rewrite child foreign keys).
// Existing frozen ceilings, dispatches, identities and audit triggers survive.
export function migrateThesisTokenCeiling(db){
 const saved=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='thesis_execution_budgets'").get();
 if(!saved||! /token_limit\s*<=\s*2000000\b/i.test(saved.sql))return false;
 if(db.isTransaction)throw new Error('论文预算结构升级必须在事务外初始化');
 const extra=db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='thesis_execution_budgets' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
 const foreignKeys=db.prepare('PRAGMA foreign_keys').get().foreign_keys;
 const definition=saved.sql.slice(saved.sql.indexOf('(')).replace(/token_limit\s*<=\s*2000000\b/i,`token_limit<=${thesisRunTokenCeiling}`);
 db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
 try{
  const before=db.prepare('SELECT count(*) n FROM thesis_execution_budgets').get().n;
  db.exec(`CREATE TABLE thesis_execution_budgets_token_migration ${definition};
   INSERT INTO thesis_execution_budgets_token_migration SELECT * FROM thesis_execution_budgets;
   DROP TABLE thesis_execution_budgets;
   ALTER TABLE thesis_execution_budgets_token_migration RENAME TO thesis_execution_budgets;`);
  for(const item of extra)db.exec(item.sql);
  if(db.prepare('SELECT count(*) n FROM thesis_execution_budgets').get().n!==before||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('论文预算结构升级校验失败，已保留原始记录');
  db.exec('COMMIT;');
  return true;
 }catch(error){db.exec('ROLLBACK;');throw error;}
 finally{db.exec(`PRAGMA foreign_keys=${foreignKeys?'ON':'OFF'};`);}
}
