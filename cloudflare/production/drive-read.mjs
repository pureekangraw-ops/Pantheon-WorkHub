// Google Drive capability for LIGHT. OAuth credentials stay only in PANTHEON.
// No DELETE request or delete operation is implemented.
const ID=/^[a-zA-Z0-9_-]{12,100}$/;
const PERMISSION_ID=/^[a-zA-Z0-9_-]{1,200}$/;
const DRIVE_READ_SCOPE="https://www.googleapis.com/auth/drive.readonly";
const DRIVE_FULL_SCOPE="https://www.googleapis.com/auth/drive";
const READ_TOOLS=new Set(["light_drive_roots","light_drive_list","light_drive_file","light_drive_permissions"]);
const WRITE_TOOLS=new Set(["light_drive_create","light_drive_update","light_drive_rename","light_drive_move","light_drive_copy","light_drive_share","light_drive_permission_update"]);
const shape=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const bad=(status,http=400)=>({ok:false,status,upstream_status:http});
const success=value=>({ok:true,result:value});
const MAX=96000;
const TEXT_TYPES=new Set(["text/plain","text/markdown","text/csv","application/json","application/x-ipynb+json"]);
const CREATE_TYPES=new Set(["text/plain","text/markdown","text/csv","application/json","application/vnd.google-apps.folder"]);
const ROLES=new Set(["reader","commenter","writer"]);
async function readLimited(response){
  if(Number(response.headers.get("content-length")||0)>MAX)throw Error("UPSTREAM_TOO_LARGE");
  let data="";
  if(!response.body){data=await response.text();if(data.length>MAX)throw Error("UPSTREAM_TOO_LARGE");return data;}
  const reader=response.body.getReader();const decode=new TextDecoder();let total=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX)throw Error("UPSTREAM_TOO_LARGE");data+=decode.decode(value,{stream:true});}
    data+=decode.decode();return data;
  }finally{reader.releaseLock();}
}
async function readApi(url,options,fetcher){
  let res;try{res=await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(10000),...options});}
  catch{throw Error("UPSTREAM_UNAVAILABLE");}
  if(!res.ok)throw Error("UPSTREAM_HTTP_"+res.status);
  return readLimited(res);
}
async function googleToken(env,fetcher,write=false){
  if(!env.GOOGLE_ID_SECRET||!env.GOOGLE_SECRET||!env.GOOGLE_REFRESH_TOKEN)throw Error("GOOGLE_OAUTH_NOT_CONFIGURED");
  const body=new URLSearchParams({client_id:env.GOOGLE_ID_SECRET,client_secret:env.GOOGLE_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:"refresh_token"});
  const raw=await readApi("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:body.toString()},fetcher);
  let data;try{data=JSON.parse(raw);}catch{throw Error("GOOGLE_AUTH_BAD_RESPONSE");}
  if(typeof data.access_token!=="string"||!data.access_token||data.token_type?.toLowerCase()!=="bearer")throw Error("GOOGLE_AUTH_BAD_RESPONSE");
  if(typeof data.scope!=="string")throw Error("GOOGLE_DRIVE_SCOPE_UNVERIFIED");
  const scopes=new Set(data.scope.split(/\s+/));
  if(write&&!scopes.has(DRIVE_FULL_SCOPE))throw Error("GOOGLE_DRIVE_WRITE_SCOPE_REQUIRED");
  if(!write&&!scopes.has(DRIVE_READ_SCOPE)&&!scopes.has(DRIVE_FULL_SCOPE))throw Error("GOOGLE_DRIVE_READ_SCOPE_REQUIRED");
  return data.access_token;
}
function parseJson(raw,error="DRIVE_INVALID_RESPONSE"){
  let data;try{data=JSON.parse(raw);}catch{throw Error(error);}
  if(!data||typeof data!=="object"||Array.isArray(data))throw Error(error);
  return data;
}
async function driveGet(path,token,fetcher){
  const raw=await readApi("https://www.googleapis.com/drive/v3/"+path,{method:"GET",headers:{authorization:"Bearer "+token}},fetcher);
  return parseJson(raw);
}
async function driveJson(path,method,token,body,fetcher){
  const raw=await readApi("https://www.googleapis.com/drive/v3/"+path,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(body)},fetcher);
  return parseJson(raw);
}
const validFileId=id=>typeof id==="string"&&ID.test(id);
const validFolderId=id=>id==="root"||validFileId(id);
const escapeQuery=value=>value.replaceAll("\\","\\\\").replaceAll("'","\\'");
async function metadata(id,token,fetcher){
  const q=new URLSearchParams({supportsAllDrives:"true",fields:"id,name,mimeType,parents,webViewLink,trashed"});
  return driveGet("files/"+encodeURIComponent(id)+"?"+q,token,fetcher);
}
function safeFile(file){return {id:file.id,name:file.name,mimeType:file.mimeType,parents:file.parents||[],url:file.webViewLink||null};}
function readArgs(name,args){
  if(name==="light_drive_roots")return shape(args,[]);
  if(name==="light_drive_list")return shape(args,["folder_id","query","limit","page_token"])&&
    (args.folder_id===undefined||validFolderId(args.folder_id))&&
    (args.query===undefined||(typeof args.query==="string"&&args.query.length<=80))&&
    (args.limit===undefined||(Number.isInteger(args.limit)&&args.limit>=1&&args.limit<=30))&&
    (args.page_token===undefined||(typeof args.page_token==="string"&&args.page_token.length<=2048));
  if(name==="light_drive_file")return shape(args,["file_id"])&&validFileId(args.file_id);
  if(name==="light_drive_permissions")return shape(args,["file_id","page_token"])&&validFileId(args.file_id)&&
    (args.page_token===undefined||(typeof args.page_token==="string"&&args.page_token.length<=2048));
  return false;
}
function writeArgs(name,args){
  if(name==="light_drive_create")return shape(args,["folder_id","name","text","mime_type"])&&
    (args.folder_id===undefined||validFolderId(args.folder_id))&&typeof args.name==="string"&&args.name.trim().length>0&&args.name.length<=180&&
    (args.text===undefined||(typeof args.text==="string"&&new TextEncoder().encode(args.text).length<=60000))&&
    (args.mime_type===undefined||CREATE_TYPES.has(args.mime_type));
  if(name==="light_drive_update")return shape(args,["file_id","text"])&&validFileId(args.file_id)&&typeof args.text==="string"&&new TextEncoder().encode(args.text).length<=60000;
  if(name==="light_drive_rename")return shape(args,["file_id","name"])&&validFileId(args.file_id)&&typeof args.name==="string"&&args.name.trim().length>0&&args.name.length<=180;
  if(name==="light_drive_move")return shape(args,["file_id","folder_id"])&&validFileId(args.file_id)&&validFolderId(args.folder_id);
  if(name==="light_drive_copy")return shape(args,["file_id","name","folder_id"])&&validFileId(args.file_id)&&
    (args.name===undefined||(typeof args.name==="string"&&args.name.trim().length>0&&args.name.length<=180))&&
    (args.folder_id===undefined||validFolderId(args.folder_id));
  if(name==="light_drive_share")return shape(args,["file_id","type","role","email_address","domain","send_notification_email"])&&validFileId(args.file_id)&&
    ["user","group","domain","anyone"].includes(args.type)&&ROLES.has(args.role)&&
    ((["user","group"].includes(args.type)&&typeof args.email_address==="string"&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email_address)&&args.domain===undefined)||
     (args.type==="domain"&&typeof args.domain==="string"&&/^[A-Za-z0-9.-]{1,253}$/.test(args.domain)&&args.email_address===undefined)||
     (args.type==="anyone"&&args.email_address===undefined&&args.domain===undefined))&&
    (args.send_notification_email===undefined||typeof args.send_notification_email==="boolean");
  if(name==="light_drive_permission_update")return shape(args,["file_id","permission_id","role","allow_file_discovery"])&&validFileId(args.file_id)&&
    typeof args.permission_id==="string"&&PERMISSION_ID.test(args.permission_id)&&
    ((args.role===undefined&&!Object.hasOwn(args,"allow_file_discovery"))||(args.role===undefined||ROLES.has(args.role)))&&
    (args.allow_file_discovery===undefined||typeof args.allow_file_discovery==="boolean");
  return false;
}
async function runReadTool(name,args,token,fetcher){
  if(name==="light_drive_roots"){
    const root=await metadata("root",token,fetcher);
    return {source:"google_drive",capability:"pantheon.drive.read",read_only:true,roots:[{id:root.id||"root",name:root.name||"My Drive",mimeType:root.mimeType||"application/vnd.google-apps.folder"}]};
  }
  if(name==="light_drive_list"){
    const clauses=["trashed = false"];
    if(args.folder_id)clauses.push("'"+args.folder_id+"' in parents");
    const clean=typeof args.query==="string"?args.query.trim():"";
    if(clean)clauses.push("name contains '"+escapeQuery(clean)+"'");
    const query=new URLSearchParams({q:clauses.join(" and "),corpora:"allDrives",includeItemsFromAllDrives:"true",supportsAllDrives:"true",fields:"nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,modifiedTime,size)",pageSize:String(args.limit||20),orderBy:"modifiedTime desc"});
    if(args.page_token)query.set("pageToken",args.page_token);
    const data=await driveGet("files?"+query,token,fetcher);
    if(!Array.isArray(data.files))throw Error("DRIVE_INVALID_RESPONSE");
    return {source:"google_drive",capability:"pantheon.drive.read",read_only:true,folder_id:args.folder_id||null,
      files:data.files.slice(0,30).map(f=>({id:f.id,name:f.name,mimeType:f.mimeType,url:f.webViewLink||null,modifiedTime:f.modifiedTime||null,size:f.size||null})),
      next_page_token:data.nextPageToken||null,incomplete_search:data.incompleteSearch===true};
  }
  if(name==="light_drive_file"){
    const file=await metadata(args.file_id,token,fetcher);
    if(file.trashed===true)throw Object.assign(Error("DRIVE_ITEM_TRASHED"),{http:404});
    let uri;
    if(file.mimeType==="application/vnd.google-apps.document")uri="files/"+encodeURIComponent(file.id)+"/export?mimeType=text%2Fplain";
    else if(file.mimeType==="application/vnd.google-apps.spreadsheet")uri="files/"+encodeURIComponent(file.id)+"/export?mimeType=text%2Fcsv";
    else if(TEXT_TYPES.has(file.mimeType))uri="files/"+encodeURIComponent(file.id)+"?alt=media&supportsAllDrives=true";
    else throw Object.assign(Error("DRIVE_UNSUPPORTED_MIME"),{http:415});
    const text=await readApi("https://www.googleapis.com/drive/v3/"+uri,{method:"GET",headers:{authorization:"Bearer "+token}},fetcher);
    return {source:"google_drive",capability:"pantheon.drive.read",read_only:true,...safeFile(file),text:text.slice(0,30000),truncated:text.length>30000};
  }
  const query=new URLSearchParams({supportsAllDrives:"true",pageSize:"100",fields:"nextPageToken,permissions(id,type,role,emailAddress,domain,displayName,allowFileDiscovery,expirationTime)"});
  if(args.page_token)query.set("pageToken",args.page_token);
  const data=await driveGet("files/"+encodeURIComponent(args.file_id)+"/permissions?"+query,token,fetcher);
  if(!Array.isArray(data.permissions))throw Error("DRIVE_INVALID_RESPONSE");
  return {source:"google_drive",capability:"pantheon.drive.read",read_only:true,file_id:args.file_id,permissions:data.permissions,next_page_token:data.nextPageToken||null};
}
async function runWriteTool(name,args,token,fetcher){
  const metaFields="id,name,mimeType,parents,webViewLink";
  if(name==="light_drive_create"){
    const mime=args.mime_type||"text/plain";const isFolder=mime==="application/vnd.google-apps.folder";
    if(isFolder&&args.text!==undefined&&args.text!=="")throw Error("INVALID_INPUT");
    const meta={name:args.name.trim(),mimeType:mime};
    if(args.folder_id&&args.folder_id!=="root")meta.parents=[args.folder_id];
    let result;
    if(isFolder)result=await driveJson("files?supportsAllDrives=true&fields="+encodeURIComponent(metaFields),"POST",token,meta,fetcher);
    else{
      const boundary="pantheon_"+crypto.randomUUID().replaceAll("-","");
      const body="--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+JSON.stringify(meta)+"\r\n--"+boundary+"\r\nContent-Type: "+mime+"; charset=UTF-8\r\n\r\n"+(args.text||"")+"\r\n--"+boundary+"--";
      const raw=await readApi("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields="+encodeURIComponent(metaFields),{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"multipart/related; boundary="+boundary},body},fetcher);
      result=parseJson(raw);
    }
    if(!result.id)throw Error("DRIVE_INVALID_RESPONSE");
    return {source:"google_drive",capability:"pantheon.drive.write",read_only:false,action:"created",...safeFile(result)};
  }
  if(name==="light_drive_update"){
    const file=await metadata(args.file_id,token,fetcher);
    if(!TEXT_TYPES.has(file.mimeType))throw Object.assign(Error("DRIVE_UNSUPPORTED_MIME"),{http:415});
    const raw=await readApi("https://www.googleapis.com/upload/drive/v3/files/"+encodeURIComponent(args.file_id)+"?uploadType=media&supportsAllDrives=true&fields="+encodeURIComponent(metaFields),{method:"PATCH",headers:{authorization:"Bearer "+token,"content-type":"application/octet-stream"},body:args.text},fetcher);
    const result=parseJson(raw);if(!result.id)throw Error("DRIVE_INVALID_RESPONSE");
    return {source:"google_drive",capability:"pantheon.drive.write",read_only:false,action:"updated",...safeFile(result)};
  }
  if(name==="light_drive_rename"){
    const q=new URLSearchParams({supportsAllDrives:"true",fields:metaFields});
    const result=await driveJson("files/"+encodeURIComponent(args.file_id)+"?"+q,"PATCH",token,{name:args.name.trim()},fetcher);
    if(!result.id)throw Error("DRIVE_INVALID_RESPONSE");
    return {source:"google_drive",capability:"pantheon.drive.write",read_only:false,action:"renamed",...safeFile(result)};
  }
  if(name==="light_drive_move"){
    if(args.file_id===args.folder_id)throw Error("DRIVE_MOVE_CYCLE_NOT_ALLOWED");
    const [file,dest]=await Promise.all([metadata(args.file_id,token,fetcher),metadata(args.folder_id,token,fetcher)]);
    if(dest.mimeType!=="application/vnd.google-apps.folder")throw Error("DRIVE_DESTINATION_NOT_FOLDER");
    if(file.trashed===true||dest.trashed===true)throw Error("DRIVE_ITEM_TRASHED");
    const q=new URLSearchParams({addParents:args.folder_id,supportsAllDrives:"true",fields:metaFields});
    if(Array.isArray(file.parents)&&file.parents.length)q.set("removeParents",file.parents.join(","));
    const result=await driveJson("files/"+encodeURIComponent(args.file_id)+"?"+q,"PATCH",token,{},fetcher);
    if(!result.id)throw Error("DRIVE_INVALID_RESPONSE");
    return {source:"google_drive",capability:"pantheon.drive.write",read_only:false,action:"moved",...safeFile(result)};
  }
  if(name==="light_drive_copy"){
    const source=await metadata(args.file_id,token,fetcher);
    if(source.trashed===true)throw Error("DRIVE_ITEM_TRASHED");
    if(source.mimeType==="application/vnd.google-apps.folder")throw Error("DRIVE_COPY_FOLDER_NOT_SUPPORTED");
    const body={};if(args.name)body.name=args.name.trim();if(args.folder_id&&args.folder_id!=="root")body.parents=[args.folder_id];
    const q=new URLSearchParams({supportsAllDrives:"true",fields:metaFields});
    const result=await driveJson("files/"+encodeURIComponent(args.file_id)+"/copy?"+q,"POST",token,body,fetcher);
    if(!result.id)throw Error("DRIVE_INVALID_RESPONSE");
    return {source:"google_drive",capability:"pantheon.drive.write",read_only:false,action:"copied",...safeFile(result)};
  }
  if(name==="light_drive_share"){
    const body={type:args.type,role:args.role};
    if(args.email_address)body.emailAddress=args.email_address;
    if(args.domain)body.domain=args.domain;
    const q=new URLSearchParams({supportsAllDrives:"true",fields:"id,type,role,emailAddress,domain,allowFileDiscovery"});
    if(["user","group"].includes(args.type))q.set("sendNotificationEmail",String(args.send_notification_email===true));
    const result=await driveJson("files/"+encodeURIComponent(args.file_id)+"/permissions?"+q,"POST",token,body,fetcher);
    if(!result.id)throw Error("DRIVE_INVALID_RESPONSE");
    return {source:"google_drive",capability:"pantheon.drive.write",read_only:false,action:"shared",file_id:args.file_id,permission:result};
  }
  const q=new URLSearchParams({supportsAllDrives:"true",fields:"id,type,role,allowFileDiscovery"});
  const current=await driveGet("files/"+encodeURIComponent(args.file_id)+"/permissions/"+encodeURIComponent(args.permission_id)+"?"+q,token,fetcher);
  if(current.role==="owner")throw Error("DRIVE_OWNER_PERMISSION_CHANGE_NOT_ALLOWED");
  if(args.allow_file_discovery!==undefined&&!['anyone','domain'].includes(current.type))throw Error("DRIVE_DISCOVERY_SETTING_NOT_SUPPORTED");
  const body={};if(args.role!==undefined)body.role=args.role;if(args.allow_file_discovery!==undefined)body.allowFileDiscovery=args.allow_file_discovery;
  if(!Object.keys(body).length)throw Error("INVALID_INPUT");
  const result=await driveJson("files/"+encodeURIComponent(args.file_id)+"/permissions/"+encodeURIComponent(args.permission_id)+"?"+q,"PATCH",token,body,fetcher);
  if(!result.id)throw Error("DRIVE_INVALID_RESPONSE");
  return {source:"google_drive",capability:"pantheon.drive.write",read_only:false,action:"permission_updated",file_id:args.file_id,permission:result};
}
export async function runDriveTool(name,args={},env={},fetcher=fetch){
  if(!READ_TOOLS.has(name)&&!WRITE_TOOLS.has(name))return bad("UNKNOWN_DRIVE_TOOL");
  const write=WRITE_TOOLS.has(name);
  if(write?env.PANTHEON_DRIVE_WRITE_ENABLED!=="true":env.PANTHEON_DRIVE_READ_ENABLED!=="true")return bad(write?"PANTHEON_DRIVE_WRITE_DISABLED":"PANTHEON_DRIVE_READ_DISABLED",503);
  if(write?!writeArgs(name,args):!readArgs(name,args))return bad("INVALID_INPUT");
  try{
    const token=await googleToken(env,fetcher,write);
    return success(write?await runWriteTool(name,args,token,fetcher):await runReadTool(name,args,token,fetcher));
  }catch(e){return bad(e instanceof Error?e.message:"DRIVE_UNAVAILABLE",e?.http||502);}
}
