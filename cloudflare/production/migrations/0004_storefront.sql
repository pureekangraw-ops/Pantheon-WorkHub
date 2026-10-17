-- Additive only. Apply explicitly to an isolated database first; never on import/startup.
CREATE TABLE IF NOT EXISTS storefront_briefs (
 brief_id TEXT PRIMARY KEY,
 principal_hash TEXT NOT NULL,
 client_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED')),
 content_sha256 TEXT NOT NULL,
 record_json TEXT NOT NULL,
 task_id TEXT UNIQUE,
 received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS storefront_events (
 event_id TEXT PRIMARY KEY,
 principal_hash TEXT NOT NULL,
 record_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS storefront_budget (
 request_id TEXT PRIMARY KEY,
 principal_hash TEXT NOT NULL,
 client_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('WHISPER','TAKEOVER')),
 day TEXT NOT NULL,
 allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
 reason TEXT,
 budget_json TEXT
);
CREATE INDEX IF NOT EXISTS storefront_budget_day ON storefront_budget(day,allowed,kind);
CREATE INDEX IF NOT EXISTS storefront_budget_conversation ON storefront_budget(day,principal_hash,conversation_id,allowed,kind);
