// Internal capability: callable only through a named Cloudflare Service Binding.
// The owner bearer remains exclusively in PANTHEON; public HTTP authorization is unchanged.
const fail=(status,upstream_status=400)=>({ok:false,status,upstream_status});
const task=v=>typeof v==='string'&&/^task_[a-f0-9]{32}$/.test(v);
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
export async function ownerBridgeCall(env,workhub,a){
 if(!keys(a,['operation','payload','request','task_id','approved','view']))return fail('INVALID_BRIDGE_REQUEST');
 let path,method='POST',payload;
 switch(a.operation){
 case 'intent':
  if(!keys(a,['operation','payload'])||!keys(a.payload,['intent','request','task_id']))return fail('INVALID_INTENT');
  payload=a.payload;path='/v1/intent';
  if(payload.intent==='LIST_TASKS'){if(Object.keys(payload).length!==1)return fail('INVALID_INTENT');}
  else if(payload.intent==='SHOW_TASK'){if(!task(payload.task_id)||Object.keys(payload).length!==2)return fail('INVALID_TASK_ID');}
  else if(payload.intent==='CREATE_TASK'){if(typeof payload.request!=='string'||!payload.request.trim()||payload.request.length>4000||Object.keys(payload).length!==2)return fail('INVALID_REQUEST');}
  else return fail('UNSUPPORTED_INTENT');
  break;
 case 'queue_factory':
  if(!keys(a,['operation','request'])||typeof a.request!=='string'||!a.request.trim()||a.request.length>4000)return fail('INVALID_REQUEST');
  path='/v1/factory/jobs';payload={request:a.request};break;
 case 'observatory_latest':
  if(!keys(a,['operation','view'])||Object.keys(a).length!==2||!['browser','map'].includes(a.view))return fail('INVALID_VIEW');
  path='/v1/observatory/latest?view='+encodeURIComponent(a.view);method='GET';break;
 case 'factory_health':
  if(Object.keys(a).length!==1)return fail('INVALID_BRIDGE_REQUEST');
  path='/v1/factory/health';method='GET';break;
 case 'factory_job':
  if(!keys(a,['operation','task_id'])||!task(a.task_id))return fail('INVALID_TASK_ID');
  path='/v1/factory/jobs/'+a.task_id;method='GET';break;
 case 'dispatch_factory':
 case 'reconcile_factory':
  if(!keys(a,['operation','task_id','approved'])||!task(a.task_id))return fail('INVALID_TASK_ID');
  if(a.approved!==true)return fail('OWNER_APPROVAL_REQUIRED',403);
  path='/v1/factory/jobs/'+a.task_id+'/'+(a.operation==='dispatch_factory'?'dispatch':'reconcile');break;
 default:return fail('UNSUPPORTED_OPERATION');
 }
 if(typeof env.WORKHUB_TOKEN!=='string'||env.WORKHUB_TOKEN.length<32)return fail('UPSTREAM_AUTH_NOT_CONFIGURED',503);
 try{
  const r=await workhub.fetch(new Request('https://phatheon-workhub.internal'+path,{method,headers:{authorization:'Bearer '+env.WORKHUB_TOKEN,'content-type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})}),env);
  const data=await r.json();
  if(!data||typeof data!=='object'||Array.isArray(data))return fail('INVALID_UPSTREAM_RESPONSE',r.status);
  return {ok:r.ok,upstream_status:r.status,result:data};
 }catch{return fail('UPSTREAM_UNAVAILABLE',502);}
}
