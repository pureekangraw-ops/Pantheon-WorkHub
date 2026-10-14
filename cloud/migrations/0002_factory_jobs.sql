
-- Factory dispatch ledger. Claims are durable before external calls.
CREATE TABLE IF NOT EXISTS factory_jobs (
 task_id TEXT PRIMARY KEY REFERENCES tasks(task_id),
 status TEXT NOT NULL CHECK(status IN ('QUEUED','DISPATCHING','NEEDS_RECONCILIATION','COMPLETED')),
 receipt_id TEXT UNIQUE,
 source_sha TEXT,
 result_json TEXT,
 result_sha256 TEXT,
 last_error TEXT,
 updated_at TEXT NOT NULL
);
