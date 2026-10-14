import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import worker from "../src/worker.mjs";

const TOKEN="s".repeat(48);
class TestDB {
  constructor() {
    this.db=new DatabaseSync(":memory:");
    this.db.exec(readFileSync(new URL("../schema.sql",import.meta.url),"utf8"));
    this.failOnceOn=null;
  }
  prepare(sql) {
    const db=this;
    return {
      bind(...values) {
        return {
          async first() {db.check(sql); return db.db.prepare(sql).get(...values)||null;},
          async all() {db.check(sql);return {results:db.db.prepare(sql).all(...values)};},
          async run() {db.check(sql);const out=db.db.prepare(sql).run(...values);return {success:true,meta:{changes:out.changes}};}
        };
      }
    };
  }
  check(sql) {
    if(this.failOnceOn && sql.includes(this.failOnceOn)) {this.failOnceOn=null;throw new Error("simulated crash");}
  }
  async batch(items) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out=[];
      for(const item of items) {
        // D1 prepared statement results include RETURNING rows for UPDATE.
        if(item._sql) throw Error("unreachable");
        // Each bound statement provides both .all and .run; SQL has a RETURNING clause only on claims.
        const isReturning = item.sql && /RETURNING/i.test(item.sql);
        if(isReturning) out.push(await item.all());
        else {
          // Test bindings expose .run, even when a statement is INSERT ... SELECT.
          out.push(await item.run());
        }
      }
      this.db.exec("COMMIT");
      return out;
    }catch(e){this.db.exec("ROLLBACK");throw e;}
  }
}
// Wrap prepared statements to record SQL for deciding how D1 batch reports returning rows.
const originalPrepare=TestDB.prototype.prepare;
TestDB.prototype.prepare=function(sql){
  const item=originalPrepare.call(this,sql), bind=item.bind.bind(item);
  return {bind(...values){const stmt=bind(...values);stmt.sql=sql;return stmt;}};
};
const env=()=>({DB:new TestDB(),WORKHUB_TOKEN:TOKEN});
async function api(e,path,{method="GET",body,auth=true}={}) {
  const headers={};
  if(auth) headers.authorization="Bearer "+TOKEN;
  if(body!==undefined) headers["content-type"]="application/json";
  const r=await worker.fetch(new Request("https://stage.example"+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),e);
  return {status:r.status,data:await r.json()};
}
async function create(e,request="build a useful artifact"){
  const r=await api(e,"/v1/intent",{method:"POST",body:{intent:"CREATE_TASK",request}});
  assert.equal(r.status,201);return r.data.task_id;
}
test("health and authorization are isolated",async()=>{
  const e=env();
  assert.equal((await api(e,"/health",{auth:false})).status,200);
  assert.equal((await api(e,"/v1/intent",{method:"POST",auth:false,body:{intent:"LIST_TASKS"}})).status,401);
  assert.equal((await api({DB:e.DB},"/v1/intent",{method:"POST",body:{intent:"LIST_TASKS"}})).status,503);
});
test("untrusted intent only queues; explicit execution verifies artifact and events",async()=>{
  const e=env(),taskId=await create(e);
  assert.equal((await api(e,"/v1/intent",{method:"POST",body:{intent:"SHOW_TASK",task_id:taskId}})).data.task.status,"QUEUED");
  assert.equal(e.DB.db.prepare("SELECT count(*) AS n FROM artifacts").get().n,0);
  const listing=await api(e,"/v1/intent",{method:"POST",body:{intent:"LIST_TASKS"}});
  assert.equal(listing.data.tasks.length,1);
  const run=await api(e,"/v1/tasks/"+taskId+"/run",{method:"POST"});
  assert.equal(run.status,200,JSON.stringify(run.data));
  assert.equal(run.data.status,"COMPLETED");
  assert.equal(run.data.verified,true);
  assert.equal(e.DB.db.prepare("SELECT count(*) AS n FROM artifacts").get().n,1);
  assert.equal((await api(e,"/v1/tasks/"+taskId+"/run",{method:"POST"})).status,409);
  const artifact=(await api(e,"/v1/tasks/"+taskId+"/artifact", {method:"GET"})).data.artifact;
  assert.equal(artifact.content,"build a useful artifact");
  assert.match(artifact.sha256,/^[a-f0-9]{64}$/);
  const events=(await api(e,"/v1/tasks/"+taskId+"/events")).data.events;
  assert.ok(events.some(x=>x.type==="ACTION_REQUESTED"));
  assert.ok(events.some(x=>x.type==="VERIFICATION_PASSED"));
  assert.ok(events.some(x=>x.type==="TASK_COMPLETED"));
  assert.throws(()=>e.DB.db.prepare("DELETE FROM events").run(),/append-only/);
});
test("invalid model output is rejected without a task",async()=>{
  const e=env();
  for(const intent of [{intent:"RUN_SHELL",command:"rm -rf /"},{intent:"CREATE_TASK",request:"x",execute:true},{intent:"CREATE_TASK",request:" "},{intent:"SHOW_TASK",task_id:"../../"}]) {
    const r=await api(e,"/v1/intent",{method:"POST",body:intent});
    assert.equal(r.status,400,JSON.stringify(r.data));
  }
  assert.equal(e.DB.db.prepare("SELECT count(*) AS n FROM tasks").get().n,0);
});
test("crash before effect: reconcile absence, require explicit retry",async()=>{
  const e=env(),taskId=await create(e,"recover me");
  e.DB.failOnceOn="INSERT INTO artifacts";
  assert.equal((await api(e,"/v1/tasks/"+taskId+"/run",{method:"POST"})).status,409);
  assert.equal((await api(e,"/v1/tasks/"+taskId+"/recover",{method:"POST"})).status,409);
  e.DB.db.prepare("UPDATE tasks SET updated_at=? WHERE task_id=?").run("2020-01-01T00:00:00.000Z",taskId);
  const recovered=await api(e,"/v1/tasks/"+taskId+"/recover",{method:"POST"});
  assert.equal(recovered.data.status,"FAILED");
  const retried=await api(e,"/v1/tasks/"+taskId+"/retry",{method:"POST"});
  assert.equal(retried.data.status,"QUEUED");
  assert.equal((await api(e,"/v1/tasks/"+taskId+"/run",{method:"POST"})).data.status,"COMPLETED");
});
test("crash after effect: readback completes without inserting a second artifact",async()=>{
  const e=env(),taskId=await create(e,"effect is durable");
  e.DB.failOnceOn="UPDATE actions SET status='VERIFIED'";
  assert.equal((await api(e,"/v1/tasks/"+taskId+"/run",{method:"POST"})).status,409);
  assert.equal(e.DB.db.prepare("SELECT count(*) AS n FROM artifacts").get().n,1);
  e.DB.db.prepare("UPDATE tasks SET updated_at=? WHERE task_id=?").run("2020-01-01T00:00:00.000Z",taskId);
  const recovered=await api(e,"/v1/tasks/"+taskId+"/recover",{method:"POST"});
  assert.equal(recovered.data.status,"COMPLETED",JSON.stringify(recovered.data));
  assert.equal(e.DB.db.prepare("SELECT count(*) AS n FROM artifacts").get().n,1);
});

test("dashboard HTML is served publicly without exposing workspace data",async()=>{
  const e=env();
  const response=await worker.fetch(new Request("https://stage.example/"),e);
  assert.equal(response.status,200);
  assert.match(response.headers.get("content-security-policy"),/connect-src 'self'/);
  const html=await response.text();
  assert.match(html,/Work, with proof/);
  assert.doesNotMatch(html,/\bWORKHUB_TOKEN\b/);
  assert.equal((await api(e,"/v1/intent",{method:"POST",auth:false,body:{intent:"LIST_TASKS"}})).status,401);
});

const PANTHEON_SECRET="pantheon-integration-test-secret-".repeat(3);
function factoryBinding({loseFirstReceipt=false,verified=true,receiptMissing=false}={}){
 const receipts=new Map();let dispatches=0,connections=0,firstLost=loseFirstReceipt,receiptReady=!receiptMissing;
 const binding={async fetch(request){
   connections++;
   const path=new URL(request.url).pathname;
   if(path==="/health")return new Response(JSON.stringify({service:"factory-district",stationId:"FACTORY-STATION",status:"READY",
     transport:{status:"READY"},machinery:{LOGIC:{status:"READY"}}}),{status:200});
   const body=request.method==="GET"?"":await request.text();
   const timestamp=request.headers.get("x-metropolis-factory-timestamp");
   const sig=request.headers.get("x-metropolis-factory-signature");
   assert.equal(request.headers.get("x-factory-client"),"PANTHEON");
   const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(PANTHEON_SECRET),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
   const ok=await crypto.subtle.verify("HMAC",key,Uint8Array.from(sig.match(/../g).map(h=>parseInt(h,16))),new TextEncoder().encode(timestamp+"."+body));
   assert.equal(ok,true);
   if(path==="/station/preflight"){
    const work=JSON.parse(body);
    return new Response(JSON.stringify({status:"READY",allowed:true,workId:work.workId,checkpointId:work.checkpointId,workPassRef:work.workPassRef,sourceSha:"testsha"}));
   }
   if(path==="/station/receive"){
    const work=JSON.parse(body);
    let record=receipts.get(work.workId);
    if(!record){
      dispatches++;
      const receiptId="receipt-"+crypto.randomUUID();
      record={receipt:{receiptId,workId:work.workId,checkpointId:work.checkpointId,workPassRef:work.workPassRef,status:"HANDOFF_VERIFIED"},
       readback:{receiptId,workId:work.workId,checkpointId:work.checkpointId,workPassRef:work.workPassRef,actingActor:"PANTHEON",status:"HANDOFF_VERIFIED",boundaryVerified:true,domainCompleted:verified,domainVerified:verified,evidenceRef:"evidence://factory/logic",sourceSha:"testsha",result:verified?{evidenceRefs:["r2://factory/logic/trainee"],resultRefs:["r2://factory/logic/trainee"]}:null}};
      receipts.set(work.workId,record);
    }
    if(firstLost){firstLost=false;throw new Error("network response lost after Factory effect")}
    return new Response(JSON.stringify(record),{status:202});
   }
   if(path==="/station/reconcile"){
     const original=JSON.parse(body);
     const record=receipts.get(original.workId);
     if(!record)return new Response(JSON.stringify({status:"UNKNOWN",reason:"FACTORY_CLAIM_NOT_FOUND"}),{status:409});
     receiptReady=true;
     return new Response(JSON.stringify({status:"RECOVERED",receipt:record.receipt,readback:record.readback,recovered:true}),{status:200});
   }
   if(path.startsWith("/station/readback/")){
     const record=[...receipts.values()].find(v=>v.receipt.receiptId===path.split("/").at(-1));
     return new Response(JSON.stringify(receiptReady&&record?record.readback:{status:"UNKNOWN",reason:"RECEIPT_NOT_FOUND"}),{status:receiptReady&&record?200:404});
   }
   throw new Error("Unexpected Factory route "+path);
 }};
 return {binding,get dispatches(){return dispatches;},get connections(){return connections;}};
}
test("Factory queued owner action authenticates a scoped rail and verifies independent readback",async()=>{
 const f=factoryBinding(),e={...env(),FACTORY_PANTHEON_SECRET:PANTHEON_SECRET,FACTORY:f.binding};
 const invalid=await api(e,"/v1/factory/jobs",{method:"POST",body:{request:"hello",actor:"GO"}});
 assert.equal(invalid.status,400);
 const unauthorized=await api(e,"/v1/factory/jobs",{method:"POST",body:{request:"LOGIC trainee"} ,auth:false});
 assert.equal(unauthorized.status,401);
 const q=await api(e,"/v1/factory/jobs",{method:"POST",body:{request:"Place DWARF-01 in LOGIC development bench"}});
 assert.equal(q.status,201);assert.equal(q.data.executed,false);assert.equal(f.dispatches,0);
 const id=q.data.task_id;
 assert.equal((await api(e,"/v1/tasks/"+id+"/run",{method:"POST"})).status,409);
 const run=await api(e,"/v1/factory/jobs/"+id+"/dispatch",{method:"POST"});
 assert.equal(run.status,200,JSON.stringify(run));assert.equal(run.data.verified,true);
 assert.equal(run.data.status,"COMPLETED");assert.equal(f.dispatches,1);
 assert.equal((await api(e,"/v1/factory/jobs/"+id,{method:"GET"})).data.job.status,"COMPLETED");
 const rows=await api(e,"/v1/tasks/"+id+"/events");
 assert.ok(rows.data.events.some(v=>v.type==="FACTORY_RECEIPT_RECORDED"));
 assert.ok(rows.data.events.some(v=>v.type==="FACTORY_RESULT_VERIFIED"));
 assert.equal((await api(e,"/v1/factory/jobs/"+id+"/dispatch",{method:"POST"})).status,409);
 assert.equal((await api(e,"/v1/tasks/"+id+"/recover",{method:"POST"})).status,409);
 assert.equal(f.dispatches,1);
});
test("Factory rail response loss goes to reconciliation; resend is idempotent",async()=>{
 const f=factoryBinding({loseFirstReceipt:true}),e={...env(),FACTORY_PANTHEON_SECRET:PANTHEON_SECRET,FACTORY:f.binding};
 const q=await api(e,"/v1/factory/jobs",{method:"POST",body:{request:"reconcile trainee placement"}});
 const id=q.data.task_id;
 const a=await api(e,"/v1/factory/jobs/"+id+"/dispatch",{method:"POST"});
 assert.equal(a.status,502);assert.equal(f.dispatches,1);
 assert.equal((await api(e,"/v1/factory/jobs/"+id,{method:"GET"})).data.job.status,"NEEDS_RECONCILIATION");
 const r=await api(e,"/v1/factory/jobs/"+id+"/reconcile",{method:"POST"});
 assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.verified,true);
 assert.equal(f.dispatches,1);
});
test("Factory boundary verified without machine evidence is never marked complete",async()=>{
 const f=factoryBinding({verified:false}),e={...env(),FACTORY_PANTHEON_SECRET:PANTHEON_SECRET,FACTORY:f.binding};
 const q=await api(e,"/v1/factory/jobs",{method:"POST",body:{request:"unverified trainee"}});
 const a=await api(e,"/v1/factory/jobs/"+q.data.task_id+"/dispatch",{method:"POST"});
 assert.equal(a.status,200);assert.equal(a.data.verified,false);
 assert.equal(a.data.status,"NEEDS_RECONCILIATION");
 assert.equal((await api(e,"/v1/factory/jobs/"+q.data.task_id,{method:"GET"})).data.job.task_status,"NEEDS_RECONCILIATION");
});

test("temporary Factory-only smoke credential cannot access existing owner APIs",async()=>{
 const e={...env(),WORKHUB_SMOKE_TOKEN:"probe-".repeat(12)};
 const headers={authorization:"Bearer "+e.WORKHUB_SMOKE_TOKEN,"content-type":"application/json"};
 const route=async(path,method="POST",body)=> {
  const r=await worker.fetch(new Request("https://stage.example"+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),e);
  return {status:r.status,data:await r.json()};
 };
 assert.equal((await route("/v1/intent","POST",{intent:"LIST_TASKS"})).status,401);
 assert.equal((await route("/v1/factory/preflight","POST",{})).status,401);
 const q=await route("/v1/factory/jobs","POST",{request:"Scoped E2E training bench"});
 assert.equal(q.status,201);assert.equal(q.data.executed,false);
 assert.equal((await route("/v1/factory/jobs/"+q.data.task_id,"GET")).status,200);
 assert.equal((await route("/v1/tasks/"+q.data.task_id+"/run")).status,401);
 assert.equal((await route("/v1/factory/jobs/"+q.data.task_id+"/dispatch")).status,503);
});

test("Factory missing receipt is rebuilt through signed evidence-only reconciliation",async()=>{
 const f=factoryBinding({receiptMissing:true}),e={...env(),FACTORY_PANTHEON_SECRET:PANTHEON_SECRET,FACTORY:f.binding};
 const q=await api(e,"/v1/factory/jobs",{method:"POST",body:{request:"receipt lost after executed LOGIC trainee placement"}});
 const taskId=q.data.task_id;
 const first=await api(e,"/v1/factory/jobs/"+taskId+"/dispatch",{method:"POST"});
 assert.equal(first.status,502);
 assert.equal(f.dispatches,1);
 const saved=(await api(e,"/v1/factory/jobs/"+taskId)).data.job;
 assert.ok(saved.receipt_id);
 assert.equal(saved.status,"NEEDS_RECONCILIATION");
 const recovered=await api(e,"/v1/factory/jobs/"+taskId+"/reconcile",{method:"POST"});
 assert.equal(recovered.status,200,JSON.stringify(recovered));
 assert.equal(recovered.data.status,"COMPLETED");
 assert.equal(recovered.data.verified,true);
 assert.equal(f.dispatches,1);
 const events=(await api(e,"/v1/tasks/"+taskId+"/events")).data.events;
 assert.ok(events.some(x=>x.type==="FACTORY_RECEIPT_RECOVERED"));
});
