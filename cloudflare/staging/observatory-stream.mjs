import { validateCapture } from "./observatory-retention.mjs";
import { purgeExpired } from "./observatory-schema.mjs";
const statement = (db,sql,...values) => db.prepare(sql).bind(...values);
const fail = (status,code) => Object.assign(new Error(code),{status});
export async function putSnapshot(db, deviceId, body, at=Date.now()) {
  if (!body || Object.keys(body).sort().join(",")!=="snapshot,view") throw fail(400,"INVALID_ENVELOPE");
  const view=body.view,snapshot=body.snapshot,verified=validateCapture(view,snapshot,at);
  const raw=JSON.stringify(snapshot);
  if(new TextEncoder().encode(raw).byteLength>49152)throw fail(413,"SNAPSHOT_TOO_LARGE");
  const previous=await statement(db,"SELECT epoch,seq,closed,last_ms FROM obs_streams WHERE device_id=? AND view=?",deviceId,view).first();
  const existing=await statement(db,"SELECT seq,expires_ms FROM obs_snapshots WHERE device_id=? AND view=? AND capture_id=?",deviceId,view,verified.captureId).first();
  if(existing && existing.expires_ms>at && existing.seq===verified.sequence)
    return {accepted:true,operation:"observe",captureId:verified.captureId,sequence:verified.sequence,replay:true};
  if(previous && (verified.epoch<previous.epoch || (verified.epoch===previous.epoch && (previous.closed || verified.sequence<=previous.seq))))
    throw fail(409,"CLOSED_OR_STALE_STREAM");
  if(previous && at-previous.last_ms<2000)throw fail(429,"RATE_LIMITED");
  const changed=await statement(db,"INSERT INTO obs_streams(device_id,view,epoch,seq,closed,last_ms) VALUES(?,?,?,?,0,?) ON CONFLICT(device_id,view) DO UPDATE SET epoch=excluded.epoch,seq=excluded.seq,closed=0,last_ms=excluded.last_ms WHERE excluded.epoch>obs_streams.epoch OR (excluded.epoch=obs_streams.epoch AND obs_streams.closed=0 AND excluded.seq>obs_streams.seq)",deviceId,view,verified.epoch,verified.sequence,at).run();
  if(changed.meta?.changes===0)throw fail(409,"CONCURRENT_SEQUENCE");
  await statement(db,"INSERT OR IGNORE INTO obs_snapshots(device_id,view,capture_id,epoch,seq,payload,created_ms,expires_ms) VALUES(?,?,?,?,?,?,?,?)",deviceId,view,verified.captureId,verified.epoch,verified.sequence,raw,at,verified.expiresAtEpochMs).run();
  await purgeExpired(db,at);
  return {accepted:true,operation:"observe",captureId:verified.captureId,sequence:verified.sequence,expiresAtEpochMs:verified.expiresAtEpochMs};
}
export async function stopStream(db, deviceId, body) {
  if(!body || Object.keys(body).sort().join(",")!=="epoch,view" ||
    !["browser","map"].includes(body.view) || !Number.isSafeInteger(body.epoch) || body.epoch<1) throw fail(400,"INVALID_STOP");
  await statement(db,"INSERT INTO obs_streams(device_id,view,epoch,seq,closed,last_ms) VALUES(?,?,?,0,1,0) ON CONFLICT(device_id,view) DO UPDATE SET epoch=excluded.epoch,closed=1 WHERE excluded.epoch>=obs_streams.epoch",deviceId,body.view,body.epoch).run();
  return {stopped:true};
}
export async function latestObservatory(db,view,at=Date.now()) {
  if(!["browser","map"].includes(view))throw fail(400,"INVALID_VIEW");
  await purgeExpired(db,at);
  const rows=await statement(db,"SELECT device_id,view,capture_id,seq,created_ms,expires_ms,payload FROM obs_snapshots WHERE view=? AND expires_ms>? ORDER BY created_ms DESC LIMIT 20",view,at).all();
  return {snapshots:(rows.results||[]).map(row=>({...row,payload:JSON.parse(row.payload)}))};
}
export async function revokeDevice(db,deviceId,at=Date.now()) {
  await statement(db,"UPDATE obs_devices SET revoked_ms=? WHERE device_id=? AND revoked_ms IS NULL",at,deviceId).run();
  await statement(db,"DELETE FROM obs_snapshots WHERE device_id=?",deviceId).run();
  return {revoked:true};
}
