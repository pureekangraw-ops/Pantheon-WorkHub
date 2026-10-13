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
