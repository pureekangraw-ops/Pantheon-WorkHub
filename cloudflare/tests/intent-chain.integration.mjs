// LOCAL FIXTURES ONLY: actual GO MCP -> OwnerBridge -> PANTHEON -> in-memory D1.
// Factory binding throws on any access. No remote services are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import workhub from '../production/worker.js';
import {ownerBridgeCall} from '../production/owner-bridge.mjs';
const {default:go}=await import(pathToFileURL((process.env.GO_CHECKOUT||'/workspace/Go-Together')+'/worker/index.js'));
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../production/test-schema.sql',import.meta.url),'utf8'));
 let tail=Promise.resolve();
 const DB={prepare(query){const s=sql.prepare(query);let a=[];return {bind(...v){a=v;return this;},async first(){return s.get(...a)||null;},async all(){return {results:s.all(...a)};},async run(){return {meta:{changes:Number(s.run(...a).changes)}};}};},batch(statements){const run=async()=>{sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.all());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}};const result=tail.then(run);tail=result.catch(()=>{});return result;}};
 return {sql,env:{DB,WORKHUB_TOKEN:'test-only-owner-token-'.repeat(2)}};
}
test('LOCAL chain: ordinary reads, unsupported click-counter, duplicate plans, and zero Factory effects',async()=>{
 const s=setup();let calls=0;
 s.env.FACTORY={fetch(){calls++;throw Error('Factory access forbidden in this fixture');}};
 const env={ACCESS_AUD:'fixture-aud',OWNER_EMAIL:'fixture@example.com',DB:s.env.DB,PANTHEON_OWNER:{ownerCall:a=>ownerBridgeCall(s.env,workhub,a)}};
 const ctx={access:{aud:'fixture-aud',getIdentity:async()=>({email:'fixture@example.com'})}};
 async function call(args,context=ctx){
 const r=await go.fetch(new Request('https://go.local/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'pantheon_request',arguments:args}})}),env,context);
 if(!r.ok)return {http:r.status};
 return JSON.parse((await r.json()).result.content[0].text);
 }
 try{
 const c=await ownerBridgeCall(s.env,workhub,{operation:'intent',payload:{intent:'CREATE_TASK',request:'LOCAL original website request'}});
 const task_id=c.result.task_id;
 const before=JSON.stringify(['tasks','actions','events','factory_jobs','runs','artifacts'].map(t=>s.sql.prepare('SELECT * FROM '+t).all()));
 assert.equal((await call({request:'show my tasks'})).result.result.tasks[0].task_id,task_id);
 const read=await call({request:'show this task',task_id});assert.equal(read.result.original_request,'LOCAL original website request');assert.equal(read.result.verified,false);
 const blocked=await call({request:'build a click-counter website',task_id});
 assert.equal(blocked.result.reason,'WEBSITE_TO_EDGE_JOB_ADAPTER_MISSING');assert.equal(blocked.result.task_id,task_id);
 assert.deepEqual(await call({request:'build a click-counter website',task_id}),blocked);
 assert.equal((await call({request:'show my tasks'},{})).http,401);
 assert.equal(calls,0);
 assert.equal(JSON.stringify(['tasks','actions','events','factory_jobs','runs','artifacts'].map(t=>s.sql.prepare('SELECT * FROM '+t).all())),before);
 }finally{s.sql.close();}
});
