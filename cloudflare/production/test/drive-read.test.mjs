import test from "node:test";
import assert from "node:assert/strict";
import { runDriveTool } from "../drive-read.mjs";
import { lightBridgeCall } from "../light-bridge.mjs";

const root="1gmu8Mh8Uve9VX3bRjaPGF4qWmMHfCniz";
const file="1mi5UMJRE2Q6nM9u9kz0wgdEVw3QSR2S";
const outside="1fAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const env={
  LIGHT_BRIDGE_ENABLED:"true",
  GOOGLE_ID_SECRET:"test-client-id",
  GOOGLE_SECRET:"test-client-secret",
  GOOGLE_REFRESH_TOKEN:"test-refresh-token",
  PANTHEON_DRIVE_ALLOWED_FOLDERS:root,
};
const respond=(body,status=200)=>new Response(typeof body==="string"?body:JSON.stringify(body),{status});
const captures=[];
const fetcher=async (url,opts)=>{
  captures.push({url,method:opts.method,headers:opts.headers,body:opts.body});
  if(url==="https://oauth2.googleapis.com/token")return respond({access_token:"short-lived-test",token_type:"Bearer"});
  const u=new URL(url);
  if(u.pathname.endsWith("/files"))return respond({files:[{id:file,name:"train_receipt.json",mimeType:"application/json",webViewLink:"https://drive.google.com/file/d/safe/view"}]});
  if(u.pathname.endsWith("/files/"+file)&&u.searchParams.get("alt")==="media")return respond('{"result":"historical"}');
  if(u.pathname.endsWith("/files/"+file))return respond({id:file,name:"train_receipt.json",mimeType:"application/json",parents:[root],trashed:false});
  if(u.pathname.endsWith("/files/"+outside))return respond({id:outside,name:"not-allowed",mimeType:"text/plain",parents:[],trashed:false});
  throw Error("Unexpected route");
};
test("Drive is not visible before allowlist is configured",async()=>{
  const r=await runDriveTool("light_drive_roots",{},{});assert.equal(r.status,"DRIVE_FOLDER_ALLOWLIST_NOT_CONFIGURED");
});
test("roots are discoverable without exchanging any OAuth tokens",async()=>{
  const old=captures.length;const r=await runDriveTool("light_drive_roots",{},env,fetcher);
  assert.equal(r.ok,true);assert.deepEqual(r.result.folder_ids,[root]);assert.equal(captures.length,old);
});
test("list is scoped to permitted root and uses only read-only upstream calls",async()=>{
  captures.length=0;
  const r=await runDriveTool("light_drive_list",{folder_id:root,limit:10},env,fetcher);
  assert.equal(r.ok,true);assert.equal(r.result.files[0].id,file);
  assert.equal(captures.length,2);assert.deepEqual(captures.map(x=>x.method),["POST","GET"]);
  assert.equal(captures[1].headers.authorization,"Bearer short-lived-test");
  assert.doesNotMatch(JSON.stringify(r),/test-client-secret|test-refresh-token|short-lived-test/);
});
test("reads bounded JSON from a scoped file",async()=>{
  captures.length=0;const r=await runDriveTool("light_drive_file",{file_id:file},env,fetcher);
  assert.equal(r.ok,true);assert.match(r.result.text,/historical/);
  assert.deepEqual(captures.map(x=>x.method),["POST","GET","GET"]);
});
test("out-of-scope files are denied before reading content",async()=>{
  captures.length=0;
  const r=await runDriveTool("light_drive_file",{file_id:outside},env,fetcher);
  assert.equal(r.ok,false);assert.equal(r.status,"RESOURCE_NOT_ALLOWLISTED");
  assert.equal(captures.length,2);
});
test("invalid path and write intent are rejected before OAuth",async()=>{
  captures.length=0;
  for(const [tool,args] of [["light_drive_file",{file_id:"../secrets"}],["light_drive_list",{folder_id:root,execute:true}],["light_drive_roots",{approved:true}]]){
    const r=await runDriveTool(tool,args,env,fetcher);assert.equal(r.ok,false);
  }
  assert.equal(captures.length,0);
});
test("LIGHT service bridge denies Drive writes, forwards only read methods",async()=>{
  const hub={fetch:async()=>{throw Error("no workhub call should occur")}};
  for(const request of [{operation:"drive_write",name:"light_drive_file",args:{file_id:file}},
    {operation:"drive_read",name:"light_drive_delete",args:{file_id:file}},
    {operation:"drive_read",name:"light_drive_roots",args:{approved:true}}]){
    const r=await lightBridgeCall(env,hub,request);
    assert.equal(r.ok,false);
  }
  const r=await lightBridgeCall(env,hub,{operation:"drive_read",name:"light_drive_roots",args:{}});
  assert.equal(r.ok,true);assert.equal(r.caller,"LIGHT-BOOKMARK");
});
