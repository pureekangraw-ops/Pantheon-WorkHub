// Limited named Service Binding capability. Never exposes an HTTP ingress or owner token.
const fields=['goal','serviceLine','entryService','sourcePage','jobType','audience','materials','pageCount','package','desiredDate','deadlineText'];
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{status});};
const keys=(v,list)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>list.includes(k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9:_-]{1,160}$/.test(v)?v:fail('BRIEF_IDENTITY_REQUIRED');
const text=v=>String(v??'').slice(0,4000);
const canonical=v=>JSON.stringify(v);
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const limits={whisperPerConversation:3,takeoverPerConversation:3,dailyTotal:80,dailyTakeover:20};
function own(row,p,principal){
 if(row.principal_hash!==principal)fail('BRIEF_OWNER_MISMATCH',403);
 if(row.client_id!==p.clientId||row.conversation_id!==p.conversationId)fail('BRIEF_IDENTITY_CONFLICT',409);
}
async function brief(env,operation,p,principal){
 if(!keys(p,['version','briefId','clientId','conversationId','surface','status','stage','brief','handoff','latestInterpretation','updatedAt','confirmedAt']))fail('BRIEF_INPUT_FORBIDDEN');
 if(p.version!=='1'||p.surface!=='SPECTRUMSALE'||!keys(p.brief,fields))fail('BRIEF_INPUT_INVALID');
 for(const key of ['briefId','clientId','conversationId'])id(p[key]);
 const brief=Object.fromEntries(fields.map(k=>[k,text(p.brief[k])]));brief.sourcePage=brief.sourcePage.split(/[?#]/)[0];
 const contentHash=await digest(canonical(brief));const receivedAt=new Date().toISOString();
 const taskId='task_'+(await digest('storefront:'+p.briefId)).slice(0,32);
 const workId='WORK-SPECTRUM-'+p.briefId;
 const record={briefId:p.briefId,clientId:p.clientId,conversationId:p.conversationId,workId:operation==='confirm'?workId:null,
   brief,handoff:p.handoff??null,surface:'SPECTRUMSALE',status:operation==='confirm'?'CONFIRMED':'DRAFT',stage:text(p.stage),
   receivedAt,processing:'UNKNOWN',source:'CENTRE_SPECTRUM_INTAKE'};
 let confirmChanged=false;
 const db=env.DB;const previous=await stmt(db,'SELECT * FROM storefront_briefs WHERE brief_id=?',p.briefId).first();
 if(previous){own(previous,p,principal);if(previous.status==='CONFIRMED'){
   if(operation!=='confirm')fail('BRIEF_CONFIRMED',409);
   if(previous.content_sha256!==contentHash)fail('BRIEF_CONFIRM_CONFLICT',409);
 }}
 if(operation==='upsert'){
  await stmt(db,`INSERT INTO storefront_briefs(brief_id,principal_hash,client_id,conversation_id,status,content_sha256,record_json,task_id,received_at)
    VALUES(?,?,?,?,'DRAFT',?,?,NULL,?) ON CONFLICT(brief_id) DO UPDATE SET content_sha256=excluded.content_sha256,record_json=excluded.record_json,received_at=excluded.received_at
    WHERE storefront_briefs.status='DRAFT' AND storefront_briefs.principal_hash=excluded.principal_hash
    AND storefront_briefs.client_id=excluded.client_id AND storefront_briefs.conversation_id=excluded.conversation_id`,
    p.briefId,principal,p.clientId,p.conversationId,contentHash,canonical(record),receivedAt).run();
 }else{
  const request='Review confirmed customer brief: '+brief.goal.slice(0,1200);const requestHash=await digest(request);
  const guard="EXISTS (SELECT 1 FROM storefront_briefs WHERE brief_id=? AND principal_hash=? AND client_id=? AND conversation_id=? AND status='CONFIRMED' AND content_sha256=? AND task_id=?)";
  const guardArgs=[p.briefId,principal,p.clientId,p.conversationId,contentHash,taskId];
  const writes=await db.batch([
   stmt(db,`INSERT INTO storefront_briefs(brief_id,principal_hash,client_id,conversation_id,status,content_sha256,record_json,task_id,received_at)
    VALUES(?,?,?,?,'CONFIRMED',?,?,?,?) ON CONFLICT(brief_id) DO UPDATE SET status='CONFIRMED',content_sha256=excluded.content_sha256,
    record_json=excluded.record_json,task_id=excluded.task_id,received_at=excluded.received_at
    WHERE storefront_briefs.status='DRAFT' AND storefront_briefs.principal_hash=excluded.principal_hash
    AND storefront_briefs.client_id=excluded.client_id AND storefront_briefs.conversation_id=excluded.conversation_id`,
    p.briefId,principal,p.clientId,p.conversationId,contentHash,canonical(record),taskId,receivedAt),
   stmt(db,`INSERT INTO tasks(task_id,status,request_text,request_sha256,created_at,updated_at)
    SELECT ?,'QUEUED',?,?,?,? WHERE ${guard} ON CONFLICT(task_id) DO NOTHING`,taskId,request,requestHash,receivedAt,receivedAt,...guardArgs),
   stmt(db,`INSERT INTO actions(action_key,task_id,tool_name,input_sha256,status)
    SELECT ?,?,'storefront.owner_review',?,'PREPARED' WHERE ${guard} ON CONFLICT(action_key) DO NOTHING`,
    'storefront:'+p.briefId,taskId,contentHash,...guardArgs)
  ]);
  confirmChanged=Number(writes[0]?.meta?.changes)>0;
 }
 const saved=await stmt(db,'SELECT * FROM storefront_briefs WHERE brief_id=?',p.briefId).first();
 if(!saved)fail('BRIEF_READBACK_FAILED',502);own(saved,p,principal);
 if(saved.content_sha256!==contentHash)fail('BRIEF_CONFIRM_CONFLICT',409);
 if(operation==='upsert'&&saved.status!=='DRAFT')fail('BRIEF_CONFIRMED',409);
 const stored=JSON.parse(saved.record_json);
 if(operation==='upsert')return {ok:true,brief:stored,receipt:saved.received_at};
 const work=await stmt(db,'SELECT task_id,status,request_text,created_at,updated_at FROM tasks WHERE task_id=?',saved.task_id).first();
 const action=await stmt(db,'SELECT tool_name,input_sha256 FROM actions WHERE task_id=?',saved.task_id).first();
 if(!work||action?.tool_name!=='storefront.owner_review'||action.input_sha256!==contentHash)fail('BRIEF_WORK_READBACK_FAILED',502);
 return {ok:true,brief:stored,receipt:saved.received_at,workId,work:{...work,workId,ownerSource:'PANTHEON',requiresOwnerReview:true},
   workCreated:confirmChanged,workCreation:{ok:true,state:confirmChanged?'CREATED':'EXISTING'}};
}
async function salesEvent(db,p,principal){
 if(!keys(p,['eventId','type','page','source'])||!['PAGE_VIEW','SERVICE_INTEREST','BRIEF_STARTED','CTA_CLICK'].includes(p.type))fail('SALES_EVENT_INVALID');
 const eventId=id(p.eventId);const record={eventId,type:p.type,page:text(p.page).split(/[?#]/)[0],source:text(p.source),receivedAt:new Date().toISOString()};
 const insert=await stmt(db,'INSERT INTO storefront_events(event_id,principal_hash,record_json) VALUES(?,?,?) ON CONFLICT(event_id) DO NOTHING',eventId,principal,canonical(record)).run();
 const saved=await stmt(db,'SELECT * FROM storefront_events WHERE event_id=?',eventId).first();
 if(!saved||saved.principal_hash!==principal)fail('SALES_EVENT_CONFLICT',409);
 return {ok:true,event:JSON.parse(saved.record_json),duplicate:insert.meta.changes===0};
}
async function budget(db,p,principal){
 if(!keys(p,['clientId','conversationId','requestId','kind'])||!['WHISPER','TAKEOVER'].includes(p.kind))fail('GO_BUDGET_KIND_DENIED');
 for(const key of ['clientId','conversationId','requestId'])id(p[key]);
 const day=new Date(Date.now()+7*60*60*1000).toISOString().slice(0,10);
 const count=(condition)=>`(SELECT COUNT(*) FROM storefront_budget WHERE day=? AND allowed=1 ${condition})`;
 const sql=`WITH counts AS (SELECT ${count('')} total,${count("AND kind='TAKEOVER'")} takeover,
   ${count("AND principal_hash=? AND conversation_id=? AND kind='WHISPER'")} cw,${count("AND principal_hash=? AND conversation_id=? AND kind='TAKEOVER'")} ct)
   INSERT INTO storefront_budget(request_id,principal_hash,client_id,conversation_id,kind,day,allowed,reason)
   SELECT ?,?,?,?,?,?,CASE WHEN total>=80 OR (?='TAKEOVER' AND takeover>=20) OR (?='WHISPER' AND cw>=3) OR (?='TAKEOVER' AND ct>=3) THEN 0 ELSE 1 END,
    CASE WHEN total>=80 THEN 'GO_DAILY_TOTAL_LIMIT' WHEN ?='TAKEOVER' AND takeover>=20 THEN 'GO_DAILY_TAKEOVER_LIMIT'
     WHEN ?='WHISPER' AND cw>=3 THEN 'GO_CONVERSATION_WHISPER_LIMIT' WHEN ?='TAKEOVER' AND ct>=3 THEN 'GO_CONVERSATION_TAKEOVER_LIMIT' ELSE NULL END
   FROM counts WHERE true ON CONFLICT(request_id) DO NOTHING`;
 const result=await db.batch([
  stmt(db,sql,day,day,day,principal,p.conversationId,day,principal,p.conversationId,p.requestId,principal,p.clientId,p.conversationId,p.kind,day,...Array(6).fill(p.kind)),
  stmt(db,`UPDATE storefront_budget SET budget_json=json_object('day',day,'conversation',json_object(
    'whisper',(SELECT COUNT(*) FROM storefront_budget b WHERE b.day=storefront_budget.day AND b.principal_hash=storefront_budget.principal_hash AND b.conversation_id=storefront_budget.conversation_id AND b.kind='WHISPER' AND b.allowed=1),
    'takeover',(SELECT COUNT(*) FROM storefront_budget b WHERE b.day=storefront_budget.day AND b.principal_hash=storefront_budget.principal_hash AND b.conversation_id=storefront_budget.conversation_id AND b.kind='TAKEOVER' AND b.allowed=1),
    'total',(SELECT COUNT(*) FROM storefront_budget b WHERE b.day=storefront_budget.day AND b.principal_hash=storefront_budget.principal_hash AND b.conversation_id=storefront_budget.conversation_id AND b.allowed=1)),
    'global',json_object('whisper',(SELECT COUNT(*) FROM storefront_budget b WHERE b.day=storefront_budget.day AND b.kind='WHISPER' AND b.allowed=1),
    'takeover',(SELECT COUNT(*) FROM storefront_budget b WHERE b.day=storefront_budget.day AND b.kind='TAKEOVER' AND b.allowed=1),
    'total',(SELECT COUNT(*) FROM storefront_budget b WHERE b.day=storefront_budget.day AND b.allowed=1)))
    WHERE request_id=? AND principal_hash=? AND budget_json IS NULL`,p.requestId,principal)
 ]);
 const saved=await stmt(db,'SELECT * FROM storefront_budget WHERE request_id=?',p.requestId).first();
 if(!saved||saved.principal_hash!==principal||saved.client_id!==p.clientId||saved.conversation_id!==p.conversationId||saved.kind!==p.kind)fail('GO_BUDGET_REQUEST_CONFLICT',409);
 return {ok:true,allowed:Boolean(saved.allowed),duplicate:result[0].meta.changes===0,reason:saved.reason,budget:{...JSON.parse(saved.budget_json),limits}};
}
export async function storefrontCall(env,a){
 try{
  if(env.STOREFRONT_INGRESS_ENABLED!=='true')fail('STOREFRONT_INGRESS_DISABLED',503);
  if(!keys(a,['operation','payload','principal'])||typeof a.principal!=='string'||!/^([a-f0-9]{64})$/.test(a.principal))fail('STOREFRONT_AUTH_REQUIRED',403);
  if(!env.DB)fail('STOREFRONT_STORE_NOT_CONFIGURED',503);
  if(new TextEncoder().encode(canonical(a)).length>65536)fail('PAYLOAD_TOO_LARGE',413);
  let body;
  if(a.operation==='brief_upsert'||a.operation==='brief_confirm')body=await brief(env,a.operation==='brief_confirm'?'confirm':'upsert',a.payload,a.principal);
  else if(a.operation==='sales_event')body=await salesEvent(env.DB,a.payload,a.principal);
  else if(a.operation==='go_budget')body=await budget(env.DB,a.payload,a.principal);
  else fail('STOREFRONT_OPERATION_DENIED',403);
  return {ok:true,status:200,body};
 }catch(e){return {ok:false,status:e.status||503,body:{ok:false,code:e.status?e.message:'STOREFRONT_STORE_UNAVAILABLE'}};}
}
