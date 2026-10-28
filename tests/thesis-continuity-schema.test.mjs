import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createThesisContinuity} from '../backend/thesis-continuity.mjs';
import {migrateThesisTokenCeiling} from '../backend/thesis-continuity-schema.mjs';

function legacy(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY);
 CREATE TABLE theses(id TEXT PRIMARY KEY,user_id TEXT,current_run_id TEXT,status TEXT);
 CREATE TABLE thesis_runs(id TEXT PRIMARY KEY,thesis_id TEXT,user_id TEXT,attempt INTEGER,status TEXT,settings_version TEXT);
 INSERT INTO users VALUES('alice');
 INSERT INTO theses VALUES('thesis-a','alice','run-a','running');
 INSERT INTO thesis_runs VALUES('run-a','thesis-a','alice',1,'running','saved-v1');
 CREATE TABLE thesis_execution_budgets(
  run_id TEXT NOT NULL REFERENCES thesis_runs(id),attempt INTEGER NOT NULL CHECK(attempt>=1),
  user_id TEXT NOT NULL REFERENCES users(id),settings_version TEXT NOT NULL,unit_ids TEXT NOT NULL,review_allowance INTEGER NOT NULL CHECK(review_allowance>=1 AND review_allowance<=24),
  token_limit INTEGER NOT NULL CHECK(token_limit>=1000 AND token_limit<=2000000),
  cost_limit_micros INTEGER NOT NULL CHECK(cost_limit_micros>=10000 AND cost_limit_micros<=50000000),unit_cost_micros INTEGER NOT NULL CHECK(unit_cost_micros>=10000 AND unit_cost_micros<=5000000),
  recoveries INTEGER NOT NULL DEFAULT 0,last_recovery_dispatch_count INTEGER NOT NULL DEFAULT -1,last_reason TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(run_id,attempt));
 INSERT INTO thesis_execution_budgets VALUES('run-a',1,'alice','saved-v1','["u-1","u-2"]',1,2000000,3000000,1000000,0,-1,'turn_limit','2026-01-01','2026-01-01');
 CREATE TABLE thesis_execution_dispatches(
  id TEXT PRIMARY KEY,run_id TEXT NOT NULL,attempt INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),unit_id TEXT NOT NULL,kind TEXT NOT NULL,unit_attempt INTEGER NOT NULL,status TEXT NOT NULL,
  reserved_tokens INTEGER NOT NULL,reserved_cost_micros INTEGER NOT NULL,charged_tokens INTEGER NOT NULL,charged_cost_micros INTEGER NOT NULL,input_tokens INTEGER,output_tokens INTEGER,cost_micros INTEGER,error_code TEXT,created_at TEXT NOT NULL,finished_at TEXT,
  FOREIGN KEY(run_id,attempt) REFERENCES thesis_execution_budgets(run_id,attempt),UNIQUE(run_id,attempt,kind,unit_id,unit_attempt));
 INSERT INTO thesis_execution_dispatches VALUES('saved-dispatch','run-a',1,'alice','u-1','section',1,'completed',480000,1000000,156801,368722,149006,7795,368722,NULL,'2026-01-01','2026-01-01');
 CREATE INDEX legacy_budget_owner ON thesis_execution_budgets(user_id);
 CREATE TRIGGER legacy_audit_no_delete BEFORE DELETE ON thesis_execution_budgets BEGIN SELECT RAISE(ABORT,'legacy immutable audit'); END;`);
 return db;
}

test('token-ceiling migration preserves legacy budgets, settled dispatches, foreign keys and audit schema byte for byte',t=>{
 const db=legacy(t),budgets=db.prepare('SELECT * FROM thesis_execution_budgets').all(),dispatches=db.prepare('SELECT * FROM thesis_execution_dispatches').all(),schema=db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='thesis_execution_budgets' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name").all();
 assert.equal(migrateThesisTokenCeiling(db),true);
 assert.deepEqual(db.prepare('SELECT * FROM thesis_execution_budgets').all(),budgets);assert.deepEqual(db.prepare('SELECT * FROM thesis_execution_dispatches').all(),dispatches);
 assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name='thesis_execution_budgets' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name").all(),schema);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(migrateThesisTokenCeiling(db),false);
 const ledger=createThesisContinuity(db),run=db.prepare('SELECT * FROM thesis_runs').get();
 assert.equal(ledger.summary(run).tokenLimit,2000000);assert.equal(ledger.summary(run).usedTokens,156801);assert.equal(ledger.summary(run).usedCostUsd,.368722);
 assert.throws(()=>db.prepare('UPDATE thesis_execution_budgets SET token_limit=10000000').run(),/不可扩展/);assert.throws(()=>db.prepare('UPDATE thesis_execution_dispatches SET charged_tokens=0').run(),/不可修改/);assert.throws(()=>db.prepare('DELETE FROM thesis_execution_budgets').run(),/immutable|不可删除/);
 db.prepare('UPDATE thesis_runs SET attempt=2').run();
 const next=ledger.ensure({...run,attempt:2},{profile:{targetWords:20000}},[{id:'u-1'}],{version:'saved-v1',maxCostUsd:1,maxTurns:12,maxOutputTokens:4096});assert.equal(next.created,true);
 assert.equal(db.prepare('SELECT token_limit FROM thesis_execution_budgets WHERE attempt=1').get().token_limit,2000000);
});

test('failed migration rolls back all table, row and trigger changes and restores foreign-key enforcement',t=>{
 const db=legacy(t);db.exec("PRAGMA foreign_keys=OFF; UPDATE thesis_runs SET id='orphaned-run'; PRAGMA foreign_keys=ON;");
 const before=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name").all(),budgets=db.prepare('SELECT * FROM thesis_execution_budgets').all();
 assert.throws(()=>migrateThesisTokenCeiling(db),/校验失败/);
 assert.deepEqual(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name").all(),before);assert.deepEqual(db.prepare('SELECT * FROM thesis_execution_budgets').all(),budgets);assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
});

test('migration refuses an existing transaction instead of weakening its foreign keys or committing caller work',t=>{
 const db=legacy(t);db.exec('BEGIN IMMEDIATE;');assert.throws(()=>migrateThesisTokenCeiling(db),/事务外/);assert.equal(db.isTransaction,true);db.exec('ROLLBACK;');assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
});
