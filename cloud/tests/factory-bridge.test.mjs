import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import {factoryHealth, factoryPreflight, validateFactoryPreflight} from "../src/factory-bridge.mjs";
const TOKEN="k".repeat(48),RAIL="rail-shared-secret-".repeat(3);
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json"}});
const envelope=()=>({
 workId:"work-demo-001",checkpointId:"checkpoint-001",ownerDomain:"LOGIC",
 intent:"test permitted work",scope:["verification-only"],inputRefs:[],
 source:{stationId:"PANTHEON",system:"pantheon-workhub"},
 target:{stationId:"FACTORY-STATION",system:"factory-district",component:"FACTORY_HALL"},
 workPassRef:"work-pass://pass1",
 workPass:{kind:"WORK_PASS",version:"WORK_PASS_V1",status:"ACTIVE",passId:"pass1",actor:"PANTHEON",workId:"work-demo-001",checkpointId:"checkpoint-001",permissions:{actions:["handoff"],handoff:[{stationId:"FACTORY_STATION"}]}}
});
async function call(env,path,{method="GET",body,auth=true}={}){
 const headers=auth?{authorization:"Bearer "+TOKEN}:{};
 const r=await worker.fetch(new Request("https://workhub.example"+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
 return {status:r.status,value:await r.json()};
}
test("Factory worker binding reports real connection and never dispatches",async()=>{
 const routes=[];
 const env={WORKHUB_TOKEN:TOKEN,DB:{},FACTORY:{async fetch(req){routes.push(new URL(req.url).pathname);return json({service:"factory-district",stationId:"FACTORY-STATION",status:"READY",transport:{status:"READY"},machinery:{CODE:{status:"UNKNOWN"},VISUAL:{status:"UNKNOWN"},LOGIC:{status:"READY"}}})}}};
 const health=await call(env,"/health",{auth:false});
 assert.equal(health.status,200);assert.equal(health.value.factory.connection,"CONNECTED");
 assert.equal(health.value.factory.machinery.LOGIC,"READY");assert.equal(health.value.factory.dispatch_enabled,false);
 assert.equal((await call(env,"/v1/factory/health",{auth:false})).status,401);
 const result=await call(env,"/v1/factory/health");
 assert.equal(result.status,200);assert.equal(result.value.factory.connection,"CONNECTED");
 assert.deepEqual(routes,["/health","/health"]);
 assert.equal((await call(env,"/v1/factory/receive",{method:"POST"})).status,404);
});
test("Bridge fails closed on unbound or invalid factory",async()=>{
 assert.equal((await factoryHealth({})).connection,"NOT_CONFIGURED");
 assert.equal((await factoryHealth({FACTORY:{fetch:async()=>json({service:"unknown",stationId:"FACTORY-STATION"})}})).connection,"INVALID_TARGET");
 assert.equal((await factoryHealth({FACTORY:{fetch:async()=>{throw Error("offline")}}})).connection,"UNREACHABLE");
});
test("Factory preflight refuses untrusted work and missing rail secret",async()=>{
 const e=envelope();
 assert.equal(validateFactoryPreflight(e),e);
 assert.throws(()=>validateFactoryPreflight({...e,secret:"evil"}),/unsupported preflight field/);
 assert.throws(()=>validateFactoryPreflight({...e,workPassRef:"work-pass://other"}),/work pass scope mismatch/);
 let called=0;
 const env={WORKHUB_TOKEN:TOKEN,DB:{},FACTORY:{async fetch(){called++;return json({status:"READY",allowed:true})}}};
 assert.equal((await call(env,"/v1/factory/preflight",{method:"POST",body:e})).status,503);
 assert.equal(called,0);
 assert.equal((await call(env,"/v1/factory/preflight",{method:"POST",body:{intent:"RUN",command:"rm -rf /"}})).status,400);
 assert.equal((await call(env,"/v1/factory/preflight",{method:"POST",body:e,auth:false})).status,401);
});
test("Factory preflight signs factory rail request and checks scoped response",async()=>{
 const captured=[];
 const env={WORKHUB_TOKEN:TOKEN,DB:{},FACTORY_RAIL_SECRET:RAIL,FACTORY:{async fetch(request){
  captured.push(new URL(request.url).pathname);
  const body=await request.text(),timestamp=request.headers.get("x-metropolis-factory-timestamp");
  assert.equal(request.headers.get("x-metropolis-factory-protocol"),"METROPOLIS_FACTORY_STATION_V2");
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(RAIL),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const hex=request.headers.get("x-metropolis-factory-signature");
  const signature=Uint8Array.from(hex.match(/../g).map(v=>parseInt(v,16)));
  assert.equal(await crypto.subtle.verify("HMAC",key,signature,new TextEncoder().encode(timestamp+"."+body)),true);
  const data=JSON.parse(body);
  return json({status:"READY",allowed:true,workId:data.workId,checkpointId:data.checkpointId,workPassRef:data.workPassRef,sourceSha:"testsha",validationScope:"FACTORY_BOUNDARY_PREFLIGHT"});
 }}};
 const a=await factoryPreflight(env,envelope());
 assert.equal(a.status,"READY");assert.equal(a.dispatched,false);
 assert.deepEqual(captured,["/station/preflight"]);
});
