// Narrow, separately bound LIGHT capability. No OwnerBridge access is exposed to LIGHT.
// The source identity is bound to the Cloudflare Worker Service Binding entrypoint.
import {ownerBridgeCall} from "./owner-bridge.mjs";
import {runDriveTool} from "./drive-read.mjs";
const bad=(status,http=400)=>({ok:false,status,upstream_status:http});
const keyset=(v,allowed)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
const task=v=>typeof v==="string"&&/^task_[a-f0-9]{32}$/.test(v);
const work=v=>typeof v==="string"&&v.trim().length>0&&v.length<=2000;
const annotate=v=>"[LIGHT-BOOKMARK] "+v.trim();
const READ_TOOLS=new Set(["light_drive_roots","light_drive_list","light_drive_file","light_drive_permissions"]);
const WRITE_TOOLS=new Set(["light_drive_create","light_drive_update","light_drive_rename","light_drive_move","light_drive_copy","light_drive_share","light_drive_permission_update"]);
const DRIVE_ARGS={
  light_drive_roots:[],light_drive_list:["folder_id","query","limit","page_token"],light_drive_file:["file_id"],light_drive_permissions:["file_id","page_token"],
  light_drive_create:["folder_id","name","text","mime_type"],light_drive_update:["file_id","text"],light_drive_rename:["file_id","name"],light_drive_move:["file_id","folder_id"],
  light_drive_copy:["file_id","name","folder_id"],light_drive_share:["file_id","type","role","email_address","domain","send_notification_email"],
  light_drive_permission_update:["file_id","permission_id","role","allow_file_discovery"],
};
export async function lightBridgeCall(env,workhub,input,fetcher=fetch){
  if(env.LIGHT_BRIDGE_ENABLED!=="true")return bad("LIGHT_BRIDGE_DISABLED",503);
  if(!input||typeof input!=="object"||Array.isArray(input))return bad("INVALID_REQUEST");
  if(typeof input.operation==="string"&&/delete/i.test(input.operation))return bad("DRIVE_DELETE_NOT_ALLOWED",403);
  const read=input.operation==="pantheon.drive.read";
  const write=input.operation==="pantheon.drive.write";
  if(read||write){
    const name=input.name;
    if(!keyset(input,["operation","name","args"])||!Object.hasOwn(DRIVE_ARGS,name)||!keyset(input.args,DRIVE_ARGS[name]))return bad("INVALID_DRIVE_REQUEST");
    if(read&&!READ_TOOLS.has(name))return bad("DRIVE_CAPABILITY_NOT_ALLOWED",403);
    if(write&&!WRITE_TOOLS.has(name))return bad("DRIVE_CAPABILITY_NOT_ALLOWED",403);
    const flag=write?env.PANTHEON_DRIVE_WRITE_ENABLED:env.PANTHEON_DRIVE_READ_ENABLED;
    if(flag!=="true")return bad(write?"PANTHEON_DRIVE_WRITE_DISABLED":"PANTHEON_DRIVE_READ_DISABLED",503);
    const response=await runDriveTool(name,input.args,env,fetcher);
    return {...response,caller:"LIGHT-BOOKMARK",capability:input.operation};
  }
  if(input.operation==="drive_read"||input.operation==="drive_write")return bad("DRIVE_CAPABILITY_REQUIRES_NAMESPACE",403);
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
  // are intentionally absent from the WorkHub/Factory route.
  const result=await ownerBridgeCall(env,workhub,call);
  return {...result,caller:"LIGHT-BOOKMARK",capability:"LIGHT_TASK_PREPARE"};
}
