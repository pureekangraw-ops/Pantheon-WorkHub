CREATE TABLE tasks (
 task_id TEXT PRIMARY KEY,
 status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','FAILED','NEEDS_RECONCILIATION')),
 request_text TEXT NOT NULL,
 request_sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 latest_run_id TEXT,
 last_error TEXT
);
CREATE TABLE runs (
 run_id TEXT PRIMARY KEY,
 task_id TEXT NOT NULL REFERENCES tasks(task_id),
 status TEXT NOT NULL,
 started_at TEXT NOT NULL,
 finished_at TEXT
);
CREATE TABLE actions (
 action_key TEXT PRIMARY KEY,
 task_id TEXT NOT NULL UNIQUE REFERENCES tasks(task_id),
 tool_name TEXT NOT NULL,
 input_sha256 TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PREPARED','REQUESTED','EFFECT_RECORDED','VERIFIED')),
 receipt_sha256 TEXT
);
CREATE TABLE artifacts (
 action_key TEXT PRIMARY KEY REFERENCES actions(action_key),
 task_id TEXT NOT NULL REFERENCES tasks(task_id),
 content TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE events (
 event_id TEXT PRIMARY KEY,
 task_id TEXT NOT NULL REFERENCES tasks(task_id),
 run_id TEXT,
 type TEXT NOT NULL,
 actor TEXT NOT NULL,
 details_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE factory_jobs (task_id TEXT PRIMARY KEY REFERENCES tasks(task_id),status TEXT NOT NULL CHECK(status IN ('QUEUED','DISPATCHING','NEEDS_RECONCILIATION','COMPLETED')),receipt_id TEXT UNIQUE,source_sha TEXT,result_json TEXT,result_sha256 TEXT,last_error TEXT,updated_at TEXT NOT NULL);
