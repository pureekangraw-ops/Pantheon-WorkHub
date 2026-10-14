import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handleObservatory } from "./observatory-router.mjs";
import { scheduledObservatoryCleanup } from "./observatory-schema.mjs";
import { OBSERVATORY_TTL_MS, validateCapture } from "./observatory-retention.mjs";

class MemoryD1 {
  constructor(){ this.engine=new DatabaseSync(":memory:"); }
  prepare(sql){
    const command=this.engine.prepare(sql);
    let args=[];
    return {
      bind(...values){args=values;return this;},
      async run(){const result=command.run(...args);return {meta:{changes:Number(result.changes)}};},
      async first(){return command.get(...args)||null;},
      async all(){return {results:command.all(...args)};}
    };
  }
}
const post=(path,data,bearer="")=>new Request("https://example.test"+path,{
  method:"POST",
  headers:{"content-type":"application/json",...(bearer?{"authorization":"Bearer "+bearer}:{})},
  body:JSON.stringify(data)
});
const get=(path,bearer)=>new Request("https://example.test"+path,{headers:{"authorization":"Bearer "+bearer}});
async function exchange(request,env){const result=await handleObservatory(request,env);return {status:result.status,body:await result.json()};}

test("pure snapshot constraints",()=>{
  const at=1_800_000_000_000;
  const snapshot={captureId:"capture-test-001",epoch:12,sequence:1,capturedAtEpochMs:at};
  assert.equal(validateCapture("browser",snapshot,at).expiresAtEpochMs,at+OBSERVATORY_TTL_MS);
  assert.throws(()=>validateCapture("map",{...snapshot,capturedAtEpochMs:at-16000},at),/STALE_SNAPSHOT/);
  assert.throws(()=>validateCapture("browser",{...snapshot,epoch:-1},at),/INVALID_EPOCH/);
  assert.throws(()=>validateCapture("background",snapshot,at),/INVALID_VIEW/);
});

test("one-time scoped pairing, 5s stream, 30s expiry, stop and revoke", async()=>{
  const realNow=Date.now;
  let clock=1_800_000_000_000;
  Date.now=()=>clock;
  try {
    const ownerToken="owner-"+ "z".repeat(40);
    const env={WORKHUB_TOKEN:ownerToken,DB:new MemoryD1()};
    assert.equal((await exchange(post("/v1/observatory/pair",{consent:true,label:"phone"}),env)).status,401);
    const paired=await exchange(post("/v1/observatory/pair",{consent:true,label:"phone"},ownerToken),env);
    assert.equal(paired.status,201);
    assert.equal(paired.body.scope,"observatory:observe-only");
    assert.equal(paired.body.deviceToken.length,64);
    const secret=paired.body.deviceToken;
    const b=(captureId,epoch,sequence)=>({view:"browser",snapshot:{captureId,epoch,sequence,capturedAtEpochMs:clock,url:"https://example.com",text:"Read-only data"}});
    assert.equal((await exchange(post("/v1/observatory/snapshot",b("capture-test-001",clock,1),ownerToken),env)).status,401);
    let a=await exchange(post("/v1/observatory/snapshot",b("capture-test-001",clock,1),secret),env);
    assert.equal(a.status,200);
    assert.equal(a.body.accepted,true);
    assert.equal(a.body.expiresAtEpochMs,clock+30000);
    assert.equal((await exchange(post("/v1/observatory/snapshot",b("capture-test-001",clock,1),secret),env)).body.replay,true);
    assert.equal((await exchange(get("/v1/observatory/latest?view=browser",ownerToken),env)).body.snapshots.length,1);
    clock+=5000;
    a=await exchange(post("/v1/observatory/snapshot",b("capture-test-002",clock-5000,2),secret),env);
    assert.equal(a.status,200);
    await exchange(post("/v1/observatory/stop",{view:"browser",epoch:clock-5000},secret),env);
    clock+=5000;
    assert.equal((await exchange(post("/v1/observatory/snapshot",b("capture-test-003",clock-10000,3),secret),env)).status,409);
    clock+=30000;
    await scheduledObservatoryCleanup(env,clock);
    assert.equal((await exchange(get("/v1/observatory/latest?view=browser",ownerToken),env)).body.snapshots.length,0);
    assert.equal(env.DB.engine.prepare("SELECT COUNT(*) as n FROM obs_snapshots").get().n,0);
    const revoked=await exchange(post("/v1/observatory/disconnect",{},secret),env);
    assert.equal(revoked.body.revoked,true);
    assert.equal((await exchange(post("/v1/observatory/snapshot",b("capture-test-004",clock,4),secret),env)).status,401);
  }finally{Date.now=realNow;}
});
