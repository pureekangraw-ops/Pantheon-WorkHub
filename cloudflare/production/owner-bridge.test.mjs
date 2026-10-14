import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerBridgeCall} from './owner-bridge.mjs';

const env={WORKHUB_TOKEN:'owner-'+ 'z'.repeat(40)};
test('GO Observatory readback is a bounded internal owner-only GET',async()=>{
 let calls=0;
 const worker={fetch:async(request)=>{
  calls++;
  assert.equal(request.method,'GET');
  const url=new URL(request.url);
  assert.equal(url.pathname,'/v1/observatory/latest');
  assert.equal(url.searchParams.get('view'),'browser');
  assert.equal(request.headers.get('authorization'),'Bearer '+env.WORKHUB_TOKEN);
  return Response.json({snapshots:[{capture_id:'safe-capture'}]});
 }};
 const result=await ownerBridgeCall(env,worker,{operation:'observatory_latest',view:'browser'});
 assert.equal(result.ok,true);
 assert.equal(result.upstream_status,200);
 assert.equal(result.result.snapshots[0].capture_id,'safe-capture');
 assert.equal(calls,1);
});
test('GO cannot request unsupported view, fields, or unauthenticated readback',async()=>{
 let calls=0;
 const worker={fetch:()=>{calls++;return Response.json({snapshots:[]});}};
 for(const payload of [
  {operation:'observatory_latest'},
  {operation:'observatory_latest',view:'other'},
  {operation:'observatory_latest',view:'browser',deviceToken:'attempt'},
  {operation:'observatory_latest',view:'browser',approved:true},
 ]) assert.equal((await ownerBridgeCall(env,worker,payload)).ok,false);
 assert.equal(calls,0);
 const badAuth=await ownerBridgeCall({},worker,{operation:'observatory_latest',view:'map'});
 assert.equal(badAuth.status,'UPSTREAM_AUTH_NOT_CONFIGURED');
 assert.equal(calls,0);
});
