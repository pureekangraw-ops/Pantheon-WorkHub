// Owner bootstrap never persists the owner bearer. Device credentials are scoped to observations.
const enc = new TextEncoder();
const digest = async s => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))), b => b.toString(16).padStart(2, "0")).join("");
export async function hashDeviceToken(token) { return digest(token); }
export function createDeviceToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
}
export async function approveOwnerPair(request, env) {
  const key = env.WORKHUB_TOKEN;
  if (typeof key !== "string" || key.length < 32) return false;
  const supplied = request.headers.get("authorization") || "";
  const expected = "Bearer " + key;
  let diff = supplied.length ^ expected.length;
  for (let i = 0; i < Math.max(supplied.length, expected.length); i++) {
    diff |= (supplied.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}
export async function resolveDevice(request, db) {
  const supplied = request.headers.get("authorization") || "";
  if (!/^Bearer [0-9a-f]{64}$/.test(supplied)) return null;
  return db.prepare("SELECT device_id FROM obs_devices WHERE token_hash=? AND revoked_ms IS NULL")
    .bind(await digest(supplied.slice(7))).first();
}
