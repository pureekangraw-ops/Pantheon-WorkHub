// Narrow, separately bound LIGHT capability. No OwnerBridge access is exposed to LIGHT.
// The source identity is bound to the Cloudflare Worker Service Binding entrypoint.
import { ownerBridgeCall } from "./owner-bridge.mjs";
import { runProviderTool, isProviderTool } from "./provider-read.mjs";
import { runDriveTool } from "./drive-read.mjs";
const bad=(status,http=400)=>({ok:false,status,upstream_status:http});
const keyset=(v,allowed)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
const task=v=>typeof v==="string"&&/^task_[a-f0-9]{32}$/.test(v);
const work=v=>typeof v==="string"&&v.trim().length>0&&v.length<=2000;
const annotate=v=>"[LIGHT-BOOKMARK] "+v.trim();
export async function lightBridgeCall(env,workhub,input){
  if(env.LIGHT_BRIDGE_ENABLED!=="true")return bad("LIGHT_BRIDGE_DISABLED",503);
  if(!input||typeof input!=="object"||Array.isArray(input))return bad("INVALID_REQUEST");
  // Read-only provider requests run inside PANTHEON. Never forward a provider bearer to LIGHT.
  if(input.operation==="provider_read"){
    if(!keyset(input,["operation","name","args"])||!isProviderTool(input.name)||
       !keyset(input.args,["repo","project","path","ref","script"]))return bad("INVALID_PROVIDER_REQUEST");
    try {
      const data=await runProviderTool(input.name,input.args,env);
      return {ok:true,caller:"LIGHT-BOOKMARK",capability:"LIGHT_READ_PROVIDER",result:data};
    }catch(e){
      const msg=e instanceof Error?e.message:"PROVIDER_UNAVAILABLE";
      return bad(/^[A-Z0-9_]+$/.test(msg)?msg:"PROVIDER_UNAVAILABLE",502);
    }
  }
  if(input.operation==="drive_read"){
    if(!keyset(input,["operation","name","args"])||
       !["light_drive_roots","light_drive_list","light_drive_file"].includes(input.name)||
       !keyset(input.args,["folder_id","file_id","query","limit"]))return bad("INVALID_DRIVE_REQUEST");
    const response=await runDriveTool(input.name,input.args,env);
    return {...response,caller:"LIGHT-BOOKMARK",capability:"LIGHT_READ_DRIVE"};
  }
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
