import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import workhub from '../production/worker.js';
import {ownerBridgeCall} from '../production/owner-bridge.mjs';
import {ensureObservatorySchema} from '../production/observatory-schema.mjs';
import {putSnapshot} from '../production/observatory-stream.mjs';

const deviceA='obs_'+'a'.repeat(32),deviceB='obs_'+'b'.repeat(32);
async function observationSetup(){
 const s=setup();await ensureObservatorySchema(s.env.DB);
 for(const id of [deviceA,deviceB])s.sql.prepare('INSERT INTO obs_devices(device_id,token_hash,created_ms) VALUES(?,?,?)').run(id,id,Date.now());
 return s;
}
async function sendObservation(env,device,captureId,sequence,at=Date.now(),view='browser'){
 await putSnapshot(env.DB,device,{view,snapshot:{captureId,epoch:1,sequence,capturedAtEpochMs:at,title:'Checkout',text:'Payment pending',targets:[{text:'Continue'}]}},at);
}
test('GO owner bridge reads the latest manually supplied round with time and page state',async()=>{
 const {env,sql}=await observationSetup();
 await sendObservation(env,deviceA,'round_old',1,Date.now()-4000);
 await sendObservation(env,deviceA,'round_new',2);
 const r=await ownerBridgeCall(env,workhub,{operation:'observatory_latest',view:'browser'});
 assert.equal(r.ok,true);assert.equal(r.result.status,'SNAPSHOT_AVAILABLE');
 assert.equal(r.result.snapshot.captureId,'round_new');assert.equal(r.result.snapshot.sequence,2);
 assert.equal(r.result.snapshot.payload.text,'Payment pending');
 assert.equal(r.result.snapshot.deviceId,deviceA);assert.ok(r.result.snapshot.expiresAtEpochMs>Date.now());
 assert.equal(r.result.read_only,true);assert.equal(r.result.content_trust,'untrusted_page_data');
 assert.equal(sql.prepare('SELECT count(*) n FROM tasks').get().n,0);sql.close();
});
test('round read never silently substitutes another capture or device',async()=>{
 const {env,sql}=await observationSetup();await sendObservation(env,deviceA,'round_one',1);
 await sendObservation(env,deviceB,'round_two',1);
 const ambiguous=await ownerBridgeCall(env,workhub,{operation:'observatory_latest',view:'browser'});
 assert.equal(ambiguous.result.status,'DEVICE_SELECTION_REQUIRED');assert.equal(ambiguous.result.snapshot,undefined);
 const exact=await ownerBridgeCall(env,workhub,{operation:'observatory_latest',view:'browser',device_id:deviceA,capture_id:'round_one'});
 assert.equal(exact.result.snapshot.captureId,'round_one');
 const missing=await ownerBridgeCall(env,workhub,{operation:'observatory_latest',view:'browser',device_id:deviceA,capture_id:'round_two'});
 assert.equal(missing.result.status,'NO_FRESH_SNAPSHOT');sql.close();
});
test('expired or revoked observations are never returned as current state',async()=>{
 const {env,sql}=await observationSetup();await sendObservation(env,deviceA,'round_old',1,Date.now()-10000);
 sql.prepare('UPDATE obs_snapshots SET expires_ms=?').run(Date.now()-1);
 let r=await ownerBridgeCall(env,workhub,{operation:'observatory_latest',view:'browser'});
 assert.equal(r.result.status,'NO_FRESH_SNAPSHOT');
 await sendObservation(env,deviceB,'round_new',1);sql.prepare('UPDATE obs_devices SET revoked_ms=? WHERE device_id=?').run(Date.now(),deviceB);
 r=await ownerBridgeCall(env,workhub,{operation:'observatory_latest',view:'browser'});
 assert.equal(r.result.status,'NO_FRESH_SNAPSHOT');sql.close();
});
test('round bridge rejects injected parameters and public anonymous reads',async()=>{
 const {env,sql}=await observationSetup();
 for(const args of [{view:'cookies'},{view:'browser',device_id:'../secret'},{view:'browser',capture_id:'bad&x=1'},{view:'browser',url:'https://bad'}]){
 const r=await ownerBridgeCall(env,workhub,{operation:'observatory_latest',...args});assert.equal(r.ok,false);
 }
 const response=await workhub.fetch(new Request('https://pantheon/v1/observatory/latest?view=browser&round=1'),env);
 assert.equal(response.status,401);sql.close();
});
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../production/test-schema.sql',import.meta.url),'utf8'));
 let tail=Promise.resolve();
 const DB={prepare(query){const s=sql.prepare(query);let a=[];return {bind(...v){a=v;return this;},async first(){return s.get(...a)||null;},async all(){return {results:s.all(...a)};},async run(){return {meta:{changes:Number(s.run(...a).changes)}};}};},batch(statements){const run=async()=>{sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.all());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}};const result=tail.then(run);tail=result.catch(()=>{});return result;}};
 return {sql,env:{DB,WORKHUB_TOKEN:'test-only-owner-token-'.repeat(2)}};
}
test('internal bridge queues then reads real task without caller token',async()=>{
 const {env,sql}=setup();
 const create=await ownerBridgeCall(env,workhub,{operation:'intent',payload:{intent:'CREATE_TASK',request:'integration'}});
 assert.equal(create.ok,true);assert.equal(create.result.executed,false);
 const task_id=create.result.task_id;assert.match(task_id,/^task_[a-f0-9]{32}$/);
 const read=await ownerBridgeCall(env,workhub,{operation:'intent',payload:{intent:'SHOW_TASK',task_id}});
 assert.equal(read.result.task.request_text,'integration');
 const list=await ownerBridgeCall(env,workhub,{operation:'intent',payload:{intent:'LIST_TASKS'}});
 assert.equal(list.result.tasks[0].task_id,task_id);sql.close();
});
test('internal bridge queues Factory job without dispatch',async()=>{
 const {env,sql}=setup();
 const r=await ownerBridgeCall(env,workhub,{operation:'queue_factory',request:'GO integration'});
 assert.equal(r.ok,true);assert.equal(r.result.executed,false);
 const read=await ownerBridgeCall(env,workhub,{operation:'factory_job',task_id:r.result.task_id});
 assert.equal(read.result.job.status,'QUEUED');assert.equal(read.result.job.receipt_id,null);sql.close();
});
test('internal bridge requires explicit approval before Factory dispatch',async()=>{
 const {env,sql}=setup();const r=await ownerBridgeCall(env,workhub,{operation:'dispatch_factory',task_id:'task_'+'a'.repeat(32)});
 assert.equal(r.ok,false);assert.equal(r.status,'OWNER_APPROVAL_REQUIRED');
 assert.equal(sql.prepare('SELECT count(*) n FROM tasks').get().n,0);sql.close();
});
test('internal bridge denies arbitrary routes, tokens and operations',async()=>{
 const {env,sql}=setup();
 for(const req of [{operation:'fetch',url:'https://bad'},{operation:'intent',payload:{intent:'LIST_TASKS'},token:'bad'},{operation:'intent',payload:{intent:'RUN_TASK'}}]){
 const r=await ownerBridgeCall(env,workhub,req);assert.equal(r.ok,false);
 }sql.close();
});
test('public HTTP still denies anonymous intent after adding internal bridge',async()=>{
 const {env,sql}=setup();
 const r=await workhub.fetch(new Request('https://pantheon/v1/intent',{method:'POST',body:JSON.stringify({intent:'LIST_TASKS'})}),env);
 assert.equal(r.status,401);sql.close();
});
test('receiver without owner secret fails closed',async()=>{
 const r=await ownerBridgeCall({},workhub,{operation:'intent',payload:{intent:'LIST_TASKS'}});
 assert.equal(r.ok,false);assert.equal(r.status,'UPSTREAM_AUTH_NOT_CONFIGURED');
});

const queueExisting=(env,task_id)=>ownerBridgeCall(env,workhub,{operation:'queue_factory',task_id});
const snapshot=sql=>JSON.stringify(['tasks','actions','factory_jobs','events','runs','artifacts'].map(t=>sql.prepare('SELECT * FROM '+t).all()));
async function factoryFixture(){
 const s=setup();s.calls=0;s.env.FACTORY={fetch(){s.calls++;throw Error('queue must never call Factory');}};
 const r=await ownerBridgeCall(s.env,workhub,{operation:'queue_factory',request:'synthetic LOGIC training'});
 s.task_id=r.result.task_id;return s;
}
test('existing Factory task queue is idempotent without changing checkpoints or dispatching',async()=>{
 const s=await factoryFixture();const before=snapshot(s.sql);
 const results=await Promise.all(Array.from({length:8},()=>queueExisting(s.env,s.task_id)));
 for(const r of results){assert.equal(r.ok,true);assert.equal(r.result.task_id,s.task_id);assert.equal(r.result.executed,false);assert.equal(r.result.already_queued,true);}
 assert.equal(snapshot(s.sql),before);assert.equal(s.calls,0);s.sql.close();
});
test('eligible prepared action can atomically acquire exactly one queue record',async()=>{
 const s=await factoryFixture();s.sql.prepare('DELETE FROM factory_jobs').run();s.sql.prepare('DELETE FROM events').run();
 const task=s.sql.prepare('SELECT * FROM tasks').get(),action=s.sql.prepare('SELECT * FROM actions').get();
 const results=await Promise.all(Array.from({length:8},()=>queueExisting(s.env,s.task_id)));
 for(const r of results)assert.equal(r.ok,true);
 assert.equal(results.filter(r=>!r.result.already_queued).length,1);
 assert.equal(s.sql.prepare('SELECT count(*) n FROM factory_jobs').get().n,1);
 assert.equal(s.sql.prepare('SELECT count(*) n FROM events').get().n,1);
 assert.deepEqual(s.sql.prepare('SELECT * FROM tasks').get(),task);assert.deepEqual(s.sql.prepare('SELECT * FROM actions').get(),action);
 assert.equal(s.calls,0);s.sql.close();
});
test('ordinary text-artifact task is UNSUPPORTED without substitution or duplicate',async()=>{
 const s=setup();const c=await ownerBridgeCall(s.env,workhub,{operation:'intent',payload:{intent:'CREATE_TASK',request:'synthetic YGG FACTORY L1 PASS text artifact; no trainee placement'}});
 const before=snapshot(s.sql);
 const results=await Promise.all(Array.from({length:8},()=>queueExisting(s.env,c.result.task_id)));
 for(const r of results){assert.equal(r.ok,false);assert.equal(r.upstream_status,422);assert.match(r.result.error,/UNSUPPORTED/);}
 assert.equal(snapshot(s.sql),before);s.sql.close();
});
test('queue rejects ambiguous, unknown, unauthorized and malformed calls without mutation',async()=>{
 const s=await factoryFixture();const before=snapshot(s.sql);
 for(const args of [{task_id:s.task_id,request:'ambiguous'},{task_id:'invalid'},{}]){
  const r=await ownerBridgeCall(s.env,workhub,{operation:'queue_factory',...args});assert.equal(r.ok,false);
 }
 assert.equal((await queueExisting(s.env,'task_'+'0'.repeat(32))).upstream_status,404);
 for(const body of [{task_id:s.task_id,request:'ambiguous'},{task_id:'invalid'},{}]){
  const r=await workhub.fetch(new Request('https://test/v1/factory/jobs',{method:'POST',headers:{authorization:'Bearer '+s.env.WORKHUB_TOKEN},body:JSON.stringify(body)}),s.env);assert.equal(r.status,400);
 }
 const denied=await workhub.fetch(new Request('https://test/v1/factory/jobs',{method:'POST',body:JSON.stringify({task_id:s.task_id})}),s.env);assert.equal(denied.status,401);
 assert.equal(snapshot(s.sql),before);assert.equal(s.calls,0);s.sql.close();
});
test('queue never resets dispatched, completed, uncertain or inconsistent state',async()=>{
 for(const mutation of [
  "UPDATE factory_jobs SET status='DISPATCHING'", "UPDATE factory_jobs SET status='COMPLETED'", "UPDATE factory_jobs SET status='NEEDS_RECONCILIATION'",
  "UPDATE tasks SET status='RUNNING'", "UPDATE tasks SET status='COMPLETED'", "UPDATE tasks SET status='FAILED'", "UPDATE tasks SET status='NEEDS_RECONCILIATION'",
  "UPDATE tasks SET latest_run_id='run_prior'", "UPDATE actions SET status='REQUESTED'", "UPDATE actions SET receipt_sha256='prior'",
  "UPDATE actions SET input_sha256='mismatch'", "UPDATE tasks SET request_text='tampered'", "UPDATE factory_jobs SET receipt_id='receipt-prior'",
  "INSERT INTO runs(run_id,task_id,status,started_at) SELECT 'run_prior',task_id,'NO_EFFECT',created_at FROM tasks",
  "INSERT INTO artifacts SELECT action_key,task_id,'prior','prior','now' FROM actions"
 ]){
  const s=await factoryFixture();s.sql.exec(mutation);const before=snapshot(s.sql);
  const r=await queueExisting(s.env,s.task_id);assert.equal(r.ok,false,mutation);assert.equal(r.upstream_status,409,mutation);
  assert.equal(snapshot(s.sql),before);assert.equal(s.calls,0);s.sql.close();
 }
});
test('failed queue audit rolls back insertion atomically',async()=>{
 const s=await factoryFixture();s.sql.exec("DELETE FROM factory_jobs; DELETE FROM events; CREATE TRIGGER fail_audit BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;");
 const before=snapshot(s.sql),r=await queueExisting(s.env,s.task_id);
 assert.equal(r.ok,false);assert.equal(snapshot(s.sql),before);assert.equal(s.calls,0);s.sql.close();
});
test('state changes between initial read and transaction fail closed',async()=>{
 for(const mutation of ["UPDATE tasks SET status='RUNNING'", "UPDATE actions SET tool_name='d1.create_text_artifact'", "UPDATE tasks SET request_text='changed'", "UPDATE factory_jobs SET status='DISPATCHING'"]){
  const s=await factoryFixture();const batch=s.env.DB.batch.bind(s.env.DB);let before;
  s.env.DB.batch=statements=>{s.sql.exec(mutation);before=snapshot(s.sql);return batch(statements);};
  const r=await queueExisting(s.env,s.task_id);assert.equal(r.ok,false,mutation);
  assert.equal(snapshot(s.sql),before);assert.equal(s.calls,0);s.sql.close();
 }
});
test('existing-task API authenticates before disclosing task existence',async()=>{
 const s=await factoryFixture();const before=snapshot(s.sql);let reads=0;
 const DB={prepare(){reads++;throw Error('must authenticate before database lookup');}};
 const errors=[];
 for(const task_id of [s.task_id,'task_'+'0'.repeat(32)]){
  for(const authorization of ['', 'Bearer invalid']){
   const r=await workhub.fetch(new Request('https://test/v1/factory/jobs',{method:'POST',headers:{authorization},body:JSON.stringify({task_id})}),{...s.env,DB});
   assert.equal(r.status,401);errors.push(await r.text());
  }
 }
 assert.equal(new Set(errors).size,1);assert.equal(reads,0);assert.equal(snapshot(s.sql),before);s.sql.close();
});
test('LOCAL FIXTURE ONLY: exact recorded L1 request/hash is UNSUPPORTED without writes',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/l1-task-local.json',import.meta.url),'utf8'));
 assert.equal(fixture.evidence_kind,'LOCAL_FIXTURE_FROM_PARENT_READBACK_NOT_LIVE_EXECUTION');
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fixture.recorded_request_text))).toString('hex');
 assert.equal(hash,fixture.recorded_request_sha256);
 const s=setup(),task_id=fixture.task_id;let calls=0;
 s.env.FACTORY={fetch(){calls++;throw Error('must never call Factory');}};
 s.sql.prepare('INSERT INTO tasks(task_id,status,request_text,request_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(task_id,fixture.recorded_status,fixture.recorded_request_text,hash,'local-fixture','local-fixture');
 s.sql.prepare("INSERT INTO actions(action_key,task_id,tool_name,input_sha256,status) VALUES(?,?,'d1.create_text_artifact',?,'PREPARED')").run('act_local_l1',task_id,hash);
 const before=snapshot(s.sql);
 const results=await Promise.all(Array.from({length:8},()=>queueExisting(s.env,task_id)));
 for(const r of results){assert.equal(r.ok,false);assert.equal(r.upstream_status,422);assert.match(r.result.error,/UNSUPPORTED/);}
 assert.equal(snapshot(s.sql),before);assert.equal(calls,0);
 assert.equal(s.sql.prepare('SELECT latest_run_id FROM tasks').get().latest_run_id,fixture.recorded_latest_run_id);
 s.sql.prepare("UPDATE tasks SET request_text=request_text || 'tampered'").run();
 const changed=snapshot(s.sql),r=await queueExisting(s.env,task_id);
 assert.equal(r.upstream_status,409);assert.match(r.result.error,/hash mismatch/);assert.equal(snapshot(s.sql),changed);s.sql.close();
});
