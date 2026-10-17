import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {storefrontCall} from '../production/storefront-bridge.mjs';
import workhub from '../production/worker.js';
const principal='a'.repeat(64);
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../production/test-schema.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../production/migrations/0004_storefront.sql',import.meta.url),'utf8'));
 const wrap=(query,args=[])=>({bind(...values){return wrap(query,values)},async first(){return sql.prepare(query).get(...args)||null},async all(){return {results:sql.prepare(query).all(...args)}},async run(){const info=sql.prepare(query).run(...args);return {meta:{changes:Number(info.changes)},success:true}}});
 const DB={prepare:query=>wrap(query),async batch(statements){sql.exec('BEGIN');try{const values=[];for(const s of statements)values.push(await s.run());sql.exec('COMMIT');return values}catch(e){sql.exec('ROLLBACK');throw e}}};
 return {sql,env:{DB,STOREFRONT_INGRESS_ENABLED:'true',WORKHUB_TOKEN:'t'.repeat(40)}};
}
const payload=()=>({version:'1',surface:'SPECTRUMSALE',briefId:'BRIEF-1',clientId:'CLIENT-1',conversationId:'CONV-1',brief:{goal:'Create a company profile',sourcePage:'/services?token=private'},stage:'details'});
const call=(env,operation,p=payload(),owner=principal)=>storefrontCall(env,{operation,payload:p,principal:owner});
test('draft and confirmation persist readback and one queued review without execution',async()=>{
 const {sql,env}=setup();const draft=await call(env,'brief_upsert');assert.equal(draft.status,200);assert.equal(draft.body.brief.status,'DRAFT');
 const confirmed=await call(env,'brief_confirm');assert.equal(confirmed.status,200);assert.equal(confirmed.body.workCreated,true);assert.equal(confirmed.body.workId,'WORK-SPECTRUM-BRIEF-1');
 const repeated=await call(env,'brief_confirm');assert.equal(repeated.body.workCreated,false);assert.equal(repeated.body.receipt,confirmed.body.receipt);
 assert.equal(sql.prepare('SELECT count(*) n FROM tasks').get().n,1);assert.equal(sql.prepare('SELECT count(*) n FROM runs').get().n,0);
 assert.equal(confirmed.body.brief.brief.sourcePage,'/services');
 const denied=await workhub.fetch(new Request('https://pantheon/v1/tasks/'+confirmed.body.work.task_id+'/run',{method:'POST',headers:{authorization:'Bearer '+env.WORKHUB_TOKEN}}),env);
 assert.equal(denied.status,409);sql.close();
});
test('session ownership, identity conflicts and confirmed locks cannot be bypassed',async()=>{
 const {sql,env}=setup();await call(env,'brief_confirm');
 assert.equal((await call(env,'brief_confirm',payload(),'b'.repeat(64))).status,403);
 assert.equal((await call(env,'brief_confirm',{...payload(),clientId:'OTHER'})).status,409);
 assert.equal((await call(env,'brief_confirm',{...payload(),brief:{goal:'Different'}})).status,409);
 assert.equal((await call(env,'brief_upsert')).status,409);sql.close();
});
test('receiver rejects arbitrary operations, owner authority and malformed payloads',async()=>{
 const {sql,env}=setup();
 for(const input of [{operation:'dispatch_factory',payload:{},principal},{operation:'brief_confirm',payload:{...payload(),approved:true},principal},
   {operation:'brief_confirm',payload:payload(),principal:'invalid'},{operation:'brief_confirm',payload:payload(),principal,url:'https://evil'}]){
  assert.ok((await storefrontCall(env,input)).status>=400);
 }
 assert.equal(sql.prepare('SELECT count(*) n FROM tasks').get().n,0);sql.close();
});
test('receiver is disabled by default and public internal HTTP never writes',async()=>{
 const {sql,env}=setup();delete env.STOREFRONT_INGRESS_ENABLED;assert.equal((await call(env,'brief_upsert')).status,503);
 const r=await workhub.fetch(new Request('https://pantheon/internal/brief/upsert',{method:'POST',body:JSON.stringify(payload())}),env);
 assert.equal(r.status,401);assert.equal(sql.prepare('SELECT count(*) n FROM tasks').get().n,0);sql.close();
});
test('budget retries are idempotent and limits survive independent receiver calls',async()=>{
 const {sql,env}=setup();const p={clientId:'CLIENT-1',conversationId:'CONV-1',requestId:'REQ-1',kind:'WHISPER'};
 const first=await call(env,'go_budget',p),again=await call(env,'go_budget',p);assert.deepEqual(first.body.budget,again.body.budget);assert.equal(first.body.duplicate,false);assert.equal(again.body.duplicate,true);
 for(let n=2;n<=3;n++)assert.equal((await call(env,'go_budget',{...p,requestId:'REQ-'+n})).body.allowed,true);
 assert.equal((await call(env,'go_budget',{...p,requestId:'REQ-4'})).body.allowed,false);sql.close();
});
test('sales events reject payment authority and cannot disclose another principal event',async()=>{
 const {sql,env}=setup();const p={eventId:'EV-1',type:'PAGE_VIEW',page:'/services?secret=hidden',source:'direct'};
 assert.equal((await call(env,'sales_event',p)).status,200);
 assert.equal((await call(env,'sales_event',p,'b'.repeat(64))).status,409);
 assert.equal((await call(env,'sales_event',{...p,type:'PAYMENT_CONFIRMED'})).status,400);sql.close();
});

test('conversation budget isolation includes the signed principal, not just a caller ID',async()=>{
 const {sql,env}=setup();
 for(let i=0;i<3;i++)assert.equal((await call(env,'go_budget',{clientId:'A',conversationId:'SHARED',requestId:'A-'+i,kind:'WHISPER'})).body.allowed,true);
 const b=await call(env,'go_budget',{clientId:'B',conversationId:'SHARED',requestId:'B-1',kind:'WHISPER'},'b'.repeat(64));
 assert.equal(b.body.allowed,true);assert.equal(b.body.budget.conversation.whisper,1);assert.equal(b.body.budget.global.whisper,4);sql.close();
});
test('a failed task insert rolls the confirmation transaction back and retry recovers',async()=>{
 const {sql,env}=setup();await call(env,'brief_upsert');
 sql.exec("CREATE TRIGGER fail_task BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'test failure'); END");
 assert.equal((await call(env,'brief_confirm')).status,503);
 assert.equal(sql.prepare('SELECT status FROM storefront_briefs').get().status,'DRAFT');
 sql.exec('DROP TRIGGER fail_task');const retry=await call(env,'brief_confirm');assert.equal(retry.status,200);assert.equal(retry.body.workCreated,true);sql.close();
});
