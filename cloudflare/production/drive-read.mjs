// Read-only Google Drive capability. OAuth credentials stay only in PANTHEON.
const ID=/^[a-zA-Z0-9_-]{12,100}$/;
const DRIVE_READ_SCOPE="https://www.googleapis.com/auth/drive.readonly";
const DRIVE_FULL_SCOPE="https://www.googleapis.com/auth/drive";
const shape=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const bad=(status,http=400)=>({ok:false,status,upstream_status:http});
const success=value=>({ok:true,result:value});
const MAX=96000;
async function readLimited(response){
  if(Number(response.headers.get("content-length")||0)>MAX)throw Error("UPSTREAM_TOO_LARGE");
  let data="";
  if(!response.body){data=await response.text();if(data.length>MAX)throw Error("UPSTREAM_TOO_LARGE");return data;}
  const reader=response.body.getReader();const decode=new TextDecoder();let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;if(total>MAX)throw Error("UPSTREAM_TOO_LARGE");
      data+=decode.decode(value,{stream:true});
    }
    data+=decode.decode();return data;
  }finally{reader.releaseLock();}
}
async function readApi(url,options,fetcher){
  let res;
  try{res=await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(10000),...options});}
  catch{throw Error("UPSTREAM_UNAVAILABLE");}
  if(!res.ok)throw Error("UPSTREAM_HTTP_"+res.status);
  return readLimited(res);
}
async function googleToken(env,fetcher){
  if(!env.GOOGLE_ID_SECRET||!env.GOOGLE_SECRET||!env.GOOGLE_REFRESH_TOKEN)throw Error("GOOGLE_OAUTH_NOT_CONFIGURED");
  const body=new URLSearchParams({client_id:env.GOOGLE_ID_SECRET,client_secret:env.GOOGLE_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:"refresh_token"});
  const raw=await readApi("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:body.toString()},fetcher);
  let data;try{data=JSON.parse(raw);}catch{throw Error("GOOGLE_AUTH_BAD_RESPONSE");}
  if(typeof data.access_token!=="string"||!data.access_token||data.token_type?.toLowerCase()!=="bearer")throw Error("GOOGLE_AUTH_BAD_RESPONSE");
  if(typeof data.scope!=="string")throw Error("GOOGLE_DRIVE_READ_SCOPE_UNVERIFIED");
  const scopes=new Set(data.scope.split(/\s+/));
  if(!scopes.has(DRIVE_READ_SCOPE)&&!scopes.has(DRIVE_FULL_SCOPE))throw Error("GOOGLE_DRIVE_READ_SCOPE_REQUIRED");
  return data.access_token;
}
async function driveGet(path,token,fetcher){
  const raw=await readApi("https://www.googleapis.com/drive/v3/"+path,{method:"GET",headers:{authorization:"Bearer "+token}},fetcher);
  let data;try{data=JSON.parse(raw);}catch{throw Error("DRIVE_INVALID_RESPONSE");}
  if(!data||typeof data!=="object"||Array.isArray(data))throw Error("DRIVE_INVALID_RESPONSE");
  return data;
}
const validFileId=id=>typeof id==="string"&&ID.test(id);
const validFolderId=id=>id==="root"||validFileId(id);
async function metadata(id,token,fetcher){
  const q=new URLSearchParams({supportsAllDrives:"true",fields:"id,name,mimeType,webViewLink,trashed"});
  return driveGet("files/"+encodeURIComponent(id)+"?"+q,token,fetcher);
}
const escapeQuery=value=>value.replaceAll("\\","\\\\").replaceAll("'","\\'");
export async function runDriveTool(name,args={},env={},fetcher=fetch){
  if(!["light_drive_roots","light_drive_list","light_drive_file"].includes(name))return bad("UNKNOWN_DRIVE_TOOL");
  if(env.PANTHEON_DRIVE_READ_ENABLED!=="true")return bad("PANTHEON_DRIVE_READ_DISABLED",503);
  if(name==="light_drive_roots"){
    if(!shape(args,[]))return bad("INVALID_INPUT");
    try{
      const token=await googleToken(env,fetcher);
      const root=await metadata("root",token,fetcher);
      return success({source:"google_drive",capability:"pantheon.drive.read",read_only:true,roots:[{id:root.id||"root",name:root.name||"My Drive",mimeType:root.mimeType||"application/vnd.google-apps.folder"}]});
    }catch(e){return bad(e instanceof Error?e.message:"DRIVE_UNAVAILABLE",502);}
  }
  if(name==="light_drive_list"){
    if(!shape(args,["folder_id","query","limit","page_token"])||
      (args.folder_id!==undefined&&!validFolderId(args.folder_id))||
      (args.query!==undefined&&(typeof args.query!=="string"||args.query.length>80))||
      (args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>30))||
      (args.page_token!==undefined&&(typeof args.page_token!=="string"||args.page_token.length>2048)))return bad("INVALID_INPUT");
    try{
      const token=await googleToken(env,fetcher);
      const clauses=["trashed = false"];
      if(args.folder_id)clauses.push("'"+args.folder_id+"' in parents");
      const clean=typeof args.query==="string"?args.query.trim():"";
      if(clean)clauses.push("name contains '"+escapeQuery(clean)+"'");
      const query=new URLSearchParams({
        q:clauses.join(" and "),
        corpora:"allDrives",
        includeItemsFromAllDrives:"true",
        supportsAllDrives:"true",
        fields:"nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,modifiedTime,size)",
        pageSize:String(args.limit||20),
        orderBy:"modifiedTime desc",
      });
      if(args.page_token)query.set("pageToken",args.page_token);
      const data=await driveGet("files?"+query,token,fetcher);
      if(!Array.isArray(data.files))throw Error("DRIVE_INVALID_RESPONSE");
      return success({
        source:"google_drive",capability:"pantheon.drive.read",read_only:true,folder_id:args.folder_id||null,
        files:data.files.slice(0,30).map(f=>({id:f.id,name:f.name,mimeType:f.mimeType,url:f.webViewLink||null,modifiedTime:f.modifiedTime||null,size:f.size||null})),
        next_page_token:data.nextPageToken||null,incomplete_search:data.incompleteSearch===true,
      });
    }catch(e){return bad(e instanceof Error?e.message:"DRIVE_UNAVAILABLE",502);}
  }
  if(!shape(args,["file_id"])||!validFileId(args.file_id))return bad("INVALID_INPUT");
  try{
    const token=await googleToken(env,fetcher);
    const file=await metadata(args.file_id,token,fetcher);
    if(file.trashed===true)return bad("DRIVE_ITEM_TRASHED",404);
    let uri;
    if(file.mimeType==="application/vnd.google-apps.document")uri="files/"+encodeURIComponent(file.id)+"/export?mimeType=text%2Fplain";
    else if(file.mimeType==="application/vnd.google-apps.spreadsheet")uri="files/"+encodeURIComponent(file.id)+"/export?mimeType=text%2Fcsv";
    else if(["text/plain","text/markdown","text/csv","application/json","application/x-ipynb+json"].includes(file.mimeType))uri="files/"+encodeURIComponent(file.id)+"?alt=media&supportsAllDrives=true";
    else return bad("DRIVE_UNSUPPORTED_MIME",415);
    const text=await readApi("https://www.googleapis.com/drive/v3/"+uri,{method:"GET",headers:{authorization:"Bearer "+token}},fetcher);
    return success({source:"google_drive",capability:"pantheon.drive.read",read_only:true,id:file.id,name:file.name,mimeType:file.mimeType,url:file.webViewLink||null,text:text.slice(0,30000),truncated:text.length>30000});
  }catch(e){return bad(e instanceof Error?e.message:"DRIVE_UNAVAILABLE",502);}
}
