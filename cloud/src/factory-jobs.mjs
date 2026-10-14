// Owner-authorized, LOGIC-trainee-only dispatch. Model output alone never executes.
import {factoryPreflight,factoryDispatch,factoryReadback,factoryReconcile,FactoryBridgeError} from "./factory-bridge.mjs";
const enc=new TextEncoder();
const stamp=()=>new Date().toISOString();
const uid=(x)=>x+"_"+crypto.randomUUID().replaceAll("-","");
const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
const validId=(x)=>{if(typeof x!=="string"||!/^task_[a-f0-9]{32}$/.test(x))throw new FactoryBridgeError(400,"invalid task ID");return x;};
async function digest(s){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(s)))].map(x=>x.toString(16).padStart(2,"0")).join("");}
function boundedRequest(text){
 if(typeof text!=="string"||!text.trim()||text.length>2048)throw new FactoryBridgeError(400,"invalid Factory request");
 return text;
}
async function job(db,taskId){
 const row=await statement(db,"SELECT j.*,t.request_text,t.status AS task_status FROM factory_jobs j JOIN tasks t ON t.task_id=j.task_id WHERE j.task_id=?",validId(taskId)).first();
 if(!row)throw new FactoryBridgeError(404,"Factory job not found");
 return row;
}
function envelope(j){
 const taskId=validId(j.task_id),cp="cp-"+taskId;
 return {
  workId:taskId,checkpointId:cp,ownerDomain:"LOGIC",intent:"PLACE_DWARF_LOGIC_TRAINEE",
  scope:["EXECUTE:LOGIC"],inputRefs:[],
  source:{stationId:"PANTHEON",system:"pantheon-workhub"},
  target:{stationId:"FACTORY-STATION",system:"factory-district",component:"FACTORY_HALL"},
  workPassRef:"work-pass://pantheon-"+taskId,
  workPass:{kind:"WORK_PASS",version:"WORK_PASS_V1",status:"ACTIVE",passId:"pantheon-"+taskId,
   actor:"PANTHEON",workId:taskId,checkpointId:cp,
   permissions:{actions:["handoff"],handoff:[{stationId:"FACTORY_STATION"}]},authorityTransferred:false}
 };
}
async function audit(db,taskId,type,details={}){
 await statement(db,"INSERT INTO events(event_id,task_id,type,actor,details_json,created_at) VALUES(?, ?, ?, 'pantheon-factory', ?, ?)",
  uid("evt"),taskId,type,JSON.stringify(details),stamp()).run();
}
export async function queueFactoryJob(db,request){
 const value=boundedRequest(request),taskId=uid("task"),actionKey=uid("act"),time=stamp(),hash=await digest(value);
 await db.batch([
 statement(db,"INSERT INTO tasks(task_id,status,request_text,request_sha256,created_at,updated_at) VALUES(?,'QUEUED',?,?,?,?)",taskId,value,hash,time,time),
 statement(db,"INSERT INTO actions(action_key,task_id,tool_name,input_sha256,status) VALUES(?,?,'factory.logic.trainee',?,'PREPARED')",actionKey,taskId,hash),
 statement(db,"INSERT INTO factory_jobs(task_id,status,updated_at) VALUES(?,'QUEUED',?)",taskId,time),
 statement(db,"INSERT INTO events(event_id,task_id,type,actor,details_json,created_at) VALUES(?,?,'FACTORY_TASK_QUEUED','cloud-owner',?,?)",uid("evt"),taskId,JSON.stringify({input_sha256:hash}),time)
 ]);
 return {task_id:taskId,status:"QUEUED",executed:false,domain:"LOGIC",machine:"DWARF-01",mode:"TRAINING"};
}
export async function showFactoryJob(db,taskId){
 const j=await job(db,taskId);
 const {request_text,receipt_id,status,source_sha,result_json,result_sha256,last_error,updated_at,task_status}=j;
 return {task_id:taskId,request_text,receipt_id,status,source_sha,result_sha256,last_error,updated_at,task_status,
  result:result_json?JSON.parse(result_json):null};
}
function verifyBack(j,back,receiptId) {
 const e=envelope(j);
 if(back?.receiptId!==receiptId || back.workId!==e.workId || back.checkpointId!==e.checkpointId
  || back.workPassRef!==e.workPassRef || back.actingActor!=="PANTHEON")
  throw new FactoryBridgeError(502,"factory readback identity mismatch");
 return back.status==="HANDOFF_VERIFIED" && back.boundaryVerified===true
  && back.domainCompleted===true && back.domainVerified===true && !!back.evidenceRef
  && Array.isArray(back.result?.evidenceRefs) && back.result.evidenceRefs.length>0
  && back.result.evidenceRefs.every(x=>typeof x==="string"&&x.length>0);
}
async function markUncertain(db,taskId,error){
 const reason=String(error?.message||"FACTORY_EFFECT_UNCERTAIN").slice(0,240);
 await db.batch([
  statement(db,"UPDATE factory_jobs SET status='NEEDS_RECONCILIATION',last_error=?,updated_at=? WHERE task_id=?",reason,stamp(),taskId),
  statement(db,"UPDATE tasks SET status='NEEDS_RECONCILIATION',last_error=?,updated_at=? WHERE task_id=?",reason,stamp(),taskId)
 ]);
 await audit(db,taskId,"FACTORY_EFFECT_UNCERTAIN",{reason});
}
async function settle(db,j,back,receiptId){
 const verified=verifyBack(j,back,receiptId),time=stamp(),serialized=JSON.stringify(back),hash=await digest(serialized);
 if(serialized.length>32768)throw new FactoryBridgeError(502,"factory readback too large");
 const state=verified?"COMPLETED":"NEEDS_RECONCILIATION";
 await db.batch([
  statement(db,"UPDATE factory_jobs SET status=?,receipt_id=?,source_sha=?,result_json=?,result_sha256=?,last_error=?,updated_at=? WHERE task_id=?",
    state,receiptId,String(back.sourceSha||"").slice(0,100),serialized,hash,verified?null:String(back.reason||"DOMAIN_NOT_VERIFIED").slice(0,240),time,j.task_id),
  statement(db,"UPDATE tasks SET status=?,last_error=?,updated_at=? WHERE task_id=?",state,verified?null:"domain result unverified",time,j.task_id)
 ]);
 await audit(db,j.task_id,verified?"FACTORY_RESULT_VERIFIED":"FACTORY_RESULT_UNVERIFIED",
  {receipt_id:receiptId,readback_sha256:hash,domain_verified:verified,source_sha:back.sourceSha||null});
 return {task_id:j.task_id,status:state,verified,receipt_id:receiptId,source_sha:back.sourceSha||null,
  result:back.result||null,evidence_ref:back.evidenceRef||null,readback_sha256:hash};
}
export async function dispatchFactoryJob(db,env,taskId,{reconcile=false}={}){
 // Do not ever fall back to the privileged Metro/City rail for Factory effects.
 if(typeof env.FACTORY_PANTHEON_SECRET!=="string"||env.FACTORY_PANTHEON_SECRET.length<32)
   throw new FactoryBridgeError(503,"isolated Pantheon rail not configured");
 const j=await job(db,taskId);
 const eligible=reconcile?["NEEDS_RECONCILIATION","DISPATCHING"]:["QUEUED"];
 if(!eligible.includes(j.status))throw new FactoryBridgeError(409,"Factory job not eligible for "+(reconcile?"reconciliation":"dispatch"));
 const claim=await statement(db,"UPDATE factory_jobs SET status='DISPATCHING',updated_at=? WHERE task_id=? AND status=? RETURNING task_id",stamp(),taskId,j.status).all();
 if(!claim.results?.length)throw new FactoryBridgeError(409,"Factory job already claimed");
 await statement(db,"UPDATE tasks SET status='RUNNING',updated_at=? WHERE task_id=?",stamp(),taskId).run();
 await audit(db,taskId,reconcile?"FACTORY_RECONCILIATION_REQUESTED":"FACTORY_DISPATCH_REQUESTED");
 try{
  // A stored receipt takes priority: reconcile by readback without re-running any effect.
  if(j.receipt_id){
   let back;
   try { back=await factoryReadback(env,j.receipt_id); }
   catch(error){
    if(error.message!=="RECEIPT_NOT_FOUND")throw error;
    const recovered=await factoryReconcile(env,envelope(j));
    if(recovered.receipt.receiptId!==j.receipt_id)
      throw new FactoryBridgeError(502,"recovered receipt mismatch");
    await audit(db,taskId,"FACTORY_RECEIPT_RECOVERED",{receipt_id:j.receipt_id});
    back=await factoryReadback(env,j.receipt_id);
   }
   return await settle(db,j,back,j.receipt_id);
  }
  const data=envelope(j);
  const preflight=await factoryPreflight(env,data);
  await audit(db,taskId,"FACTORY_PREFLIGHT_VERIFIED",{source_sha:preflight.sourceSha||null});
  // On uncertain sends consult durable Factory claim and evidence first;
  // absence of a durable claim means the machine was never invoked.
  let dispatched;
  if(reconcile){
   try {dispatched=await factoryReconcile(env,data);}
   catch(error){
    if(error.message!=="FACTORY_CLAIM_NOT_FOUND")throw error;
   }
  }
  if(!dispatched)dispatched=await factoryDispatch(env,data);
  const receipt=dispatched.receipt.receiptId;
  // Persist receipt before further network calls, so subsequent reconciliations
  // can query the Factory without resending work.
  await statement(db,"UPDATE factory_jobs SET receipt_id=?,status='DISPATCHING',updated_at=? WHERE task_id=?",receipt,stamp(),taskId).run();
  await audit(db,taskId,"FACTORY_RECEIPT_RECORDED",{receipt_id:receipt});
  const back=await factoryReadback(env,receipt);
  return await settle(db,j,back,receipt);
 }catch(error){
  await markUncertain(db,taskId,error);
  if(error instanceof FactoryBridgeError)throw error;
  throw new FactoryBridgeError(502,"Factory result uncertain; reconcile before retry");
 }
}
