import test from "node:test";
import assert from "node:assert/strict";
import {runDriveTool} from "../drive-read.mjs";
import {lightBridgeCall} from "../light-bridge.mjs";
const file="1mi5UMJRE2Q6nM9u9kz0wgdEVw3QSR2S", folder="1gmu8Mh8Uve9VX3bRjaPGF4qWmMHfCniz", permission="perm_1234567890";
const env={LIGHT_BRIDGE_ENABLED:"true",PANTHEON_DRIVE_READ_ENABLED:"true",PANTHEON_DRIVE_WRITE_ENABLED:"true",GOOGLE_ID_SECRET:"test-client-id",GOOGLE_SECRET:"test-client-secret",GOOGLE_REFRESH_TOKEN:"test-refresh-token"};
const captures=[];
test("HTTP and size errors keep stable codes and safe diagnostics",async()=>{
  for(const [response,status,failure] of [
    [()=>respond("private upstream body",403),"UPSTREAM_HTTP_403","http"],
    [()=>new Response("x",{headers:{"content-length":"96001"}}),"UPSTREAM_TOO_LARGE","too_large"],
  ]){
    const result=await runDriveTool("light_drive_roots",{},env,async()=>response());
    assert.equal(result.status,status);
    assert.equal(result.upstream_stage,"oauth_token");
    assert.equal(result.upstream_failure,failure);
    assert.doesNotMatch(JSON.stringify(result),/private upstream body/);
  }
});
test("LightBridge preserves safe Drive diagnostics",async()=>{
  const result=await lightBridgeCall(env,{},{
    operation:"pantheon.drive.read",name:"light_drive_roots",args:{},
  },async()=>{throw new TypeError("private error");});
  assert.equal(result.upstream_stage,"oauth_token");
  assert.equal(result.upstream_failure,"network");
  assert.equal(result.caller,"LIGHT-BOOKMARK");
  assert.doesNotMatch(JSON.stringify(result),/private error/);
});
for(const stage of ["oauth_token","drive_api"]){
  for(const phase of ["fetch","body"]){
    for(const failure of ["network","timeout"]){
      test(`safe upstream diagnostics: ${stage}/${phase}/${failure}`,async()=>{
        const broken=async(url,opts)=>{
          const selected=(url==="https://oauth2.googleapis.com/token") === (stage==="oauth_token");
          if(!selected)return fetcher(url,opts);
          const error=Object.assign(Error("secret-client secret-refresh bearer-token private-url"),{name:failure==="timeout"?"TimeoutError":"TypeError"});
          if(phase==="fetch")throw error;
          return new Response(new ReadableStream({start(controller){controller.error(error);}}));
        };
        const result=await runDriveTool("light_drive_roots",{},env,broken);
        assert.equal(result.status,"UPSTREAM_UNAVAILABLE");
        assert.equal(result.upstream_status,502);
        assert.equal(result.upstream_stage,stage);
        assert.equal(result.upstream_phase,phase);
        assert.equal(result.upstream_failure,failure);
        assert.doesNotMatch(JSON.stringify(result),/secret-client|secret-refresh|bearer-token|private-url/);
      });
    }
  }
}
const respond=(body,status=200)=>new Response(typeof body==="string"?body:JSON.stringify(body),{status});
const fetcher=async(url,opts)=>{
  captures.push({url,method:opts.method,headers:opts.headers,body:opts.body});
  if(url==="https://oauth2.googleapis.com/token")return respond({access_token:"short-lived-test",token_type:"Bearer",scope:"https://www.googleapis.com/auth/drive"});
  const u=new URL(url), path=u.pathname;
  if(path.endsWith("/files/root"))return respond({id:"root",name:"My Drive",mimeType:"application/vnd.google-apps.folder"});
  if(path.endsWith("/permissions/"+permission))return respond({id:permission,type:"user",role:"reader"});
  if(path.endsWith("/permissions")){
    if(opts.method==="POST")return respond({id:permission,type:"user",role:"writer",emailAddress:"person@example.com"});
    return respond({permissions:[{id:permission,type:"user",role:"reader"}],nextPageToken:"permission-next"});
  }
  if(path.endsWith("/files")&&u.searchParams.has("q"))return respond({files:[{id:file,name:"train_receipt.json",mimeType:"application/json",webViewLink:"https://drive.google.com/file/d/safe/view"}],nextPageToken:"page-next",incompleteSearch:false});
  if(path.endsWith("/files/"+file+"/copy"))return respond({id:"1copyUMJRE2Q6nM9u9kz0wgdEVw3QSR2S",name:"copy.json",mimeType:"application/json",parents:[folder]});
  if(path.endsWith("/files/"+file)&&u.searchParams.get("alt")==="media")return respond('{"result":"historical"}');
  if(path.includes("/upload/drive/v3/files/"+file))return respond({id:file,name:"train_receipt.json",mimeType:"application/json",parents:[folder]});
  if(path.endsWith("/files/"+file))return respond({id:file,name:"train_receipt.json",mimeType:"application/json",parents:[folder],trashed:false});
  if(path.endsWith("/files/"+folder))return respond({id:folder,name:"Folder",mimeType:"application/vnd.google-apps.folder",parents:["root"],trashed:false});
  if(path.endsWith("/files"))return respond({id:"1newUMJRE2Q6nM9u9kz0wgdEVw3QSR2S",name:"new.txt",mimeType:"text/plain",parents:[folder]});
  throw Error("Unexpected route: "+url);
};
test("read and write flags fail closed",async()=>{
  assert.equal((await runDriveTool("light_drive_roots",{}, {...env,PANTHEON_DRIVE_READ_ENABLED:"false"},fetcher)).status,"PANTHEON_DRIVE_READ_DISABLED");
  assert.equal((await runDriveTool("light_drive_create",{name:"x"},{...env,PANTHEON_DRIVE_WRITE_ENABLED:"false"},fetcher)).status,"PANTHEON_DRIVE_WRITE_DISABLED");
});
test("account-wide read lists across drives and reads files",async()=>{
  captures.length=0;
  const root=await runDriveTool("light_drive_roots",{},env,fetcher);assert.equal(root.ok,true);assert.equal(root.result.roots[0].id,"root");
  const list=await runDriveTool("light_drive_list",{limit:10,page_token:"page-prev"},env,fetcher);assert.equal(list.ok,true);assert.equal(list.result.next_page_token,"page-next");
  const url=new URL(captures.find(x=>x.url.includes("/files?")).url);assert.equal(url.searchParams.get("corpora"),"allDrives");assert.equal(url.searchParams.get("supportsAllDrives"),"true");
  const read=await runDriveTool("light_drive_file",{file_id:file},env,fetcher);assert.match(read.result.text,/historical/);
  const perms=await runDriveTool("light_drive_permissions",{file_id:file,page_token:"p1"},env,fetcher);assert.equal(perms.result.next_page_token,"permission-next");
});
test("all non-delete write operations use the full drive scope",async()=>{
  captures.length=0;
  const cases=[
    ["light_drive_create",{name:"new.txt",folder_id:folder,text:"hello",mime_type:"text/plain"}],
    ["light_drive_update",{file_id:file,text:"updated"}],
    ["light_drive_rename",{file_id:file,name:"renamed.json"}],
    ["light_drive_move",{file_id:file,folder_id:folder}],
    ["light_drive_copy",{file_id:file,name:"copy.json",folder_id:folder}],
    ["light_drive_share",{file_id:file,type:"user",role:"writer",email_address:"person@example.com",send_notification_email:false}],
    ["light_drive_permission_update",{file_id:file,permission_id:permission,role:"writer"}],
  ];
  for(const [name,args] of cases){const result=await runDriveTool(name,args,env,fetcher);assert.equal(result.ok,true,`${name}: ${result.status}`);}
  assert.ok(captures.some(x=>x.method==="POST"));assert.ok(captures.some(x=>x.method==="PATCH"));
  assert.ok(captures.every(x=>x.method!=="DELETE"));
});
test("write operations fail closed without full drive scope",async()=>{
  const narrow=async(url,opts)=>url==="https://oauth2.googleapis.com/token"?respond({access_token:"read-only",token_type:"Bearer",scope:"https://www.googleapis.com/auth/drive.readonly"}):fetcher(url,opts);
  const r=await runDriveTool("light_drive_create",{name:"x.txt"},env,narrow);assert.equal(r.status,"GOOGLE_DRIVE_WRITE_SCOPE_REQUIRED");
});
test("there is no file or permission delete operation",async()=>{
  assert.equal((await runDriveTool("light_drive_delete",{file_id:file},env,fetcher)).status,"UNKNOWN_DRIVE_TOOL");
  assert.equal((await runDriveTool("light_drive_permission_delete",{file_id:file,permission_id:permission},env,fetcher)).status,"UNKNOWN_DRIVE_TOOL");
  const hub={fetch:async()=>{throw Error("unexpected WorkHub call");}};
  for(const operation of ["pantheon.drive.delete","pantheon.drive.permission.delete"]){
    assert.equal((await lightBridgeCall(env,hub,{operation,name:"light_drive_file",args:{file_id:file}},fetcher)).status,"DRIVE_DELETE_NOT_ALLOWED");
  }
  assert.ok(captures.every(x=>x.method!=="DELETE"));
});
test("PANTHEON returns namespaced read and write capability labels",async()=>{
  const hub={fetch:async()=>{throw Error("Drive calls must not touch WorkHub");}};
  const r=await lightBridgeCall(env,hub,{operation:"pantheon.drive.read",name:"light_drive_roots",args:{}},fetcher);
  assert.equal(r.caller,"LIGHT-BOOKMARK");assert.equal(r.capability,"pantheon.drive.read");
  const w=await lightBridgeCall(env,hub,{operation:"pantheon.drive.write",name:"light_drive_create",args:{name:"x.txt"}},fetcher);
  assert.equal(w.capability,"pantheon.drive.write");assert.equal(w.ok,true);
});


test("Workers-compatible OAuth uses manual redirect, never follows credential-bearing redirects",async()=>{
  let stage;
  const response=await runDriveTool("light_drive_roots",{},env,async(url,opts)=>{
    stage=url;
    assert.equal(opts.redirect,"manual");
    return new Response("redirect blocked",{status:302,headers:{location:"https://untrusted.example/"}});
  });
  assert.equal(stage,"https://oauth2.googleapis.com/token");
  assert.equal(response.status,"UPSTREAM_HTTP_302");
  assert.equal(response.upstream_stage,"oauth_token");
  assert.equal(response.upstream_failure,"http");
  assert.doesNotMatch(JSON.stringify(response),/untrusted.example|redirect blocked/);
});
