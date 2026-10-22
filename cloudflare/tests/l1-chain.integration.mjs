// Local in-memory cross-repository acceptance checks. Never contacts live services.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const goRoot=pathToFileURL((process.env.GO_CHECKOUT||'/workspace/Go-Together')+'/');
const factoryRoot=pathToFileURL((process.env.FACTORY_CHECKOUT||'/workspace/factory-l1-chain')+'/');
const {default:go}=await import(new URL('worker/index.js',goRoot));
import workhub from '../production/worker.js';
import {ownerBridgeCall} from '../production/owner-bridge.mjs';
const {createFactoryWorker}=await import(new URL('src/worker.mjs',factoryRoot));
const {createDurableStore}=await import(new URL('src/durable-store.mjs',factoryRoot));
const {createInMemoryDurableDriver}=await import(new URL('test/support/in-memory-durable-driver.mjs',factoryRoot));
const fixture=JSON.parse(readFileSync(new URL('./fixtures/l1-task-local.json',import.meta.url)));
const task_id=fixture.task_id, hash=fixture.recorded_request_sha256;
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../production/test-schema.sql',import.meta.url),'utf8'));
 let tail=Promise.resolve();const DB={prepare(q){const s=sql.prepare(q);let p=[];return {bind(...v){p=v;return this;},async first(){return s.get(...p)||null;},async all(){return {results:s.all(...p)};},async run(){return {meta:{changes:Number(s.run(...p).changes)}};}};},batch(ss){const run=async()=>{sql.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.all());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}};const r=tail.then(run);tail=r.catch(()=>{});return r;}};
 sql.prepare("INSERT INTO tasks(task_id,status,request_text,request_sha256,created_at,updated_at) VALUES(?,'QUEUED',?,?,'fixture','fixture')").run(task_id,fixture.recorded_request_text,hash);
 sql.prepare("INSERT INTO actions(action_key,task_id,tool_name,input_sha256,status) VALUES('act_fixture',?,'d1.create_text_artifact',?,'PREPARED')").run(task_id,hash);
 return {sql,DB};
}
const snapshot=sql=>JSON.stringify(['tasks','actions','factory_jobs','runs','events','artifacts'].map(t=>sql.prepare('SELECT * FROM '+t).all()));

function chain(){
 const {sql,DB}=setup();let effects=0,calls=[];let loseReceive=false,breakRead=false,failBefore=false;
 const secret='synthetic-pantheon-secret-'.repeat(2),driver=createInMemoryDurableDriver(),put=driver.put;
 driver.put=async(...a)=>{const r=await put(...a);effects++;return r;};
 const factory=createFactoryWorker({SOURCE_SHA:'9a56fded285641a37fdf9a92c388f546ccb9d47f',PANTHEON_FACTORY_RAIL_SECRET:secret},{recordStore:createDurableStore({driver}),domainRunners:{LOGIC:()=>{throw Error('trainee forbidden');},CODE:()=>{throw Error('CODE forbidden');}}});
 const hubEnv={DB,WORKHUB_TOKEN:'synthetic-owner-secret-'.repeat(2),FACTORY_PANTHEON_SECRET:secret,FACTORY:{async fetch(req){const path=new URL(req.url).pathname;calls.push(path);if(failBefore&&path==='/station/receive'){failBefore=false;throw Error('failure before receive');}if(breakRead&&path.includes('/readback/'))throw Error('synthetic read failure');const r=await factory.fetch(req);if(loseReceive&&path==='/station/receive'){loseReceive=false;throw Error('lost receive response after effect');}return r;}}};
 const env={ACCESS_AUD:'fixture-aud',OWNER_EMAIL:'fixture@example.com',DB,PANTHEON_OWNER:{ownerCall:a=>ownerBridgeCall(hubEnv,workhub,a)}};
 const ctx={access:{aud:'fixture-aud',getIdentity:async()=>({email:'fixture@example.com'})}};
 async function call(name,args){const r=await go.fetch(new Request('https://go.local/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),env,ctx);return JSON.parse((await r.json()).result.content[0].text);}
 return {sql,DB,hubEnv,driver,call,calls,get effects(){return effects;},failBefore(){failBefore=true;},loseReceive(){loseReceive=true;},breakRead(v){breakRead=v;},queue:()=>call('pantheon_command',{operation:'queue_factory',task_id}),dispatch:()=>call('pantheon_command',{operation:'dispatch_factory',task_id,approved:true}),reconcile:()=>call('pantheon_command',{operation:'reconcile_factory',task_id,approved:true}),read:()=>call('pantheon_factory',{task_id})};
}
test('LOCAL COMPLETE CHAIN: GO queues existing task, Factory writes one artifact+receipt, GO verifies fresh owner bytes',async()=>{
 const c=chain();const original=c.sql.prepare('SELECT request_text,request_sha256 FROM tasks').get();
 for(const r of await Promise.all(Array.from({length:8},()=>c.queue())))assert.equal(r.ok,true);
 assert.equal(c.effects,0);assert.equal(c.calls.length,0);
 const out=await Promise.all(Array.from({length:8},()=>c.dispatch()));assert.ok(out.some(r=>r.ok));
 assert.equal(c.effects,1);assert.equal(c.calls.filter(p=>p==='/station/receive').length,1);
 const read=await c.read();assert.equal(read.ok,true,JSON.stringify(read));assert.equal(read.result.job.owner_verified,true);
 const back=read.result.job.result;assert.match(back.result.content,/^YGG FACTORY L1 PASS\n/);assert.equal(back.workId,task_id);assert.equal(back.result.requestSha256,hash);
 assert.equal(back.result.contentSha256,Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(back.result.content))).toString('hex'));
 assert.equal(c.sql.prepare('SELECT count(*) n FROM tasks').get().n,1);assert.equal(c.sql.prepare('SELECT count(*) n FROM actions').get().n,1);assert.equal(c.sql.prepare('SELECT count(*) n FROM runs').get().n,1);
 assert.deepEqual(c.sql.prepare('SELECT request_text,request_sha256 FROM tasks').get(),original);
 const again=await c.dispatch();assert.equal(again.result.already_completed,true);assert.equal(c.effects,1);c.sql.close();
});
test('LOCAL CHAIN: lost receive response reconciles without another write/receive',async()=>{
 const c=chain();await c.queue();c.loseReceive();const r=await c.dispatch();assert.equal(r.ok,false);assert.equal(c.effects,1);
 assert.equal(c.sql.prepare('SELECT status FROM tasks').get().status,'NEEDS_RECONCILIATION');
 const recovered=await c.reconcile();assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal(c.effects,1);assert.equal(c.calls.filter(p=>p==='/station/receive').length,1);
 assert.equal((await c.read()).result.job.owner_verified,true);c.sql.close();
});
test('LOCAL CHAIN: authenticated owner readback fails closed if fresh Factory evidence unavailable',async()=>{
 const c=chain();await c.queue();await c.dispatch();c.breakRead(true);const r=await c.read();assert.equal(r.ok,false);assert.equal(c.effects,1);c.sql.close();
});
test('LOCAL CHAIN: generic local executor cannot race or replace exact Factory operation',async()=>{
 const c=chain();const local=()=>workhub.fetch(new Request('https://hub.local/v1/tasks/'+task_id+'/run',{method:'POST',headers:{authorization:'Bearer '+c.hubEnv.WORKHUB_TOKEN}}),c.hubEnv);
 assert.equal((await local()).status,409);await c.queue();const [r,dispatch]=await Promise.all([local(),c.dispatch()]);assert.equal(r.status,409);assert.equal(dispatch.ok,true);assert.equal(c.effects,1);assert.equal(c.sql.prepare('SELECT count(*) n FROM artifacts').get().n,0);c.sql.close();
});

test('LOCAL CHAIN: no-effect failure resumes only on explicit approved dispatch without resetting identity',async()=>{
 const c=chain();await c.queue();c.failBefore();assert.equal((await c.dispatch()).ok,false);assert.equal(c.effects,0);
 assert.equal((await c.reconcile()).ok,false);assert.equal(c.effects,0);
 const run=c.sql.prepare('SELECT latest_run_id FROM tasks').get().latest_run_id;
 const resumed=await c.dispatch();assert.equal(resumed.ok,true,JSON.stringify(resumed));assert.equal(c.effects,1);
 assert.equal(c.sql.prepare('SELECT latest_run_id FROM tasks').get().latest_run_id,run);assert.equal(c.sql.prepare('SELECT count(*) n FROM runs').get().n,1);c.sql.close();
});
test('LOCAL CHAIN: completed replay rejects corrupted local receipt/hash/action evidence',async()=>{
 for(const mutation of ["UPDATE factory_jobs SET receipt_id='receipt-corrupt'","UPDATE factory_jobs SET result_sha256='bad'","UPDATE actions SET receipt_sha256='bad'","UPDATE runs SET status='RUNNING'"]){
  const c=chain();await c.queue();await c.dispatch();c.sql.exec(mutation);
  assert.equal((await c.dispatch()).ok,false,mutation);assert.equal((await c.read()).ok,false,mutation);assert.equal(c.effects,1);c.sql.close();
 }
});
