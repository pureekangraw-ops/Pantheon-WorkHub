// Stateless validation and expiry contract for short-lived Observatory observations.
export const OBSERVATORY_TTL_MS = 30_000;
export const OBSERVATORY_INTERVAL_MS = 5_000;
export function validateCapture(view, snapshot, now = Date.now()) {
  if (view !== "browser" && view !== "map") throw Error("INVALID_VIEW");
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw Error("INVALID_SNAPSHOT");
  if (typeof snapshot.captureId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(snapshot.captureId)) throw Error("INVALID_CAPTURE_ID");
  if (!Number.isSafeInteger(snapshot.epoch) || snapshot.epoch < 1) throw Error("INVALID_EPOCH");
  if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 1) throw Error("INVALID_SEQUENCE");
  if (!Number.isSafeInteger(snapshot.capturedAtEpochMs) || Math.abs(now - snapshot.capturedAtEpochMs) > 15_000) throw Error("STALE_SNAPSHOT");
  return { captureId: snapshot.captureId, epoch: snapshot.epoch, sequence: snapshot.sequence, expiresAtEpochMs: now + OBSERVATORY_TTL_MS };
}
export function visibleBeforeExpiry(record, at = Date.now()) {
  return record.expiresAtEpochMs > at;
}
