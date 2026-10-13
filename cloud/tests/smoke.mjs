// Real Workers/D1 end-to-end smoke test. Run against Wrangler dev.
import assert from "node:assert/strict";
const origin=process.env.WH_ORIGIN||"http://127.0.0.1:8789";
const token=process.env.SMOKE_TOKEN;
if(!token||token.length<32)throw new Error("SMOKE_TOKEN is required");
async function request(path,body,method="POST",authorized=true) {
 const headers=authorized?{authorization:"Bearer "+token}:{};
 if(body!==undefined)headers["content-type"]="application/json";
 const r=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 let value;try{value=await r.json()}catch{value={}};
 return {status:r.status,value};
}
const health=await request("/health",undefined,"GET",false);
assert.equal(health.status,200);assert.equal(health.value.ok,true);
const home=await fetch(origin+"/");
assert.equal(home.status,200);assert.match(await home.text(),/Work, with proof/);
assert.equal((await request("/v1/intent",{intent:"LIST_TASKS"},"POST",false)).status,401);
assert.equal((await request("/v1/intent",{intent:"RUN_SHELL",command:"echo unsafe"})).status,400);
const queued=await request("/v1/intent",{intent:"CREATE_TASK",request:"Cloudflare D1 verified artifact smoke test"});
assert.equal(queued.status,201,JSON.stringify(queued.value));
assert.equal(queued.value.executed,false);
const taskId=queued.value.task_id;
const shown=await request("/v1/intent",{intent:"SHOW_TASK",task_id:taskId});
assert.equal(shown.value.task.status,"QUEUED");
const artifactBefore=await request("/v1/tasks/"+taskId+"/artifact",undefined,"GET");
assert.equal(artifactBefore.value.artifact,null);
const run=await request("/v1/tasks/"+taskId+"/run");
assert.equal(run.status,200,JSON.stringify(run.value));
assert.equal(run.value.status,"COMPLETED");assert.equal(run.value.verified,true);
const duplicate=await request("/v1/tasks/"+taskId+"/run");
assert.equal(duplicate.status,409);
const artifactAfter=await request("/v1/tasks/"+taskId+"/artifact",undefined,"GET");
assert.equal(artifactAfter.value.artifact.content,"Cloudflare D1 verified artifact smoke test");
const events=await request("/v1/tasks/"+taskId+"/events",undefined,"GET");
assert.ok(events.value.events.some(e=>e.type==="VERIFICATION_PASSED"));
assert.ok(events.value.events.some(e=>e.type==="TASK_COMPLETED"));
console.log(JSON.stringify({test:"WorkHub real Workers/D1 e2e",task_id:taskId,status:"VERIFIED",events:events.value.events.length}));
