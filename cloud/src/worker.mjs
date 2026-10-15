import { dashboard } from "./ui.mjs";
import {factoryHealth, factoryPreflight, FactoryBridgeError} from "./factory-bridge.mjs";
import {queueFactoryJob,showFactoryJob,dispatchFactoryJob} from "./factory-jobs.mjs";
// Cloudflare runtime for the existing Pantheon WorkHub Worker. Model output never authorizes tool execution.
const enc = new TextEncoder();
const TIMING_WINDOW_MS = 60_000;
const id = (prefix) => prefix + "_" + crypto.randomUUID().replaceAll("-", "");
const now = () => new Date().toISOString();
const sha256 = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)))].map(v => v.toString(16).padStart(2,"0")).join("");
const reply = (data, status=200, type="application/json; charset=utf-8") => new Response(type.includes("json")?JSON.stringify(data):data,{status,headers:{"content-type":type,"cache-control":"no-store","x-content-type-options":"nosniff"}});
class ApiError extends Error { constructor(status, message) { super(message); this.status=status; } }
function requireObject(v, keys) {
  if (!v || Array.isArray(v) || typeof v !== "object" || Object.keys(v).sort().join("|") !== keys.slice().sort().join("|")) throw new ApiError(400,"invalid fields");
}
async function authorize(request, env) {
  if (typeof env.WORKHUB_TOKEN !== "string" || env.WORKHUB_TOKEN.length < 32) throw new ApiError(503,"authentication not configured");
  const supplied=request.headers.get("authorization") || "";
  const expected="Bearer " + env.WORKHUB_TOKEN;
  if (supplied.length !== expected.length) throw new ApiError(401,"unauthorized");
  let difference=0;
  for(let i=0;i<expected.length;i++) difference|=supplied.charCodeAt(i)^expected.charCodeAt(i);
  if(difference) throw new ApiError(401,"unauthorized");
}
async function bodyJson(request) {
  const text=await request.text();
  if(text.length>8192) throw new ApiError(413,"request too large");
  try{return JSON.parse(text);}catch{throw new ApiError(400,"invalid JSON");}
}
function stmt(db, sql, ...params) { return db.prepare(sql).bind(...params); }
async function event(db, taskId, runId, type, details="{}") {
  await stmt(db,"INSERT INTO events(event_id,task_id,run_id,type,actor,details_json,created_at) VALUES(?,?,?,?,?,?,?)",
    id("evt"),taskId,runId,type,"cloud-owner",details,now()).run();
}
function validId(v) { if(typeof v!=="string" || !/^task_[a-f0-9]{32}$/.test(v)) throw new ApiError(400,"invalid task ID"); return v; }
function parseIntent(value) {
  if(!value || typeof value!=="object" || Array.isArray(value)) throw new ApiError(400,"invalid intent");
  switch(value.intent) {
    case "CREATE_TASK":
      requireObject(value,["intent","request"]);
      if(typeof value.request!=="string" || !value.request.trim() || value.request.length>4096) throw new ApiError(400,"invalid request");
      return value;
    case "SHOW_TASK": requireObject(value,["intent","task_id"]);validId(value.task_id);return value;
    case "LIST_TASKS": requireObject(value,["intent"]);return value;
    default: throw new ApiError(400,"unsupported intent");
  }
}
async function queue(db, request) {
  const taskId=id("task"),actionKey=id("act"), timestamp=now(), digest=await sha256(request);
  await db.batch([
    stmt(db,"INSERT INTO tasks(task_id,status,request_text,request_sha256,created_at,updated_at) VALUES(?,'QUEUED',?,?,?,?)",taskId,request,digest,timestamp,timestamp),
    stmt(db,"INSERT INTO actions(action_key,task_id,tool_name,input_sha256,status) VALUES(?,?,'d1.create_text_artifact',?,'PREPARED')",actionKey,taskId,digest),
    stmt(db,"INSERT INTO events(event_id,task_id,type,actor,details_json,created_at) VALUES(?,?,'TASK_QUEUED','cloud-owner',?,?)",id("evt"),taskId,JSON.stringify({request_sha256:digest}),timestamp)
  ]);
  return {task_id:taskId,status:"QUEUED",executed:false};
}
async function getTask(db, taskId) {
  const task=await stmt(db,"SELECT * FROM tasks WHERE task_id=?",validId(taskId)).first();
  if(!task) throw new ApiError(404,"task not found");
  return task;
}
async function inspect(db, taskId) {
  const row=await stmt(db,"SELECT a.action_key,a.input_sha256,x.content,x.sha256 AS stored_sha256 FROM actions a LEFT JOIN artifacts x ON x.action_key=a.action_key WHERE a.task_id=?",taskId).first();
  if(!row) throw new ApiError(409,"missing action");
  if(row.content===null || row.content===undefined) return {exists:false,matches:false,action_key:row.action_key};
  const hash=await sha256(row.content);
  return {exists:true,matches:hash===row.input_sha256 && hash===row.stored_sha256,sha256:hash,action_key:row.action_key};
}
async function markComplete(db, taskId, runId, digest, recovered=false) {
  const timestamp=now();
  await db.batch([
    stmt(db,"UPDATE actions SET status='VERIFIED',receipt_sha256=? WHERE task_id=? AND status IN ('REQUESTED','EFFECT_RECORDED')",digest,taskId),
    stmt(db,"UPDATE tasks SET status='COMPLETED',updated_at=?,last_error=NULL WHERE task_id=? AND status IN ('RUNNING','NEEDS_RECONCILIATION')",timestamp,taskId),
    stmt(db,"UPDATE runs SET status='COMPLETED',finished_at=? WHERE run_id=?",timestamp,runId),
    stmt(db,"INSERT INTO events(event_id,task_id,run_id,type,actor,details_json,created_at) VALUES(?,?,?,'VERIFICATION_PASSED','cloud-owner',?,?)",id("evt"),taskId,runId,JSON.stringify({sha256:digest,recovered}),timestamp),
    stmt(db,"INSERT INTO events(event_id,task_id,run_id,type,actor,details_json,created_at) VALUES(?,?,?,'TASK_COMPLETED','cloud-owner','{}',?)",id("evt"),taskId,runId,timestamp)
  ]);
}
async function runTask(db, taskId) {
  const task=await getTask(db,taskId),runId=id("run"),timestamp=now();
  const executor=await stmt(db,"SELECT tool_name FROM actions WHERE task_id=?",taskId).first();
  if(executor?.tool_name!=="d1.create_text_artifact")throw new ApiError(409,"task requires Factory executor");
  if(task.status!=="QUEUED") throw new ApiError(409,"task is not QUEUED");
  // D1 batch commits atomically. Only a QUEUED task can be claimed.
  const claim=await db.batch([
    stmt(db,"UPDATE tasks SET status='RUNNING',latest_run_id=?,updated_at=? WHERE task_id=? AND status='QUEUED' RETURNING task_id",runId,timestamp,taskId),
    stmt(db,"INSERT INTO runs(run_id,task_id,status,started_at) SELECT ?,task_id,'RUNNING',? FROM tasks WHERE task_id=? AND latest_run_id=? AND status='RUNNING'",runId,timestamp,taskId,runId),
    stmt(db,"UPDATE actions SET status='REQUESTED' WHERE task_id=? AND status='PREPARED' AND EXISTS (SELECT 1 FROM tasks WHERE task_id=? AND latest_run_id=? AND status='RUNNING')",taskId,taskId,runId),
    stmt(db,"INSERT INTO events(event_id,task_id,run_id,type,actor,details_json,created_at) SELECT ?,?,?,'ACTION_REQUESTED','cloud-owner','{}',? WHERE EXISTS (SELECT 1 FROM actions WHERE task_id=? AND status='REQUESTED') AND EXISTS (SELECT 1 FROM tasks WHERE task_id=? AND latest_run_id=? AND status='RUNNING')",id("evt"),taskId,runId,timestamp,taskId,taskId,runId)
  ]);
  if(!claim[0]?.results?.length) throw new ApiError(409,"task already claimed");
  try {
    const action=await stmt(db,"SELECT * FROM actions WHERE task_id=?",taskId).first();
    if(action?.status!=="REQUESTED") throw new Error("action not prepared");
    // This insert is the only side effect. Conflicts are never overwritten.
    await stmt(db,"INSERT INTO artifacts(action_key,task_id,content,sha256,created_at) VALUES(?,?,?,?,?) ON CONFLICT(action_key) DO NOTHING",
      action.action_key,taskId,task.request_text,task.request_sha256,now()).run();
    const observed=await inspect(db,taskId);
    if(!observed.matches) throw new Error("artifact readback mismatch");
    await markComplete(db,taskId,runId,observed.sha256);
    return {task_id:taskId,status:"COMPLETED",verified:true,run_id:runId};
  } catch(err) {
    await db.batch([
      stmt(db,"UPDATE tasks SET status='NEEDS_RECONCILIATION',last_error=?,updated_at=? WHERE task_id=? AND status='RUNNING'",String(err.message).slice(0,300),now(),taskId),
      stmt(db,"UPDATE runs SET status='UNKNOWN',finished_at=? WHERE run_id=? AND status='RUNNING'",now(),runId)
    ]);
    throw new ApiError(409,"effect uncertain; reconciliation required");
  }
}
async function recover(db, taskId) {
  const task=await getTask(db,taskId);
  const executor=await stmt(db,"SELECT tool_name FROM actions WHERE task_id=?",taskId).first();
  if(executor?.tool_name!=="d1.create_text_artifact")throw new ApiError(409,"task requires Factory reconciliation");
  if(!["RUNNING","NEEDS_RECONCILIATION"].includes(task.status)) throw new ApiError(409,"not recoverable");
  if(Date.now()-Date.parse(task.updated_at)<TIMING_WINDOW_MS) throw new ApiError(409,"run may still be active");
  const observed=await inspect(db,taskId),timestamp=now();
  if(observed.exists && observed.matches) {
    await markComplete(db,taskId,task.latest_run_id,observed.sha256,true);
    return {task_id:taskId,status:"COMPLETED",verified:true,recovered:true};
  }
  if(observed.exists) {
    await stmt(db,"UPDATE tasks SET status='NEEDS_RECONCILIATION',last_error='artifact content mismatch',updated_at=? WHERE task_id=?",timestamp,taskId).run();
    return {task_id:taskId,status:"NEEDS_RECONCILIATION",verified:false};
  }
  await db.batch([
    stmt(db,"UPDATE tasks SET status='FAILED',last_error='verified absent; explicit retry required',updated_at=? WHERE task_id=?",timestamp,taskId),
    stmt(db,"UPDATE actions SET status='PREPARED' WHERE task_id=? AND status='REQUESTED'",taskId),
    stmt(db,"UPDATE runs SET status='NO_EFFECT',finished_at=? WHERE run_id=?",timestamp,task.latest_run_id),
    stmt(db,"INSERT INTO events(event_id,task_id,run_id,type,actor,details_json,created_at) VALUES(?,?,?,'RECONCILED_NO_EFFECT','cloud-owner','{}',?)",id("evt"),taskId,task.latest_run_id,timestamp)
  ]);
  return {task_id:taskId,status:"FAILED",verified_absent:true,retry_required:true};
}
async function retry(db,taskId) {
  const task=await getTask(db,taskId);
  const executor=await stmt(db,"SELECT tool_name FROM actions WHERE task_id=?",taskId).first();
  if(executor?.tool_name!=="d1.create_text_artifact")throw new ApiError(409,"task requires Factory reconciliation");
  if(task.status!=="FAILED") throw new ApiError(409,"retry requires failed/no-effect recovery");
  const seen=await inspect(db,taskId);
  if(seen.exists) throw new ApiError(409,"cannot retry existing artifact");
  const result=await stmt(db,"UPDATE tasks SET status='QUEUED',updated_at=?,last_error=NULL WHERE task_id=? AND status='FAILED' RETURNING task_id",now(),taskId).all();
  if(!result.results.length) throw new ApiError(409,"retry conflict");
  await event(db,taskId,task.latest_run_id,"TASK_RETRY_QUEUED");
  return {task_id:taskId,status:"QUEUED",executed:false};
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url),path=url.pathname;
    if(path==="/" && request.method==="GET") return new Response(dashboard,{status:200,headers:{"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer"}});
    if(path==="/health" && request.method==="GET") return reply({ok:true,service:"pantheon-workhub",stage:"primary-preview",factory:await factoryHealth(env)});
    try {
      await authorize(request,env);
      if(!env.DB) throw new ApiError(503,"database not configured");
      if(path==="/v1/factory/health" && request.method==="GET") return reply({factory:await factoryHealth(env)});
      if(path==="/v1/factory/preflight" && request.method==="POST") return reply({factory:await factoryPreflight(env,await bodyJson(request))});
      // Explicit owner-driven workflow: queue never dispatches.
      if(path==="/v1/factory/jobs" && request.method==="POST") {
        const body=await bodyJson(request);
        requireObject(body,["request"]);
        return reply(await queueFactoryJob(env.DB,body.request),201);
      }
      const jobPath=path.match(/^\/v1\/factory\/jobs\/(task_[a-f0-9]{32})(?:\/(dispatch|reconcile))?$/);
      if(jobPath){
        const [,taskId,action]=jobPath;
        if(!action && request.method==="GET")return reply({job:await showFactoryJob(env.DB,taskId)});
        if(action==="dispatch" && request.method==="POST")return reply(await dispatchFactoryJob(env.DB,env,taskId));
        if(action==="reconcile" && request.method==="POST")return reply(await dispatchFactoryJob(env.DB,env,taskId,{reconcile:true}));
        throw new ApiError(405,"method not allowed");
      }
      // Sending work to /station/receive is intentionally unavailable: signed preflight
      // never constitutes City Hall authorization or approval to dispatch.
      if(path==="/v1/intent" && request.method==="POST") {
        const intent=parseIntent(await bodyJson(request));
        if(intent.intent==="CREATE_TASK") return reply(await queue(env.DB,intent.request),201);
        if(intent.intent==="SHOW_TASK") return reply({task:await getTask(env.DB,intent.task_id)});
        return reply({tasks:(await stmt(env.DB,"SELECT t.task_id,t.status,t.request_text,t.created_at,t.updated_at,a.tool_name FROM tasks t JOIN actions a ON a.task_id=t.task_id ORDER BY t.created_at DESC LIMIT 100").all()).results});
      }
      const match=path.match(/^\/v1\/tasks\/(task_[a-f0-9]{32})\/(run|recover|retry|events|artifact)$/);
      if(match) {
        const [_,taskId,action]=match;
        if(action==="events" && request.method==="GET") {
          await getTask(env.DB,taskId);
          return reply({events:(await stmt(env.DB,"SELECT event_id,run_id,type,actor,details_json,created_at FROM events WHERE task_id=? ORDER BY rowid LIMIT 1000",taskId).all()).results});
        }
        if(action==="artifact" && request.method==="GET") {
          const task=await getTask(env.DB,taskId),observed=await inspect(env.DB,taskId);
          if(task.status!=="COMPLETED" || !observed.matches) return reply({artifact:null});
          const value=await stmt(env.DB,"SELECT content,sha256 FROM artifacts WHERE action_key=?",observed.action_key).first();
          return reply({artifact:value});
        }
        if(request.method!=="POST") throw new ApiError(405,"method not allowed");
        if(action==="run") return reply(await runTask(env.DB,taskId));
        if(action==="recover") return reply(await recover(env.DB,taskId));
        return reply(await retry(env.DB,taskId));
      }
      throw new ApiError(404,"not found");
    } catch(error) {
      return reply({error:error instanceof ApiError || error instanceof FactoryBridgeError?error.message:"internal error"},error instanceof ApiError || error instanceof FactoryBridgeError?error.status:500);
    }
  }
};
export {parseIntent, inspect, queue, runTask, recover, retry};
