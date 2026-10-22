import test from 'node:test';
import assert from 'node:assert/strict';
import {shopOrdersRead} from '../shop-sandbox/bridge.mjs';
const row={order_id:'cs_test_fixture',amount_minor:4000,currency:'thb',payment_status:'paid',download_authorized:true,download_evidence:'not_recorded',customer_receipt:'unknown'};
const env=result=>({SHOP_COMMERCE_READ:{shopOrdersRead:async()=>result}});
test('isolated platform bridge permits only cursor reads and drops noncontract fields',async()=>{
 const result={ok:true,mode:'test',next_cursor:null,orders:[{...row,token_hash:'not-exposed',email:'fixture@example.com'}]};
 assert.deepEqual(await shopOrdersRead(env(result)),{ok:true,mode:'test',next_cursor:null,orders:[row]});
 for(const input of [{actor:'GO'},{operation:'refund'},{headers:{authorization:'anything'}},{cursor:33},null,[]])assert.equal((await shopOrdersRead(env(result),input)).code,'INVALID_READ_REQUEST');
 assert.equal((await shopOrdersRead({})).code,'SHOP_BRIDGE_NOT_CONFIGURED');
});
test('isolated bridge fails closed for live data, invented receipt, failures and invalid amounts',async()=>{
 for(const changed of [{order_id:'cs_live_wrong'},{amount_minor:0},{amount_minor:1.1},{currency:'xxx'},{customer_receipt:'delivered'},{download_authorized:false}])assert.equal((await shopOrdersRead(env({ok:true,mode:'test',next_cursor:null,orders:[{...row,...changed}]}))).code,'INVALID_SHOP_RESPONSE');
 assert.equal((await shopOrdersRead(env({ok:true,mode:'test',orders:[],next_cursor:'private@example.com'}))).code,'INVALID_SHOP_RESPONSE');
 assert.equal((await shopOrdersRead(env({ok:true,mode:'live',orders:[],next_cursor:null}))).code,'INVALID_SHOP_RESPONSE');
 assert.equal((await shopOrdersRead({SHOP_COMMERCE_READ:{shopOrdersRead:async()=>{throw Error('private diagnostic')}}})).code,'SHOP_READ_UNAVAILABLE');
});
