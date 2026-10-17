// Narrow, separately bound LIGHT capability. No OwnerBridge access is exposed to LIGHT.
// The source identity is bound to the Cloudflare Worker Service Binding entrypoint.
import { ownerBridgeCall } from "./owner-bridge.mjs";
const bad=(status,http=400)=>({ok:false,status,upstream_status:http});
const keyset=(v,allowed)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
const task=v=>typeof v==="string"&&/^task_[a-f0-9]{32}$/.test(v);
const work=v=>typeof v==="string"&&v.trim().length>0&&v.length<=2000;
const annotate=v=>"[LIGHT-BOOKMARK] "+v.trim();
export async function lightBridgeCall(env,workhub,input){
  if(env.LIGHT_BRIDGE_ENABLED!=="true")return bad("LIGHT_BRIDGE_DISABLED",503);
  if(!input||typeof input!=="object"||Array.isArray(input))return bad("INVALID_REQUEST");
  let call;
  switch(input.operation){
    case "list_tasks":
      if(!keyset(input,["operation"]))return bad("INVALID_REQUEST");
      call={operation:"intent",payload:{intent:"LIST_TASKS"}};break;
    case "show_task":
      if(!keyset(input,["operation","task_id"])||!task(input.task_id))return bad("INVALID_TASK_ID");
      call={operation:"intent",payload:{intent:"SHOW_TASK",task_id:input.task_id}};break;
    case "create_task":
      if(!keyset(input,["operation","request"])||!work(input.request))return bad("INVALID_WORK_REQUEST");
      if(env.LIGHT_BRIDGE_CREATE_ENABLED!=="true")return bad("LIGHT_CREATE_DISABLED",403);
      call={operation:"intent",payload:{intent:"CREATE_TASK",request:annotate(input.request)}};break;
    case "queue_factory":
      if(!keyset(input,["operation","request"])||!work(input.request))return bad("INVALID_WORK_REQUEST");
      if(env.LIGHT_BRIDGE_CREATE_ENABLED!=="true")return bad("LIGHT_CREATE_DISABLED",403);
      call={operation:"queue_factory",request:annotate(input.request)};break;
    case "factory_health":
      if(!keyset(input,["operation"]))return bad("INVALID_REQUEST");
      call={operation:"factory_health"};break;
    case "factory_job":
      if(!keyset(input,["operation","task_id"])||!task(input.task_id))return bad("INVALID_TASK_ID");
      call={operation:"factory_job",task_id:input.task_id};break;
    default:return bad("LIGHT_OPERATION_NOT_ALLOWED",403);
  }
  // Dispatch, reconcile, merge, deploy, source writes and permission changes
  // are intentionally absent. No caller-supplied approved flag is accepted.
  const result=await ownerBridgeCall(env,workhub,call);
  return {...result,caller:"LIGHT-BOOKMARK",capability:"LIGHT_TASK_PREPARE"};
}
