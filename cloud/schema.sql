-- Pantheon WorkHub dedicated D1 schema. Do not apply to other applications' databases.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS tasks (
 task_id TEXT PRIMARY KEY,
 status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','FAILED','NEEDS_RECONCILIATION')),
 request_text TEXT NOT NULL,
 request_sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 latest_run_id TEXT,
 last_error TEXT
);
CREATE TABLE IF NOT EXISTS runs (
 run_id TEXT PRIMARY KEY,
 task_id TEXT NOT NULL REFERENCES tasks(task_id),
 status TEXT NOT NULL,
 started_at TEXT NOT NULL,
 finished_at TEXT
);
CREATE TABLE IF NOT EXISTS actions (
 action_key TEXT PRIMARY KEY,
 task_id TEXT NOT NULL UNIQUE REFERENCES tasks(task_id),
 tool_name TEXT NOT NULL,
 input_sha256 TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PREPARED','REQUESTED','EFFECT_RECORDED','VERIFIED')),
 receipt_sha256 TEXT
);
CREATE TABLE IF NOT EXISTS artifacts (
 action_key TEXT PRIMARY KEY REFERENCES actions(action_key),
 task_id TEXT NOT NULL REFERENCES tasks(task_id),
 content TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
 event_id TEXT PRIMARY KEY,
 task_id TEXT NOT NULL REFERENCES tasks(task_id),
 run_id TEXT,
 type TEXT NOT NULL,
 actor TEXT NOT NULL,
 details_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id,created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
CREATE TRIGGER IF NOT EXISTS protect_events_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT,'audit events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS protect_events_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT,'audit events are append-only'); END;
