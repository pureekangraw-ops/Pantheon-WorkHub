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
// Read a single observation round. Never combine page state across captures or devices.
export async function readObservatoryRound(db,view,deviceId,captureId,at=Date.now()) {
  if(!['browser','map'].includes(view))throw fail(400,'INVALID_VIEW');
  if(deviceId!==undefined&&!/^obs_[a-f0-9]{32}$/.test(deviceId))throw fail(400,'INVALID_DEVICE_ID');
  if(captureId!==undefined&&(typeof captureId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(captureId)))throw fail(400,'INVALID_CAPTURE_ID');
  const base={read_only:true,source:'PANTHEON Observatory manual snapshot',content_trust:'untrusted_page_data',readAtEpochMs:at,view};
  const where=' FROM obs_snapshots s JOIN obs_devices d ON d.device_id=s.device_id WHERE d.revoked_ms IS NULL AND s.view=? AND s.expires_ms>?'+(deviceId?' AND s.device_id=?':'')+(captureId?' AND s.capture_id=?':'');
  const args=[view,at,...(deviceId?[deviceId]:[]),...(captureId?[captureId]:[])];
  const devices=await statement(db,'SELECT DISTINCT s.device_id'+where+' LIMIT 2',...args).all();
  if(!devices.results?.length)return {...base,status:'NO_FRESH_SNAPSHOT',message:'No matching unexpired round. Ask the user to press Send page again.'};
  if(devices.results.length>1)return {...base,status:'DEVICE_SELECTION_REQUIRED',deviceIds:devices.results.map(d=>d.device_id),message:'Specify device_id; page contents have not been read.'};
  const row=await statement(db,'SELECT s.device_id,s.capture_id,s.seq,s.created_ms,s.expires_ms,s.payload'+where+' AND s.device_id=? ORDER BY s.created_ms DESC,s.seq DESC LIMIT 1',...args,devices.results[0].device_id).first();
  if(!row)return {...base,status:'NO_FRESH_SNAPSHOT'};
  const payload=JSON.parse(row.payload);
  if(!payload||payload.captureId!==row.capture_id||payload.sequence!==row.seq||!Number.isSafeInteger(payload.capturedAtEpochMs))throw fail(502,'INVALID_SNAPSHOT_RECORD');
  return {...base,status:'SNAPSHOT_AVAILABLE',snapshot:{deviceId:row.device_id,view,captureId:row.capture_id,sequence:row.seq,capturedAtEpochMs:payload.capturedAtEpochMs,receivedAtEpochMs:row.created_ms,expiresAtEpochMs:row.expires_ms,ageMs:Math.max(0,at-payload.capturedAtEpochMs),payload}};
}
export async function revokeDevice(db,deviceId,at=Date.now()) {
  await statement(db,"UPDATE obs_devices SET revoked_ms=? WHERE device_id=? AND revoked_ms IS NULL",at,deviceId).run();
  await statement(db,"DELETE FROM obs_snapshots WHERE device_id=?",deviceId).run();
  return {revoked:true};
}
