// Pantheon -> Factory District boundary: only a read-only health call and
// an explicitly authorized, HMAC-signed preflight. No execution or receive route.
export const FACTORY_PROTOCOL = "METROPOLIS_FACTORY_STATION_V2";
const URL = "https://factory-district";
const encoder = new TextEncoder();

async function safeFactoryResponse(response) {
  let body;
  try { body = await response.json(); } catch { body = null; }
  return {http_status: response.status, body};
}
export async function factoryHealth(env) {
  if (!env.FACTORY || typeof env.FACTORY.fetch !== "function") {
    return {connected:false, status:"NOT_BOUND", preflight_ready:false};
  }
  try {
    const response = await env.FACTORY.fetch(new Request(URL + "/health", {
      method:"GET",signal:AbortSignal.timeout(5000)
    }));
    const {body} = await safeFactoryResponse(response);
    if (!response.ok || body?.service !== "factory-district") {
      return {connected:false,status:"IDENTITY_UNVERIFIED",preflight_ready:false};
    }
    return {
      connected:true,
      status:typeof body.status === "string" ? body.status : "UNKNOWN",
      storage:body.storage?.status || "UNKNOWN",
      rail:body.transport?.status || "UNKNOWN",
      machinery:Object.fromEntries(Object.entries(body.machinery || {}).map(([name,item])=>[name,item?.status || "UNKNOWN"])),
      preflight_ready:typeof env.FACTORY_RAIL_SECRET === "string" && env.FACTORY_RAIL_SECRET.length >= 32 && body.transport?.status === "READY"
    };
  } catch {
    return {connected:false,status:"UNREACHABLE",preflight_ready:false};
  }
}
export async function factoryPreflight(env, handoff) {
  // Never send an unsigned call, and do not use WORKHUB_TOKEN as the rail key.
  if (!env.FACTORY || typeof env.FACTORY.fetch !== "function") return {error:"FACTORY_NOT_BOUND",status:503};
  if (typeof env.FACTORY_RAIL_SECRET !== "string" || env.FACTORY_RAIL_SECRET.length < 32)
    return {error:"FACTORY_RAIL_SECRET_NOT_CONFIGURED",status:503};
  const timestamp=String(Date.now());
  const json=JSON.stringify(handoff);
  const key=await crypto.subtle.importKey("raw",encoder.encode(env.FACTORY_RAIL_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=[...new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(timestamp+"."+json)))].map(x=>x.toString(16).padStart(2,"0")).join("");
  try {
    const response=await env.FACTORY.fetch(new Request(URL + "/station/preflight",{
      method:"POST",
      headers:{"content-type":"application/json",
        "x-metropolis-factory-protocol":FACTORY_PROTOCOL,
        "x-metropolis-factory-timestamp":timestamp,
        "x-metropolis-factory-signature":signature},
      body:json,
      signal:AbortSignal.timeout(8000)
    }));
    const data=await safeFactoryResponse(response);
    if (!data.body || typeof data.body !== "object") return {error:"FACTORY_RESPONSE_INVALID",status:502};
    const approved=response.ok && data.body.status==="READY" && data.body.allowed===true;
    // Factory decides WORK_PASS, City grant and SHA validity. No receipts/results fabricated here.
    return {approved,status:approved?200:409,reason:approved?null:String(data.body.reason || data.body.status || "FACTORY_DENIED").slice(0,120),factory_http_status:response.status,source_sha:data.body.sourceSha||null};
  } catch {
    return {error:"FACTORY_PREFLIGHT_UNREACHABLE",status:502};
  }
}
