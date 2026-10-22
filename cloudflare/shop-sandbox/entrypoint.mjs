import {WorkerEntrypoint} from 'cloudflare:workers';
import {shopOrdersRead} from './bridge.mjs';
export default {fetch(){return new Response('Not found',{status:404});}};
// Explicit named service binding is the platform authority, not names or headers.
export class ShopSandboxBridge extends WorkerEntrypoint {
 async fetch(){return new Response('Not found',{status:404});}
 async shop_orders_read(input){return shopOrdersRead(this.env,input);}
}
