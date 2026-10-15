// Factory bridge: owner-approved LOGIC trainee handoffs only.
// This rail uses an isolated Pantheon principal; Metro/City credentials stay untouched.
const enc=new TextEncoder();
const PROTOCOL="METROPOLIS_FACTORY_STATION_V2";
const FACTORY_ORIGIN="https://factory-district.internal";
const REQUEST_TIMEOUT_MS=20000;
export class FactoryBridgeError extends Error{
 constructor(status,message){super(message);this.status=status;}
}
function limitedString(v,max=256){return typeof v==="string"&&v.length>0&&v.length<=max?v:null;}
async function callFactory(env,path,{method="GET",body,headers={},allowConflict=false}={}){
 if(!env.FACTORY || typeof env.FACTORY.fetch!=="function")throw new FactoryBridgeError(503,"factory binding not configured");
 const request=new Request(FACTORY_ORIGIN+path,{method,headers,body});
 let response;
 try{response=await env.FACTORY.fetch(request,{signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});}
 catch(error){throw new FactoryBridgeError(502,error?.name==="TimeoutError"||error?.name==="AbortError"?"factory service timed out":"factory service unreachable");}
 if(!response || (!response.ok && !(allowConflict && response.status===409))){
  let reason="factory refused request";
  try{const result=await response?.json();if(limitedString(result?.reason,100))reason=result.reason;}catch{}
  throw new FactoryBridgeError(response?.status===403?403:response?.status===401?401:response?.status===503?503:502,reason);
 }
 try{return await response.json();}catch{throw new FactoryBridgeError(502,"invalid factory response");}
}
export async function factoryHealth(env){
 if(!env.FACTORY || typeof env.FACTORY.fetch!=="function")return {connection:"NOT_CONFIGURED",dispatch_enabled:false};
 try{
  const h=await callFactory(env,"/health");
  if(h?.service!=="factory-district" || h?.stationId!=="FACTORY-STATION")
    return {connection:"INVALID_TARGET",dispatch_enabled:false};
  const machinery=h.machinery??{};
  const machines=Object.fromEntries(["CODE","VISUAL","LOGIC"].map(x=>[x,machinery[x]?.status==="READY"?"READY":"UNKNOWN"]));
  return {connection:"CONNECTED",service:"factory-district",station_status:h.status==="READY"?"READY":"UNKNOWN",rail_status:h.transport?.status==="READY"?"READY":"UNKNOWN",machinery:machines,preflight_configured:typeof (env.FACTORY_PANTHEON_SECRET||env.FACTORY_RAIL_SECRET)==="string"&&(env.FACTORY_PANTHEON_SECRET||env.FACTORY_RAIL_SECRET).length>=32,dispatch_enabled:typeof env.FACTORY_PANTHEON_SECRET==="string"&&env.FACTORY_PANTHEON_SECRET.length>=32&&h.status==="READY"&&h.transport?.status==="READY"&&machines.LOGIC==="READY"};
 }catch{return {connection:"UNREACHABLE",dispatch_enabled:false};}
}
export function validateFactoryPreflight(input){
 if(!input||typeof input!=="object"||Array.isArray(input))throw new FactoryBridgeError(400,"invalid preflight");
 const allowed=["source","target","workId","checkpointId","ownerDomain","intent","scope","inputRefs","workPassRef","workPass","actingActor","cityAuthorization","operation","expectedSourceSha","requestedAt"];
 if(Object.keys(input).some(k=>!allowed.includes(k)))throw new FactoryBridgeError(400,"unsupported preflight field");
 if(!limitedString(input.workId)||!limitedString(input.checkpointId)||!limitedString(input.workPassRef)||!limitedString(input.intent,4096))
  throw new FactoryBridgeError(400,"scoped work pass is required");
 if(input.workPass?.kind!=="WORK_PASS"||input.workPass?.version!=="WORK_PASS_V1"||input.workPass?.status!=="ACTIVE")
  throw new FactoryBridgeError(400,"active WORK_PASS_V1 required");
 if(input.workPassRef!==`work-pass://${input.workPass?.passId}`||input.workPass.workId!==input.workId||input.workPass.checkpointId!==input.checkpointId)
  throw new FactoryBridgeError(400,"work pass scope mismatch");
 if(input.target?.stationId!=="FACTORY-STATION"||input.target?.component!=="FACTORY_HALL")
  throw new FactoryBridgeError(400,"target must be Factory Station");
 if(!["CODE","VISUAL","LOGIC"].includes(input.ownerDomain)||!Array.isArray(input.scope)||input.scope.length===0||input.scope.some(s=>!limitedString(s,1024)))
  throw new FactoryBridgeError(400,"invalid factory domain/scope");
 if(!limitedString(input.source?.stationId)||!limitedString(input.source?.system)||!limitedString(input.target?.system))
  throw new FactoryBridgeError(400,"source and target required");
 // Do not mint work passes or City Hall grants here. Factory makes the final decision.
 return input;
}
function railCredential(env){
 const secret=env.FACTORY_PANTHEON_SECRET || env.FACTORY_RAIL_SECRET;
 if(typeof secret!=="string"||secret.length<32)throw new FactoryBridgeError(503,"factory rail credential not configured");
 return {secret, client:env.FACTORY_PANTHEON_SECRET?"PANTHEON":null};
}
async function signedFactory(env,path,method,body,allowConflict=false){
 const {secret,client}=railCredential(env);
 const serialized=body===null?"":JSON.stringify(body),timestamp=String(Date.now());
 const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signature=[...new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(timestamp+"."+serialized)))].map(x=>x.toString(16).padStart(2,"0")).join("");
 return callFactory(env,path,{method,body:method==="GET"?undefined:serialized,allowConflict,
  headers:{"content-type":"application/json","x-metropolis-factory-protocol":PROTOCOL,
   "x-metropolis-factory-timestamp":timestamp,"x-metropolis-factory-signature":signature,
   ...(client?{"x-factory-client":client}:{})}});
}
export async function factoryPreflight(env,input){
 const envelope=validateFactoryPreflight(input);
 const result=await signedFactory(env,"/station/preflight","POST",envelope);
 if(result?.status!=="READY"||result?.allowed!==true||result?.workId!==envelope.workId||result?.checkpointId!==envelope.checkpointId||result?.workPassRef!==envelope.workPassRef)
  throw new FactoryBridgeError(502,"factory preflight not verified");
 return {status:"READY",allowed:true,workId:result.workId,checkpointId:result.checkpointId,workPassRef:result.workPassRef,sourceSha:result.sourceSha,validationScope:result.validationScope,observedAt:result.observedAt,dispatched:false};
}
export async function factoryDispatch(env,input){
 const envelope=validateFactoryPreflight(input);
 const result=await signedFactory(env,"/station/receive","POST",envelope,true);
 if(!result?.receipt || result.receipt.workId!==envelope.workId
  || result.receipt.checkpointId!==envelope.checkpointId || result.receipt.workPassRef!==envelope.workPassRef
  || !/^receipt-[A-Za-z0-9-]{8,80}$/.test(result.receipt.receiptId || ""))
  throw new FactoryBridgeError(502,"factory receipt identity mismatch");
 return result;
}
export async function factoryReadback(env,receiptId){
 if(typeof receiptId!=="string"||!/^receipt-[A-Za-z0-9-]{8,80}$/.test(receiptId))
  throw new FactoryBridgeError(400,"invalid receipt ID");
 return signedFactory(env,"/station/readback/"+encodeURIComponent(receiptId),"GET",null);
}

export async function factoryReconcile(env,input){
 const envelope=validateFactoryPreflight(input);
 const result=await signedFactory(env,"/station/reconcile","POST",envelope,true);
 if(result?.status==="UNKNOWN")throw new FactoryBridgeError(409,
   typeof result.reason==="string"?result.reason:"factory effect unverified");
 if(!["RECOVERED","RECORDED"].includes(result?.status) || !result.receipt
   || result.receipt.workId!==envelope.workId || result.receipt.checkpointId!==envelope.checkpointId
   || result.receipt.workPassRef!==envelope.workPassRef)
  throw new FactoryBridgeError(502,"factory reconciliation identity mismatch");
 return result;
}
