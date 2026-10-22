import {INTENT_CONTRACTS,validateIntent,validateOutcome,proposeOutcome,validateProposal} from './intent-contract.mjs';
import {L1_TASK_ID,L1_REQUEST_SHA256,L1_INTENT,L1_SCOPE,L1_RECEIPT_ID,verifyL1Readback} from './l1-contract.mjs';
import { handleObservatory } from "./observatory-router.mjs";
import { scheduledObservatoryCleanup } from "./observatory-schema.mjs";
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/ui.mjs
var dashboard = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pantheon WorkHub \u2014 Preview</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,sans-serif;background:#edf5fa;color:#142f4a}
*{box-sizing:border-box}body{margin:0}button,input,textarea{font:inherit}button{cursor:pointer;border:0;border-radius:11px;padding:10px 16px;background:#125eaa;color:#fff;font-weight:650}button:hover{background:#0b477f}button:disabled{opacity:.5;cursor:not-allowed}
header{background:#fff;border-bottom:1px solid #dce8f0;display:flex;justify-content:space-between;align-items:center;padding:18px clamp(20px,5vw,68px)}
header strong{font-size:20px;letter-spacing:-.4px}.tag{font-size:11px;font-weight:750;background:#e0f6f3;color:#087e74;border-radius:20px;padding:6px 10px;letter-spacing:.8px}
main{max-width:1130px;margin:38px auto;padding:0 20px}.headline{margin-bottom:26px}.headline h1{font-size:clamp(30px,4vw,42px);margin:0 0 8px;letter-spacing:-1.3px}.muted{color:#607a90;font-size:14px;line-height:1.6}
.layout{display:grid;grid-template-columns:1fr 1.15fr;gap:18px}.panel{background:#fff;border:1px solid #dae6ee;border-radius:19px;padding:23px;box-shadow:0 6px 25px #244a6510;margin-bottom:18px}.panel h2{font-size:18px;margin:0 0 15px}
label{display:block;font-size:13px;font-weight:700;margin:12px 0 7px}input,textarea{width:100%;padding:12px;border-radius:11px;border:1px solid #cbdce8;background:#fbfdff;color:#17334c;outline-color:#4a9ac8}textarea{min-height:135px;resize:vertical}
.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:15px}.secondary{background:#eaf2fa;color:#14548a}.secondary:hover{background:#d7e8f5}
#notice{font-size:13px;min-height:22px;color:#1b668a;margin:13px 0}.task{border:1px solid #dfeaf1;border-radius:12px;padding:13px;margin:9px 0}.taskhead{display:flex;justify-content:space-between;gap:8px;align-items:center}.taskid{font-family:ui-monospace,monospace;font-size:11px;overflow-wrap:anywhere;color:#54768c}
.state{font-size:11px;border-radius:20px;background:#ebf4fb;color:#14679d;padding:5px 9px;font-weight:750}.request{font-size:13px;margin:10px 0;color:#233c50;white-space:pre-wrap;overflow-wrap:anywhere}
pre{font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f8fb;padding:14px;border-radius:10px;max-height:260px;overflow:auto}
.stat{font-size:12px;font-weight:600;color:#55758d}#gate{display:block}#workspace{display:none}
footer{padding:20px;text-align:center;color:#718b9a;font-size:12px}@media(max-width:760px){.layout{grid-template-columns:1fr}main{margin-top:24px}header{padding:16px 20px}}
</style></head><body>
<header><strong>\u2726 Pantheon <span style="color:#217fbe">WorkHub</span></strong><span class="tag">WORKSPACE PREVIEW</span></header>
<main><div class="headline"><h1>Work, with proof.</h1><div class="muted">Queue work without executing. Explicitly run a safe text artifact or owner-authorized Factory LOGIC trainee placement; inspect receipt and evidence.</div></div>
<div id="gate" class="panel"><h2>Connect to your workspace</h2><p class="muted">Enter your WorkHub access token. The token is kept in this page's memory only and is not saved in the browser.</p><label for="access">Access token</label><input id="access" type="password" autocomplete="off" placeholder="WorkHub access token"><div class="actions"><button id="connect">Connect</button></div></div>
<div id="workspace" class="layout">
 <section><div class="panel"><h2>Create a task</h2><div class="muted">HERMES can propose this task. Creating it does not run an action.</div><label for="request">Task instruction</label><textarea id="request" placeholder="Describe a text artifact to create..."></textarea><div class="actions"><button id="create">Queue task</button><button id="signout" class="secondary">Disconnect</button></div></div>
 <div class="panel"><h2>Factory District \u2022 LOGIC trainee</h2><p class="muted">Explicit owner-approved training-bench placement only. Queuing does not execute. Sending uses an isolated signed rail and stores independently verified receipt/evidence in WorkHub.</p><button id="checkFactory" class="secondary">Check Factory</button><pre id="factoryState">Not checked</pre><label for="factoryRequest">Training-bench work note</label><textarea id="factoryRequest" placeholder="Describe the LOGIC trainee placement to record"></textarea><div class="actions"><button id="queueFactory" class="secondary">Queue Factory LOGIC job</button></div></div>
 <div class="panel"><h2>Verification detail</h2><pre id="details">Select a task to view its audit trail.</pre></div></section>
 <section><div class="panel"><div class="taskhead"><h2>Task queue</h2><span id="count" class="stat">0 tasks</span></div><button id="refresh" class="secondary">Refresh</button><div id="tasks"></div></div></section>
</div><div id="notice" role="status" aria-live="polite"></div>
</main><footer>Pantheon WorkHub \u2022 controlled Factory LOGIC trainee handoffs</footer>
<script>
(() => {
 const el=id=>document.getElementById(id); let token="";
 function notice(s){el("notice").textContent=s}
 async function api(path,body,method="POST"){
   const response=await fetch(path,{method,headers:{"authorization":"Bearer "+token,...(body===undefined?{}:{"content-type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body)});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"Request failed");return data;
 }
 async function checkFactory(){const result=await api("/v1/factory/health",undefined,"GET");el("factoryState").textContent=JSON.stringify(result.factory,null,2);}
 async function load(){
  const result=await api("/v1/intent",{intent:"LIST_TASKS"});const tasks=el("tasks");tasks.replaceChildren();el("count").textContent=result.tasks.length+" tasks";
  if(!result.tasks.length){const p=document.createElement("p");p.className="muted";p.textContent="No tasks yet. Create one to begin.";tasks.append(p);}
  for(const item of result.tasks){
   const row=document.createElement("div");row.className="task";
   const head=document.createElement("div");head.className="taskhead";
   const identity=document.createElement("span");identity.className="taskid";identity.textContent=item.task_id;
   const state=document.createElement("span");state.className="state";state.textContent=item.status;head.append(identity,state);row.append(head);
   const description=document.createElement("p");description.className="request";description.textContent=item.request_text||"";row.append(description);
   const buttons=document.createElement("div");buttons.className="actions";
   const inspect=document.createElement("button");inspect.className="secondary";inspect.textContent="Inspect";inspect.onclick=()=>detail(item.task_id);
   buttons.append(inspect);
   if(item.status==="QUEUED" && item.tool_name==="d1.create_text_artifact"){const run=document.createElement("button");run.textContent="Run verified artifact";run.onclick=async()=>{if(!confirm("Run the safe text-artifact tool for this task?"))return;await taskAction(item.task_id,"run")};buttons.append(run);}
   if(item.status==="QUEUED" && item.tool_name==="factory.logic.trainee"){const send=document.createElement("button");send.textContent="Send to Factory LOGIC";send.onclick=async()=>{if(!confirm("Send this owner-approved LOGIC trainee Work Pass to Factory now?"))return;await factoryAction(item.task_id,"dispatch")};buttons.append(send);}
   if(item.tool_name==="factory.logic.trainee" && item.status==="NEEDS_RECONCILIATION"){const reconcile=document.createElement("button");reconcile.className="secondary";reconcile.textContent="Factory readback/reconcile";reconcile.onclick=()=>factoryAction(item.task_id,"reconcile");buttons.append(reconcile);}
   if((item.status==="NEEDS_RECONCILIATION"||item.status==="RUNNING") && item.tool_name==="d1.create_text_artifact"){const recover=document.createElement("button");recover.className="secondary";recover.textContent="Recover";recover.onclick=()=>taskAction(item.task_id,"recover");buttons.append(recover);}
   if(item.status==="FAILED" && item.tool_name==="d1.create_text_artifact"){const retry=document.createElement("button");retry.className="secondary";retry.textContent="Queue retry";retry.onclick=()=>taskAction(item.task_id,"retry");buttons.append(retry);}
   row.append(buttons);tasks.append(row);
  }
 }
 async function detail(taskId){
   try{
    const [a,b]=await Promise.all([api("/v1/intent",{intent:"SHOW_TASK",task_id:taskId}),api("/v1/tasks/"+taskId+"/events",undefined,"GET")]);
    const action=(await api("/v1/intent",{intent:"LIST_TASKS"})).tasks.find(x=>x.task_id===taskId)?.tool_name;
    const result=action==="factory.logic.trainee"
      ? await api("/v1/factory/jobs/"+taskId,undefined,"GET")
      : await api("/v1/tasks/"+taskId+"/artifact",undefined,"GET");
    el("details").textContent=JSON.stringify({task:a.task,result,events:b.events},null,2);
   }catch(err){notice(err.message)}
 }
 async function factoryAction(taskId,action){try{const r=await api("/v1/factory/jobs/"+taskId+"/"+action);notice("Factory: "+r.status+" \u2022 verified="+r.verified);await load();await detail(taskId)}catch(err){notice(err.message);await load().catch(()=>{})}}
 async function taskAction(taskId,action){try{const r=await api("/v1/tasks/"+taskId+"/"+action);notice(action+": "+r.status);await load();await detail(taskId)}catch(err){notice(err.message)}}
 el("connect").onclick=async()=>{token=el("access").value.trim();try{await load();el("access").value="";el("gate").style.display="none";el("workspace").style.display="grid";notice("Connected to WorkHub.");checkFactory().catch(err=>el("factoryState").textContent=err.message)}catch(err){token="";notice(err.message)}};
 el("signout").onclick=()=>{token="";el("workspace").style.display="none";el("gate").style.display="block";el("details").textContent="Select a task to view its audit trail.";notice("Disconnected.")};
 el("refresh").onclick=()=>load().catch(e=>notice(e.message));
 el("checkFactory").onclick=()=>checkFactory().catch(e=>notice(e.message));
 el("queueFactory").onclick=async()=>{const request=el("factoryRequest").value.trim();if(!request)return notice("Enter a LOGIC training-bench note.");try{const r=await api("/v1/factory/jobs",{request});el("factoryRequest").value="";notice("Factory job queued: "+r.task_id+" (not sent)");await load()}catch(err){notice(err.message)}};
 el("create").onclick=async()=>{const request=el("request").value.trim();if(!request)return notice("Enter an instruction.");try{const r=await api("/v1/intent",{intent:"CREATE_TASK",request});el("request").value="";notice("Task queued: "+r.task_id);await load()}catch(err){notice(err.message)}};
})();
<\/script></body></html>`;

// src/factory-bridge.mjs
var enc = new TextEncoder();
var PROTOCOL = "METROPOLIS_FACTORY_STATION_V2";
var FACTORY_ORIGIN = "https://factory-district.internal";
var REQUEST_TIMEOUT_MS = 2e4;
var FactoryBridgeError = class extends Error {
  static {
    __name(this, "FactoryBridgeError");
  }
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function limitedString(v, max = 256) {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}
__name(limitedString, "limitedString");
async function callFactory(env, path, { method = "GET", body, headers = {}, allowConflict = false } = {}) {
  if (!env.FACTORY || typeof env.FACTORY.fetch !== "function") throw new FactoryBridgeError(503, "factory binding not configured");
  const request = new Request(FACTORY_ORIGIN + path, { method, headers, body });
  let response;
  try {
    response = await env.FACTORY.fetch(request, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new FactoryBridgeError(502, error?.name === "TimeoutError" || error?.name === "AbortError" ? "factory service timed out" : "factory service unreachable");
  }
  if (!response || !response.ok && !(allowConflict && response.status === 409)) {
    let reason = "factory refused request";
    try {
      const result = await response?.json();
      if (limitedString(result?.reason, 100)) reason = result.reason;
    } catch {
    }
    throw new FactoryBridgeError(response?.status === 403 ? 403 : response?.status === 401 ? 401 : response?.status === 503 ? 503 : 502, reason);
  }
  try {
    return await response.json();
  } catch {
    throw new FactoryBridgeError(502, "invalid factory response");
  }
}
__name(callFactory, "callFactory");
async function factoryHealth(env) {
  if (!env.FACTORY || typeof env.FACTORY.fetch !== "function") return { connection: "NOT_CONFIGURED", dispatch_enabled: false };
  try {
    const h = await callFactory(env, "/health");
    if (h?.service !== "factory-district" || h?.stationId !== "FACTORY-STATION")
      return { connection: "INVALID_TARGET", dispatch_enabled: false };
    const machinery = h.machinery ?? {};
    const machines = Object.fromEntries(["CODE", "VISUAL", "LOGIC"].map((x) => [x, machinery[x]?.status === "READY" ? "READY" : "UNKNOWN"]));
    return { connection: "CONNECTED", service: "factory-district", station_status: h.status === "READY" ? "READY" : "UNKNOWN", rail_status: h.transport?.status === "READY" ? "READY" : "UNKNOWN", machinery: machines, preflight_configured: typeof (env.FACTORY_PANTHEON_SECRET || env.FACTORY_RAIL_SECRET) === "string" && (env.FACTORY_PANTHEON_SECRET || env.FACTORY_RAIL_SECRET).length >= 32, dispatch_enabled: typeof env.FACTORY_PANTHEON_SECRET === "string" && env.FACTORY_PANTHEON_SECRET.length >= 32 && h.status === "READY" && h.transport?.status === "READY" && machines.LOGIC === "READY" };
  } catch {
    return { connection: "UNREACHABLE", dispatch_enabled: false };
  }
}
__name(factoryHealth, "factoryHealth");
function validateFactoryPreflight(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new FactoryBridgeError(400, "invalid preflight");
  const allowed = ["source", "target", "workId", "checkpointId", "ownerDomain", "intent", "scope", "inputRefs", "workPassRef", "workPass", "actingActor", "cityAuthorization", "operation", "expectedSourceSha", "requestedAt", "requestText", "requestSha256"];
  if (Object.keys(input).some((k) => !allowed.includes(k))) throw new FactoryBridgeError(400, "unsupported preflight field");
  if (!limitedString(input.workId) || !limitedString(input.checkpointId) || !limitedString(input.workPassRef) || !limitedString(input.intent, 4096))
    throw new FactoryBridgeError(400, "scoped work pass is required");
  if (input.workPass?.kind !== "WORK_PASS" || input.workPass?.version !== "WORK_PASS_V1" || input.workPass?.status !== "ACTIVE")
    throw new FactoryBridgeError(400, "active WORK_PASS_V1 required");
  if (input.workPassRef !== `work-pass://${input.workPass?.passId}` || input.workPass.workId !== input.workId || input.workPass.checkpointId !== input.checkpointId)
    throw new FactoryBridgeError(400, "work pass scope mismatch");
  if (input.target?.stationId !== "FACTORY-STATION" || input.target?.component !== "FACTORY_HALL")
    throw new FactoryBridgeError(400, "target must be Factory Station");
  if (!["CODE", "VISUAL", "LOGIC"].includes(input.ownerDomain) || !Array.isArray(input.scope) || input.scope.length === 0 || input.scope.some((s) => !limitedString(s, 1024)))
    throw new FactoryBridgeError(400, "invalid factory domain/scope");
  if (!limitedString(input.source?.stationId) || !limitedString(input.source?.system) || !limitedString(input.target?.system))
    throw new FactoryBridgeError(400, "source and target required");
  return input;
}
__name(validateFactoryPreflight, "validateFactoryPreflight");
function railCredential(env) {
  const secret = env.FACTORY_PANTHEON_SECRET || env.FACTORY_RAIL_SECRET;
  if (typeof secret !== "string" || secret.length < 32) throw new FactoryBridgeError(503, "factory rail credential not configured");
  return { secret, client: env.FACTORY_PANTHEON_SECRET ? "PANTHEON" : null };
}
__name(railCredential, "railCredential");
async function signedFactory(env, path, method, body, allowConflict = false) {
  const { secret, client } = railCredential(env);
  const serialized = body === null ? "" : JSON.stringify(body), timestamp = String(Date.now());
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(timestamp + "." + serialized)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  return callFactory(env, path, {
    method,
    body: method === "GET" ? void 0 : serialized,
    allowConflict,
    headers: {
      "content-type": "application/json",
      "x-metropolis-factory-protocol": PROTOCOL,
      "x-metropolis-factory-timestamp": timestamp,
      "x-metropolis-factory-signature": signature,
      ...client ? { "x-factory-client": client } : {}
    }
  });
}
__name(signedFactory, "signedFactory");
async function factoryPreflight(env, input) {
  const envelope2 = validateFactoryPreflight(input);
  const result = await signedFactory(env, "/station/preflight", "POST", envelope2);
  if (result?.status !== "READY" || result?.allowed !== true || result?.workId !== envelope2.workId || result?.checkpointId !== envelope2.checkpointId || result?.workPassRef !== envelope2.workPassRef)
    throw new FactoryBridgeError(502, "factory preflight not verified");
  return { status: "READY", allowed: true, workId: result.workId, checkpointId: result.checkpointId, workPassRef: result.workPassRef, sourceSha: result.sourceSha, validationScope: result.validationScope, observedAt: result.observedAt, dispatched: false };
}
__name(factoryPreflight, "factoryPreflight");
async function factoryDispatch(env, input) {
  const envelope2 = validateFactoryPreflight(input);
  const result = await signedFactory(env, "/station/receive", "POST", envelope2, true);
  if (!result?.receipt || result.receipt.workId !== envelope2.workId || result.receipt.checkpointId !== envelope2.checkpointId || result.receipt.workPassRef !== envelope2.workPassRef || !/^receipt-[A-Za-z0-9-]{8,80}$/.test(result.receipt.receiptId || ""))
    throw new FactoryBridgeError(502, "factory receipt identity mismatch");
  return result;
}
__name(factoryDispatch, "factoryDispatch");
async function factoryReadback(env, receiptId) {
  if (typeof receiptId !== "string" || !/^receipt-[A-Za-z0-9-]{8,80}$/.test(receiptId))
    throw new FactoryBridgeError(400, "invalid receipt ID");
  return signedFactory(env, "/station/readback/" + encodeURIComponent(receiptId), "GET", null);
}
__name(factoryReadback, "factoryReadback");
async function factoryReconcile(env, input) {
  const envelope2 = validateFactoryPreflight(input);
  const result = await signedFactory(env, "/station/reconcile", "POST", envelope2, true);
  if (result?.status === "UNKNOWN") throw new FactoryBridgeError(
    409,
    typeof result.reason === "string" ? result.reason : "factory effect unverified"
  );
  if (!["RECOVERED", "RECORDED"].includes(result?.status) || !result.receipt || result.receipt.workId !== envelope2.workId || result.receipt.checkpointId !== envelope2.checkpointId || result.receipt.workPassRef !== envelope2.workPassRef)
    throw new FactoryBridgeError(502, "factory reconciliation identity mismatch");
  return result;
}
__name(factoryReconcile, "factoryReconcile");

// src/factory-jobs.mjs
var enc2 = new TextEncoder();
var stamp = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "stamp");
var uid = /* @__PURE__ */ __name((x) => x + "_" + crypto.randomUUID().replaceAll("-", ""), "uid");
var statement = /* @__PURE__ */ __name((db, sql, ...args) => db.prepare(sql).bind(...args), "statement");
var validId = /* @__PURE__ */ __name((x) => {
  if (typeof x !== "string" || !/^task_[a-f0-9]{32}$/.test(x)) throw new FactoryBridgeError(400, "invalid task ID");
  return x;
}, "validId");
async function digest(s) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc2.encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
__name(digest, "digest");
function boundedRequest(text) {
  if (typeof text !== "string" || !text.trim() || text.length > 2048) throw new FactoryBridgeError(400, "invalid Factory request");
  return text;
}
__name(boundedRequest, "boundedRequest");
async function job(db, taskId) {
  const row = await statement(db, "SELECT j.*,t.request_text,t.request_sha256,t.latest_run_id,t.status AS task_status FROM factory_jobs j JOIN tasks t ON t.task_id=j.task_id WHERE j.task_id=?", validId(taskId)).first();
  if (!row) throw new FactoryBridgeError(404, "Factory job not found");
  return row;
}
__name(job, "job");
function envelope(j) {
  if(j.task_id===L1_TASK_ID){
    const base=envelope({...j,task_id:'task_'+'0'.repeat(32)});
    return {...base,workId:L1_TASK_ID,checkpointId:'cp-'+L1_TASK_ID,intent:L1_INTENT,scope:[L1_SCOPE],requestText:j.request_text,requestSha256:j.request_sha256,
      workPassRef:'work-pass://pantheon-'+L1_TASK_ID,workPass:{...base.workPass,passId:'pantheon-'+L1_TASK_ID,workId:L1_TASK_ID,checkpointId:'cp-'+L1_TASK_ID}};
  }
  const taskId = validId(j.task_id), cp = "cp-" + taskId;
  return {
    workId: taskId,
    checkpointId: cp,
    ownerDomain: "LOGIC",
    intent: "PLACE_DWARF_LOGIC_TRAINEE",
    scope: ["EXECUTE:LOGIC"],
    inputRefs: [],
    source: { stationId: "PANTHEON", system: "pantheon-workhub" },
    target: { stationId: "FACTORY-STATION", system: "factory-district", component: "FACTORY_HALL" },
    workPassRef: "work-pass://pantheon-" + taskId,
    workPass: {
      kind: "WORK_PASS",
      version: "WORK_PASS_V1",
      status: "ACTIVE",
      passId: "pantheon-" + taskId,
      actor: "PANTHEON",
      workId: taskId,
      checkpointId: cp,
      permissions: { actions: ["handoff"], handoff: [{ stationId: "FACTORY_STATION" }] },
      authorityTransferred: false
    }
  };
}
__name(envelope, "envelope");
async function audit(db, taskId, type, details = {}) {
  await statement(
    db,
    "INSERT INTO events(event_id,task_id,type,actor,details_json,created_at) VALUES(?, ?, ?, 'pantheon-factory', ?, ?)",
    uid("evt"),
    taskId,
    type,
    JSON.stringify(details),
    stamp()
  ).run();
}
__name(audit, "audit");
async function queueFactoryJob(db, request) {
  const value = boundedRequest(request), taskId = uid("task"), actionKey = uid("act"), time = stamp(), hash = await digest(value);
  await db.batch([
    statement(db, "INSERT INTO tasks(task_id,status,request_text,request_sha256,created_at,updated_at) VALUES(?,'QUEUED',?,?,?,?)", taskId, value, hash, time, time),
    statement(db, "INSERT INTO actions(action_key,task_id,tool_name,input_sha256,status) VALUES(?,?,'factory.logic.trainee',?,'PREPARED')", actionKey, taskId, hash),
    statement(db, "INSERT INTO factory_jobs(task_id,status,updated_at) VALUES(?,'QUEUED',?)", taskId, time),
    statement(db, "INSERT INTO events(event_id,task_id,type,actor,details_json,created_at) VALUES(?,?,'FACTORY_TASK_QUEUED','cloud-owner',?,?)", uid("evt"), taskId, JSON.stringify({ input_sha256: hash }), time)
  ]);
  return { task_id: taskId, status: "QUEUED", executed: false, domain: "LOGIC", machine: "DWARF-01", mode: "TRAINING" };
}
__name(queueFactoryJob, "queueFactoryJob");
// An existing action is the scope declaration: never infer Factory authority from prose.
async function queueExistingFactoryJob(db, taskId) {
  validId(taskId);
  const original = await statement(db, "SELECT * FROM tasks WHERE task_id=?", taskId).first();
  if (!original) throw new FactoryBridgeError(404, "task not found");
  const hash = await digest(original.request_text);
  if (hash !== original.request_sha256) throw new FactoryBridgeError(409, "request hash mismatch");
  const eligible = `t.status='QUEUED' AND t.latest_run_id IS NULL AND t.last_error IS NULL
    AND t.request_sha256=? AND t.request_text=?
    AND (a.tool_name='factory.logic.trainee' OR (t.task_id='${L1_TASK_ID}' AND t.request_sha256='${L1_REQUEST_SHA256}' AND a.tool_name='d1.create_text_artifact')) AND a.status='PREPARED'
    AND a.input_sha256=t.request_sha256 AND a.receipt_sha256 IS NULL
    AND NOT EXISTS(SELECT 1 FROM runs WHERE task_id=t.task_id)
    AND NOT EXISTS(SELECT 1 FROM artifacts WHERE task_id=t.task_id)`;
  const time = stamp();
  // D1 batch is transactional. Conditional insert + primary key arbitrate concurrent
  // callers; changes() ties the audit to this insert, never to a prior queue attempt.
  // Final read is in the same transaction so dispatch cannot race the response snapshot.
  const result = await db.batch([
    statement(db, `INSERT INTO factory_jobs(task_id,status,updated_at)
      SELECT t.task_id,'QUEUED',? FROM tasks t JOIN actions a ON a.task_id=t.task_id
      WHERE t.task_id=? AND ${eligible}
      ON CONFLICT(task_id) DO NOTHING`, time, taskId, hash, original.request_text),
    statement(db, `INSERT INTO events(event_id,task_id,type,actor,details_json,created_at)
      SELECT ?,?,'FACTORY_TASK_QUEUED','cloud-owner',?,? WHERE changes()=1
      RETURNING event_id`, uid("evt"), taskId, JSON.stringify({ input_sha256: hash }), time),
    statement(db, `SELECT t.task_id,a.tool_name,j.status AS job_status,
      j.receipt_id,j.source_sha,j.result_json,j.result_sha256,j.last_error,
      (${eligible}) AS eligible
      FROM tasks t LEFT JOIN actions a ON a.task_id=t.task_id
      LEFT JOIN factory_jobs j ON j.task_id=t.task_id WHERE t.task_id=?`, hash, original.request_text, taskId)
  ]);
  const row = result[2].results[0];
  if (!row) throw new FactoryBridgeError(404, "task not found");
  if (row.tool_name !== "factory.logic.trainee" && !(taskId===L1_TASK_ID && hash===L1_REQUEST_SHA256 && row.tool_name==="d1.create_text_artifact"))
    throw new FactoryBridgeError(422, "UNSUPPORTED: existing action has no supported Factory mapping; task unchanged");
  if (!row.eligible || row.job_status !== "QUEUED" ||
      [row.receipt_id,row.source_sha,row.result_json,row.result_sha256,row.last_error].some(v => v !== null))
    throw new FactoryBridgeError(409, "Factory task is not eligible for queue; existing state preserved");
  return { task_id: taskId, status: "QUEUED", request_sha256: hash,
    already_queued: result[1].results.length === 0, executed: false,
    domain: "LOGIC", machine: taskId===L1_TASK_ID?"L1_TEXT_ARTIFACT":"DWARF-01", mode: taskId===L1_TASK_ID?"ISOLATED_ARTIFACT":"TRAINING" };
}
__name(queueExistingFactoryJob, "queueExistingFactoryJob");
async function verifiedL1Job(db,j,env){
  const action=await statement(db,"SELECT * FROM actions WHERE task_id=?",j.task_id).first();
  const run=await statement(db,"SELECT * FROM runs WHERE run_id=? AND task_id=?",j.latest_run_id,j.task_id).first();
  if(j.request_sha256!==L1_REQUEST_SHA256 || await digest(j.request_text)!==L1_REQUEST_SHA256 || j.task_status!=='COMPLETED' || j.receipt_id!==L1_RECEIPT_ID || !j.result_json || await digest(j.result_json)!==j.result_sha256 || action?.status!=='VERIFIED' || action.tool_name!=='d1.create_text_artifact' || action.input_sha256!==L1_REQUEST_SHA256 || action.receipt_sha256!==j.result_sha256 || run?.status!=='COMPLETED')throw new FactoryBridgeError(409,"L1 stored completion evidence mismatch");
  const back=await factoryReadback(env,L1_RECEIPT_ID);
  if(!await verifyL1Readback(back) || j.source_sha!==back.sourceSha || await digest(JSON.stringify(back))!==j.result_sha256)throw new FactoryBridgeError(502,"L1 fresh artifact readback verification failed");
  return back;
}
async function showFactoryJob(db, taskId, env) {
  const j = await job(db, taskId);
  if(taskId===L1_TASK_ID && j.status==='COMPLETED'){
    const back=await verifiedL1Job(db,j,env);
    return {...j,result:back,verification_source:'FACTORY_AUTHENTICATED_READBACK',owner_verified:true};
  }
  const { request_text, receipt_id, status, source_sha, result_json, result_sha256, last_error, updated_at, task_status } = j;
  return {
    task_id: taskId,
    request_text,
    receipt_id,
    status,
    source_sha,
    result_sha256,
    last_error,
    updated_at,
    task_status,
    result: result_json ? JSON.parse(result_json) : null
  };
}
__name(showFactoryJob, "showFactoryJob");
function verifyBack(j, back, receiptId) {
  const e = envelope(j);
  if (back?.receiptId !== receiptId || back.workId !== e.workId || back.checkpointId !== e.checkpointId || back.workPassRef !== e.workPassRef || back.actingActor !== "PANTHEON")
    throw new FactoryBridgeError(502, "factory readback identity mismatch");
  return back.status === "HANDOFF_VERIFIED" && back.boundaryVerified === true && back.domainCompleted === true && back.domainVerified === true && !!back.evidenceRef && Array.isArray(back.result?.evidenceRefs) && back.result.evidenceRefs.length > 0 && back.result.evidenceRefs.every((x) => typeof x === "string" && x.length > 0);
}
__name(verifyBack, "verifyBack");
async function markUncertain(db, taskId, error) {
  const reason = String(error?.message || "FACTORY_EFFECT_UNCERTAIN").slice(0, 240);
  await db.batch([
    statement(db, "UPDATE factory_jobs SET status='NEEDS_RECONCILIATION',last_error=?,updated_at=? WHERE task_id=?", reason, stamp(), taskId),
    statement(db, "UPDATE tasks SET status='NEEDS_RECONCILIATION',last_error=?,updated_at=? WHERE task_id=?", reason, stamp(), taskId)
  ]);
  await audit(db, taskId, "FACTORY_EFFECT_UNCERTAIN", { reason });
}
__name(markUncertain, "markUncertain");
async function settle(db, j, back, receiptId) {
  const verified = verifyBack(j, back, receiptId), time = stamp(), serialized = JSON.stringify(back), hash = await digest(serialized);
  if (serialized.length > 32768) throw new FactoryBridgeError(502, "factory readback too large");
  const state = verified ? "COMPLETED" : "NEEDS_RECONCILIATION";
  await db.batch([
    statement(
      db,
      "UPDATE factory_jobs SET status=?,receipt_id=?,source_sha=?,result_json=?,result_sha256=?,last_error=?,updated_at=? WHERE task_id=?",
      state,
      receiptId,
      String(back.sourceSha || "").slice(0, 100),
      serialized,
      hash,
      verified ? null : String(back.reason || "DOMAIN_NOT_VERIFIED").slice(0, 240),
      time,
      j.task_id
    ),
    statement(db, "UPDATE tasks SET status=?,last_error=?,updated_at=? WHERE task_id=?", state, verified ? null : "domain result unverified", time, j.task_id)
  ]);
  await audit(
    db,
    j.task_id,
    verified ? "FACTORY_RESULT_VERIFIED" : "FACTORY_RESULT_UNVERIFIED",
    { receipt_id: receiptId, readback_sha256: hash, domain_verified: verified, source_sha: back.sourceSha || null }
  );
  return {
    task_id: j.task_id,
    status: state,
    verified,
    receipt_id: receiptId,
    source_sha: back.sourceSha || null,
    result: back.result || null,
    evidence_ref: back.evidenceRef || null,
    readback_sha256: hash
  };
}
__name(settle, "settle");
async function dispatchL1Job(db,env,taskId,reconcile){
  const j=await job(db,taskId);
  if(j.request_sha256!==L1_REQUEST_SHA256 || await digest(j.request_text)!==L1_REQUEST_SHA256)throw new FactoryBridgeError(409,"L1 request hash mismatch");
  if(j.status==='COMPLETED'){const back=await verifiedL1Job(db,j,env);return {task_id:taskId,status:'COMPLETED',verified:true,already_completed:true,receipt_id:L1_RECEIPT_ID,result:back.result};}
  if(typeof env.FACTORY_PANTHEON_SECRET!=='string'||env.FACTORY_PANTHEON_SECRET.length<32)throw new FactoryBridgeError(503,"isolated Pantheon rail not configured");
  if(reconcile){
    if(!['NEEDS_RECONCILIATION','DISPATCHING'].includes(j.status))throw new FactoryBridgeError(409,"L1 reconciliation requires uncertain dispatch");
  }else if(j.status==='NEEDS_RECONCILIATION'){
    // Only an explicitly approved dispatch may resume a known-absent effect.
    // Reconciliation itself remains read-only at Factory. CAS still arbitrates
    // a delayed original request racing this retry without a second artifact.
    try{await factoryReadback(env,L1_RECEIPT_ID);return dispatchL1Job(db,env,taskId,true);}
    catch(error){if(error.message!=='RECEIPT_NOT_FOUND')throw error;}
    const time=stamp();
    const claim=await db.batch([
      statement(db,`UPDATE tasks SET status='RUNNING',last_error=NULL,updated_at=? WHERE task_id=? AND status='NEEDS_RECONCILIATION' AND latest_run_id=? AND request_sha256=? AND request_text=?
        AND EXISTS(SELECT 1 FROM factory_jobs WHERE task_id=? AND status='NEEDS_RECONCILIATION')
        AND EXISTS(SELECT 1 FROM actions WHERE task_id=? AND tool_name='d1.create_text_artifact' AND status='REQUESTED' AND input_sha256=?) RETURNING task_id`,time,taskId,j.latest_run_id,L1_REQUEST_SHA256,j.request_text,taskId,taskId,L1_REQUEST_SHA256),
      statement(db,"UPDATE factory_jobs SET status='DISPATCHING',last_error=NULL,updated_at=? WHERE task_id=? AND changes()=1",time,taskId)
    ]);
    if(!claim[0].results.length)throw new FactoryBridgeError(409,"L1 resume already claimed or ineligible");
  }else{
    const runId=uid('run'),time=stamp();
    const claim=await db.batch([
      statement(db,`UPDATE tasks SET status='RUNNING',latest_run_id=?,updated_at=? WHERE task_id=? AND status='QUEUED' AND latest_run_id IS NULL
        AND request_sha256=? AND request_text=? AND EXISTS(SELECT 1 FROM factory_jobs WHERE task_id=? AND status='QUEUED')
        AND EXISTS(SELECT 1 FROM actions WHERE task_id=? AND tool_name='d1.create_text_artifact' AND status='PREPARED' AND input_sha256=? AND receipt_sha256 IS NULL)
        AND NOT EXISTS(SELECT 1 FROM runs WHERE task_id=?) AND NOT EXISTS(SELECT 1 FROM artifacts WHERE task_id=?) RETURNING task_id`,runId,time,taskId,L1_REQUEST_SHA256,j.request_text,taskId,taskId,L1_REQUEST_SHA256,taskId,taskId),
      statement(db,"UPDATE factory_jobs SET status='DISPATCHING',updated_at=? WHERE task_id=? AND changes()=1",time,taskId),
      statement(db,"INSERT INTO runs(run_id,task_id,status,started_at) SELECT ?,?,'RUNNING',? WHERE EXISTS(SELECT 1 FROM tasks WHERE task_id=? AND latest_run_id=?)",runId,taskId,time,taskId,runId),
      statement(db,"UPDATE actions SET status='REQUESTED' WHERE task_id=? AND EXISTS(SELECT 1 FROM tasks WHERE task_id=? AND latest_run_id=?)",taskId,taskId,runId)
    ]);
    if(!claim[0].results.length)throw new FactoryBridgeError(409,"L1 task already claimed or ineligible");
  }
  try{
    const data=envelope(j);
    if(reconcile)await factoryReconcile(env,data);
    else {await factoryPreflight(env,data);await factoryDispatch(env,data);}
    const back=await factoryReadback(env,L1_RECEIPT_ID);
    if(!await verifyL1Readback(back))throw new FactoryBridgeError(502,"L1 artifact readback verification failed");
    const time=stamp(),serialized=JSON.stringify(back),hash=await digest(serialized);
    await db.batch([
      statement(db,"UPDATE factory_jobs SET status='COMPLETED',receipt_id=?,source_sha=?,result_json=?,result_sha256=?,last_error=NULL,updated_at=? WHERE task_id=? AND status IN ('DISPATCHING','NEEDS_RECONCILIATION')",L1_RECEIPT_ID,back.sourceSha,serialized,hash,time,taskId),
      statement(db,"INSERT INTO events(event_id,task_id,type,actor,details_json,created_at) SELECT ?,?,'FACTORY_L1_VERIFIED','pantheon-factory',?,? WHERE changes()=1",uid('evt'),taskId,JSON.stringify({receipt_id:L1_RECEIPT_ID,artifact_sha256:back.result.contentSha256}),time),
      statement(db,"UPDATE tasks SET status='COMPLETED',last_error=NULL,updated_at=? WHERE task_id=?",time,taskId),
      statement(db,"UPDATE actions SET status='VERIFIED',receipt_sha256=? WHERE task_id=?",hash,taskId),
      statement(db,"UPDATE runs SET status='COMPLETED',finished_at=? WHERE run_id=(SELECT latest_run_id FROM tasks WHERE task_id=?)",time,taskId)
    ]);
    return {task_id:taskId,status:'COMPLETED',verified:true,receipt_id:L1_RECEIPT_ID,result:back.result,readback_sha256:hash};
  }catch(error){
    const reason=String(error.message||'L1_EFFECT_UNCERTAIN').slice(0,240),time=stamp();
    await db.batch([
      statement(db,"UPDATE factory_jobs SET status='NEEDS_RECONCILIATION',last_error=?,updated_at=? WHERE task_id=? AND status!='COMPLETED'",reason,time,taskId),
      statement(db,"UPDATE tasks SET status='NEEDS_RECONCILIATION',last_error=?,updated_at=? WHERE task_id=? AND status!='COMPLETED'",reason,time,taskId)
    ]);
    throw new FactoryBridgeError(409,"L1 effect uncertain; reconcile exact task before any retry");
  }
}
async function dispatchFactoryJob(db, env, taskId, { reconcile = false } = {}) {
  if(taskId===L1_TASK_ID)return dispatchL1Job(db,env,taskId,reconcile);
  if (typeof env.FACTORY_PANTHEON_SECRET !== "string" || env.FACTORY_PANTHEON_SECRET.length < 32)
    throw new FactoryBridgeError(503, "isolated Pantheon rail not configured");
  const j = await job(db, taskId);
  const eligible = reconcile ? ["NEEDS_RECONCILIATION", "DISPATCHING"] : ["QUEUED"];
  if (!eligible.includes(j.status)) throw new FactoryBridgeError(409, "Factory job not eligible for " + (reconcile ? "reconciliation" : "dispatch"));
  const claim = await statement(db, "UPDATE factory_jobs SET status='DISPATCHING',updated_at=? WHERE task_id=? AND status=? RETURNING task_id", stamp(), taskId, j.status).all();
  if (!claim.results?.length) throw new FactoryBridgeError(409, "Factory job already claimed");
  await statement(db, "UPDATE tasks SET status='RUNNING',updated_at=? WHERE task_id=?", stamp(), taskId).run();
  await audit(db, taskId, reconcile ? "FACTORY_RECONCILIATION_REQUESTED" : "FACTORY_DISPATCH_REQUESTED");
  try {
    if (j.receipt_id) {
      let back2;
      try {
        back2 = await factoryReadback(env, j.receipt_id);
      } catch (error) {
        if (error.message !== "RECEIPT_NOT_FOUND") throw error;
        const recovered = await factoryReconcile(env, envelope(j));
        if (recovered.receipt.receiptId !== j.receipt_id)
          throw new FactoryBridgeError(502, "recovered receipt mismatch");
        await audit(db, taskId, "FACTORY_RECEIPT_RECOVERED", { receipt_id: j.receipt_id });
        back2 = await factoryReadback(env, j.receipt_id);
      }
      return await settle(db, j, back2, j.receipt_id);
    }
    const data = envelope(j);
    const preflight = await factoryPreflight(env, data);
    await audit(db, taskId, "FACTORY_PREFLIGHT_VERIFIED", { source_sha: preflight.sourceSha || null });
    let dispatched;
    if (reconcile) {
      try {
        dispatched = await factoryReconcile(env, data);
      } catch (error) {
        if (error.message !== "FACTORY_CLAIM_NOT_FOUND") throw error;
      }
    }
    if (!dispatched) dispatched = await factoryDispatch(env, data);
    const receipt = dispatched.receipt.receiptId;
    await statement(db, "UPDATE factory_jobs SET receipt_id=?,status='DISPATCHING',updated_at=? WHERE task_id=?", receipt, stamp(), taskId).run();
    await audit(db, taskId, "FACTORY_RECEIPT_RECORDED", { receipt_id: receipt });
    const back = await factoryReadback(env, receipt);
    return await settle(db, j, back, receipt);
  } catch (error) {
    await markUncertain(db, taskId, error);
    if (error instanceof FactoryBridgeError) throw error;
    throw new FactoryBridgeError(502, "Factory result uncertain; reconcile before retry");
  }
}
__name(dispatchFactoryJob, "dispatchFactoryJob");

// src/worker.mjs
var enc3 = new TextEncoder();
var TIMING_WINDOW_MS = 6e4;
var id = /* @__PURE__ */ __name((prefix) => prefix + "_" + crypto.randomUUID().replaceAll("-", ""), "id");
var now = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
var sha256 = /* @__PURE__ */ __name(async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc3.encode(text)))].map((v) => v.toString(16).padStart(2, "0")).join(""), "sha256");
var reply = /* @__PURE__ */ __name((data, status = 200, type = "application/json; charset=utf-8") => new Response(type.includes("json") ? JSON.stringify(data) : data, { status, headers: { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" } }), "reply");
var ApiError = class extends Error {
  static {
    __name(this, "ApiError");
  }
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function requireObject(v, keys) {
  if (!v || Array.isArray(v) || typeof v !== "object" || Object.keys(v).sort().join("|") !== keys.slice().sort().join("|")) throw new ApiError(400, "invalid fields");
}
__name(requireObject, "requireObject");
async function authorize(request, env) {
  if (typeof env.WORKHUB_TOKEN !== "string" || env.WORKHUB_TOKEN.length < 32) throw new ApiError(503, "authentication not configured");
  const supplied = request.headers.get("authorization") || "";
  const expected = "Bearer " + env.WORKHUB_TOKEN;
  if (supplied.length !== expected.length) throw new ApiError(401, "unauthorized");
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  if (difference) throw new ApiError(401, "unauthorized");
}
__name(authorize, "authorize");
async function bodyJson(request) {
  const text = await request.text();
  if (text.length > 8192) throw new ApiError(413, "request too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid JSON");
  }
}
__name(bodyJson, "bodyJson");
function stmt(db, sql, ...params) {
  return db.prepare(sql).bind(...params);
}
__name(stmt, "stmt");
async function event(db, taskId, runId, type, details = "{}") {
  await stmt(
    db,
    "INSERT INTO events(event_id,task_id,run_id,type,actor,details_json,created_at) VALUES(?,?,?,?,?,?,?)",
    id("evt"),
    taskId,
    runId,
    type,
    "cloud-owner",
    details,
    now()
  ).run();
}
__name(event, "event");
function validId2(v) {
  if (typeof v !== "string" || !/^task_[a-f0-9]{32}$/.test(v)) throw new ApiError(400, "invalid task ID");
  return v;
}
__name(validId2, "validId");
function parseIntent(value) {
  return validateIntent(value, message => new ApiError(400, message));
}
__name(parseIntent, "parseIntent");
// Outcome routing is authenticated by the same owner boundary as explicit intents.
// It may read or propose a plan; it cannot grant, prepare, run or dispatch writes.
async function routeOutcome(db, input) {
  validateOutcome(input, message => new ApiError(400, message));
  const original = input.task_id ? await getTask(db, input.task_id) : null;
  if (original && await sha256(original.request_text) !== original.request_sha256)
    throw new ApiError(409, "request hash mismatch");
  const identity = {request:input.request, task_id:original?.task_id ?? null,
    original_request:original?.request_text ?? input.request,
    request_sha256:original?.request_sha256 ?? await sha256(input.request)};
  const proposal = validateProposal(proposeOutcome(input), parseIntent);
  const base = {...identity, plan_id:await sha256(JSON.stringify(identity)),
    executed:false, completed:false, verified:false, authorization:'OWNER_READ_OR_PLAN_ONLY'};
  if (proposal.status === 'DISCOVERY') return {...base,...proposal,
    capabilities:Object.entries(INTENT_CONTRACTS).map(([intent,c]) => ({intent,...c,dispatch_enabled:false})),
    factory:{connectivity:'NOT_CHECKED',executable_for_this_request:false,
      domains:['build a click-counter website','render a static card','place a LOGIC trainee'].map(request => proposeOutcome({request})),
      note:'Factory owns runner registration. Health READY is registration, not job execution or caller authority. Exact L1 remains task-bound.'}};
  if (!proposal.action) return {...base,...proposal};
  const {action,contract} = proposal;
  if ((action.intent === 'SHOW_TASK' && action.task_id !== original?.task_id) ||
      (action.intent === 'CREATE_TASK' && action.request !== input.request))
    throw new ApiError(409, 'proposal identity mismatch');
  if (contract.effect !== 'read') {
    // Never bind a new action to an existing task or relabel its declared tool.
    if (original) return {...base,status:'UNSUPPORTED',reason:'EXISTING_TASK_ACTION_IMMUTABLE'};
    return {...base,status:'PLANNED',action,capability:contract.tool,
      reason:'EXPLICIT_PREPARATION_REQUIRED',dispatch_enabled:false,
      boundary:'Existing CREATE_TASK prepares only a D1 text artifact; run and readback remain separate. No Factory work.'};
  }
  const result = action.intent === 'SHOW_TASK' ? {task:original} :
    {tasks:(await stmt(db, "SELECT t.task_id,t.status,t.request_text,t.created_at,t.updated_at,a.tool_name FROM tasks t JOIN actions a ON a.task_id=t.task_id ORDER BY t.created_at DESC LIMIT 100").all()).results};
  // Reading a COMPLETED task is not verification of the requested artifact.
  return {...base,status:'READ',capability:contract.tool,result,
    evidence:{kind:'D1_TASK_READ',task_id:original?.task_id ?? null},
    verification:'TASK_METADATA_ONLY_NOT_ARTIFACT_READBACK'};
}
async function queue(db, request) {
  const taskId = id("task"), actionKey = id("act"), timestamp = now(), digest2 = await sha256(request);
  await db.batch([
    stmt(db, "INSERT INTO tasks(task_id,status,request_text,request_sha256,created_at,updated_at) VALUES(?,'QUEUED',?,?,?,?)", taskId, request, digest2, timestamp, timestamp),
    stmt(db, "INSERT INTO actions(action_key,task_id,tool_name,input_sha256,status) VALUES(?,?,'d1.create_text_artifact',?,'PREPARED')", actionKey, taskId, digest2),
    stmt(db, "INSERT INTO events(event_id,task_id,type,actor,details_json,created_at) VALUES(?,?,'TASK_QUEUED','cloud-owner',?,?)", id("evt"), taskId, JSON.stringify({ request_sha256: digest2 }), timestamp)
  ]);
  return { task_id: taskId, status: "QUEUED", executed: false };
}
__name(queue, "queue");
async function getTask(db, taskId) {
  const task = await stmt(db, "SELECT * FROM tasks WHERE task_id=?", validId2(taskId)).first();
  if (!task) throw new ApiError(404, "task not found");
  return task;
}
__name(getTask, "getTask");
async function inspect(db, taskId) {
  const row = await stmt(db, "SELECT a.action_key,a.input_sha256,x.content,x.sha256 AS stored_sha256 FROM actions a LEFT JOIN artifacts x ON x.action_key=a.action_key WHERE a.task_id=?", taskId).first();
  if (!row) throw new ApiError(409, "missing action");
  if (row.content === null || row.content === void 0) return { exists: false, matches: false, action_key: row.action_key };
  const hash = await sha256(row.content);
  return { exists: true, matches: hash === row.input_sha256 && hash === row.stored_sha256, sha256: hash, action_key: row.action_key };
}
__name(inspect, "inspect");
async function markComplete(db, taskId, runId, digest2, recovered = false) {
  const timestamp = now();
  await db.batch([
    stmt(db, "UPDATE actions SET status='VERIFIED',receipt_sha256=? WHERE task_id=? AND status IN ('REQUESTED','EFFECT_RECORDED')", digest2, taskId),
    stmt(db, "UPDATE tasks SET status='COMPLETED',updated_at=?,last_error=NULL WHERE task_id=? AND status IN ('RUNNING','NEEDS_RECONCILIATION')", timestamp, taskId),
    stmt(db, "UPDATE runs SET status='COMPLETED',finished_at=? WHERE run_id=?", timestamp, runId),
    stmt(db, "INSERT INTO events(event_id,task_id,run_id,type,actor,details_json,created_at) VALUES(?,?,?,'VERIFICATION_PASSED','cloud-owner',?,?)", id("evt"), taskId, runId, JSON.stringify({ sha256: digest2, recovered }), timestamp),
    stmt(db, "INSERT INTO events(event_id,task_id,run_id,type,actor,details_json,created_at) VALUES(?,?,?,'TASK_COMPLETED','cloud-owner','{}',?)", id("evt"), taskId, runId, timestamp)
  ]);
}
__name(markComplete, "markComplete");
async function runTask(db, taskId) {
  if(taskId===L1_TASK_ID)throw new ApiError(409,"exact L1 task requires Factory executor");
  const task = await getTask(db, taskId), runId = id("run"), timestamp = now();
  const executor = await stmt(db, "SELECT tool_name FROM actions WHERE task_id=?", taskId).first();
  if (executor?.tool_name !== "d1.create_text_artifact") throw new ApiError(409, "task requires Factory executor");
  if (task.status !== "QUEUED") throw new ApiError(409, "task is not QUEUED");
  const claim = await db.batch([
    stmt(db, "UPDATE tasks SET status='RUNNING',latest_run_id=?,updated_at=? WHERE task_id=? AND status='QUEUED' RETURNING task_id", runId, timestamp, taskId),
    stmt(db, "INSERT INTO runs(run_id,task_id,status,started_at) SELECT ?,task_id,'RUNNING',? FROM tasks WHERE task_id=? AND latest_run_id=? AND status='RUNNING'", runId, timestamp, taskId, runId),
    stmt(db, "UPDATE actions SET status='REQUESTED' WHERE task_id=? AND status='PREPARED' AND EXISTS (SELECT 1 FROM tasks WHERE task_id=? AND latest_run_id=? AND status='RUNNING')", taskId, taskId, runId),
    stmt(db, "INSERT INTO events(event_id,task_id,run_id,type,actor,details_json,created_at) SELECT ?,?,?,'ACTION_REQUESTED','cloud-owner','{}',? WHERE EXISTS (SELECT 1 FROM actions WHERE task_id=? AND status='REQUESTED') AND EXISTS (SELECT 1 FROM tasks WHERE task_id=? AND latest_run_id=? AND status='RUNNING')", id("evt"), taskId, runId, timestamp, taskId, taskId, runId)
  ]);
  if (!claim[0]?.results?.length) throw new ApiError(409, "task already claimed");
  try {
    const action = await stmt(db, "SELECT * FROM actions WHERE task_id=?", taskId).first();
    if (action?.status !== "REQUESTED") throw new Error("action not prepared");
    await stmt(
      db,
      "INSERT INTO artifacts(action_key,task_id,content,sha256,created_at) VALUES(?,?,?,?,?) ON CONFLICT(action_key) DO NOTHING",
      action.action_key,
      taskId,
      task.request_text,
      task.request_sha256,
      now()
    ).run();
    const observed = await inspect(db, taskId);
    if (!observed.matches) throw new Error("artifact readback mismatch");
    await markComplete(db, taskId, runId, observed.sha256);
    return { task_id: taskId, status: "COMPLETED", verified: true, run_id: runId };
  } catch (err) {
    await db.batch([
      stmt(db, "UPDATE tasks SET status='NEEDS_RECONCILIATION',last_error=?,updated_at=? WHERE task_id=? AND status='RUNNING'", String(err.message).slice(0, 300), now(), taskId),
      stmt(db, "UPDATE runs SET status='UNKNOWN',finished_at=? WHERE run_id=? AND status='RUNNING'", now(), runId)
    ]);
    throw new ApiError(409, "effect uncertain; reconciliation required");
  }
}
__name(runTask, "runTask");
async function recover(db, taskId) {
  if(taskId===L1_TASK_ID)throw new ApiError(409,"exact L1 task requires Factory reconciliation");
  const task = await getTask(db, taskId);
  const executor = await stmt(db, "SELECT tool_name FROM actions WHERE task_id=?", taskId).first();
  if (executor?.tool_name !== "d1.create_text_artifact") throw new ApiError(409, "task requires Factory reconciliation");
  if (!["RUNNING", "NEEDS_RECONCILIATION"].includes(task.status)) throw new ApiError(409, "not recoverable");
  if (Date.now() - Date.parse(task.updated_at) < TIMING_WINDOW_MS) throw new ApiError(409, "run may still be active");
  const observed = await inspect(db, taskId), timestamp = now();
  if (observed.exists && observed.matches) {
    await markComplete(db, taskId, task.latest_run_id, observed.sha256, true);
    return { task_id: taskId, status: "COMPLETED", verified: true, recovered: true };
  }
  if (observed.exists) {
    await stmt(db, "UPDATE tasks SET status='NEEDS_RECONCILIATION',last_error='artifact content mismatch',updated_at=? WHERE task_id=?", timestamp, taskId).run();
    return { task_id: taskId, status: "NEEDS_RECONCILIATION", verified: false };
  }
  await db.batch([
    stmt(db, "UPDATE tasks SET status='FAILED',last_error='verified absent; explicit retry required',updated_at=? WHERE task_id=?", timestamp, taskId),
    stmt(db, "UPDATE actions SET status='PREPARED' WHERE task_id=? AND status='REQUESTED'", taskId),
    stmt(db, "UPDATE runs SET status='NO_EFFECT',finished_at=? WHERE run_id=?", timestamp, task.latest_run_id),
    stmt(db, "INSERT INTO events(event_id,task_id,run_id,type,actor,details_json,created_at) VALUES(?,?,?,'RECONCILED_NO_EFFECT','cloud-owner','{}',?)", id("evt"), taskId, task.latest_run_id, timestamp)
  ]);
  return { task_id: taskId, status: "FAILED", verified_absent: true, retry_required: true };
}
__name(recover, "recover");
async function retry(db, taskId) {
  if(taskId===L1_TASK_ID)throw new ApiError(409,"exact L1 task requires Factory reconciliation");
  const task = await getTask(db, taskId);
  const executor = await stmt(db, "SELECT tool_name FROM actions WHERE task_id=?", taskId).first();
  if (executor?.tool_name !== "d1.create_text_artifact") throw new ApiError(409, "task requires Factory reconciliation");
  if (task.status !== "FAILED") throw new ApiError(409, "retry requires failed/no-effect recovery");
  const seen = await inspect(db, taskId);
  if (seen.exists) throw new ApiError(409, "cannot retry existing artifact");
  const result = await stmt(db, "UPDATE tasks SET status='QUEUED',updated_at=?,last_error=NULL WHERE task_id=? AND status='FAILED' RETURNING task_id", now(), taskId).all();
  if (!result.results.length) throw new ApiError(409, "retry conflict");
  await event(db, taskId, task.latest_run_id, "TASK_RETRY_QUEUED");
  return { task_id: taskId, status: "QUEUED", executed: false };
}
__name(retry, "retry");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    if (path === "/" && request.method === "GET") return new Response(dashboard, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
    if (path === "/health" && request.method === "GET") return reply({ ok: true, service: "pantheon-workhub", stage: "primary-preview", factory: await factoryHealth(env) });
    try {
      await authorize(request, env);
      if (!env.DB) throw new ApiError(503, "database not configured");
      if (path === "/v1/factory/health" && request.method === "GET") return reply({ factory: await factoryHealth(env) });
      if (path === "/v1/factory/preflight" && request.method === "POST") return reply({ factory: await factoryPreflight(env, await bodyJson(request)) });
      if (path === "/v1/factory/jobs" && request.method === "POST") {
        const body = await bodyJson(request);
        if (body && Object.hasOwn(body, "task_id")) {
          requireObject(body, ["task_id"]);
          return reply(await queueExistingFactoryJob(env.DB, body.task_id));
        }
        requireObject(body, ["request"]);
        return reply(await queueFactoryJob(env.DB, body.request), 201);
      }
      const jobPath = path.match(/^\/v1\/factory\/jobs\/(task_[a-f0-9]{32})(?:\/(dispatch|reconcile))?$/);
      if (jobPath) {
        const [, taskId, action] = jobPath;
        if (!action && request.method === "GET") return reply({ job: await showFactoryJob(env.DB, taskId, env) });
        if (action === "dispatch" && request.method === "POST") return reply(await dispatchFactoryJob(env.DB, env, taskId));
        if (action === "reconcile" && request.method === "POST") return reply(await dispatchFactoryJob(env.DB, env, taskId, { reconcile: true }));
        throw new ApiError(405, "method not allowed");
      }
      if (path === "/v1/intent" && request.method === "POST") {
        const body = await bodyJson(request);
        if (body && !Object.hasOwn(body, "intent")) return reply(await routeOutcome(env.DB, body));
        const intent = parseIntent(body);
        if (intent.intent === "CREATE_TASK") return reply(await queue(env.DB, intent.request), 201);
        if (intent.intent === "SHOW_TASK") return reply({ task: await getTask(env.DB, intent.task_id) });
        return reply({ tasks: (await stmt(env.DB, "SELECT t.task_id,t.status,t.request_text,t.created_at,t.updated_at,a.tool_name FROM tasks t JOIN actions a ON a.task_id=t.task_id ORDER BY t.created_at DESC LIMIT 100").all()).results });
      }
      const match = path.match(/^\/v1\/tasks\/(task_[a-f0-9]{32})\/(run|recover|retry|events|artifact)$/);
      if (match) {
        const [_, taskId, action] = match;
        if (action === "events" && request.method === "GET") {
          await getTask(env.DB, taskId);
          return reply({ events: (await stmt(env.DB, "SELECT event_id,run_id,type,actor,details_json,created_at FROM events WHERE task_id=? ORDER BY rowid LIMIT 1000", taskId).all()).results });
        }
        if (action === "artifact" && request.method === "GET") {
          const task = await getTask(env.DB, taskId), observed = await inspect(env.DB, taskId);
          if (task.status !== "COMPLETED" || !observed.matches) return reply({ artifact: null });
          const value = await stmt(env.DB, "SELECT content,sha256 FROM artifacts WHERE action_key=?", observed.action_key).first();
          return reply({ artifact: value });
        }
        if (request.method !== "POST") throw new ApiError(405, "method not allowed");
        if (action === "run") return reply(await runTask(env.DB, taskId));
        if (action === "recover") return reply(await recover(env.DB, taskId));
        return reply(await retry(env.DB, taskId));
      }
      throw new ApiError(404, "not found");
    } catch (error) {
      return reply({ error: error instanceof ApiError || error instanceof FactoryBridgeError ? error.message : "internal error" }, error instanceof ApiError || error instanceof FactoryBridgeError ? error.status : 500);
    }
  }
};
const __legacyPantheonFetch=worker_default.fetch;
worker_default.fetch=async function(request,env,ctx){
  if(new URL(request.url).pathname.startsWith("/v1/observatory/")) return handleObservatory(request,env);
  return __legacyPantheonFetch.call(this,request,env,ctx);
};
worker_default.scheduled=async function(event,env,ctx){
  ctx.waitUntil(scheduledObservatoryCleanup(env));
};
export {
  worker_default as default,
  inspect,
  parseIntent,
  routeOutcome,
  queue,
  recover,
  retry,
  runTask
};
