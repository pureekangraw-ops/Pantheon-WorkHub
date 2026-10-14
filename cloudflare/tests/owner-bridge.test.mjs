import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import workhub from '../production/worker.js';
import {ownerBridgeCall} from '../production/owner-bridge.mjs';
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../production/test-schema.sql',import.meta.url),'utf8'));
 const DB={prepare(query){const s=sql.prepare(query);let a=[];return {bind(...v){a=v;return this;},async first(){return s.get(...a)||null;},async all(){return {results:s.all(...a)};},async run(){return {meta:{changes:Number(s.run(...a).changes)}};}};},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.all());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
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
