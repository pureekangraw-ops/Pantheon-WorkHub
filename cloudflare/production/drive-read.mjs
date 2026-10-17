// Google Drive read-only bridge. OAuth credentials stay only in PANTHEON.
// Folder allowlists are mandatory, and every file is checked against them.
const ID=/^[a-zA-Z0-9_-]{12,100}$/;
const allowed=v=>new Set(String(v||"").split(",").map(x=>x.trim()).filter(x=>ID.test(x)));
const shape=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const bad=(status,http=400)=>({ok:false,status,upstream_status:http});
const success=value=>({ok:true,result:value});
const MAX=96000;
async function readLimited(response){
  if(Number(response.headers.get("content-length")||0)>MAX)throw Error("UPSTREAM_TOO_LARGE");
  let data="";
  if(!response.body){data=await response.text();if(data.length>MAX)throw Error("UPSTREAM_TOO_LARGE");return data;}
  const reader=response.body.getReader();const decode=new TextDecoder();let total=0;
  try {
    while(true){
      const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;if(total>MAX)throw Error("UPSTREAM_TOO_LARGE");
      data+=decode.decode(value,{stream:true});
    }
    data+=decode.decode();return data;
  }finally{reader.releaseLock();}
}
async function readApi(url,options,fetcher){
  let res;try{res=await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(10000),...options});}
  catch{throw Error("UPSTREAM_UNAVAILABLE");}
  if(!res.ok)throw Error("UPSTREAM_HTTP_"+res.status);
  return readLimited(res);
}
async function googleToken(env,fetcher){
  if(!env.GOOGLE_ID_SECRET||!env.GOOGLE_SECRET||!env.GOOGLE_REFRESH_TOKEN)throw Error("GOOGLE_OAUTH_NOT_CONFIGURED");
  const body=new URLSearchParams({
    client_id:env.GOOGLE_ID_SECRET,
    client_secret:env.GOOGLE_SECRET,
    refresh_token:env.GOOGLE_REFRESH_TOKEN,
    grant_type:"refresh_token"
  });
  const raw=await readApi("https://oauth2.googleapis.com/token",{
    method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:body.toString()
  },fetcher);
  let data;try{data=JSON.parse(raw);}catch{throw Error("GOOGLE_AUTH_BAD_RESPONSE");}
  if(typeof data.access_token!=="string"||!data.access_token||data.token_type?.toLowerCase()!=="bearer")throw Error("GOOGLE_AUTH_BAD_RESPONSE");
  return data.access_token;
}
async function driveGet(path,token,fetcher){
  const raw=await readApi("https://www.googleapis.com/drive/v3/"+path,{method:"GET",headers:{authorization:"Bearer "+token}},fetcher);
  let data;try{data=JSON.parse(raw)}catch{throw Error("DRIVE_INVALID_RESPONSE");}
  if(!data||typeof data!=="object"||Array.isArray(data))throw Error("DRIVE_INVALID_RESPONSE");
  return data;
}
async function metadata(id,token,fetcher){
  return driveGet("files/"+encodeURIComponent(id)+"?fields="+encodeURIComponent("id,name,mimeType,parents,webViewLink,trashed"),token,fetcher);
}
// Verify ancestry, not just a client-supplied parent ID.
async function inScope(id,roots,token,fetcher){
  const seen=new Set();
  let frontier=[id];
  for(let depth=0;depth<10&&frontier.length;depth++){
    const next=[];
    for(const current of frontier){
      if(roots.has(current))return true;
      if(seen.has(current))continue;
      seen.add(current);
      if(seen.size>30)throw Error("DRIVE_ANCESTRY_LIMIT");
      const m=await metadata(current,token,fetcher);
      if(m.trashed===true)throw Error("DRIVE_ITEM_TRASHED");
      if(!Array.isArray(m.parents))continue;
      for(const parent of m.parents)if(ID.test(parent))next.push(parent);
    }
    frontier=next;
  }
  return false;
}
const fileId=i=>typeof i==="string"&&ID.test(i);
export async function runDriveTool(name,args={},env={},fetcher=fetch){
  if(!["light_drive_roots","light_drive_list","light_drive_file","light_drive_create","light_drive_update","light_drive_move"].includes(name))return bad("UNKNOWN_DRIVE_TOOL");
  const roots=allowed(env.PANTHEON_DRIVE_ALLOWED_FOLDERS);
  if(!roots.size)return bad("DRIVE_FOLDER_ALLOWLIST_NOT_CONFIGURED",503);
  if(name==="light_drive_roots")return shape(args,[])?success({source:"google_drive",folder_ids:[...roots]}):bad("INVALID_INPUT");
  if(["light_drive_create","light_drive_update","light_drive_move"].includes(name)){
    const isCreate=name==="light_drive_create",isUpdate=name==="light_drive_update";
    const keys=isCreate?["folder_id","name","text","mime_type"]:isUpdate?["file_id","text"]:["file_id","folder_id"];
    if(!shape(args,keys))return bad("INVALID_INPUT");
    if(isCreate?(!fileId(args.folder_id)||typeof args.name!=="string"||!args.name.trim()||args.name.length>180):
       (!fileId(args.file_id)||(isUpdate?false:!fileId(args.folder_id))))return bad("INVALID_INPUT");
    if((isCreate||isUpdate)&&(typeof args.text!=="string"||new TextEncoder().encode(args.text).length>60000))return bad("INVALID_INPUT");
    if(isCreate&&args.mime_type!==undefined&&!["text/plain","text/markdown","text/csv","application/json","application/vnd.google-apps.folder"].includes(args.mime_type))return bad("INVALID_INPUT");
    try{
      const token=await googleToken(env,fetcher);
      const source=isCreate?args.folder_id:args.file_id;
      if(!(await inScope(source,roots,token,fetcher)))return bad("RESOURCE_NOT_ALLOWLISTED",403);
      if(!isCreate){
        const item=await metadata(args.file_id,token,fetcher);
        if(item.trashed)return bad("DRIVE_ITEM_TRASHED",404);
        if(isUpdate&&!["text/plain","text/markdown","text/csv","application/json"].includes(item.mimeType))return bad("DRIVE_UNSUPPORTED_MIME",415);
        if(!isUpdate&&(!Array.isArray(item.parents)||item.parents.length!==1||roots.has(args.file_id)))return bad("DRIVE_MOVE_NOT_ALLOWED",403);
      }
      if(!isCreate&&!isUpdate&&!(await inScope(args.folder_id,roots,token,fetcher)))return bad("RESOURCE_NOT_ALLOWLISTED",403);
      const headers={authorization:"Bearer "+token};
      let url,options;
      if(isCreate){
        const mime=args.mime_type||"text/plain";
        const folder=mime==="application/vnd.google-apps.folder";
        const meta={name:args.name.trim(),parents:[args.folder_id],mimeType:mime};
        if(folder){url="https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,parents";options={method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(meta)};}
        else{const boundary="pantheon_drive_boundary";
          url="https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,parents";
          options={method:"POST",headers:{...headers,"content-type":"multipart/related; boundary="+boundary},body:"--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+JSON.stringify(meta)+"\r\n--"+boundary+"\r\nContent-Type: "+mime+"; charset=UTF-8\r\n\r\n"+args.text+"\r\n--"+boundary+"--"};}
      }else if(isUpdate){url="https://www.googleapis.com/upload/drive/v3/files/"+encodeURIComponent(args.file_id)+"?uploadType=media&fields=id,name,mimeType,parents";options={method:"PATCH",headers:{...headers,"content-type":"text/plain; charset=UTF-8"},body:args.text};}
      else{const item=await metadata(args.file_id,token,fetcher);const q=new URLSearchParams({addParents:args.folder_id,removeParents:item.parents[0],fields:"id,name,mimeType,parents"});url="https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(args.file_id)+"?"+q;options={method:"PATCH",headers};}
      const raw=await readApi(url,options,fetcher);
      const result=JSON.parse(raw);
      if(!result.id)return bad("DRIVE_INVALID_RESPONSE",502);
      return success({source:"google_drive",id:result.id,name:result.name,mimeType:result.mimeType,parents:result.parents});
    }catch(e){return bad(e instanceof Error?e.message:"DRIVE_UNAVAILABLE",502);}
  }
  if(name==="light_drive_list"){
    if(!shape(args,["folder_id","query","limit"])||
       (args.folder_id!==undefined&&!fileId(args.folder_id))||
       (args.query!==undefined&&(typeof args.query!=="string"||args.query.length>80))||
       (args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>30)))return bad("INVALID_INPUT");
    if(!args.folder_id&&roots.size!==1)return bad("FOLDER_ID_REQUIRED");
  }else if(!shape(args,["file_id"])||!fileId(args.file_id))return bad("INVALID_INPUT");
  try{
    const token=await googleToken(env,fetcher);
    if(name==="light_drive_list"){
      const folder=args.folder_id||[...roots][0];
      if(!(await inScope(folder,roots,token,fetcher)))return bad("RESOURCE_NOT_ALLOWLISTED",403);
      const clean=typeof args.query==="string"?args.query.trim():"";
      const q="'"+folder+"' in parents and trashed = false"+(clean?" and name contains '"+clean.replaceAll("\\","\\\\").replaceAll("'","\\'")+"'":"");
      const params=new URLSearchParams({q,fields:"nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,size)",pageSize:String(args.limit||20),orderBy:"modifiedTime desc"});
      const data=await driveGet("files?"+params,token,fetcher);
      if(!Array.isArray(data.files))throw Error("DRIVE_INVALID_RESPONSE");
      return success({source:"google_drive",folder_id:folder,files:data.files.slice(0,30).map(f=>({
        id:f.id,name:f.name,mimeType:f.mimeType,url:f.webViewLink||null,modifiedTime:f.modifiedTime||null,size:f.size||null
      })),has_more:!!data.nextPageToken});
    }
    const file=await metadata(args.file_id,token,fetcher);
    if(file.trashed===true)return bad("DRIVE_ITEM_TRASHED",404);
    if(!(await inScope(file.id,roots,token,fetcher)))return bad("RESOURCE_NOT_ALLOWLISTED",403);
    let uri;
    if(file.mimeType==="application/vnd.google-apps.document")
      uri="files/"+encodeURIComponent(file.id)+"/export?mimeType=text%2Fplain";
    else if(file.mimeType==="application/vnd.google-apps.spreadsheet")
      uri="files/"+encodeURIComponent(file.id)+"/export?mimeType=text%2Fcsv";
    else if(["text/plain","text/markdown","text/csv","application/json","application/x-ipynb+json"].includes(file.mimeType))
      uri="files/"+encodeURIComponent(file.id)+"?alt=media";
    else return bad("DRIVE_UNSUPPORTED_MIME",415);
    const text=await readApi("https://www.googleapis.com/drive/v3/"+uri,{method:"GET",headers:{authorization:"Bearer "+token}},fetcher);
    return success({source:"google_drive",id:file.id,name:file.name,mimeType:file.mimeType,text:text.slice(0,30000),truncated:text.length>30000});
  }catch(e){return bad(e instanceof Error?e.message:"DRIVE_UNAVAILABLE",502);}
}
