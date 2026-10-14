// Tables are deliberately disjoint from WorkHub tasks, artifacts and permanent map records.
export async function ensureObservatorySchema(db) {
  for (const sql of [
    "CREATE TABLE IF NOT EXISTS obs_devices (device_id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,created_ms INTEGER NOT NULL,revoked_ms INTEGER)",
    "CREATE TABLE IF NOT EXISTS obs_streams (device_id TEXT NOT NULL,view TEXT NOT NULL,epoch INTEGER NOT NULL,seq INTEGER NOT NULL,closed INTEGER NOT NULL DEFAULT 0,last_ms INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(device_id,view))",
    "CREATE TABLE IF NOT EXISTS obs_snapshots (device_id TEXT NOT NULL,view TEXT NOT NULL,capture_id TEXT NOT NULL,epoch INTEGER NOT NULL,seq INTEGER NOT NULL,payload TEXT NOT NULL,created_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,PRIMARY KEY(device_id,view,capture_id))",
    "CREATE INDEX IF NOT EXISTS idx_obs_snapshots_expiry ON obs_snapshots(expires_ms)"
  ]) await db.prepare(sql).run();
}
export async function purgeExpired(db, at=Date.now()) {
  return db.prepare("DELETE FROM obs_snapshots WHERE expires_ms<=?").bind(at).run();
}
export async function scheduledObservatoryCleanup(env, at=Date.now()) {
  if (!env.DB) return;
  await ensureObservatorySchema(env.DB);
  await purgeExpired(env.DB,at);
}
