CREATE TABLE IF NOT EXISTS pantheon_oauth_used(key TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pantheon_oauth_failures(key TEXT NOT NULL,attempted_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS pantheon_oauth_failure_key ON pantheon_oauth_failures(key,attempted_at);
CREATE TABLE IF NOT EXISTS pantheon_oauth_revoked(family_id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
