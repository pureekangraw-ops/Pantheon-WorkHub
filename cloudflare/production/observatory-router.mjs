import { approveOwnerPair, createDeviceToken, hashDeviceToken, resolveDevice } from "./observatory-auth.mjs";
import { ensureObservatorySchema } from "./observatory-schema.mjs";
import { putSnapshot, stopStream, latestObservatory, revokeDevice } from "./observatory-stream.mjs";
const json=(result,status=200)=>new Response(JSON.stringify(result),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
const fail=(status,code)=>{throw Object.assign(new Error(code),{status});};
async function readBody(request){
  if(Number(request.headers.get("content-length")||0)>65536)fail(413,"BODY_TOO_LARGE");
  const value=await request.text();
  if(new TextEncoder().encode(value).byteLength>65536)fail(413,"BODY_TOO_LARGE");
  try{const data=JSON.parse(value);if(!data||Array.isArray(data)||typeof data!=="object")fail(400,"INVALID_JSON_BODY");return data;}
  catch(error){if(error.status)throw error;fail(400,"INVALID_JSON_BODY");}
}
async function route(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(request.method!=="POST" && !(request.method==="GET"&&path==="/v1/observatory/latest"))fail(405,"METHOD_NOT_ALLOWED");
  if(!env.DB)fail(503,"OBSERVATORY_STORAGE_MISSING");
  await ensureObservatorySchema(env.DB);
  if(path==="/v1/observatory/pair"){
    if(!await approveOwnerPair(request,env))fail(401,"OWNER_AUTH_REQUIRED");
    const body=await readBody(request);
    if(body.consent!==true||typeof body.label!=="string"||body.label.length>80||Object.keys(body).sort().join(",")!=="consent,label")fail(400,"OWNER_CONSENT_REQUIRED");
    const deviceId="obs_"+crypto.randomUUID().replaceAll("-",""),deviceToken=createDeviceToken();
    await env.DB.prepare("INSERT INTO obs_devices(device_id,token_hash,created_ms) VALUES(?,?,?)")
      .bind(deviceId,await hashDeviceToken(deviceToken),Date.now()).run();
    return json({deviceId,deviceToken,scope:"observatory:observe-only",captureMode:"owner-manual",expiresAfterMs:30000},201);
  }
  if(path==="/v1/observatory/latest"){
    if(!await approveOwnerPair(request,env))fail(401,"OWNER_AUTH_REQUIRED");
    return json(await latestObservatory(env.DB,url.searchParams.get("view")));
  }
  const record=await resolveDevice(request,env.DB);
  if(!record?.device_id)fail(401,"DEVICE_AUTH_REQUIRED");
  if(path==="/v1/observatory/snapshot")return json(await putSnapshot(env.DB,record.device_id,await readBody(request)));
  if(path==="/v1/observatory/stop")return json(await stopStream(env.DB,record.device_id,await readBody(request)));
  if(path==="/v1/observatory/disconnect")return json(await revokeDevice(env.DB,record.device_id));
  fail(404,"NOT_FOUND");
}
export async function handleObservatory(request,env){
  if(!new URL(request.url).pathname.startsWith("/v1/observatory/"))return null;
  try{return await route(request,env);}
  catch(error){return json({error:error.status?error.message:"INTERNAL_ERROR"},error.status||500);}
}
