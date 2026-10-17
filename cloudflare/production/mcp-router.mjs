import workhub from './worker.js';
import {ownerBridgeCall} from './owner-bridge.mjs';
import {createOAuthHandler,verifyAccessToken} from './mcp-oauth.mjs';
import {pantheonOAuthConfig} from './oauth-ledger.mjs';
const ROOT='https://phatheon-workhub.pureekangraw.workers.dev';
const versions=['2025-06-18','2025-03-26','2024-11-05'];
const schema=properties=>({type:'object',properties,additionalProperties:false});
const task={type:'string',pattern:'^task_[a-f0-9]{32}$'};
const tools=[
 {name:'pantheon_health',description:'Read PANTHEON health; no execution.',inputSchema:schema({}),annotations:{readOnlyHint:true}},
 {name:'pantheon_tasks',description:'List tasks or read an exact task.',inputSchema:schema({task_id:task}),annotations:{readOnlyHint:true}},
 {name:'pantheon_command',description:'Create or queue a task. Dispatch/reconcile requires explicit BIG authorization and approved:true.',inputSchema:schema({operation:{type:'string',enum:['create_task','queue_factory','dispatch_factory','reconcile_factory']},request:{type:'string',minLength:1,maxLength:4000},task_id:task,approved:{type:'boolean'}}),annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false}},
 {name:'pantheon_factory',description:'Read Factory health or exact job/receipt evidence.',inputSchema:schema({task_id:task}),annotations:{readOnlyHint:true}},
];
const json=(v,status=200,headers={})=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const result=(value,isError=false)=>({content:[{type:'text',text:JSON.stringify(value)}],...(isError?{isError:true}:{})});
function validate(name,a){
 const t=tools.find(t=>t.name===name);if(!t||!object(a))return false;
 const p=t.inputSchema.properties;if(Object.keys(a).some(k=>!Object.hasOwn(p,k)))return false;
 for(const[k,v]of Object.entries(a)){const s=p[k];if(typeof v!==s.type)return false;if(s.enum&&!s.enum.includes(v))return false;if(s.pattern&&!new RegExp(s.pattern).test(v))return false;if(s.maxLength&&(v.length>s.maxLength||!v.trim()))return false;}
 if(name==='pantheon_command'){
  const op=a.operation||'create_task';
  if(['create_task','queue_factory'].includes(op))return typeof a.request==='string'&&!Object.hasOwn(a,'task_id')&&!Object.hasOwn(a,'approved');
  return typeof a.task_id==='string'&&a.approved===true&&!Object.hasOwn(a,'request');
 }
 return true;
}
async function invoke(name,a,env){
 if(!validate(name,a))return result({error:'INVALID_TOOL_ARGUMENTS'},true);
 if(name==='pantheon_health'){
  const r=await workhub.fetch(new Request(ROOT+'/health'),env);return result(await r.json(),!r.ok);
 }
 let args;
 if(name==='pantheon_tasks')args={operation:'intent',payload:a.task_id?{intent:'SHOW_TASK',task_id:a.task_id}:{intent:'LIST_TASKS'}};
 else if(name==='pantheon_factory')args=a.task_id?{operation:'factory_job',task_id:a.task_id}:{operation:'factory_health'};
 else if((a.operation||'create_task')==='create_task')args={operation:'intent',payload:{intent:'CREATE_TASK',request:a.request}};
 else args={...a};
 const r=await ownerBridgeCall(env,workhub,args);return result(r.result||{error:r.status},!r.ok);
}
export async function handleMcp(request,env,ctx){
 const path=new URL(request.url).pathname;
 if(path.startsWith('/oauth/')||path.startsWith('/.well-known/')){
  if(request.method==='POST'){
   if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('content-type')||''))return json({error:'unsupported form content type'},415);
   const reader=request.body?.getReader();if(!reader)return json({error:'empty form'},400);
   let size=0,chunks=[];try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();return json({error:'form too large'},413);}chunks.push(value);}}catch{return json({error:'invalid form'},400);}
   const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
   request=new Request(request.url,{method:request.method,headers:request.headers,body:bytes});
  }
  return createOAuthHandler(pantheonOAuthConfig(env))(request);
 }
 if(path!=='/mcp')return null;
 let identity;try{identity=await verifyAccessToken(request,pantheonOAuthConfig(env));if(identity.scope!=='pantheon-owner'||identity.owner!=='BIG')throw new Error('invalid owner');}
 catch{return json({error:'unauthorized'},401,{'www-authenticate':`Bearer resource_metadata="${ROOT}/.well-known/oauth-protected-resource/mcp"`});}
 if(request.method!=='POST')return json({error:'method not allowed'},405,{allow:'POST'});
 const version=request.headers.get('mcp-protocol-version');if(version&&!versions.includes(version))return json({error:'unsupported protocol version'},400);
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return json({error:'content type must be application/json'},415);
 let body;try{const reader=request.body?.getReader();if(!reader)return json({error:'empty body'},400);let size=0,chunks=[];while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return json({error:'request too large'},413);}chunks.push(value);}const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}body=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'invalid JSON'},400);}
 if(!object(body)||body.jsonrpc!=='2.0'||typeof body.method!=='string'||(body.params!==undefined&&!object(body.params))||(body.id!==undefined&&typeof body.id!=='string'&&typeof body.id!=='number'&&body.id!==null))return json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}},400);
 if(body.id===undefined){if(body.method==='notifications/initialized'||body.method==='notifications/cancelled')return new Response(null,{status:202});return json({error:'request id required'},400);}
 const reply=v=>json({jsonrpc:'2.0',id:body.id,...v});
 const p=body.params||{};
 if(body.method==='initialize')return reply({result:{protocolVersion:versions.includes(p.protocolVersion)?p.protocolVersion:versions[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'PANTHEON',version:'1.0.0'},instructions:'Act on behalf of BIG. Queuing does not execute; dispatch requires explicit human authorization.'}});
 if(body.method==='ping')return reply({result:{}});
 if(body.method==='tools/list')return reply({result:{tools}});
 if(body.method==='tools/call'){
  if(typeof p.name!=='string'||!tools.some(t=>t.name===p.name))return reply({error:{code:-32602,message:'Unknown tool'}});
  try{return reply({result:await invoke(p.name,p.arguments===undefined?{}:p.arguments,env)});}catch{return reply({result:result({error:'PANTHEON_UNAVAILABLE'},true)});}
 }
 return reply({error:{code:-32601,message:'Method not found'}});
}
