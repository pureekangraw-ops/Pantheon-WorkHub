import test from "node:test";
import assert from "node:assert/strict";
import {runDriveTool} from "../drive-read.mjs";
import {lightBridgeCall} from "../light-bridge.mjs";
const file="1mi5UMJRE2Q6nM9u9kz0wgdEVw3QSR2S";
const outside="1fAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const env={LIGHT_BRIDGE_ENABLED:"true",PANTHEON_DRIVE_READ_ENABLED:"true",GOOGLE_ID_SECRET:"test-client-id",GOOGLE_SECRET:"test-client-secret",GOOGLE_REFRESH_TOKEN:"test-refresh-token"};
const respond=(body,status=200)=>new Response(typeof body==="string"?body:JSON.stringify(body),{status});
const captures=[];
const fetcher=async(url,opts)=>{
  captures.push({url,method:opts.method,headers:opts.headers,body:opts.body});
  if(url==="https://oauth2.googleapis.com/token")return respond({access_token:"short-lived-test",token_type:"Bearer",scope:"https://www.googleapis.com/auth/drive.readonly"});
  const u=new URL(url);
  if(u.pathname.endsWith("/files/root"))return respond({id:"root",name:"My Drive",mimeType:"application/vnd.google-apps.folder"});
  if(u.pathname.endsWith("/files")&&u.searchParams.has("q"))return respond({files:[{id:file,name:"train_receipt.json",mimeType:"application/json",webViewLink:"https://drive.google.com/file/d/safe/view"}],nextPageToken:"page-next",incompleteSearch:false});
  if(u.pathname.endsWith("/files/"+file)&&u.searchParams.get("alt")==="media")return respond('{"result":"historical"}');
  if(u.pathname.endsWith("/files/"+file))return respond({id:file,name:"train_receipt.json",mimeType:"application/json",parents:[outside],trashed:false});
  if(u.pathname.endsWith("/files/"+outside))return respond({id:outside,name:"Other folder",mimeType:"application/vnd.google-apps.folder",trashed:false});
  throw Error("Unexpected route: "+url);
};
test("disabled capability fails closed",async()=>{
  const r=await runDriveTool("light_drive_roots",{}, {...env,PANTHEON_DRIVE_READ_ENABLED:"false"},fetcher);
  assert.equal(r.status,"PANTHEON_DRIVE_READ_DISABLED");
});
test("roots and account-wide listing use Drive read APIs only",async()=>{
  captures.length=0;
  const root=await runDriveTool("light_drive_roots",{},env,fetcher);
  assert.equal(root.ok,true);assert.equal(root.result.roots[0].id,"root");
  const list=await runDriveTool("light_drive_list",{limit:10,page_token:"page-prev"},env,fetcher);
  assert.equal(list.ok,true);assert.equal(list.result.capability,"pantheon.drive.read");
  assert.equal(list.result.files[0].id,file);assert.equal(list.result.next_page_token,"page-next");
  const url=new URL(captures.find(x=>x.url.includes("/files?")).url);
  assert.equal(url.searchParams.get("corpora"),"allDrives");assert.equal(url.searchParams.get("supportsAllDrives"),"true");
  assert.equal(url.searchParams.get("pageToken"),"page-prev");
  assert.ok(captures.filter(x=>x.url.includes("googleapis.com/drive/")).every(x=>x.method==="GET"));
  assert.doesNotMatch(JSON.stringify(root)+JSON.stringify(list),/test-client-secret|test-refresh-token|short-lived-test/);
});
test("can read a file outside the former folder allowlist",async()=>{
  captures.length=0;
  const r=await runDriveTool("light_drive_file",{file_id:file},env,fetcher);
  assert.equal(r.ok,true);assert.match(r.result.text,/historical/);
  assert.equal(r.result.read_only,true);assert.equal(r.result.capability,"pantheon.drive.read");
  assert.equal(captures.filter(x=>x.url.includes("googleapis.com/drive/")).length,2);
});
test("account-wide reads fail closed without an explicit broad OAuth scope",async()=>{
  const missing=async(url,opts)=>url==="https://oauth2.googleapis.com/token"?respond({access_token:"unknown-scope",token_type:"Bearer"}):fetcher(url,opts);
  const r=await runDriveTool("light_drive_roots",{},env,missing);
  assert.equal(r.status,"GOOGLE_DRIVE_READ_SCOPE_UNVERIFIED");
});
test("narrow OAuth grants are rejected",async()=>{
  const narrow=async(url,opts)=>url==="https://oauth2.googleapis.com/token"?respond({access_token:"limited",token_type:"Bearer",scope:"https://www.googleapis.com/auth/drive.file"}):fetcher(url,opts);
  const r=await runDriveTool("light_drive_roots",{},env,narrow);
  assert.equal(r.status,"GOOGLE_DRIVE_READ_SCOPE_REQUIRED");
});
test("rejects malformed input and never exposes Drive writes",async()=>{
  captures.length=0;
  for(const [tool,args] of [["light_drive_file",{file_id:"../secrets"}],["light_drive_list",{page_token:"x",write:true}],["light_drive_roots",{approved:true}],["light_drive_create",{folder_id:outside,name:"x"}]]){
    assert.equal((await runDriveTool(tool,args,env,fetcher)).ok,false);
  }
  const hub={fetch:async()=>{throw Error("unexpected WorkHub call");}};
  for(const operation of ["pantheon.drive.write","drive_write"]){
    assert.equal((await lightBridgeCall(env,hub,{operation,name:"light_drive_file",args:{file_id:file}})).status,"DRIVE_CAPABILITY_NOT_ALLOWED");
  }
  assert.equal(captures.length,0);
});
test("PANTHEON returns the exact capability label to LIGHT",async()=>{
  const hub={fetch:async()=>{throw Error("Drive call should not touch WorkHub");}};
  const r=await lightBridgeCall(env,hub,{operation:"pantheon.drive.read",name:"light_drive_roots",args:{}},fetcher);
  assert.equal(r.caller,"LIGHT-BOOKMARK");assert.equal(r.capability,"pantheon.drive.read");assert.equal(r.ok,true);
});
