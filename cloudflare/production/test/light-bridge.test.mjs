import test from "node:test";
import assert from "node:assert/strict";
import {lightBridgeCall} from "../light-bridge.mjs";

const task_id="task_"+"a".repeat(32);
const token="t".repeat(32);
const env={LIGHT_BRIDGE_ENABLED:"true",LIGHT_BRIDGE_CREATE_ENABLED:"true",WORKHUB_TOKEN:token};
const stub=()=>{const sent=[];return {sent,workhub:{fetch:async(req)=>{sent.push({path:new URL(req.url).pathname,method:req.method,auth:req.headers.get("authorization"),body:req.method==="POST"?await req.json():null});return Response.json({task_id,status:"QUEUED",executed:false},{status:201});}}};};
test("fails closed when LIGHT bridge disabled",async()=>{
  let touched=false;
  const out=await lightBridgeCall({}, {fetch:async()=>{touched=true}}, {operation:"list_tasks"});
  assert.equal(out.status,"LIGHT_BRIDGE_DISABLED");assert.equal(touched,false);
});
test("LIGHT can read task queue through restricted request",async()=>{
  const x=stub();const r=await lightBridgeCall(env,x.workhub,{operation:"list_tasks"});
  assert.equal(r.ok,true);assert.equal(r.caller,"LIGHT-BOOKMARK");
  assert.equal(x.sent[0].path,"/v1/intent");
  assert.deepEqual(x.sent[0].body,{intent:"LIST_TASKS"});
  assert.equal(x.sent[0].auth,"Bearer "+token);
});
test("LIGHT task create is attributed in persisted request but never executed",async()=>{
  const x=stub();const r=await lightBridgeCall(env,x.workhub,{operation:"create_task",request:"Inspect check failure"});
  assert.equal(r.ok,true);
  assert.deepEqual(x.sent[0].body,{intent:"CREATE_TASK",request:"[LIGHT-BOOKMARK] Inspect check failure"});
});
test("LIGHT can queue Factory without dispatch",async()=>{
  const x=stub();const r=await lightBridgeCall(env,x.workhub,{operation:"queue_factory",request:"LOGIC review"});
  assert.equal(r.ok,true);
  assert.equal(x.sent[0].path,"/v1/factory/jobs");
  assert.equal(x.sent[0].body.request,"[LIGHT-BOOKMARK] LOGIC review");
});
test("LIGHT create/queue requires separate owner enablement",async()=>{
  const x=stub();
  for(const operation of ["create_task","queue_factory"]){
    const r=await lightBridgeCall({...env,LIGHT_BRIDGE_CREATE_ENABLED:"false"},x.workhub,{operation,request:"work"});
    assert.equal(r.status,"LIGHT_CREATE_DISABLED");
  }
  assert.equal(x.sent.length,0);
});
test("LIGHT cannot smuggle owner approval or high-risk operations",async()=>{
  const x=stub();
  for(const request of [
    {operation:"dispatch_factory",task_id,approved:true},
    {operation:"reconcile_factory",task_id,approved:true},
    {operation:"deploy",target:"production"},
    {operation:"create_task",request:"do work",approved:true},
    {operation:"factory_job",task_id,approved:true},
    {operation:"show_task",task_id:"../task"},
    {operation:"create_task",request:" "},
  ]){
    const r=await lightBridgeCall(env,x.workhub,request);
    assert.equal(r.ok,false);
  }
  assert.equal(x.sent.length,0);
});
test("LIGHT factory readback and health cannot modify upstream",async()=>{
  const x=stub();
  await lightBridgeCall(env,x.workhub,{operation:"factory_job",task_id});
  await lightBridgeCall(env,x.workhub,{operation:"factory_health"});
  assert.deepEqual(x.sent.map(e=>e.method),["GET","GET"]);
});
