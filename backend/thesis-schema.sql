CREATE TABLE IF NOT EXISTS theses(
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),project_id TEXT REFERENCES projects(id),
 title TEXT NOT NULL,snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 status TEXT NOT NULL DEFAULT 'draft',current_run_id TEXT,client_key TEXT,input_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,client_key)
);
CREATE INDEX IF NOT EXISTS theses_owner ON theses(user_id,updated_at);
CREATE TABLE IF NOT EXISTS thesis_runs(
 id TEXT PRIMARY KEY REFERENCES jobs(id),thesis_id TEXT NOT NULL REFERENCES theses(id),user_id TEXT NOT NULL REFERENCES users(id),
 snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,plan TEXT NOT NULL,settings_version TEXT NOT NULL,settings_meta TEXT NOT NULL,
 status TEXT NOT NULL,stage TEXT NOT NULL,error TEXT,attempt INTEGER NOT NULL DEFAULT 1 CHECK(attempt>=1),
 result_id TEXT,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,
 usage_known INTEGER NOT NULL DEFAULT 1 CHECK(usage_known IN (0,1)),provider_calls INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS thesis_runs_queue ON thesis_runs(status,created_at);
CREATE INDEX IF NOT EXISTS thesis_runs_owner ON thesis_runs(user_id,thesis_id,created_at);
CREATE TABLE IF NOT EXISTS thesis_commands(
 user_id TEXT NOT NULL REFERENCES users(id),client_key TEXT NOT NULL,thesis_id TEXT NOT NULL REFERENCES theses(id),
 run_id TEXT NOT NULL REFERENCES thesis_runs(id),input_hash TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,client_key)
);
CREATE TABLE IF NOT EXISTS thesis_checkpoints(
 run_id TEXT NOT NULL REFERENCES thesis_runs(id),unit_id TEXT NOT NULL,chapter_id TEXT NOT NULL,position INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',text TEXT NOT NULL DEFAULT '',source_ids TEXT NOT NULL DEFAULT '[]',
 missing_evidence TEXT NOT NULL DEFAULT '[]',error TEXT,engine TEXT,model TEXT,trace TEXT NOT NULL DEFAULT '[]',
 input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(run_id,unit_id)
);
CREATE TABLE IF NOT EXISTS thesis_chapter_versions(
 id TEXT PRIMARY KEY,thesis_id TEXT NOT NULL REFERENCES theses(id),chapter_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),
 run_id TEXT REFERENCES thesis_runs(id),source TEXT NOT NULL CHECK(source IN ('generated','manual','imported')),
 text TEXT NOT NULL,source_ids TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,
 UNIQUE(thesis_id,chapter_id,version)
);
CREATE INDEX IF NOT EXISTS thesis_chapter_history ON thesis_chapter_versions(thesis_id,chapter_id,version);
CREATE UNIQUE INDEX IF NOT EXISTS thesis_chapter_generated_run ON thesis_chapter_versions(run_id,chapter_id) WHERE source='generated';
CREATE TRIGGER IF NOT EXISTS thesis_chapter_history_no_update BEFORE UPDATE ON thesis_chapter_versions
 BEGIN SELECT RAISE(ABORT,'论文章节历史不可覆盖'); END;
CREATE TRIGGER IF NOT EXISTS thesis_chapter_history_no_delete BEFORE DELETE ON thesis_chapter_versions
 BEGIN SELECT RAISE(ABORT,'论文章节历史不可删除'); END;
